/**
 * Media Brain — INTAKE, RTB branch.
 *
 * Under RTB there is nothing for the buyer to state: the auction sets the payout
 * call by call. So the terms are measured from the client's own tracking-platform
 * calls over a named window (§12 — the window is confirmed, never inferred), and
 * applied into the intake with the provenance line attached.
 *
 * All arithmetic lives in `@/lib/mediaBrain/rtbObserved`. This component fetches
 * and renders; it computes nothing.
 */

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/mediaBrain/shared";
import { toast } from "sonner";
import {
  measureRtbTerms,
  rtbCallSource,
  rtbProvenanceNote,
  rtbSufficiency,
  type ObservedCall,
  type RtbObservedTerms,
  type RtbSufficiency,
} from "@/lib/mediaBrain/rtbObserved";

const PAGE = 1000;
const MAX_PAGES = 30;

export interface RtbMeasurement {
  terms: RtbObservedTerms;
  sufficiency: RtbSufficiency;
  note: string;
  sourceLabel: string;
  start: string;
  end: string;
}

export function RtbObservedTermsPanel({
  clientId,
  trackingPlatform,
  actionableGap,
  onApply,
}: {
  clientId: string;
  trackingPlatform: string;
  /** Fraction, e.g. 0.57. Null when the operator marked the gap Unknown. */
  actionableGap: number | null;
  onApply: (m: RtbMeasurement) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RtbMeasurement | null>(null);

  const source = rtbCallSource(trackingPlatform);

  if (!trackingPlatform) {
    return (
      <Notice tone="warn" title="Choose the call tracking platform first">
        Under RTB the payout terms are measured from live calls, so the intake needs to know which platform reports
        them. Go back to A1 and select it.
      </Notice>
    );
  }

  if (!source) {
    return (
      <Notice tone="warn" title="No stored call feed for this platform yet">
        RTB terms have to be measured from real calls, and nothing from this platform is stored here. Connect the feed
        first, or mark each RTB field Unknown and record what the buyer said in the notes.
      </Notice>
    );
  }

  const measure = async () => {
    if (!start || !end || start > end) {
      toast.error("Enter a start and end date, with the start on or before the end.");
      return;
    }
    setLoading(true);
    try {
      const rows: ObservedCall[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error } = await (supabase.from as any)(source.table)
          .select(`payout, duration_seconds, ${source.dateColumn}`)
          .eq("client_id", clientId)
          .gte(source.dateColumn, `${start}T00:00:00Z`)
          .lte(source.dateColumn, `${end}T23:59:59Z`)
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as ObservedCall[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }

      if (rows.length === 0) {
        setResult(null);
        toast.error(`No ${source.label} calls stored between ${start} and ${end} — nothing to measure.`);
        return;
      }

      const terms = measureRtbTerms(rows);
      const sufficiency = rtbSufficiency(terms.totalCalls, actionableGap);
      setResult({
        terms,
        sufficiency,
        note: rtbProvenanceNote(source.label, start, end, terms, sufficiency),
        sourceLabel: source.label,
        start,
        end,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the call feed.");
    } finally {
      setLoading(false);
    }
  };

  const t = result?.terms;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <p className="text-sm font-medium">Measure the terms from live {source.label} calls</p>
        <p className="text-xs text-muted-foreground">
          Under RTB nobody can quote you a payout — the auction sets it per call. Confirm the window, measure, then
          apply. RPC is measured on total calls so no-bid losses stay visible; the average winning bid is measured on
          paid calls only.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Window start</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Window end</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Button type="button" onClick={measure} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Measure
        </Button>
      </div>

      {t && result && (
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Total calls in window" value={t.totalCalls.toLocaleString()} />
            <Row
              label="Paid calls"
              value={`${t.paidCalls.toLocaleString()}${t.paidRate === null ? "" : ` (${Math.round(t.paidRate * 100)}%)`}`}
            />
            <Row label="Payouts in window" value={money(t.revenue)} />
            <Row label="Observed RPC (÷ total calls)" value={money(t.observedRpc)} />
            <Row label="Average winning bid (÷ paid calls)" value={money(t.avgWinningBid)} />
            <Row label="Bid floor / ceiling observed" value={`${money(t.bidFloor)} / ${money(t.bidCeiling)}`} />
            <Row
              label="Paid call duration range"
              value={
                t.paidDurationMinSeconds === null
                  ? "—"
                  : `${t.paidDurationMinSeconds}s – ${t.paidDurationMaxSeconds}s`
              }
            />
            <Row
              label="Shortest call that was paid"
              value={t.minDurationWithPayout === null ? "—" : `${t.minDurationWithPayout}s`}
            />
            {t.unusableRows > 0 && (
              <Row label="Rows with no payout or duration field" value={t.unusableRows.toLocaleString()} />
            )}
          </div>

          <Notice tone={result.sufficiency.sufficient ? "ok" : "warn"} title="Confidence in this window">
            {result.sufficiency.note}
          </Notice>

          <Notice tone="info" title="Publisher scoping is not applied yet">
            These figures cover every call the platform stored for this client in the window. Whose traffic counts is
            answered later in the intake, so re-measure after scoping is set if this client's feed carries other
            publishers.
          </Notice>

          <Button type="button" variant="secondary" onClick={() => onApply(result)}>
            Apply these measured terms to the fields below
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function money(v: number | null) {
  return v === null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
