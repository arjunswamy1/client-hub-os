// HTTP entry for the Agent Access Gateway. Logic lives in gateway.ts.
// Must not import _shared/slack-post.ts. Never logs headers or bodies.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleGateway } from './gateway.ts';
import { OnePasswordProvider } from './secrets.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { ok: false, outcome: 'method_not_allowed' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const raw = await req.json().catch(() => null);
  try {
    const out = await handleGateway({ db, secrets: new OnePasswordProvider() }, req.headers.get('authorization'), raw);
    return json(out.status, out.body);
  } catch {
    console.error('agent-gateway: internal error'); // deliberately no details
    return json(500, { ok: false, outcome: 'error_internal' });
  }
});
