/**
 * PLATFORM-ATTRIBUTED read — the ad platform's own conversion count, shown
 * beside the call-attributed read and never merged with it.
 *
 * Two things this panel refuses to do:
 *  - sum event names. The count is the single event named on the instance record;
 *    the others are listed so a different choice is visible, never added in.
 *  - blend the two reads. Different attribution, different denominators. The
 *    discrepancy is the finding, so it is stated rather than reconciled.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, fmtMoney, fmtNum, fmtPct } from "@/components/mediaBrain/shared";
import { useMediaBrainPlatformConversions } from "@/hooks/useMediaBrainPlatformConversions";
import { compareAttribution } from "@/lib/mediaBrain/platformConversions";
import { Info } from "lucide-react";

interface Props {
  clientId?: string;
  platform: "meta" | "google";
  start: string;
  end: string;
  /** Our own attributed call count for the same window, for the discrepancy line. */
  callAttributedCalls?: number | null;
  callAttributedSpend?: number | null;
}

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google Ads" };

export function PlatformAttributedRead({
  clientId,
  platform,
  start,
  end,
  callAttributedCalls,
  callAttributedSpend,
}: Props) {
  const q = useMediaBrainPlatformConversions(clientId, platform, start, end);

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform-attributed read — {PLATFORM_LABEL[platform]}</CardTitle>
          <CardDescription>Loading the platform's own conversion counts…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (q.error || !q.data) {
    return (
      <Notice tone="danger" title="The platform-attributed read could not be built — this is not a zero">
        {(q.error as Error | undefined)?.message ?? "No data came back."}
      </Notice>
    );
  }

  const { read, noInstance } = q.data;
  const rows = read.rows.filter((r) => r.spend > 0 || (r.conversions ?? 0) > 0);
  const comparison = compareAttribution(
    { event: read.event, count: read.totals.conversions, spend: read.totals.spend },
    { count: callAttributedCalls ?? null, spend: callAttributedSpend ?? null },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Platform-attributed read — {PLATFORM_LABEL[platform]}</CardTitle>
          <Badge variant="outline">platform attributed</Badge>
          {read.state === "counted" ? (
            <Badge variant="outline" className="font-mono text-xs">
              {read.event}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
              UNKNOWN
            </Badge>
          )}
        </div>
        <CardDescription>
          Counted by {PLATFORM_LABEL[platform]}, not by our call records. The two reads sit side by side below and are
          never averaged or reconciled — they use different attribution and different denominators.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {read.state !== "counted" && (
          <Notice
            tone="warn"
            title={
              read.state === "unknown_event"
                ? "UNKNOWN — no governing conversion event is set for this client"
                : `The governing event "${read.event}" recorded nothing in this window`
            }
          >
            <p>{read.note}</p>
            <p className="mt-2">
              This blocks: {read.blocks.join(" · ")}.
              {noInstance && " There is no instance record for this client at all, so there is nowhere to set it yet — run intake."}
            </p>
          </Notice>
        )}

        {/* Side by side — deliberately two columns, never one blended number. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{comparison.platform.label}</p>
            <p className="text-2xl font-semibold">{fmtNum(comparison.platform.count)}</p>
            <p className="text-xs text-muted-foreground">
              {fmtMoney(read.totals.spend)} spend · {fmtMoney(read.totals.costPerConversion)} per conversion ·{" "}
              {fmtMoney(read.totals.value)} reported value
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{comparison.call.label}</p>
            <p className="text-2xl font-semibold">{fmtNum(comparison.call.count)}</p>
            <p className="text-xs text-muted-foreground">
              Our attributed calls for the same window. Not comparable as a ratio — see the gap below.
            </p>
          </div>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">Discrepancy — reported, not reconciled</p>
          <p className="text-muted-foreground">{comparison.statement}</p>
          {comparison.pctOfCall !== null && (
            <p className="text-muted-foreground">
              The platform's count is {fmtPct(comparison.pctOfCall)} above ours in this window.
            </p>
          )}
        </div>

        {read.alternatives.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">
              Other events this account records {read.state === "counted" ? "and we do not count" : ""}
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              Listed so a different governing event is a visible choice. They are never summed: several of these count the
              same call, and adding them would produce a confidently wrong cost per conversion.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Event</th>
                    <th className="py-1 pr-3 text-right">Count</th>
                    <th className="py-1 text-right">Reported value</th>
                  </tr>
                </thead>
                <tbody>
                  {read.alternatives.map((e) => (
                    <tr key={e.event_name} className="border-t">
                      <td className="py-1 pr-3 font-mono text-xs">{e.event_name}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(e.count)}</td>
                      <td className="py-1 text-right">{fmtMoney(e.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Ad level — platform attributed</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Ad</th>
                    <th className="py-1 pr-3 text-right">Spend</th>
                    <th className="py-1 pr-3 text-right">Conversions</th>
                    <th className="py-1 pr-3 text-right">Value</th>
                    <th className="py-1 text-right">Cost / conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((r) => (
                    <tr key={r.entity_ref} className="border-t">
                      <td className="py-1 pr-3">{r.entity_name ?? r.entity_ref}</td>
                      <td className="py-1 pr-3 text-right">{fmtMoney(r.spend)}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(r.conversions)}</td>
                      <td className="py-1 pr-3 text-right">{fmtMoney(r.value)}</td>
                      <td className="py-1 text-right">{fmtMoney(r.costPerConversion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{read.caveat}</span>
        </p>
      </CardContent>
    </Card>
  );
}
