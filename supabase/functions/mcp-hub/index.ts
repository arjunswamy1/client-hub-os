// HTTP entry for the agent MCP server. All logic lives in hub.ts.
// This file must not import _shared/slack-post.ts (mcpHub.test.ts enforces it).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRpc } from './hub.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
};

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RESOURCE = `${URL_}/functions/v1/mcp-hub`;
const METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;
const ISSUER = `${URL_}/auth/v1`;

/**
 * A sign-in token from the hub's OAuth server. getUser() verifies signature and
 * expiry; the client_id claim proves it was issued to an OAuth client (Claude),
 * not lifted from a browser session.
 */
async function verifyOAuth(token: string): Promise<{ userId: string; clientId: string } | null> {
  let claims: any;
  try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  const clientId = typeof claims?.client_id === 'string' ? claims.client_id : null;
  if (!clientId || claims.iss !== ISSUER) return null;
  const db = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, clientId };
}

/** The daily drafter in dry-run + no-save mode: it returns text and never posts or saves. */
async function invokeDrafter(clientId: string, forDate: string): Promise<string | null> {
  const res = await fetch(`${URL_}/functions/v1/draft-daily-updates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dry_run: true, no_save: true, force: true, client_ids: [clientId], for_date: forDate }),
  });
  const body = await res.json().catch(() => null);
  const hit = (body?.results ?? []).find((r: any) => r.client_id === clientId && typeof r.draft_text === 'string');
  return hit?.hub_draft_text ?? hit?.draft_text ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return new Response(JSON.stringify({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Connect Paid Media Hub',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST JSON-RPC 2.0 only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json', Allow: 'POST' } });
  }
  const db = createClient(URL_, KEY, { auth: { persistSession: false } });
  const raw = await req.json().catch(() => null);
  const out = await handleRpc({ db, invokeDrafter, verifyOAuth }, req.headers.get('authorization'), raw);
  const authHdr = out.status === 401 ? { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA_URL}"` } : {};
  if (out.body === null) return new Response(null, { status: out.status, headers: CORS });
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { ...CORS, ...authHdr, 'Content-Type': 'application/json' } });
});
