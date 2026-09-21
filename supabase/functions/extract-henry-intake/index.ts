// Henry's intake lane.
//
// A creative request pinged at Henry in an INTERNAL Slack channel is not a
// designer's task — no brief exists yet. It is Henry's task to WRITE the brief.
// Designers only ever get scheduled production work (see _shared/task-digest.ts).
//
// Three rules, same as every other extractor:
//   1. Internal channels only, fail-closed: a channel qualifies only where
//      `slack_channel_mappings.is_external = false` AND `classified_at` is set.
//      Unmapped or unclassified is never a source. Client-facing channels are
//      read for context and never acted on this way.
//   2. Nothing writes to `tasks`. Rows go to `task_candidates` and through
//      `gateCandidates` in _shared/task-gate.ts — Gate A is the quality check,
//      so this file's detection only has to be conservative, never clever.
//   3. Dedupe on the SOURCE MESSAGE, keyed on the Slack thread root ts, so a
//      thread that keeps being discussed yields one intake task, not one a reply.
//
// Nothing is posted to Slack here. Slack is read-only in this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { askModel, gateCandidates, type CandidateRow } from '../_shared/task-gate.ts';
import { getValidBotToken } from '../_shared/slack-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Henry's Slack id, used to recognise a ping and to skip his own messages. */
const HENRY_SLACK_ID = 'U09HG10GAJ0';
const HENRY_ALIASES = ['henry olson', 'henry'];

const LOOKBACK_DAYS_DEFAULT = 7;

/** A verb that asks for something to be produced or actioned. */
const ASK_CUES = [
  'can you', 'can we', 'could you', 'could we', 'would you', 'please', 'pls',
  'need', 'needs', 'we want', 'i want', 'i would love', "i'd love", 'lets', "let's",
  'put in', 'put together', 'send over', 'send me', 'spin up', 'set up', 'write up',
  'make', 'create', 'build', 'draft', 'design', 'produce', 'request', 'requesting',
  'add a', 'get me', 'give me', 'work up', 'brief out',
];

/** A creative noun, so an account or reporting ask is not mistaken for one. */
const CREATIVE_NOUNS = [
  'brief', 'creative', 'creatives', 'ad', 'ads', 'static', 'statics', 'video', 'videos',
  'script', 'scripts', 'banner', 'banners', 'carousel', 'thumbnail', 'asset', 'assets',
  'cut', 'cuts', 'edit', 'edits', 'variation', 'variations', 'concept', 'concepts',
  'mockup', 'vsl', 'ugc', 'voiceover', 'copy', 'landing page', 'thumbnails',
];

/** Phrases that are explicitly NOT a request for work. */
const NOT_A_REQUEST = ['fyi', 'thank you', 'thanks', 'nice work', 'heads up', 'cc '];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

/**
 * The message with Slack furniture removed: mentions, links, emoji shortcodes.
 * Every test below reads THIS, so "@Henry FYI …" is judged on the "FYI".
 */
export function cleanText(text: string): string {
  return String(text)
    .replace(/<@[A-Z0-9]+>/g, ' ')
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, ' ')
    .replace(/@[A-Z][a-z]+(\s[A-Z][a-z]+)?/g, ' ')
    .replace(/<([^|>]+)\|([^>]*)>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/:[a-z0-9_+-]+:/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[\s,:;.!-]+/, '')
    .trim();
}

/** True when the message names Henry — by mention, alias, or first name. */
export function mentionsHenry(text: string): boolean {
  const t = norm(text);
  if (t.includes(`<@${HENRY_SLACK_ID.toLowerCase()}>`)) return true;
  // The sync rewrites mentions to "@Name", so a plain alias counts too.
  return HENRY_ALIASES.some((a) => new RegExp(`(^|[^a-z])@?${a}([^a-z]|$)`).test(t));
}

/**
 * True when the message asks for creative work. Deliberately strict: a mention
 * alone is not a request, and where it cannot be told apart the message is
 * dropped. A missed intake costs one Slack message; a false one costs trust,
 * and junk captured straight out of Slack is exactly what was objected to.
 */
