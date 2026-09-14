/**
 * The PLATFORM-ATTRIBUTED read: the ad platform's own conversion counts, kept
 * strictly separate from our call-attributed read.
 *
 * This hook fetches and hands over. Every figure is derived in
 * src/lib/mediaBrain/platformConversions.ts — nothing is computed here.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  platformAttributedAdRead,
  type ConversionBreakdownRow,
  type PlatformAdSpendRow,
  type PlatformAttributedRead,
} from '@/lib/mediaBrain/platformConversions';

export interface PlatformAttributedPayload {
  platform: string;
  read: PlatformAttributedRead;
  /** True when no instance record exists at all — the governing event cannot be set. */
  noInstance: boolean;
  breakdown: ConversionBreakdownRow[];
}

export function useMediaBrainPlatformConversions(
  clientId: string | undefined,
  platform: 'meta' | 'google',
  start: string,
  end: string,
) {
  return useQuery<PlatformAttributedPayload>({
    queryKey: ['media-brain-platform-conversions', clientId, platform, start, end],
    enabled: !!clientId && !!start && !!end,
    queryFn: async () => {
      const [instRes, convRes, adRes] = await Promise.all([
        supabase
          .from('media_brain_instances')
          .select('meta_conversion_event, computed_at')
          .eq('client_id', clientId!)
          .order('computed_at', { ascending: false })
          .limit(1),
        supabase
          .from('media_brain_platform_conversions')
          .select('platform, entity_level, entity_ref, entity_name, date, event_name, count, value')
          .eq('client_id', clientId!)
          .eq('platform', platform)
          .eq('entity_level', 'ad')
          .gte('date', start)
          .lte('date', end),
        supabase
          .from('ad_creatives')
          .select('platform_ad_id, ad_name, spend, conversions, revenue')
          .eq('client_id', clientId!)
          .eq('platform', platform),
      ]);
      if (instRes.error) throw new Error(instRes.error.message);
      if (convRes.error) throw new Error(convRes.error.message);
      if (adRes.error) throw new Error(adRes.error.message);

      const instance = instRes.data?.[0] ?? null;
      const breakdown = (convRes.data ?? []) as unknown as ConversionBreakdownRow[];
      const ads: PlatformAdSpendRow[] = (adRes.data ?? []).map((a: Record<string, unknown>) => ({
        entity_ref: String(a.platform_ad_id ?? ''),
        entity_name: (a.ad_name as string | null) ?? null,
        spend: (a.spend as number | null) ?? 0,
      }));

      // Google delivers conversions on the ad row itself rather than as a named
      // event breakdown, so its rows are their own event name — still platform
      // attributed, still never blended with the call read.
      //
      // This is the ONE place a raw ad-table `conversions` column is read, and only
      // for Google, only when no stored breakdown exists. It is not the Meta defect:
      // Google's column carries the account's own primary-conversion total, not a
      // pile of different event names summed together, so there is nothing to
      // triple-count. The moment Google breakdown rows land they take precedence.
      // Meta never takes this path — its count comes from the governing event alone.
      const rows: ConversionBreakdownRow[] =
        platform === 'google' && breakdown.length === 0
          ? (adRes.data ?? []).map((a: Record<string, unknown>) => ({
              platform,
              entity_level: 'ad',
              entity_ref: String(a.platform_ad_id ?? ''),
              entity_name: (a.ad_name as string | null) ?? null,
              date: null,
              event_name: 'google_primary_conversions',
              count: (a.conversions as number | null) ?? 0,
              value: (a.revenue as number | null) ?? 0,
            }))
          : breakdown;

      const governingEvent =
        platform === 'google'
          ? rows.length > 0
            ? 'google_primary_conversions'
            : null
          : ((instance?.meta_conversion_event as string | null) ?? null);

      return {
        platform,
        read: platformAttributedAdRead(ads, rows, governingEvent),
        noInstance: !instance,
        breakdown: rows,
      };
    },
  });
}
