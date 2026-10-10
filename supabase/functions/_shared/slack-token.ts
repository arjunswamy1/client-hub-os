// The single source of the Slack bot token for every function in this project.
//
// Slack rotates the bot token every 12 hours. The rotating token lives in the
// `slack_tokens` table together with the refresh token; the refresh call writes
// back Slack's new refresh token so the chain stays sound.
//
// There is deliberately NO fallback to the static SLACK_BOT_TOKEN env var.
// A silent fallback is how this project ended up with two token paths that
// drifted apart (the DB token expired on 2026-07-07 while a weekly report kept
// posting on 2026-08-22 with the static one). If the database token cannot be
// obtained we log loudly and throw.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { botPersona } from './bot-persona.ts';

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

export class SlackTokenError extends Error {}

async function refreshToken(rt: string, workspaceId: string): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('SLACK_CLIENT_ID') || '',
      client_secret: Deno.env.get('SLACK_CLIENT_SECRET') || '',
      grant_type: 'refresh_token',
      refresh_token: rt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error('SLACK TOKEN REFRESH FAILED:', data.error || `http ${res.status}`);
    throw new SlackTokenError(`Slack token refresh failed: ${data.error || `http ${res.status}`}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in || 43200) * 1000).toISOString();

  const { error } = await admin().from('slack_tokens').upsert({
    workspace_id: workspaceId,
    bot_access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });
  if (error) console.error('SLACK TOKEN REFRESH: write-back failed:', error.message);

  return { token: data.access_token as string, expiresAt };
}

/** One-time bootstrap: turn a static install token into a rotating pair. */
async function exchangeStaticToken(token: string): Promise<{ token: string; expiresAt: string }> {
  console.warn('SLACK TOKEN: no rotating token row found — bootstrapping via oauth.v2.exchange');
  const res = await fetch('https://slack.com/api/oauth.v2.exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('SLACK_CLIENT_ID') || '',
      client_secret: Deno.env.get('SLACK_CLIENT_SECRET') || '',
      token,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error('SLACK TOKEN: oauth.v2.exchange failed:', data.error || `http ${res.status}`);
    throw new SlackTokenError(`Slack token bootstrap failed: ${data.error || `http ${res.status}`}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in || 43200) * 1000).toISOString();
  await admin().from('slack_tokens').upsert({
    workspace_id: data.team?.id || 'default',
    bot_access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });
  return { token: data.access_token as string, expiresAt };
}

/**
 * The rotating bot token, refreshed when it is within 5 minutes of expiry.
 * Pass `force` to always take the refresh path (used by the scheduled refresher).
 */
export async function getValidBotToken(force = false): Promise<string> {
  if (botPersona() === 'grokbot') {
    const t = Deno.env.get('GROKBOT_BOT_TOKEN');
    if (!t) throw new SlackTokenError('GROKBOT_BOT_TOKEN is not configured');
    return t;
  }
  return (await getValidBotTokenDetailed(force)).token;
}

export async function getValidBotTokenDetailed(force = false): Promise<{ token: string; expiresAt: string; refreshed: boolean }> {
  const { data: row, error } = await admin()
    .from('slack_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('SLACK TOKEN: could not read slack_tokens:', error.message);
    throw new SlackTokenError(`Could not read slack_tokens: ${error.message}`);
  }

  if (row) {
    const stale = force || new Date(row.expires_at).getTime() - Date.now() <= 5 * 60 * 1000;
    if (!stale) return { token: row.bot_access_token, expiresAt: row.expires_at, refreshed: false };
    const out = await refreshToken(row.refresh_token, row.workspace_id);
    return { ...out, refreshed: true };
  }

  const staticToken = Deno.env.get('SLACK_BOT_TOKEN');
  if (staticToken) {
    const out = await exchangeStaticToken(staticToken);
    return { ...out, refreshed: true };
  }

  console.error('SLACK TOKEN: no rotating token row and no bootstrap token available — refusing to continue');
  throw new SlackTokenError('No Slack bot token available (slack_tokens is empty).');
}
