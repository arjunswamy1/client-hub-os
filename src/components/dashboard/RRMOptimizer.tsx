import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, TrendingDown, ArrowDownRight, CheckCircle2, Ban, Scissors, Clock, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildOptimizerPdf } from "@/lib/rrmOptimizerPdf";

import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import {
  RRM_CLIENT_ID, RRMLine, MojaCall, classifyCampaign, platformOfLine, useMojaCalls, useRRMSpend, callLine,
} from "@/hooks/useRRMData";
import { normKey } from "@/hooks/useRRMDrillDown";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toFixed(2)}`;

/** Search queries that signal DIY, price-shopping or non-service intent — they rarely call. */
const WASTE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "DIY / how-to", re: /\b(how to|how do|how can|best way|what works|diy|homemade|home remedy|vinegar|baking soda|snake a|unclog(ging)? (a )?(drain|toilet|sink)?$|myself)\b/i },
  { label: "Price shopper", re: /(\$\s?\d+|\bcheap|\bcheapest|\bfree\b|\bprice(s|ing)?\b|\bcost\b|\bquote\b|\bcoupon\b|\bdeal\b)/i },
  { label: "Job seeker", re: /\b(jobs?|hiring|salary|career|apprentice|school|training|license)\b/i },
  { label: "Non-emergency install", re: /\b(install (a )?(dishwasher|faucet|toilet|sink)|dishwasher install|remodel|replacement parts?|home depot|lowes|parts)\b/i },
  { label: "Info / definition", re: /\b(what is|why is|meaning|symptoms|reddit|youtube|video)\b/i },
];

const wasteReason = (term: string) => WASTE_PATTERNS.find((p) => p.re.test(term))?.label ?? null;

interface KwRow {
  key: string;
  keyword: string;
  matchType: string | null;
  spend: number;
  clicks: number;
  calls: number;
}
interface TermRow {
  term: string;
  keyword: string | null;
  spend: number;
  clicks: number;
  calls: number;
  reason: string | null;
}

function useOptimizerData(line: RRMLine) {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");
  const platform = platformOfLine(line);

  return useQuery({
    queryKey: ["rrm-optimizer", line, from, to],
    queryFn: async () => {
      if (platform === "google") {
        const [kw, st] = await Promise.all([
          supabase
            .from("campaign_keywords")
            .select("keyword, match_type, campaign_name, spend, clicks, date, is_negative")
            .eq("client_id", RRM_CLIENT_ID)
            .or(`date.is.null,and(date.gte.${from},date.lte.${to})`),
          supabase
            .from("search_terms")
            .select("search_term, keyword_text, spend, clicks, date")
            .eq("client_id", RRM_CLIENT_ID)
            .gte("date", from)
            .lte("date", to),
        ]);
        if (kw.error) throw kw.error;
        if (st.error) throw st.error;
        return {
          keywords: (kw.data || []).filter(
            (r: any) => !r.is_negative && classifyCampaign(r.campaign_name, "google") === line,
          ),
          terms: st.data || [],
          creatives: [] as any[],
        };
      }
      const { data, error } = await supabase
        .from("ad_creatives")
        .select("ad_name, platform_ad_id, campaign_name, spend, clicks, impressions, date")
        .eq("client_id", RRM_CLIENT_ID)
        .eq("platform", "meta")
        .or(`date.is.null,and(date.gte.${from},date.lte.${to})`);
      if (error) throw error;
      return { keywords: [] as any[], terms: [] as any[], creatives: data || [] };
    },
  });
}

function Rec({
  tone, icon: Icon, title, impact, children,
}: {
  tone: "critical" | "warn" | "good";
  icon: any;
  title: string;
  impact?: string;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-green-600/40 bg-green-600/5";
  const iconCls =
    tone === "critical" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "text-green-600";
  return (
    <div className={`rounded-md border p-3 ${toneCls}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {impact && <Badge variant="secondary" className="text-[10px]">{impact}</Badge>}
          </div>
          <div className="mt-1 space-y-1.5 text-xs text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Proactive cost-per-raw-call analysis for one service line.
 *
 * Everything here is derived from live data: keyword / creative spend joined to
 * the calls Moja stamped with UTMs, so each recommendation carries the dollars
 * it would move.
 */
