import { describe, it, expect } from 'vitest';
import { isSlackTaskRequest, findSpokenTaskRequests } from '../../supabase/functions/_shared/task-request-rules';

describe('Slack: a task only when CPM Bot is asked for one', () => {
  it('accepts explicit task asks', () => {
    expect(isSlackTaskRequest('add a task for Lou: new Spektrafin hooks by Friday')).toBe(true);
    expect(isSlackTaskRequest('task for Malena - resize the Cannaball CTV spots')).toBe(true);
    expect(isSlackTaskRequest('can you put this in the task tracker')).toBe(true);
    expect(isSlackTaskRequest('create a to-do to call Teresa tomorrow')).toBe(true);
  });
  it('treats ordinary questions as questions', () => {
    expect(isSlackTaskRequest('what was Spektrafin spend yesterday?')).toBe(false);
    expect(isSlackTaskRequest('how many tasks does Lou have open?')).toBe(false);
    expect(isSlackTaskRequest('the client asked us to add a new creative')).toBe(false);
  });
});

describe('Recordings: only a spoken ask to CPM Bot or the task tracker', () => {
  it('finds an ask addressed to CPM Bot, with the following words as context', () => {
    const r = findSpokenTaskRequests('AJ: Okay.\nAJ: CPM Bot, add a task.\nAJ: Lou to send the new hooks by Friday.');
    expect(r).toHaveLength(1);
    expect(r[0].context).toContain('Lou to send the new hooks');
  });
  it('finds "put that in the task tracker"', () => {
    expect(findSpokenTaskRequests('Henry: Let us put that in the task tracker for Malena.')).toHaveLength(1);
  });
  it('ignores next steps and action items that nobody asked to record', () => {
    expect(findSpokenTaskRequests('### Next Steps\n- (Lou) Send hooks\nAJ: We should add a new campaign.')).toEqual([]);
    expect(findSpokenTaskRequests('AJ: CPM Bot numbers looked off yesterday.')).toEqual([]);
  });
});
