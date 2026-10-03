// The morning task digest: one message per person, per lane, top-level.
//
// Top-level and not a thread reply on purpose. Slack nests exactly one level, so
// a person only gets their own correction thread if their list is its own root
// message. Only the owner is @-mentioned — four buyers in one channel means one
// notification each, not four.
//
// Nothing here writes to Slack. The caller posts through `postToSlack()`, the
// single guarded write path.

import {
  collapseNearDuplicates, DIGEST_CAP, ESCALATE_AFTER_DAYS, sameList, sortActionable,
} from './daily-update-rules.ts';

export const HUB_TASKS_URL = 'https://hub.connectpaidmedia.com/tasks';
const HUB_BRIEF_URL = 'https://hub.connectpaidmedia.com/creative?brief=';

/** AJ is the fallback account lead when an item has no client or no assigned lead. */
const FALLBACK_LEAD_ID = '1fdd684e-6cb7-447e-b616-7e1b9c598971';

/** Hard cap on listed items; the rest collapse into "+N more". */
export const MAX_ITEMS = DIGEST_CAP;

/**
 * Recency backstop. A daily message says "here is today"; work whose last real
 * activity is older than this belongs in a weekly review, not here.
 *
 * "Real activity" is deliberately NOT `updated_at`: a trigger bumps that on any
 * write, so every row looks fresh and a staleness read built on it is wrong.
 * We use only events a person caused — a status milestone, a comment, or a
 * deliverable upload — falling back to creation.
 */
export const RECENCY_DAYS = 30;

export const isStale = (lastActivityIso: string, now = new Date()): boolean =>
  new Date(lastActivityIso).getTime() < now.getTime() - RECENCY_DAYS * 86_400_000;

/** Latest of a set of timestamps, ignoring nulls. Always returns a value. */
export function latestActivity(fallback: string, ...stamps: (string | null | undefined)[]): string {
  let best = fallback;
  for (const s of stamps) {
    if (s && String(s) > best) best = String(s);
  }
  return best;
}

export const LANES = ['media', 'creative'] as const;
export type Lane = (typeof LANES)[number];

/** The two internal channels this digest is allowed to write to. */
export const LANE_CHANNELS: Record<Lane, { id: string; purpose: string }> = {
  media: { id: 'C0C3QCHJ1PA', purpose: 'media' },
  creative: { id: 'C0C2ZMBTXL4', purpose: 'creative' },
};

/**
 * People whose default lane is creative. Designers are creative by role; Henry
 * is the creative lead, so his creative-ops work belongs in the creative
 * channel even when it carries no client. Their work only moves to the media
 * channel when the task sits on a media account — which is how Henry ends up
 * with two messages rather than one mixed list.
 */
export const CREATIVE_LANE_ROLES = new Set(['designer']);
export const CREATIVE_LANE_NAMES = new Set(['henry']);

/** Engagement types that make a task unambiguously media-side. */
const MEDIA_ENGAGEMENT = new Set(['pay_per_call', 'performance_media']);

export interface MemberRow {
  id: string;
  name: string;
  role: string | null;
  slack_user_id: string | null;
  is_active: boolean | null;
}

export interface DigestItem {
  kind: 'task' | 'brief';
  id: string;
  title: string;
  client: string | null;
  due_date: string | null;
  overdue: boolean;
  /** Days past due, for the "late 4d" flag. 0 when due today or not overdue. */
  late_days?: number;
  created_at: string;
  /** Last human event on the item — see RECENCY_DAYS. */
  last_activity?: string;
  /** Original title, when the displayed one was rendered from brief fields. */
  raw_title?: string;
  /** Where the item came from: the Wispr meeting, the Slack message, or the brief. */
  source_url?: string | null;
  priority?: string | null;
  client_id?: string | null;
  /** Near-duplicate siblings folded into this item. */
  merged_ids?: string[];
}

