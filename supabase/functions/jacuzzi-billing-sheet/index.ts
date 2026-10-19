// Read-only: returns the Jacuzzi client sheet's "Billing" tab (weekly invoices,
// amounts, due dates, paid status) for the hub's Cash flow view.
// Auth: signed-in user with access to the Jacuzzi client. Never writes the sheet.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { CLIENT_SHEET_ID, JACUZZI_CLIENT_ID } from '../_shared/jacuzzi-lead-sheet.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = bearer ? await db.auth.getUser(bearer) : { data: null };
    if (!auth?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: allowed } = await db.rpc('has_client_access', { check_user_id: auth.user.id, check_client_id: JACUZZI_CLIENT_ID });
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    const res = await fetch(
      `https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/${CLIENT_SHEET_ID}/values/'Billing'!A1:N40`,
      { headers: { Authorization: `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`, 'X-Connection-Api-Key': Deno.env.get('GOOGLE_SHEETS_API_KEY')! } },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error(`Billing sheet read failed [${res.status}]: ${text.slice(0, 400)}`);
      return json({ error: 'Could not read the billing sheet', status: res.status, details: text.slice(0, 400) }, 502);
    }
    const body = JSON.parse(text);
    return json({ values: body.values ?? [], read_at: new Date().toISOString() });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
