/**
 * Media Brain — WEEKLY
 *
 * An eight-step guided review (§4). Each step must be completed before the next
 * unlocks, because the order is the method: skipping the downstream diagnostic
 * is the expensive error.
 *
 * NOTHING EXECUTES. Approving a proposed action sets the disposition to
 * `approved` and writes the change log. No Meta API call is made from this
 * screen, and no campaign is mutated.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §4
 * @see docs/media-brain/01_Decision_Engine.md §6, §7, §8, §11
 */

import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Lock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import * as engine from "@/lib/mediaBrain/engine";
import * as decisions from "@/lib/mediaBrain/decisions";
import { pullWindow, type PullWindowResult, type PullWindowSuccess } from "@/lib/mediaBrain/pull";
import { VerticalReadPanel } from "@/components/mediaBrain/VerticalReadPanel";
import { PlatformAttributedRead } from "@/components/mediaBrain/PlatformAttributedRead";
import {
  ConfidenceBadge,
  GateBlock,
  Notice,
  StaleWarning,
  WindowConfirm,
  daysAgoIso,
  fmtMoney,
  fmtNum,
  fmtPct,
  groupRows,
  rowClass,
  todayIso,
  type ConfirmedWindow,
  type GroupedRow,
  useMediaBrainGate,
} from "@/components/mediaBrain/shared";

/** Scale-step bounds and the learning-phase floor are stated once, in engine.DEFAULTS. */
const STEP_MIN_PCT = Math.round(engine.DEFAULTS.scaleStepMin * 100);
const STEP_MAX_PCT = Math.round(engine.DEFAULTS.scaleStepMax * 100);
const FRAG_FLOOR = engine.DEFAULTS.fragmentationFloor;

type Trend = "" | "stable" | "rising" | "falling";
type Verdict = "" | "keep" | "cut" | "hold";

interface DispositionState {
  verdict: Verdict;
  reason: string;
  awaiting: string;
  reviewDate: string;
  suggested: Verdict;
  suggestedReason: string;
}

interface LogDraft {
  description: string;
  why: string;
  expected: string;
  reviewDate: string;
  changepoint: boolean;
}

const STEPS = [
  "Pull the window",
  "Diagnose anything that moved",
  "Forced disposition",
  "Graduation",
  "Scale",
  "Budget reallocation",
  "Fragmentation check",
  "Log everything",
];

