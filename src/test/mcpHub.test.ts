import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fakeDb } from "./fixtures/fakeDb";
import { handleRpc, sha256Hex, TOOLS, CONTEXT_HEADER } from "../../supabase/functions/mcp-hub/hub";
import { clientHealth, findDuplicateCampaignRows, lateLoads } from "../../supabase/functions/_shared/data-health";
import { loadDayStates } from "../../supabase/functions/_shared/metric-comparison-data";

const NOW = new Date("2026-10-06T15:00:00Z");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, slug: name.toLowerCase(), status: "active", daily_update_enabled: true, engagement_type: "pay_per_call",
  spend_source_tables: ["roku_daily_metrics"], call_source_tables: ["ringfuel_calls"], reporting_timezone: "America/Puerto_Rico",
  publisher_scope: null, aliases: [], ...extra,
});

async function world(opts: { revoked?: boolean; expired?: boolean; scopes?: string[]; admin?: boolean } = {}) {
  const token = "cpm_test_token_123";
  const tables: Record<string, any[]> = {
    agent_tokens: [{ id: "t1", team_member_id: "m1", token_hash: await sha256Hex(token), label: "test", scopes: opts.scopes ?? ["read", "draft"],
      revoked_at: opts.revoked ? "2026-10-01T00:00:00Z" : null, expires_at: opts.expired ? "2026-10-05T00:00:00Z" : null }],
    team_members: [{ id: "m1", name: "Tester", role: opts.admin ? "admin" : "account_manager", is_active: true }],
    client_assignments: [{ team_member_id: "m1", client_id: A }],
    clients: [client(A, "Alpha"), client(B, "Beta")],
    client_daily_updates: [{ id: "u1", client_id: A, for_date: "2026-10-04", status: "sent", draft_text: "sent text", created_at: "2026-10-05T13:00:00Z" }],
    tasks: [{ id: "k1", client_id: A, title: "Fix tracking", status: "todo", assignee_id: "m1", due_date: "2026-10-07" }],
    agent_query_log: [],
  };
  const { db } = fakeDb(tables);
  let n = 0;
  const call = (name: string, args: Record<string, unknown> = {}, auth = `Bearer ${token}`) =>
    handleRpc({ db, now: () => NOW }, auth, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
  return { tables, db, call, token };
}
const sc = (r: any) => (r.body as any).result?.structuredContent;

describe("mcp-hub auth and isolation", () => {
  it("a token scoped to one client gets 'not authorised' — never an empty result — for another", async () => {
    const w = await world();
    const ok = await w.call("get_tasks", { client: "alpha" });
    expect(sc(ok).open_tasks).toHaveLength(1);
    const no = await w.call("get_tasks", { client: "beta" });
    expect((no.body as any).result.isError).toBe(true);
    expect(sc(no).error).toMatch(/not authorised for this client/);
    expect(sc(no).outcome).toBe("not_authorised_client");
    const list = await w.call("list_clients");
    expect(sc(list).clients.map((c: any) => c.name)).toEqual(["Alpha"]);
  });

  it("refuses revoked and expired tokens, and logs the refusal", async () => {
    for (const o of [{ revoked: true }, { expired: true }]) {
      const w = await world(o);
      const r = await w.call("list_clients");
      expect(r.status).toBe(401);
      expect((r.body as any).error.message).toMatch(o.revoked ? /revoked/ : /expired/);
      expect(w.tables.agent_query_log.at(-1).outcome).toBe("refused_auth");
    }
    const w = await world();
    expect((await w.call("list_clients", {}, "Bearer wrong")).status).toBe(401);
  });

  it("draft_update refuses a sent row, and draft tools need the draft scope", async () => {
    const w = await world();
    const r = await w.call("draft_update", { client: "alpha", for_date: "2026-10-04", text: "new" });
    expect(sc(r).outcome).toBe("refused_protected_row");
    const ro = await world({ scopes: ["read"] });
    const r2 = await ro.call("draft_update", { client: "alpha", for_date: "2026-10-05", text: "new" });
    expect(sc(r2).outcome).toBe("refused_scope");
    const r3 = await ro.call("set_current_focus", { client: "alpha", text: "x" });
    expect(sc(r3).outcome).toBe("refused_scope");
  });

  it("every read tool returns provenance with a withheld array, and every call is logged", async () => {
    const w = await world();
    const reads = TOOLS.filter((t) => t.scope === "read" && t.name !== "get_brief"); // get_brief: mcpHubCreative.test.ts
    const argsFor: Record<string, Record<string, unknown>> = {
      list_clients: {}, get_client_profile: { client: "alpha" }, get_performance: { client: "alpha", date_from: "2026-09-28", date_to: "2026-10-04" },
      compare_periods: { client: "alpha", basis: "same_weekday", for_date: "2026-10-04" }, get_data_health: { client: "alpha" },
      get_context: { client: "alpha", days: 2 }, get_tasks: { client: "alpha" }, get_scope_events: { client: "alpha" },
      get_lifetime_performance: { client: "alpha", date_from: "2026-08-15", date_to: "2026-10-04" },
      get_campaign_performance: { client: "alpha", date_from: "2026-09-28", date_to: "2026-10-04" },
      get_creative_queue: {}, get_designer_load: {}, get_creative_history: { client: "alpha" }, get_bot_accuracy: {},
    };
    for (const t of reads) {
      const r = await w.call(t.name, argsFor[t.name]);
      expect((r.body as any).result.isError, `${t.name}: ${JSON.stringify(sc(r))}`).toBeFalsy();
      expect(sc(r).provenance, t.name).toBeDefined();
      expect(Array.isArray(sc(r).provenance.withheld), t.name).toBe(true);
      expect(Array.isArray(sc(r).provenance.tables_read), t.name).toBe(true);
    }
    const ctx = await w.call("get_context", { client: "alpha" });
    expect(sc(ctx).header).toBe(CONTEXT_HEADER);
    await w.call("get_tasks", { client: "beta" }); // a refusal
    expect(w.tables.agent_query_log).toHaveLength(reads.length + 2);
    expect(w.tables.agent_query_log.at(-1).outcome).toBe("not_authorised_client");
  });

  it("missing figures are withheld by name, never returned as zero", async () => {
    const w = await world();
    const r = await w.call("get_performance", { client: "alpha", date_from: "2026-10-01", date_to: "2026-10-04" });
    const p = sc(r);
    for (const m of p.metrics.filter((x: any) => x.value === null && x.key !== "duration_bands")) {
      expect(p.provenance.withheld.map((x: any) => x.metric)).toContain(m.key);
    }
  });
});

describe("campaign daily totals", () => {
  it("sums every campaign into one row per day", async () => {
    const { dailyCampaignTotals } = await import("../../supabase/functions/mcp-hub/hub");
    const out = dailyCampaignTotals([
      { date: "2026-10-02", spend: 10, impressions: 1000, clicks: 5 }, { date: "2026-10-01", spend: 4, impressions: 500, clicks: 1 },
      { date: "2026-10-02", spend: 2.5, impressions: 300, clicks: 2 },
    ]);
    expect(out.map((d) => [d.date, d.spend, d.impressions])).toEqual([["2026-10-01", 4, 500], ["2026-10-02", 12.5, 1300]]);
  });
});

describe("lifetime windows", () => {
  it("splits a range into calendar months with partial ends", async () => {
    const { monthWindows } = await import("../../supabase/functions/mcp-hub/hub");
    expect(monthWindows("2026-08-15", "2026-10-04")).toEqual([
      { from: "2026-08-15", to: "2026-08-31" }, { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-04" },
    ]);
  });
});

// ─── structural guards ───────────────────────────────────────────────────

function reachable(entry: string): string[] {
  const seen = new Set<string>(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)) stack.push(normalize(join(dirname(f), m[1])));
  }
  return [...seen];
}

