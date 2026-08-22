import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, CalendarClock, Eye, History, Loader2, PlayCircle, Save } from "lucide-react";
import { ProductLine, productLineLabel } from "@/lib/buyologyProductLines";
import {
  Cadence, OptimizerBrief, useOptimizerBriefs, useOptimizerSchedule, useSaveOptimizerSchedule,
} from "@/hooks/useOptimizerSchedule";

const LINES: ProductLine[] = ["tubs", "bath"];
const money2 = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

function Delta({ value, invert = false, format }: { value: number | null; invert?: boolean; format?: (n: number) => string }) {
  if (value === null || !isFinite(value) || Math.abs(value) < 0.005) return <span className="text-[10px] text-muted-foreground">—</span>;
  const good = invert ? value < 0 : value > 0;
  const text = format ? format(value) : `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
  return (
    <span className={`text-[10px] font-medium ${good ? "text-emerald-600" : "text-destructive"}`}>
      {value > 0 && !format ? "" : ""}{text}
    </span>
  );
}

export default function BuyologyOptimizerSchedule({
  clientId,
  onViewBrief,
}: {
  clientId: string;
  onViewBrief?: (brief: OptimizerBrief) => void;
}) {
  const { data: schedule, isLoading } = useOptimizerSchedule(clientId);
  const { data: briefs = [], isLoading: briefsLoading } = useOptimizerBriefs(clientId);
  const save = useSaveOptimizerSchedule(clientId);

  const [enabled, setEnabled] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [hour, setHour] = useState(12);
  const [lines, setLines] = useState<ProductLine[]>(LINES);
  const [notes, setNotes] = useState("");
  const [historyLine, setHistoryLine] = useState<ProductLine>("tubs");

  useEffect(() => {
    if (!schedule) return;
    setEnabled(schedule.enabled);
    setCadence(schedule.cadence);
    setHour(schedule.run_hour_utc ?? 12);
    setLines((schedule.product_lines || LINES).filter((l): l is ProductLine => l === "tubs" || l === "bath"));
    setNotes(schedule.notes || "");
  }, [schedule]);

  const persist = async (patch: Record<string, unknown>, message: string) => {
    try {
      await save.mutateAsync(patch as any);
      toast({ title: message });
    } catch (e: any) {
      toast({ title: "Could not save the schedule", description: String(e?.message || e).slice(0, 200), variant: "destructive" });
    }
  };

  const onSave = () =>
    persist(
      {
        enabled,
        cadence,
        run_hour_utc: hour,
        product_lines: lines.length ? lines : LINES,
        notes: notes.trim() || null,
        // Turning the schedule on (re)arms the next run for the chosen slot.
        next_run_at: enabled ? null : schedule?.next_run_at ?? null,
      },
      enabled ? `Optimizer will run ${cadence} at ${String(hour).padStart(2, "0")}:00 UTC` : "Automatic runs turned off"
    );

  const resume = () =>
    persist({ status: "active", pause_reason: null, paused_at: null, last_error: null, next_run_at: null }, "Schedule resumed");

  const lineBriefs = useMemo(
    () => briefs.filter((b) => b.product_line === historyLine),
    [briefs, historyLine]
  );

  const rows = lineBriefs.map((b, idx) => {
    const prev = lineBriefs[idx + 1];
    const t = b.totals || {};
    const p = prev?.totals || null;
    const d = (k: string) => (p && p[k] !== undefined ? Number(t[k] || 0) - Number(p[k] || 0) : null);
    return { brief: b, t, cpqcDelta: d("cost_per_qualified_call"), cplDelta: d("cost_per_raw_call"), callsDelta: d("raw_calls"), qualDelta: d("qualified_calls_60s") };
  });

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" /> Automatic optimizer runs
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Generates a fresh brief on its own and stores it by date so you can compare week over week.
              One brief per product line per period — reruns of the same period replace it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isLoading} />
          </div>
        </div>

        {schedule?.status === "paused" && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Automatic runs are paused
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{schedule.pause_reason}</p>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={resume}>
              <PlayCircle className="h-3.5 w-3.5" /> Resume
            </Button>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium">Frequency</label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
              <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Run at (UTC)</label>
            <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
              <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00 UTC</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Product lines</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {LINES.map((l) => {
                const on = lines.includes(l);
                return (
                  <Button
                    key={l}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-8 text-[11px]"
                    onClick={() => setLines(on ? lines.filter((x) => x !== l) : [...lines, l])}
                  >
                    {productLineLabel(l)}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium">Standing context for scheduled runs (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. daily budget cap is $500 per campaign, Belu reviews briefs Monday mornings…"
            className="mt-1 min-h-[56px] text-xs"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            {schedule?.next_run_at
              ? <>Next run {new Date(schedule.next_run_at).toLocaleString()}</>
              : enabled ? <>Next run at the next {String(hour).padStart(2, "0")}:00 UTC check</> : <>No runs scheduled</>}
            {schedule?.last_run_at && <> · Last run {new Date(schedule.last_run_at).toLocaleString()}</>}
            {schedule?.last_error && <span className="text-destructive"> · {schedule.last_error.slice(0, 120)}</span>}
          </div>
          <Button size="sm" className="gap-1.5" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save schedule
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-primary" /> Brief history
          </h3>
          <div className="flex gap-1.5">
            {LINES.map((l) => (
              <Button
                key={l}
                size="sm"
                variant={historyLine === l ? "default" : "outline"}
                className="h-8 text-[11px]"
                onClick={() => setHistoryLine(l)}
              >
                {productLineLabel(l)}
              </Button>
            ))}
          </div>
        </div>

        {briefsLoading ? (
          <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted" />
        ) : rows.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No stored briefs yet for {productLineLabel(historyLine)} — generate one or turn on automatic runs.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Generated</TableHead>
                  <TableHead className="text-[11px]">Period</TableHead>
                  <TableHead className="text-[11px]">Source</TableHead>
                  <TableHead className="text-right text-[11px]">Spend</TableHead>
                  <TableHead className="text-right text-[11px]">Calls</TableHead>
                  <TableHead className="text-right text-[11px]">Qualified</TableHead>
                  <TableHead className="text-right text-[11px]">CPQC</TableHead>
                  <TableHead className="text-right text-[11px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ brief, t, cpqcDelta, callsDelta, qualDelta }) => (
                  <TableRow key={brief.id}>
                    <TableCell className="whitespace-nowrap text-[11px]">{new Date(brief.generated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-[11px]">{brief.period_key}</TableCell>
                    <TableCell>
                      <Badge variant={brief.source === "scheduled" ? "secondary" : "outline"} className="text-[10px]">
                        {brief.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-[11px]">{money(Number(t.meta_spend || 0))}</TableCell>
                    <TableCell className="text-right text-[11px]">
                      {Number(t.raw_calls || 0).toLocaleString()}{" "}
                      <Delta value={callsDelta} />
                    </TableCell>
                    <TableCell className="text-right text-[11px]">
                      {Number(t.qualified_calls_60s || 0).toLocaleString()} <Delta value={qualDelta} />
                    </TableCell>
                    <TableCell className="text-right text-[11px]">
                      {t.cost_per_qualified_call ? money2(Number(t.cost_per_qualified_call)) : "—"}{" "}
                      <Delta value={cpqcDelta} invert format={(n) => `${n > 0 ? "+" : "−"}${money2(Math.abs(n))}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => onViewBrief?.(brief)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
