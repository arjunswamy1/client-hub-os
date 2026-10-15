// Named Meta WRITE actions (pure). Every write needs an approver's decision; the
// gateway itself executes it. v1 excludes deletes, ad/creative creation, spend caps,
// lifetime budgets, bids and billing. Nothing here touches the database.
export type ObjectType = 'campaign' | 'adset' | 'ad';
export type WriteKind = 'status' | 'budget' | 'duplicate';
export interface WriteDef { objectType: ObjectType; kind: WriteKind; to?: 'PAUSED' | 'ACTIVE' }

export const META_HOST = 'graph.facebook.com';
export const META_PROVIDER = 'meta_ads';
const V = 'v21.0';

export const WRITE_ACTIONS: Record<string, WriteDef> = {
  'meta.campaign.pause': { objectType: 'campaign', kind: 'status', to: 'PAUSED' },
  'meta.campaign.activate': { objectType: 'campaign', kind: 'status', to: 'ACTIVE' },
  'meta.adset.pause': { objectType: 'adset', kind: 'status', to: 'PAUSED' },
  'meta.adset.activate': { objectType: 'adset', kind: 'status', to: 'ACTIVE' },
  'meta.ad.pause': { objectType: 'ad', kind: 'status', to: 'PAUSED' },
  'meta.ad.activate': { objectType: 'ad', kind: 'status', to: 'ACTIVE' },
  'meta.campaign.update_budget': { objectType: 'campaign', kind: 'budget' },
  'meta.adset.update_budget': { objectType: 'adset', kind: 'budget' },
  'meta.campaign.duplicate': { objectType: 'campaign', kind: 'duplicate' },
};

export interface WriteSettings {
  writes_enabled: boolean; approvers: string[]; max_pct: number; max_usd: number;
  per_day: number; pending_ttl_min: number; approval_ttl_min: number;
}
export function settingsFrom(row: any): WriteSettings {
  return {
    writes_enabled: row?.writes_enabled === true,
    approvers: Array.isArray(row?.write_approver_team_member_ids) ? row.write_approver_team_member_ids : [],
    max_pct: Number(row?.write_max_budget_change_pct ?? 50),
    max_usd: Number(row?.write_max_daily_budget_usd ?? 1000),
    per_day: Number(row?.write_requests_per_day ?? 20),
    pending_ttl_min: Number(row?.write_pending_ttl_minutes ?? 1440),
    approval_ttl_min: Number(row?.write_approval_ttl_minutes ?? 30),
  };
}

/** Mirror of decide_agent_write_request's authority rule (the SQL function enforces it). */
export function decisionAuthority(decider: string | null, approvers: string[], agentOwner: string | null): 'ok' | 'not_write_approver' | 'denied_self_approval' {
  if (!decider || !approvers.includes(decider)) return 'not_write_approver';
  if (agentOwner && agentOwner === decider) return 'denied_self_approval';
  return 'ok';
}

export const stripAct = (s: string) => String(s).replace(/^act_/, '');
const ACCOUNT_ID = /^(act_)?[0-9]{1,32}$/;
const OBJECT_ID = /^[0-9]{1,32}$/;

export type Input = { account_id: string; object_id: string; new_cents?: number };
export function parseWriteParams(def: WriteDef, params: unknown): { ok: true; input: Input } | { ok: false; outcome: string; detail?: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, outcome: 'denied_bad_params', detail: 'params object required' };
  const p = params as Record<string, unknown>;
  const allowed = def.kind === 'budget' ? ['account_id', 'object_id', 'new_daily_budget_usd'] : ['account_id', 'object_id'];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) return { ok: false, outcome: 'denied_bad_params', detail: `unknown param ${k.slice(0, 40)}` };
  if (typeof p.account_id !== 'string' || !ACCOUNT_ID.test(p.account_id)) return { ok: false, outcome: 'denied_bad_params', detail: 'invalid account_id' };
  if (typeof p.object_id !== 'string' || !OBJECT_ID.test(p.object_id)) return { ok: false, outcome: 'denied_bad_params', detail: 'invalid object_id' };
  const input: Input = { account_id: stripAct(p.account_id), object_id: p.object_id };
  if (def.kind === 'budget') {
    const raw = p.new_daily_budget_usd;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, outcome: 'denied_bad_params', detail: 'new_daily_budget_usd must be a positive dollar amount' };
    input.new_cents = Math.round(n * 100);
  }
  return { ok: true, input };
}

export function objectFields(t: ObjectType): string {
  if (t === 'campaign') return 'id,name,account_id,status,effective_status,daily_budget,lifetime_budget';
  if (t === 'adset') return 'id,name,account_id,status,effective_status,daily_budget,lifetime_budget,campaign{id,name,daily_budget,lifetime_budget}';
  return 'id,name,account_id,status,effective_status,adset_id,campaign_id';
}