describe("mcp-hub structural guards", () => {
  const files = reachable("supabase/functions/mcp-hub/index.ts");
  it("cannot reach slack-post.ts, directly or transitively", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.map((f) => f.replace(/\\/g, "/")).filter((f) => f.endsWith("slack-post.ts"))).toEqual([]);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/chat\.postMessage|hooks\.slack\.com/);
  });

  it("issues no delete or upsert, and updates only tokens, focus and draft-status updates", () => {
    const allowed = new Set(["agent_tokens", "clients", "client_daily_updates", "slack_outbox", "designer_checkins"]);
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      expect(body, f).not.toMatch(/\.delete\(/);
      expect(body, f).not.toMatch(/\.upsert\(/);
      for (const m of body.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)\s*\.update\(([^;]*);/g)) {
        expect(allowed.has(m[1]), `${f}: update on ${m[1]}`).toBe(true);
        if (m[1] === "client_daily_updates") expect(m[2]).toMatch(/\.eq\('status', 'draft'\)/);
        if (m[1] === "slack_outbox") expect(m[2]).toMatch(/\.eq\('status', 'pending'\)/);
      }
    }
  });
});

// ─── data-health live fixtures ───────────────────────────────────────────

describe("get_data_health fixtures", () => {
  it("PPC Media: the same spend stored under several campaign names", () => {
    const name = "Home Insurance -English - Click to Call - CBO";
    const d = findDuplicateCampaignRows([
      { date: "2026-09-25", campaign_name: name, spend: 133.71 },
      { date: "2026-09-25", campaign_name: `N/A ${name}`, spend: 133.71 },
      { date: "2026-09-25", campaign_name: `${name} (Previous)`, spend: 133.71 },
      { date: "2026-09-25", campaign_name: "Auto", spend: 50 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ date: "2026-09-25", spend: 133.71 });
    expect(d[0].names).toHaveLength(3);
  });

  it("Jacuzzi: weekend leads loaded at 09:30 ET after the 09:00 draft, and its config mismatch", async () => {
    const J = "dc25f274-20f4-4650-b0cc-654073b925f4";
    const lead = (i: number, date: string) => ({ id: `l${i}`, client_id: J, transaction_date: date, created_at: "2026-10-05T13:30:01Z", lead_type: "call", payout_rate: 330 });
    const late = lateLoads([lead(1, "2026-10-04"), lead(2, "2026-10-04")].map((l) => ({ day: l.transaction_date, created_at: l.created_at })),
      new Map([["2026-10-04", "2026-10-05T13:00:00.000Z"]]));
    expect(late[0]).toMatchObject({ day: "2026-10-04", late: 2, total: 2 });

    const { db } = fakeDb({
      jacuzzi_leads: [lead(1, "2026-10-03"), lead(2, "2026-10-04"), lead(3, "2026-10-04")],
      client_daily_updates: [{ client_id: J, for_date: "2026-10-04", created_at: "2026-10-05T13:00:00Z" }],
      roku_daily_metrics: [{ client_id: J, date: "2026-10-04", entity: "campaign", spend: 300, impressions: 1000, created_at: "2026-10-05T12:00:00Z" }],
    });
    const h = await clientHealth(db, client(J, "Jacuzzi", { slug: "jacuzzi" }) as any, NOW);
    const after = h.checks.find((c) => c.check === "loaded_after_run" && c.source === "jacuzzi_leads")!;
    expect(after.status).toBe("warn");
    expect(after.explanation).toMatch(/2026-10-04/);
    const cfg = h.checks.find((c) => c.check === "config_mismatch")!;
    expect(cfg.status).toBe("warn");
    expect(cfg.explanation).toMatch(/jacuzzi_leads/);
  });

  it("Spektrafin: structurally dark Sundays are no_delivery, not missing", async () => {
    const S = "6386d309-519a-415d-9480-70c9c6d64436";
    const rows = [];
    for (let d = new Date("2026-09-20T12:00:00Z"); d <= new Date("2026-10-04T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      rows.push({ client_id: S, date: iso, entity: "campaign", spend: d.getUTCDay() === 0 ? 0 : 900, impressions: d.getUTCDay() === 0 ? 0 : 50000 });
    }
    const { db } = fakeDb({ roku_daily_metrics: rows });
    const days = await loadDayStates(db, client(S, "Spektrafin") as any, "2026-09-20", "2026-10-04");
    for (const sun of ["2026-09-20", "2026-09-27", "2026-10-04"]) expect(days.find((x) => x.date === sun)!.state).toBe("no_delivery");
    expect(days.filter((x) => x.state === "missing")).toEqual([]);
  });
});

describe("get_schema", () => {
  it("lists tables without platform_connections or any token, carries gotchas, and is audited", async () => {
    const w = await world();
    const r = await w.call("get_schema");
    const out = sc(r);
    expect(Object.keys(out.tables)).not.toContain("platform_connections");
    expect(Object.keys(out.tables)).toContain("platform_connections_safe");
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(w.token);
    expect(text).not.toMatch(/"(access_token|refresh_token|token_hash)"/);
    expect(out.gotchas.some((g: any) => g.wrong === "update_date" && g.right === "for_date")).toBe(true);
    expect(out.shared_table_warnings.map((x: any) => x.table)).toEqual(["ringfuel_calls", "cannaball_calls"]);
    const one = sc(await w.call("get_schema", { table: "ringba_calls" }));
    expect(one.columns.map((c: any) => c.name)).toContain("call_date");
    const pc = await w.call("get_schema", { table: "platform_connections" });
    expect((pc.body as any).result.isError).toBe(true);
    expect(w.tables.agent_query_log.some((l: any) => l.tool_name === "get_schema")).toBe(true);
  });
  it("refuses a revoked token", async () => {
    const w = await world({ revoked: true });
    const r = await w.call("get_schema");
    expect((r.body as any).error.message).toMatch(/revoked/);
  });
});

describe("platform_connections select-star guard", () => {
  it("no edge function selects * from platform_connections", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
    const bad: string[] = [];
    for (const f of walk("supabase/functions")) {
      const s = readFileSync(f, "utf8");
      const re = /from\(\s*["'`]platform_connections["'`]\s*\)\s*\.select\(\s*(["'`])\s*\*\s*\1/g;
      if (re.test(s) || /select\s+\*\s+from\s+(public\.)?platform_connections\b(?!_safe)/i.test(s)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});

describe("mcp-hub Claude sign-in (OAuth)", () => {
  const JWT = "aaa.bbb.ccc";
  async function oauthWorld(role: string, opts: { verified?: boolean; member?: boolean } = {}) {
    const tables: Record<string, any[]> = {
      agent_tokens: [],
      team_members: opts.member === false ? [] : [{ id: "m9", user_id: "u9", name: "Sam", role, is_active: true }],
      client_assignments: [{ team_member_id: "m9", client_id: A }],
      clients: [client(A, "Alpha"), client(B, "Beta")],
      client_daily_updates: [], tasks: [], agent_query_log: [],
    };
    const { db } = fakeDb(tables);
    const verifyOAuth = async (t: string) => (opts.verified === false || t !== JWT ? null : { userId: "u9", clientId: "claude-client" });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      handleRpc({ db, now: () => NOW, verifyOAuth }, `Bearer ${JWT}`, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    return { tables, call };
  }

  it("a signed-in account manager sees only assigned clients, and the call is logged as oauth", async () => {
    const w = await oauthWorld("account_manager");
    expect(sc(await w.call("list_clients")).clients.map((c: any) => c.name)).toEqual(["Alpha"]);
    expect(sc(await w.call("get_tasks", { client: "beta" })).outcome).toBe("not_authorised_client");
    const log = w.tables.agent_query_log.at(-1);
    expect(log.auth_method).toBe("oauth");
    expect(log.oauth_client_id).toBe("claude-client");
    expect(log.token_id).toBeNull();
  });

  it("refuses an invalid sign-in, a non-team account, and a client-portal role", async () => {
    for (const [role, o, re] of [["admin", { verified: false }, /invalid/], ["admin", { member: false }, /not a Connect Paid Media team member/], ["client", {}, /may not use/]] as const) {
      const w = await oauthWorld(role, o as any);
      const r = await w.call("list_clients");
      expect(r.status).toBe(401);
      expect((r.body as any).error.message).toMatch(re);
      expect(w.tables.agent_query_log.at(-1).outcome).toBe("refused_auth");
    }
  });

  it("designers get read only — draft tools are refused", async () => {
    const w = await oauthWorld("designer");
    const r = await w.call("draft_update", { client: "alpha", for_date: "2026-10-05", text: "x" });
    expect(JSON.stringify(r.body)).toMatch(/scope/i);
    expect(w.tables.client_daily_updates).toHaveLength(0);
  });
});
