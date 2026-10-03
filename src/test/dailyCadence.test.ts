import { describe, expect, it } from "vitest";
import {
  deriveCallDay, effectiveMode, focusIsStale, isClientCallDay, renderHolding, resolveDailyMode, type ModeDay,
} from "../../supabase/functions/_shared/client-cadence";
import {
  classifyWindow, compare, isProvisional, renderDailyComparison, type ComparisonSet, type Snapshot,
} from "../../supabase/functions/_shared/metric-comparisons";
import { snapshotFrom, type SeriesDay } from "../../supabase/functions/_shared/metric-comparison-data";
import { dayEndsAt, reportingYesterday } from "../../supabase/functions/_shared/reporting-day";

const dates = (end: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (n - 1 - i)); return d.toISOString().slice(0, 10);
});
const wd = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

describe("auto daily comparison mode", () => {
  it("Spektrafin resolves to same_weekday: dark Sundays, light Saturdays", () => {
    // Shape of the live account: ~$19.9k Mon 28 Sep, $0.00 Sun 27 Sep (rows at $0), Saturdays light.
    const h: ModeDay[] = dates("2026-10-02", 28).map((date) => {
      const w = wd(date);
      if (w === 0) return { date, state: "no_delivery", spend: 0 };
      return { date, state: "available", spend: w === 6 ? 6588 : w === 1 ? 19934 : 18000 };
    });
    expect(resolveDailyMode(h).mode).toBe("same_weekday");
    expect(resolveDailyMode(h).reason).toMatch(/weekday-shaped/);
  });
  it("Hablyte resolves to prior_day: a flat couple of dollars a day", () => {
    const h: ModeDay[] = dates("2026-10-02", 28).map((date, i) => ({ date, state: "available", spend: 2 + (i % 3) * 0.5 }));
    expect(resolveDailyMode(h).mode).toBe("prior_day");
  });
  it("thin history (< 14 available days) resolves to same_weekday and says so", () => {
    const h: ModeDay[] = dates("2026-10-02", 28).map((date, i) => ({ date, state: i < 18 ? "missing" : "available", spend: 5 }));
    const r = resolveDailyMode(h);
    expect(r.mode).toBe("same_weekday");
    expect(r.reason).toMatch(/thin/);
  });
  it("a manual mode always wins over auto", () => {
    expect(effectiveMode({ daily_comparison_mode: "prior_day", daily_comparison_mode_resolved: "same_weekday" }, []).mode).toBe("prior_day");
    expect(effectiveMode({ daily_comparison_mode: "auto", daily_comparison_mode_resolved: "same_weekday" }, []).source).toBe("stored_auto");
  });
});

const snap = (from: string, p: Partial<Snapshot> = {}, to = from): Snapshot => ({
  from, to, state: "available", spend: 1000, revenue: 1200, calls: 100, connected: 80, billable: 40, impressions: 50000, ...p,
});
const PM = { engagement: "performance_media", reliableFrom: null };
const settled = { provisional: false, reason: null, tracked: true };
const set = (weekCur = snap("2026-09-26", {}, "2026-10-02"), weekBase = snap("2026-09-19", { spend: 900 }, "2026-09-25")): ComparisonSet => ({
  client: "RRM", engagement: "performance_media", forDate: "2026-10-02", reliableFrom: null, day: snap("2026-10-02"),
  provisional: settled,
  comparisons: [
    compare("vs_same_weekday", snap("2026-10-02"), snap("2026-09-25", { spend: 900 }), PM),
    compare("vs_prior_day", snap("2026-10-02"), snap("2026-10-01", { spend: 950 }), PM),
    compare("vs_prior_week", weekCur, weekBase, PM),
  ],
});

describe("client call day gating", () => {
  it("the weekly rollup appears only on the call day", () => {
    expect(renderDailyComparison(set(), { mode: "same_weekday", weekly: true })).toMatch(/7d vs prior 7d/);
    const daily = renderDailyComparison(set(), { mode: "same_weekday", weekly: false });
    expect(daily).not.toMatch(/7d vs prior 7d/);
    expect(daily).toMatch(/vs last Fri/);
    expect(daily).not.toMatch(/vs Thu/); // one daily comparison, not three
  });
  it("prior_day mode carries the day-over-day line instead", () => {
    const t = renderDailyComparison(set(), { mode: "prior_day", weekly: false });
    expect(t).toMatch(/vs Thu/);
    expect(t).not.toMatch(/vs last Fri/);
  });
  it("RRM (Tuesday) gets it on a Tuesday; a null call day never does", () => {
    expect(isClientCallDay({ client_call_day: 2 }, "2026-10-06")).toBe(true);
    expect(isClientCallDay({ client_call_day: 2 }, "2026-10-05")).toBe(false);
    for (const d of dates("2026-10-10", 7)) expect(isClientCallDay({ client_call_day: null }, d)).toBe(false);
  });
});

describe("call day from Wispr", () => {
  const now = new Date("2026-10-03T22:00:00Z");
  it("RRM: three Tuesdays in six weeks seeds Tuesday", () => {
    const r = deriveCallDay(["2026-09-08T17:30:00Z", "2026-09-15T17:30:00Z", "2026-09-29T17:30:00Z"].map((occurred_at) => ({ occurred_at })), "America/New_York", now);
    expect(r.day).toBe(2);
  });
  it("three meetings on ONE Friday count once — not enough", () => {
    const r = deriveCallDay(["2026-09-11T17:00:00Z", "2026-09-11T17:07:48Z", "2026-09-11T19:30:00Z"].map((occurred_at) => ({ occurred_at })), "America/New_York", now);
    expect(r.day).toBeNull();
  });
  it("BuyologyIQ: two Mondays and a Wednesday stays null for a human", () => {
    const r = deriveCallDay(["2026-09-09T18:30:00Z", "2026-09-14T18:30:00Z", "2026-09-28T18:30:00Z"].map((occurred_at) => ({ occurred_at })), "America/New_York", now);
    expect(r.day).toBeNull();
    expect(r.counts.Monday).toBe(2);
  });
});

