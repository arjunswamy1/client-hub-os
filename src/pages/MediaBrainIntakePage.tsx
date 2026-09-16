/**
 * Media Brain — Layer 0 INTAKE
 * Route: /media-brain/:clientId/intake
 *
 * Follows docs/media-brain/02_Client_Intake.md exactly: Part A asks everything
 * first, Part B computes and shows the work, Part C saves Economics + Instance.
 * Nothing computes until Part A is complete — half-answered intake produces
 * thresholds that look authoritative and aren't.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import * as engine from "@/lib/mediaBrain/engine";
import { Notice } from "@/components/mediaBrain/shared";
import { BillableDefinitionCheck, type BillableGovernance } from "@/components/mediaBrain/BillableDefinitionCheck";
import { ComputedRevenueSensitivity } from "@/components/mediaBrain/ComputedRevenueSensitivity";
import { RtbObservedTermsPanel, type RtbMeasurement } from "@/components/mediaBrain/RtbObservedTermsPanel";

/**
 * The window the intake sensitivity swing is measured over — stated explicitly,
 * never inferred (§12). Last 30 days, ending today.
 */
const SENSITIVITY_END = new Date().toISOString().slice(0, 10);
const SENSITIVITY_START = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

const STEPS = [
  { key: "a1", title: "A1 · Client and accounts" },
  { key: "a2", title: "A2 · Payout economics" },
  { key: "a3", title: "A3 · Cost and budget" },
  { key: "a4", title: "A4 · Funnel structure" },
  { key: "a5", title: "A5 · Buyer hours" },
  { key: "a6", title: "A6 · Campaign state" },
  { key: "a7", title: "A7 · Reporting" },
  { key: "a8", title: "A8 · Margin targets" },
  { key: "b", title: "Part B · Compute" },
  { key: "c", title: "Part C · Save" },
] as const;

