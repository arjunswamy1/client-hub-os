// Weekly AI optimizer digests delivered to each client's Slack channel.
// Invoked hourly by pg_cron; each schedule row fires once per ISO week on its
// chosen weekday/hour, is single-flighted with a database lease, and is
// idempotent per period key. Can also be called with a user JWT for a test send.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { AIBlockedError, generatePlan, planBlocks, postSlack, type OptimizerPlan } from '../_shared/optimizer-ai.ts';
import { buildJacuzziBriefs, buildRRMBriefs, lastNDays, type BriefInput } from '../_shared/report-payloads.ts';

const HUB_URL = 'https://hub.connectpaidmedia.com';
const BUYOLOGY_CLIENT_ID = 'b3d600f5-5d6b-4378-aa96-b395c05e9297';
const LEASE_MINUTES = 10;

const SCOPES: Record<string, { label: string; path: string }> = {
  buyology: { label: 'BuyologyIQ', path: '/buyology' },
  rrm: { label: 'RRM', path: '/rrm' },
  jacuzzi: { label: 'Jacuzzi', path: '/jacuzzi' },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** ISO week identifier — one digest per scope per week. */
function periodKeyFor(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Briefs for a scope. Buyology reuses its own optimizer (which snapshots history). */
async function briefsFor(
  scope: string,
  clientId: string,
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  periodKey: string,
  notes: string | null,
): Promise<Array<BriefInput & { plan: OptimizerPlan }>> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY')!;

  if (scope === 'buyology') {
    const w = lastNDays(7);
    const out: Array<BriefInput & { plan: OptimizerPlan }> = [];
    for (const line of ['tubs', 'bath'] as const) {
      const res = await fetch(`${supabaseUrl}/functions/v1/buyology-optimizer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ line, build: true, source: 'scheduled', periodKey, rangeLabel: w.label, notes: notes || undefined }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = text.slice(0, 300);
        try { message = JSON.parse(text)?.error || message; } catch { /* raw */ }
        if (res.status === 402 || res.status === 403 || res.status === 429) throw new AIBlockedError(res.status, message);
        if (res.status === 409) continue; // nothing to analyse for this line yet
        throw new Error(`buyology-optimizer [${res.status}]: ${message}`);
      }
      const data = await res.json();
      const t = data.totals || {};
      out.push({
        lineKey: line,
        lineLabel: data.lineLabel || (line === 'tubs' ? 'Walk-in Tubs' : 'Bathroom Remodel'),
        rangeLabel: w.label,
        totals: t,
        headlineMetrics: [
          `*Meta spend*\n$${Math.round(Number(t.meta_spend || 0)).toLocaleString()}`,
          `*Raw calls*\n${Number(t.raw_calls || 0)}`,
          `*Qualified (60s+)*\n${Number(t.qualified_calls_60s || 0)}`,
          `*Cost / qualified call*\n$${Number(t.cost_per_qualified_call || 0).toFixed(2)}`,
        ],
        prompt: '',
        plan: data.plan as OptimizerPlan,
      });
    }
    return out;
  }

  const inputs = scope === 'rrm'
    ? await buildRRMBriefs(supabase, 7)
    : await buildJacuzziBriefs(supabase, clientId, 7);

  const out: Array<BriefInput & { plan: OptimizerPlan }> = [];
  for (const input of inputs) {
    const prompt = notes ? `${input.prompt}\n\nStanding buyer notes: ${notes}` : input.prompt;
    const plan = await generatePlan(prompt, lovableKey);
    out.push({ ...input, plan });

    // Snapshot for week-over-week comparison in the app.
    try {
      await supabase.from('ai_optimizer_briefs').delete()
        .eq('client_id', clientId).eq('scope', scope)
        .eq('product_line', input.lineKey).eq('period_key', periodKey).eq('source', 'scheduled');
      await supabase.from('ai_optimizer_briefs').insert({
        client_id: clientId,
        scope,
        product_line: input.lineKey,
        line_label: input.lineLabel,
        range_label: input.rangeLabel,
        source: 'scheduled',
        plan,
        totals: input.totals,
        period_key: periodKey,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('weekly-slack-reports: brief snapshot failed', e);
    }
  }
  return out;
}

async function deliver(
  row: any,
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  slackToken: string,
  periodKey: string,
): Promise<{ scope: string; sent: number; error?: string }> {
  const scope = row.scope as string;
  const meta = SCOPES[scope];
  if (!meta) return { scope, sent: 0, error: `Unsupported scope ${scope}` };
  if (!row.slack_channel_id) return { scope, sent: 0, error: 'No Slack channel selected' };

  const briefs = await briefsFor(scope, row.client_id, supabase, supabaseUrl, serviceKey, periodKey, row.notes);
  if (!briefs.length) return { scope, sent: 0, error: 'No data to report on for this window' };

  for (const b of briefs) {
    await postSlack(
      slackToken,
      row.slack_channel_id,
      `${meta.label} — ${b.lineLabel} weekly optimization brief`,
      planBlocks({
        clientLabel: meta.label,
        lineLabel: b.lineLabel,
        rangeLabel: b.rangeLabel,
        headlineMetrics: b.headlineMetrics,
        plan: b.plan,
        dashboardUrl: `${HUB_URL}${meta.path}`,
      }),
    );
  }
  return { scope, sent: briefs.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const SLACK_TOKEN = Deno.env.get('SLACK_BOT_TOKEN');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!SLACK_TOKEN) return json({ error: 'SLACK_BOT_TOKEN is not configured' }, 400);

  const body = await req.json().catch(() => ({}));
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';

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

  // Manual "send now" from the app: any signed-in team member with client access.
  let manualUser: string | null = null;
  if (!authorized && bearer) {
    const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    if (auth?.user) {
      manualUser = auth.user.id;
      authorized = true;
    }
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();
  const periodKey = periodKeyFor(now);

  try {
    // --- Manual test send for one schedule row ---
    if (manualUser) {
      const { data: row, error } = await supabase
        .from('client_slack_reports')
        .select('*')
        .eq('client_id', body.client_id)
        .eq('scope', body.scope)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!row) return json({ error: 'No Slack report is configured for this client yet' }, 404);

      // RLS-scoped read proves the caller may act on this client.
      const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: allowed } = await asUser.from('client_slack_reports').select('id').eq('id', row.id).maybeSingle();
      if (!allowed) return json({ error: 'You do not have access to this client' }, 403);

      const result = await deliver(row, supabase, SUPABASE_URL, SERVICE_KEY, SLACK_TOKEN, `${periodKey}-test`);
      await supabase.from('client_slack_reports')
        .update({ last_sent_at: result.sent ? now.toISOString() : row.last_sent_at, last_error: result.error ?? null })
        .eq('id', row.id);
      return json({ success: !result.error, ...result });
    }

    // --- Scheduled sweep ---
    const { data: rows, error } = await supabase
      .from('client_slack_reports')
      .select('*')
      .eq('enabled', true)
      .eq('day_of_week', ((now.getUTCDay() + 6) % 7) + 1)
      .eq('run_hour_utc', now.getUTCHours())
      .neq('last_period_key', periodKey)
      .limit(10);
    if (error) return json({ error: error.message }, 500);

    const results: unknown[] = [];
    for (const row of rows || []) {
      const { data: leased } = await supabase
        .from('client_slack_reports')
        .update({ lease_until: new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString() })
        .eq('id', row.id)
        .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
        .select('id')
        .maybeSingle();
      if (!leased) { results.push({ scope: row.scope, skipped: 'lease held' }); continue; }

      try {
        const result = await deliver(row, supabase, SUPABASE_URL, SERVICE_KEY, SLACK_TOKEN, periodKey);
        await supabase.from('client_slack_reports').update({
          lease_until: null,
          last_sent_at: result.sent ? now.toISOString() : row.last_sent_at,
          last_period_key: result.sent ? periodKey : row.last_period_key,
          last_error: result.error ?? null,
        }).eq('id', row.id);
        results.push(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const blocked = e instanceof AIBlockedError;
        await supabase.from('client_slack_reports').update({
          lease_until: null,
          // AI blocked/rate limited is transient: leave the period unmarked so the next sweep retries.
          last_error: `${blocked ? `AI ${(e as AIBlockedError).status}: ` : ''}${message}`.slice(0, 500),
        }).eq('id', row.id);
        results.push({ scope: row.scope, sent: 0, error: message });
      }
    }

    return json({ success: true, period: periodKey, checked: (rows || []).length, results });
  } catch (e) {
    console.error('weekly-slack-reports error', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