export default function RRMOptimizer({ line }: { line: RRMLine }) {
  const platform = platformOfLine(line);
  const { data: calls = [] } = useMojaCalls();
  const { data: spendRows = [] } = useRRMSpend();
  const { data, isLoading } = useOptimizerData(line);

  const lineCalls = useMemo(() => calls.filter((c) => callLine(c) === line), [calls, line]);
  const lineSpend = useMemo(
    () =>
      spendRows
        .filter((r) => classifyCampaign(r.campaign_name, r.platform) === line)
        .reduce((s, r) => s + Number(r.spend || 0), 0),
    [spendRows, line],
  );
  const lineCPRC = lineCalls.length > 0 ? lineSpend / lineCalls.length : 0;

  /** Calls indexed by the UTM that identifies the keyword (Google) or creative (Meta). */
  const callsByTag = useMemo(() => {
    const m = new Map<string, MojaCall[]>();
    for (const c of lineCalls) {
      const tag = normKey(platform === "google" ? c.utm_term : c.utm_content);
      if (!tag) continue;
      const arr = m.get(tag);
      if (arr) arr.push(c);
      else m.set(tag, [c]);
    }
    return m;
  }, [lineCalls, platform]);

  const untagged = useMemo(
    () => lineCalls.filter((c) => !normKey(platform === "google" ? c.utm_term : c.utm_content)).length,
    [lineCalls, platform],
  );

  /**
   * Level rows: keywords for Google, creatives for Meta.
   *
   * Moja's utm_term only carries the keyword text, not the match type, so calls
   * are only resolvable at keyword level — variants of the same keyword across
   * match types are rolled together and the match type is labelled "mixed".
   */
  const rows: KwRow[] = useMemo(() => {
    if (!data) return [];
    const src = platform === "google" ? data.keywords : data.creatives;
    const map = new Map<string, KwRow & { matchTypes: Set<string> }>();
    for (const r of src as any[]) {
      const name = platform === "google" ? r.keyword : r.ad_name || "Unnamed ad";
      if (!name) continue;
      const key = normKey(name);
      const cur =
        map.get(key) ||
        ({ key, keyword: name, matchType: null, matchTypes: new Set<string>(), spend: 0, clicks: 0, calls: 0 } as KwRow & {
          matchTypes: Set<string>;
        });
      if (r.match_type) cur.matchTypes.add(String(r.match_type).toLowerCase());
      cur.spend += Number(r.spend || 0);
      cur.clicks += Number(r.clicks || 0);
      map.set(key, cur);
    }
    for (const row of map.values()) {
      row.calls = (callsByTag.get(row.key) || []).length;
      row.matchType = row.matchTypes.size === 1 ? Array.from(row.matchTypes)[0] : row.matchTypes.size > 1 ? "mixed" : null;
    }
    return Array.from(map.values())
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [data, platform, callsByTag]);


  const terms: TermRow[] = useMemo(() => {
    if (!data || platform !== "google") return [];
    const map = new Map<string, TermRow>();
    for (const r of data.terms as any[]) {
      const term = r.search_term;
      if (!term) continue;
      const key = normKey(term);
      const cur =
        map.get(key) ||
        ({ term, keyword: r.keyword_text ?? null, spend: 0, clicks: 0, calls: 0, reason: wasteReason(term) } as TermRow);
      cur.spend += Number(r.spend || 0);
      cur.clicks += Number(r.clicks || 0);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [data, platform]);

  const label = platform === "google" ? "keyword" : "creative";

  /** Best performer with enough volume to trust — the reallocation target. */
  const benchmark = useMemo(() => {
    const solid = rows.filter((r) => r.calls >= 2);
    if (!solid.length) return null;
    return solid.reduce((best, r) => (r.spend / r.calls < best.spend / best.calls ? r : best));
  }, [rows]);
  const benchCPRC = benchmark ? benchmark.spend / benchmark.calls : 0;

  /** Rows burning money at more than 2x the line's cost per raw call (or no calls at all). */
  const drains = useMemo(() => {
    const floor = Math.max(lineSpend * 0.03, 20); // ignore noise-level rows
    return rows
      .filter((r) => r.spend >= floor && (r.calls === 0 || r.spend / r.calls > lineCPRC * 2))
      .map((r) => ({
        ...r,
        cprc: r.calls > 0 ? r.spend / r.calls : Infinity,
        /** Spend recoverable by cutting to the benchmark's efficiency. */
        recoverable: benchCPRC > 0 ? Math.max(0, r.spend - r.calls * benchCPRC) : r.spend,
      }))
      .sort((a, b) => b.recoverable - a.recoverable);
  }, [rows, lineCPRC, lineSpend, benchCPRC]);

  const wasteTerms = useMemo(
    () => terms.filter((t) => t.reason && t.calls === 0 && t.spend >= 3).sort((a, b) => b.spend - a.spend),
    [terms],
  );
  const wasteTotal = wasteTerms.reduce((s, t) => s + t.spend, 0);

  const zeroCallTerms = useMemo(
    () => terms.filter((t) => !t.reason && t.calls === 0 && t.clicks >= 8).sort((a, b) => b.spend - a.spend),
    [terms],
  );

  /**
   * Match-type efficiency (Google only). Spend and clicks come from the raw
   * keyword rows; a keyword's calls are split across its match types by share of
   * spend, since Moja cannot tell which variant served the impression.
   */
  const byMatch = useMemo(() => {
    if (platform !== "google" || !data) return [];
    const spendByKw = new Map<string, number>();
    for (const r of data.keywords as any[]) {
      if (!r.keyword) continue;
      const k = normKey(r.keyword);
      spendByKw.set(k, (spendByKw.get(k) || 0) + Number(r.spend || 0));
    }
    const m = new Map<string, { spend: number; calls: number; clicks: number }>();
    for (const r of data.keywords as any[]) {
      if (!r.keyword) continue;
      const mt = (r.match_type || "unknown").toLowerCase();
      const spend = Number(r.spend || 0);
      const kwKey = normKey(r.keyword);
      const kwSpend = spendByKw.get(kwKey) || 0;
      const kwCalls = (callsByTag.get(kwKey) || []).length;
      const cur = m.get(mt) || { spend: 0, calls: 0, clicks: 0 };
      cur.spend += spend;
      cur.clicks += Number(r.clicks || 0);
      cur.calls += kwSpend > 0 ? kwCalls * (spend / kwSpend) : 0;
      m.set(mt, cur);
    }
    return Array.from(m.entries())
      .map(([matchType, v]) => ({ matchType, ...v }))
      .sort((a, b) => b.spend - a.spend);
  }, [data, platform, callsByTag]);


  /** Hours where calls land but nobody picks up — raw calls we already pay for and lose. */
  const deadHours = useMemo(() => {
    const m = new Map<number, { raw: number; conn: number }>();
    for (const c of lineCalls) {
      const hr = new Date(c.call_start).getUTCHours();
      const cur = m.get(hr) || { raw: 0, conn: 0 };
      cur.raw += 1;
      if (c.connected) cur.conn += 1;
      m.set(hr, cur);
    }
    const off = Array.from(m.entries()).filter(([hr, v]) => v.conn === 0 && v.raw >= 1 && (hr < 12 || hr >= 24));
    return {
      offHourRaw: off.reduce((s, [, v]) => s + v.raw, 0),
      hours: off.map(([hr]) => hr).sort((a, b) => a - b),
    };
  }, [lineCalls]);

  /** Click-to-call efficiency: how many clicks it takes to produce one call. */
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const clicksPerCall = lineCalls.length > 0 ? clicks / lineCalls.length : 0;

  const totalSavings =
    drains.reduce((s, d) => s + d.recoverable, 0) + (platform === "google" ? wasteTotal : 0);
  const projectedCPRC =
    lineCalls.length > 0 && totalSavings > 0 ? Math.max(0, (lineSpend - totalSavings) / lineCalls.length) : lineCPRC;

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      {/* Headline: where cost per raw call stands and where it could land */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Cost per raw call — optimization plan</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {money(lineSpend)} spend · {lineCalls.length} raw calls · {clicksPerCall ? clicksPerCall.toFixed(1) : "—"}{" "}
              clicks per call. Only raw-call efficiency is scored here; connect and conversion sit with routing and the buyer.
            </p>
          </div>
          <div className="flex items-end gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</p>
              <p className="text-2xl font-semibold">{lineCPRC ? money2(lineCPRC) : "—"}</p>
            </div>
            <ArrowDownRight className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">If actions applied</p>
              <p className="text-2xl font-semibold text-green-600 dark:text-green-400">
                {projectedCPRC ? money2(projectedCPRC) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">{money(totalSavings)} of spend redeployed</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Ranked recommendations */}
      <div className="space-y-3">
        {drains.length > 0 && (
          <Rec
            tone="critical"
            icon={Scissors}
            title={`Cut or cap ${drains.length} ${label}${drains.length === 1 ? "" : "s"} burning ${money(
              drains.reduce((s, d) => s + d.recoverable, 0),
            )}`}
            impact={`${money(drains.reduce((s, d) => s + d.recoverable, 0))} recoverable`}
          >
            <p>
              These {label}s each take a meaningful slice of {line} spend at more than 2x the line's {money2(lineCPRC)}{" "}
              cost per raw call{benchmark ? `, while ${benchmark.keyword} delivers calls at ${money2(benchCPRC)}` : ""}.
              Pause the zero-call rows outright; for the rest, cut bids/budget to the point where they clear{" "}
              {money2(lineCPRC)}.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs capitalize">{label}</TableHead>
                  {platform === "google" && <TableHead className="text-xs">Match</TableHead>}
                  <TableHead className="text-right text-xs">Spend</TableHead>
                  <TableHead className="text-right text-xs">Clicks</TableHead>
                  <TableHead className="text-right text-xs">Calls</TableHead>
                  <TableHead className="text-right text-xs">Cost / raw call</TableHead>
                  <TableHead className="text-right text-xs">Recoverable</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drains.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="max-w-[240px] truncate text-xs font-medium text-foreground">{d.keyword}</TableCell>
                    {platform === "google" && (
                      <TableCell className="text-xs capitalize">{d.matchType || "—"}</TableCell>
                    )}
                    <TableCell className="text-right text-xs">{money2(d.spend)}</TableCell>
                    <TableCell className="text-right text-xs">{d.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs">{d.calls}</TableCell>
                    <TableCell className="text-right text-xs font-medium text-destructive">
                      {d.calls > 0 ? money2(d.cprc) : "no calls"}
                    </TableCell>
                    <TableCell className="text-right text-xs">{money2(d.recoverable)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant={d.calls === 0 ? "destructive" : "secondary"} className="text-[10px]">
                        {d.calls === 0 ? "Pause" : "Cut bid / cap budget"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {benchmark && (
              <p>
                Reallocating that spend at {benchmark.keyword}'s {money2(benchCPRC)} rate would add roughly{" "}
                {Math.floor(drains.reduce((s, d) => s + d.recoverable, 0) / benchCPRC)} extra raw calls for the same
                budget.
              </p>
            )}
          </Rec>
        )}

        {wasteTerms.length > 0 && (
          <Rec
            tone="critical"
            icon={Ban}
            title={`Add ${wasteTerms.length} negative keywords — ${money(wasteTotal)} on non-caller intent`}
            impact={`${money(wasteTotal)} wasted`}
          >
            <p>
              These search terms spent money, produced zero calls, and read as DIY, price-shopping, job-seeking or
              non-emergency intent. Add them (or their root tokens) as campaign-level negatives.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Search term</TableHead>
                  <TableHead className="text-xs">Triggered by</TableHead>
                  <TableHead className="text-xs">Why</TableHead>
                  <TableHead className="text-right text-xs">Spend</TableHead>
                  <TableHead className="text-right text-xs">Clicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wasteTerms.slice(0, 25).map((t) => (
                  <TableRow key={t.term}>
                    <TableCell className="max-w-[240px] truncate text-xs font-medium text-foreground">{t.term}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">{t.keyword || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">{t.reason}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{money2(t.spend)}</TableCell>
                    <TableCell className="text-right text-xs">{t.clicks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Rec>
        )}

        {zeroCallTerms.length > 0 && (
          <Rec
            tone="warn"
            icon={TrendingDown}
            title={`${zeroCallTerms.length} high-click search terms with no calls`}
            impact={`${money(zeroCallTerms.reduce((s, t) => s + t.spend, 0))} at risk`}
          >
            <p>
              Real service intent but the click never turns into a call — usually a landing-page or click-to-call issue
              rather than a query issue. Check that the tracking number renders above the fold on mobile for these
              queries before cutting them.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {zeroCallTerms.slice(0, 18).map((t) => (
                <Badge key={t.term} variant="secondary" className="text-[10px]">
                  {t.term} · {money2(t.spend)} / {t.clicks} clicks
                </Badge>
              ))}
            </div>
          </Rec>
        )}

        {byMatch.length > 1 && (
          <Rec tone="warn" icon={TrendingDown} title="Match-type efficiency">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Match type</TableHead>
                  <TableHead className="text-right text-xs">Spend</TableHead>
                  <TableHead className="text-right text-xs">Clicks</TableHead>
                  <TableHead className="text-right text-xs">Calls</TableHead>
                  <TableHead className="text-right text-xs">Cost / raw call</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMatch.map((m) => (
                  <TableRow key={m.matchType}>
                    <TableCell className="text-xs capitalize">{m.matchType}</TableCell>
                    <TableCell className="text-right text-xs">{money2(m.spend)}</TableCell>
                    <TableCell className="text-right text-xs">{m.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs">{m.calls >= 0.05 ? m.calls.toFixed(1) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">
                      {m.calls >= 0.05 ? money2(m.spend / m.calls) : "no calls"}
                    </TableCell>

                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p>
              Shift budget toward the match type producing calls cheaper, and tighten the other with negatives instead of
              letting broad/phrase variants absorb the difference.
            </p>
          </Rec>
        )}

        {deadHours.offHourRaw > 0 && (
          <Rec
            tone="warn"
            icon={Clock}
            title={`${deadHours.offHourRaw} raw calls arrive in hours with a 0% connect rate`}
          >
            <p>
              Calls land in hours where nothing connects. Every one of those is a raw call you paid for and cannot
              monetize — either add an ad schedule so budget stops flowing in those hours, or get overflow routing in
              place before turning spend back on.
            </p>
          </Rec>
        )}

        {untagged > 0 && (
          <Rec tone="warn" icon={AlertTriangle} title={`${untagged} of ${lineCalls.length} calls carry no UTM`}>
            <p>
              Those calls cannot be scored to a {label}, so the numbers above cover the tagged portion only. Verify the
              tracking template ({platform === "google" ? "utm_term={keyword}" : "utm_content={{ad.name}}"}) is on every{" "}
              {platform === "google" ? "campaign" : "ad"} so the optimization picture is complete.
            </p>
          </Rec>
        )}

        {drains.length === 0 && wasteTerms.length === 0 && (
          <Rec tone="good" icon={CheckCircle2} title="No structural waste detected in this range">
            <p>
              Every {label} with meaningful spend is clearing {money2(lineCPRC)} per raw call. Widen the date range or
              wait for more volume before making cuts.
            </p>
          </Rec>
        )}
      </div>

      {/* Full efficiency ladder */}
      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold capitalize">{label} efficiency ladder</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Every {label} with spend in this range, ranked by cost per raw call. Calls are exact UTM matches only.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs capitalize">{label}</TableHead>
                {platform === "google" && <TableHead className="text-xs">Match</TableHead>}
                <TableHead className="text-right text-xs">Spend</TableHead>
                <TableHead className="text-right text-xs">Clicks</TableHead>
                <TableHead className="text-right text-xs">Calls</TableHead>
                <TableHead className="text-right text-xs">Cost / raw call</TableHead>
                <TableHead className="text-right text-xs">vs line</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No {label} spend synced for this range yet.
                  </TableCell>
                </TableRow>
              )}
              {[...rows]
                .sort((a, b) => (a.calls ? a.spend / a.calls : Infinity) - (b.calls ? b.spend / b.calls : Infinity))
                .map((r) => {
                  const cprc = r.calls ? r.spend / r.calls : null;
                  const delta = cprc && lineCPRC ? cprc / lineCPRC - 1 : null;
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="max-w-[260px] truncate text-xs font-medium">{r.keyword}</TableCell>
                      {platform === "google" && <TableCell className="text-xs capitalize">{r.matchType || "—"}</TableCell>}
                      <TableCell className="text-right text-xs">{money2(r.spend)}</TableCell>
                      <TableCell className="text-right text-xs">{r.clicks.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{r.calls || "—"}</TableCell>
                      <TableCell className="text-right text-xs">{cprc ? money2(cprc) : "no calls"}</TableCell>
                      <TableCell
                        className={`text-right text-xs ${
                          delta == null
                            ? "text-muted-foreground"
                            : delta <= 0
                              ? "text-green-600 dark:text-green-400"
                              : "text-destructive"
                        }`}
                      >
                        {delta == null ? "—" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