export interface EscalationMessage {
  lane: Lane;
  channel_id: string;
  channel_name: string;
  lead: MemberRow;
  text: string;
  items: (DigestItem & { assignee: string })[];
}

/**
 * The creative production queue. A brief is a designer's work only while it sits
 * in one of these states. `approved` and `delivered` are NOT on the queue: the
 * work is signed off or already out, and a morning list that resurfaces them is
 * exactly the noise AJ objected to.
 */
export const PRODUCTION_QUEUE_STATUSES = ['submitted', 'in_design', 'ready_for_review'] as const;

/** Whole days between two ISO dates (yyyy-mm-dd), never negative. */
export function daysLate(dueDate: string, today: string): number {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  return d > 0 ? d : 0;
}


export interface BriefFields {
  title: string;
  creative_type?: string | null;
  creative_types?: string[] | null;
  num_concepts?: number | null;
  sizes?: unknown;
  delivered_count?: number;
}

/**
 * True when a title is a filename rather than an instruction: once the client
 * name and separators are removed, one single token is left — "Cannaball_
 * PersonalDebt_", "Leadgen_FE_4", "Connatria_HVAC". A title with real words in
 * it ("Health Share FE CTV_60-90seconds") is left exactly as written: half-
 * rewriting prose reads worse than the filename does.
 */
export function looksLikeAssetLabel(title: string, clientName: string | null = null): boolean {
  const t = title.trim();
  if (!t) return false;
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clientKey = compact(clientName ?? '');
  const tokens = t
    .split(/\s+/)
    .filter((w) => !/^[—–-]$/.test(w))
    .filter((w) => !(clientKey && compact(w) === clientKey));
  if (tokens.length !== 1) return false;
  return /_/.test(tokens[0]);
}

const FORMAT_WORD: Record<string, string> = {
  video: 'video',
  static: 'static',
  statics: 'static',
  carousel: 'carousel',
  gif: 'GIF',
  script: 'script',
};

/** Lower-case ordinary words, leave acronyms and numbers as they are (FE, CTV). */
const softLower = (w: string) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w);

/**
 * Split a label into the name in front of it and what it is about:
 * "Cannaball_PersonalDebt_" -> { owner: 'Cannaball', subject: 'personal debt' }
 * "LeadGen — Leadgen_FE_4"  -> { owner: 'LeadGen',   subject: 'FE 4' }
 * The owner is dropped from the subject so a client prefix is never doubled.
 */
