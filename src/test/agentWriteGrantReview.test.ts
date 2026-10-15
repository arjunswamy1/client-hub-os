import { describe, it, expect } from "vitest";
import { reviewWriteGrant, canSaveWriteGrant } from "@/lib/agentWriteGrantReview";

const JUAN = "juan", CHARLES = "charles", AJ = "aj";
const grant = (o: Record<string, unknown> = {}) => ({ agent_id: "bot", scopes: ["read"], revoked_at: null, write_scope_removed_at: null, write_scope_removed_owner_id: null, ...o });
const ch = (at: string, from: string | null, to: string | null) => ({ agent_id: "bot", old_owner_team_member_id: from, new_owner_team_member_id: to, changed_by_team_member_id: AJ, changed_at: at });

describe("write re-grant review", () => {
  it("first grant: needs confirm, shows every owner change", () => {
    const r = reviewWriteGrant(grant(), JUAN, [ch("2026-10-01T00:00:00Z", CHARLES, JUAN), { ...ch("2026-10-02T00:00:00Z", JUAN, CHARLES), agent_id: "other" }]);
    expect(r.needsConfirm).toBe(true);
    expect(r.changes).toHaveLength(1);
    expect(r.lastHeldAt).toBeNull();
  });

  it("re-grant: only owner changes since write was last held are shown", () => {
    const g = grant({ write_scope_removed_at: "2026-10-10T00:00:00Z", write_scope_removed_owner_id: CHARLES });
    const r = reviewWriteGrant(g, JUAN, [ch("2026-10-05T00:00:00Z", JUAN, CHARLES), ch("2026-10-12T00:00:00Z", CHARLES, JUAN)]);
    expect(r.changes.map((c) => c.changed_at)).toEqual(["2026-10-12T00:00:00Z"]);
    expect(r.ownerChangedSinceLastHold).toBe(true);
    expect(r.ownerAtLastHold).toBe(CHARLES);
  });

  it("re-grant with no owner change since: flagged unchanged", () => {
    const g = grant({ write_scope_removed_at: "2026-10-10T00:00:00Z", write_scope_removed_owner_id: JUAN });
    expect(reviewWriteGrant(g, JUAN, [ch("2026-10-05T00:00:00Z", CHARLES, JUAN)]).ownerChangedSinceLastHold).toBe(false);
  });

  it("un-revoking a revoked write grant counts as a re-grant", () => {
    expect(reviewWriteGrant(grant({ scopes: ["read", "write"], revoked_at: "2026-10-10T00:00:00Z" }), JUAN, []).needsConfirm).toBe(true);
  });

  it("save blocked until AJ confirms the owner shown", () => {
    const r = reviewWriteGrant(grant(), JUAN, []);
    expect(canSaveWriteGrant(r, undefined)).toBe(false);
    expect(canSaveWriteGrant(r, CHARLES)).toBe(false);
    expect(canSaveWriteGrant(r, JUAN)).toBe(true);
  });

  it("ownerless bot can never be confirmed for write", () => {
    expect(canSaveWriteGrant(reviewWriteGrant(grant(), null, []), null)).toBe(false);
  });

  it("removing write needs no confirm", () => {
    const r = reviewWriteGrant(grant({ scopes: ["read", "write"] }), JUAN, []);
    expect(r.needsConfirm).toBe(false);
    expect(canSaveWriteGrant(r, undefined)).toBe(true);
  });
});