export interface Snapshot {
  account_id: string; name: string | null; status: string | null;
  daily_budget: number | null; lifetime_budget: number | null; campaign_budget: number | null;
}
const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
export function snapshot(obj: any): Snapshot {
  const c = obj?.campaign;
  const cb = c ? (num(c.daily_budget) || 0) + (num(c.lifetime_budget) || 0) : null;
  return {
    account_id: stripAct(String(obj?.account_id ?? '')), name: obj?.name ?? null, status: obj?.status ?? null,
    daily_budget: num(obj?.daily_budget), lifetime_budget: num(obj?.lifetime_budget), campaign_budget: cb,
  };
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const LABEL: Record<ObjectType, string> = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' };

export type Plan = { ok: true; before: Record<string, unknown>; after: Record<string, unknown>; diff: string } | { ok: false; outcome: string; detail?: string };

/** Decide whether the change is allowed and describe it. */
export function planChange(def: WriteDef, objectId: string, snap: Snapshot, acct: { name?: string | null; currency?: string | null }, input: Input, s: WriteSettings): Plan {
  const head = `Account ${acct.name ?? '?'} (act_${snap.account_id}) · ${LABEL[def.objectType]} "${snap.name ?? '?'}" (${objectId})`;
  const before = { name: snap.name, status: snap.status, daily_budget: snap.daily_budget, account_id: snap.account_id };
  if (def.kind === 'status') {
    if (snap.status === def.to) return { ok: false, outcome: 'denied_no_change', detail: `already ${def.to}` };
    return { ok: true, before, after: { status: def.to }, diff: `${head}: status ${snap.status} → ${def.to}` };
  }
  if (def.kind === 'duplicate') {
    return { ok: true, before, after: { copy_status: 'PAUSED', deep_copy: true }, diff: `${head}: duplicate with all ad sets and ads, copy created PAUSED` };
  }
  if ((acct.currency ?? '').toUpperCase() !== 'USD') return { ok: false, outcome: 'denied_non_usd_account', detail: `account currency ${acct.currency ?? 'unknown'}` };
  if (def.objectType === 'adset' && (snap.campaign_budget ?? 0) > 0) return { ok: false, outcome: 'denied_cbo_campaign' };
  if (snap.lifetime_budget && snap.lifetime_budget > 0) return { ok: false, outcome: 'denied_budget_not_on_object', detail: 'lifetime budget' };
  if (!snap.daily_budget || snap.daily_budget <= 0) return { ok: false, outcome: 'denied_budget_not_on_object' };
  const cur = snap.daily_budget; const next = input.new_cents!;
  if (next === cur) return { ok: false, outcome: 'denied_no_change' };
  if (next > Math.round(s.max_usd * 100)) return { ok: false, outcome: 'denied_budget_over_cap', detail: `max ${usd(Math.round(s.max_usd * 100))}/day` };
  if (Math.abs(next - cur) * 100 > s.max_pct * cur) return { ok: false, outcome: 'denied_budget_change_too_large', detail: `max ±${s.max_pct}% per request` };
  return { ok: true, before, after: { daily_budget: next }, diff: `${head}: daily_budget ${usd(cur)} → ${usd(next)}` };
}

/** Fields that changed between the approved "before" and the live object. */
export function drift(before: Record<string, any>, now: Snapshot): string[] {
  const out: string[] = [];
  for (const k of ['name', 'status', 'daily_budget', 'account_id'] as const) if ((before?.[k] ?? null) !== (now[k] ?? null)) out.push(k);
  return out;
}

export function metaGet(path: string, fields: string, secret: string): URL {
  const u = new URL(`https://${META_HOST}/${V}/${path}`);
  u.searchParams.set('fields', fields); u.searchParams.set('access_token', secret);
  return u;
}

/** The single Meta POST for an approved request. Token goes in the body, never the URL. */
export function metaPost(def: WriteDef, objectId: string, after: Record<string, any>, secret: string): { url: string; body: URLSearchParams } {
  const body = new URLSearchParams();
  let path = objectId;
  if (def.kind === 'status') body.set('status', String(after.status));
  else if (def.kind === 'budget') body.set('daily_budget', String(after.daily_budget));
  else { path = `${objectId}/copies`; body.set('deep_copy', 'true'); body.set('status_option', 'PAUSED'); }
  body.set('access_token', secret);
  return { url: `https://${META_HOST}/${V}/${path}`, body };
}

export const permissionsUrl = (secret: string) => { const u = new URL(`https://${META_HOST}/${V}/me/permissions`); u.searchParams.set('access_token', secret); return u; };
/** true/false when Meta lists permissions; null when the answer is not readable. */
export function hasAdsManagement(json: any): boolean | null {
  if (!json || !Array.isArray(json.data)) return null;
  return json.data.some((p: any) => p?.permission === 'ads_management' && p?.status === 'granted');
}
export async function checkAdsManagement(doFetch: typeof fetch, secret: string): Promise<boolean | null> {
  try {
    const r = await doFetch(permissionsUrl(secret).toString(), { method: 'GET', redirect: 'error' });
    const j = await r.json().catch(() => null);
    return r.ok ? hasAdsManagement(j) : null;
  } catch { return null; }
}
