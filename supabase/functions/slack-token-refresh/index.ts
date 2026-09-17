// Forces the Slack rotating-token refresh on a schedule.
//
// The rotating bot token expires every 12 hours, and previously it was only
// refreshed when a human messaged the bot. Anything running on a schedule after
// a quiet night found a dead token. This runs every 6 hours via pg_cron using
// the project's existing `cron_invocation_tokens` nonce pattern.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getValidBotTokenDetailed } from '../_shared/slack-token.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';

  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase
      .from('cron_invocation_tokens')
      .delete()
      .eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token')
      .maybeSingle();
    authorized = !!tokenRow;
  }
  // Any signed-in user may trigger a manual refresh.
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const out = await getValidBotTokenDetailed(true);
    console.log('slack-token-refresh: ok, expires', out.expiresAt);
    await supabase.from('slack_token_refresh_log').insert({
      status: 'success',
      detail: out.refreshed ? 'token refreshed' : 'token still valid',
      expires_at: out.expiresAt,
    });
    return json({ success: true, expires_at: out.expiresAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('slack-token-refresh FAILED:', message);
    await supabase.from('slack_token_refresh_log').insert({ status: 'error', detail: message.slice(0, 500) });
    return json({ error: message }, 500);
  }
});