const TRACKING_PLATFORMS = [
  { value: "ringba", label: "Ringba" },
  { value: "ringba_4js", label: "Ringba (4Js)" },
  { value: "ringfuel", label: "RingFuel" },
  { value: "moja", label: "Moja" },
  { value: "cannaball", label: "CallGrid (Cannaball)" },
  { value: "jacuzzi", label: "Jacuzzi delivery" },
  { value: "other", label: "Other" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type NumField =
  | "payout"
  | "billable_min_duration_seconds"
  | "bid_floor"
  | "bid_ceiling"
  | "avg_bid"
  | "duration_min_seconds"
  | "duration_max_seconds"
  | "daily_budget"
  | "expected_cost_per_call"
  | "expected_cost_per_billable_call"
  | "steps_to_live_person"
  | "planned_ad_sets"
  | "expected_weekly_meta_events"
  | "target_margin_pct"
  | "min_margin_pct"
  | "actionable_gap_pct";

interface FormState {
  vertical: string;
  /**
   * The client_verticals key this intake belongs to. Economics rows are unique
   * per (client, vertical), with a NULL vertical_id meaning "client default" —
   * so a named vertical MUST carry its id, or the second vertical collides with
   * the first on the client-default row.
   */
  vertical_id: string | null;
  platforms: string;
  ad_account_ids: string;
  tracking_platform: string;
  /**
   * The event this account's Meta ad sets optimise toward. The fragmentation
   * check counts THIS, never billable calls — Meta's learning phase counts its
   * own optimisation event (§4).
   */
  meta_conversion_event: string;
  meta_conversion_event_unknown: boolean;
  payout_mode: "static" | "rtb";
  rtb_live: boolean;
  observed_rpc: string;
  billable_filters: string;
  funnel_type: "landing_page" | "click_to_call";
  funnel_cta: string;
  has_ivr: boolean;
  buyer_hours: Record<string, string>;
  campaign_state: "new_build" | "existing";
  existing_structure_notes: string;
  known_problems: string;
  reporting_format: string;
  reporting_cadence: string;
  quoted_avg_bid_note: string;
  nums: Record<NumField, string>;
  unknown: Record<NumField, boolean>;
}

const emptyNums = (): Record<NumField, string> => ({
  payout: "",
  billable_min_duration_seconds: "",
  bid_floor: "",
  bid_ceiling: "",
  avg_bid: "",
  duration_min_seconds: "",
  duration_max_seconds: "",
  daily_budget: "",
  expected_cost_per_call: "",
  expected_cost_per_billable_call: "",
  steps_to_live_person: "",
  planned_ad_sets: "",
  expected_weekly_meta_events: "",
  // Pre-filled with the framework defaults (§16). A client may state otherwise.
  target_margin_pct: String(engine.DEFAULTS.targetMargin * 100),
  min_margin_pct: String(engine.DEFAULTS.minMargin * 100),
  actionable_gap_pct: String(engine.DEFAULTS.actionableGap * 100),
});

const emptyUnknown = (): Record<NumField, boolean> =>
  Object.fromEntries(Object.keys(emptyNums()).map((k) => [k, false])) as Record<NumField, boolean>;

const initialForm: FormState = {
  vertical: "",
  vertical_id: null,
  platforms: "",
  ad_account_ids: "",
  tracking_platform: "",
  meta_conversion_event: "",
  meta_conversion_event_unknown: false,
  payout_mode: "static",
  rtb_live: false,
  observed_rpc: "",
  billable_filters: "",
  funnel_type: "landing_page",
  funnel_cta: "",
  has_ivr: false,
  buyer_hours: {},
  campaign_state: "new_build",
  existing_structure_notes: "",
  known_problems: "",
  reporting_format: "",
  reporting_cadence: "",
  quoted_avg_bid_note: "",
  nums: emptyNums(),
  unknown: emptyUnknown(),
};

function toList(v: string): string[] | null {
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function fmtMoney(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtNum(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function MediaBrainIntakePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isAccountManager, teamMember } = useAuth();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /* 3a — the billable definition is validated against data before anything computes. */
  const [billableGovernance, setBillableGovernance] = useState<BillableGovernance | null>(null);
  const [billableCheckBlocking, setBillableCheckBlocking] = useState(false);
  const handleBlockingChange = useCallback((b: boolean) => setBillableCheckBlocking(b), []);


  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["mb-intake-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const { data: existingInstance } = useQuery({
    queryKey: ["mb-intake-instance", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_brain_instances")
        .select("*")
        .eq("client_id", clientId!)
        .eq("is_stale", false)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const { data: verticals } = useQuery({
    queryKey: ["mb-intake-verticals", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_verticals")
        .select("vertical_id, label, position")
        .eq("client_id", clientId!)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!clientId,
  });

  const allowed = isAdmin || isAccountManager;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setNum = (field: NumField, value: string) =>
    setForm((f) => ({ ...f, nums: { ...f.nums, [field]: value } }));

  const toggleUnknown = (field: NumField) =>
    setForm((f) => ({
      ...f,
      unknown: { ...f.unknown, [field]: !f.unknown[field] },
      nums: { ...f.nums, [field]: f.unknown[field] ? f.nums[field] : "" },
    }));

  /**
   * RTB only: fill the payout fields from what the tracking platform actually
   * paid over the confirmed window, and keep the provenance line with them.
   * Only measured values are written; a null stays a null (nothing is inferred).
   */
  const applyRtbMeasurement = useCallback((m: RtbMeasurement) => {
    const t = m.terms;
    setForm((f) => {
      const nums = { ...f.nums };
      const unknown = { ...f.unknown };
      const put = (field: NumField, value: number | null) => {
        if (value === null) return;
        nums[field] = String(value);
        unknown[field] = false;
      };
      put("bid_floor", t.bidFloor);
      put("bid_ceiling", t.bidCeiling);
      put("avg_bid", t.avgWinningBid);
      put("duration_min_seconds", t.paidDurationMinSeconds);
      put("duration_max_seconds", t.paidDurationMaxSeconds);
      put("billable_min_duration_seconds", t.minDurationWithPayout);
      return {
        ...f,
        nums,
        unknown,
        rtb_live: true,
        observed_rpc: t.observedRpc === null ? f.observed_rpc : String(t.observedRpc),
        quoted_avg_bid_note: [f.quoted_avg_bid_note.trim(), m.note].filter(Boolean).join("\n"),
      };
    });
    toast.success(`Measured terms applied from ${m.sourceLabel}, ${m.start} to ${m.end}.`);
  }, []);

  const numVal = (field: NumField): number | null => {
    if (form.unknown[field]) return null;
    const raw = form.nums[field];
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const unknownFields = useMemo(
    () => (Object.keys(form.unknown) as NumField[]).filter((k) => form.unknown[k]),
    [form.unknown],
  );

  /** Which questions in Part A are still unanswered. An UNKNOWN counts as answered. */
  const missing = useMemo(() => {
    const m: string[] = [];
    const need = (field: NumField, label: string) => {
      if (!form.unknown[field] && form.nums[field] === "") m.push(label);
    };
    if (!form.vertical.trim()) m.push("Vertical");
    if (!form.platforms.trim()) m.push("Platforms");
    if (!form.ad_account_ids.trim()) m.push("Ad account ID(s)");
    if (!form.tracking_platform) m.push("Call tracking platform");
    if (!form.meta_conversion_event.trim() && !form.meta_conversion_event_unknown)
      m.push("Meta conversion event this account optimises toward");
    if (form.payout_mode === "static") {
      need("payout", "Payout per billable call");
      need("billable_min_duration_seconds", "Billable duration threshold");
    } else {
      need("bid_floor", "Bid floor");
      need("bid_ceiling", "Bid ceiling");
      need("avg_bid", "Average winning bid");
      need("duration_min_seconds", "Duration range minimum");
      need("duration_max_seconds", "Duration range maximum");
      need("billable_min_duration_seconds", "Minimum duration for any payout");
    }
    need("daily_budget", "Daily budget");
    need("expected_cost_per_call", "Cost per call");
    need("expected_cost_per_billable_call", "Cost per billable call");
    if (form.funnel_type === "landing_page" && !form.funnel_cta.trim()) m.push("Landing page call-to-action");
    need("steps_to_live_person", "Steps to a live person");
    if (Object.keys(form.buyer_hours).length === 0) m.push("Buyer hours");
    if (form.campaign_state === "existing" && !form.existing_structure_notes.trim())
      m.push("Existing structure, spend and time live");
    if (!form.reporting_format.trim()) m.push("Reporting format");
    if (!form.reporting_cadence.trim()) m.push("Reporting cadence");
    need("planned_ad_sets", "Planned ad sets (for the fragmentation check)");
    need("expected_weekly_meta_events", "Expected weekly count of that Meta conversion event");
    need("target_margin_pct", "Target margin %");
    need("min_margin_pct", "Minimum margin % (the floor)");
    need("actionable_gap_pct", "Actionable gap % between angles");
    return m;
  }, [form]);

  const partAComplete = missing.length === 0;

  /* ---------------- Part B — compute, showing the work ---------------- */
  const computed = useMemo(() => {
    if (!partAComplete) return null;
    const mode = form.payout_mode;
    const payout = numVal("payout");
    const avgBid = numVal("avg_bid");
    const observedRpc = form.observed_rpc === "" ? null : Number(form.observed_rpc);
    const costPerBillable = numVal("expected_cost_per_billable_call");
    const costPerCall = numVal("expected_cost_per_call");
    const dailyBudget = numVal("daily_budget");
    const plannedAdSets = numVal("planned_ad_sets");

    // Stated by the client, pre-filled with the framework default. An UNKNOWN
    // stays null and blocks everything that depends on it — never substituted.
    const pctVal = (f: NumField) => {
      const v = numVal(f);
      return v === null ? null : v / 100;
    };
    const targetMargin = pctVal("target_margin_pct");
    const minMargin = pctVal("min_margin_pct");
    const actionableGap = pctVal("actionable_gap_pct");

    const baselineRpc =
      mode === "static" ? payout : form.rtb_live && observedRpc !== null ? observedRpc : avgBid;
    const baselineRpcSource =
      mode === "static"
        ? "Static: baseline RPC = payout"
        : form.rtb_live && observedRpc !== null
          ? "RTB, campaign live: observed RPC used over the quoted bid"
          : "RTB, not live: stated average bid used";

    const allowable = engine.allowableCostPerCall(baselineRpc, targetMargin);
    const kill = engine.killThreshold(mode, payout, avgBid);
    const minCallsValue = engine.minCalls(actionableGap, mode);
    const weeklyBudget = dailyBudget === null ? null : dailyBudget * 7;
    const expectedBillablePerWeek =
      weeklyBudget !== null && costPerBillable !== null && costPerBillable > 0
        ? weeklyBudget / costPerBillable
        : null;
    const tier = engine.volumeTier(expectedBillablePerWeek);
    const perAngle = engine.costPerAngle(minCallsValue, costPerBillable);
    const testBudgetPct = 1; // 100% at launch; 80/20 once an angle has graduated.
    const testBudget = weeklyBudget === null ? null : weeklyBudget * testBudgetPct;
    const angles = engine.maxAngles(testBudget, perAngle);
    /**
     * §4: the fragmentation numerator is the account's META OPTIMISATION EVENT,
     * not the billable-call count. Substituting one for the other compares
     * Meta's learning-phase counter against a different event entirely. Where
     * the event is UNKNOWN the check does not run.
     */
    const metaConversionEvent = form.meta_conversion_event_unknown
      ? null
      : form.meta_conversion_event.trim() || null;
    const expectedMetaEventsPerWeek = numVal("expected_weekly_meta_events");
    const fragmentationBlockedReason =
      metaConversionEvent === null
        ? "Cannot run: the Meta conversion event for this account is not recorded."
        : expectedMetaEventsPerWeek === null
          ? `Cannot run: the expected weekly count of "${metaConversionEvent}" is not recorded.`
          : null;
    const fragmentation = fragmentationBlockedReason
      ? { perAdSet: null as number | null, passes: false }
      : engine.fragmentationCheck(expectedMetaEventsPerWeek, plannedAdSets);

    const flags: { level: "warn" | "info"; text: string }[] = [];
    if (angles !== null && angles < 3) {
      flags.push({
        level: "warn",
        text: `Max angles testable is ${angles} — under 3. Options: test fewer angles properly, extend the test window, or raise the test budget. Five underpowered tests teach less than one funded one.`,
      });
    }
    if (fragmentationBlockedReason) {
      flags.push({ level: "warn", text: `Fragmentation check — ${fragmentationBlockedReason} Billable calls are NOT substituted: Meta's learning phase counts its own optimisation event, so the two numbers are not the same thing.` });
    } else if (fragmentation.perAdSet !== null && !fragmentation.passes) {
      flags.push({
        level: "warn",
        text: `Fragmentation check: ${fmtNum(fragmentation.perAdSet)} expected weekly "${metaConversionEvent}" events per ad set against a floor of ${engine.DEFAULTS.fragmentationFloor}. The planned structure will not exit learning phase — consolidate ad sets.`,
      });
    }
    if (mode === "rtb" && form.rtb_live && observedRpc !== null && avgBid !== null && avgBid > 0) {
      const gap = Math.abs(observedRpc - avgBid) / avgBid;
      if (gap >= 0.15) {
        flags.push({
          level: "warn",
          text: `Observed RPC ${fmtMoney(observedRpc)} differs from the quoted average bid ${fmtMoney(avgBid)} by ${(gap * 100).toFixed(0)}%. Observed values govern; raise the discrepancy with the client rather than reconciling it silently.`,
        });
      }
    }
    flags.push({
      level: "info",
      text: "Buyer count, revenue concentration and capacity are computed from call data on the first pull, not asked here. Concentration risk is flagged there if the top buyer carries a large revenue share.",
    });
    for (const f of unknownFields) {
      const blocked: Record<string, string> = {
        payout: "kill threshold, baseline RPC, allowable cost per call",
        avg_bid: "kill threshold and baseline RPC under RTB",
        billable_min_duration_seconds: "every billable-denominated metric — no call can be marked billable",
        expected_cost_per_billable_call: "cost per angle, max angles, expected billable calls per week, volume tier",
        expected_cost_per_call: "expected cost comparisons",
        target_margin_pct: "allowable cost per call, the margin bands, and every scale decision",
        min_margin_pct: "the margin floor and the fragile/below-the-floor band",
        actionable_gap_pct: "{min_calls}, cost per angle, max angles — the whole confidence bar",
        daily_budget: "expected billable calls per week, volume tier, test budget, max angles",
        planned_ad_sets: "the fragmentation check",
        expected_weekly_meta_events: "the fragmentation check — billable calls are never substituted for the Meta optimisation event",
      };
      flags.push({
        level: "warn",
        text: `UNKNOWN: ${f}. Blocked until supplied — ${blocked[f] ?? "any computation depending on it"}. No value has been assumed in its place.`,
      });
    }

    return {
      mode,
      targetMargin,
      minMargin,
      actionableGap,
      baselineRpc,
      baselineRpcSource,
      allowable,
      kill,
      minCallsValue,
      weeklyBudget,
      expectedBillablePerWeek,
      tier,
      perAngle,
      testBudgetPct,
      testBudget,
      angles,
      fragmentation,
      fragmentationBlockedReason,
      metaConversionEvent,
      expectedMetaEventsPerWeek,
      costPerCall,
      costPerBillable,
      payout,
      avgBid,
      flags,
    };
  }, [partAComplete, form, unknownFields]);

  /* ---------------- Part C — save ---------------- */
  /**
   * §9: the Instance thresholds anchor on the client's own margin targets and
   * actionable gap. A missing one cannot be defaulted, so the save is blocked
   * with those fields named rather than failing in the database.
   */
  const saveBlockers = useMemo(() => {
    const b: string[] = [];
    if (numVal("target_margin_pct") === null) b.push("Target margin %");
    if (numVal("min_margin_pct") === null) b.push("Minimum margin % (the floor)");
    if (numVal("actionable_gap_pct") === null) b.push("Actionable gap % between angles");
    return b;
  }, [form]);

  const handleSave = async () => {
    if (!clientId || !computed || billableCheckBlocking) return;
    if (saveBlockers.length) {
      toast.error(`These must carry a real number before the record can be saved: ${saveBlockers.join(", ")}.`);
      return;
    }
    setSaving(true);
    try {
      if (existingInstance) {
        await supabase
          .from("media_brain_instances")
          .update({ is_stale: true })
          .eq("id", existingInstance.id);
      }

      /* One Economics row per (client, vertical) — a re-run replaces it in place
         instead of colliding with the row the previous run wrote. */
      const existingEcoQuery = supabase
        .from("media_brain_economics")
        .select("id")
        .eq("client_id", clientId);
      const { data: existingEco, error: existingEcoErr } = await (form.vertical_id
        ? existingEcoQuery.eq("vertical_id", form.vertical_id)
        : existingEcoQuery.is("vertical_id", null)
      ).maybeSingle();
      if (existingEcoErr) throw existingEcoErr;

      const economicsRow = {
          client_id: clientId,
          vertical: form.vertical.trim() || null,
          vertical_id: form.vertical_id,
          platforms: toList(form.platforms),
          ad_account_ids: toList(form.ad_account_ids),
          tracking_platform: form.tracking_platform,
          payout_mode: form.payout_mode,
          payout: numVal("payout"),
          billable_min_duration_seconds: numVal("billable_min_duration_seconds"),
          billable_filters:
            form.billable_filters.trim() || billableGovernance
              ? {
                  ...(form.billable_filters.trim() ? { notes: form.billable_filters.trim() } : {}),
                  ...(billableGovernance ? { governing_definition: billableGovernance } : {}),
                }
              : null,
          bid_floor: numVal("bid_floor"),
          bid_ceiling: numVal("bid_ceiling"),
          avg_bid: numVal("avg_bid"),
          duration_min_seconds: numVal("duration_min_seconds"),
          duration_max_seconds: numVal("duration_max_seconds"),
          daily_budget: numVal("daily_budget"),
          expected_cost_per_call: numVal("expected_cost_per_call"),
          expected_cost_per_billable_call: numVal("expected_cost_per_billable_call"),
          funnel_type: form.funnel_type,
          funnel_cta: form.funnel_cta.trim() || null,
          has_ivr: form.has_ivr,
          steps_to_live_person: numVal("steps_to_live_person"),
          buyer_hours: form.buyer_hours,
          reporting_format: form.reporting_format.trim() || null,
          reporting_cadence: form.reporting_cadence.trim() || null,
          campaign_state: form.campaign_state,
          existing_structure_notes: form.existing_structure_notes.trim() || null,
          known_problems: form.known_problems.trim() || null,
          routing_mode: "recommend_only",
          unknown_fields: unknownFields.length ? unknownFields : null,
          last_reviewed_at: new Date().toISOString(),
      };

      const { data: eco, error: ecoErr } = existingEco
        ? await supabase
            .from("media_brain_economics")
            .update(economicsRow)
            .eq("id", existingEco.id)
            .select("id")
            .single()
        : await supabase.from("media_brain_economics").insert(economicsRow).select("id").single();
      if (ecoErr) throw ecoErr;

      const { error: instErr } = await supabase.from("media_brain_instances").insert({
        client_id: clientId,
        economics_id: eco.id,
        target_margin: computed.targetMargin,
        min_margin: computed.minMargin,
        actionable_gap: computed.actionableGap,
        baseline_rpc: computed.baselineRpc,
        allowable_cost_per_call: computed.allowable,
        kill_threshold: computed.kill,
        min_calls: computed.minCallsValue,
        expected_billable_calls_per_week: computed.expectedBillablePerWeek,
        meta_conversion_event: computed.metaConversionEvent,
        expected_meta_events_per_week: computed.expectedMetaEventsPerWeek,
        volume_tier: computed.tier?.tier ?? null,
        cut_cadence: computed.tier?.cutCadence ?? null,
        scale_cadence: computed.tier?.scaleCadence ?? null,
        cost_per_angle: computed.perAngle,
        max_angles: computed.angles,
        test_budget_pct: computed.testBudgetPct,
        lifecycle_stage: "launch",
        naming_convention: null,
        flags: computed.flags,
        computed_at: new Date().toISOString(),
        is_stale: false,
      });
      if (instErr) {
        /* Never leave an Economics row with no Instance behind it — that row would
           block the next save and stands for a threshold set that never computed. */
        if (!existingEco) await supabase.from("media_brain_economics").delete().eq("id", eco.id);
        throw instErr;
      }

      queryClient.invalidateQueries({ queryKey: ["mb-intake-instance", clientId] });
      setSaved(true);
      toast.success("Economics and Instance records saved");
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Save failed";
      toast.error(message, { duration: 12000 });
    } finally {
      setSaving(false);
    }
  };

  const handleRerun = () => {
    setForm(initialForm);
    setSaved(false);
    setStep(0);
    toast.info("Fresh intake started. Saving will mark the current instance stale.");
  };

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        You do not have access to Media Brain intake.
      </div>
    );
  }

  if (clientLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">Client not found.</div>
    );
  }

  const current = STEPS[step];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Media Brain · Layer 0</p>
          <h1 className="text-2xl font-semibold">{client.name} — Intake</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything is asked first. Nothing computes until Part A is complete.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {existingInstance && (
            <Button variant="outline" size="sm" onClick={handleRerun}>
              <RefreshCw className="mr-2 h-4 w-4" /> Re-run intake
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            Close
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(i)}
            disabled={(s.key === "b" || s.key === "c") && !partAComplete}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
              i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{current.title}</CardTitle>
          {current.key === "b" && (
            <CardDescription>Every output shown with its formula and the numbers substituted.</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {current.key === "a1" && (
            <>
              <Field
                label="Vertical"
                hint="One intake per vertical. Each vertical keeps its own payout terms; the client default applies where a vertical has none of its own."
              >
                <Select
                  value={form.vertical_id ?? (form.vertical ? "__default__" : "")}
                  onValueChange={(v) => {
                    if (v === "__default__") {
                      setForm((f) => ({ ...f, vertical_id: null, vertical: "Client default" }));
                      return;
                    }
                    const picked = verticals?.find((x) => x.vertical_id === v);
                    setForm((f) => ({ ...f, vertical_id: v, vertical: picked?.label ?? v }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select vertical" /></SelectTrigger>
                  <SelectContent>
                    {(verticals ?? []).map((v) => (
                      <SelectItem key={v.vertical_id} value={v.vertical_id}>
                        {v.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__default__">Client default (applies to every vertical)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {(verticals ?? []).length === 0 && (
                <Notice tone="warn" title="No verticals set up for this client yet">
                  Add them under the client&apos;s settings, or save this intake as the client default.
                </Notice>
              )}
              <Field label="Platforms active now, and any planned later" hint="Comma separated">
                <Input value={form.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="Meta, Roku" />
              </Field>
              <Field label="Ad account ID(s)" hint="Comma separated">
                <Input value={form.ad_account_ids} onChange={(e) => set("ad_account_ids", e.target.value)} />
              </Field>
              <Field label="Call tracking platform">
                <Select value={form.tracking_platform} onValueChange={(v) => set("tracking_platform", v)}>
                  <SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger>
                  <SelectContent>
                    {TRACKING_PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Meta conversion event this account optimises toward"
                hint='Examples: "call initiated", "call connected", "CAPI qualified call". The fragmentation check counts this event, not billable calls — Meta&apos;s learning phase counts its own optimisation event.'
              >
                <div className="flex items-center gap-3">
                  <Input
                    value={form.meta_conversion_event}
                    disabled={form.meta_conversion_event_unknown}
                    onChange={(e) => set("meta_conversion_event", e.target.value)}
                    placeholder="call initiated"
                  />
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={form.meta_conversion_event_unknown}
                      onChange={(e) => set("meta_conversion_event_unknown", e.target.checked)}
                    />
                    Unknown
                  </label>
                </div>
              </Field>
              <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Routing: recommend-only.</span> Fixed for every client. Buyer,
                floor and waterfall changes are proposed with evidence; the client executes.
              </div>
            </>
          )}

          {current.key === "a2" && (
            <>
              <Field label="Payout mode">
                <Select value={form.payout_mode} onValueChange={(v) => set("payout_mode", v as "static" | "rtb")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Static — fixed payout per billable call</SelectItem>
                    <SelectItem value="rtb">RTB — payout set by live bidding</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.payout_mode === "static" ? (
                <>
                  <Notice tone="info" title="Static: the buyer's stated terms are the record">
                    A fixed payout and a billable definition exist before a single call runs, so they are entered here
                    as the client confirmed them. Anything unconfirmed is marked Unknown, never filled with a guess.
                  </Notice>
                  <NumberField label="Payout per billable call ($)" field="payout" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  <NumberField label="Billable duration threshold (seconds)" field="billable_min_duration_seconds" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  <Field label="Product or buyer filters that affect billability">
                    <Textarea value={form.billable_filters} onChange={(e) => set("billable_filters", e.target.value)} rows={3} />
                  </Field>
                </>
              ) : (
                <>
                  <Notice tone="info" title="RTB: the terms are measured, not quoted">
                    The auction sets the payout call by call, so nobody can state one up front. Measure the terms from
                    this client&apos;s live calls below and apply them — the measurement and its window are saved with
                    the intake. Where no calls exist yet, mark each field Unknown; the Unknown switch counts as a
                    complete answer and lets the intake continue without assuming a value.
                  </Notice>
                  <RtbObservedTermsPanel
                    clientId={clientId!}
                    trackingPlatform={form.tracking_platform}
                    actionableGap={
                      form.unknown.actionable_gap_pct || form.nums.actionable_gap_pct === ""
                        ? null
                        : Number(form.nums.actionable_gap_pct) / 100
                    }
                    onApply={applyRtbMeasurement}
                  />
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Campaign currently active in the tracking platform?</p>
                      <p className="text-xs text-muted-foreground">If yes, observed values govern over quoted ones.</p>
                    </div>
                    <Switch checked={form.rtb_live} onCheckedChange={(v) => set("rtb_live", v)} />
                  </div>
                  {form.rtb_live && (
                    <Field label="Observed RPC from live data ($) — total payouts ÷ total calls">
                      <Input value={form.observed_rpc} onChange={(e) => set("observed_rpc", e.target.value)} inputMode="decimal" />
                    </Field>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField label="Bid floor ($)" field="bid_floor" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                    <NumberField label="Bid ceiling ($)" field="bid_ceiling" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  </div>
                  <NumberField label="Average winning bid ($) — measured on paid calls" field="avg_bid" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField label="Duration range minimum (seconds)" field="duration_min_seconds" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                    <NumberField label="Duration range maximum (seconds)" field="duration_max_seconds" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  </div>
                  <NumberField label="Minimum duration for any payout (seconds)" field="billable_min_duration_seconds" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
                  <Field label="Notes on the measurement, or on what the buyer quoted">
                    <Textarea value={form.quoted_avg_bid_note} onChange={(e) => set("quoted_avg_bid_note", e.target.value)} rows={2} />
                  </Field>
                </>
              )}
            </>
          )}

          {current.key === "a3" && (
            <>
              <NumberField label="Daily budget ($)" field="daily_budget" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
              <NumberField label="Known or estimated cost per call ($)" field="expected_cost_per_call" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
              <NumberField label="Known or estimated cost per billable call ($)" field="expected_cost_per_billable_call" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
              <NumberField label="Planned ad sets" field="planned_ad_sets" form={form} setNum={setNum} toggleUnknown={toggleUnknown} hint="Denominator of the fragmentation check" />
              <NumberField
                label="Expected weekly count of that Meta conversion event"
                field="expected_weekly_meta_events"
                form={form}
                setNum={setNum}
                toggleUnknown={toggleUnknown}
                hint="Numerator of the fragmentation check. Meta needs roughly 50 of ITS optimisation event per ad set per week — not 50 billable calls. Mark Unknown and the check does not run."
              />
            </>
          )}

          {current.key === "a4" && (
            <>
              <Field label="Where does the click land?">
                <Select value={form.funnel_type} onValueChange={(v) => set("funnel_type", v as FormState["funnel_type"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="landing_page">Landing page</SelectItem>
                    <SelectItem value="click_to_call">Click-to-call straight from the ad</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.funnel_type === "landing_page" && (
                <Field label="Call-to-action, and whether the phone number is the only conversion path">
                  <Textarea value={form.funnel_cta} onChange={(e) => set("funnel_cta", e.target.value)} rows={3} />
                </Field>
              )}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">IVR, qualification menu or screening step?</p>
                  <p className="text-xs text-muted-foreground">Before the buyer picks up.</p>
                </div>
                <Switch checked={form.has_ivr} onCheckedChange={(v) => set("has_ivr", v)} />
              </div>
              <NumberField label="Steps between the click and a live person" field="steps_to_live_person" form={form} setNum={setNum} toggleUnknown={toggleUnknown} />
            </>
          )}

          {current.key === "a5" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Hours the buyer takes calls, per day. Leave a day blank if they take none.
              </p>
              {DAYS.map((d) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="w-12 text-sm font-medium">{d}</span>
                  <Input
                    value={form.buyer_hours[d] ?? ""}
                    onChange={(e) => {
                      const next = { ...form.buyer_hours };
                      if (e.target.value.trim()) next[d] = e.target.value;
                      else delete next[d];
                      set("buyer_hours", next);
                    }}
                    placeholder="e.g. 8am-6pm ET"
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Capacity, buyer count and revenue concentration are computed from call data, not asked.
              </p>
            </div>
          )}

          {current.key === "a6" && (
            <>
              <Field label="Campaign state">
                <Select value={form.campaign_state} onValueChange={(v) => set("campaign_state", v as FormState["campaign_state"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new_build">New build</SelectItem>
                    <SelectItem value="existing">Existing campaigns already running</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.campaign_state === "existing" && (
                <Field label="Current structure, spend, and how long it has been live">
                  <Textarea value={form.existing_structure_notes} onChange={(e) => set("existing_structure_notes", e.target.value)} rows={4} />
                </Field>
              )}
              <Field label="Known problems going in">
                <Textarea value={form.known_problems} onChange={(e) => set("known_problems", e.target.value)} rows={3} />
              </Field>
            </>
          )}

          {current.key === "a7" && (
            <>
              <Field label="Client reporting format">
                <Input value={form.reporting_format} onChange={(e) => set("reporting_format", e.target.value)} placeholder="e.g. Slack summary + dashboard link" />
              </Field>
              <Field label="Reporting cadence">
                <Input value={form.reporting_cadence} onChange={(e) => set("reporting_cadence", e.target.value)} placeholder="e.g. Weekly, Monday morning" />
              </Field>
              {!partAComplete && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="font-medium">Part A is not complete — nothing computes yet.</p>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mark a number Unknown if it genuinely isn't available — that is recorded, not assumed.
                  </p>
                  {missing.some((item) =>
                    [
                      "Bid floor",
                      "Bid ceiling",
                      "Stated average bid",
                      "Duration range minimum",
                      "Duration range maximum",
                      "Minimum duration for any payout",
                    ].includes(item),
                  ) && (
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => setStep(1)}>
                      Review payout fields
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {current.key === "a8" && (
            <>
              <p className="text-sm text-muted-foreground">
                Pre-filled with the framework defaults. Change them only where the client has stated otherwise — every
                margin band, the allowable cost per call and the confidence bar are read from these three values.
              </p>
              <NumberField
                label="Target margin (%)"
                field="target_margin_pct"
                form={form}
                setNum={setNum}
                toggleUnknown={toggleUnknown}
                hint={`Framework default ${engine.DEFAULTS.targetMargin * 100}%. Sets the allowable cost per call and the "good (target)" band.`}
              />
              <NumberField
                label="Minimum margin — the floor (%)"
                field="min_margin_pct"
                form={form}
                setNum={setNum}
                toggleUnknown={toggleUnknown}
                hint={`Framework default ${engine.DEFAULTS.minMargin * 100}%. Below the floor there is no cushion for normal volatility.`}
              />
              <NumberField
                label="Actionable gap between angles (%)"
                field="actionable_gap_pct"
                form={form}
                setNum={setNum}
                toggleUnknown={toggleUnknown}
                hint={`Framework default ${engine.DEFAULTS.actionableGap * 100}%. The smallest difference worth acting on — it sets {min_calls} at 8 ÷ gap². A 57% gap needs 25 billable calls per angle; 40% needs 50.`}
              />
            </>
          )}

          {current.key === "b" && (
            <div className="mb-4 space-y-3">
              <BillableDefinitionCheck
                clientId={clientId}
                trackingPlatform={form.tracking_platform}
                revenueSource="platform"
                minDurationSeconds={numVal("billable_min_duration_seconds")}
                minPayoutThreshold={null}
                payout={numVal("payout")}
                governance={billableGovernance}
                setGovernance={setBillableGovernance}
                onBlockingChange={handleBlockingChange}
              />
              {billableCheckBlocking && (
                <Notice tone="danger" title="Thresholds are held back until the governing definition is chosen">
                  Every threshold below is denominated in billable calls. Computing them on a definition the data
                  contradicts by more than 10% produces numbers that look authoritative and are not.
                </Notice>
              )}
              {/* §1 — the operator sees the swing before they state the threshold. */}
              <ComputedRevenueSensitivity clientId={clientId} start={SENSITIVITY_START} end={SENSITIVITY_END} />
            </div>
          )}


          {current.key === "b" && computed && !billableCheckBlocking && (
            <div className="space-y-3">

              <Work
                label="Baseline RPC"
                formula={computed.baselineRpcSource}
                substitution={
                  computed.mode === "static"
                    ? `payout = ${fmtMoney(computed.payout)}`
                    : `${form.rtb_live && form.observed_rpc !== "" ? `observed RPC = ${fmtMoney(Number(form.observed_rpc))}` : `avg bid = ${fmtMoney(computed.avgBid)}`}`
                }
                result={fmtMoney(computed.baselineRpc)}
              />
              <Work
                label="Allowable cost per call"
                formula="RPC × (1 − target margin)"
                substitution={`${fmtMoney(computed.baselineRpc)} × (1 − ${computed.targetMargin}) `}
                result={fmtMoney(computed.allowable)}
              />
              <Work
                label="Kill threshold"
                formula={computed.mode === "static" ? "2 × payout, at zero billable calls" : "2 × average bid, at zero billable calls"}
                substitution={`2 × ${fmtMoney(computed.mode === "static" ? computed.payout : computed.avgBid)}`}
                result={fmtMoney(computed.kill)}
              />
              <Work
                label="{min_calls}"
                formula={`(2√2 ÷ actionable gap)² = 8 ÷ gap²${computed.mode === "rtb" ? " , +40% under RTB" : ""}`}
                substitution={`8 ÷ ${computed.actionableGap ?? "—"}²${computed.mode === "rtb" ? " × 1.4" : ""}`}
                result={fmtNum(computed.minCallsValue)}
              />
              <Work
                label="Expected billable calls / week"
                formula="weekly budget ÷ cost per billable call"
                substitution={`${fmtMoney(computed.weeklyBudget)} ÷ ${fmtMoney(computed.costPerBillable)}`}
                result={fmtNum(computed.expectedBillablePerWeek)}
              />
              <Work
                label="Volume tier and cadence"
                formula="From expected billable calls per week"
                substitution={`${fmtNum(computed.expectedBillablePerWeek)} billable calls / week`}
                result={
                  computed.tier
                    ? `${computed.tier.tier.replace(/_/g, "–")} · cuts ${computed.tier.cutCadence} · scale ${computed.tier.scaleCadence}`
                    : "—"
                }
              />
              <Work
                label="Cost per angle"
                formula="{min_calls} × cost per billable call"
                substitution={`${fmtNum(computed.minCallsValue)} × ${fmtMoney(computed.costPerBillable)}`}
                result={fmtMoney(computed.perAngle)}
              />
              <Work
                label="Test budget"
                formula="100% at launch; 80/20 once an angle has graduated"
                substitution={`${fmtMoney(computed.weeklyBudget)} × ${computed.testBudgetPct}`}
                result={fmtMoney(computed.testBudget)}
              />
              <Work
                label="Max angles testable"
                formula="test budget ÷ cost per angle, rounded down"
                substitution={`${fmtMoney(computed.testBudget)} ÷ ${fmtMoney(computed.perAngle)}`}
                result={fmtNum(computed.angles)}
              />
              <Work
                label="Meta conversion event"
                formula="stated by the account — the fragmentation check counts this event, never billable calls"
                substitution={computed.metaConversionEvent ?? "UNKNOWN"}
                result={computed.metaConversionEvent ?? "UNKNOWN — the fragmentation check cannot run"}
              />
              <Work
                label="Fragmentation check"
                formula={`expected weekly ${computed.metaConversionEvent ? `"${computed.metaConversionEvent}"` : "Meta optimisation"} events ÷ planned ad sets, against ~${engine.DEFAULTS.fragmentationFloor}`}
                substitution={
                  computed.fragmentationBlockedReason ??
                  `${fmtNum(computed.expectedMetaEventsPerWeek)} ÷ ${form.nums.planned_ad_sets || "—"}`
                }
                result={
                  computed.fragmentationBlockedReason ??
                  `${fmtNum(computed.fragmentation.perAdSet)} per ad set — ${computed.fragmentation.passes ? "passes" : "below the floor"}`
                }
              />

              <div className="space-y-2 pt-2">
                <p className="text-sm font-semibold">Flags</p>
                {computed.flags.map((f, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 rounded-md border p-3 text-sm ${
                      f.level === "warn"
                        ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                        : "bg-muted/40"
                    }`}
                  >
                    {f.level === "warn" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {current.key === "c" && computed && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-4 text-sm">
                <p className="font-semibold">What the framework can and cannot decide for {client.name}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Decision cadence: cuts {computed.tier?.cutCadence?.toLowerCase() ?? "—"}, scale steps{" "}
                    {computed.tier?.scaleCadence?.toLowerCase() ?? "—"} — at roughly{" "}
                    {fmtNum(computed.expectedBillablePerWeek)} billable calls a week.
                  </li>
                  <li>
                    A row needs {fmtNum(computed.minCallsValue)} billable calls before it can be ranked. Below that it is
                    marked insufficient and no cut is proposed on it.
                  </li>
                  <li>
                    Zero-billable spend past {fmtMoney(computed.kill)} is decisive on any day, regardless of sample size.
                  </li>
                  <li>
                    At this budget the account can properly rank {fmtNum(computed.angles)} angles at a time. More angles
                    than that means no angle gets a verdict.
                  </li>
                  <li>
                    Routing, buyer and waterfall decisions stay with the client — recommend-only.
                  </li>
                  <li>
                    What would improve this: a higher budget, a lower cost per billable call, or a longer test window —
                    each raises the number of angles that can be ranked and shortens the decision cycle.
                  </li>
                </ul>
              </div>
              {saved ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                  <Check className="h-4 w-4 text-emerald-600" />
                  Economics and Instance records saved for {client.name}.
                </div>
              ) : (
                <>
                  {saveBlockers.length > 0 && (
                    <Notice tone="warn" title="These cannot be saved as Unknown">
                      Every threshold is anchored on them, so there is nothing to compute without a number:{" "}
                      {saveBlockers.join(", ")}. Open A8 · Margin targets and enter each one.
                    </Notice>
                  )}
                <Button onClick={handleSave} disabled={saving || billableCheckBlocking || saveBlockers.length > 0}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Economics + Instance
                </Button>
                </>
              )}
            </div>
          )}

          {(current.key === "b" || current.key === "c") && !computed && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              Part A is not complete, so nothing is computed. Missing: {missing.join(", ")}.
            </div>
          )}
        </CardContent>
      </Card>

      {STEPS[step + 1]?.key === "b" && !partAComplete && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="font-medium">Still needed before this can compute ({missing.length}):</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Anything the client has not confirmed: switch that field to Unknown instead of leaving it blank.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {unknownFields.length > 0 && (
            <Badge variant="outline" className="text-xs">{unknownFields.length} recorded UNKNOWN</Badge>
          )}
          <Button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={step === STEPS.length - 1 || (STEPS[step + 1]?.key === "b" && !partAComplete)}
          >
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- small building blocks ---------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberField({
  label,
  field,
  form,
  setNum,
  toggleUnknown,
  hint,
}: {
  label: string;
  field: NumField;
  form: FormState;
  setNum: (f: NumField, v: string) => void;
  toggleUnknown: (f: NumField) => void;
  hint?: string;
}) {
  const isUnknown = form.unknown[field];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm">{label}</Label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          Unknown
          <Switch checked={isUnknown} onCheckedChange={() => toggleUnknown(field)} />
        </label>
      </div>
      <Input
        value={isUnknown ? "" : form.nums[field]}
        onChange={(e) => setNum(field, e.target.value)}
        disabled={isUnknown}
        inputMode="decimal"
        placeholder={isUnknown ? "Recorded as UNKNOWN — no value assumed" : ""}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Work({
  label,
  formula,
  substitution,
  result,
}: {
  label: string;
  formula: string;
  substitution: string;
  result: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm font-semibold">{result}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formula}</p>
      <p className="text-xs font-mono text-muted-foreground">{substitution}</p>
    </div>
  );
}
