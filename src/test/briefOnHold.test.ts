import { describe, it, expect } from 'vitest';
import { isBriefLate } from '@/lib/briefStatus';
import { BRIEF_STATUSES } from '@/types/creative';
import { sortChangesNewestFirst, actorLabel } from '@/lib/briefChangeLog';
import { partitionOf, daysOverdueOf, BRIEF_STATUSES as HUB_STATUSES, ACTIVE_STATUSES } from '../../supabase/functions/mcp-hub/creative';
import { PRODUCTION_QUEUE_STATUSES } from '../../supabase/functions/_shared/task-digest';
import { FOLLOWUP_ACTIVE_STATUSES } from '../../supabase/functions/_shared/creative-followups';

const now = new Date('2026-10-16T12:00:00Z');
describe('on hold status', () => {
  it('sits between Draft and Submitted on the board', () => {
    expect(BRIEF_STATUSES.slice(0, 3)).toEqual(['draft', 'on_hold', 'submitted']);
  });
  it('hub tools accept on_hold', () => { expect(HUB_STATUSES).toContain('on_hold'); });
  it('an on-hold request past its due date is not late', () => {
    expect(isBriefLate('on_hold', '2026-10-01', now)).toBe(false);
    expect(isBriefLate('in_design', '2026-10-01', now)).toBe(true);
  });
  it('hub queue: on hold has its own partition and 0 days overdue', () => {
    const b = { status: 'on_hold', due_date: '2026-10-01', closed_out_at: null };
    expect(partitionOf(b, '2026-10-16')).toBe('on_hold');
    expect(daysOverdueOf(b, '2026-10-16')).toBe(0);
    expect(daysOverdueOf({ status: 'in_design', due_date: '2026-10-01' }, '2026-10-16')).toBe(15);
  });
  it('excluded from active work, designer daily lists and chasing', () => {
    expect(ACTIVE_STATUSES).not.toContain('on_hold');
    expect(PRODUCTION_QUEUE_STATUSES).not.toContain('on_hold');
    expect(FOLLOWUP_ACTIVE_STATUSES).not.toContain('on_hold');
  });
});

describe('change log display', () => {
  it('newest first', () => {
    const rows: any[] = [{ id: 'a', created_at: '2026-10-15T00:00:00Z' }, { id: 'b', created_at: '2026-10-16T00:00:00Z' }];
    expect(sortChangesNewestFirst(rows).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('labels bots as bots', () => {
    expect(actorLabel({ actor_kind: 'bot', changed_by: { name: 'Grokbot' } } as any)).toBe('Grokbot (bot)');
    expect(actorLabel({ actor_kind: 'system' } as any)).toBe('System');
  });
});

describe('long holds (more than 7 days)', async () => {
  const { holdInfo, longHolds, LONG_HOLD_DAYS, checkinPrompt } = await import('../../supabase/functions/_shared/creative-followups');
  it('threshold is 7 days', () => { expect(LONG_HOLD_DAYS).toBe(7); });
  it('7 days on hold is not long; 8 days is', () => {
    expect(holdInfo({ hold_started_at: '2026-10-09T15:00:00Z' }, '2026-10-16')).toMatchObject({ hold_age_days: 7, long_hold: false });
    expect(holdInfo({ hold_started_at: '2026-10-08T15:00:00Z', hold_original_due_date: '2026-10-01' }, '2026-10-16')).toMatchObject({ hold_age_days: 8, long_hold: true, original_due_date: '2026-10-01' });
  });
  it('only on-hold requests are long holds', () => {
    const rows = [{ status: 'on_hold', hold_started_at: '2026-10-01T15:00:00Z' }, { status: 'in_design', hold_started_at: '2026-10-01T15:00:00Z' }];
    expect(longHolds(rows, '2026-10-16')).toHaveLength(1);
  });
  it('designer check-in lists held work as paused, not numbered for today', () => {
    const t = checkinPrompt('Dana', [{ title: 'A', client: 'X', due_date: null }], [{ title: 'Held', client: 'X', hold_age_days: 3, original_due_date: '2026-10-01' }]);
    expect(t).toMatch(/1\. \*A\*/);
    expect(t).not.toMatch(/2\. /);
    expect(t).toMatch(/Paused[\s\S]*Held \(X\) — on hold 3 days, originally due 2026-10-01/);
  });
});

describe('deleted comments in history', async () => {
  const { deletedCommentLine } = await import('@/lib/briefChangeLog');
  it('shows the author but no text', () => {
    const line = deletedCommentLine({ field: 'comment_deleted', old_value: null, new_value: null, comment_author_id: 'u1' } as any, () => 'Dana');
    expect(line).toBe('Comment by Dana deleted');
  });
});
