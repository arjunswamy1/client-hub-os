/**
 * Media Brain — LOCATION (ZIP) SCORING screen.
 *
 * Two ways in: an uploaded location file (the launch case, no call history yet)
 * and the client's own live calls (an existing campaign).
 *
 * Nothing here derives a rule. Every success rate, percentile, tier, exclusion
 * and launch-list size comes from `@/lib/mediaBrain/locationScoring.ts`, and the
 * billable definition comes from `engine.isBillableCall` with the client's own
 * economics record — never a default.
 *
 * Column mapping and threshold confirmation are REQUIRED steps, not silent
 * defaults (step 1 of the doc): a wrong payout-mode assumption otherwise
 * reshapes a target list without anyone seeing it happen.
 *
 * Live scoring applies the SAME publisher scoping gate as every other Media
 * Brain read. Scoring a client's ZIPs on calls we did not buy would repeat the
 * error that made BuyologyIQ's first read wrong, and a location list looks
 * plausible either way.
 *
 * @see docs/media-brain/05_Location_Scoring.md
 */

import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, MapPin, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GateBlock,
  Notice,
  StaleWarning,
  WindowConfirm,
  daysAgoIso,
  fmtMoney,
  fmtNum,
  fmtPct,
  todayIso,
  useMediaBrainGate,
  type ConfirmedWindow,
} from "@/components/mediaBrain/shared";
import * as engine from "@/lib/mediaBrain/engine";
import * as ls from "@/lib/mediaBrain/locationScoring";

/* ------------------------------------------------------------------ *
 * Live call sources — where the location actually lives per feed
 * ------------------------------------------------------------------ */

type LiveSourceKey = "ringba" | "cannaball" | "moja" | "jacuzzi_leads";

interface LiveSource {
  key: LiveSourceKey;
  label: string;
  table: string;
  dateColumn: string;
  /** Null when the ZIP is not a column but a tag inside a JSON bag. */
  zipColumn: string | null;
  zipNote: string;
  columns: string;
}

const LIVE_SOURCES: Record<LiveSourceKey, LiveSource> = {
  ringba: {
    key: "ringba",
    label: "Ringba calls",
    table: "ringba_calls",
    dateColumn: "call_date",
    zipColumn: null,
    zipNote: "There is no ZIP column on ringba_calls — the ZIP is the tag `tag:Geo:ZipCode` inside `metadata`.",
    columns: "call_id, call_date, payout, duration_seconds, converted, campaign_name, metadata",
  },
  cannaball: {
    key: "cannaball",
    label: "CallGrid calls (Cannaball)",
    table: "cannaball_calls",
    dateColumn: "call_start",
    zipColumn: "caller_zip",
    zipNote: "ZIP read from `caller_zip`.",
    columns: "call_id, call_start, payout, duration_seconds, caller_zip, campaign_name, disposition",
  },
  moja: {
    key: "moja",
    label: "Moja calls",
    table: "moja_calls",
    dateColumn: "call_start",
    zipColumn: "caller_zip",
    zipNote: "ZIP read from `caller_zip`.",
    columns:
      "call_id, call_start, payout, duration_seconds, converted, caller_zip, campaign_name, publisher_name, disposition, no_payout_reason",
  },
  jacuzzi_leads: {
    key: "jacuzzi_leads",
    label: "Jacuzzi leads",
    table: "jacuzzi_leads",
    dateColumn: "transaction_date",
    zipColumn: "billing_zip",
    zipNote: "ZIP read from `billing_zip`. These are leads the client pays on, not raw calls.",
    columns: "id, transaction_date, billing_zip, payout_rate, call_status",
  },
};

/** Structural, not quality: no route / no coverage. Never "buyer declined". */
const STRUCTURAL_DISPOSITIONS = new Set(["no_route", "noroute", "no coverage", "no_coverage", "unrouted"]);
const STRUCTURAL_NO_PAYOUT_REASONS = new Set(["no_route", "no_buyer", "no_coverage", "no_bid"]);

