import { describe, expect, it } from 'vitest';
import {
  CONTEXT_SOURCES,
  contextSyncStatusRow,
  laneOf,
  mappingConfidence,
  matchesQuery,
  meetingType,
  shareLink,
  sourceLabel,
  splitMeetingContent,
  websearchQuery,
  type ContextSyncLogRow,
} from '@/lib/contextFeed';
import { syncBreakers } from '@/hooks/useMediaBrainSyncStatus';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('lanes', () => {
  it('treats a null client as agency-level, never as a client row', () => {
    expect(laneOf({ client_id: null })).toBe('agency');
    expect(laneOf({ client_id: 'abc' })).toBe('client');
  });

  it('offers wispr as a filterable source', () => {
    expect(CONTEXT_SOURCES.map((s) => s.key)).toContain('wispr');
    expect(sourceLabel('wispr')).toBe('Wispr Flow');
    expect(sourceLabel('something_new')).toBe('something_new');
  });
});

describe('splitMeetingContent', () => {
  it('splits the Flow summary from the full transcript', () => {
    const body = ['Summary', '- agreed the payout', '', 'Next steps', '- send the deck', '', 'Transcript', 'AJ: hello', 'Henry: hi'].join('\n');
    const { summary, transcript } = splitMeetingContent(body);
    expect(summary).toContain('agreed the payout');
    expect(summary).not.toContain('AJ: hello');
    expect(transcript).toBe('AJ: hello\nHenry: hi');
  });

  it('accepts a marked-up or inline transcript heading', () => {
    expect(splitMeetingContent('Notes\n## Full Transcript:\nSpeaker 1: go').transcript).toBe('Speaker 1: go');
    expect(splitMeetingContent('Notes\nTranscript: Speaker 1: go').transcript).toBe('Speaker 1: go');
  });

  it('returns no transcript when the body has none, keeping the whole body as summary', () => {
    const { summary, transcript } = splitMeetingContent('Just a note about pricing.');
    expect(summary).toBe('Just a note about pricing.');
    expect(transcript).toBeNull();
  });

  it('handles an empty or missing body', () => {
    expect(splitMeetingContent(null)).toEqual({ summary: '', transcript: null });
    expect(splitMeetingContent(undefined)).toEqual({ summary: '', transcript: null });
  });

  it('treats a transcript heading with nothing after it as absent rather than empty', () => {
    expect(splitMeetingContent('Notes here\nTranscript\n   ').transcript).toBeNull();
  });
});

describe('search', () => {
  it('turns a blank box into no filter rather than a query matching nothing', () => {
    expect(websearchQuery('   ')).toBeNull();
    expect(websearchQuery('')).toBeNull();
    expect(websearchQuery('  billable   duration ')).toBe('billable duration');
  });

  it('requires every term in the client-side fallback', () => {
    const item = { title: 'CPM Weekly Client Review', content: 'we agreed the payout is $80 per call' };
    expect(matchesQuery(item, 'payout 80')).toBe(true);
    expect(matchesQuery(item, 'payout ringba')).toBe(false);
    expect(matchesQuery(item, '')).toBe(true);
  });
});

describe('metadata accessors', () => {
  const item = {
    metadata: {
      share_link: 'https://flow.example/m/1',
      meeting_type: 'internal',
      mapping_confidence: 'low — inferred from title',
    },
  };
  it('reads the share link, meeting type and mapping caveat', () => {
    expect(shareLink(item)).toBe('https://flow.example/m/1');
    expect(meetingType(item)).toBe('internal');
    expect(mappingConfidence(item)).toBe('low — inferred from title');
  });
  it('renders a numeric confidence as a percentage', () => {
    expect(mappingConfidence({ metadata: { mapping_confidence: 0.62 } })).toBe('62%');
  });
  it('returns null rather than an empty string when absent', () => {
    expect(shareLink({ metadata: {} })).toBeNull();
    expect(shareLink({ metadata: null })).toBeNull();
    expect(mappingConfidence({ metadata: {} })).toBeNull();
  });
});

describe('context sync health', () => {
  const log = (o: Partial<ContextSyncLogRow>): ContextSyncLogRow => ({
    source: 'wispr',
    client_id: null,
    last_sync_at: hoursAgo(1),
    status: 'success',
    items_synced: 19,
    error_message: null,
    ...o,
  });

  it('reports never_run when no sync has ever been recorded', () => {
    const row = contextSyncStatusRow([], 'wispr');
    expect(row.status).toBe('never_run');
    expect(row.source).toBe('context_wispr');
    const [breaker] = syncBreakers([row]);
    expect(breaker.state).toBe('never_run');
    expect(breaker.evidence).toContain('Wispr meeting notes');
  });

  it('ignores logs from other sources', () => {
    expect(contextSyncStatusRow([log({ source: 'fathom' })], 'wispr').status).toBe('never_run');
  });

  it('is quiet when a recent sync succeeded', () => {
    const row = contextSyncStatusRow([log({})], 'wispr');
    expect(row.status).toBe('ok');
    expect(row.rows_written).toBe(19);
    expect(syncBreakers([row])).toHaveLength(0);
  });

  it('fires as stopped-delivering when the last success is past the review window', () => {
    const row = contextSyncStatusRow([log({ last_sync_at: hoursAgo(120) })], 'wispr');
    const [breaker] = syncBreakers([row]);
    expect(breaker.state).toBe('stale');
    expect(breaker.evidence).toContain('STOPPED delivering');
  });

  it('surfaces a failed run as an error, keeping the earlier success date', () => {
    const rows = contextSyncStatusRow(
      [
        log({ last_sync_at: hoursAgo(1), status: 'failed', error_message: 'Wispr API 401' }),
        log({ last_sync_at: hoursAgo(30) }),
      ],
      'wispr',
    );
    expect(rows.status).toBe('error');
    expect(rows.last_succeeded_at).not.toBeNull();
    const [breaker] = syncBreakers([rows]);
    expect(breaker.state).toBe('error');
    expect(breaker.evidence).toContain('Wispr API 401');
  });

  it('treats an in-progress run as delivering, not as an error', () => {
    expect(contextSyncStatusRow([log({ status: 'in_progress' })], 'wispr').status).toBe('ok');
  });
});
