// The morning task digest: one message per person, per lane, top-level.
//
// Top-level and not a thread reply on purpose. Slack nests exactly one level, so
// a person only gets their own correction thread if their list is its own root
// message. Only the owner is @-mentioned — four buyers in one channel means one
// notification each, not four.
//
// Nothing here writes to Slack. The caller posts through `postToSlack()`, the
// single guarded write path.

export const HUB_TASKS_URL = 'https://hub.connectpaidmedia.com/tasks';

/** Hard cap on listed items; the rest collapse into "+N more". */
export const MAX_ITEMS = 5;

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
  created_at: string;
  /** Last human event on the item — see RECENCY_DAYS. */
  last_activity?: string;
  /** Original title, when the displayed one was rendered from brief fields. */
  raw_title?: string;
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
 * True when a title is an asset/folder label rather than an instruction:
 * underscore- or dash-joined tokens, a trailing separator, or a single
 * whitespace-free token. Nobody can act on a filename at 9am.
 */
export function looksLikeAssetLabel(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/[_-]\s*$/.test(t)) return true;
  if (!/\s/.test(t)) return true; // one token, e.g. "Leadgen_FE_4"
  // "LeadGen — Leadgen_FE_4" style: every whitespace-separated word that is not
  // a separator is itself an underscored token.
  const words = t.split(/\s+/).filter((w) => !/^[—–-]$/.test(w));
  return words.length > 0 && words.every((w) => /_/.test(w));
}

const FORMAT_WORD: Record<string, string> = {
  video: 'video',
  static: 'static',
  statics: 'static',
  carousel: 'carousel',
  gif: 'GIF',
  script: 'script',
};

/** "Cannaball_PersonalDebt_" -> "personal debt"; drops the client token. */
export function labelSubject(title: string, clientName: string | null): string {
  const cleaned = title.replace(/[—–]/g, ' ').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const clientWords = new Set(
    (clientName ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean),
  );
  const words = cleaned
    .split(' ')
    .flatMap((w) => w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .filter((w) => w && !clientWords.has(w.toLowerCase()));
  return words.join(' ').toLowerCase().trim();
}

/**
 * Render a creative item as an action, using only what the brief states.
 * Where there is nothing to build an action from, the label is kept and merely
 * prefixed with the client — guessing a deliverable is worse than a filename.
 */
export function renderCreativeTitle(brief: BriefFields, clientName: string | null): string {
  const title = String(brief.title ?? '').trim();
  if (!looksLikeAssetLabel(title)) return title;

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
  const subject = labelSubject(title, clientName);
  const prefix = clientName ? `${clientName} — ` : '';

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

/** Overdue first, oldest overdue leading; then the newest work. */
export function sortItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.overdue && b.overdue) return (a.due_date ?? '').localeCompare(b.due_date ?? '');
    return b.created_at.localeCompare(a.created_at);
  });
}

const FOOTER = '✅ aligned   ·   ✏️ editing, see my reply   ·   ❌ not mine';

export function buildMessageText(opts: {
  mention: string;
  weekday: string;
  lane: Lane;
  items: DigestItem[];
}): { text: string; shown: DigestItem[]; hidden: number } {
  const ordered = sortItems(opts.items);
  const shown = ordered.slice(0, MAX_ITEMS);
  const hidden = ordered.length - shown.length;

  const lines: string[] = [];
  lines.push(`${opts.mention} · ${opts.weekday} · ${opts.lane}`);
  lines.push('');
  lines.push('Today');
  shown.forEach((item, i) => {
    const prefix = item.client ? `${item.client} — ` : '';
    lines.push(`  ${i + 1}. ${prefix}${item.title}`);
  });
  if (hidden > 0) lines.push(`  +${hidden} more · <${HUB_TASKS_URL}|open in the hub>`);
  lines.push('');
  lines.push(FOOTER);

  return { text: lines.join('\n'), shown, hidden };
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
    .select('id, title, client_id, due_date, created_at, assignee_id, task_type, type_data')
    .eq('status', 'todo')
    .not('assignee_id', 'is', null);
  if (taskErr) throw taskErr;

  // Creative briefs are the creative team's real queue; their tasks table rows
  // are only part of the picture.
  //
  // `presumed_complete_at` is a closed state: the work was judged done from its
  // own deliverable evidence, and a digest must never resurface it.
  const { data: briefs, error: briefErr } = await supabase
    .from('creative_briefs')
    .select(
      'id, title, client_id, due_date, created_at, assigned_to_id, status, delivered_at, deleted_at, ' +
        'presumed_complete_at, submitted_at, approved_at, trafficked_at, creative_type, creative_types, num_concepts, sizes',
    )
    .is('delivered_at', null)
    .is('deleted_at', null)
    .is('presumed_complete_at', null)
    .not('assigned_to_id', 'is', null);
  if (briefErr) throw briefErr;

  // `delivered` means the work went out. It is closed unless something
  // explicitly reopened it (which moves the status back off `delivered`).
  const BRIEF_CLOSED = new Set(['delivered', 'trafficked', 'archived', 'cancelled', 'draft']);

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
      created_at: String(t.created_at),
      last_activity: last,
    });
  }

  for (const b of briefs ?? []) {
    const member = memberById.get(b.assigned_to_id as string);
    if (!member) continue;
    const rawTitle = String(b.title ?? '').trim();
    if (BRIEF_CLOSED.has(String(b.status ?? ''))) {
      excluded.push({
        member: member.name,
        kind: 'brief',
        title: rawTitle,
        reason: `status is ${b.status} — closed work`,
      });
      continue;
    }
    const last = latestActivity(
      String(b.created_at),
      b.submitted_at as string | null,
      b.approved_at as string | null,
      b.trafficked_at as string | null,
      newest.get(`brief:${b.id}`),
    );
    if (isStale(last)) {
      excluded.push({
        member: member.name,
        kind: 'brief',
        title: rawTitle,
        reason: `no activity since ${last.slice(0, 10)} (older than ${RECENCY_DAYS} days)`,
      });
      continue;
    }
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
    push(member.id, 'creative', {
      kind: 'brief',
      id: b.id as string,
      title: shown,
      raw_title: shown === rawTitle ? undefined : rawTitle,
      client: client?.name ?? null,
      due_date: (b.due_date as string | null) ?? null,
      overdue: !!b.due_date && String(b.due_date) < todayEastern,
      created_at: String(b.created_at),
      last_activity: last,
    });
  }

  const messages: DigestMessage[] = [];
  for (const [memberId, lanes] of byMember) {
    const member = memberById.get(memberId)!;
    for (const lane of LANES) {
      const items = lanes.get(lane) ?? [];
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
      });
      messages.push({
        lane,
        channel_id: LANE_CHANNELS[lane].id,
        channel_name: lane === 'media' ? 'media-team-tasks' : 'creative-team-tasks',
        member,
        mention: `<@${member.slack_user_id}>`,
        text: built.text,
        items: sortItems(items),
        shown: built.shown,
        hidden_count: built.hidden,
      });
    }
  }

  messages.sort((a, b) => a.lane.localeCompare(b.lane) || a.member.name.localeCompare(b.member.name));
  return { messages, skipped, excluded };
}
