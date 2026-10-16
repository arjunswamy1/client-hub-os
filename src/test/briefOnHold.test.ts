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