async function fetchAllRows(source: LiveSource, clientId: string, start: string, end: string) {
  const out: Record<string, unknown>[] = [];
  const page = 1000;
  for (let from = 0; from < 200_000; from += page) {
    const { data, error } = await supabase
      .from(source.table as never)
      .select(source.columns)
      .eq("client_id", clientId)
      .gte(source.dateColumn, start)
      .lte(source.dateColumn, `${end}T23:59:59.999Z`)
      .order(source.dateColumn, { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

/** Publisher, per feed. Ringba keeps it in the metadata bag. */
function publisherOf(source: LiveSourceKey, row: Record<string, unknown>): string | null {
  if (source === "ringba") {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return (meta.publisher as string | null) ?? null;
  }
  if (source === "moja") return (row.publisher_name as string | null) ?? null;
  return null;
}

function zipOf(source: LiveSource, row: Record<string, unknown>): string | null {
  if (source.zipColumn) return (row[source.zipColumn] as string | null) ?? null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return (meta["tag:Geo:ZipCode"] as string | null) ?? null;
}

/* ------------------------------------------------------------------ *
 * Threshold / weight form state
 * ------------------------------------------------------------------ */

type CfgKey = keyof ls.LocationScoringConfig;
const CFG_FIELDS: { key: CfgKey; label: string; step: string }[] = [
  { key: "hardFailRateMax", label: "Structural-failure rate ≥ (exclude)", step: "0.05" },
  { key: "minSuccessRate", label: "Success rate < (exclude)", step: "0.05" },
  { key: "confidenceMin", label: "Confidence minimum (events)", step: "1" },
  { key: "confidenceHigh", label: "High confidence (events)", step: "1" },
  { key: "weightSuccess", label: "Weight — success rate", step: "0.05" },
  { key: "weightValue", label: "Weight — value", step: "0.05" },
  { key: "weightVolume", label: "Weight — volume", step: "0.05" },
  { key: "launchTierPct", label: "Launch tier percentile ≥", step: "0.01" },
  { key: "expandTierPct", label: "Expand tier percentile ≥", step: "0.01" },
  { key: "launchSize", label: "Launch list size", step: "1" },
];

const downloadCsv = (name: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const tierTone = (tier: string | null) =>
  tier === "Launch"
    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    : tier === "Expand"
      ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
      : "bg-muted text-muted-foreground";

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

interface RunMeta {
  source: "upload" | "live";
  sourceLabel: string;
  payoutMode: string;
  mapping: { id: string; volume: string; success: string; value: string | null; hardFail: string | null };
  budgetDaily: number | null;
  publisherNote: string | null;
  notes: string | null;
}

export default function MediaBrainLocationsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const gate = useMediaBrainGate(clientId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [cfg, setCfg] = useState<ls.LocationScoringConfig>({ ...ls.DEFAULT_LOCATION_SCORING_CONFIG });
  const [payoutMode, setPayoutMode] = useState<string>("static");
  const [budget, setBudget] = useState<string>("");
  const [result, setResult] = useState<ls.LocationScoringResult | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);

  /* ---------- upload path ---------- */
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [map, setMap] = useState({ id: "", volume: "", success: "", value: "__none__", hardFail: "__none__" });

  /* ---------- live path ---------- */
  const [liveSourceKey, setLiveSourceKey] = useState<LiveSourceKey>("ringba");
  const [window, setWindow] = useState<ConfirmedWindow | null>(null);

  const blocked = <GateBlock gate={gate} clientId={clientId} />;

  const eco = gate.economics ?? {};
  const scopingGate = useMemo(() => engine.publisherScopingGate(eco as never), [eco]);

  const samples = useMemo(() => {
    if (!parsed) return {} as Record<string, string[]>;
    const out: Record<string, string[]> = {};
    for (const h of parsed.headers) out[h] = parsed.rows.slice(0, 3).map((r) => r[h] ?? "");
    return out;
  }, [parsed]);

  const saveRun = useMutation({
    mutationFn: async (payload: { res: ls.LocationScoringResult; meta: RunMeta }) => {
      const { res, meta } = payload;
      const { data: run, error } = await supabase
        .from("media_brain_location_score_runs")
        .insert({
          client_id: clientId!,
          source: meta.source,
          source_label: meta.sourceLabel,
          payout_mode: meta.payoutMode,
          id_col: meta.mapping.id,
          volume_col: meta.mapping.volume,
          success_col: meta.mapping.success,
          value_col: meta.mapping.value,
          hard_fail_col: meta.mapping.hardFail,
          hard_fail_rate_max: cfg.hardFailRateMax,
          min_success_rate: cfg.minSuccessRate,
          confidence_min: cfg.confidenceMin,
          confidence_high: cfg.confidenceHigh,
          weight_success: res.effectiveWeights.success,
          weight_value: res.effectiveWeights.value,
          weight_volume: res.effectiveWeights.volume,
          launch_tier_pct: cfg.launchTierPct,
          expand_tier_pct: cfg.expandTierPct,
          launch_size: cfg.launchSize,
          budget_daily: meta.budgetDaily,
          locations_total: res.counts.total,
          locations_scored: res.counts.scored,
          locations_excluded: res.counts.excluded,
          launch_qualifying: res.counts.launchQualifying,
          launch_list_size: res.counts.launchList,
          weight_redistribution_note: res.weightRedistributionNote,
          publisher_scoping_note: meta.publisherNote,
          notes: meta.notes,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const rows = res.all.map((r) => ({
        run_id: (run as { id: string }).id,
        client_id: clientId!,
        source: meta.source,
        id_col: meta.mapping.id,
        volume_col: meta.mapping.volume,
        success_col: meta.mapping.success,
        value_col: meta.mapping.value,
        hard_fail_col: meta.mapping.hardFail,
        hard_fail_rate_max: cfg.hardFailRateMax,
        min_success_rate: cfg.minSuccessRate,
        confidence_min: cfg.confidenceMin,
        confidence_high: cfg.confidenceHigh,
        weight_success: res.effectiveWeights.success,
        weight_value: res.effectiveWeights.value,
        weight_volume: res.effectiveWeights.volume,
        location_id: r.id,
        volume: r.volume,
        success: r.success,
        success_rate: r.successRate,
        value: r.value,
        hard_fail: r.hardFail,
        hard_fail_rate: r.hardFailRate,
        score: r.score,
        score_percentile: r.scorePercentile,
        confidence: r.confidence,
        tier: r.tier,
        in_launch_list: r.inLaunchList,
        excluded: r.excluded,
        exclude_reason: r.excludeReason,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e2 } = await supabase.from("media_brain_location_scores").insert(rows.slice(i, i + 500));
        if (e2) throw new Error(e2.message);
      }
      return (run as { id: string }).id;
    },
    onSuccess: () => {
      toast.success("Run recorded — mapping, thresholds and output kept together");
      qc.invalidateQueries({ queryKey: ["mb-location-runs", clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runsQ = useQuery({
    queryKey: ["mb-location-runs", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_brain_location_score_runs")
        .select("*")
        .eq("client_id", clientId!)
        .order("run_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const finish = (res: ls.LocationScoringResult, meta: RunMeta) => {
    setResult(res);
    setRunMeta(meta);
    saveRun.mutate({ res, meta });
  };

  const scoreUpload = () => {
    if (!parsed) return;
    const rows: ls.LocationInputRow[] = parsed.rows
      .map((r) => ({
        id: (r[map.id] ?? "").trim(),
        volume: num(r[map.volume]),
        success: num(r[map.success]),
        value: map.value === "__none__" ? undefined : num(r[map.value]),
        hardFail: map.hardFail === "__none__" ? undefined : num(r[map.hardFail]),
      }))
      .filter((r) => r.id !== "");
    if (rows.length === 0) {
      toast.error("No rows with a location id. An empty input is a failure, not a zero.");
      return;
    }
    finish(ls.scoreLocations(rows, cfg), {
      source: "upload",
      sourceLabel: fileName ?? "uploaded file",
      payoutMode,
      mapping: {
        id: map.id,
        volume: map.volume,
        success: map.success,
        value: map.value === "__none__" ? null : map.value,
        hardFail: map.hardFail === "__none__" ? null : map.hardFail,
      },
      budgetDaily: budget ? Number(budget) : null,
      publisherNote: "Uploaded file — publisher scoping is whatever the exporting system applied. Confirm it at intake.",
      notes: `${rows.length} rows read from ${fileName ?? "upload"}.`,
    });
  };

  const liveMutation = useMutation({
    mutationFn: async () => {
      if (!window) throw new Error("Confirm the window first.");
      const source = LIVE_SOURCES[liveSourceKey];
      const raw = await fetchAllRows(source, clientId!, window.start, window.end);
      if (raw.length === 0) throw new Error("The pull returned no rows. An empty pull is a failure, not a zero.");

      /* Publisher scoping — the same gate as every other read, before aggregation. */
      let considered = raw;
      let publisherNote = scopingGate.note;
      if (scopingGate.filterApplies) {
        const partition = engine.partitionByPublisher(
          raw.map((r) => ({ row: r, publisher: publisherOf(liveSourceKey, r) })),
          (eco as { attributed_publishers?: (string | null)[] | null }).attributed_publishers,
        );
        considered = partition.attributed.map((p) => p.row);
        publisherNote = `${scopingGate.note} ${partition.note}`;
        if (considered.length === 0) throw new Error(`No calls remain after publisher scoping. ${partition.note}`);
      }

      const calls: ls.LocationCall[] = considered.map((r) => {
        if (liveSourceKey === "jacuzzi_leads") {
          const payout = num(r.payout_rate);
          return { locationId: zipOf(source, r), billable: payout > 0, payout };
        }
        const payout = num(r.payout);
        const duration = num(r.duration_seconds);
        const billable = engine.isBillableCall(eco as never, {
          duration_seconds: duration,
          payout_amount: payout,
          converted: (r.converted as boolean | null) ?? null,
        } as never);
        const disposition = String(r.disposition ?? "").toLowerCase();
        const noPayoutReason = String(r.no_payout_reason ?? "").toLowerCase();
        return {
          locationId: zipOf(source, r),
          billable,
          payout,
          structuralFail:
            STRUCTURAL_DISPOSITIONS.has(disposition) || STRUCTURAL_NO_PAYOUT_REASONS.has(noPayoutReason),
        };
      });

      const { rows, callsWithoutLocation } = locationRows(calls);
      if (rows.length === 0) throw new Error("No call carried a ZIP in this window, so there is nothing to score.");
      return {
        res: ls.scoreLocations(rows, cfg),
        meta: {
          source: "live" as const,
          sourceLabel: `${source.label} ${window.start} → ${window.end} (${window.timezone})`,
          payoutMode,
          mapping: {
            id: source.zipColumn ?? "metadata->>'tag:Geo:ZipCode'",
            volume: "calls",
            success: "billable (governing definition)",
            value: liveSourceKey === "jacuzzi_leads" ? "payout_rate" : "payout",
            hardFail: liveSourceKey === "jacuzzi_leads" ? null : "structural failures (no route / no buyer)",
          },
          budgetDaily: budget ? Number(budget) : null,
          publisherNote,
          notes: `${considered.length} of ${raw.length} rows scored. ${callsWithoutLocation} carried no ZIP and were dropped as a named data gap, never bucketed as a blank location.`,
        },
      };
    },
    onSuccess: (out) => finish(out.res, out.meta),
    onError: (e: Error) => toast.error(e.message),
  });

  if (blocked) return <div className="space-y-6">{blocked}</div>;

  const mappingComplete = !!(map.id && map.volume && map.success);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MapPin className="h-5 w-5" /> Location scoring — {gate.client?.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Ranked, tiered, budget-sized target list. Location targeting is the hardest constraint in a pay-per-call
          launch, so it is decided before campaigns are built.
        </p>
      </div>

      {gate.instance && <StaleWarning instance={gate.instance} />}

      <Notice tone="info" title="What this screen does not do">
        There is no margin input here, by design. Location ranking is a relative comparison across locations using the
        network's own accept rate and payout — actual cost per call does not exist until the campaign spends. Margin
        governs cut / hold / scale after launch. And the confidence gate below counts <strong>events</strong> (default
        10); it is not <strong>{"{min_calls}"}</strong> (25 billable calls), which governs ranking one creative angle
        against another.
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — confirm before scoring</CardTitle>
          <CardDescription>
            Payout mode decides which column is the value signal. Budget sizes the launch list. Neither is assumed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Payout mode</Label>
            <Select value={payoutMode} onValueChange={setPayoutMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static — fixed payout per billable call</SelectItem>
                <SelectItem value="rtb">RTB — bid per call</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Daily budget the list is sized to (optional)</Label>
            <Input inputMode="decimal" placeholder="e.g. 500" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="upload" className="space-y-4">
        <TabsList>
          <TabsTrigger value="upload">Upload a file</TabsTrigger>
          <TabsTrigger value="live">Score from live call data</TabsTrigger>
        </TabsList>

        {/* ---------------- UPLOAD ---------------- */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2 — the file and its columns</CardTitle>
              <CardDescription>
                Map the client's columns onto the canonical roles. Sample values are shown so the inference can be
                checked rather than assumed. Mapping is a required step.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const text = await f.text();
                    const p = ls.parseCsv(text);
                    if (p.headers.length === 0 || p.rows.length === 0) {
                      toast.error("That file has no readable rows.");
                      return;
                    }
                    setFileName(f.name);
                    setParsed(p);
                    setMap({ id: "", volume: "", success: "", value: "__none__", hardFail: "__none__" });
                    setResult(null);
                  }}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Choose CSV
                </Button>
                {fileName && (
                  <span className="text-sm text-muted-foreground">
                    {fileName} — {parsed?.rows.length ?? 0} rows, {parsed?.headers.length ?? 0} columns
                  </span>
                )}
              </div>

              {parsed && (
                <>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Column</TableHead>
                          <TableHead>Sample values</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.headers.map((h) => (
                          <TableRow key={h}>
                            <TableCell className="font-mono text-xs">{h}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{samples[h]?.join("  ·  ")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["id", "Location id (ZIP / city / DMA)", true],
                        ["volume", "Volume — total events", true],
                        ["success", "Success — accepted / connected / billable", true],
                        ["value", "Value — avg payout / bid (optional)", false],
                        ["hardFail", "Structural failures (optional)", false],
                      ] as [keyof typeof map, string, boolean][]
                    ).map(([key, label, required]) => (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-sm">
                          {label} {required && <span className="text-destructive">*</span>}
                        </Label>
                        <Select value={map[key]} onValueChange={(v) => setMap((m) => ({ ...m, [key]: v }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select column" />
                          </SelectTrigger>
                          <SelectContent>
                            {!required && <SelectItem value="__none__">Not in this file</SelectItem>}
                            {parsed.headers.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>

                  {map.value === "__none__" && (
                    <Notice tone="warn" title="No value column">
                      Its 35% weight will be redistributed proportionally into success and volume — not zeroed — and the
                      redistribution is stated on the output.
                    </Notice>
                  )}
                  {map.hardFail === "__none__" && (
                    <Notice tone="info" title="No structural-failure column">
                      Without it, a location that fails for lack of buyer coverage cannot be told apart from one where
                      buyers simply declined, so only the success-rate floor will exclude anything.
                    </Notice>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <ThresholdCard cfg={cfg} setCfg={setCfg} />

          <Button disabled={!mappingComplete} onClick={scoreUpload}>
            Score {parsed?.rows.length ?? 0} locations
          </Button>
        </TabsContent>

        {/* ---------------- LIVE ---------------- */}
        <TabsContent value="live" className="space-y-4">
          <Notice tone={scopingGate.ok ? "ok" : "danger"} title="Publisher scoping">
            {scopingGate.error ?? scopingGate.note}
          </Notice>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2 — build the table from the client's own calls</CardTitle>
              <CardDescription>
                Volume is calls, success is billable per the client's governing definition, value is payout. Structural
                failures (no route / no buyer) are counted apart from quality failures.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 sm:max-w-sm">
                <Label className="text-sm">Call source</Label>
                <Select value={liveSourceKey} onValueChange={(v) => setLiveSourceKey(v as LiveSourceKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(LIVE_SOURCES).map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">{LIVE_SOURCES[liveSourceKey].zipNote}</p>
            </CardContent>
          </Card>

          <ThresholdCard cfg={cfg} setCfg={setCfg} />

          <WindowConfirm
            label="Confirm the window before the pull"
            defaultStart={daysAgoIso(30)}
            defaultEnd={todayIso()}
            confirmed={window}
            onConfirm={(w) => setWindow(w)}
            onReset={() => setWindow(null)}
          />

          <Button
            disabled={!window || !scopingGate.ok || liveMutation.isPending}
            onClick={() => liveMutation.mutate()}
          >
            {liveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Pull and score
          </Button>
        </TabsContent>
      </Tabs>

      {result && runMeta && <Results res={result} meta={runMeta} cfg={cfg} saving={saveRun.isPending} />}

      {(runsQ.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recorded runs</CardTitle>
            <CardDescription>
              A run is evidence. The mapping and thresholds are kept with the output, so which list was launched and on
              what basis is answerable months later.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Mapping</TableHead>
                  <TableHead className="text-right">Scored</TableHead>
                  <TableHead className="text-right">Excluded</TableHead>
                  <TableHead className="text-right">Qualifying</TableHead>
                  <TableHead className="text-right">Launch list</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runsQ.data as Record<string, unknown>[]).map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(String(r.run_at)).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{String(r.source)}</Badge> {String(r.source_label ?? "")}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {String(r.id_col)} / {String(r.volume_col)} / {String(r.success_col)}
                      {r.value_col ? ` / ${String(r.value_col)}` : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs">{fmtNum(Number(r.locations_scored))}</TableCell>
                    <TableCell className="text-right text-xs">{fmtNum(Number(r.locations_excluded))}</TableCell>
                    <TableCell className="text-right text-xs">{fmtNum(Number(r.launch_qualifying))}</TableCell>
                    <TableCell className="text-right text-xs">{fmtNum(Number(r.launch_list_size))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Local alias so the page never re-implements the aggregation. */
const locationRows = ls.locationTableFromCalls;

function ThresholdCard({
  cfg,
  setCfg,
}: {
  cfg: ls.LocationScoringConfig;
  setCfg: (c: ls.LocationScoringConfig) => void;
}) {
  const weightSum = cfg.weightSuccess + cfg.weightValue + cfg.weightVolume;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Step 3–6 — confirm the thresholds and weights</CardTitle>
        <CardDescription>
          Pre-filled with the framework defaults, all editable. Confirming them is a required step: a threshold nobody
          looked at is an assumption.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CFG_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                step={f.step}
                value={cfg[f.key]}
                onChange={(e) => setCfg({ ...cfg, [f.key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        {Math.abs(weightSum - 1) > 0.001 && (
          <Notice tone="warn" title={`Weights sum to ${weightSum.toFixed(2)}, not 1.00`}>
            Scores stay comparable within this run, but they are no longer on the framework's scale. Fix the weights or
            record why they differ.
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}

function Results({
  res,
  meta,
  cfg,
  saving,
}: {
  res: ls.LocationScoringResult;
  meta: RunMeta;
  cfg: ls.LocationScoringConfig;
  saving: boolean;
}) {
  return (
    <div className="space-y-4">
      <Notice tone="ok" title="Launch list">
        {res.launchListSentence}
      </Notice>
      {res.weightRedistributionNote && (
        <Notice tone="warn" title="Weights were redistributed">
          {res.weightRedistributionNote}
        </Notice>
      )}
      {meta.publisherNote && (
        <Notice tone="info" title="Publisher scoping applied to this run">
          {meta.publisherNote}
        </Notice>
      )}
      {res.counts.lowConfidenceCapped > 0 && (
        <Notice tone="info" title={`${res.counts.lowConfidenceCapped} thin-sample location(s) capped out of Launch`}>
          They scored into the top tier on fewer than {cfg.confidenceMin} events. Worth watching, not worth launching on.
        </Notice>
      )}
      {meta.notes && <p className="text-xs text-muted-foreground">{meta.notes}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv("launch_list.csv", ls.scoredLocationsToCsv(res.launchList))}
        >
          <Download className="mr-2 h-4 w-4" /> Launch list ({res.counts.launchList})
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv("scored_locations.csv", ls.scoredLocationsToCsv(res.all))}
        >
          <Download className="mr-2 h-4 w-4" /> Full scored file ({res.counts.total})
        </Button>
        {saving && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> recording this run
          </span>
        )}
      </div>

      <LocationTable title="Launch list — paste into platform targeting" rows={res.launchList} />
      <LocationTable title="Every location, scored" rows={res.all} />
    </div>
  );
}

function LocationTable({ title, rows }: { title: string; rows: ls.ScoredLocation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Success rate</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Pctl</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Excluded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.excluded ? "opacity-60" : undefined}>
                <TableCell className="font-mono text-xs">{r.id}</TableCell>
                <TableCell className="text-right text-xs">{fmtNum(r.volume)}</TableCell>
                <TableCell className="text-right text-xs">{fmtNum(r.success)}</TableCell>
                <TableCell className="text-right text-xs">{fmtPct(r.successRate)}</TableCell>
                <TableCell className="text-right text-xs">{fmtMoney(r.value)}</TableCell>
                <TableCell className="text-right text-xs">{r.score === null ? "—" : r.score.toFixed(3)}</TableCell>
                <TableCell className="text-right text-xs">{fmtPct(r.scorePercentile, 0)}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant={r.confidence === "low" ? "destructive" : "outline"}>{r.confidence}</Badge>
                  {r.confidenceCapped && <span className="ml-1 text-[11px] text-muted-foreground">capped</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {r.tier ? <span className={`rounded px-2 py-0.5 ${tierTone(r.tier)}`}>{r.tier}</span> : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.excludeReason ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
