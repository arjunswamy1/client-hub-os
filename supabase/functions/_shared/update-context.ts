// Daily-update context: channel discovery rules, the strict internal-only
// channel test, origin separation for the context pack, the figure check on
// agent-written narratives, and the narrative-vs-hub-draft choice.
// Pure functions only. Never imports _shared/slack-post.ts (mcp-hub uses it).
import { screenForInjection } from './feedback-safety.ts';

// ─── channels ──────────────────────────────────────────────────────────────

export interface ChannelFlags { classified_at?: string | null; is_external?: boolean | null; is_shared?: boolean | null; is_ext_shared?: boolean | null; is_org_shared?: boolean | null }

/** A channel a daily update may reach: classified, and Slack reports it shared in no way at all. */
export function isStrictlyInternal(m: ChannelFlags | null | undefined): boolean {
  return !!m && !!m.classified_at && m.is_external === false && m.is_shared !== true && m.is_ext_shared !== true && m.is_org_shared !== true;
}

/** Shared in any way Slack reports — the context pack treats these as client-facing. */
export function isClientFacing(m: ChannelFlags | null | undefined): boolean {
  return !!m && (m.is_external === true || m.is_shared === true || m.is_ext_shared === true || m.is_org_shared === true);
}

export interface SlackChannel { id: string; name: string; is_private?: boolean; is_shared?: boolean; is_ext_shared?: boolean; is_org_shared?: boolean; purpose?: string; topic?: string }

/** Name-based suggestion. Only an unambiguous single match is proposed; it never becomes client_id. */
export function proposeClient(name: string, clients: { id: string; name: string; slug: string | null }[]): { id: string; reason: string } | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const hits = clients.filter((c) => {
    const keys = [c.slug, c.name].filter(Boolean).map((k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter((k) => k.length >= 4);
    return keys.some((k) => ` ${n} `.includes(` ${k} `) || n.replace(/ /g, '').includes(k.replace(/ /g, '')));
  });
  return hits.length === 1 ? { id: hits[0].id, reason: `channel name contains "${hits[0].name}"` } : null;
}

/**
 * The row written for a discovered channel. Flags come straight from Slack.
 * A new channel starts with sync off and client_id null; an existing row keeps
 * its sync setting and client mapping — discovery never changes either.
 */
export function discoveryPatch(ch: SlackChannel, exists: boolean, proposal: { id: string; reason: string } | null, nowIso: string) {
  const flags = {
    channel_id: ch.id, channel_name: ch.name,
    is_private: ch.is_private ?? null, is_shared: ch.is_shared ?? null, is_ext_shared: ch.is_ext_shared ?? null, is_org_shared: ch.is_org_shared ?? null,
    is_external: ch.is_ext_shared === true || ch.is_org_shared === true || ch.is_shared === true,
    classified_at: nowIso, discovered_at: nowIso, updated_at: nowIso,
    proposed_client_id: proposal?.id ?? null, proposal_reason: proposal?.reason ?? null,
  };
  return exists ? flags : { ...flags, client_id: null, sync_enabled: false };
}

// ─── context pack ──────────────────────────────────────────────────────────

export type Origin = 'internal_slack' | 'external_slack' | 'wispr_call';
export interface ContextRow { source: string; content_type?: string | null; title?: string | null; content?: string | null; metadata?: Record<string, any> | null; occurred_at: string; client_id?: string | null }
export interface MappingRow extends ChannelFlags { channel_id: string; channel_name?: string | null; client_id: string | null }

export interface PackItem { origin: Origin; at: string; source: string; where: string | null; author_side: 'cpm' | 'client' | 'unknown'; quoted_text: string; injection_suspected: boolean; injection_signals: unknown[]; permalink: string | null }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Split context into three origins, never merged. An external item is kept
 * only when its channel is mapped to THIS client; anything else is dropped and
 * counted. Text is quoted data: screened for directives, never followed.
 */
export function separateContext(rows: ContextRow[], mappings: MappingRow[], clientId: string) {
  const byChannel = new Map(mappings.map((m) => [m.channel_id, m]));
  const out: Record<Origin, PackItem[]> = { internal_slack: [], external_slack: [], wispr_call: [] };
  const excluded = { other_client: 0, unknown_channel: 0, noise: 0 };
  for (const r of rows) {
    if (r.client_id && r.client_id !== clientId) { excluded.other_client++; continue; }
    const md = r.metadata ?? {};
    if (md.message_class === 'noise') { excluded.noise++; continue; }
    const text = String(r.content ?? '').trim();
    if (!text) continue;
    let origin: Origin;
    let where: string | null = null;
    if (r.source === 'wispr') { origin = 'wispr_call'; where = r.title ?? 'call recording'; }
    else if (r.source === 'slack') {
      const m = md.channel_id ? byChannel.get(String(md.channel_id)) : undefined;
      if (!m) { excluded.unknown_channel++; continue; }
      if (isClientFacing(m)) {
        if (m.client_id !== clientId) { excluded.other_client++; continue; }
        origin = 'external_slack';
      } else {
        if (m.client_id && m.client_id !== clientId) { excluded.other_client++; continue; }
        origin = 'internal_slack';
      }
      where = m.channel_name ?? md.channel_name ?? null;
    } else continue;
    const quoted = clip(text, origin === 'wispr_call' ? 1500 : 800);
    const screen = screenForInjection(quoted);
    out[origin].push({
      origin, at: r.occurred_at, source: r.source, where,
      author_side: md.is_cpm_author === true ? 'cpm' : md.is_cpm_author === false ? 'client' : 'unknown',
      quoted_text: quoted, injection_suspected: screen.suspected, injection_signals: screen.signals,
      permalink: md.permalink ?? md.share_link ?? null,
    });
  }
  return { ...out, excluded };
}

// ─── figure check ──────────────────────────────────────────────────────────

export interface Figure { raw: string; kind: 'currency' | 'percent'; value: number }

export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  const t = String(text ?? '');
  for (const m of t.matchAll(/-?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?([kKmM])?\b/g)) {
    let v = Number(`${m[1].replace(/,/g, '')}.${m[2] ?? '0'}`);
    if (m[3]) v *= /k/i.test(m[3]) ? 1e3 : 1e6;
    out.push({ raw: m[0].trim(), kind: 'currency', value: m[0].trim().startsWith('-') ? -v : v });
  }
  for (const m of t.matchAll(/([+-−]?\d+(?:\.\d+)?)\s?%/g)) out.push({ raw: m[0].trim(), kind: 'percent', value: Math.abs(Number(m[1].replace('−', '-'))) });
  return out;
}

