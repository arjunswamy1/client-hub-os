// Creative follow-up ladder, morning check-ins and the weekly roll-up — pure
// rules plus one loader. Imported by mcp-hub (reads + check-in/review writes)
// and by the creative-followups job (which sends). This file never sends and
// must never import _shared/slack-post.ts.
//
// Ladder (working days, America/New_York):
//   not_accepted       submitted, no accept        designer +1 → Henry +2
//   in_design_stalled  in design, no activity      designer +3 → Henry +5
//   awaiting_review    ready_for_review, no review Henry +1    → AJ +3 (weekly roll-up, never a ping)
//   overdue            past due, still active      designer +1 → Henry +3
// Escalation needs the stage-1 chase to have been SENT and ignored.
// At most 3 chases per person per working day; the rest are held, not dropped.
// Nothing fires on a weekend. Approved/delivered (and closed-out) briefs are never in scope.

export const FOLLOWUP_ACTIVE_STATUSES = ['submitted', 'in_design', 'ready_for_review', 'revision_requested'];
export const DAILY_CAP_PER_PERSON = 3;
export type Rule = 'not_accepted' | 'in_design_stalled' | 'awaiting_review' | 'overdue';
export type Stage = 'designer' | 'lead' | 'owner';

export const LADDER: Record<Rule, { first: Stage; firstAfter: number; next: Stage; nextAfter: number; trigger: string }> = {
  not_accepted: { first: 'designer', firstAfter: 1, next: 'lead', nextAfter: 2, trigger: 'submitted and not accepted' },
  in_design_stalled: { first: 'designer', firstAfter: 3, next: 'lead', nextAfter: 5, trigger: 'in design with no activity' },
  awaiting_review: { first: 'lead', firstAfter: 1, next: 'owner', nextAfter: 3, trigger: 'ready for review with no review logged' },
  overdue: { first: 'designer', firstAfter: 1, next: 'lead', nextAfter: 3, trigger: 'past its due date and still active' },
};

// ─── dates ─────────────────────────────────────────────────────────────────

export function etParts(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday as string };
}
export const isWorkingDay = (weekdayShort: string) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekdayShort);
export const etDateOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : etParts(new Date(iso)).date);