export default function MediaBrainWeeklyPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { teamMember } = useAuth() as any;
  const gate = useMediaBrainGate(clientId);

  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [confirmed, setConfirmed] = useState<ConfirmedWindow | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pull = useQuery({
    queryKey: ["mb-weekly-pull", clientId, confirmed?.start, confirmed?.end, confirmed?.timezone],
    queryFn: async (): Promise<PullWindowResult> =>
      pullWindow({ clientId: clientId!, start: confirmed!.start, end: confirmed!.end, timezone: confirmed!.timezone }),
    enabled: !!clientId && !!confirmed,
    staleTime: 60_000,
  });

  const data = pull.data?.ok ? (pull.data as PullWindowSuccess) : null;
  const instance = gate.instance;
  const rtb = data?.payoutMode === "rtb";

  /* ---------------- step 2 — diagnostics ---------------- */
  const [rtbSignals, setRtbSignals] = useState<Record<string, Trend>>({});
  const [rtbSide, setRtbSide] = useState<"" | "traffic" | "demand">("");
  const [downstream, setDownstream] = useState({ mediaFlat: false, billableMoved: false, connectionMoved: false, note: "" });
  const [downstreamAnswered, setDownstreamAnswered] = useState(false);
  const [saturation, setSaturation] = useState("");
  const [fatigue, setFatigue] = useState("");
  const [structural, setStructural] = useState("");

  const notAMediaProblem = downstream.mediaFlat && (downstream.billableMoved || downstream.connectionMoved);

  /* ---------------- step 3 — dispositions ---------------- */
  const adsetRows = useMemo<GroupedRow[]>(
    () => (data ? groupRows(data.rows, "adset", data.payoutMode, data.thresholds) : []),
    [data],
  );
  const adRows = useMemo<GroupedRow[]>(
    () => (data ? groupRows(data.rows, "ad", data.payoutMode, data.thresholds) : []),
    [data],
  );

  const entities = useMemo(
    () => [
      ...adsetRows.map((r) => ({ level: "adset" as const, row: r })),
      ...adRows.map((r) => ({ level: "ad" as const, row: r })),
    ],
    [adsetRows, adRows],
  );

  const [dispositions, setDispositions] = useState<Record<string, DispositionState>>({});

  /**
   * Every threshold a decision reads, in one object. The rules themselves live
   * in `decisions.ts` — this page renders their output and keeps no second copy.
   */
  const ctx = useMemo<decisions.DecisionContext | null>(
    () =>
      data
        ? {
            payoutMode: data.payoutMode,
            targetMargin: data.thresholds.targetMargin,
            minMargin: data.thresholds.minMargin,
            minCalls: data.thresholds.minCalls,
            killThreshold: data.thresholds.killThreshold,
            allowableCostPerCall: data.thresholds.allowableCostPerCall,
          }
        : null,
    [data],
  );

  /** Peers of an ad inside its own ad set, for the group-comparison rules. */
  const peersOf = useCallback(
    (r: GroupedRow) =>
      adRows.filter((p) => (p.platform_adset_id ?? p.adset_name) === (r.platform_adset_id ?? r.adset_name)),
    [adRows],
  );

  const suggestions = useMemo(() => {
    const out: Record<string, { verdict: Verdict; reason: string }> = {};
    if (!ctx) return out;
    for (const { level, row } of entities) {
      const s = decisions.suggestVerdict(row, ctx, { level, peers: peersOf(row) });
      out[`${level}:${row.groupKey}`] = { verdict: s.verdict as Verdict, reason: s.reason };
    }
    return out;
  }, [ctx, entities, peersOf]);

  /**
   * §6.4 — nothing carries forward unstated. A missing disposition, a missing
   * verdict, or a hold without evidence + review date all count as undecided.
   * Re-used verbatim at save time; never computed twice from different rules.
   */
  const undecidedEntities = entities.filter(({ level, row }) => {
    const d = dispositions[`${level}:${row.groupKey}`];
    if (!d?.verdict) return true;
    if (d?.verdict === "hold" && (!d?.awaiting?.trim() || !d?.reviewDate)) return true;
    return false;
  });
  const undecided = undecidedEntities.length;

  /* ---------------- step 4/5 ---------------- */
  const [graduated, setGraduated] = useState<Record<string, boolean>>({});
  const [scaleChecks, setScaleChecks] = useState<Record<string, { held: boolean; capacity: boolean; stableMix: boolean; stepPct: number }>>({});
  const [marginal, setMarginal] = useState({ baseSpend: "", baseRevenue: "", newSpend: "", newRevenue: "" });

  /* ---------------- step 6/7 ---------------- */
  const [activeAdSets, setActiveAdSets] = useState("");
  const [reallocationNote, setReallocationNote] = useState("");

  /* ---------------- step 8 ---------------- */
  const [logs, setLogs] = useState<LogDraft[]>([
    { description: "", why: "", expected: "", reviewDate: "", changepoint: false },
  ]);

  const block = <GateBlock gate={gate} clientId={clientId} />;
  if (block) return <div className="mx-auto max-w-5xl space-y-4">{block}</div>;

  const unlocked = (n: number) => n <= maxStep;
  const complete = (n: number) => {
    setMaxStep((m) => Math.max(m, n + 1));
    setStep(n + 1);
  };

  /* ---------------- save ---------------- */

  async function createReview() {
    if (!data || !confirmed) return;
    const { data: row, error } = await supabase
      .from("media_brain_reviews")
      .insert({
        client_id: clientId!,
        instance_id: instance!.id,
        cadence: "weekly",
        window_start: confirmed.start,
        window_end: confirmed.end,
        timezone: confirmed.timezone,
        status: "in_progress",
        pull_ok: true,
        totals: data.totals as any,
        breakers: { list: data.breakers, unjoinedSpend: data.unjoinedSpend, unjoinedCalls: data.unjoinedCalls.length } as any,
      })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setReviewId(row.id);
    complete(1);
  }

  async function saveEverything() {
    if (!reviewId || !data) return;
    // §6.4 — re-check the step 3 guard at save. Step 3 stays reachable, and the
    // entity list can refetch, so a decision can be blanked after the step was
    // marked complete. Refuse here rather than letting the DB CHECK reject it.
    if (undecidedEntities.length > 0) {
      const names = undecidedEntities.slice(0, 5).map(({ row }) => row.entity_name).join(", ");
      toast.error(
        `${undecidedEntities.length} ${undecidedEntities.length === 1 ? "entity is" : "entities are"} still undecided: ${names}${
          undecidedEntities.length > 5 ? ` and ${undecidedEntities.length - 5} more` : ""
        }. Go back to step 3 — a hold also needs the evidence awaited and a review date.`,
      );
      return;
    }
    const missing = logs.some((l) => l.description.trim() && (!l.why.trim() || !l.expected.trim() || !l.reviewDate));
    if (missing) {
      toast.error("Every logged change needs why, expected result and a review date.");
      return;
    }
    setSaving(true);
    try {
      const dispRows = entities.map(({ level, row }) => {
        const d = dispositions[`${level}:${row.groupKey}`];
        return {
          client_id: clientId!,
          instance_id: instance!.id,
          review_id: reviewId,
          entity_level: level,
          entity_ref: row.groupKey,
          entity_name: row.entity_name,
          verdict: d?.verdict,
          reason: d?.reason || suggestions[`${level}:${row.groupKey}`]?.reason || null,
          evidence: {
            spend: row.spend,
            revenue: row.revenue,
            calls: row.calls,
            billable_calls: row.billable_calls,
            marginPerCall: row.marginPerCall,
            marginPct: row.marginPct,
            costPerBillableCall: row.costPerBillableCall,
          } as any,
          confidence_state: row.confidenceState,
          awaiting_evidence: d?.verdict === "hold" ? d?.awaiting : null,
          review_date: d?.verdict === "hold" ? d?.reviewDate : null,
          status: "approved",
          decided_by_id: teamMember?.id ?? null,
          decided_at: new Date().toISOString(),
        };
      });

      const { error: dErr } = await supabase.from("media_brain_dispositions").insert(dispRows as any);
      if (dErr) throw dErr;

      const logRows = logs
        .filter((l) => l.description.trim())
        .map((l) => ({
          client_id: clientId!,
          change_date: confirmed!.end,
          change_description: l.description,
          why: l.why,
          expected_result: l.expected,
          review_date: l.reviewDate,
          is_changepoint: l.changepoint,
          created_by_id: teamMember?.id ?? null,
        }));
      if (logRows.length > 0) {
        const { error: lErr } = await supabase.from("media_brain_change_log").insert(logRows as any);
        if (lErr) throw lErr;
      }

      const { error: rErr } = await supabase
        .from("media_brain_reviews")
        .update({
          status: "approved",
          diagnostics: {
            downstream,
            notAMediaProblem,
            rtbSignals,
            rtbSide,
            saturation,
            fatigue,
            structural,
            reallocationNote,
            activeAdSets,
          } as any,
        })
        .eq("id", reviewId);
      if (rErr) throw rErr;

      toast.success("Review saved. Approved dispositions and change log written — no campaign was touched.");
      complete(8);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const cutSpend = entities
    .filter(({ level, row }) => dispositions[`${level}:${row.groupKey}`]?.verdict === "cut" && level === "adset")
    .reduce((s, { row }) => s + row.spend, 0);
  const anyGraduated = Object.values(graduated).some(Boolean);
  /**
   * §4: the numerator is the account's META OPTIMISATION EVENT — whatever the ad
   * sets bid toward — not the billable-call count. Meta's ~50-per-ad-set
   * learning-phase floor counts its own event, so substituting billable calls
   * compares two different things. Where the event is UNKNOWN, the check does
   * not run.
   */
  const metaEvent = (instance?.meta_conversion_event as string | null) ?? null;
  const expectedMetaEvents = (instance?.expected_meta_events_per_week as number | null) ?? null;
  const fragBlocked = !metaEvent
    ? "Cannot run: the Meta conversion event for this account is not recorded."
    : expectedMetaEvents === null
      ? `Cannot run: the expected weekly count of "${metaEvent}" is not recorded.`
      : null;
  const frag = fragBlocked
    ? { perAdSet: null as number | null, passes: false }
    : engine.fragmentationCheck(expectedMetaEvents, activeAdSets ? Number(activeAdSets) : null);
  /** The billable definition is a different event; say so rather than implying they agree. */
  const billableDiffersFromMetaEvent = !!metaEvent && !/billable/i.test(metaEvent);
  const marginalResult = ctx && decisions.marginalVerdict(
    {
      spend: marginal.baseSpend === "" ? null : Number(marginal.baseSpend),
      revenue: marginal.baseRevenue === "" ? null : Number(marginal.baseRevenue),
    },
    {
      spend: marginal.newSpend === "" ? null : Number(marginal.newSpend),
      revenue: marginal.newRevenue === "" ? null : Number(marginal.newRevenue),
    },
    ctx,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly review — {gate.client?.name}</h1>
        <p className="text-sm text-muted-foreground">
          Cut cadence <strong>{instance?.cut_cadence ?? "—"}</strong> · scale cadence{" "}
          <strong>{instance?.scale_cadence ?? "—"}</strong> (volume tier {instance?.volume_tier ?? "—"}). Cuts move faster
          than scale steps. Nothing here executes: approving writes the decision and the log, and never calls the ad
          platform.
        </p>
      </div>

      <StaleWarning instance={instance!} />

      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => {
          const n = i + 1;
          return (
            <li key={s}>
              <button
                type="button"
                disabled={!unlocked(n)}
                onClick={() => setStep(n)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                  step === n ? "border-primary bg-primary/10 font-medium" : "bg-card"
                } ${!unlocked(n) ? "opacity-50" : ""}`}
              >
                {n < maxStep ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : unlocked(n) ? <Circle className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {n}. {s}
              </button>
            </li>
          );
        })}
      </ol>

      {/* ---------------- Step 1 ---------------- */}
      {step === 1 && (
        <div className="space-y-4">
          <WindowConfirm
            label="Step 1 — confirm the review window, then pull"
            defaultStart={daysAgoIso(7)}
            defaultEnd={todayIso()}
            confirmed={confirmed}
            onConfirm={setConfirmed}
            onReset={() => {
              setConfirmed(null);
              setReviewId(null);
            }}
          />
          {confirmed && pull.isFetching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pulling…
            </div>
          )}
          {pull.data && !pull.data.ok && (
            <Notice tone="danger" title="The pull failed — this is not a zero">
              {(pull.data as { error?: string }).error}
              <p className="mt-2">An empty result means the pull failed. Zero billable calls is a kill trigger, so it is never inferred from a failure.</p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => pull.refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry pull
                </Button>
              </div>
            </Notice>
          )}
          {data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Window pulled</CardTitle>
                <CardDescription>{data.joinNote}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <KV k="Spend" v={fmtMoney(data.totals.spend)} />
                  <KV k="Calls" v={fmtNum(data.totals.calls)} />
                  <KV k="Billable" v={fmtNum(data.totals.billableCalls)} />
                  <KV k="Margin %" v={fmtPct(data.totals.marginPct)} />
                  <KV k="Margin / call" v={fmtMoney(data.totals.marginPerCall)} />
                  <KV k="Cost / billable call" v={fmtMoney(data.totals.costPerBillableCall)} />
                  <KV k="min_calls" v={fmtNum(data.thresholds.minCalls)} />
                  <KV k="Kill threshold" v={fmtMoney(data.thresholds.killThreshold)} />
                </div>
                {data.unjoinedSpend.length > 0 && (
                  <Notice tone="danger" title="Tracking flag — Meta spend with no joined calls">
                    {data.unjoinedSpend.map((u) => `${u.entity}: ${fmtMoney(u.spend)}`).join(" · ")}. This is a tracking
                    flag, not a zero — do not judge these entities on margin.
                  </Notice>
                )}
                <Button onClick={createReview} disabled={!!reviewId}>
                  {reviewId ? "Review started" : "Start the review"}
                </Button>
              </CardContent>
            </Card>
          )}
          {data && confirmed && (
            <VerticalReadPanel
              clientId={clientId}
              start={confirmed.start}
              end={confirmed.end}
              adLevelPct={data.totals.calls ? data.adLevelCalls / data.totals.calls : null}
            />
          )}
          {/*
            The platform's own conversion count, kept strictly apart from the
            call-attributed read above. Different attribution, different
            denominators — shown side by side with the gap stated.
          */}
          {data && confirmed && (
            <>
              <PlatformAttributedRead
                clientId={clientId}
                platform="meta"
                start={confirmed.start}
                end={confirmed.end}
                callAttributedCalls={data.totals.calls ?? null}
                callAttributedSpend={data.totals.spend ?? null}
              />
              <PlatformAttributedRead
                clientId={clientId}
                platform="google"
                start={confirmed.start}
                end={confirmed.end}
                callAttributedCalls={data.totals.calls ?? null}
                callAttributedSpend={data.totals.spend ?? null}
              />
            </>
          )}

        </div>
      )}

      {/* ---------------- Step 2 ---------------- */}
      {step === 2 && data && (
        <div className="space-y-4">
          {rtb && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 2 · 1a — [RTB] your traffic vs their demand</CardTitle>
                <CardDescription>
                  Resolve traffic-side or demand-side before anything else. Rising no-bid, falling bid depth and falling
                  winning bid with stable CTR/CPM is demand-side — a routing conversation, and routing is recommend-only.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {["No-bid rate", "Bid depth", "Average winning bid", "Connection / qualification rate", "Buyer mix", "CTR / CPM / frequency"].map(
                  (sig) => (
                    <div key={sig} className="flex items-center justify-between gap-3">
                      <Label className="text-sm">{sig}</Label>
                      <Select value={rtbSignals[sig] ?? ""} onValueChange={(v) => setRtbSignals((s) => ({ ...s, [sig]: v as Trend }))}>
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stable">Stable</SelectItem>
                          <SelectItem value="rising">Rising</SelectItem>
                          <SelectItem value="falling">Falling</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ),
                )}
                <p className="text-xs text-muted-foreground">
                  Observed no-bid rate this window: {fmtPct(data.totals.payoutDistribution?.zeroRate ?? null)} · median
                  payout {fmtMoney(data.totals.payoutDistribution?.median ?? null)} · top 10% revenue share{" "}
                  {fmtPct(data.totals.payoutDistribution?.top10RevenueShare ?? null)}.
                </p>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Resolution</Label>
                  <Select value={rtbSide} onValueChange={(v) => setRtbSide(v as any)}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Traffic-side or demand-side" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="traffic">Traffic-side — our ads</SelectItem>
                      <SelectItem value="demand">Demand-side — routing (recommend only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {rtbSide === "demand" && (
                  <Notice tone="warn" title="Demand-side">
                    This routes to routing and the buyer waterfall, which are the client's decisions. Surface a
                    recommendation with the evidence — no media action fixes it.
                  </Notice>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2 · 1 — Downstream (answer first)</CardTitle>
              <CardDescription>
                Billable rate {fmtPct(data.totals.billableRate)} · connection rate {fmtPct(data.totals.connectionRate)}.
                Skipping this step is the expensive error.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ["mediaFlat", "Media metrics (CTR, CPM, frequency) are flat"],
                ["billableMoved", "Billable rate moved"],
                ["connectionMoved", "Connection rate moved"],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={(downstream as any)[k]}
                    onCheckedChange={(v) => setDownstream((d) => ({ ...d, [k]: !!v }))}
                  />
                  {label}
                </label>
              ))}
              <Textarea
                placeholder="No-bid reasons, buyer status, anything else downstream"
                value={downstream.note}
                onChange={(e) => setDownstream((d) => ({ ...d, note: e.target.value }))}
              />
              {!downstreamAnswered && <Button onClick={() => setDownstreamAnswered(true)}>Record downstream answer</Button>}
              {downstreamAnswered && notAMediaProblem && (
                <Notice tone="danger" title="Stop — this is not a media problem">
                  Media metrics are flat while billable or connection rate moved. No ad change fixes it. The tree stops
                  here: take it downstream (routing, buyer, qualification) before touching anything in the account.
                </Notice>
              )}
            </CardContent>
          </Card>

          {downstreamAnswered && !notAMediaProblem && (
            <>
              <DiagCard title="2 — Saturation" hint="CPM up, frequency up, reach flattening → expand the audience." value={saturation} onChange={setSaturation} />
              <DiagCard title="3 — Fatigue" hint="Frequency up, CTR down, CPM flat → refresh creative on the same angle." value={fatigue} onChange={setFatigue} />
              <DiagCard title="4 — Structural" hint="Tracking, attribution, delivery." value={structural} onChange={setStructural} />
            </>
          )}

          {downstreamAnswered && <Button onClick={() => complete(2)}>Diagnosis recorded — continue</Button>}
        </div>
      )}

      {/* ---------------- Step 3 ---------------- */}
      {step === 3 && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 3 — Forced disposition</CardTitle>
            <CardDescription>
              Every ad set and every ad gets keep / cut / hold. Nothing carries forward by default. A suggested verdict is
              pre-filled from the cut rules with its evidence — it is never applied for you.{" "}
              <strong>{undecided} undecided {undecided === 1 ? "entity" : "entities"} remaining.</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {entities.map(({ level, row }) => {
              const key = `${level}:${row.groupKey}`;
              const sug = suggestions[key];
              const d =
                dispositions[key] ??
                ({ verdict: "", reason: "", awaiting: "", reviewDate: "", suggested: sug?.verdict ?? "", suggestedReason: sug?.reason ?? "" } as DispositionState);
              const set = (patch: Partial<DispositionState>) =>
                setDispositions((s) => ({ ...s, [key]: { ...d, ...patch } }));
              return (
                <div key={key} className={`rounded-lg border p-3 ${rowClass(row.confidenceState)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <Badge variant="outline" className="mr-2">{level}</Badge>
                        {row.entity_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Spend {fmtMoney(row.spend)} · calls {fmtNum(row.calls)} · billable {fmtNum(row.billable_calls)} ·
                        margin/call {fmtMoney(row.marginPerCall)} · margin {fmtPct(row.marginPct)} · cost/billable{" "}
                        {fmtMoney(row.costPerBillableCall)}
                      </p>
                    </div>
                    <ConfidenceBadge state={row.confidenceState} />
                  </div>
                  <p className="mt-2 text-xs">
                    <span className="font-medium">Suggested: {sug?.verdict ?? "—"}.</span>{" "}
                    <span className="text-muted-foreground">{sug?.reason}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {(["keep", "cut", "hold"] as const).map((v) => (
                      <Button
                        key={v}
                        size="sm"
                        variant={d.verdict === v ? "default" : "outline"}
                        onClick={() => set({ verdict: v, reason: d.reason || sug?.reason || "" })}
                      >
                        {v}
                      </Button>
                    ))}
                  </div>
                  {d.verdict === "hold" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="Evidence awaited (required)"
                        value={d.awaiting}
                        onChange={(e) => set({ awaiting: e.target.value })}
                      />
                      <Input type="date" value={d.reviewDate} onChange={(e) => set({ reviewDate: e.target.value })} />
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        A hold means keep spending at the current level, do not expand, do not cut — and it must name the
                        evidence awaited and the date it arrives. The database enforces this too.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <Button disabled={undecided > 0 || entities.length === 0} onClick={() => complete(3)}>
              {undecided > 0 ? `${undecided} still undecided` : "All entities decided — continue"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 4 ---------------- */}
      {step === 4 && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 4 — Graduation</CardTitle>
            <CardDescription>
              Three gates, each pass or fail. Two of three is not a pass — the failed gate is named and graduation is not
              offered.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Angle / ad</TableHead>
                  <TableHead>Clears breakeven with margin to spare</TableHead>
                  <TableHead>Top of its group on margin per call</TableHead>
                  <TableHead>At or above min_calls</TableHead>
                  <TableHead>Graduate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adRows.map((r) => {
                  const gates = decisions.graduationGates(r, { level: "ad", peers: peersOf(r) }, ctx!);
                  const { g1, g2, g3, passes: pass } = gates;
                  return (
                    <TableRow key={r.groupKey} className={rowClass(r.confidenceState)}>
                      <TableCell className="max-w-[18rem] truncate font-medium">{r.entity_name}</TableCell>
                      <TableCell><Gate ok={g1} detail={gates.detail.margin} /></TableCell>
                      <TableCell><Gate ok={g2} detail={gates.detail.groupLeader} /></TableCell>
                      <TableCell><Gate ok={g3} detail={gates.detail.volume} /></TableCell>
                      <TableCell>
                        {pass ? (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={!!graduated[r.groupKey]}
                              onCheckedChange={(v) => setGraduated((s) => ({ ...s, [r.groupKey]: !!v }))}
                            />
                            Move to ABO
                          </label>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not offered — failed gate{gates.failed.length > 1 ? "s" : ""}:{" "}
                            {gates.failed
                              .map((f) => (f === "volume" ? "volume (below min_calls)" : f === "margin" ? "margin" : "group leader"))
                              .join(", ")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Button className="mt-4" onClick={() => complete(4)}>Graduation recorded — continue</Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 5 ---------------- */}
      {step === 5 && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 5 — Scale</CardTitle>
            <CardDescription>
              All four conditions must hold, and a step is {STEP_MIN_PCT}–{STEP_MAX_PCT}%. Judge the marginal return on
              the last increase, not blended ROAS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {entities
              .filter(({ level, row }) => dispositions[`${level}:${row.groupKey}`]?.verdict === "keep")
              .map(({ level, row }) => {
                const key = `${level}:${row.groupKey}`;
                const c = scaleChecks[key] ?? { held: false, capacity: false, stableMix: false, stepPct: STEP_MIN_PCT };
                const set = (patch: Partial<typeof c>) => setScaleChecks((s) => ({ ...s, [key]: { ...c, ...patch } }));
                const target = ctx!.targetMargin;
                const dist = row.payoutDistribution;
                const q = decisions.scaleQualification(row, ctx!, c);
                const { marginOk, callsOk, outlierCarried, eligible } = q;
                return (
                  <div key={key} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{row.entity_name}</p>
                    <ul className="mt-1 space-y-1">
                      <li><Gate ok={marginOk} detail={`Margin ${fmtPct(row.marginPct)} vs target ${fmtPct(target)}`} /></li>
                      <li><Gate ok={callsOk} detail={`${fmtNum(row.billable_calls)} billable of ${fmtNum(data.thresholds.minCalls)}`} /></li>
                      <li>
                        <label className="flex items-center gap-2">
                          <Checkbox checked={c.held} onCheckedChange={(v) => set({ held: !!v })} />
                          Held across two consecutive decision windows
                        </label>
                      </li>
                      <li>
                        <label className="flex items-center gap-2">
                          <Checkbox checked={c.capacity} onCheckedChange={(v) => set({ capacity: !!v })} />
                          Buyer has capacity headroom
                        </label>
                      </li>
                      {rtb && (
                        <>
                          <li>
                            <label className="flex items-center gap-2">
                              <Checkbox checked={c.stableMix} onCheckedChange={(v) => set({ stableMix: !!v })} />
                              No-bid rate and buyer mix stable
                            </label>
                          </li>
                          <li>
                            <Gate
                              ok={!outlierCarried}
                              detail={`Top 10% of calls carry ${fmtPct(dist?.top10RevenueShare ?? null)} of revenue — distribution must not be carried by outliers`}
                            />
                          </li>
                        </>
                      )}
                    </ul>
                    <div className="mt-2 flex items-center gap-2">
                      <Label className="text-sm">Step %</Label>
                      <Input
                        type="number"
                        min={STEP_MIN_PCT}
                        max={STEP_MAX_PCT}
                        className="w-24"
                        value={c.stepPct}
                        onChange={(e) => set({ stepPct: Number(e.target.value) })}
                      />
                      {(c.stepPct < STEP_MIN_PCT || c.stepPct > STEP_MAX_PCT) && (
                        <span className="text-xs text-destructive">
                          A step is {STEP_MIN_PCT}–{STEP_MAX_PCT}%.
                        </span>
                      )}
                      {!eligible && <span className="text-xs text-muted-foreground">Not eligible to scale yet.</span>}
                    </div>
                  </div>
                );
              })}

            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Marginal return on the previous increase</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                {(["baseSpend", "baseRevenue", "newSpend", "newRevenue"] as const).map((f) => (
                  <div key={f} className="space-y-1">
                    <Label className="text-xs capitalize">{f.replace(/([A-Z])/g, " $1")}</Label>
                    <Input
                      type="number"
                      value={(marginal as any)[f]}
                      onChange={(e) => setMarginal((m) => ({ ...m, [f]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              {marginalResult ? (
                <p className="mt-2 text-sm">
                  Added spend {fmtMoney(marginalResult.addedSpend)} · added revenue {fmtMoney(marginalResult.addedRevenue)} ·{" "}
                  <strong>marginal ROAS {fmtNum(marginalResult.marginalRoas, 2)}</strong> beside blended ROAS{" "}
                  {fmtNum(marginalResult.blendedRoas, 2)}.
                  {marginalResult.marginalRoas !== null &&
                    marginalResult.blendedRoas !== null &&
                    marginalResult.marginalRoas < marginalResult.blendedRoas && (
                      <span className="text-destructive">
                        {" "}The blend still looks fine while the increment did not clear the bar — do not grant another
                        increase on the blended number.
                      </span>
                    )}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">— no step to judge until added spend is above zero.</p>
              )}
            </div>
            <Button onClick={() => complete(5)}>Scale decisions recorded — continue</Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 6 ---------------- */}
      {step === 6 && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 6 — Budget reallocation</CardTitle>
            <CardDescription>
              Move budget from cut entities into proven ones. The split is 100% testing until an angle has graduated, then
              80/20.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Budget freed by cut ad sets in this window: <strong>{fmtMoney(cutSpend)}</strong>.
            </p>
            <p>
              Test / scale split: <strong>{anyGraduated ? "80% testing / 20% scale" : "100% testing / 0% scale"}</strong>{" "}
              — {anyGraduated ? "an angle has graduated." : "no angle has graduated yet."}
            </p>
            <Textarea
              placeholder="Where the freed budget goes and why"
              value={reallocationNote}
              onChange={(e) => setReallocationNote(e.target.value)}
            />
            <Button onClick={() => complete(6)}>Reallocation planned — continue</Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 7 ---------------- */}
      {step === 7 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 7 — Fragmentation check</CardTitle>
            <CardDescription>
              Expected weekly count of this account&apos;s Meta optimisation event ÷ active ad sets, against the
              learning-phase floor of {FRAG_FLOOR}. Meta&apos;s learning phase counts its own event — billable calls are
              never substituted for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="rounded-md border bg-muted/40 p-3">
              <span className="font-medium">Event counted: </span>
              {metaEvent ?? "not recorded"}
              {billableDiffersFromMetaEvent && (
                <span className="text-muted-foreground">
                  {" "}
                  — this is not the billable definition on the Economics record. The two counts are not the same thing,
                  and this check is about Meta&apos;s learning phase only.
                </span>
              )}
            </p>
            {fragBlocked ? (
              <Notice tone="warn" title="Fragmentation check did not run">
                {fragBlocked} Billable calls are not substituted — re-run intake and record the Meta conversion event
                and its expected weekly count.
              </Notice>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Active ad sets</Label>
                    <Input type="number" className="w-28" value={activeAdSets} onChange={(e) => setActiveAdSets(e.target.value)} />
                  </div>
                  <p className="text-muted-foreground">
                    Expected &quot;{metaEvent}&quot; events / week: {fmtNum(expectedMetaEvents)}
                  </p>
                </div>
                <p>
                  {fmtNum(expectedMetaEvents)} ÷ {activeAdSets || "—"} ={" "}
                  <strong>{fmtNum(frag.perAdSet, 1)}</strong> per ad set —{" "}
                  {frag.passes ? `clears the floor of ${FRAG_FLOOR}.` : `below the floor of ${FRAG_FLOOR}.`}
                </p>
              </>
            )}
            {!fragBlocked && !frag.passes && activeAdSets && (
              <Notice tone="warn" title="The structure will not exit learning phase">
                Volume is split across ad sets that will each learn nothing. Consolidate before scaling.
              </Notice>
            )}
            <Button onClick={() => complete(7)}>Fragmentation checked — continue</Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 8 ---------------- */}
      {step === 8 && data && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proposed actions — approve or reject</CardTitle>
              <CardDescription>
                Each carries its evidence and confidence state. Approving records the decision and writes the change log.
                Nothing executes: no ad platform is called and no campaign is changed from this screen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {entities.map(({ level, row }) => {
                const d = dispositions[`${level}:${row.groupKey}`];
                return (
                  <div key={`${level}:${row.groupKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                    <span>
                      <Badge variant="outline" className="mr-2">{d?.verdict}</Badge>
                      <span className="font-medium">{row.entity_name}</span>{" "}
                      <span className="text-muted-foreground">— {d?.reason}</span>
                    </span>
                    <ConfidenceBadge state={row.confidenceState} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 8 — Log everything</CardTitle>
              <CardDescription>
                What changed, why, what is expected, and a review date (required). A routing change is a changepoint — it
                invalidates every margin comparison spanning it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {logs.map((l, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <Input
                    placeholder="What changed"
                    value={l.description}
                    onChange={(e) => setLogs((s) => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  />
                  <Input
                    placeholder="Why"
                    value={l.why}
                    onChange={(e) => setLogs((s) => s.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)))}
                  />
                  <Input
                    placeholder="Expected result"
                    value={l.expected}
                    onChange={(e) => setLogs((s) => s.map((x, j) => (j === i ? { ...x, expected: e.target.value } : x)))}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Review date (required)</Label>
                      <Input
                        type="date"
                        value={l.reviewDate}
                        onChange={(e) => setLogs((s) => s.map((x, j) => (j === i ? { ...x, reviewDate: e.target.value } : x)))}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={l.changepoint}
                        onCheckedChange={(v) => setLogs((s) => s.map((x, j) => (j === i ? { ...x, changepoint: !!v } : x)))}
                      />
                      Routing change — mark as changepoint
                    </label>
                  </div>
                  {l.changepoint && (
                    <Notice tone="warn" title="Changepoint">
                      This invalidates every margin comparison spanning it. Comparisons must start after this date.
                    </Notice>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogs((s) => [...s, { description: "", why: "", expected: "", reviewDate: "", changepoint: false }])}
              >
                Add another change
              </Button>
              <div>
                <Button onClick={saveEverything} disabled={saving}>
                  {saving ? "Saving…" : "Approve and save the review"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
      <p className="font-semibold">{v}</p>
    </div>
  );
}

function Gate({ ok, detail }: { ok: boolean; detail: string }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <Badge variant={ok ? "outline" : "destructive"} className={ok ? "border-emerald-400 text-emerald-700 dark:text-emerald-400" : ""}>
        {ok ? "pass" : "fail"}
      </Badge>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}

function DiagCard({ title, hint, value, onChange }: { title: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Step 2 · {title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="What you observed" />
      </CardContent>
    </Card>
  );
}
