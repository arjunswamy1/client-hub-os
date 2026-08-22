// Scheduled runner for the BuyologyIQ AI optimizer.
// Invoked hourly by pg_cron. Each run is bounded, single-flighted with a database
// lease, idempotent per period, and circuit-breaks on 402/403 (paused until an
// owner resumes or a single probe succeeds) and on repeated 429s (parked until
// the next scheduled run).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SCOPE = 'buyology';
const MAX_SCHEDULES_PER_RUN = 5;
const MAX_LINES_PER_RUN = 2;
const LEASE_MINUTES = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Stable period identifier — one scheduled brief per line per period. */
function periodKeyFor(cadence: string, now: Date): string {
  const iso = now.toISOString().slice(0, 10);
  if (cadence === 'daily') return iso;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextRunAt(cadence: string, hourUtc: number, now: Date): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hourUtc);
  next.setUTCDate(next.getUTCDate() + (cadence === 'daily' ? 1 : 7));
  return next.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Only the scheduler may run the job: pg_cron mints a one-time token row per
  // invocation and passes it here, where it is validated and consumed.
  const nonce = req.headers.get('x-cron-nonce') || '';
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  let authorized = bearer !== '' && bearer === SERVICE_KEY;
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
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();


  const { data: schedules, error } = await supabase
    .from('ai_optimizer_schedules')
    .select('*')
    .eq('scope', SCOPE)
    .eq('enabled', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .limit(MAX_SCHEDULES_PER_RUN);
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];

  for (const s of schedules || []) {
    // Single-flight: only the run that wins the lease proceeds.
    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
    const { data: leased } = await supabase
      .from('ai_optimizer_schedules')
      .update({ lease_until: leaseUntil })
      .eq('id', s.id)
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select('id')
      .maybeSingle();
    if (!leased) {
      results.push({ client_id: s.client_id, skipped: 'another run holds the lease' });
      continue;
    }

    const probeMode = s.status === 'paused';
    const cadence = s.cadence === 'daily' ? 'daily' : 'weekly';
    const periodKey = periodKeyFor(cadence, now);
    let lines: string[] = (s.product_lines || []).filter((l: string) => ['tubs', 'bath'].includes(l));
    lines = lines.slice(0, probeMode ? 1 : MAX_LINES_PER_RUN);

    // Idempotent progress: skip lines already briefed for this period.
    const { data: existing } = await supabase
      .from('ai_optimizer_briefs')
      .select('product_line')
      .eq('client_id', s.client_id).eq('scope', SCOPE)
      .eq('period_key', periodKey).eq('source', 'scheduled');
    const done = new Set((existing || []).map((r: any) => r.product_line));
    const todo = lines.filter((l) => !done.has(l));

    const ran: string[] = [];
    let blocked: { status: number; message: string } | null = null;
    let rateLimited = false;
    let lastError: string | null = null;

    for (const line of todo) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/buyology-optimizer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          line,
          build: true,
          source: 'scheduled',
          periodKey,
          rangeLabel: 'lifetime to date',
          notes: s.notes || undefined,
        }),
      });

      if (res.ok) { ran.push(line); continue; }

      const bodyText = await res.text().catch(() => '');
      let message = bodyText.slice(0, 400);
      try { message = JSON.parse(bodyText)?.error || message; } catch { /* raw text */ }

      if (res.status === 402 || res.status === 403) {
        blocked = { status: res.status, message };
        break; // circuit breaker: stop the whole job
      }
      if (res.status === 429) { rateLimited = true; lastError = message; break; }
      lastError = `[${res.status}] ${message}`;
      // 409 = nothing to analyse yet; keep going to the next line.
    }

    const patch: Record<string, unknown> = {
      lease_until: null,
      last_run_at: now.toISOString(),
      next_run_at: nextRunAt(cadence, s.run_hour_utc ?? 12, now),
      last_error: blocked?.message || lastError,
    };

    if (blocked) {
      // Pause until the owner resumes or a later probe run succeeds.
      patch.status = 'paused';
      patch.pause_reason = `AI ${blocked.status}: ${blocked.message}`.slice(0, 500);
      patch.paused_at = now.toISOString();
    } else if (rateLimited) {
      // Transient — stay active, the next scheduled run retries.
      patch.last_error = `Rate limited: ${lastError}`;
    } else if (probeMode && ran.length) {
      patch.status = 'active';
      patch.pause_reason = null;
      patch.paused_at = null;
      patch.last_error = null;
    } else if (!lastError) {
      patch.last_error = null;
    }

    await supabase.from('ai_optimizer_schedules').update(patch).eq('id', s.id);

    results.push({
      client_id: s.client_id, cadence, period: periodKey,
      generated: ran, skipped_already_done: [...done],
      probe: probeMode, paused: !!blocked, rate_limited: rateLimited, error: lastError,
    });
  }

  return json({ success: true, checked: (schedules || []).length, results });
});