/** Weekdays d with from < d <= to (ET calendar dates). 0 when from is today or later. */
export function workingDaysBetween(fromDate: string, toDate: string): number {
  let n = 0;
  const end = Date.parse(`${toDate}T12:00:00Z`);
  for (let t = Date.parse(`${fromDate}T12:00:00Z`) + 86400000; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// ─── ladder evaluation ─────────────────────────────────────────────────────

export interface FollowupBrief {
  id: string; title: string; client: string; status: string; due_date: string | null;
  assigned_to_id: string | null; accepted_at: string | null;
  status_since: string | null; last_activity: string | null; last_activity_kind: string | null;
  review_since_status: { action: string; at: string } | null;
  closed_out_at?: string | null; deleted_at?: string | null;
}
export interface FollowupRow { id?: string; brief_id: string; rule: string; stage: string; recipient_id: string | null; sent_at: string | null; resolved_at: string | null; created_at?: string }
export interface FollowupItem {
  brief_id: string; title: string; client: string; status: string; rule: Rule; stage: Stage;
  recipient_id: string | null; working_days_stuck: number; since: string; due_reason: string;
  already_sent: boolean; sent_at: string | null; delivery: 'dm' | 'weekly_rollup';
  held?: 'weekend' | 'daily_cap' | 'no_recipient'; note?: string;
}

/** Whether a rule's condition holds right now, and since when (ET date). */
export function ruleCondition(b: FollowupBrief, rule: Rule, today: string): { since: string } | null {
  if (b.deleted_at || b.closed_out_at || !FOLLOWUP_ACTIVE_STATUSES.includes(b.status)) return null;
  const at = (x: string | null) => (x ? etDateOf(x) : null);
  switch (rule) {
    case 'not_accepted':
      return b.status === 'submitted' && !b.accepted_at && at(b.status_since) ? { since: at(b.status_since)! } : null;
    case 'in_design_stalled': {
      if (!['in_design', 'revision_requested'].includes(b.status)) return null;
      const s = at(b.last_activity) ?? at(b.status_since);
      return s && workingDaysBetween(s, today) >= LADDER.in_design_stalled.firstAfter ? { since: s } : null;
    }
    case 'awaiting_review':
      return b.status === 'ready_for_review' && !b.review_since_status && at(b.status_since) ? { since: at(b.status_since)! } : null;
    case 'overdue':
      return b.due_date && b.due_date < today ? { since: b.due_date } : null;
  }
}

/** What cleared a follow-up, in words that go into creative_followups.resolution. */
export function resolutionFor(b: FollowupBrief | undefined, rule: Rule, today: string): string {
  if (!b || b.deleted_at) return 'brief_deleted';
  if (b.closed_out_at) return 'brief_closed_out';
  if (!FOLLOWUP_ACTIVE_STATUSES.includes(b.status)) return `status_changed_to_${b.status}`;
  switch (rule) {
    case 'not_accepted': return b.accepted_at ? 'accepted' : `status_changed_to_${b.status}`;
    case 'awaiting_review': return b.review_since_status ? `review_logged_${b.review_since_status.action}` : `status_changed_to_${b.status}`;
    case 'overdue': return b.due_date && b.due_date >= today ? `due_date_moved_to_${b.due_date}` : 'due_date_cleared';
    case 'in_design_stalled': return ['in_design', 'revision_requested'].includes(b.status) ? `activity_${b.last_activity_kind ?? 'recorded'}` : `status_changed_to_${b.status}`;
  }
}

function reasonText(rule: Rule, wd: number, b: FollowupBrief) {
  const d = `${wd} working day${wd === 1 ? '' : 's'}`;
  switch (rule) {
    case 'not_accepted': return `submitted ${d} ago and not yet accepted`;
    case 'in_design_stalled': return `in design with no activity for ${d}`;
    case 'awaiting_review': return `ready for review for ${d} with no review logged`;
    case 'overdue': return `${d} past its due date (${b.due_date}) and still ${b.status.replace(/_/g, ' ')}`;
  }
}

export interface EvaluateCtx { today: string; weekday: string; leadId: string | null; ownerId: string | null; sentTodayByRecipient: Record<string, number> }

export function evaluateFollowups(briefs: FollowupBrief[], existing: FollowupRow[], ctx: EvaluateCtx) {
  const byKey = new Map(existing.map((r) => [`${r.brief_id}|${r.rule}|${r.stage}`, r]));
  const items: FollowupItem[] = [];
  const qualifying = new Set<string>();
  for (const b of briefs) {
    for (const rule of Object.keys(LADDER) as Rule[]) {
      const cond = ruleCondition(b, rule, ctx.today);
      if (!cond) continue;
      qualifying.add(`${b.id}|${rule}`);
      const L = LADDER[rule];
      const wd = workingDaysBetween(cond.since, ctx.today);
      const recipientFor = (s: Stage) => (s === 'designer' ? b.assigned_to_id : s === 'lead' ? ctx.leadId : ctx.ownerId);
      // An unassigned brief has no designer to chase: its first chase goes to the lead.
      let first: Stage = L.first; let note: string | undefined;
      if (first === 'designer' && !b.assigned_to_id) { first = 'lead'; note = 'unassigned — first chase goes to the creative lead'; }
      const push = (stage: Stage) => {
        const row = byKey.get(`${b.id}|${rule}|${stage}`);
        const recipient = recipientFor(stage);
        items.push({
          brief_id: b.id, title: b.title, client: b.client, status: b.status, rule, stage, recipient_id: recipient,
          working_days_stuck: wd, since: cond.since, due_reason: reasonText(rule, wd, b),
          already_sent: !!row?.sent_at, sent_at: row?.sent_at ?? null, delivery: stage === 'owner' ? 'weekly_rollup' : 'dm',
          ...(recipient ? {} : { held: 'no_recipient' as const }), ...(note && stage === first ? { note } : {}),
        });
      };
      if (wd < L.firstAfter) continue;
      push(first);
      // Escalate only once the first chase was actually sent and the window passed.
      const firstRow = byKey.get(`${b.id}|${rule}|${first}`);
      if (first === L.first && wd >= L.nextAfter && firstRow?.sent_at) push(L.next);
    }
  }
  const resolve = existing
    .filter((r) => !r.resolved_at && !qualifying.has(`${r.brief_id}|${r.rule}`))
    .map((r) => ({ id: r.id, brief_id: r.brief_id, rule: r.rule, stage: r.stage, resolution: resolutionFor(briefs.find((b) => b.id === r.brief_id), r.rule as Rule, ctx.today) }));

  // Cap and weekend: only unsent DM chases are subject to them.
  const weekend = !isWorkingDay(ctx.weekday);
  const counts = { ...ctx.sentTodayByRecipient };
  const toSend = items.filter((i) => !i.already_sent && i.delivery === 'dm' && !i.held).sort((a, b) => b.working_days_stuck - a.working_days_stuck || a.brief_id.localeCompare(b.brief_id));
  for (const i of toSend) {
    if (weekend) { i.held = 'weekend'; continue; }
    const r = i.recipient_id!;
    if ((counts[r] ?? 0) >= DAILY_CAP_PER_PERSON) { i.held = 'daily_cap'; continue; }
    counts[r] = (counts[r] ?? 0) + 1;
  }
  const send = toSend.filter((i) => !i.held);
  return { items, send, held: items.filter((i) => i.held), resolve, weekend };
}

// ─── check-ins ─────────────────────────────────────────────────────────────

export type CheckinState = 'not_asked' | 'no_response' | 'answered';
export function checkinState(row: { asked_at: string | null; responded_at: string | null } | null | undefined): CheckinState {
  if (!row) return 'not_asked';
  if (row.responded_at) return 'answered';
  return row.asked_at ? 'no_response' : 'not_asked';
}

/** Numbered picks ("1 and 3") or a brief title in the reply → working_on; "blocked/waiting on …" → blocked_on. */
export function parseCheckinReply(reply: string, briefs: { id: string; title: string }[]) {
  const text = String(reply ?? '');
  const lower = text.toLowerCase();
  const picked = new Set<string>();
  for (const m of text.matchAll(/(?<![\d$.,])\b(\d{1,2})\b(?![\d.,%])/g)) { const n = Number(m[1]); if (n >= 1 && n <= briefs.length) picked.add(briefs[n - 1].id); }
  for (const b of briefs) if (b.title && b.title.length >= 4 && lower.includes(b.title.toLowerCase())) picked.add(b.id);
  const blocked = text.match(/\b(?:blocked|stuck|waiting (?:on|for))\b[:\s-]*(.{1,300})/i);
  return { working_on: [...picked], blocked_on: blocked ? blocked[0].trim() : null };
}

export interface CheckinInput { team_member_id: string; checkin_date: string; raw_reply: string; working_on?: string[] | null; blocked_on?: string | null; capacity_note?: string | null; source?: string }
/** One row per designer per day: a second reply the same day updates it. */
export function planCheckinWrite(existing: { id: string } | null, input: CheckinInput, nowIso: string) {
  const fields = {
    raw_reply: input.raw_reply, responded_at: nowIso,
    working_on: input.working_on ?? null, blocked_on: input.blocked_on ?? null, capacity_note: input.capacity_note ?? null,
  };
  return existing
    ? { op: 'update' as const, id: existing.id, row: fields }
    : { op: 'insert' as const, row: { team_member_id: input.team_member_id, checkin_date: input.checkin_date, source: input.source ?? 'slack_dm', ...fields } };
}

export function checkinPrompt(firstName: string, briefs: { title: string; client: string; due_date: string | null }[]) {
  if (!briefs.length) return `Morning ${firstName} — you have no active briefs in the hub. If you're working on something that isn't there, reply and tell me what.`;
  const lines = briefs.map((b, i) => `${i + 1}. *${b.title}* (${b.client}${b.due_date ? `, due ${b.due_date}` : ''})`);
  return `Morning ${firstName} — your active briefs:\n${lines.join('\n')}\n\nWhich are you on today? Reply with the numbers, and say if anything is blocking you.`;
}

export function followupText(i: FollowupItem, names: { designer?: string | null; hubUrl: string }) {
  const link = `<${names.hubUrl}/creative/briefs/${i.brief_id}|Open the brief>`;
  if (i.stage === 'designer') return `Quick check on *${i.title}* (${i.client}) — it's ${i.due_reason}. Where does it stand? ${link}`;
  if (i.rule === 'awaiting_review') return `*${i.title}* (${i.client}) is ${i.due_reason}. You're the reviewer — approve it or request changes. ${link}`;
  return `Heads-up: *${i.title}* (${i.client}) is ${i.due_reason}. ${names.designer ?? 'The designer'} was chased and it hasn't moved. ${link}`;
}

// ─── loader (shared by mcp-hub and the job) ────────────────────────────────

const maxBy = (pairs: [string | null | undefined, string][]) => pairs.filter((p) => p[0]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).at(-1) ?? null;

export async function loadFollowupBriefs(db: any): Promise<FollowupBrief[]> {
  const [{ data: rows }, { data: cl }] = await Promise.all([
    db.from('creative_briefs').select('id, client_id, title, status, due_date, assigned_to_id, submitted_at, accepted_at, updated_at, closed_out_at, deleted_at').is('deleted_at', null).in('status', FOLLOWUP_ACTIVE_STATUSES),
    db.from('clients').select('id, name'),
  ]);
  const briefs = (rows ?? []).filter((b: any) => !b.closed_out_at);
  const ids = briefs.map((b: any) => b.id);
  if (!ids.length) return [];
  const cName = new Map((cl ?? []).map((c: any) => [c.id, c.name]));
  const [{ data: hist }, { data: cm }, { data: dv }, { data: te }, { data: rv }, { data: ck }] = await Promise.all([
    db.from('creative_brief_status_history').select('brief_id, to_status, created_at').in('brief_id', ids),
    db.from('creative_brief_comments').select('brief_id, created_at').in('brief_id', ids),
    db.from('creative_deliverables').select('brief_id, uploaded_at').in('brief_id', ids),
    db.from('creative_time_entries').select('brief_id, started_at, deleted_at').in('brief_id', ids),
    db.from('creative_reviews').select('brief_id, action, created_at').in('brief_id', ids),
    db.from('designer_checkins').select('working_on, responded_at').not('responded_at', 'is', null).range(0, 4999),
  ]);
  return briefs.map((b: any) => {
    const h = (hist ?? []).filter((x: any) => x.brief_id === b.id);
    const entered = h.filter((x: any) => x.to_status === b.status).map((x: any) => x.created_at).sort().at(-1) ?? null;
    const statusSince = entered ?? (b.status === 'submitted' ? b.submitted_at : b.status === 'in_design' ? (b.accepted_at ?? b.submitted_at) : null) ?? b.updated_at;
    const act = maxBy([
      ...h.map((x: any) => [x.created_at, 'status_change'] as [string, string]),
      ...(cm ?? []).filter((x: any) => x.brief_id === b.id).map((x: any) => [x.created_at, 'comment'] as [string, string]),
      ...(dv ?? []).filter((x: any) => x.brief_id === b.id).map((x: any) => [x.uploaded_at, 'deliverable'] as [string, string]),
      ...(te ?? []).filter((x: any) => x.brief_id === b.id && !x.deleted_at).map((x: any) => [x.started_at, 'time_entry'] as [string, string]),
      ...(rv ?? []).filter((x: any) => x.brief_id === b.id).map((x: any) => [x.created_at, 'review'] as [string, string]),
      ...(ck ?? []).filter((x: any) => (x.working_on ?? []).includes(b.id)).map((x: any) => [x.responded_at, 'checkin'] as [string, string]),
      [b.accepted_at, 'accepted'], [b.submitted_at, 'submitted'],
    ]);
    const review = (rv ?? []).filter((x: any) => x.brief_id === b.id && x.created_at >= statusSince).sort((x: any, y: any) => String(y.created_at).localeCompare(x.created_at))[0];
    return {
      id: b.id, title: b.title, client: b.client_id ? String(cName.get(b.client_id) ?? 'Unknown') : 'Internal', status: b.status, due_date: b.due_date,
      assigned_to_id: b.assigned_to_id, accepted_at: b.accepted_at, status_since: statusSince,
      last_activity: act?.[0] ?? null, last_activity_kind: act?.[1] ?? null,
      review_since_status: review ? { action: review.action, at: review.created_at } : null,
      closed_out_at: b.closed_out_at, deleted_at: b.deleted_at,
    };
  });
}

export async function loadFollowupContext(db: any, now: Date) {
  const et = etParts(now);
  const [{ data: lead }, { data: existing }, briefs] = await Promise.all([
    db.from('team_members').select('id, name').eq('is_creative_lead', true).eq('is_active', true).eq('is_service_account', false).limit(1).maybeSingle(),
    db.from('creative_followups').select('id, brief_id, rule, stage, recipient_id, sent_at, resolved_at, created_at').range(0, 9999),
    loadFollowupBriefs(db),
  ]);
  const sentToday: Record<string, number> = {};
  for (const r of existing ?? []) if (r.sent_at && r.recipient_id && etParts(new Date(r.sent_at)).date === et.date) sentToday[r.recipient_id] = (sentToday[r.recipient_id] ?? 0) + 1;
  return { et, briefs, existing: (existing ?? []) as FollowupRow[], leadId: lead?.id ?? null, sentToday };
}

/** AJ Swamy — owner stage recipient and the weekly roll-up's reader. */
export const OWNER_TEAM_MEMBER_ID = '1fdd684e-6cb7-447e-b616-7e1b9c598971';
