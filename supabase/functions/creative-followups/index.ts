// Creative workflow job: morning check-ins, the follow-up sweep and AJ's weekly roll-up.
//
// Modes (each cron fires at both possible UTC hours; this function runs only
// when the America/New_York clock matches the slot, so DST holds):
//   checkin  weekdays 9:30 ET   — one DM per designer listing their active briefs
//   sweep    weekdays 11:00 and 15:30 ET — chases per the ladder in _shared/creative-followups.ts
//   rollup   Mondays 8:30 ET    — one DM to AJ: in vs out, moved, stuck, escalated, check-in response rates
//
// DMs go only through postDirectMessage() (internal team members only).
// Nothing client-facing. dry_run returns what would be sent and writes nothing.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postDirectMessage } from '../_shared/slack-post.ts';
import { hubUrl } from '../_shared/brief-messages.ts';
import {
  checkinPrompt, etParts, evaluateFollowups, FOLLOWUP_ACTIVE_STATUSES, followupText, isWorkingDay,
  loadFollowupContext, OWNER_TEAM_MEMBER_ID, workingDaysBetween, etDateOf,
} from '../_shared/creative-followups.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Mode = 'checkin' | 'sweep' | 'rollup';
const SLOTS: Record<Mode, { h: number; m: number }[]> = { checkin: [{ h: 9, m: 30 }], sweep: [{ h: 11, m: 0 }, { h: 15, m: 30 }], rollup: [{ h: 8, m: 30 }] };

async function authorise(db: any, req: Request) {
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (bearer && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true;
  const nonce = req.headers.get('x-cron-nonce') || '';
  if (/^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data } = await db.from('cron_invocation_tokens').delete().eq('token', nonce).gt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).select('token').maybeSingle();
    if (data) return true;
  }
  if (bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data } = await asUser.auth.getUser();
    if (data?.user) {
      const { data: m } = await db.from('team_members').select('role').eq('user_id', data.user.id).maybeSingle();
      return m?.role === 'admin';
    }
  }
  return false;
}

async function designers(db: any) {
  const { data } = await db.from('team_members').select('id, name, slack_user_id').eq('role', 'designer').eq('is_active', true).eq('is_service_account', false);
  return data ?? [];
}

async function runCheckin(db: any, now: Date, dryRun: boolean) {
  const et = etParts(now);
  const { data: briefs } = await db.from('creative_briefs').select('id, title, client_id, due_date, assigned_to_id, closed_out_at').is('deleted_at', null).in('status', FOLLOWUP_ACTIVE_STATUSES);
  const { data: cl } = await db.from('clients').select('id, name');
  const cName = new Map((cl ?? []).map((c: any) => [c.id, c.name]));
  const out: any[] = [];
  for (const d of await designers(db)) {
    const mine = (briefs ?? []).filter((b: any) => b.assigned_to_id === d.id && !b.closed_out_at).sort((a: any, b: any) => String(a.due_date ?? '9').localeCompare(String(b.due_date ?? '9')));
    const text = checkinPrompt(String(d.name).split(' ')[0], mine.map((b: any) => ({ title: b.title, client: String(cName.get(b.client_id) ?? 'Internal'), due_date: b.due_date })));
    const { data: existing } = await db.from('designer_checkins').select('id, asked_at').eq('team_member_id', d.id).eq('checkin_date', et.date).maybeSingle();
    if (existing?.asked_at) { out.push({ designer: d.name, skipped: 'already_asked_today' }); continue; }
    if (!d.slack_user_id) { out.push({ designer: d.name, skipped: 'no_slack_user_id' }); continue; }
    if (dryRun) { out.push({ designer: d.name, briefs: mine.length, text }); continue; }
    const r = await postDirectMessage({ kind: 'send', userId: d.slack_user_id, text });
    if (!r.ok) { out.push({ designer: d.name, error: r.reason ?? r.error }); continue; }
    const row = { team_member_id: d.id, checkin_date: et.date, asked_at: now.toISOString(), brief_ids: mine.map((b: any) => b.id), asked_slack_ts: r.ts ?? null, asked_channel: r.channel ?? null, source: 'slack_dm' };
    const { error } = existing ? await db.from('designer_checkins').update(row).eq('id', existing.id) : await db.from('designer_checkins').insert(row);
    out.push({ designer: d.name, sent: true, briefs: mine.length, ...(error ? { error: `sent but not recorded: ${error.message}` } : {}) });
  }
  return out;
}

