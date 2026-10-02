import { describe, it, expect } from "vitest";
import {
  designerAssignedText, designerAssignedBlocks, designerAcceptedBlocks, ownerAcceptedText,
  refusalText, retryDue, briefUrl,
} from "../../supabase/functions/_shared/brief-messages";

const brief = { id: "11111111-1111-1111-1111-111111111111", title: "FE CTV refresh", owner_name: "Henry", due_date: "2026-10-05", priority: "high" };

describe("designer DM", () => {
  it("matches the agreed format", () => {
    expect(designerAssignedText(brief)).toBe(
      "New creative brief assigned to you: FE CTV refresh\nSubmitted by: Henry\nDue: Mon, Oct 5, 2026\nPriority: High",
    );
  });
  it("omits due date and priority cleanly — never prints null/undefined", () => {
    const t = designerAssignedText({ ...brief, due_date: null, priority: "undefined" as any, owner_name: "null" });
    expect(t).toBe("New creative brief assigned to you: FE CTV refresh");
    expect(t).not.toMatch(/null|undefined/);
  });
  it("has Accept (action) and View (url) buttons", () => {
    const actions: any = designerAssignedBlocks(brief)[1];
    expect(actions.elements[0]).toMatchObject({ action_id: "accept_brief", value: brief.id });
    expect(actions.elements[1]).toMatchObject({ action_id: "view_brief", url: briefUrl(brief.id) });
  });
  it("the accepted rewrite removes the Accept button and keeps View", () => {
    const actions: any = designerAcceptedBlocks(brief, "2026-10-02T14:05:00Z")[1];
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["view_brief"]);
  });
  it("owner DM", () => {
    expect(ownerAcceptedText("Iwinosa", "FE CTV refresh", "2026-10-02T14:05:00Z"))
      .toBe("Iwinosa has accepted your brief: FE CTV refresh\nAccepted at Oct 2, 10:05 AM ET");
  });
});

describe("refusals are never silent", () => {
  it.each([
    [{ outcome: "rejected_unknown_actor" }, /couldn't match your Slack account/],
    [{ outcome: "rejected_already_accepted", accepted_by: "Lou", accepted_at: "2026-10-02T14:05:00Z" }, /already accepted by Lou/],
    [{ outcome: "rejected_not_assignee", reassigned: true, current_assignee: "Malena" }, /reassigned to Malena/],
    [{ outcome: "rejected_not_assignee", reassigned: false, current_assignee: "Lou" }, /assigned to Lou, not you/],
    [{ outcome: "rejected_not_submitted", status: "draft" }, /back in draft/],
  ] as const)("%o", (r, re) => {
    expect(refusalText(r as any)).toMatch(re);
  });
});

describe("retry backoff", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("first attempt is immediate, then 2/4/8/16 min, never past 5", () => {
    expect(retryDue(0, "2026-10-02T12:00:00Z", now)).toBe(true);
    expect(retryDue(1, "2026-10-02T11:59:00Z", now)).toBe(false);
    expect(retryDue(1, "2026-10-02T11:58:00Z", now)).toBe(true);
    expect(retryDue(3, "2026-10-02T11:53:00Z", now)).toBe(false);
    expect(retryDue(5, "2026-01-01T00:00:00Z", now)).toBe(false);
  });
});
