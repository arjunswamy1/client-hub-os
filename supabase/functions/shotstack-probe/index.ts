// Probe Shotstack credentials & host URL.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const RAW_ENV = (Deno.env.get('SHOTSTACK_ENV') ?? 'v1').trim();
  const STAGE_MATCH = RAW_ENV.match(/(stage|v1)/i);
  const SHOTSTACK_ENV = STAGE_MATCH ? STAGE_MATCH[1].toLowerCase() : 'v1';
  const SHOTSTACK_HOST = `https://api.shotstack.io/edit/${SHOTSTACK_ENV}`;
  const mode: 'stage' | 'v1' = SHOTSTACK_ENV === 'stage' ? 'stage' : 'v1';

  const PROD_KEY = Deno.env.get('SHOTSTACK_API_KEY') ?? '';
  const STAGE_KEY = Deno.env.get('SHOTSTACK_API_KEY_STAGE') ?? '';
  const SHOTSTACK_API_KEY = mode === 'stage' ? (STAGE_KEY || PROD_KEY) : PROD_KEY;
  const key_source = mode === 'stage'
    ? (STAGE_KEY ? 'SHOTSTACK_API_KEY_STAGE' : 'SHOTSTACK_API_KEY (fallback)')
    : 'SHOTSTACK_API_KEY';

  const results: Record<string, any> = {
    raw_env: RAW_ENV,
    normalized_env: SHOTSTACK_ENV,
    mode,
    is_sandbox: mode === 'stage',
    host: SHOTSTACK_HOST,
    render_url: `${SHOTSTACK_HOST}/render`,
    key_source,
    api_key_present: Boolean(SHOTSTACK_API_KEY),
    api_key_length: SHOTSTACK_API_KEY.length,
    prod_key_present: Boolean(PROD_KEY),
    stage_key_present: Boolean(STAGE_KEY),
  };

  try {
    const url = `${SHOTSTACK_HOST}/render?limit=1`;
    const resp = await fetch(url, { headers: { 'x-api-key': SHOTSTACK_API_KEY } });
    const text = await resp.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch {}
    results.probe_url = url;
    results.probe_status = resp.status;
    results.probe_ok = resp.ok;
    results.probe_body = body;
  } catch (e) {
    results.probe_error = (e as Error).message;
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
