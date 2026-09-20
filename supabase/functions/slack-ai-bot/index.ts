// CPM Bot — answers questions about the clients we actually have.
//
// THE RULE THAT OUTRANKS EVERYTHING ELSE: never state a number whose provenance
// is unknown. Revenue that was never captured is UNKNOWN, not zero. The gate is
// enforced in the metric layer (_shared/client-metrics.ts), which simply does not
// produce a revenue, profit or margin value for a window containing uncaptured
// calls — so the model has no such number to quote — and it is restated in the
// system prompt in as many words.
//
// Clients are resolved from the database (_shared/client-resolve.ts): channel
// mapping, then name / slug / alias match. There is no hardcoded client list.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropic, truncate, ANTHROPIC_DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { logAiUsage } from "../_shared/cost-tracking.ts";
import { getValidBotToken } from "../_shared/slack-token.ts";
import { postToSlack, canPostToChannel, SlackRefusedError } from "../_shared/slack-post.ts";
import { handleKillReaction, captureKillComment, isKillReaction } from "../_shared/task-kill.ts";
import { handleDigestReaction, captureDigestReply, ackKindForReaction } from "../_shared/task-digest-ack.ts";
import { resolveClient, loadActiveClients, type ResolvedClientRow } from "../_shared/client-resolve.ts";
import { computeClientMetrics, buildCaptureSafeSummary, type ClientMetrics } from "../_shared/client-metrics.ts";
import { runReadOnlySql } from "../_shared/bot-sql.ts";
import { isDuplicateDelivery, checkThrottle, logQa, resolveTeamMember } from "../_shared/bot-guard.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DIRECT_CHANNEL_TYPES = new Set(['im', 'app_home']);
const PENDING_REPLY_TEXT = 'Got it — thinking…';

// DM channels have no mapping row, so they are allowed only after the human on
// the other side is confirmed to be a member of our own workspace.
const directMessageVerified = new Set<string>();

