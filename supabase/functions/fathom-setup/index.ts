import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const FATHOM_API_KEY = Deno.env.get('FATHOM_API_KEY');
  if (!FATHOM_API_KEY) {
    return new Response(JSON.stringify({ error: 'FATHOM_API_KEY not set' }), { status: 500 });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const webhookUrl = `${SUPABASE_URL}/functions/v1/fathom-webhook`;

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'create';

  if (action === 'list') {
    const res = await fetch('https://api.fathom.ai/external/v1/webhooks', {
      headers: { 'X-Api-Key': FATHOM_API_KEY },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'create') {
    const res = await fetch('https://api.fathom.ai/external/v1/webhooks', {
      method: 'POST',
      headers: {
        'X-Api-Key': FATHOM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination_url: webhookUrl,
        include_transcript: true,
        include_summary: true,
        include_action_items: true,
        triggered_for: ['my_recordings', 'my_shared_with_team_recordings', 'shared_team_recordings'],
      }),
    });
    const data = await res.json();
    return new Response(JSON.stringify({ status: res.status, data }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
});