/** Every number the hub computed for that date, from its own texts and its metric objects. */
export function allowedFigures(texts: string[], numbers: unknown[]) {
  const currency: number[] = [], percent: number[] = [];
  for (const t of texts) for (const f of extractFigures(t)) (f.kind === 'currency' ? currency : percent).push(Math.abs(f.value));
  const walk = (x: unknown, key = '') => {
    if (typeof x === 'number' && Number.isFinite(x)) {
      if (/pct|percent|rate|margin|roas|ratio|share/i.test(key)) { percent.push(Math.abs(x)); percent.push(Math.abs(x * 100)); }
      else currency.push(Math.abs(x));
    } else if (Array.isArray(x)) x.forEach((v) => walk(v, key));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, k);
  };
  numbers.forEach((n) => walk(n));
  return { currency, percent };
}

/** Figures in the narrative that match nothing the hub computed. */
export function figureMismatches(text: string, allowed: { currency: number[]; percent: number[] }): Figure[] {
  return extractFigures(text).filter((f) => {
    const v = Math.abs(f.value);
    if (f.kind === 'currency') {
      const tol = /[kKmM]$/.test(f.raw) ? Math.max(v * 0.05, 1) : 0.51;
      return !allowed.currency.some((a) => Math.abs(a - v) <= tol);
    }
    return !allowed.percent.some((a) => Math.abs(a - v) <= 0.051 || Math.round(a) === v);
  });
}

// ─── narrative fallback ────────────────────────────────────────────────────

/** An agent narrative written for the date wins; otherwise the hub's own draft posts, as today. */
export function chooseDraftText(existing: { status?: string | null; draft_text?: string | null; narrative_at?: string | null } | null, hubText: string): { text: string; by: 'narrative' | 'hub' } {
  if (existing && existing.status === 'draft' && existing.narrative_at && String(existing.draft_text ?? '').trim()) return { text: String(existing.draft_text), by: 'narrative' };
  return { text: hubText, by: 'hub' };
}

/** Sendable to a client only with a named approver. */
export const isApprovedForClient = (row: { approved_by_id?: string | null; approved_at?: string | null }) => !!row.approved_by_id && !!row.approved_at;
