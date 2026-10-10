import { describe, it, expect } from "vitest";
import { evaluateFollowups, planCheckinWrite, checkinState, parseCheckinReply, workingDaysBetween, type FollowupBrief, type FollowupRow } from "../../supabase/functions/_shared/creative-followups";

const D = "designer-1", D2 = "designer-2", LEAD = "henry", OWNER = "aj";
const MON = { today: "2026-10-12", weekday: "Mon", leadId: LEAD, ownerId: OWNER, sentTodayByRecipient: {} };
const b = (id: string, x: Partial<FollowupBrief>): FollowupBrief => ({ id, title: id, client: "Alpha", status: "in_design", due_date: null, assigned_to_id: D, accepted_at: "2026-10-01T12:00:00Z", status_since: "2026-10-01T12:00:00Z", last_activity: "2026-10-12T12:00:00Z", last_activity_kind: "comment", review_since_status: null, ...x });

describe("follow-up ladder", () => {
  it("counts working days, not calendar days", () => {
    expect(workingDaysBetween("2026-10-09", "2026-10-12")).toBe(1); // Fri → Mon
    expect(workingDaysBetween("2026-10-12", "2026-10-12")).toBe(0);
  });
  it("fires stage 1 once per (brief, rule, stage) and not again", () => {
    const br = [b("x", { status: "submitted", accepted_at: null, status_since: "2026-10-09T15:00:00Z" })];
    const first = evaluateFollowups(br, [], MON);
    expect(first.send.map((i) => [i.rule, i.stage, i.recipient_id])).toEqual([["not_accepted", "designer", D]]);
    const sent: FollowupRow[] = [{ brief_id: "x", rule: "not_accepted", stage: "designer", recipient_id: D, sent_at: "2026-10-12T15:00:00Z", resolved_at: null }];
    const again = evaluateFollowups(br, sent, MON);
    expect(again.send).toHaveLength(0);
    expect(again.items[0].already_sent).toBe(true);
  });
  it("escalates to the lead only after the stage-1 window and only when stage 1 was sent", () => {
    const br = [b("x", { status: "submitted", accepted_at: null, status_since: "2026-10-08T15:00:00Z" })]; // Thu → Mon = 2 wd
    expect(evaluateFollowups(br, [], MON).send.map((i) => i.stage)).toEqual(["designer"]);
    const sent: FollowupRow[] = [{ brief_id: "x", rule: "not_accepted", stage: "designer", recipient_id: D, sent_at: "2026-10-09T15:00:00Z", resolved_at: null }];
    expect(evaluateFollowups(br, sent, MON).send.map((i) => [i.stage, i.recipient_id])).toEqual([["lead", LEAD]]);
    const early = [b("y", { status: "submitted", accepted_at: null, status_since: "2026-10-09T15:00:00Z" })]; // 1 wd
    expect(evaluateFollowups(early, [{ ...sent[0], brief_id: "y" }], MON).send).toHaveLength(0);
  });
  it("awaiting_review goes to Henry directly; the AJ stage is roll-up only, never a DM", () => {
    const br = [b("r", { status: "ready_for_review", status_since: "2026-10-01T12:00:00Z" })];
    const sent: FollowupRow[] = [{ brief_id: "r", rule: "awaiting_review", stage: "lead", recipient_id: LEAD, sent_at: "2026-10-05T15:00:00Z", resolved_at: null }];
    const r = evaluateFollowups(br, sent, MON);
    expect(r.items.find((i) => i.stage === "owner")?.delivery).toBe("weekly_rollup");
    expect(r.send).toHaveLength(0);
    expect(evaluateFollowups(br, [], MON).send.map((i) => [i.rule, i.recipient_id])).toEqual([["awaiting_review", LEAD]]);
  });
  it("caps at 3 per person per day and holds the rest", () => {
    const br = ["a", "b", "c", "d", "e"].map((id) => b(id, { status: "submitted", accepted_at: null, status_since: "2026-10-08T15:00:00Z" }));
    const r = evaluateFollowups(br, [], MON);
    expect(r.send).toHaveLength(3);
    expect(r.held.filter((i) => i.held === "daily_cap")).toHaveLength(2);
    expect(evaluateFollowups(br, [], { ...MON, sentTodayByRecipient: { [D]: 3 } }).send).toHaveLength(0);
    const two = [...br, b("f", { assigned_to_id: D2, status: "submitted", accepted_at: null, status_since: "2026-10-08T15:00:00Z" })];
    expect(evaluateFollowups(two, [], MON).send.filter((i) => i.recipient_id === D2)).toHaveLength(1);
  });
  it("nothing fires on a weekend", () => {
    const br = [b("x", { status: "submitted", accepted_at: null, status_since: "2026-10-05T15:00:00Z" })];
    const r = evaluateFollowups(br, [], { ...MON, today: "2026-10-10", weekday: "Sat" });
    expect(r.send).toHaveLength(0);
    expect(r.held[0].held).toBe("weekend");
  });
  it("the 54 approved/delivered backlog briefs generate zero follow-ups", () => {
    const backlog = Array.from({ length: 54 }, (_, n) => b(`t${n}`, { status: n < 25 ? "approved" : "delivered", due_date: "2026-05-01", last_activity: "2026-05-01T00:00:00Z", status_since: "2026-05-01T00:00:00Z" }));
    const r = evaluateFollowups(backlog, [], MON);
    expect(r.items).toHaveLength(0);
    expect(r.send).toHaveLength(0);
  });
  it("a resolved follow-up records what resolved it", () => {
    const open: FollowupRow[] = [
      { id: "f1", brief_id: "x", rule: "not_accepted", stage: "designer", recipient_id: D, sent_at: "2026-10-09T15:00:00Z", resolved_at: null },
      { id: "f2", brief_id: "r", rule: "awaiting_review", stage: "lead", recipient_id: LEAD, sent_at: "2026-10-09T15:00:00Z", resolved_at: null },
      { id: "f3", brief_id: "s", rule: "in_design_stalled", stage: "designer", recipient_id: D, sent_at: "2026-10-09T15:00:00Z", resolved_at: null },
    ];
    const br = [
      b("x", { status: "in_design", accepted_at: "2026-10-12T13:00:00Z" }),
      b("r", { status: "ready_for_review", review_since_status: { action: "approved", at: "2026-10-12T13:00:00Z" } }),
      b("s", { status: "in_design", last_activity: "2026-10-12T10:00:00Z", last_activity_kind: "time_entry" }),
    ];
    const res = evaluateFollowups(br, open, MON).resolve.map((x) => [x.id, x.resolution]);
    expect(res).toEqual([["f1", "accepted"], ["f2", "review_logged_approved"], ["f3", "activity_time_entry"]]);
  });
});