async function isInternalSlackUser(token: string, userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const [meRes, userRes] = await Promise.all([
      fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
      fetch(`https://slack.com/api/users.info?user=${userId}`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const me = await meRes.json();
    const info = await userRes.json();
    if (!me.ok || !info.ok || !info.user) {
      console.warn('DM verification failed:', me.error || info.error || 'unknown');
      return false;
    }
    if (info.user.is_stranger === true) return false;
    return !!me.team_id && info.user.team_id === me.team_id;
  } catch (e) {
    console.warn('DM verification error:', e);
    return false;
  }
}

// ─── Slack helpers ─────────────────────────────────────────────────────────

async function verifySlackSignature(body: string, timestamp: string, signature: string): Promise<boolean> {
  try {
    const sigBasestring = `v0:${timestamp}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(SLACK_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring));
    const hashHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `v0=${hashHex}` === signature;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

function getCleanMessageText(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

function isDirectConversationEvent(event: any) {
  return event.type === 'message' && DIRECT_CHANNEL_TYPES.has(event.channel_type || '');
}

function mapSlackMessagesToConversation(messages: any[], botUserId: string | null) {
  return messages
    .filter((m: any) => !m.subtype)
    .map((m: any) => ({
      role: m.user === botUserId ? 'assistant' : 'user',
      content: getCleanMessageText(m.text || ''),
    }))
    .filter((m: any) => m.content.length > 0 && m.content !== PENDING_REPLY_TEXT);
}

async function getBotUserId(token: string): Promise<string | null> {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  return data.ok ? data.user_id : null;
}

async function getConversationHistory(
  token: string,
  channel: string,
  threadTs: string,
  isDirectConversation: boolean,
): Promise<Array<{ role: string; content: string }>> {
  const endpoint = isDirectConversation
    ? `https://slack.com/api/conversations.history?channel=${channel}&limit=12`
    : `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=20`;

  const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!data.ok || !data.messages) return [];

  const botUserId = await getBotUserId(token);
  const orderedMessages = isDirectConversation ? [...data.messages].reverse() : data.messages;
  return mapSlackMessagesToConversation(orderedMessages, botUserId);
}

// ─── Dates ─────────────────────────────────────────────────────────────────

const DEFAULT_BUSINESS_TIME_ZONE = 'America/New_York';

interface UserContext { name: string; tzOffsetSeconds: number; timeZone: string | null }

function padDatePart(value: number): string { return String(value).padStart(2, '0'); }
function formatShiftedDate(date: Date): string {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}
function normalizeDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return formatShiftedDate(candidate);
}
function parseExplicitDate(text: string, fallbackYear: number): string | null {
  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return normalizeDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!slashMatch) return null;
  const yearToken = slashMatch[3];
  const year = !yearToken ? fallbackYear : yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken);
  return normalizeDateParts(year, Number(slashMatch[1]), Number(slashMatch[2]));
}
function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return formatShiftedDate(date);
  return `${year}-${month}-${day}`;
}
function getResolvedToday(userContext: Pick<UserContext, 'tzOffsetSeconds' | 'timeZone'>): string {
  const timeZone = userContext.timeZone?.trim();
  if (timeZone && timeZone.toLowerCase() !== 'utc' && timeZone.toLowerCase() !== 'etc/utc') {
    return formatDateInTimeZone(new Date(), timeZone);
  }
  if (userContext.tzOffsetSeconds !== 0) return formatShiftedDate(new Date(Date.now() + userContext.tzOffsetSeconds * 1000));
  return formatDateInTimeZone(new Date(), DEFAULT_BUSINESS_TIME_ZONE);
}
function shiftIsoDate(dateValue: string, days: number): string {
  const shifted = new Date(`${dateValue}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatShiftedDate(shifted);
}
function parseDateIntent(
  text: string,
  userContext: Pick<UserContext, 'tzOffsetSeconds' | 'timeZone'>,
): { from: string; to: string; userToday: string; label: string } {
  const today = getResolvedToday(userContext);
  const lower = text.toLowerCase();
  const explicitDate = parseExplicitDate(lower, Number(today.slice(0, 4)));
  if (explicitDate) return { from: explicitDate, to: explicitDate, userToday: today, label: explicitDate };
  if (lower.includes('today')) return { from: today, to: today, userToday: today, label: 'today' };
  if (lower.includes('yesterday')) {
    const y = shiftIsoDate(today, -1);
    return { from: y, to: y, userToday: today, label: 'yesterday' };
  }
  if (lower.includes('since the 15') || lower.includes('since sep 15') || lower.includes('since 15')) {
    return { from: `${today.slice(0, 4)}-09-15`, to: today, userToday: today, label: 'since 15 September' };
  }
  if (lower.includes('this month') || lower.includes('past month') || lower.includes('last 30')) {
    return { from: shiftIsoDate(today, -30), to: today, userToday: today, label: 'the last 30 days' };
  }
  return { from: shiftIsoDate(today, -7), to: today, userToday: today, label: 'the last 7 days' };
}

async function resolveUserContext(token: string, userId: string): Promise<UserContext> {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return {
    name: data.user?.profile?.display_name || data.user?.real_name || 'Someone',
    tzOffsetSeconds: data.user?.tz_offset || 0,
    timeZone: data.user?.tz || null,
  };
}

// ─── Supporting context (everything that is not a metric) ──────────────────

async function gatherSupportingContext(client: ResolvedClientRow, window: { from: string; to: string }): Promise<string> {
  const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const isMediaAccount = client.engagement_type === 'pay_per_call' || client.engagement_type === 'performance_media';
  const usesRoku = (client.expected_sources || []).includes('roku_spend');

  const [tasksRes, candidatesRes, contextRes, reviewsRes, dailyRes, briefsRes, campaignsRes, creativesRes, rokuRes] = await Promise.all([
    supabase.from('tasks').select('title, status, priority, due_date').eq('client_id', client.id)
      .in('status', ['todo', 'in_progress']).order('due_date', { ascending: true }).limit(20),
    supabase.from('task_candidates').select('proposed_title, status, confidence').eq('client_id', client.id)
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    supabase.from('context_items').select('title, content, source, occurred_at').eq('client_id', client.id)
      .gte('occurred_at', sinceIso).order('occurred_at', { ascending: false }).limit(40),
    supabase.from('media_brain_reviews').select('cadence, window_start, window_end, status, totals, pull_ok, pull_error')
      .eq('client_id', client.id).order('created_at', { ascending: false }).limit(3),
    supabase.from('client_daily_updates').select('for_date, status, final_text, draft_text, am_notes')
      .eq('client_id', client.id).order('for_date', { ascending: false }).limit(2),
    supabase.from('creative_briefs').select('title, status, due_date, delivered_at').eq('client_id', client.id)
      .order('created_at', { ascending: false }).limit(15),
    isMediaAccount && !usesRoku
      ? supabase.from('ad_campaigns').select('campaign_name, platform, spend, clicks, impressions, status, date')
          .eq('client_id', client.id).gte('date', window.from).lte('date', window.to)
          .order('spend', { ascending: false }).limit(120)
      : Promise.resolve({ data: [] }),
    isMediaAccount && !usesRoku
      ? supabase.from('ad_creatives').select('ad_name, platform, spend, clicks, ctr, creative_type, status')
          .eq('client_id', client.id).gte('date_from', window.from).order('spend', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    usesRoku
      ? supabase.from('roku_daily_metrics').select('campaign_name, spend, impressions, video_completions')
          .eq('client_id', client.id).eq('entity', 'campaign').gte('date', window.from).lte('date', window.to)
          .order('spend', { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
  ]);

  const out: string[] = [`--- SUPPORTING CONTEXT: ${client.name} ---`];
  if (client.data_model_note) out.push(`ACCOUNT NOTE (authoritative): ${client.data_model_note}`);
  out.push(`expected sources: ${(client.expected_sources || []).join(', ') || 'none recorded'}`);

  if (rokuRes.data?.length) {
    const byCampaign: Record<string, { spend: number; imps: number; comps: number }> = {};
    for (const r of rokuRes.data as any[]) {
      const k = r.campaign_name || '(unnamed)';
      byCampaign[k] = byCampaign[k] || { spend: 0, imps: 0, comps: 0 };
      byCampaign[k].spend += Number(r.spend) || 0;
      byCampaign[k].imps += Number(r.impressions) || 0;
      byCampaign[k].comps += Number(r.video_completions) || 0;
    }
    out.push('\nRoku campaigns (spend in window):');
    for (const [name, v] of Object.entries(byCampaign).sort((a, b) => b[1].spend - a[1].spend).slice(0, 12)) {
      out.push(`  • ${name}: $${v.spend.toFixed(2)}, ${v.imps} impressions, ${v.comps} completions`);
    }
  }

  if (campaignsRes.data?.length) {
    const byCampaign: Record<string, { spend: number; clicks: number; platform: string; status: string }> = {};
    for (const r of campaignsRes.data as any[]) {
      const k = r.campaign_name || '(unnamed)';
      byCampaign[k] = byCampaign[k] || { spend: 0, clicks: 0, platform: r.platform, status: r.status || 'unknown' };
      byCampaign[k].spend += Number(r.spend) || 0;
      byCampaign[k].clicks += Number(r.clicks) || 0;
    }
    out.push('\nAd campaigns (spend in window):');
    for (const [name, v] of Object.entries(byCampaign).sort((a, b) => b[1].spend - a[1].spend).slice(0, 12)) {
      out.push(`  • ${name} (${v.platform}, ${v.status}): $${v.spend.toFixed(2)}, ${v.clicks} clicks`);
    }
  }

  if (creativesRes.data?.length) {
    out.push('\nTop creatives by spend:');
    for (const c of creativesRes.data as any[]) {
      out.push(`  • ${c.ad_name || '(unnamed)'} (${c.platform}, ${c.creative_type || 'n/a'}): $${Number(c.spend || 0).toFixed(2)}, CTR ${c.ctr ?? 'n/a'}`);
    }
  }

  if (reviewsRes.data?.length) {
    out.push('\nMedia Brain reviews (most recent first):');
    for (const r of reviewsRes.data as any[]) {
      out.push(`  • ${r.cadence} ${r.window_start}→${r.window_end} [${r.status}]${r.pull_ok === false ? ` PULL FAILED: ${r.pull_error}` : ''}`);
    }
  } else {
    out.push('\nMedia Brain reviews: none recorded.');
  }

  if (dailyRes.data?.length) {
    out.push('\nMost recent client daily updates:');
    for (const d of dailyRes.data as any[]) {
      out.push(`  • ${d.for_date} [${d.status}]: ${truncate((d.final_text || d.draft_text || '').replace(/\n/g, ' '), 400)}`);
      if (d.am_notes) out.push(`    internal notes: ${truncate(String(d.am_notes).replace(/\n/g, ' '), 300)}`);
    }
  }

  if (briefsRes.data?.length) {
    const open = (briefsRes.data as any[]).filter((b) => !b.delivered_at);
    out.push(`\nCreative briefs: ${briefsRes.data.length} recent, ${open.length} not yet delivered.`);
    for (const b of open.slice(0, 8)) out.push(`  • ${b.title} [${b.status}]${b.due_date ? ` due ${b.due_date}` : ''}`);
  }

  if (tasksRes.data?.length) {
    out.push(`\nOpen tasks (${tasksRes.data.length}):`);
    for (const t of tasksRes.data as any[]) out.push(`  • [${t.priority}] ${t.title} (${t.status})${t.due_date ? ` due ${t.due_date}` : ''}`);
  }
  if (candidatesRes.data?.length) {
    out.push(`\nPending task proposals awaiting review (${candidatesRes.data.length}):`);
    for (const c of candidatesRes.data as any[]) out.push(`  • ${c.proposed_title}`);
  }

  if (contextRes.data?.length) {
    const rows = contextRes.data as any[];
    out.push('\nRecent communications (last 30 days):');
    for (const c of rows.slice(0, 25)) {
      out.push(`  • [${c.source} ${(c.occurred_at || '').slice(0, 10)}] ${c.title || ''}: ${truncate((c.content || '').replace(/\n/g, ' '), 220)}`);
    }
  }

  out.push('--- END SUPPORTING CONTEXT ---');
  return out.join('\n');
}

// ─── Model calls ───────────────────────────────────────────────────────────

interface AIReply { text: string; charts: Array<{ url: string; title: string; chart_type: string }>; tokensIn: number; tokensOut: number; error?: string }

async function callLovableFallback(messages: Array<{ role: string; content: string }>): Promise<AIReply | null> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'google/gemini-2.5-pro', messages, temperature: 0.3, max_tokens: 1600 }),
    });
    if (!res.ok) {
      console.error('Fallback model failed:', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      charts: [],
      tokensIn: data.usage?.prompt_tokens || 0,
      tokensOut: data.usage?.completion_tokens || 0,
    };
  } catch (e) {
    console.error('Fallback model exception:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function callAI(messages: Array<{ role: string; content: string }>, clientIdForLogging?: string | null): Promise<AIReply> {
  const result = await callAnthropic(messages, { max_tokens: 1200, temperature: 0.4, enableCharts: true });

  if (!result.ok) {
    console.error('Anthropic error:', result.status, result.error);
    if (result.status === 429 || result.status === 529 || result.status === 503) {
      const fallback = await callLovableFallback(messages);
      if (fallback && fallback.text.trim()) return fallback;
    }
    return { text: '', charts: [], tokensIn: 0, tokensOut: 0, error: `model ${result.status}: ${result.error || 'unavailable'}` };
  }

  if (result.usage) {
    logAiUsage({
      client_id: clientIdForLogging ?? null,
      surface: 'slack-ai-bot',
      model: ANTHROPIC_DEFAULT_MODEL,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_tokens: result.usage.cache_read_input_tokens,
      cache_write_tokens: result.usage.cache_creation_input_tokens,
      metadata: { charts: result.charts.length },
    }).catch((e) => console.error('logAiUsage failed:', e));
  }

  return {
    text: result.content || '',
    charts: result.charts,
    tokensIn: result.usage?.input_tokens || 0,
    tokensOut: result.usage?.output_tokens || 0,
  };
}

/**
 * Optional read-only SQL step, for questions the canonical metrics do not cover.
 * The model proposes a single SELECT; the database enforces read-only.
 */
const METRIC_WORDS = /(spend|spent|call|calls|revenue|profit|margin|cost per|convert|payout|lead|leads|duration|connected)/i;

/** Names and aliases of the team, so "AJ" is not searched for literally. */
async function loadRoster(): Promise<string> {
  const { data } = await supabase.from('team_members')
    .select('name, email, role, aliases, is_active').eq('is_active', true).order('name');
  return (data || []).map((m: any) =>
    `${m.name} (${m.role}${m.aliases?.length ? `; also called ${m.aliases.join(', ')}` : ''}) id-by-email ${m.email}`
  ).join('\n');
}

async function maybeRunSqlFallback(question: string, clientName: string | null, roster: string): Promise<{ sql: string; rows: unknown[] } | null> {
  if (METRIC_WORDS.test(question)) return null;

  const plan = await callAnthropic([
    {
      role: 'system',
      content: `You write a single read-only Postgres SELECT against an advertising agency's database, or decline.
Tables you may use include: clients, team_members, tasks, task_candidates, creative_briefs, creative_deliverables, shoot_briefs, context_items, client_daily_updates, media_brain_economics, media_brain_reviews, data_integrity_exceptions, ad_campaigns, ad_sets, ad_creatives, ad_daily_metrics, roku_daily_metrics, ringba_calls, ringfuel_calls, cannaball_calls, moja_calls, jacuzzi_leads, bot_qa_log.
Rules: SELECT or WITH…SELECT only; one statement; no semicolons; no comments; never reference auth/vault/storage schemas, slack_tokens, platform_connections, or any column named like token/secret/password; always LIMIT 50 or fewer.
A person named in the question must be matched against this roster — never search for a nickname
literally, look up which roster name it belongs to and filter on that name or email:
${roster}
Reply with json only: {"sql": "..."} or {"sql": null} when a query is not the right tool.`,
    },
    { role: 'user', content: `Client in scope: ${clientName || 'none resolved'}\nQuestion: ${question}` },
  ], { max_tokens: 400, temperature: 0 });

  if (!plan.ok || !plan.content) return null;
  let sql: string | null = null;
  try {
    const cleaned = plan.content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    sql = JSON.parse(cleaned)?.sql ?? null;
  } catch {
    return null;
  }
  if (!sql) return null;

  const out = await runReadOnlySql(supabase, sql, 50);
  if (!out.ok) {
    console.warn('SQL fallback rejected:', out.error);
    return null;
  }
  return { sql: out.sql, rows: out.rows };
}

// ─── The prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(args: {
  channelInfo: string;
  userName: string;
  today: string;
  windowLabel: string;
  clients: ResolvedClientRow[];
  client: ResolvedClientRow | null;
  candidates: ResolvedClientRow[];
  metricsBlock: string;
  supportingBlock: string;
  sqlBlock: string;
  roster: string;
}): string {
  const roster = args.clients.map((c) => `${c.name} (${c.engagement_type || 'engagement type not recorded'})`).join('; ');

  return `You are CPM Bot, the internal assistant for Connect Paid Media (CPM), a paid-media agency. You answer questions from the CPM team about our clients, campaigns, tasks and creative work.

NEVER STATE A NUMBER WHOSE PROVENANCE IS UNKNOWN. ABSENT IS NOT ZERO.
Some calls reach us without revenue or conversion data (revenue_captured = false, conversion_captured = false, or payload_shape = webhook_minimal). Their revenue column reads 0 because nothing was captured, NOT because nothing was earned. Where the metrics below show a value as UNKNOWN you must say it is unknown, say how many calls are affected, and refuse to compute revenue, profit or margin. Never substitute 0, never estimate, never average around it. Saying "$0 revenue" about uncaptured data would be catastrophically wrong and you would be saying it to the whole team at speed.

HOW TO QUOTE NUMBERS
- Quote only from the CANONICAL METRICS block. Each metric has a key in [brackets] — name the metric you used, e.g. "cost per call [cost_per_call]".
- Carry each metric's coverage note when it qualifies the number.
- Never recompute a metric from raw rows, and never add a metric that is marked unknown into an arithmetic result.
- If the answer needs a metric that is not in the block, say what is missing rather than improvising it.
- Anything from the READ-ONLY SQL block must be labelled "computed directly from the database, not a verified metric". If it disagrees with a canonical metric, report both figures and flag the discrepancy explicitly — never silently prefer one.

WHAT MONEY MEANS, PER ACCOUNT TYPE
- performance_media (Spektrafin, Cannaball, Jacuzzi, RateQuote): CPM buys the media. Revenue is the revenue field; profit = revenue − media spend; downside is capped at media spend, so a negative result means profit not earned, never a debt. The payout field is NOT income on these accounts.
- pay_per_call (BuyologyIQ, RRM, Hablyte, PPC Media): CPM is the publisher, so payout is what CPM is paid.
- Jacuzzi is paid per LEAD — calls and QR scans count identically and are never separated.
- Spektrafin earns $16 per CONVERTED call (was $23 until 2026-09-09) and roughly 73.5% of calls convert, so it is NOT $16 per raw call.
- Other engagement types (ecommerce, creative_only, pre_launch, self_managed) are not paid per call; there is no call revenue to quote.

CLIENT SCOPE
Active clients: ${roster}
${args.client
    ? `This question resolved to: ${args.client.name}.`
    : args.candidates.length
      ? `Several clients matched: ${args.candidates.map((c) => c.name).join(', ')}. Ask which one they mean — do not pick one.`
      : 'No client resolved. Ask which client they mean and offer the most likely few from the roster. Do not guess.'}

STYLE
- Concise, Slack-formatted (*bold*, _italic_, bullets), under 2000 characters.
- Lead with the answer. Flag data gaps plainly instead of papering over them.
- The person asking is ${args.userName}. Today is ${args.today}. Window under discussion: ${args.windowLabel}.

${args.channelInfo}
${args.metricsBlock}
${args.supportingBlock}
${args.sqlBlock}`;
}

// ─── Slack messaging ───────────────────────────────────────────────────────
// All writes go through the guarded helper in _shared/slack-post.ts.

async function postSlackMessage(_token: string, channel: string, text: string, threadTs?: string) {
  const out = await postToSlack({
    channel, method: 'chat.postMessage', text, threadTs,
    directMessageVerifiedInternal: directMessageVerified.has(channel),
  });
  if (out.refused) throw new SlackRefusedError(out.reason || 'refused', channel);
  if (!out.ok) throw new Error(out.error || 'chat post failed');
  return { ok: true, ts: out.ts as string };
}

async function addReaction(_token: string, channel: string, timestamp: string, emoji: string) {
  try {
    await postToSlack({
      channel, method: 'reactions.add', reactionTimestamp: timestamp, reactionName: emoji,
      directMessageVerifiedInternal: directMessageVerified.has(channel),
    });
  } catch (e) {
    console.warn('reaction error (non-fatal):', e);
  }
}

async function uploadChartToSlack(_token: string, channel: string, chart: { url: string; title: string }, threadTs?: string) {
  try {
    const imgRes = await fetch(chart.url);
    if (!imgRes.ok) return;
    const blob = await imgRes.blob();
    const filename = `${chart.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    const out = await postToSlack({
      channel, method: 'files.upload', threadTs,
      file: { bytes: blob, filename, title: chart.title },
      directMessageVerifiedInternal: directMessageVerified.has(channel),
    });
    if (!out.ok) console.warn('chart upload skipped:', out.reason || out.error);
  } catch (e) {
    console.warn('uploadChartToSlack error (non-fatal):', e);
  }
}

// ─── Answer composition (shared by Slack and the dry run) ──────────────────

interface ComposedAnswer {
  text: string;
  charts: Array<{ url: string; title: string; chart_type: string }>;
  client: ResolvedClientRow | null;
  metrics: ClientMetrics | null;
  metricsUsed: string[];
  sqlUsed: string | null;
  hadUncapturedData: boolean;
  tokensIn: number;
  tokensOut: number;
  error?: string;
}

async function composeAnswer(args: {
  question: string;
  channelId?: string | null;
  channelName?: string | null;
  historyText?: string;
  conversation?: Array<{ role: string; content: string }>;
  userContext: UserContext;
}): Promise<ComposedAnswer> {
  const dateRange = parseDateIntent(args.question, args.userContext);
  const resolution = await resolveClient(supabase, {
    channelId: args.channelId,
    text: args.question,
    historyText: args.historyText,
  });

  let metrics: ClientMetrics | null = null;
  let metricsBlock = '--- CANONICAL METRICS ---\nNo client resolved, so no metrics were computed.\n--- END CANONICAL METRICS ---';
  let supportingBlock = '';

  if (resolution.client) {
    metrics = await computeClientMetrics(supabase, resolution.client, { from: dateRange.from, to: dateRange.to });
    metricsBlock = metrics.promptBlock;
    supportingBlock = await gatherSupportingContext(resolution.client, { from: dateRange.from, to: dateRange.to });
  }

  const roster = await loadRoster();
  const sqlOut = await maybeRunSqlFallback(args.question, resolution.client?.name ?? null, roster);
  const sqlBlock = sqlOut
    ? `--- READ-ONLY SQL (computed directly from the database, not a verified metric) ---\nquery: ${sqlOut.sql}\nrows: ${JSON.stringify(sqlOut.rows).slice(0, 4000)}\nNOTE: an empty result, or a count of 0 from a query that filtered on a person or client name, may mean the FILTER MATCHED NOBODY rather than that the real answer is zero. Say which it is, or say you could not tell.\n--- END READ-ONLY SQL ---`
    : '';

  const systemPrompt = buildSystemPrompt({
    channelInfo: args.channelName ? `Channel: #${args.channelName}` : '',
    userName: args.userContext.name,
    today: dateRange.userToday,
    windowLabel: `${dateRange.label} (${dateRange.from} to ${dateRange.to})`,
    clients: resolution.clients,
    client: resolution.client,
    candidates: resolution.candidates,
    metricsBlock,
    supportingBlock,
    sqlBlock,
    roster,
  });

  const conversation = args.conversation?.length ? args.conversation : [{ role: 'user', content: args.question }];
  const reply = await callAI([{ role: 'system', content: systemPrompt }, ...conversation], resolution.client?.id ?? null);

  // The safe answer never depends on the model: if it fails, the metric layer
  // still answers, with its coverage notes intact.
  let text = reply.text?.trim() || '';
  if (!text) {
    text = metrics
      ? `${buildCaptureSafeSummary(metrics)}\n\n_(My language model is unavailable right now, so this is the metric layer's own summary.)_`
      : resolution.candidates.length
        ? `Which client do you mean? Both ${resolution.candidates.map((c) => c.name).join(' and ')} matched your message.`
        : `Which client are you asking about? I cover: ${resolution.clients.map((c) => c.name).join(', ')}.`;
  }

  return {
    text,
    charts: reply.charts,
    client: resolution.client,
    metrics,
    metricsUsed: metrics?.metricsUsed ?? [],
    sqlUsed: sqlOut?.sql ?? null,
    hadUncapturedData: metrics?.hadUncapturedData ?? false,
    tokensIn: reply.tokensIn,
    tokensOut: reply.tokensOut,
    error: reply.error,
  };
}

// ─── Slack event processing ────────────────────────────────────────────────

async function processSlackMessage(event: any) {
  const isDirectConversation = isDirectConversationEvent(event);
  const historyAnchorTs = event.thread_ts || event.ts;
  const replyThreadTs = historyAnchorTs;
  const cleanText = getCleanMessageText(event.text || '');
  const startedAt = Date.now();
  let channelName: string | null = null;
  let teamMemberId: string | null = null;

  try {
    const token = await getValidBotToken();

    if (isDirectConversation) {
      if (!(await isInternalSlackUser(token, event.user))) {
        console.warn('Slack DM ignored — user is not a verified internal workspace member:', event.user);
        return;
      }
      directMessageVerified.add(event.channel);
    } else if (!(await canPostToChannel(event.channel))) {
      console.warn('Slack reply suppressed by channel guard before processing:', event.channel);
      return;
    }

    const member = await resolveTeamMember(supabase, event.user);
    teamMemberId = member?.id ?? null;

    const throttle = await checkThrottle(supabase, { slackUserId: event.user, channelId: event.channel });
    if (!throttle.allowed) {
      await postSlackMessage(token, event.channel, throttle.message!, replyThreadTs);
      await logQa(supabase, {
        asked_by_slack_id: event.user, team_member_id: teamMemberId, channel_id: event.channel,
        thread_ts: replyThreadTs, question: cleanText, answer: throttle.message,
        error: `throttled: ${throttle.reason}`, latency_ms: Date.now() - startedAt,
      });
      return;
    }

    addReaction(token, event.channel, event.ts, 'brain');
    await postSlackMessage(token, event.channel, PENDING_REPLY_TEXT, replyThreadTs);

    if (!isDirectConversation) {
      const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${event.channel}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const chanData = await chanRes.json();
      channelName = chanData.channel?.name || null;
    }

    const conversation = await getConversationHistory(token, event.channel, historyAnchorTs, isDirectConversation);
    const userContext = await resolveUserContext(token, event.user);

    const answer = await composeAnswer({
      question: cleanText,
      channelId: event.channel,
      channelName,
      historyText: conversation.map((m) => m.content).join(' '),
      conversation,
      userContext,
    });

    await postSlackMessage(token, event.channel, answer.text, replyThreadTs);
    for (const chart of answer.charts) await uploadChartToSlack(token, event.channel, chart, replyThreadTs);

    await logQa(supabase, {
      asked_by_slack_id: event.user, team_member_id: teamMemberId, channel_id: event.channel,
      channel_name: channelName, thread_ts: replyThreadTs, question: cleanText,
      resolved_client_id: answer.client?.id ?? null, answer: answer.text,
      metrics_used: answer.metricsUsed, sql_used: answer.sqlUsed,
      had_uncaptured_data: answer.hadUncapturedData,
      tokens_in: answer.tokensIn, tokens_out: answer.tokensOut,
      latency_ms: Date.now() - startedAt, error: answer.error ?? null,
    });
  } catch (error) {
    if (error instanceof SlackRefusedError) {
      console.warn('Slack reply suppressed by channel guard:', error.reason, event.channel);
      return;
    }
    console.error('Error processing Slack event:', error);
    await logQa(supabase, {
      asked_by_slack_id: event.user, team_member_id: teamMemberId, channel_id: event.channel,
      channel_name: channelName, thread_ts: replyThreadTs, question: cleanText,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await postToSlack({
        channel: event.channel,
        text: 'Sorry, I hit an error while processing that. Please try again! 🔧',
        threadTs: replyThreadTs,
        directMessageVerifiedInternal: directMessageVerified.has(event.channel),
      });
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}

// ─── HTTP ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const bodyText = await req.text();
  const timestamp = req.headers.get('x-slack-request-timestamp') || '';
  const slackSignature = req.headers.get('x-slack-signature') || '';

  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Dry run: service-role only, answers a question WITHOUT touching Slack.
  if (body.dry_run === true) {
    const bearer = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    const nonce = req.headers.get('x-cron-nonce') || '';
    let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
      const { data: tokenRow } = await supabase.from('cron_invocation_tokens').delete()
        .eq('token', nonce).gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
        .select('token').maybeSingle();
      authorized = !!tokenRow;
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const started = Date.now();
    try {
      const answer = await composeAnswer({
        question: String(body.question || ''),
        channelId: body.channel_id ?? null,
        channelName: body.channel_name ?? null,
        userContext: { name: body.asked_by || 'AJ', tzOffsetSeconds: 0, timeZone: 'America/New_York' },
      });
      return new Response(JSON.stringify({
        dry_run: true,
        posted_to_slack: false,
        resolved_client: answer.client ? { id: answer.client.id, name: answer.client.name } : null,
        metrics_used: answer.metricsUsed,
        sql_used: answer.sqlUsed,
        had_uncaptured_data: answer.hadUncapturedData,
        answer: answer.text,
        metric_detail: answer.metrics?.metrics ?? null,
        model_error: answer.error ?? null,
        latency_ms: Date.now() - started,
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!(await verifySlackSignature(bodyText, timestamp, slackSignature))) {
    console.error('Invalid Slack signature');
    return new Response('Unauthorized', { status: 401 });
  }

  if (body.type === 'event_callback') {
    const event = body.event;
    const eventKey = `${body.event_id || ''}:${event?.channel || ''}:${event?.ts || ''}`;

    if (isDuplicateDelivery(req, eventKey)) {
      console.log('Duplicate or retried delivery ignored:', eventKey);
      return new Response(JSON.stringify({ ok: true, ignored: 'duplicate' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reactions are checked before the bot/subtype filter, which they never carry.
    // Two gates share the ❌: the morning digest's acknowledgement gate and the
    // older per-task fast kill. The digest is tried first, so a reaction is never
    // counted twice. With the reaction_added subscription off, neither runs and a
    // digest simply stays unacknowledged.
    if (event.type === 'reaction_added' && (ackKindForReaction(event.reaction) || isKillReaction(event.reaction))) {
      EdgeRuntime.waitUntil((async () => {
        const kind = await handleDigestReaction(supabase, event);
        if (kind) { console.log('task-digest: acknowledged as', kind); return; }
        if (isKillReaction(event.reaction)) {
          const n = await handleKillReaction(supabase, event);
          if (n > 0) console.log('task-kill: rejected', n, 'task(s) from a Slack reaction');
        }
      })());
      return new Response(JSON.stringify({ ok: true, status: 'reaction_received' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (event.bot_id || event.subtype) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // A thread reply under a digest marked ✏️ or ❌ is the correction; under a
    // killed task it is the reason. Stored, never fed back into a prompt.
    if (event.type === 'message' && event.thread_ts) {
      EdgeRuntime.waitUntil((async () => {
        const captured = await captureDigestReply(supabase, event);
        if (!captured) await captureKillComment(supabase, event);
      })());
    }

    if (event.type === 'app_mention' || isDirectConversationEvent(event)) {
      EdgeRuntime.waitUntil(processSlackMessage(event));
      return new Response(JSON.stringify({ ok: true, status: 'received' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