describe("5-of-7 coverage", () => {
  const A = "available" as const, D = "no_delivery" as const, M = "missing" as const;
  it("five available days are comparable; four are not", () => {
    expect(classifyWindow([A, A, A, A, A, D, M]).state).toBe("available");
    const four = classifyWindow([A, A, A, A, D, D, M]);
    expect(four.state).not.toBe("available");
    expect(four.note).toMatch(/only 4 of 7 days had delivery/);
  });
  it("sums only available days and states the coverage", () => {
    const series = dates("2026-10-02", 14).map((date, i) => ({
      date, state: (i === 5 || i === 12 ? "missing" : "available"), spend: i === 5 || i === 12 ? null : 100,
      calls: 20, revenue: 150, connected: 15, converted: 5, impressions: null, spendRows: 1, trackedCalls: 20, bands: {} as any, sourceStates: [],
    })) as SeriesDay[];
    const w = snapshotFrom(series, "2026-09-26", "2026-10-02");
    expect(w.coverage).toEqual({ days: 6, of: 7 });
    expect(w.spend).toBe(600);
    const t = renderDailyComparison(set(w, snapshotFrom(series, "2026-09-19", "2026-09-25")), { mode: "same_weekday", weekly: true });
    expect(t).toMatch(/7d vs prior 7d \(6 of 7 days\)/);
  });
});

describe("provisionality", () => {
  const closed = dayEndsAt("2026-10-02", "America/New_York");
  const o = (t: string, spend: number) => ({ source: "ad_daily_metrics", observed_at: t, spend, revenue: null, calls: null });
  it("a settled day at 9am emits no provisionality line", () => {
    const p = isProvisional({ observations: [o("2026-10-03T05:00:00Z", 100), o("2026-10-03T11:00:00Z", 100.5)], closedAt: closed, trackedSources: ["ad_daily_metrics"] });
    expect(p.provisional).toBe(false);
    const s = { ...set(), provisional: p };
    expect(renderDailyComparison(s, { mode: "same_weekday", weekly: false })).not.toMatch(/provisional|⚠/);
  });
  it("no observation after the day closed is provisional", () => {
    expect(isProvisional({ observations: [o("2026-10-02T20:00:00Z", 100)], closedAt: closed, trackedSources: ["ad_daily_metrics"] }).provisional).toBe(true);
  });
  it("an untracked feed is not guessed either way", () => {
    expect(isProvisional({ observations: [], closedAt: closed, trackedSources: [] })).toEqual({ provisional: false, reason: null, tracked: false });
  });
});

describe("holding mode", () => {
  const now = new Date("2026-10-03T13:00:00Z");
  const h = {
    client: "Connatria", forDate: "2026-10-02", sourceStates: [{ source: "ad_daily_metrics", state: "missing" as const }],
    daysWithoutDelivery: null, darkDays: 0, missingDays: 28, callsOnDay: 0, lastDelivery: null,
    focus: { text: "Lifting the Meta daily spend cap.", updatedAt: "2026-10-03T10:00:00Z" }, now,
  };
  it("names how long, which kind, the last delivery and the focus — no percentages", () => {
    const t = renderHolding(h);
    expect(t).toMatch(/no data recorded/);
    expect(t).not.toMatch(/dark/);
    expect(t).toMatch(/No delivery recorded yet/);
    expect(t).toMatch(/What we're working on: Lifting the Meta daily spend cap\./);
    expect(t).not.toMatch(/%|vs /);
    expect(t.length).toBeLessThan(400);
  });
  it("dark and no-data-recorded are never collapsed", () => {
    const t = renderHolding({ ...h, sourceStates: [{ source: "roku_daily_metrics", state: "no_delivery" }, { source: "cannaball_spend", state: "missing" }],
      daysWithoutDelivery: 3, darkDays: 2, missingDays: 1, lastDelivery: { date: "2026-09-29", spend: 1200, calls: 80, revenue: null } });
    expect(t).toMatch(/dark — spend recorded at \$0/);
    expect(t).toMatch(/no data recorded/);
    expect(t).toMatch(/2 dark, 1 with no data recorded/);
    expect(t).toMatch(/Last delivery: Tue 29 Sep — \$1,200 spend, 80 calls/);
  });
  it("a focus older than 7 days is printed and flagged as possibly stale", () => {
    const t = renderHolding({ ...h, focus: { text: "Lifting the cap.", updatedAt: "2026-09-20T10:00:00Z" } });
    expect(t).toMatch(/may be stale/);
    expect(t).toMatch(/Lifting the cap\./);
    expect(focusIsStale("2026-09-30T10:00:00Z", now)).toBe(false);
  });
});

describe("timezone helper", () => {
  it("null timezone falls back to America/New_York; DST-correct close", () => {
    expect(reportingYesterday("America/New_York", new Date("2026-10-03T02:00:00Z"))).toBe("2026-10-01");
    expect(dayEndsAt("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(dayEndsAt("2026-03-07", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(dayEndsAt("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});
