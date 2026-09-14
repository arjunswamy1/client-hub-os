/**
 * The VERTICAL READ and the intake billable-definition check, fetched once and
 * shared by the Weekly and Intake screens.
 *
 * Every number here comes from engine.ts / verticalRead.ts. This hook fetches and
 * hands over; it derives nothing.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getAdapter, mapCalls, type TrackingPlatform } from '@/lib/mediaBrain/adapter';
import * as engine from '@/lib/mediaBrain/engine';
import type { MetaAdRow } from '@/lib/mediaBrain/join';
import { CALL_DATE_COLUMN, CALL_TABLES } from '@/lib/mediaBrain/pull';
import {
  assignCallToVertical,
  verticalRead,
  type VerticalDefinition,
  type VerticalReadResult,
} from '@/lib/mediaBrain/verticalRead';

export interface VerticalValidation {
  vertical_id: string;
  label: string;
  revenueSource: engine.RevenueSource;
  payoutConfirmed: boolean | null;
  result: engine.BillableAgreementResult;
}

export interface VerticalReadPayload {
  read: VerticalReadResult;
  validations: VerticalValidation[];
  /** True when at least one vertical's disagreement is above the 10% limit. */
  blocks: boolean;
  totalCalls: number;
  /** Named data caveats about the read itself. */
  notes: string[];
}

interface EconomicsRow {
  vertical_id: string | null;
  payout: number | null;
  payout_mode: string | null;
  tracking_platform: string | null;
  billable_min_duration_seconds: number | null;
  revenue_source: string | null;
  min_payout_threshold: number | null;
  billable_filters: Record<string, unknown> | null;
}

export function useMediaBrainVerticalRead(
  clientId: string | undefined,
  start: string,
  end: string,
  adLevelPct?: number | null,
) {
  return useQuery<VerticalReadPayload | { error: string }>({
    queryKey: ['media-brain-vertical-read', clientId, start, end],
    enabled: !!clientId && !!start && !!end,
    queryFn: async () => {
      const [ecoRes, vertRes] = await Promise.all([
        supabase.from('media_brain_economics').select('*').eq('client_id', clientId!),
        supabase
          .from('client_verticals')
          .select('vertical_id, label, emoji, meta_patterns, ringba_patterns, ringba_exact_match, position')
          .eq('client_id', clientId!)
          .order('position'),
      ]);
      if (ecoRes.error) return { error: `Economics lookup failed: ${ecoRes.error.message}` };
      if (vertRes.error) return { error: `Verticals lookup failed: ${vertRes.error.message}` };

      const economicsRows = (ecoRes.data ?? []) as unknown as EconomicsRow[];
      const verticals = (vertRes.data ?? []) as unknown as VerticalDefinition[];
      if (!economicsRows.length) {
        return { error: 'No Economics record for this client. Run intake first — the framework does not fall back on defaults.' };
      }
      if (!verticals.length) {
        return { error: 'No verticals are defined for this client, so there is nothing to read at vertical level.' };
      }

      const trackingPlatform = (economicsRows.find((r) => r.tracking_platform)?.tracking_platform ??
        '') as TrackingPlatform;
      const table = CALL_TABLES[trackingPlatform];
      const mapper = getAdapter(trackingPlatform);
      if (!table || !mapper) {
        return { error: `No call-data mapping for tracking platform "${trackingPlatform}".` };
      }
      const dateCol = CALL_DATE_COLUMN[table];

      const [callsRes, adsRes] = await Promise.all([
        supabase
          .from(table as never)
          .select('*')
          .eq('client_id', clientId!)
          .gte(dateCol, `${start}T00:00:00`)
          .lte(dateCol, `${end}T23:59:59.999`),
        supabase.from('ad_creatives').select('*').eq('client_id', clientId!),
      ]);
      if (callsRes.error) return { error: `Calls query failed: ${callsRes.error.message}` };
      if (adsRes.error) return { error: `Meta creatives query failed: ${adsRes.error.message}` };

      const rawCalls = (callsRes.data ?? []) as Record<string, unknown>[];
      // §: an empty pull is a failure, not a zero.
      if (!rawCalls.length) {
        return {
          error: `No call records came back for ${start} to ${end}. That is a data failure, not zero calls — check the sync before reading anything into it.`,
        };
      }

      const clientRow = economicsRows.find((r) => !r.vertical_id) ?? null;
      const clientDefault: engine.RevenueEconomics = {
        revenue_source: clientRow?.revenue_source ?? 'platform',
        payout: clientRow?.payout ?? null,
        min_payout_threshold: clientRow?.min_payout_threshold ?? null,
        billable_min_duration_seconds: clientRow?.billable_min_duration_seconds ?? null,
      };

      const byVertical: Record<string, engine.RevenueEconomics & { payout_confirmed?: boolean | null }> = {};
      for (const row of economicsRows) {
        if (!row.vertical_id) continue;
        const filters = (row.billable_filters ?? {}) as Record<string, unknown>;
        byVertical[row.vertical_id] = {
          revenue_source: row.revenue_source ?? 'platform',
          payout: row.payout,
          min_payout_threshold: row.min_payout_threshold,
          billable_min_duration_seconds: row.billable_min_duration_seconds,
          payout_confirmed:
            typeof filters.payout_confirmed === 'boolean' ? (filters.payout_confirmed as boolean) : null,
        };
      }

      // Mapping uses the CLIENT-level duration only for the canonical shape; the
      // vertical read re-decides billable with each vertical's own economics.
      const { calls } = mapCalls(rawCalls, mapper, {
        billableMinDurationSeconds: clientDefault.billable_min_duration_seconds,
        revenueSource: clientDefault.revenue_source,
        minPayoutThreshold: clientDefault.min_payout_threshold,
      });

      const read = verticalRead({
        calls,
        metaAds: (adsRes.data ?? []) as unknown as MetaAdRow[],
        verticals,
        economics: { byVertical, clientDefault },
        thresholds: { minCalls: null, minMargin: null, targetMargin: null, killThreshold: null },
        adLevelPct: adLevelPct ?? null,
      });

      // Intake 3a — per vertical, in both directions.
      const validations: VerticalValidation[] = verticals.map((v) => {
        const eco = byVertical[v.vertical_id] ?? clientDefault;
        // Same assignment rule as the read itself — imported, never re-derived.
        const bucketCalls = calls.filter((c) => assignCallToVertical(c.campaign_name, verticals) === v.vertical_id);
        return {
          vertical_id: v.vertical_id,
          label: v.label ?? v.vertical_id,
          revenueSource: engine.revenueSourceOf(eco),
          payoutConfirmed: (eco as { payout_confirmed?: boolean | null }).payout_confirmed ?? null,
          result: engine.validateBillableDefinition(
            eco,
            bucketCalls.map((c) => ({ duration_seconds: c.duration_seconds, payout_amount: c.payout_amount })),
          ),
        };
      });

      const notes: string[] = [];
      if (!clientRow) {
        notes.push(
          'There is no client-level Economics record, only per-vertical ones. Anything unclassified therefore has no billable definition and is reported without billable-denominated metrics rather than with guessed ones.',
        );
      }

      return {
        read,
        validations,
        blocks: validations.some((v) => v.result.blocks),
        totalCalls: calls.length,
        notes,
      };
    },
  });
}

