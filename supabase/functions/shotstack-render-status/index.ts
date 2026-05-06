// Polls Shotstack for render status and stores final URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RAW_ENV = (Deno.env.get('SHOTSTACK_ENV') ?? 'v1').trim();
const STAGE_MATCH = RAW_ENV.match(/(stage|v1)/i);
const SHOTSTACK_ENV = (STAGE_MATCH ? STAGE_MATCH[1].toLowerCase() : 'v1');
const SHOTSTACK_HOST = `https://api.shotstack.io/edit/${SHOTSTACK_ENV}`;
const SHOTSTACK_API_KEY = (SHOTSTACK_ENV === 'stage'
  ? (Deno.env.get('SHOTSTACK_API_KEY_STAGE') ?? Deno.env.get('SHOTSTACK_API_KEY'))
  : Deno.env.get('SHOTSTACK_API_KEY')) ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { render_id } = await req.json();
    if (!render_id) throw new Error('render_id required');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: render, error } = await supabase
      .from('ai_video_renders').select('*').eq('id', render_id).single();
    if (error || !render) throw new Error(error?.message ?? 'Render not found');
    if (!render.shotstack_id) throw new Error('No shotstack_id on render');

    const resp = await fetch(`${SHOTSTACK_HOST}/render/${render.shotstack_id}`, {
      headers: { 'x-api-key': SHOTSTACK_API_KEY },
    });
    const body = await resp.json();
    if (!resp.ok || !body?.success) {
      throw new Error(body?.message ?? `Shotstack status ${resp.status}`);
    }

    const r = body.response;
    const status = r.status as string; // queued | fetching | rendering | saving | done | failed
    const update: Record<string, any> = { status };
    if (status === 'done') {
      update.output_url = r.url ?? null;
      update.poster_url = r.poster ?? null;
      update.completed_at = new Date().toISOString();
    } else if (status === 'failed') {
      update.error_message = r.error ?? 'Render failed';
    }

    await supabase.from('ai_video_renders').update(update).eq('id', render_id);

    // On completion, kick off caption-timing validation. Skip if this render
    // was itself spawned by a realign to avoid an infinite chain.
    if (status === 'done' && !render.parent_render_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/validate-render-captions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({ render_id }),
        });
      } catch (e) {
        console.warn('[shotstack-render-status] validator invoke failed:', (e as Error).message);
      }
    }

    return new Response(JSON.stringify({ status, output_url: update.output_url ?? null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