export function isCreativeRequest(text: string): boolean {
  const t = norm(cleanText(text));
  if (!t) return false;
  if (NOT_A_REQUEST.some((p) => t.startsWith(p))) return false;
  if (!ASK_CUES.some((c) => t.includes(c))) return false;
  return CREATIVE_NOUNS.some((n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`).test(t));
}

/**
 * Fallback action phrase, used when the model is unavailable. The model writes
 * the title normally; this keeps the candidate readable rather than raw.
 */
export function askPhrase(text: string): string {
  let t = cleanText(text).split(/(?<=[.!?])\s|\n/)[0].trim();
  t = t.replace(
    /^(hey|hi|hello|ok|okay|also|and|so|just|quick one|quick|wanted to|wanting to|i wanted to|i want to|putting)[\s,]+/i,
    '',
  );
  t = t.replace(/^(can|could|would)\s+(you|we)\s+(please\s+)?/i, '');
  t = t.replace(/^please\s+/i, '');
  t = t.replace(/[\s.,;:]+$/, '');
  if (t.length > 90) t = `${t.slice(0, 87).trimEnd()}…`;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

const TITLE_SYSTEM = `You write one short task title for a creative lead named Henry, whose job here is to WRITE THE BRIEF for a request made in Slack.
Return json only: {"titles": {"<key>": "<action phrase>"}}.

The action phrase completes the sentence "Create brief: ___". Rules:
- Say only what the message actually asks for. Never invent a deliverable, a count, a format or a deadline that is not stated.
- 3 to 12 words, lower case start, no trailing punctuation, no Slack names, no @mentions.
- Do not include the client name; it is appended separately.
- If the message does not ask for creative work at all, return an empty string for that key.

Examples:
- "@Henry can we put in the brief for Cannaball debt for AI production with those edits today please?" -> "personal debt AI production, with the discussed edits"
- "@Henry I would love to request 1 or 2 more variations of aggressive scripts that edit the main video" -> "1-2 more aggressive script variations edited from the main video"`;

/** Model-written action phrases, keyed by dedupe key. Empty map on failure. */
async function titlePhrases(
  batch: { key: string; text: string }[],
  apiKey: string,
): Promise<Record<string, string>> {
  if (batch.length === 0 || !apiKey) return {};
  const prompt = `Write the action phrase for each Slack message below. Reply with json only, shaped {"titles": {"<key>": "<phrase>"}}.\n\n${
    JSON.stringify(batch.map((b) => ({ key: b.key, message: cleanText(b.text).slice(0, 1200) })))
  }`;
  const out = await askModel(TITLE_SYSTEM, prompt, apiKey);
  const titles = out?.titles;
  if (!titles || typeof titles !== 'object') return {};
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(titles)) {
    const s = String(v ?? '').replace(/\s+/g, ' ').replace(/[\s.]+$/, '').trim();
    if (s) clean[k] = s;
  }
  return clean;
}


async function permalinkFor(token: string | null, channelId: string, ts: string): Promise<string | null> {
  if (!token) return null;
  try {
    const res = await fetch(
      `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${ts}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    return data?.ok ? (data.permalink as string) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase
      .from('cron_invocation_tokens')
      .delete()
      .eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token')
      .maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dry_run === true;
    const days = Number(body.days ?? LOOKBACK_DAYS_DEFAULT);

    // Henry, from the database — never a hardcoded id.
    const { data: henryRows } = await supabase
      .from('team_members')
      .select('id, name, slack_user_id, is_active')
      .eq('is_active', true);
    const henry = (henryRows ?? []).find(
      (m: any) =>
        String(m.slack_user_id ?? '') === HENRY_SLACK_ID ||
        HENRY_ALIASES.includes(String(m.name ?? '').trim().toLowerCase()),
    );
    if (!henry) return json({ error: 'Henry has no active team_members row — nothing filed.' }, 200);

    // Fail-closed source set: internal AND classified only.
    const { data: mappings, error: mapErr } = await supabase
      .from('slack_channel_mappings')
      .select('channel_id, channel_name, client_id, is_external, classified_at');
    if (mapErr) throw mapErr;
    const internal = new Map<string, { name: string; client_id: string | null }>();
    for (const m of mappings ?? []) {
      if (m.is_external !== false) continue;
      if (!m.classified_at) continue;
      internal.set(String(m.channel_id), { name: String(m.channel_name), client_id: m.client_id ?? null });
    }

    const { data: clients } = await supabase.from('clients').select('id, name');
    const clientName = new Map<string, string>((clients ?? []).map((c: any) => [c.id, c.name]));

    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: items, error: itemErr } = await supabase
      .from('context_items')
      .select('id, client_id, content, occurred_at, participants, metadata')
      .eq('source', 'slack')
      .eq('content_type', 'message')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true });
    if (itemErr) throw itemErr;

    let token: string | null = null;
    try {
      token = await getValidBotToken();
    } catch {
      token = null; // permalinks are a nicety; the candidate still carries channel + ts
    }

    const rows: Record<string, unknown>[] = [];
    const considered: { channel: string; author: string; reason: string; text: string }[] = [];
    const seenKeys = new Set<string>();

    for (const it of items ?? []) {
      const meta = (it.metadata ?? {}) as Record<string, any>;
      const channelId = String(meta.channel_id ?? '');
      const source = internal.get(channelId);
      if (!source) continue; // external, unmapped or unclassified — never a source
      const text = String(it.content ?? '');
      if (String(meta.slack_user_id ?? '') === HENRY_SLACK_ID) continue; // his own message
      if (!mentionsHenry(text)) continue;
      if (!isCreativeRequest(text)) {
        considered.push({
          channel: `#${source.name}`,
          author: String(it.participants?.[0] ?? 'unknown'),
          reason: 'mentions Henry but reads as information, not a request',
          text: text.replace(/\s+/g, ' ').slice(0, 120),
        });
        continue;
      }

      const ts = String(meta.slack_ts ?? '');
      const rootTs = String(meta.thread_ts || ts);
      const key = `henry_intake:${channelId}:${rootTs}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const client = it.client_id ? clientName.get(String(it.client_id)) ?? null : null;
      const permalink = meta.permalink ?? (await permalinkFor(token, channelId, ts));

      rows.push({
        client_id: it.client_id ?? null,
        source: 'slack_henry_intake',
        source_ref: {
          channel_id: channelId,
          channel_name: source.name,
          slack_ts: ts,
          thread_ts: meta.thread_ts ?? null,
          permalink,
          author: it.participants?.[0] ?? null,
          requested_of: 'Henry',
        },
        raw_text: text,
        proposed_title: '',
        proposed_assignee_id: henry.id,
        owner_raw: henry.name,
        owner_side: 'cpm',
        status: 'pending',
        dedupe_key: key,
        _client_name: client,
      });
    }

    // Titles are written as the ACTION, from the message's own words — never the
    // raw Slack text pasted in. The model does it in one call; if it is
    // unavailable the deterministic phrase keeps the candidate readable.
    const apiKeyForTitles = Deno.env.get('LOVABLE_API_KEY') ?? '';
    const phrases = await titlePhrases(
      rows.map((r) => ({ key: String(r.dedupe_key), text: String(r.raw_text) })),
      apiKeyForTitles,
    );
    for (const r of rows) {
      const phrase = phrases[String(r.dedupe_key)] || askPhrase(String(r.raw_text));
      const clientSuffix = r._client_name ? ` — ${String(r._client_name)}` : '';
      r.proposed_title = `Create brief: ${phrase}${clientSuffix}`.slice(0, 200);
      delete r._client_name;
    }


    // The dedupe index is partial, so ON CONFLICT cannot target it — drop keys
    // we already hold instead.
    const { data: held } = rows.length
      ? await supabase.from('task_candidates').select('dedupe_key').in('dedupe_key', rows.map((r) => r.dedupe_key))
      : { data: [] as any[] };
    const heldKeys = new Set((held ?? []).map((h: any) => h.dedupe_key));
    const fresh = rows.filter((r) => !heldKeys.has(r.dedupe_key));

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        days,
        internal_channels: internal.size,
        henry: { id: henry.id, name: henry.name },
        would_create: fresh.length,
        already_held: rows.length - fresh.length,
        candidates: fresh.map((r) => ({
          title: r.proposed_title,
          channel: `#${(r.source_ref as any).channel_name}`,
          author: (r.source_ref as any).author,
          dedupe_key: r.dedupe_key,
          permalink: (r.source_ref as any).permalink,
        })),
        dropped_mentions: considered,
      });
    }

    let inserted: CandidateRow[] = [];
    if (fresh.length > 0) {
      const { data, error } = await supabase.from('task_candidates').insert(fresh).select('*');
      if (error) throw error;
      inserted = (data ?? []) as CandidateRow[];
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY') ?? '';
    const gate = inserted.length > 0 ? await gateCandidates(supabase, inserted, apiKey) : null;

    return json({
      ok: true,
      dry_run: false,
      days,
      created: inserted.length,
      already_held: rows.length - fresh.length,
      gate: gate?.summary ?? null,
      titles: inserted.map((c) => c.proposed_title),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('extract-henry-intake failed:', message);
    return json({ error: message }, 500);
  }
});