export function labelParts(
  title: string,
  clientName: string | null,
): { owner: string | null; subject: string } {
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clientKey = compact(clientName ?? '');
  const clientWords = new Set(
    (clientName ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean),
  );

  // Drop the client's own name before splitting CamelCase, so "Leadgen_FE_4"
  // under client "LeadGen" does not survive as "lead gen".
  const words = title
    .replace(/[—–]/g, ' ')
    .replace(/[_]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !(clientKey && compact(w) === clientKey))
    .flatMap((w) => w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .filter(Boolean);

  let rest = words.filter((w) => !clientWords.has(w.toLowerCase()));
  let owner = clientName;
  // No client on the brief: the label's own leading token is the best name we
  // have, and it is stated rather than guessed.
  if (!owner && rest.length > 1) {
    owner = rest[0];
    rest = rest.slice(1);
  }
  return { owner, subject: rest.map(softLower).join(' ').trim() };
}

/**
 * Render a creative item as an action, using only what the brief states.
 * Where there is nothing to build an action from, the label is kept and merely
 * prefixed with the client — guessing a deliverable is worse than a filename.
 */
export function renderCreativeTitle(brief: BriefFields, clientName: string | null): string {
  const title = String(brief.title ?? '').trim();
  if (!looksLikeAssetLabel(title, clientName)) return title;

  const formats = [
    ...(Array.isArray(brief.creative_types) ? brief.creative_types : []),
    ...(brief.creative_type ? [brief.creative_type] : []),
  ]
    .map((f) => FORMAT_WORD[String(f).toLowerCase()] ?? String(f).toLowerCase())
    .filter(Boolean);
  const format = formats[0] ?? null;

  const asked = Number(brief.num_concepts ?? 0);
  const done = Number(brief.delivered_count ?? 0);
  const outstanding = asked > 0 ? Math.max(asked - done, 0) : 0;
  const { owner, subject: rawSubject } = labelParts(title, clientName);
  // The message renderer already puts the client in front of each item, so a
  // prefix here is added only when the name came from the label itself — a
  // brief with no client on it.
  const prefix = owner && !clientName ? `${owner} — ` : '';
  // The format is already named in the rendered phrase; keep it out of the
  // subject so nothing reads "3 statics Q3 statics".
  const formatWords = new Set(formats.flatMap((f) => [f.toLowerCase(), `${f.toLowerCase()}s`]));
  const subject = rawSubject
    .split(' ')
    .filter((w) => w && !formatWords.has(w.toLowerCase()))
    .join(' ');

  if (format && outstanding > 0) {
    const noun = outstanding === 1 ? format : `${format}s`;
    return `${prefix}deliver ${outstanding} ${subject ? `${subject} ` : ''}${noun}`.replace(/\s+/g, ' ');
  }
  if (format && subject) return `${prefix}${subject} ${format}`;
  return `${prefix}${title}`;
}

export interface DigestMessage {
  lane: Lane;
  channel_id: string;
  channel_name: string;
  member: MemberRow;
  mention: string;
  text: string;
  items: DigestItem[];
  shown: DigestItem[];
  hidden_count: number;
  /** True when today's shown list is the same as the last digest's. */
  unchanged?: boolean;
}

export function isCreativeLaneMember(member: MemberRow): boolean {
  return (
    CREATIVE_LANE_ROLES.has((member.role ?? '').toLowerCase()) ||
    CREATIVE_LANE_NAMES.has((member.name ?? '').trim().toLowerCase().split(' ')[0])
  );
}

/**
 * A task's lane. Creative when it came out of a creative brief or sits on a
 * creative-only account; otherwise media — except for creative-lane people,
 * whose unattributed work stays creative and only crosses to media when the
 * account itself is a media account.
 */
export function laneForTask(
  task: { task_type?: string | null; type_data?: Record<string, unknown> | null },
  engagementType: string | null,
  member: MemberRow,
): Lane {
  const fromBrief =
    task.task_type === 'creative_brief' ||
    !!(task.type_data as Record<string, unknown> | null)?.brief_id ||
    !!(task.type_data as Record<string, unknown> | null)?.creative_brief_id;
  if (fromBrief) return 'creative';
  if (engagementType === 'creative_only') return 'creative';
  if (isCreativeLaneMember(member)) {
    return engagementType && MEDIA_ENGAGEMENT.has(engagementType) ? 'media' : 'creative';
  }
  return 'media';
}

/**
 * Henry's intake: a creative request pinged at him in an internal channel became
 * a task to WRITE the brief. It belongs in the creative channel with the
 * designers, but it is his and it reads as "create the brief", not production.
 */
export function isIntakeTask(task: { type_data?: Record<string, unknown> | null }): boolean {
  const td = (task.type_data ?? {}) as Record<string, unknown>;
  return td.source === 'slack_henry_intake' || td.creative_intake === true;
}

/** Overdue first, oldest overdue leading; then the newest work. */

export function sortItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.overdue && b.overdue) return (a.due_date ?? '').localeCompare(b.due_date ?? '');
    return b.created_at.localeCompare(a.created_at);
  });
}

const FOOTER = '✅ aligned   ·   ✏️ editing, see my reply   ·   ❌ not mine';
const NUMBER_WORD = ['zero', 'one', 'two', 'three'];

