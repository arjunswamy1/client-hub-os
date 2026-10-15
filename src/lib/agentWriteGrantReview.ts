/**
 * What AJ must see before giving (or giving back) a grant write scope: the bot's current owner and
 * every owner change since the grant last held write scope (or ever, if it never has).
 * Pure so the confirm flow is testable; the database still enforces who may save.
 */
export interface OwnerChange { agent_id: string; old_owner_team_member_id: string | null; new_owner_team_member_id: string | null; changed_by_team_member_id: string | null; changed_at: string }
export interface GrantLike { agent_id: string; scopes: string[] | null; revoked_at: string | null; write_scope_removed_at: string | null; write_scope_removed_owner_id: string | null }

export interface WriteGrantReview {
  /** True when saving would give the grant write scope (add, or re-grant). */
  needsConfirm: boolean;
  currentOwnerId: string | null;
  /** Previously held write and lost it at this time; null if it never held write. */
  lastHeldAt: string | null;
  ownerAtLastHold: string | null;
  changes: OwnerChange[];
  ownerChangedSinceLastHold: boolean;
}

export const hasWrite = (g: Pick<GrantLike, 'scopes' | 'revoked_at'>) => !g.revoked_at && (g.scopes ?? []).includes('write');

export function reviewWriteGrant(grant: GrantLike, currentOwnerId: string | null, history: OwnerChange[]): WriteGrantReview {
  const lastHeldAt = grant.write_scope_removed_at;
  const changes = history
    .filter((h) => h.agent_id === grant.agent_id && (!lastHeldAt || h.changed_at > lastHeldAt))
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  return {
    needsConfirm: !hasWrite(grant),
    currentOwnerId,
    lastHeldAt,
    ownerAtLastHold: grant.write_scope_removed_owner_id,
    changes,
    ownerChangedSinceLastHold: changes.length > 0 || (!!lastHeldAt && grant.write_scope_removed_owner_id !== currentOwnerId),
  };
}

/** Save is allowed only after an explicit confirmation that names the owner shown. */
export function canSaveWriteGrant(review: WriteGrantReview, confirmedOwnerId: string | null | undefined): boolean {
  if (!review.needsConfirm) return true;
  return confirmedOwnerId !== undefined && confirmedOwnerId === review.currentOwnerId && review.currentOwnerId !== null;
}
