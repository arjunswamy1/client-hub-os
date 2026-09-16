/**
 * Context Feed — pure rendering and search rules for `context_items`.
 *
 * Every rule the feed depends on lives here exactly once: which lane a row
 * belongs in, how a meeting body splits into summary and transcript, how a
 * search box becomes a Postgres full-text query, and how a `context_sync_log`
 * row becomes the same delivery-health shape the ad syncs use.
 *
 * A row with `client_id IS NULL` is AGENCY-LEVEL, not "unknown client". It is
 * never rendered inside a client's timeline: an internal commercial discussion
 * silently appearing in a client record is the failure this separation exists to
 * prevent.
 */

import type { SyncStatusRow, SyncStatusValue } from '@/hooks/useMediaBrainSyncStatus';

export type ContextLane = 'agency' | 'client';

export interface ContextItemRow {
  id: string;
  client_id: string | null;
  source: string;
  source_id: string | null;
  content_type: string;
  title: string | null;
  content: string | null;
  participants: string[] | null;
  occurred_at: string;
  created_at?: string;
  updated_at?: string | null;
  metadata: Record<string, unknown> | null;
}

/** Sources the feed can filter on. `wispr` is the current recorder; `fathom` is the retired one. */
export const CONTEXT_SOURCES: { key: string; label: string }[] = [
  { key: 'wispr', label: 'Wispr Flow' },
  { key: 'fathom', label: 'Fathom' },
  { key: 'slack', label: 'Slack' },
  { key: 'teams', label: 'Teams' },
  { key: 'gmail', label: 'Gmail' },
  { key: 'drive', label: 'Drive' },
  { key: 'meta_ads', label: 'Meta Ads' },
  { key: 'google_ads', label: 'Google Ads' },
  { key: 'tiktok_ads', label: 'TikTok Ads' },
  { key: 'internal', label: 'Internal' },
];

export function sourceLabel(source: string): string {
  return CONTEXT_SOURCES.find((s) => s.key === source)?.label ?? source;
}

/** Null client is agency-level. Nothing infers a client from a title. */
export function laneOf(item: Pick<ContextItemRow, 'client_id'>): ContextLane {
  return item.client_id === null ? 'agency' : 'client';
}

const TRANSCRIPT_MARKER = /^[\s#>*_-]*(full\s+)?transcript\b\s*:?\s*/i;

export interface SplitContent {
  /** The Flow summary and next steps — short enough to render in the feed. */
  summary: string;
  /** The full transcript, or null when the body carries no transcript section. */
  transcript: string | null;
}

/**
 * Split a meeting body into the part worth showing and the part worth hiding.
 * Transcripts run to tens of thousands of characters; dumping one into a feed
 * card makes every other item unreadable.
 */
export function splitMeetingContent(content: string | null | undefined): SplitContent {
  if (!content) return { summary: '', transcript: null };
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = TRANSCRIPT_MARKER.exec(lines[i]);
    if (!m) continue;
    const remainderOfLine = lines[i].slice(m[0].length).trim();
    const rest = [remainderOfLine, ...lines.slice(i + 1)].join('\n').trim();
    return {
      summary: lines.slice(0, i).join('\n').trim(),
      transcript: rest.length > 0 ? rest : null,
    };
  }
  return { summary: content.trim(), transcript: null };
}

/** How much of the summary to show before it needs its own expander. */
export const SUMMARY_PREVIEW_CHARS = 600;

/**
 * Turn the search box into a Postgres `websearch_to_tsquery` string, or null
 * when there is nothing to search. Null means "no search filter" — never an
 * empty query that would match nothing.
 */
export function websearchQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, ' ');
  return q.length === 0 ? null : q;
}

/**
 * Client-side fallback matcher, used only over rows already fetched (e.g. while
 * a query is being re-issued). Every whitespace-separated term must appear.
 */
export function matchesQuery(item: Pick<ContextItemRow, 'title' | 'content'>, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (q.length === 0) return true;
  const hay = `${item.title ?? ''}\n${item.content ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

function metaString(item: Pick<ContextItemRow, 'metadata'>, key: string): string | null {
  const v = item.metadata?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The Wispr notes page for this meeting, where the loader recorded one. */
export function shareLink(item: Pick<ContextItemRow, 'metadata'>): string | null {
  return metaString(item, 'share_link');
}

export function meetingType(item: Pick<ContextItemRow, 'metadata'>): string | null {
  return metaString(item, 'meeting_type');
}

/**
 * Present only when the client was INFERRED rather than known. Its presence is a
 * caveat to display, never a licence to auto-assign.
 */
export function mappingConfidence(item: Pick<ContextItemRow, 'metadata'>): string | null {
  const v = item.metadata?.mapping_confidence;
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return `${Math.round(v * 100)}%`;
  return null;
}

export function hasTranscriptFlag(item: Pick<ContextItemRow, 'metadata'>): boolean {
  return item.metadata?.has_transcript === true;
}

// ---------------------------------------------------------------------------
// Delivery health
// ---------------------------------------------------------------------------

export interface ContextSyncLogRow {
  source: string;
  client_id: string | null;
  last_sync_at: string | null;
  status: string;
  items_synced: number | null;
  error_message: string | null;
}

const CONTEXT_STATUS: Record<string, SyncStatusValue> = {
  success: 'ok',
  in_progress: 'ok',
  failed: 'error',
};

/**
 * Fold `context_sync_log` rows for one source into the same single-row shape the
 * ad-platform syncs use, so `syncBreakers` judges a context feed that quietly
 * stopped updating exactly as it judges a broken ad sync.
 *
 * No rows at all is `never_run` — "never connected" and "stopped delivering"
 * stay separate here for the same reason they do for the ad syncs.
 */
export function contextSyncStatusRow(
  logs: ContextSyncLogRow[],
  source = 'wispr',
  syncSourceKey = 'context_wispr',
): SyncStatusRow {
  const mine = logs.filter((l) => l.source === source);
  const byRecency = [...mine].sort(
    (a, b) => new Date(b.last_sync_at ?? 0).getTime() - new Date(a.last_sync_at ?? 0).getTime(),
  );
  const latest = byRecency[0] ?? null;
  const lastSuccess = byRecency.find((l) => CONTEXT_STATUS[l.status] === 'ok' && l.last_sync_at) ?? null;

  const base = {
    id: `context-${source}`,
    source: syncSourceKey as SyncStatusRow['source'],
    client_id: latest?.client_id ?? null,
    rows_written: latest?.items_synced ?? null,
    token_status: null,
    detail: null,
    updated_at: latest?.last_sync_at ?? new Date(0).toISOString(),
  };

  if (!latest) {
    return {
      ...base,
      last_attempted_at: null,
      last_succeeded_at: null,
      status: 'never_run',
      error: 'No context sync has ever been recorded for this source.',
    };
  }

  return {
    ...base,
    last_attempted_at: latest.last_sync_at,
    last_succeeded_at: lastSuccess?.last_sync_at ?? null,
    status: CONTEXT_STATUS[latest.status] ?? 'error',
    error: latest.error_message,
  };
}