function itemLine(item: DigestItem, i: number): string {
  const prefix = item.client ? `${item.client} — ` : '';
  const merged = item.merged_ids?.length ? ` (+${item.merged_ids.length} similar merged)` : '';
  const late = item.late_days && item.late_days > 0 ? ` · late ${item.late_days}d` : '';
  const src = item.source_url ? ` · <${item.source_url}|source>` : ' · no source recorded';
  return `  ${i + 1}. ${prefix}${item.title}${merged}${late}${src}`;
}

export function buildMessageText(opts: {
  mention: string;
  weekday: string;
  lane: Lane;
  items: DigestItem[];
  today: string;
  /** Item ids shown in this person's previous digest for this lane. */
  previousIds?: string[] | null;
}): { text: string; shown: DigestItem[]; hidden: number; unchanged: boolean } {
  const ordered = sortActionable(opts.items, opts.today);
  const shown = ordered.slice(0, DIGEST_CAP);
  const hidden = ordered.length - shown.length;
  const head = `${opts.mention} · ${opts.weekday} · ${opts.lane}`;

  if (opts.previousIds && sameList(shown.map((i) => i.id), opts.previousIds)) {
    const n = NUMBER_WORD[shown.length] ?? String(shown.length);
    return {
      text: `${head} — Same ${n} as yesterday — nothing new. <${HUB_TASKS_URL}|open in the hub>`,
      shown, hidden, unchanged: true,
    };
  }

  const lines: string[] = [head, '', 'Today'];
  shown.forEach((item, i) => lines.push(itemLine(item, i)));
  lines.push(hidden > 0
    ? `  +${hidden} more in the hub · <${HUB_TASKS_URL}|open>`
    : `  <${HUB_TASKS_URL}|open in the hub>`);
  lines.push('');
  lines.push(FOOTER);
  return { text: lines.join('\n'), shown, hidden, unchanged: false };
}

/** One message to an account lead, once per item: decide it, then it leaves the daily list. */
export function buildEscalationText(mention: string, items: (DigestItem & { assignee: string })[]): string {
  const lines = [`${mention} — open over ${ESCALATE_AFTER_DAYS} days late. For each: do it, reassign it, or kill it.`, ''];
  const shown = items.slice(0, 10);
  shown.forEach((item, i) => {
    const prefix = item.client ? `${item.client} — ` : '';
    const src = item.source_url ? ` · <${item.source_url}|source>` : ' · no source recorded';
    lines.push(`  ${i + 1}. ${prefix}${item.title} — ${item.assignee}'s, late ${item.late_days}d${src}`);
  });
  if (items.length > shown.length) lines.push(`  +${items.length - shown.length} more · <${HUB_TASKS_URL}|open in the hub>`);
  lines.push('');
  lines.push('These stop appearing in the daily list after today. They stay in the hub.');
  return lines.join('\n');
}

