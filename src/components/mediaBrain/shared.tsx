/**
 * Media Brain — shared screen building blocks for the DAILY and WEEKLY views.
 *
 * Nothing here derives a metric. Every number comes from
 * `@/lib/mediaBrain/engine.ts` via `pull.ts`; this file only groups, formats
 * and renders.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §1, §2, §3
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as engine from "@/lib/mediaBrain/engine";
import type { PullRow } from "@/lib/mediaBrain/pull";
import type { ConfidenceState, PayoutMode } from "@/lib/mediaBrain/engine";

/* ------------------------------------------------------------------ *
 * Formatting — null renders as "—", never 0 or "0.00" (§3 display rules)
 * ------------------------------------------------------------------ */

export const fmtMoney = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits });

export const fmtSeconds = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v)}s`;

/* ------------------------------------------------------------------ *
 * §1 — Instance gate. A command run without an Instance record STOPS.
 * ------------------------------------------------------------------ */

export type MbRecord = Record<string, any>;

export interface MbGate {
  loading: boolean;
  allowed: boolean;
  client: MbRecord | null | undefined;
  economics: MbRecord | null | undefined;
  instance: MbRecord | null | undefined;
  staleInstance: MbRecord | null | undefined;
}

/** Loads client, Economics and the current (non-stale) Instance record. */
export function useMediaBrainGate(clientId: string | undefined): MbGate {
  const { isAdmin, isAccountManager } = useAuth();

  const clientQ = useQuery({
    queryKey: ["mb-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, slug").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data as MbRecord | null;
    },
    enabled: !!clientId,
  });

  const ecoQ = useQuery({
    queryKey: ["mb-economics", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_brain_economics")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as MbRecord | null;
    },
    enabled: !!clientId,
  });

  const instQ = useQuery({
    queryKey: ["mb-instance-any", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_brain_instances")
        .select("*")
        .eq("client_id", clientId!)
        .order("computed_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as MbRecord[];
    },
    enabled: !!clientId,
  });

  const all = instQ.data ?? [];
  const current = all.find((i) => !i.is_stale) ?? null;

  return {
    loading: clientQ.isLoading || ecoQ.isLoading || instQ.isLoading,
    allowed: isAdmin || isAccountManager,
    client: clientQ.data,
    economics: ecoQ.data,
    instance: current,
    staleInstance: !current ? (all[0] ?? null) : null,
  };
}

/** The hard stop screens. Returns null when the gate is clear. */
export function GateBlock({ gate, clientId }: { gate: MbGate; clientId?: string }) {
  if (!gate.allowed) {
    return <Notice tone="warn" title="No access">You do not have access to Media Brain for this client.</Notice>;
  }
  if (gate.loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!gate.client) {
    return <Notice tone="warn" title="Client not found">This client does not exist or is not assigned to you.</Notice>;
  }
  if (!gate.instance || !gate.economics) {
    return (
      <Notice tone="danger" title="No Instance record for this client. Run INTAKE first.">
        Every threshold on this screen derives from the client's Instance record. The framework does not fall back on
        defaults — a command run without an Instance record stops.
        {clientId && (
          <div className="mt-3">
            <Button asChild size="sm">
              <a href={`/media-brain/${clientId}/intake`}>Run intake</a>
            </Button>
          </div>
        )}
      </Notice>
    );
  }
  return null;
}

/** Prominent stale warning, shown above everything else when it applies. */
export function StaleWarning({ instance }: { instance: MbRecord }) {
  if (!instance?.is_stale) return null;
  return (
    <Notice tone="danger" title="This Instance record is stale">
      Its thresholds were computed on {instance.computed_at ? new Date(instance.computed_at).toLocaleDateString() : "an unknown date"}.
      Operating on stale thresholds is worse than operating on none. Re-run intake before acting on anything below.
    </Notice>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn" | "danger" | "ok";
  title?: string;
  children?: React.ReactNode;
}) {
  const cls =
    tone === "danger"
      ? "border-destructive/50 bg-destructive/10"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
        : tone === "ok"
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "bg-muted/40";
  return (
    <div className={`rounded-lg border p-4 text-sm ${cls}`}>
      {title && (
        <p className="flex items-center gap-2 font-semibold">
          {(tone === "danger" || tone === "warn") && <AlertTriangle className="h-4 w-4 shrink-0" />}
          {title}
        </p>
      )}
      {children && <div className={title ? "mt-1.5 text-muted-foreground" : ""}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * §2 — Confirm the date range before every pull. Never inferred.
 * ------------------------------------------------------------------ */

export interface ConfirmedWindow {
  start: string;
  end: string;
  timezone: string;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function WindowConfirm({
  defaultStart,
  defaultEnd,
  label,
  confirmed,
  onConfirm,
  onReset,
}: {
  defaultStart: string;
  defaultEnd: string;
  label: string;
  confirmed: ConfirmedWindow | null;
  onConfirm: (w: ConfirmedWindow) => void;
  onReset: () => void;
}) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [timezone, setTimezone] = useState("America/New_York");

  if (confirmed) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm">
            <CalendarCheck className="h-4 w-4 text-emerald-600" />
            <span className="font-medium">Window confirmed:</span>
            <span>
              {confirmed.start} → {confirmed.end}
            </span>
            <Badge variant="outline">{confirmed.timezone}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={onReset}>
            Change window
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>
          State the window explicitly — start, end and timezone — and confirm it. Nothing is pulled until you do, and the
          window is never inferred. An off-by-one window quietly changes every number downstream.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Start (inclusive)</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">End (inclusive)</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button disabled={!start || !end || start > end} onClick={() => onConfirm({ start, end, timezone })}>
          Confirm {start} → {end} ({timezone}) and pull
        </Button>
      </CardContent>
    </Card>
  );
}

export const todayIso = () => isoDay(new Date());
export const daysAgoIso = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

/* ------------------------------------------------------------------ *
 * §3 — Confidence display. Obvious, not a subtle tint.
 * ------------------------------------------------------------------ */

export function ConfidenceBadge({ state }: { state: ConfidenceState }) {
  if (state === "sufficient") {
    return (
      <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-400">
        Sufficient
      </Badge>
    );
  }
  if (state === "decisive_zero") {
    return <Badge variant="destructive">Decisive · zero billable past kill threshold</Badge>;
  }
  return (
    <Badge variant="outline" className="border-muted-foreground/50 bg-muted text-muted-foreground">
      Insufficient data
    </Badge>
  );
}

/** Row styling: insufficient greys out hard; decisive_zero is styled as decisive. */
export function rowClass(state: ConfidenceState) {
  if (state === "insufficient") return "bg-muted/70 text-muted-foreground opacity-60 grayscale";
  if (state === "decisive_zero") return "bg-destructive/10 font-medium";
  return "";
}

/* ------------------------------------------------------------------ *
 * Grouping. Sums only; every metric is recomputed through engine.ts.
 * ------------------------------------------------------------------ */

export interface GroupedRow extends PullRow {
  memberCount: number;
  groupKey: string;
}

export function groupRows(
  rows: PullRow[],
  level: "adset" | "ad",
  payoutMode: PayoutMode,
  killThreshold: number | null,
  minCalls: number | null,
): GroupedRow[] {
  const buckets = new Map<string, { name: string; members: PullRow[] }>();
  for (const r of rows) {
    const key =
      level === "adset"
        ? (r.platform_adset_id ?? r.adset_name ?? r.campaign_name ?? r.entity_ref)
        : r.entity_ref;
    const name =
      level === "adset" ? (r.adset_name ?? r.campaign_name ?? r.entity_name) : r.entity_name;
    const b = buckets.get(key) ?? { name, members: [] };
    b.members.push(r);
    buckets.set(key, b);
  }

  return [...buckets.entries()].map(([key, b]) => {
    const spend = sum(b.members.map((m) => m.spend));
    const revenue = sum(b.members.map((m) => m.revenue));
    const calls = sum(b.members.map((m) => m.calls));
    const connected = sum(b.members.map((m) => m.connected_calls));
    const billable = sum(b.members.map((m) => m.billable_calls));
    const clicks = sum(b.members.map((m) => m.clicks));
    const impressions = sum(b.members.map((m) => m.impressions));
    const payouts = b.members.flatMap((m) => m.payouts);
    const durations = b.members.flatMap((m) => m.durations);
    const first = b.members[0];

    return {
      ...first,
      groupKey: key,
      memberCount: b.members.length,
      entity_ref: key,
      entity_name: b.name,
      spend,
      revenue,
      calls,
      connected_calls: connected,
      billable_calls: billable,
      clicks,
      impressions,
      payouts,
      durations,
      call_ids: b.members.flatMap((m) => m.call_ids),
      costPerCall: engine.costPerCall(spend, calls),
      rpc: engine.rpc(revenue, calls),
      marginPerCall: engine.marginPerCall(revenue, spend, calls),
      profit: engine.profit(revenue, spend),
      marginPct: engine.marginPct(revenue, spend),
      costPerBillableCall: engine.costPerBillableCall(spend, billable),
      callRate: engine.callRate(calls, clicks),
      connectionRate: engine.connectionRate(connected, calls),
      billableRate: engine.billableRate(billable, connected),
      confidenceState: engine.confidenceState(billable, minCalls, spend, killThreshold),
      marginBand: engine.marginBand(engine.marginPct(revenue, spend)),
      medianDurationSeconds: engine.median(durations),
      payoutDistribution: payoutMode === "rtb" ? engine.payoutDistribution(payouts) : null,
    } as GroupedRow;
  });
}

function sum(values: number[]) {
  return values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}
