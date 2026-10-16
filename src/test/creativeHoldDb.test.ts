// mcp-hub creative tool handlers against a REAL Postgres (migrations 0043 + 0044,
// real triggers and agent_write_creative_brief). Run via
// scripts/db-tests/creative-brief-changes/run.sh, which sets DBTEST_PG.
import { describe, it, expect } from "vitest";
import { pgDb } from "./fixtures/pgDb";
import { runCreativeTool, type CreativeCaller } from "../../supabase/functions/mcp-hub/creative";

const CONN = process.env.DBTEST_PG;
const A = "b0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-20T15:00:00Z");
const bot: CreativeCaller = { memberId: "a0000000-0000-4000-8000-000000000002", memberName: "Grokbot", tokenId: null, authMethod: "agent_token", allClients: true, isService: true, clientIds: new Set() };

describe.skipIf(!CONN)("creative tools on real Postgres", () => {
  const { db, sql } = pgDb(CONN ?? "");
  const updatedAt = () => sql(`SELECT to_json(updated_at) FROM creative_briefs WHERE id='${A}'`);
  const run = (name: string, args: Record<string, unknown> = {}) => runCreativeTool(name, db, bot, args, NOW);
  const refusal = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e.code ?? e.outcome ?? e.message; } };

  it("update_brief_status refuses on_hold without a reason", async () => {
    sql(`UPDATE creative_briefs SET status='in_design', assigned_to_id='a0000000-0000-4000-8000-000000000004' WHERE id='${A}'`);
    expect(await refusal(run("update_brief_status", { brief_id: A, status: "on_hold", note: "pause", expected_updated_at: updatedAt() }))).toBe("invalid_arguments");
    expect(sql(`SELECT to_json(status) FROM creative_briefs WHERE id='${A}'`)).toBe("in_design");
  });

  it("update_brief_status puts on hold with a reason, recording start and original due date", async () => {
    await run("update_brief_status", { brief_id: A, status: "on_hold", reason: "Client paused launch", note: "pause", expected_updated_at: updatedAt() });
    const b = sql(`SELECT row_to_json(x) FROM (SELECT status, hold_reason, hold_started_at, hold_original_due_date FROM creative_briefs WHERE id='${A}') x`);
    expect(b).toMatchObject({ status: "on_hold", hold_reason: "Client paused launch", hold_original_due_date: "2026-10-01" });
    expect(b.hold_started_at).toBeTruthy();
    sql(`UPDATE creative_briefs SET hold_started_at = '2026-10-10T12:00:00Z' WHERE id='${A}'`);
  });

  it("get_creative_queue shows hold age, original due date and long hold", async () => {
    const out = await run("get_creative_queue", { include: ["on_hold"] });
    const p: any = out.payload;
    const row = (p.on_hold ?? []).find((r: any) => r.id === A); if (!row || row.hold_age_days !== 10) throw new Error(JSON.stringify(row ? [row.hold_started_at, row.hold_age_days, row.hold_reason] : Object.keys(p)));
    expect({ hold_reason: row?.hold_reason, original_due_date: row?.original_due_date, hold_age_days: row?.hold_age_days, long_hold: row?.long_hold, days_overdue: row?.days_overdue }).toEqual({ hold_reason: "Client paused launch", original_due_date: "2026-10-01", hold_age_days: 10, long_hold: true, days_overdue: 0 });
    expect(p.summary.on_hold_long).toBe(1);
    expect((p.active ?? []).some((r: any) => r.id === A)).toBe(false);
  });

  it("get_designer_load lists the hold separately from active briefs", async () => {
    const d: any = (await run("get_designer_load")).payload.designers.find((x: any) => x.designer === "Dana");
    expect(d.active_briefs).toBe(1); // the Beta brief, not the held one
    expect(d.on_hold_briefs).toBe(1);
    expect(d.on_hold[0]).toMatchObject({ id: A, hold_age_days: 10, original_due_date: "2026-10-01" });
  });

  it("close_out_brief refuses an on-hold brief", async () => {
    expect(await refusal(run("close_out_brief", { brief_id: A, note: "x", expected_updated_at: updatedAt() }))).toMatch(/refused/);
    expect(sql(`SELECT to_json(closed_out_at) FROM creative_briefs WHERE id='${A}'`)).toBeNull();
  });
});