/** Wall-clock day, hour and weekday in US Eastern, daylight saving included. */
export function easternNow(now = new Date()): {
  hour: number;
  weekdayShort: string;
  weekdayLong: string;
  date: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const long = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(now);
  return {
    hour: Number(parts.hour),
    weekdayShort: String(parts.weekday),
    weekdayLong: long,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export const isWeekday = (weekdayShort: string) =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekdayShort);

/**
 * Collect every person's items and build their messages.
 *
 * Only `todo` tasks, and only tasks that came through the gate — a task with no
 * `type_data.source` never passed a quality check and has no business waking
 * anyone up. `backlog` is the pool people pull from, not today's list.
 */
export async function buildDigests(
  supabase: any,
  todayEastern: string,
  weekdayLong: string,
): Promise<{
  messages: DigestMessage[];
  escalations: EscalationMessage[];
  skipped: { member: string; reason: string }[];
  excluded: { member: string; kind: string; title: string; reason: string }[];
}> {
  const skipped: { member: string; reason: string }[] = [];
  const excluded: { member: string; kind: string; title: string; reason: string }[] = [];

  const { data: members, error: memberErr } = await supabase
    .from('team_members')
    .select('id, name, role, slack_user_id, is_active')
    .eq('is_active', true);
  if (memberErr) throw memberErr;
  const memberById = new Map<string, MemberRow>((members ?? []).map((m: MemberRow) => [m.id, m]));

  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, engagement_type');
  if (clientErr) throw clientErr;
  const clientById = new Map<string, { name: string; engagement_type: string | null }>(
    (clients ?? []).map((c: any) => [c.id as string, { name: c.name, engagement_type: c.engagement_type }]),
  );

  const { data: tasks, error: taskErr } = await supabase
    .from('tasks')
    .select('id, title, client_id, due_date, created_at, assignee_id, task_type, type_data, priority')
    .eq('status', 'todo')
    .not('assignee_id', 'is', null);
  if (taskErr) throw taskErr;

  // The creative lane has an explicit rule, not a heuristic: a brief is a
  // designer's work only while it is ON the production queue AND due today or
  // late. Two explicit fields decide it — `status` and `due_date` — so nothing
  // is inferred from activity here (the media lane keeps that logic).
  //
  // `presumed_complete_at` is a closed state: the work was judged done from its
  // own deliverable evidence, and a digest must never resurface it.
  const { data: briefs, error: briefErr } = await supabase
    .from('creative_briefs')
    .select(
      'id, title, client_id, due_date, created_at, assigned_to_id, status, delivered_at, deleted_at, ' +
        'presumed_complete_at, submitted_at, approved_at, trafficked_at, creative_type, creative_types, num_concepts, sizes',
    )
    .in('status', PRODUCTION_QUEUE_STATUSES as unknown as string[])
    .not('due_date', 'is', null)
    .lte('due_date', todayEastern)
    .is('deleted_at', null)
    .is('presumed_complete_at', null)
    .not('assigned_to_id', 'is', null);
  if (briefErr) throw briefErr;


  // --- last real activity --------------------------------------------------
  // Human events only. `updated_at` is bumped by a trigger, so it cannot tell
  // stale work from a row that was merely rewritten.
  const briefIds = (briefs ?? []).map((b: any) => b.id as string);
  const taskIds = (tasks ?? []).map((t: any) => t.id as string);
  const newest = new Map<string, string>();
  const note = (key: string, stamp: unknown) => {
    const s = stamp ? String(stamp) : '';
    if (!s) return;
    if (!newest.has(key) || s > newest.get(key)!) newest.set(key, s);
  };
  const deliveredCount = new Map<string, number>();

  const chunk = <T>(xs: T[], n = 200) =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  for (const ids of chunk(briefIds)) {
    const [{ data: comments }, { data: delivs }] = await Promise.all([
      supabase.from('creative_brief_comments').select('brief_id, created_at').in('brief_id', ids),
      supabase.from('creative_deliverables').select('brief_id, uploaded_at').in('brief_id', ids),
    ]);
    for (const c of comments ?? []) note(`brief:${c.brief_id}`, c.created_at);
    for (const d of delivs ?? []) {
      note(`brief:${d.brief_id}`, d.uploaded_at);
      deliveredCount.set(String(d.brief_id), (deliveredCount.get(String(d.brief_id)) ?? 0) + 1);
    }
  }
  for (const ids of chunk(taskIds)) {
    const { data: comments } = await supabase
      .from('task_comments')
      .select('task_id, created_at')
      .in('task_id', ids);
    for (const c of comments ?? []) note(`task:${c.task_id}`, c.created_at);
  }

  // member id -> lane -> items
  const byMember = new Map<string, Map<Lane, DigestItem[]>>();
  const push = (memberId: string, lane: Lane, item: DigestItem) => {
    if (!byMember.has(memberId)) byMember.set(memberId, new Map());
    const lanes = byMember.get(memberId)!;
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push(item);
  };

  for (const t of tasks ?? []) {
    const member = memberById.get(t.assignee_id as string);
    if (!member) continue;
    const source = (t.type_data as Record<string, unknown> | null)?.source;
    if (!source) continue; // never went through the gate
    const client = t.client_id ? clientById.get(t.client_id as string) : undefined;
    const lane = laneForTask(t, client?.engagement_type ?? null, member);
    const last = latestActivity(String(t.created_at), newest.get(`task:${t.id}`));
    // The creative lane carries the production queue and Henry's brief-creation
    // intake — nothing else. Any other task assigned to a creative-lane person
    // stays in the hub and out of the morning message.
    if (lane === 'creative' && !isIntakeTask(t)) {
      excluded.push({
        member: member.name,
        kind: 'task',
        title: String(t.title ?? '').trim(),
        reason: 'creative lane carries production-queue briefs and brief-creation intake only',
      });
      continue;
    }
    if (isStale(last)) {
      excluded.push({
        member: member.name,
        kind: 'task',
        title: String(t.title ?? '').trim(),
        reason: `no activity since ${last.slice(0, 10)} (older than ${RECENCY_DAYS} days)`,
      });
      continue;
    }

    push(member.id, lane, {
      kind: 'task',
      id: t.id as string,
      title: String(t.title ?? '').trim(),
      client: client?.name ?? null,
      due_date: (t.due_date as string | null) ?? null,
      overdue: !!t.due_date && String(t.due_date) < todayEastern,
      late_days: t.due_date ? daysLate(String(t.due_date), todayEastern) : 0,
      created_at: String(t.created_at),
      last_activity: last,
      priority: (t.priority as string | null) ?? null,
      client_id: (t.client_id as string | null) ?? null,
      source_url: taskSourceUrl(t.type_data as Record<string, unknown> | null),
    });

  }

  for (const b of briefs ?? []) {
    const member = memberById.get(b.assigned_to_id as string);
    if (!member) continue;
    const rawTitle = String(b.title ?? '').trim();
    // No status or staleness test here: the query already applied the rule.
    const last = latestActivity(
      String(b.created_at),
      b.submitted_at as string | null,
      b.approved_at as string | null,
      b.trafficked_at as string | null,
      newest.get(`brief:${b.id}`),
    );
    const client = b.client_id ? clientById.get(b.client_id as string) : undefined;
    const shown = renderCreativeTitle(
      {
        title: rawTitle,
        creative_type: b.creative_type as string | null,
        creative_types: b.creative_types as string[] | null,
        num_concepts: b.num_concepts as number | null,
        sizes: b.sizes,
        delivered_count: deliveredCount.get(String(b.id)) ?? 0,
      },
      client?.name ?? null,
    );
    const due = (b.due_date as string | null) ?? null;
    push(member.id, 'creative', {
      kind: 'brief',
      id: b.id as string,
      title: shown,
      raw_title: shown === rawTitle ? undefined : rawTitle,
      client: client?.name ?? null,
      due_date: due,
      overdue: !!due && String(due) < todayEastern,
      late_days: due ? daysLate(String(due), todayEastern) : 0,
      created_at: String(b.created_at),
      last_activity: last,
      client_id: (b.client_id as string | null) ?? null,
      source_url: `${HUB_BRIEF_URL}${b.id}`,
    });
  }


  // --- escalation & previous lists --------------------------------------
  const { data: escalatedRows } = await supabase
    .from('task_digest_escalations').select('item_kind, item_id, digest_date');
  const escalated = new Map<string, string>(
    (escalatedRows ?? []).map((r: any) => [`${r.item_kind}:${r.item_id}`, String(r.digest_date)]),
  );
  const { data: assignments } = await supabase
    .from('client_assignments').select('client_id, team_member_id, role_on_account');
  const leadFor = (clientId: string | null | undefined): string => {
    const rows = (assignments ?? []).filter((a: any) => a.client_id === clientId);
    const am = rows.find((a: any) => a.role_on_account === 'account_manager');
    const mb = rows.find((a: any) => a.role_on_account === 'media_buyer');
    return String((am ?? mb)?.team_member_id ?? FALLBACK_LEAD_ID);
  };
  const { data: previousPosts } = await supabase
    .from('task_digest_posts')
    .select('team_member_id, lane, digest_date, task_ids, brief_ids')
    .lt('digest_date', todayEastern)
    .order('digest_date', { ascending: false })
    .limit(500);
  const previousIds = new Map<string, string[]>();
  for (const p of previousPosts ?? []) {
    const key = `${p.team_member_id}:${p.lane}`;
    if (!previousIds.has(key)) previousIds.set(key, [...(p.task_ids ?? []), ...(p.brief_ids ?? [])]);
  }

  const messages: DigestMessage[] = [];
  const escalationByLead = new Map<string, Map<Lane, (DigestItem & { assignee: string })[]>>();
  for (const [memberId, lanes] of byMember) {
    const member = memberById.get(memberId)!;
    for (const lane of LANES) {
      const raw = lanes.get(lane) ?? [];
      // Near-duplicates collapse to one survivor, repeated until stable.
      const { survivors } = collapseNearDuplicates(raw);
      const items: DigestItem[] = [];
      for (const item of survivors) {
        const key = `${item.kind}:${item.id}`;
        if ((item.late_days ?? 0) > ESCALATE_AFTER_DAYS) {
          if (escalated.has(key)) {
            excluded.push({ member: member.name, kind: item.kind, title: item.title, reason: `escalated on ${escalated.get(key)}; stays in the hub` });
          } else {
            const lead = leadFor(item.client_id);
            if (!escalationByLead.has(lead)) escalationByLead.set(lead, new Map());
            const byLane = escalationByLead.get(lead)!;
            if (!byLane.has(lane)) byLane.set(lane, []);
            byLane.get(lane)!.push({ ...item, assignee: member.name });
            excluded.push({ member: member.name, kind: item.kind, title: item.title, reason: `late ${item.late_days}d — escalated today to the account lead` });
          }
          continue;
        }
        items.push(item);
      }
      if (items.length === 0) continue; // silence when someone has nothing
      if (!member.slack_user_id) {
        skipped.push({ member: member.name, reason: 'no Slack user id on their team record' });
        continue;
      }
      const built = buildMessageText({
        mention: `<@${member.slack_user_id}>`,
        weekday: weekdayLong,
        lane,
        items,
        today: todayEastern,
        previousIds: previousIds.get(`${member.id}:${lane}`) ?? null,
      });
      messages.push({
        lane,
        channel_id: LANE_CHANNELS[lane].id,
        channel_name: lane === 'media' ? 'media-team-tasks' : 'creative-team-tasks',
        member,
        mention: `<@${member.slack_user_id}>`,
        text: built.text,
        items: sortActionable(items, todayEastern),
        shown: built.shown,
        hidden_count: built.hidden,
        unchanged: built.unchanged,
      });
    }
  }

  const escalations: EscalationMessage[] = [];
  for (const [leadId, lanes] of escalationByLead) {
    const lead = memberById.get(leadId);
    if (!lead) continue;
    for (const [lane, items] of lanes) {
      const mention = lead.slack_user_id ? `<@${lead.slack_user_id}>` : lead.name;
      escalations.push({
        lane,
        channel_id: LANE_CHANNELS[lane].id,
        channel_name: lane === 'media' ? 'media-team-tasks' : 'creative-team-tasks',
        lead,
        text: buildEscalationText(mention, items),
        items,
      });
    }
  }

  messages.sort((a, b) => a.lane.localeCompare(b.lane) || a.member.name.localeCompare(b.member.name));
  return { messages, escalations, skipped, excluded };
}

/** The meeting or message a task came from. A task you cannot trace is a task you cannot do. */
export function taskSourceUrl(td: Record<string, unknown> | null): string | null {
  const t = td ?? {};
  for (const k of ['share_link', 'permalink', 'slack_permalink', 'source_url', 'meeting_url']) {
    const v = t[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}