async function runSweep(db: any, now: Date, dryRun: boolean) {
  const ctx = await loadFollowupContext(db, now);
  const r = evaluateFollowups(ctx.briefs, ctx.existing, { today: ctx.et.date, weekday: ctx.et.weekday, leadId: ctx.leadId, ownerId: OWNER_TEAM_MEMBER_ID, sentTodayByRecipient: ctx.sentToday });
  const { data: tm } = await db.from('team_members').select('id, name, slack_user_id, is_service_account');
  const mem = new Map((tm ?? []).map((m: any) => [m.id, m]));
  const nm = (id: string | null) => (id ? (mem.get(id) as any)?.name ?? 'Unknown' : null);
  const briefById = new Map(ctx.briefs.map((b) => [b.id, b]));
  const sent: any[] = [];
  if (!dryRun) {
    for (const x of r.resolve) if (x.id) await db.from('creative_followups').update({ resolved_at: now.toISOString(), resolution: x.resolution }).eq('id', x.id).is('resolved_at', null);
    // owner stage: recorded (once) for the roll-up, never pinged.
    for (const i of r.items.filter((i) => i.delivery === 'weekly_rollup' && !ctx.existing.some((e) => e.brief_id === i.brief_id && e.rule === i.rule && e.stage === 'owner'))) {
      await db.from('creative_followups').insert({ brief_id: i.brief_id, rule: i.rule, stage: 'owner', recipient_id: i.recipient_id, due_reason: i.due_reason });
    }
  }
  for (const i of r.send) {
    const m: any = mem.get(i.recipient_id!);
    const text = followupText(i, { designer: nm(briefById.get(i.brief_id)?.assigned_to_id ?? null), hubUrl: hubUrl() });
    const view = { brief_id: i.brief_id, title: i.title, client: i.client, rule: i.rule, stage: i.stage, recipient: m?.name ?? null, reason: i.due_reason, text };
    if (dryRun) { sent.push(view); continue; }
    if (!m?.slack_user_id || m.is_service_account) { sent.push({ ...view, error: 'recipient has no Slack user' }); continue; }
    // Claim the (brief, rule, stage) row first: the unique constraint makes the chase fire once.
    const prior = ctx.existing.find((e) => e.brief_id === i.brief_id && e.rule === i.rule && e.stage === i.stage);
    let rowId = prior?.id;
    if (!prior) {
      const { data: ins, error } = await db.from('creative_followups').insert({ brief_id: i.brief_id, rule: i.rule, stage: i.stage, recipient_id: i.recipient_id, due_reason: i.due_reason }).select('id').maybeSingle();
      if (error || !ins) { sent.push({ ...view, skipped: 'already_claimed' }); continue; }
      rowId = ins.id;
    }
    const res = await postDirectMessage({ kind: 'send', userId: m.slack_user_id, text });
    if (res.ok) await db.from('creative_followups').update({ sent_at: new Date().toISOString(), slack_ts: res.ts ?? null }).eq('id', rowId);
    sent.push({ ...view, sent: res.ok, ...(res.ok ? {} : { error: res.reason ?? res.error }) });
  }
  return {
    today_et: ctx.et.date, weekday: ctx.et.weekday, weekend: r.weekend, briefs_in_scope: ctx.briefs.length,
    would_send: sent, held: r.held.map((i) => ({ brief_id: i.brief_id, title: i.title, rule: i.rule, stage: i.stage, recipient: nm(i.recipient_id), held: i.held, reason: i.due_reason })),
    owner_stage_for_rollup: r.items.filter((i) => i.delivery === 'weekly_rollup').map((i) => ({ title: i.title, rule: i.rule, reason: i.due_reason })),
    already_sent: r.items.filter((i) => i.already_sent).map((i) => ({ title: i.title, rule: i.rule, stage: i.stage, sent_at: i.sent_at })),
    resolve: r.resolve,
  };
}

