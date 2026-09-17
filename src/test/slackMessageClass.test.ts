import { describe, expect, it } from 'vitest';
import { classifyMessage } from '../../supabase/functions/_shared/slack-message-class';

const client = (text: string) => classifyMessage({ text, isCpmAuthor: false });

describe('classifyMessage', () => {
  it('marks anything authored by a CPM person internal', () => {
    expect(classifyMessage({ text: 'why are calls down?', isCpmAuthor: true })).toBe('internal');
  });

  it('detects client questions', () => {
    expect(client('Any update on the pest campaign?')).toBe('client_question');
    expect(client('how many calls did we get yesterday')).toBe('client_question');
  });

  it('detects client requests', () => {
    expect(client('Please pause the walk-in tubs ads today')).toBe('client_request');
    expect(client('Can you send over the weekly numbers?')).toBe('client_request');
  });

  it('detects escalations', () => {
    expect(client('This is unacceptable, we are still waiting')).toBe('escalation');
    expect(client('URGENT — leads stopped')).toBe('escalation');
  });

  it('detects client claims with numbers', () => {
    expect(client('We only got 12 calls yesterday and 3 were junk')).toBe('client_claim');
  });

  it('treats greetings, thanks and scheduling as noise but never drops them', () => {
    expect(client('thanks!')).toBe('noise');
    expect(client('👍')).toBe('noise');
    expect(client('Good morning')).toBe('noise');
    expect(client('See you tomorrow on the standup')).toBe('noise');
    expect(client('')).toBe('noise');
  });
});