describe("designer check-ins", () => {
  it("a second reply the same day updates the one row rather than duplicating", () => {
    const first = planCheckinWrite(null, { team_member_id: D, checkin_date: "2026-10-12", raw_reply: "on 1" }, "2026-10-12T14:00:00Z");
    expect(first.op).toBe("insert");
    const second = planCheckinWrite({ id: "row-1" }, { team_member_id: D, checkin_date: "2026-10-12", raw_reply: "actually 2" }, "2026-10-12T15:00:00Z");
    expect(second).toMatchObject({ op: "update", id: "row-1", row: { raw_reply: "actually 2" } });
  });
  it("asked and unanswered is no_response, distinct from not asked or answered", () => {
    expect(checkinState({ asked_at: "2026-10-12T13:30:00Z", responded_at: null })).toBe("no_response");
    expect(checkinState(null)).toBe("not_asked");
    expect(checkinState({ asked_at: "x", responded_at: "y" })).toBe("answered");
  });
  it("parses numbered picks and a blocker from the reply", () => {
    const p = parseCheckinReply("On 1 and 3 today. Blocked on footage from the client", [{ id: "a", title: "Hook test" }, { id: "b", title: "Roku 15s" }, { id: "c", title: "Statics" }]);
    expect(p.working_on.sort()).toEqual(["a", "c"]);
    expect(p.blocked_on).toMatch(/^Blocked on footage/);
  });
});
