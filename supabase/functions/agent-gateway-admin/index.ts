// Admin-only "Test connection" for the Agent Access Gateway.
// Reports whether the 1Password token is set, whether 1Password is reachable,
// and optionally whether one op:// reference resolves. Never returns a value.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { opSdkFactory } from '../_shared/op-sdk.ts';
import { OnePasswordProvider } from '../_shared/agent-secrets.ts';
import { checkAdsManagement } from '../_shared/agent-write-actions.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in required' });
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json(401, { error: 'sign in required' });
  const { data: isAdmin } = await userDb.rpc('is_admin', { check_user_id: u.user.id });
  if (isAdmin !== true) return json(403, { error: 'admins only' });

  const body = await req.json().catch(() => ({}));
  const ref = typeof body?.reference === 'string' && body.reference.trim() ? body.reference.trim() : undefined;
  // Does the Meta token in 1Password have ads_management? Answers yes/no only.
  if (body?.check_meta_write_permission === true) {
    const iid = typeof body?.integration_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.integration_id) ? body.integration_id : '55694453-95b2-4c49-829b-517a50952d7b';
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: integ } = await svc.from('integrations').select('provider, op_secret_ref').eq('id', iid).maybeSingle();
    if (!integ || integ.provider !== 'meta_ads' || !integ.op_secret_ref) return json(200, { ok: true, ads_management: null, reason: 'no_meta_secret' });
    const sec = await new OnePasswordProvider(Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), opSdkFactory).resolve(integ.op_secret_ref);
    if (!sec.ok) return json(200, { ok: true, ads_management: null, reason: `secret_${sec.reason}` });
    const has = await checkAdsManagement(fetch, sec.value);
    return json(200, { ok: true, ads_management: has, reason: has === null ? 'permissions_unreadable' : null });
  }
  // Optional: list vault and item TITLES only (never field values).
  if (body?.list_titles === true) {
    const token = Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN');
    if (!token) return json(200, { ok: true, token_present: false, reason: 'not_configured' });
    try {
      const c: any = await opSdkFactory(token);
      const collect = async (r: any) => { const a: any[] = []; if (Array.isArray(r)) return r; if (r?.[Symbol.asyncIterator]) { for await (const x of r) a.push(x); return a; } return r?.elements ?? []; };
      const vaults = await collect(c.vaults.list ? await c.vaults.list() : await c.vaults.listAll());
      const out = [];
      for (const v of vaults) {
        let titles: string[] = [];
        try { titles = (await collect(await c.items.list(v.id))).map((i: any) => String(i.title)); } catch { titles = []; }
        out.push({ vault: String(v.title), items: titles.sort() });
      }
      return json(200, { ok: true, vaults: out });
    } catch {
      return json(200, { ok: true, token_present: true, reachable: false, reason: 'list_failed' });
    }
  }
  try {
    const result = await new OnePasswordProvider(Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), opSdkFactory).check(ref);
    return json(200, { ok: true, ...result });
  } catch {
    console.error('agent-gateway-admin: check failed'); // no details
    return json(200, { ok: true, token_present: !!Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), reachable: false, reason: 'check_failed' });
  }
});
