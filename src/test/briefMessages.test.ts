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

import { readFileSync } from "node:fs";
import {
  clickReplyText, interactionReplyOptions, designerReassignedBlocks, designerReassignedText,
  designerDeclinedBlocks, declinedNotifyText, RETRY_STATUSES, hubUrl, DEFAULT_HUB_URL,
} from "../../supabase/functions/_shared/brief-messages";

const src = (p: string) => readFileSync(p, "utf8");

describe("click replies are never gated by BRIEF_DM_LIVE (regression)", () => {
  it("reply options always have dryRun false", () => {
    expect(interactionReplyOptions("U1", "https://hooks.slack.com/actions/x", "hi").dryRun).toBe(false);
  });
  it("live off: accept and decline still produce a test-mode reply, never empty", () => {
    expect(clickReplyText({ outcome: "accepted" }, false)).toMatch(/^Test mode:/);
    expect(clickReplyText({ outcome: "declined" }, false)).toMatch(/^Test mode:/);
    expect(clickReplyText({ outcome: "rejected_not_assignee", current_assignee: "Lou" }, false)).toMatch(/assigned to Lou/);
  });
  it("slack-interactions sends the reply through interactionReplyOptions, not the dryRun flag", () => {
    const s = src("supabase/functions/slack-interactions/index.ts");
    expect(s).toMatch(/postDirectMessage\(interactionReplyOptions\(/);
    expect(s).not.toMatch(/kind:\s*'interaction_reply'[^)]*dryRun/);
    expect(s).toMatch(/outcome: 'processing'/);
    expect(s).not.toMatch(/detail: 'processing'/);
  });
});

describe("stale is not failure", () => {
  const s = src("supabase/functions/_shared/brief-notify.ts");
  it("markStale writes 'stale' and does not touch attempts", () => {
    const body = s.slice(s.indexOf("export async function markStale"), s.indexOf("/** Deliver every"));
    expect(body).toMatch(/status: 'stale'/);
    expect(body).not.toMatch(/attempts/);
  });
  it("retry statuses exclude stale and sent", () => {
    expect([...RETRY_STATUSES]).toEqual(["pending", "failed"]);
    expect(src("supabase/functions/brief-notifications/index.ts")).toMatch(/in\('status', \[\.\.\.RETRY_STATUSES\]\)/);
  });
});

describe("reassignment and decline rewrites leave no live action buttons", () => {
  it("reassigned message", () => {
    expect(designerReassignedText(brief, "Malena")).toBe(
      "Creative brief reassigned: FE CTV refresh\nThis brief is now assigned to Malena. No action needed from you.");
    const actions: any = designerReassignedBlocks(brief, "Malena")[1];
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["view_brief"]);
  });
  it("declined message removes Accept and Decline", () => {
    const actions: any = designerDeclinedBlocks(brief, "2026-10-02T14:05:00Z")[1];
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["view_brief"]);
  });
  it("designer DM carries Decline beside Accept", () => {
    const actions: any = designerAssignedBlocks(brief)[1];
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["accept_brief", "decline_brief", "view_brief"]);
    expect(actions.elements[1].value).toBe(brief.id);
  });
  it("owner/lead decline notice", () => {
    expect(declinedNotifyText("Lou", "FE CTV refresh", "2026-10-02T14:05:00Z")).toMatch(/^Lou declined the brief: FE CTV refresh/);
  });
});

describe("hub URL from config", () => {
  it("falls back to the current domain, honours HUB_PUBLIC_URL", () => {
    delete process.env.HUB_PUBLIC_URL;
    expect(hubUrl()).toBe(DEFAULT_HUB_URL);
    process.env.HUB_PUBLIC_URL = "https://hub.example.com/";
    expect(briefUrl("x")).toBe("https://hub.example.com/creative?brief=x");
    process.env.HUB_PUBLIC_URL = "not a url";
    expect(hubUrl()).toBe(DEFAULT_HUB_URL);
    delete process.env.HUB_PUBLIC_URL;
  });
});
