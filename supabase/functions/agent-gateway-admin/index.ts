// Admin-only "Test connection" for the Agent Access Gateway.
// Reports whether the 1Password token is set, whether 1Password is reachable,
// and optionally whether one op:// reference resolves. Never returns a value.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { opSdkFactory } from '../agent-gateway/op-sdk.ts';
import { OnePasswordProvider } from '../agent-gateway/secrets.ts';

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
  try {
    const result = await new OnePasswordProvider(Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), opSdkFactory).check(ref);
    return json(200, { ok: true, ...result });
  } catch {
    console.error('agent-gateway-admin: check failed'); // no details
    return json(200, { ok: true, token_present: !!Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), reachable: false, reason: 'check_failed' });
  }
});
