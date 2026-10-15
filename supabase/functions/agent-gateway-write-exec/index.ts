// Runs one already-approved agent write request right after an approver's decision.
// Approval itself happens only in decide_agent_write_request (SQL). This function can only
// execute rows that are approved and unexpired, once. Must not import _shared/slack-post.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { opSdkFactory } from '../_shared/op-sdk.ts';
import { OnePasswordProvider } from '../_shared/agent-secrets.ts';
import { settingsFrom } from '../_shared/agent-write-actions.ts';
import { executeWrite } from '../_shared/agent-write-flow.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in required' });
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json(401, { error: 'sign in required' });
  const { data: isAdmin } = await userDb.rpc('is_admin', { check_user_id: u.user.id });
  if (isAdmin !== true) return json(403, { error: 'admins only' });
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.request_id === 'string' && UUID.test(body.request_id) ? body.request_id : null;
  if (!id) return json(400, { error: 'request_id required' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const { data: s } = await db.from('agent_gateway_settings').select('*').eq('id', 1).maybeSingle();
    const row = await executeWrite({ db, secrets: new OnePasswordProvider(Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), opSdkFactory), fetch, now: new Date(), settings: settingsFrom(s) }, id);
    if (!row) return json(404, { error: 'not found' });
    return json(200, { ok: true, status: row.status, failure_outcome: row.failure_outcome ?? null });
  } catch {
    console.error('agent-gateway-write-exec: internal error'); // no details
    return json(500, { ok: false, outcome: 'error_internal' });
  }
});
