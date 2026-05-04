const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
Deno.serve(async () => {
  const env = (Deno.env.get('SHOTSTACK_ENV') ?? 'v1').trim();
  const key = Deno.env.get('SHOTSTACK_API_KEY') ?? '';
  const host = `https://api.shotstack.io/edit/${env}`;
  const r = await fetch(`${host}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: '{}' });
  const text = await r.text();
  return new Response(JSON.stringify({ env, host, status: r.status, keyLen: key.length, body: text.slice(0, 500) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
