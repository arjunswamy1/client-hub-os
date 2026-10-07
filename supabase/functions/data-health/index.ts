// Data health for the /data-health page — the same checks the agent tool returns
// (_shared/data-health.ts). Signed-in admins see every enabled client; account
// managers see their assigned clients. Read-only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { CLIENT_REPORTING_COLUMNS } from '../_shared/client-resolve.ts';
import { clientHealth } from '../_shared/data-health.ts';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return json({ error: 'sign in required' }, 401);
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: 'sign in required' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: member } = await db.from('team_members').select('id, role, is_active').eq('user_id', auth.user.id).maybeSingle();
  if (!member || member.is_active === false || !['admin', 'account_manager'].includes(member.role)) return json({ error: 'admins and account managers only' }, 403);

  const body = await req.json().catch(() => ({}));
  let q = db.from('clients').select(CLIENT_REPORTING_COLUMNS).eq('status', 'active').eq('daily_update_enabled', true).order('name');
  if (typeof body.client_id === 'string') q = q.eq('id', body.client_id);
  const { data: clients, error } = await q;
  if (error) return json({ error: error.message }, 500);
  let allowed = clients ?? [];
  if (member.role !== 'admin') {
    const { data: a } = await db.from('client_assignments').select('client_id').eq('team_member_id', member.id);
    const ids = new Set((a ?? []).map((r: { client_id: string }) => r.client_id));
    allowed = allowed.filter((c: { id: string }) => ids.has(c.id));
  }
  const results = [];
  for (const c of allowed) {
    try { results.push(await clientHealth(db, c)); }
    catch (e) { results.push({ client_id: c.id, client: c.name, overall: 'fail', checks: [{ check: 'freshness', source: null, status: 'fail', explanation: `Health check failed to run: ${(e as Error).message}` }], days: [] }); }
  }
  return json({ generated_at: new Date().toISOString(), clients: results });
});
