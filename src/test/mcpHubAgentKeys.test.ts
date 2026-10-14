import { describe, it, expect } from "vitest";
import { fakeDb } from "./fixtures/fakeDb";
import { handleRpc, sha256Hex, HUB_AGENT_TOOLS } from "../../supabase/functions/mcp-hub/hub";

const NOW = new Date("2026-10-14T15:00:00Z");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const BRIEF_A = "11111111-0000-0000-0000-000000000001";
const BRIEF_B = "22222222-0000-0000-0000-000000000002";
const client = (id: string, name: string) => ({ id, name, slug: name.toLowerCase(), status: "active", daily_update_enabled: true, aliases: [], spend_source_tables: [], call_source_tables: [] });
const brief = (id: string, client_id: string) => ({ id, client_id, title: `Brief ${id.slice(0, 2)}`, status: "in_design", priority: "medium", due_date: "2026-10-20", updated_at: "2026-10-10T00:00:00Z", created_at: "2026-10-01T00:00:00Z", deleted_at: null });

async function world(opts: { audience?: string; agentStatus?: string; revoked?: boolean; ownerAssignedB?: boolean } = {}) {
  const key = "cpmg_hub_key_juan";
  const tables: Record<string, any[]> = {
    agent_tokens: [],
    agent_gateway_tokens: [{ id: "g1", agent_id: "ag1", token_hash: await sha256Hex(key), audience: opts.audience ?? "hub", label: "Juan bot", expires_at: "2027-01-01T00:00:00Z", revoked_at: opts.revoked ? "2026-10-13T00:00:00Z" : null }],
    agents: [{ id: "ag1", name: "Juan's Grok Bot", status: opts.agentStatus ?? "active", owner_team_member_id: "m1" }],
    agent_client_scopes: [{ agent_id: "ag1", client_id: A }, ...(opts.ownerAssignedB ? [{ agent_id: "ag1", client_id: B }] : [])],
    team_members: [{ id: "m1", name: "Juan", role: "account_manager", is_active: true, is_service_account: false }],
    // The owner is assigned to both; the agent's own list is narrower.
    client_assignments: [{ team_member_id: "m1", client_id: A }, { team_member_id: "m1", client_id: B }],
    clients: [client(A, "Alpha"), client(B, "Beta")],
    tasks: [{ id: "k1", client_id: A, title: "A task", status: "todo" }, { id: "k2", client_id: B, title: "B task", status: "todo" }],
    creative_briefs: [brief(BRIEF_A, A), brief(BRIEF_B, B)],
    creative_brief_comments: [], creative_brief_status_history: [], creative_deliverables: [], creative_time_entries: [], creative_reviews: [],
    agent_query_log: [], agent_access_log: [], client_daily_updates: [],
  };
  const { db } = fakeDb(tables);
  const rpc: any[] = [];
  (db as any).rpc = async (fn: string, p: any) => {
    rpc.push({ fn, p });
    if (fn === "agent_write_creative_brief") {
      const b = tables.creative_briefs.find((x) => x.id === p.p_brief_id);
      const before = { ...b }; Object.assign(b, p.p_patch, { updated_at: NOW.toISOString() });
      return { data: { outcome: "ok", before, after: { ...b } }, error: null };
    }
    return { data: null, error: null };
  };
  let n = 0;
  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleRpc({ db, now: () => NOW }, `Bearer ${key}`, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
  const list = () => handleRpc({ db, now: () => NOW }, `Bearer ${key}`, { jsonrpc: "2.0", id: ++n, method: "tools/list" });
  return { tables, call, list, rpc };
}
const sc = (r: any) => (r.body as any).result?.structuredContent;
const denied = (w: any) => w.tables.agent_access_log.filter((r: any) => r.event_type === "denied");

describe("per-person hub keys", () => {
  it("list_clients shows only the agent's allowed clients", async () => {
    const w = await world();
    expect(sc(await w.call("list_clients")).clients.map((c: any) => c.name)).toEqual(["Alpha"]);
  });

  it("reading another client is refused and logged as denied", async () => {
    const w = await world();
    const r = await w.call("get_tasks", { client: "beta" });
    expect(sc(r).outcome).toBe("not_authorised_client");
    expect(denied(w)).toHaveLength(1);
    expect(denied(w)[0]).toMatchObject({ auth_surface: "hub", agent_id: "ag1", tool: "get_tasks", client_id: B });
  });

  it("creative queue and briefs show only allowed clients; another client's brief is refused", async () => {
    const w = await world();
    const q = sc(await w.call("get_creative_queue"));
    const ids = JSON.stringify(q);
    expect(ids).toContain(BRIEF_A);
    expect(ids).not.toContain(BRIEF_B);
    expect(sc(await w.call("get_brief", { brief_id: BRIEF_B })).outcome).toBe("not_authorised_client");
  });

  it("a successful read writes no access-log row, only the daily counter", async () => {
    const w = await world();
    await w.call("get_tasks", { client: "alpha" });
    expect(w.tables.agent_access_log).toHaveLength(0);
    expect(w.rpc.filter((x) => x.fn === "agent_hub_count_read")).toHaveLength(1);
  });

  it("cannot write to another client's briefs or create a brief for it", async () => {
    const w = await world();
    expect(sc(await w.call("add_brief_comment", { brief_id: BRIEF_B, text: "hi" })).outcome).toBe("not_authorised_client");
    expect(sc(await w.call("update_brief_status", { brief_id: BRIEF_B, status: "ready_for_review", note: "x", expected_updated_at: "2026-10-10T00:00:00Z" })).outcome).toBe("not_authorised_client");
    expect(sc(await w.call("create_brief", { client: "beta", title: "New" })).outcome).toBe("not_authorised_client");
    expect(w.tables.creative_brief_comments).toHaveLength(0);
    expect(w.tables.creative_briefs.filter((b) => b.client_id === B)).toHaveLength(1);
    expect(denied(w)).toHaveLength(3);
  });

  it("allowed writes on its own client succeed and are logged in full", async () => {
    const w = await world();
    expect(sc(await w.call("add_brief_comment", { brief_id: BRIEF_A, text: "looks good" })).ok).toBe(true);
    expect(sc(await w.call("create_brief", { client: "alpha", title: "Fall promo" })).ok).toBe(true);
    expect(w.tables.creative_briefs.some((b) => b.client_id === A && b.title === "Fall promo" && b.status === "submitted" && b.created_by_id === "m1")).toBe(true);
    const writes = w.tables.agent_access_log.filter((r: any) => r.event_type === "write");
    expect(writes.map((r: any) => r.tool)).toEqual(["add_brief_comment", "create_brief"]);
    expect(writes[0]).toMatchObject({ client_id: A, agent_id: "ag1", outcome: "allowed" });
    expect(writes[0].request_fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it("every other write is refused, including forced brief changes", async () => {
    const w = await world();
    expect(sc(await w.call("draft_update", { client: "alpha", for_date: "2026-10-13" })).outcome).toBe("refused_tool");
    expect(sc(await w.call("assign_brief", { brief_id: BRIEF_A, team_member_id: "m1", note: "x", expected_updated_at: "2026-10-10T00:00:00Z" })).outcome).toBe("refused_tool");
    expect(sc(await w.call("update_brief_status", { brief_id: BRIEF_A, status: "approved", note: "x", expected_updated_at: "2026-10-10T00:00:00Z", force: true })).outcome).toBe("refused_force");
    expect(denied(w)).toHaveLength(3);
  });

  it("tools/list advertises only the allowlisted tools", async () => {
    const w = await world();
    const names = ((await w.list()).body as any).result.tools.map((t: any) => t.name);
    expect(names.every((x: string) => HUB_AGENT_TOOLS.includes(x))).toBe(true);
    expect(names).toContain("create_brief");
    expect(names).not.toContain("draft_update");
  });

  it("gateway keys, killed agents and revoked keys are refused and logged", async () => {
    for (const o of [{ audience: "gateway" }, { agentStatus: "killed" }, { revoked: true }]) {
      const w = await world(o);
      expect((await w.call("list_clients")).status).toBe(401);
      expect(denied(w)[0]).toMatchObject({ outcome: "denied_auth", agent_id: "ag1" });
    }
  });
});
