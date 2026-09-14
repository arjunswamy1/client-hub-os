/**
 * Media Brain — DID mapping tool.
 *
 * The remedy for the join blocker: `client_dids` is empty for every client with
 * live data, so DID → `client_dids` → `creative_name` → `ad_creatives` resolves
 * nothing. This screen measures that coverage and lets a human fix it.
 *
 * READ-ONLY: every call table and every Meta sync table. This page writes only
 * to `client_dids` and `client_did_periods`, never in bulk without an explicit
 * confirmation naming the row count, and never over an existing row unless the
 * user is editing that row.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Save, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Notice, fmtMoney, fmtNum, fmtPct, useMediaBrainGate } from "@/components/mediaBrain/shared";
import * as dm from "@/lib/mediaBrain/didMapping";
import type { DidMapping, MetaAdRow, VerticalRow } from "@/lib/mediaBrain/join";

const WINDOW_DAYS = 30;

/** Supabase caps a select at 1000 rows; the window routinely holds more. */
async function fetchAll(table: string, columns: string, clientId: string, dateCol: string, since: string) {
  const out: Record<string, unknown>[] = [];
  const page = 1000;
  for (let from = 0; from < 50_000; from += page) {
    const { data, error } = await supabase
      .from(table as never)
      .select(columns)
      .eq("client_id", clientId)
      .gte(dateCol, since)
      .order(dateCol, { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

type DraftRow = {
  creative_name: string;
  platform: string;
  campaign_name: string;
  audience_cluster: string;
  ad_length: string;
  status: string;
  notes: string;
};

const emptyDraft = (): DraftRow => ({
  creative_name: "",
  platform: "meta",
  campaign_name: "",
  audience_cluster: "",
  ad_length: "",
  status: "active",
  notes: "",
});

export default function MediaBrainMappingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const gate = useMediaBrainGate(clientId);
  const qc = useQueryClient();

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - WINDOW_DAYS);
    return d.toISOString();
  }, []);
  const windowLabel = `${new Date(since).toISOString().slice(0, 10)} → ${new Date().toISOString().slice(0, 10)} (UTC)`;

  const trackingPlatform: string | null = gate.economics?.tracking_platform ?? null;
  const namingConvention: string | null = gate.instance?.naming_convention ?? null;

  /* --------------- the read-only pull --------------- */
  const dataQ = useQuery({
    queryKey: ["mb-mappings", clientId, trackingPlatform, since],
    enabled: !!clientId && !gate.loading,
    queryFn: async () => {
      const declared = dm.sourceForPlatform(trackingPlatform);
      const specs = declared ? [declared] : Object.values(dm.CALL_SOURCES);

      const found: { spec: dm.CallSourceSpec; calls: dm.MappingCall[] }[] = [];
      for (const spec of specs) {
        const cols = [
          spec.idColumn,
          spec.dateColumn,
          spec.didColumn,
          spec.callerColumn,
          spec.payoutColumn,
          spec.campaignColumn,
          spec.creativeColumn,
          spec.targetColumn,
        ]
          .filter(Boolean)
          .join(", ");
        const rows = await fetchAll(spec.table, cols, clientId!, spec.dateColumn, since);
        if (rows.length) found.push({ spec, calls: dm.toMappingCalls(rows, spec) });
      }

      const [didsRes, periodsRes, adsRes, vertRes] = await Promise.all([
        supabase.from("client_dids").select("*").eq("client_id", clientId!),
        supabase.from("client_did_periods").select("*").eq("client_id", clientId!),
        supabase
          .from("ad_creatives")
          .select("platform_ad_id, platform_adset_id, platform_campaign_id, ad_name, creative_name, adset_name, campaign_name, platform, spend, impressions, clicks, date_from, date_to")
          .eq("client_id", clientId!),
        supabase.from("client_verticals").select("vertical_id, label, meta_patterns, ringba_patterns").eq("client_id", clientId!),
      ]);
      for (const [label, res] of [
        ["DID mappings", didsRes],
        ["DID periods", periodsRes],
        ["Meta creatives", adsRes],
        ["verticals", vertRes],
      ] as const) {
        if (res.error) throw new Error(`${label} query failed: ${res.error.message}`);
      }

      const didRows = (didsRes.data ?? []) as Record<string, any>[];
      const periodRows = (periodsRes.data ?? []) as Record<string, any>[];
      const mappings: DidMapping[] = [
        ...(periodRows as unknown as DidMapping[]),
        ...(didRows as unknown as DidMapping[]),
      ];
      const metaAds = (adsRes.data ?? []) as unknown as MetaAdRow[];
      const verticals = (vertRes.data ?? []) as unknown as VerticalRow[];
      const calls = found.flatMap((f) => f.calls);

      return {
        declaredPlatform: declared,
        sourcesWithRows: found.map((f) => ({ table: f.spec.table, calls: f.calls.length })),
        calls,
        didRows,
        periodRows,
        mappings,
        metaAds,
        verticals,
      };
    },
  });

  const d = dataQ.data;
  const coverage = useMemo(
    () => (d ? dm.computeCoverage(d.calls, d.mappings, d.metaAds, d.verticals) : null),
    [d],
  );
  const didStats = useMemo(() => (d ? dm.aggregateDids(d.calls, d.mappings) : []), [d]);
  const unmappedStats = useMemo(() => didStats.filter((s) => !s.mapped), [didStats]);
  const callerDiag = useMemo(() => dm.callerNumberDiagnosis(didStats), [didStats]);
  const suggestions = useMemo(() => {
    const out = new Map<string, dm.Suggestion[]>();
    if (!d) return out;
    for (const s of unmappedStats.slice(0, 200)) out.set(s.digits, dm.suggestCreatives(s, d.metaAds));
    return out;
  }, [d, unmappedStats]);
  const reverse = useMemo(
    () => (d ? dm.unmappedMetaAds(d.metaAds, d.mappings, namingConvention) : []),
    [d, namingConvention],
  );
  const reuse = useMemo(() => (d ? dm.detectReuse(d.calls).filter((r) => r.cleanSplit) : []), [d]);

  /* --------------- drafts + writes --------------- */
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const draftFor = (digitsKey: string) => drafts[digitsKey] ?? emptyDraft();
  const setDraft = (digitsKey: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => ({ ...prev, [digitsKey]: { ...(prev[digitsKey] ?? emptyDraft()), ...patch } }));

  const saveOne = useMutation({
    mutationFn: async ({ stat, draft }: { stat: dm.DidStat; draft: DraftRow }) => {
      if (!draft.creative_name.trim()) throw new Error("A creative name is required — a mapping with no creative resolves nothing.");
      const { error } = await supabase.from("client_dids").insert({
        client_id: clientId!,
        did: stat.digits,
        did_formatted: stat.did,
        creative_name: draft.creative_name.trim(),
        platform: draft.platform || "meta",
        campaign_name: draft.campaign_name.trim() || null,
        audience_cluster: draft.audience_cluster.trim() || null,
        ad_length: draft.ad_length.trim() || null,
        status: draft.status || "active",
        notes: draft.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mapping saved — coverage recomputed");
      qc.invalidateQueries({ queryKey: ["mb-mappings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Only exact matches are ever offered in bulk. */
  const exactCandidates = useMemo(
    () =>
      unmappedStats
        .map((s) => ({ stat: s, sug: (suggestions.get(s.digits) ?? []).find((x) => x.quality === "exact") }))
        .filter((x): x is { stat: dm.DidStat; sug: dm.Suggestion } => !!x.sug),
    [unmappedStats, suggestions],
  );
  const [confirmBulk, setConfirmBulk] = useState(false);

  const saveBulkExact = useMutation({
    mutationFn: async () => {
      const rows = exactCandidates.map(({ stat, sug }) => ({
        client_id: clientId!,
        did: stat.digits,
        did_formatted: stat.did,
        creative_name: sug.creativeName,
        platform: "meta",
        campaign_name: sug.campaignName,
        status: "active",
        notes: `Accepted exact match to Meta ad ${sug.platformAdId ?? sug.adName} via the DID mapping tool.`,
      }));
      const { error } = await supabase.from("client_dids").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} exact mapping${n === 1 ? "" : "s"} created`);
      setConfirmBulk(false);
      qc.invalidateQueries({ queryKey: ["mb-mappings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --------------- historical periods --------------- */
  const [periodDates, setPeriodDates] = useState<Record<string, Record<number, { from: string; to: string }>>>({});
  const savePeriods = useMutation({
    mutationFn: async (finding: dm.ReuseFinding) => {
      const dates = periodDates[finding.digits] ?? {};
      const rows = finding.segments.map((seg, i) => {
        const from = dates[i]?.from || seg.firstCall.slice(0, 10);
        const to = dates[i]?.to || null;
        return {
          client_id: clientId!,
          did: finding.digits,
          did_formatted: finding.did,
          creative_name: seg.label,
          platform: "meta",
          effective_from: from,
          effective_to: to,
          notes: `Created from the DID reuse timeline (${finding.field}).`,
        };
      });
      const { error } = await supabase.from("client_did_periods").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} dated period${n === 1 ? "" : "s"} created`);
      qc.invalidateQueries({ queryKey: ["mb-mappings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* --------------- render --------------- */
  if (!gate.allowed) return <Notice tone="warn" title="No access">You do not have access to Media Brain for this client.</Notice>;
  if (gate.loading || dataQ.isLoading)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (!gate.client) return <Notice tone="warn" title="Client not found">This client does not exist or is not assigned to you.</Notice>;
  if (dataQ.error) return <Notice tone="danger" title="The pull failed">{(dataQ.error as Error).message}</Notice>;
  if (!d || !coverage) return null;

  const pct = coverage.realPathPct;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">DID mappings — {gate.client.name}</h1>
        <p className="text-sm text-muted-foreground">
          Window {windowLabel}, stated not inferred. Call and Meta data are read here only; saving writes to the DID
          mapping tables and nothing else.
        </p>
      </div>

      {/* ---------- Coverage meter: the point of the screen ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Join coverage — last {WINDOW_DAYS} days</CardTitle>
          <CardDescription>
            {d.declaredPlatform
              ? `Reading ${d.declaredPlatform.table} (tracking platform "${trackingPlatform}").`
              : d.sourcesWithRows.length
                ? `No tracking platform recorded, so all five call tables were searched. Rows found in: ${d.sourcesWithRows
                    .map((s) => `${s.table} (${s.calls})`)
                    .join(", ")}.`
                : "No tracking platform recorded, and none of the five call tables held rows in this window."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-semibold tabular-nums">{fmtPct(pct)}</p>
                <p className="text-xs text-muted-foreground">
                  of calls resolve on the real path (DID → mapping → creative → Meta ad)
                </p>
              </div>
              <Badge variant={coverage.ready ? "default" : "destructive"}>
                {coverage.ready ? "At or above the 80% threshold" : "Below the 80% threshold"}
              </Badge>
            </div>
            <Progress value={pct === null ? 0 : Math.min(100, pct * 100)} className="mt-3" />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Total calls", n: coverage.totalCalls, p: null as number | null },
              { label: "Real path", n: coverage.realPath, p: coverage.realPathPct },
              { label: "Vertical fallback only", n: coverage.verticalFallback, p: coverage.verticalFallbackPct },
              { label: "Resolve to nothing", n: coverage.unresolved, p: coverage.unresolvedPct },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-lg font-semibold tabular-nums">{fmtNum(c.n)}</p>
                {c.p !== null && <p className="text-xs text-muted-foreground tabular-nums">{fmtPct(c.p)}</p>}
              </div>
            ))}
          </div>

          {!coverage.ready && (
            <Notice tone="danger" title="This client is not ready for a Media Brain pilot">
              Below 80% real-path coverage, most calls cannot be tied to the ad that produced them, so no margin or
              angle comparison on the daily and weekly screens means anything. Mapping the DIDs below is what moves this
              number — each mapping you save recomputes it immediately.
            </Notice>
          )}

          {callerDiag.share !== null && callerDiag.share >= 0.5 && (
            <Notice tone="danger" title="The DID column holds caller numbers, not tracking numbers">
              On {fmtPct(callerDiag.share)} of calls, the value in{" "}
              <code>{d.declaredPlatform?.didColumn ?? "the DID column"}</code> equals the caller's own number. No mapping
              can fix the join in that case — the tracking number is not in the data at all, and the sync has to capture
              it first. This is named rather than worked around.
            </Notice>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="dids">
        <TabsList>
          <TabsTrigger value="dids">Unmapped DIDs ({unmappedStats.length})</TabsTrigger>
          <TabsTrigger value="ads">Meta ads with no DID ({reverse.length})</TabsTrigger>
          <TabsTrigger value="reuse">Reused DIDs ({reuse.length})</TabsTrigger>
        </TabsList>

        {/* ---------------- Unmapped DIDs ---------------- */}
        <TabsContent value="dids" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Sorted by call volume — highest impact first. {fmtNum(d.didRows.length)} mapping
              {d.didRows.length === 1 ? "" : "s"} already exist and are left untouched.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={exactCandidates.length === 0}
              onClick={() => setConfirmBulk(true)}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Accept all exact matches ({exactCandidates.length})
            </Button>
          </div>

          {unmappedStats.length === 0 ? (
            <Notice tone="ok" title="Every DID in this window is mapped">
              Nothing to map. If coverage is still low, the gap is on the Meta side — check the second tab.
            </Notice>
          ) : (
            <div className="space-y-3">
              {unmappedStats.slice(0, 100).map((s) => {
                const draft = draftFor(s.digits);
                const sug = suggestions.get(s.digits) ?? [];
                return (
                  <Card key={s.digits}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base tabular-nums">{s.did}</CardTitle>
                          <CardDescription>
                            {fmtNum(s.calls)} calls · {fmtNum(s.paidCalls)} paid ·{" "}
                            {new Date(s.firstCall).toLocaleDateString()} → {new Date(s.lastCall).toLocaleDateString()}
                          </CardDescription>
                        </div>
                        {s.looksLikeCallerNumber && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Looks like a caller number
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {s.campaigns.length > 0 && <p>Campaigns: {s.campaigns.join(", ")}</p>}
                        {s.creatives.length > 0 && <p>Creatives: {s.creatives.join(", ")}</p>}
                        {s.targets.length > 0 && <p>Buyers: {s.targets.join(", ")}</p>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {sug.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Suggested matches — a proposal, never applied for you
                          </p>
                          {sug.map((x) => (
                            <div
                              key={x.creativeName}
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm ${
                                x.quality === "exact"
                                  ? "border-emerald-400 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                                  : x.quality === "strong"
                                    ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"
                                    : "border-dashed"
                              }`}
                            >
                              <div>
                                <p className="font-medium">{x.adName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {x.platformAdId ? `Meta ad ${x.platformAdId}` : "No platform ad id on this row"} ·{" "}
                                  {x.matchedOn}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={x.quality === "exact" ? "default" : x.quality === "strong" ? "secondary" : "outline"}
                                >
                                  {x.quality === "exact"
                                    ? "Exact match"
                                    : x.quality === "strong"
                                      ? "Strong — check it"
                                      : "Loose — verify before saving"}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setDraft(s.digits, { creative_name: x.creativeName, campaign_name: x.campaignName ?? "" })
                                  }
                                >
                                  Use
                                </Button>
                              </div>
                            </div>
                          ))}
                          <p className="text-xs text-muted-foreground">
                            A wrong mapping silently misattributes every call on this number, which is worse than no
                            mapping. Loose matches are never accepted in bulk.
                          </p>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Creative name" value={draft.creative_name} onChange={(v) => setDraft(s.digits, { creative_name: v })} />
                        <Field label="Platform" value={draft.platform} onChange={(v) => setDraft(s.digits, { platform: v })} />
                        <Field label="Campaign name" value={draft.campaign_name} onChange={(v) => setDraft(s.digits, { campaign_name: v })} />
                        <Field label="Audience cluster" value={draft.audience_cluster} onChange={(v) => setDraft(s.digits, { audience_cluster: v })} />
                        <Field label="Ad length" value={draft.ad_length} onChange={(v) => setDraft(s.digits, { ad_length: v })} />
                        <Field label="Status" value={draft.status} onChange={(v) => setDraft(s.digits, { status: v })} />
                        <div className="sm:col-span-3">
                          <Field label="Notes" value={draft.notes} onChange={(v) => setDraft(s.digits, { notes: v })} />
                        </div>
                      </div>

                      <Button
                        size="sm"
                        disabled={saveOne.isPending || !draft.creative_name.trim()}
                        onClick={() => saveOne.mutate({ stat: s, draft })}
                      >
                        <Save className="mr-1.5 h-3.5 w-3.5" /> Save mapping
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
              {unmappedStats.length > 100 && (
                <p className="text-sm text-muted-foreground">
                  Showing the 100 highest-volume unmapped DIDs of {fmtNum(unmappedStats.length)}.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ---------------- Reverse view ---------------- */}
        <TabsContent value="ads" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Meta ads that no DID maps to — spend with no call attribution. This is the same population the pull reports
            as a tracking flag; seeing it here tells you whether the gap is a missing mapping or an ad that genuinely has
            no tracking number.
            {namingConvention
              ? ` Names are checked against the convention recorded at intake: ${namingConvention}.`
              : " No naming convention is recorded on the Instance record, so the convention check cannot run — it is reported as unknown rather than passed."}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad name</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Ad set</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Naming convention</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reverse.slice(0, 200).map((a) => (
                <TableRow key={a.platformAdId ?? a.adName}>
                  <TableCell className="font-medium">{a.adName}</TableCell>
                  <TableCell className="text-muted-foreground">{a.campaignName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{a.adsetName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(a.spend)}</TableCell>
                  <TableCell>
                    {a.matchesNamingConvention === null ? (
                      <span className="text-xs text-muted-foreground">Not checked — no convention recorded</span>
                    ) : a.matchesNamingConvention ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Matches
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Cannot be grouped by angle or audience
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {reverse.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Every Meta ad in this account resolves to at least one DID mapping.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ---------------- Historical periods ---------------- */}
        <TabsContent value="reuse" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            DIDs whose calls carry more than one creative or campaign with a clean time split. One `client_dids` row
            would be wrong for these — dated periods are what keep the history honest. The boundary is not guessed: the
            timeline is shown and you set the dates.
          </p>
          {reuse.length === 0 ? (
            <Notice tone="info">No DID in this window shows a clean split across creatives.</Notice>
          ) : (
            reuse.slice(0, 25).map((f) => (
              <Card key={`${f.digits}-${f.field}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tabular-nums">{f.did}</CardTitle>
                  <CardDescription>
                    This DID appears to have been reused — {f.segments.length} distinct{" "}
                    {f.field === "creative_name" ? "creative names" : "campaign names"} in sequence.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {f.segments.map((seg, i) => {
                    const dts = periodDates[f.digits]?.[i] ?? { from: seg.firstCall.slice(0, 10), to: "" };
                    return (
                      <div key={seg.label} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
                        <div className="sm:col-span-2">
                          <p className="text-sm font-medium">{seg.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtNum(seg.calls)} calls · seen {new Date(seg.firstCall).toLocaleDateString()} →{" "}
                            {new Date(seg.lastCall).toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs">Effective from</Label>
                          <Input
                            type="date"
                            value={dts.from}
                            onChange={(e) =>
                              setPeriodDates((p) => ({
                                ...p,
                                [f.digits]: { ...(p[f.digits] ?? {}), [i]: { ...dts, from: e.target.value } },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Effective to (blank = current)</Label>
                          <Input
                            type="date"
                            value={dts.to}
                            onChange={(e) =>
                              setPeriodDates((p) => ({
                                ...p,
                                [f.digits]: { ...(p[f.digits] ?? {}), [i]: { ...dts, to: e.target.value } },
                              }))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                  <Button size="sm" disabled={savePeriods.isPending} onClick={() => savePeriods.mutate(f)}>
                    <Save className="mr-1.5 h-3.5 w-3.5" /> Create {f.segments.length} dated periods
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create {exactCandidates.length} mapping{exactCandidates.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates exactly {exactCandidates.length} new row{exactCandidates.length === 1 ? "" : "s"} in the DID
              mapping table, only for DIDs whose call data matches a Meta ad name outright. No existing mapping is
              changed or removed, and no loose or partial match is included.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveBulkExact.mutate()} disabled={saveBulkExact.isPending}>
              Create {exactCandidates.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