async function runRollup(db: any, now: Date, dryRun: boolean) {
  const et = etParts(now);
  const end = new Date(`${et.date}T12:00:00Z`); const start = new Date(end.getTime() - 7 * 86400000);
  const from = start.toISOString().slice(0, 10), to = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
  const inWeek = (x: string | null) => !!x && etDateOf(x) >= from && etDateOf(x) <= to;
  const [{ data: b }, { data: h }, { data: fu }, { data: ck }, ds, { data: tm }] = await Promise.all([
    db.from('creative_briefs').select('id, title, status, submitted_at, accepted_at, approved_at, delivered_at, closed_out_at').is('deleted_at', null).range(0, 4999),
    db.from('creative_brief_status_history').select('brief_id, from_status, to_status, created_at').gte('created_at', `${from}T00:00:00Z`),
    db.from('creative_followups').select('brief_id, rule, stage, recipient_id, due_reason, created_at, sent_at, resolved_at, resolution').gte('created_at', `${from}T00:00:00Z`),
    db.from('designer_checkins').select('team_member_id, asked_at, responded_at').gte('checkin_date', from).lte('checkin_date', to),
    designers(db),
    db.from('team_members').select('id, name'),
  ]);
  const name = new Map((tm ?? []).map((m: any) => [m.id, m.name]));
  const title = new Map((b ?? []).map((x: any) => [x.id, x.title]));
  const ctx = await loadFollowupContext(db, now);
  const submitted = (b ?? []).filter((x: any) => inWeek(x.submitted_at)).length;
  const out = (b ?? []).filter((x: any) => inWeek(x.delivered_at) || inWeek(x.approved_at)).length;
  const stuck = ctx.briefs.map((x) => ({ title: x.title, status: x.status, wd: x.status_since ? workingDaysBetween(etDateOf(x.status_since), et.date) : null })).sort((a, z) => (z.wd ?? 0) - (a.wd ?? 0));
  const esc = (fu ?? []).filter((f: any) => f.stage !== 'designer');
  const rates = ds.map((d: any) => { const mine = (ck ?? []).filter((c: any) => c.team_member_id === d.id && c.asked_at); const ans = mine.filter((c: any) => c.responded_at).length; return `${d.name} ${ans}/${mine.length}`; });
  const lines = [
    `*Creative roll-up — week of ${from} to ${to}*`,
    `Briefs in: ${submitted} · out (approved or delivered): ${out}`,
    `Moved: ${(h ?? []).length} status change${(h ?? []).length === 1 ? '' : 's'}${(h ?? []).length ? ` — ${(h ?? []).slice(0, 8).map((x: any) => `${title.get(x.brief_id) ?? '?'} ${x.from_status ?? '—'}→${x.to_status}`).join('; ')}` : ''}`,
    `Stuck (${stuck.length} active):`, ...stuck.slice(0, 11).map((s) => `• ${s.title} — ${s.status.replace(/_/g, ' ')}${s.wd !== null ? ` for ${s.wd} working days` : ''}`),
    `Escalated: ${esc.length ? esc.map((f: any) => `${title.get(f.brief_id) ?? '?'} (${f.rule}, ${f.stage === 'owner' ? 'to you' : `to ${name.get(f.recipient_id) ?? '?'}`})${f.resolved_at ? ` — resolved: ${f.resolution}` : ''}`).join('; ') : 'none'}`,
    `Check-in replies: ${rates.length ? rates.join(' · ') : 'no designers'}`,
  ];
  const text = lines.join('\n');
  if (dryRun) return { text };
  const { data: aj } = await db.from('team_members').select('slack_user_id').eq('id', OWNER_TEAM_MEMBER_ID).maybeSingle();
  const r = aj?.slack_user_id ? await postDirectMessage({ kind: 'send', userId: aj.slack_user_id, text }) : { ok: false, reason: 'no_slack_user_id' };
  return { text, sent: r.ok, ...(r.ok ? {} : { error: (r as any).reason ?? (r as any).error }) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!(await authorise(db, req))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => ({} as any));
    const mode = body.mode as Mode;
    if (!SLOTS[mode]) return json({ error: 'mode must be checkin, sweep or rollup' }, 400);
    const dryRun = body.dry_run === true;
    const now = typeof body.as_of === 'string' && !Number.isNaN(Date.parse(body.as_of)) && dryRun ? new Date(body.as_of) : new Date();
    const et = etParts(now);
    if (body.force !== true) {
      const inSlot = SLOTS[mode].some((s) => s.h === et.hour && Math.abs(et.minute - s.m) <= 10);
      const dayOk = mode === 'rollup' ? et.weekday === 'Mon' : isWorkingDay(et.weekday);
      if (!inSlot || !dayOk) return json({ ok: true, skipped: 'outside_et_slot', et });
    }
    if (!isWorkingDay(et.weekday) && mode !== 'sweep' && !dryRun) return json({ ok: true, skipped: 'weekend', et });
    const result = mode === 'checkin' ? await runCheckin(db, now, dryRun) : mode === 'sweep' ? await runSweep(db, now, dryRun) : await runRollup(db, now, dryRun);
    return json({ ok: true, mode, dry_run: dryRun, et, result });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
