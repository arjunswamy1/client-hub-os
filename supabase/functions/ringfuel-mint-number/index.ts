import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RINGFUEL_API = 'https://app.ringfuel.io/api/visitors/visit';

// Per-client API key mapping. Extend as more publishers are added.
const CLIENT_API_KEYS: Record<string, string> = {
  calltofic: Deno.env.get('RINGFUEL_API_SECRET_CALLTOFIC') ?? '',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization' }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const {
      client_id,
      client_slug,
      campaign_label,
      ringfuel_campaign_id,
      creative_label,
      tags = {},
    } = body ?? {};

    if (!client_id || !client_slug || !ringfuel_campaign_id || !campaign_label) {
      return json({ error: 'client_id, client_slug, campaign_label, ringfuel_campaign_id required' }, 400);
    }

    const apiKey = CLIENT_API_KEYS[client_slug];
    if (!apiKey) return json({ error: `No RingFuel API key configured for ${client_slug}` }, 400);

    // Access check via has_client_access
    const { data: access } = await supabase.rpc('has_client_access', {
      check_user_id: userData.user.id,
      check_client_id: client_id,
    });
    const { data: admin } = await supabase.rpc('is_admin', { check_user_id: userData.user.id });
    if (!access && !admin) return json({ error: 'Forbidden' }, 403);

    // Mint the number
    const mintRes = await fetch(RINGFUEL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignId: ringfuel_campaign_id,
        tags: { creative: creative_label ?? 'unlabeled', ...tags },
      }),
    });

    const rawText = await mintRes.text();
    let raw: any;
    try { raw = JSON.parse(rawText); } catch { raw = { rawText }; }

    if (!mintRes.ok) {
      return json({ error: 'RingFuel API error', status: mintRes.status, raw }, 502);
    }

    const phoneNumber = raw?.phoneNumber;
    if (!phoneNumber) return json({ error: 'No phoneNumber returned', raw }, 502);

    // Look up team_member id for minted_by
    const { data: tm } = await supabase
      .from('team_members').select('id').eq('user_id', userData.user.id).maybeSingle();

    const admin_supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: inserted, error: insErr } = await admin_supabase
      .from('ringfuel_numbers')
      .insert({
        client_id,
        campaign_label,
        ringfuel_campaign_id,
        phone_number: phoneNumber,
        session_id: raw?.sessionId ?? null,
        visitor_id: raw?.visitorId ?? null,
        creative_label: creative_label ?? null,
        tags,
        minted_by_id: tm?.id ?? null,
        raw_response: raw,
      })
      .select()
      .single();

    if (insErr) {
      // Duplicate? Return existing row.
      if (insErr.code === '23505') {
        const { data: existing } = await admin_supabase
          .from('ringfuel_numbers').select('*')
          .eq('client_id', client_id).eq('phone_number', phoneNumber).maybeSingle();
        return json({ number: existing, deduped: true });
      }
      return json({ error: insErr.message }, 500);
    }

    return json({ number: inserted });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
