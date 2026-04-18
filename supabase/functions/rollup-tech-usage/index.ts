// Aggregates tech_usage_events into tech_usage_daily.
// Re-aggregates the last 2 days every run to handle late-arriving events.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
    const cutoff = twoDaysAgo.toISOString();

    // Pull recent events
    const { data: events, error: fetchErr } = await supabase
      .from('tech_usage_events')
      .select('client_id, category, service, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, quantity, cost_usd, created_at')
      .gte('created_at', cutoff)
      .limit(50000);

    if (fetchErr) throw fetchErr;

    // Aggregate in-memory by (client_id, date, category, service)
    const buckets = new Map<string, {
      client_id: string | null;
      date: string;
      category: string;
      service: string;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_write_tokens: number;
      total_quantity: number;
      event_count: number;
      total_cost_usd: number;
    }>();

    for (const ev of events ?? []) {
      const date = (ev.created_at as string).slice(0, 10);
      const clientKey = ev.client_id ?? 'system';
      const key = `${clientKey}|${date}|${ev.category}|${ev.service}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          client_id: ev.client_id as string | null,
          date,
          category: ev.category as string,
          service: ev.service as string,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cache_read_tokens: 0,
          total_cache_write_tokens: 0,
          total_quantity: 0,
          event_count: 0,
          total_cost_usd: 0,
        };
        buckets.set(key, b);
      }
      b.total_input_tokens += Number(ev.input_tokens || 0);
      b.total_output_tokens += Number(ev.output_tokens || 0);
      b.total_cache_read_tokens += Number(ev.cache_read_tokens || 0);
      b.total_cache_write_tokens += Number(ev.cache_write_tokens || 0);
      b.total_quantity += Number(ev.quantity || 0);
      b.event_count += 1;
      b.total_cost_usd += Number(ev.cost_usd || 0);
    }

    const rows = Array.from(buckets.values()).map((b) => ({
      ...b,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: 'no recent events' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete then insert (upsert on COALESCE-based unique index is awkward)
    const dates = Array.from(new Set(rows.map((r) => r.date)));
    const { error: delErr } = await supabase
      .from('tech_usage_daily')
      .delete()
      .in('date', dates);
    if (delErr) throw delErr;

    const { error: insErr } = await supabase.from('tech_usage_daily').insert(rows);
    if (insErr) throw insErr;

    return new Response(JSON.stringify({
      ok: true,
      processed: events?.length ?? 0,
      buckets: rows.length,
      dates,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('rollup error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
