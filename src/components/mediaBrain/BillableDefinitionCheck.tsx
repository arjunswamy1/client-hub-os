/**
 * Intake 3a — compare the STATED billable definition against what the platform's
 * data actually did over the last 30 days, in BOTH directions, BEFORE any
 * threshold is computed.
 *
 * A one-directional check misses the more expensive error: calls the buyer paid
 * for that the stated definition throws away. Above 10% disagreement this blocks
 * intake until the operator says which definition governs — thresholds built on a
 * definition the data contradicts look authoritative and are not.
 *
 * Where the revenue source is `computed` the platform's payouts are not visible
 * to us, so only the duration side is validated and that is stated plainly rather
 * than reported as agreement.
 *
 * @see docs/media-brain/02_Client_Intake.md Part A
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getAdapter, mapCalls, type TrackingPlatform } from "@/lib/mediaBrain/adapter";
import * as engine from "@/lib/mediaBrain/engine";
import { CALL_DATE_COLUMN, CALL_TABLES } from "@/lib/mediaBrain/pull";
import { Notice, fmtNum, fmtPct, daysAgoIso, todayIso } from "@/components/mediaBrain/shared";

export type BillableGovernance = "stated" | "platform";

interface Props {
  clientId?: string;
  trackingPlatform: string;
  revenueSource: engine.RevenueSource;
  minDurationSeconds: number | null;
  minPayoutThreshold: number | null;
  payout: number | null;
  governance: BillableGovernance | null;
  setGovernance: (g: BillableGovernance) => void;
  /** Reports whether intake must stay blocked. */
  onBlockingChange: (blocking: boolean) => void;
}

export function BillableDefinitionCheck({
  clientId,
  trackingPlatform,
  revenueSource,
  minDurationSeconds,
  minPayoutThreshold,
  payout,
  governance,
  setGovernance,
  onBlockingChange,
}: Props) {
  const start = daysAgoIso(30);
  const end = todayIso();

  const q = useQuery({
    queryKey: ["mb-billable-check", clientId, trackingPlatform, minDurationSeconds, minPayoutThreshold, revenueSource],
    enabled: !!clientId && !!trackingPlatform,
    queryFn: async () => {
      const table = CALL_TABLES[trackingPlatform];
      const mapper = getAdapter(trackingPlatform as TrackingPlatform);
      if (!table || !mapper) {
        return { unavailable: `No call-data mapping for tracking platform "${trackingPlatform}", so the definition cannot be checked against data.` };
      }
      const dateCol = CALL_DATE_COLUMN[table];
      const { data, error } = await supabase
        .from(table as never)
        .select("*")
        .eq("client_id", clientId!)
        .gte(dateCol, `${start}T00:00:00`)
        .lte(dateCol, `${end}T23:59:59.999`);
      if (error) return { unavailable: `Calls query failed: ${error.message}` };
      const rows = (data ?? []) as Record<string, unknown>[];
      if (!rows.length) {
        return { noLiveData: true as const };
      }
      const eco: engine.RevenueEconomics = {
        revenue_source: revenueSource,
        payout,
        min_payout_threshold: minPayoutThreshold,
        billable_min_duration_seconds: minDurationSeconds,
      };
      const { calls } = mapCalls(rows, mapper, {
        billableMinDurationSeconds: minDurationSeconds,
        revenueSource,
        minPayoutThreshold,
      });
      return {
        result: engine.validateBillableDefinition(
          eco,
          calls.map((c) => ({ duration_seconds: c.duration_seconds, payout_amount: c.payout_amount })),
        ),
      };
    },
  });

  const result = q.data && "result" in q.data ? q.data.result : null;
  const blocking = !!result?.blocks && !governance;

  useEffect(() => {
    onBlockingChange(blocking);
  }, [blocking, onBlockingChange]);

  if (q.isLoading) {
    return <Notice tone="info" title="Checking the stated billable definition against the last 30 days of calls…" />;
  }

  if (q.data && "unavailable" in q.data) {
    return <Notice tone="warn" title="The billable definition could not be validated">{q.data.unavailable}</Notice>;
  }

  if (q.data && "noLiveData" in q.data) {
    return (
      <Notice tone="info" title="No live call data yet — nothing to validate against">
        This check is required for any client with live data. There are no calls in the last 30 days, so the stated
        definition stands unvalidated and is recorded as such.
      </Notice>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-3">
      <Notice
        tone={result.blocks ? "danger" : result.durationSideOnly ? "warn" : "ok"}
        title={
          result.blocks
            ? "The stated billable definition disagrees with the data — nothing computes until you choose"
            : result.durationSideOnly
              ? "Only the duration side could be validated"
              : "The stated billable definition agrees with the data"
        }
      >
        <div className="space-y-2">
          <p>{result.note}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{fmtNum(result.totalCalls)} calls checked</Badge>
            {!result.durationSideOnly && (
              <>
                <Badge variant="outline">billable by definition, never paid: {fmtNum(result.billableByDefinitionUnpaid)}</Badge>
                <Badge variant="outline">paid, not billable by definition: {fmtNum(result.paidNotBillableByDefinition)}</Badge>
                <Badge variant="outline">disagreement: {fmtPct(result.disagreementPct)}</Badge>
              </>
            )}
          </div>
        </div>
      </Notice>

      {result.blocks && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Which definition governs?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded on the Economics record either way, so the disagreement stays visible instead of being smoothed over.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={governance === "stated" ? "default" : "outline"}
              onClick={() => setGovernance("stated")}
            >
              The stated definition governs
            </Button>
            <Button
              size="sm"
              variant={governance === "platform" ? "default" : "outline"}
              onClick={() => setGovernance("platform")}
            >
              What the platform actually paid governs
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
