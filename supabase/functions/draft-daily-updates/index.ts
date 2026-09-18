// Drafts one daily client update per account and posts it to that client's
// INTERNAL Slack channel for the account lead to edit and send on.
//
// It never posts to a client-facing channel: every post goes through
// `postToSlack()`, whose fail-closed allowlist refuses any channel that is
// external, unmapped or unclassified. The channel is additionally selected only
// from `slack_channel_mappings` rows with channel_purpose = 'client_internal'.
//
// Clients with no data in the last seven days get a prompt with the four-part
// skeleton rather than a fabricated narrative.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createOpenAI } from 'npm:@ai-sdk/openai';
import { streamText } from 'npm:ai';
import { postToSlack } from '../_shared/slack-post.ts';
import { collectClientMetrics, type ClientMetrics } from '../_shared/daily-update-metrics.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const HUB_BASE = 'https://hub.connectpaidmedia.com';

/** Current wall-clock hour and weekday in US Eastern, DST included. */
function easternNow(): { hour: number; weekday: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour),
    weekday: String(parts.weekday),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function easternYesterday(): string {
  const today = easternNow().date;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The measured facts, written out so the model never has to derive a number. */
function factSheet(m: ClientMetrics): string {
  const y = m.yesterday;
  const lines: string[] = [];
  lines.push(`Client: ${m.client_name}`);
  lines.push(`Reporting day: ${m.for_date} (7-day window from ${m.window_start})`);
  lines.push(`Spend sources present: ${m.spend_sources.join('; ') || 'none'}`);
  lines.push(`Call sources present: ${m.call_sources.join('; ') || 'none'}`);
  if (y) {
    lines.push(`Yesterday: spend ${money(y.spend)}, calls ${y.calls}, cost per call ${y.cost_per_call === null ? 'not computable (missing spend or calls)' : money(y.cost_per_call)}`);
    lines.push(`Yesterday duration mix: ${y.calls > 0
      ? `${y.band_pct.d10}% >=10s, ${y.band_pct.d25}% >=25s, ${y.band_pct.d90}% >=90s, ${y.band_pct.d600}% >=10min, ${y.band_pct.d1200}% >=20min`
      : 'no calls recorded'}`);
  }
  lines.push('7-day trend (date | spend | calls | cost per call | % >=90s):');
  for (const d of m.trend) {
    lines.push(`  ${d.date} | ${money(d.spend)} | ${d.calls} | ${d.cost_per_call === null ? 'n/a' : money(d.cost_per_call)} | ${d.calls > 0 ? `${d.band_pct.d90}%` : 'n/a'}`);
  }
  if (m.campaign_breakdown.length) {
    lines.push('Campaign spend yesterday:');
    for (const c of m.campaign_breakdown) {
      lines.push(`  ${c.campaign} | ${money(c.spend)} | ${c.calls === null ? 'calls not joined' : `${c.calls} calls`}`);
    }
  }
  if (m.anomalies.length) {
    lines.push('Anomalies:');
    for (const a of m.anomalies) lines.push(`  ${a.campaign}: ${a.detail}`);
  }
  if (m.media_brain) {
    lines.push(`Latest Media Brain review: ${m.media_brain.window_start} to ${m.media_brain.window_end}, status ${m.media_brain.status}, circuit breakers ${JSON.stringify(m.media_brain.breakers)}`);
  }
  if (m.gaps.length) lines.push(`Known data gaps (state these plainly, never estimate around them): ${m.gaps.join('; ')}`);
  return lines.join('\n');
}

function promptSkeleton(clientName: string, mention: string, m: ClientMetrics): string {
  const missing = m.gaps.length ? m.gaps.join('; ') : 'no spend or call data synced in the last 7 days';
  return [
    `${mention} — ${missing} for ${clientName}, so there's nothing to summarise for ${m.for_date}.`,
    '',
    'Write-up needed: what changed / what we\'re testing / what we\'re watching / what we want from them.',
  ].join('\n');
}

async function draftWithModel(facts: string, style: { guidance: string; example_text: string }): Promise<string> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY is not configured');

  const lovable = createOpenAI({
    baseURL: 'https://ai.gateway.lovable.dev/v1',
    apiKey: key,
    headers: { 'Lovable-API-Key': key, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' },
  });

  const system = [
    'You draft the daily client update for a paid-media agency. An account lead reads, edits and sends it on, so it must be honest and unembellished.',
    '',
    'HOUSE STYLE:',
    style.guidance,
    '',
    'GOLD STANDARD EXAMPLE (match this voice and shape, not its numbers):',
    style.example_text,
    '',
    'HARD RULES:',
    '- Use only the numbers in the fact sheet. Never invent, extrapolate or round into a different number.',
    '- If a number is marked not computable or a gap is listed, say plainly that we do not have it.',
    '- Flowing prose in short paragraphs. No bullet lists, no headings, no markdown emphasis.',
    '- Four parts in order: recap, one layer of stats, what we plan to do today or tomorrow, then questions for the client.',
    '- Part three must name a decision and its reason. Where an anomaly exists, that is what part three is about.',
    '- Part four asks for something only the client can see: their monetisation, close rates or buyer economics.',
    '- 200 to 320 words.',
  ].join('\n');

  const result = streamText({
    model: lovable.responses('openai/gpt-6-astra'),
    system,
    prompt: `Fact sheet:\n\n${facts}\n\nWrite the update.`,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: 'low',
        reasoningSummary: 'auto',
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    },
  });

  const text = (await result.text).trim();
  if (!text) throw new Error('model returned no draft text');
  return text;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase.from('cron_invocation_tokens').delete()
      .eq('token', nonce).gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token').maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const forDate = typeof body.for_date === 'string' ? body.for_date : easternYesterday();
    const onlyClients: string[] | null = Array.isArray(body.client_ids) ? body.client_ids as string[] : null;
    const onlyNames: string[] | null = Array.isArray(body.client_names) ? body.client_names as string[] : null;

    // The cron runs hourly and gates on the Eastern clock so the 9am slot holds
    // through daylight saving. A manual or dry run bypasses the gate.
    const et = easternNow();
    if (!force && !dryRun) {
      const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(et.weekday);
      if (!weekday || et.hour !== 9) {
        return json({ skipped: true, reason: `not 9am ET on a weekday (currently ${et.weekday} ${et.hour}:00 ET)` });
      }
    }

    const { data: style, error: styleErr } = await supabase.from('daily_update_style')
      .select('guidance, example_text').eq('key', 'house_daily_client_update').eq('is_active', true).maybeSingle();
    if (styleErr) throw styleErr;
    if (!style) throw new Error('no active house style row in daily_update_style');

    // Only clients that have an internal channel registered are in scope.
    const { data: mappings, error: mapErr } = await supabase.from('slack_channel_mappings')
      .select('client_id, channel_id, channel_name')
      .eq('channel_purpose', 'client_internal').not('client_id', 'is', null);
    if (mapErr) throw mapErr;

    const { data: clients } = await supabase.from('clients').select('id, name');
    const nameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

    // Fetched separately rather than as an embed: the embed silently yields no
    // member when the relationship cannot be resolved, and a draft that loses
    // its @-mention loses its owner.
    const { data: assignments, error: assignErr } = await supabase.from('client_assignments')
      .select('client_id, team_member_id').eq('role_on_account', 'media_buyer');
    if (assignErr) throw assignErr;
    const { data: members, error: memberErr } = await supabase.from('team_members')
      .select('id, name, slack_user_id');
    if (memberErr) throw memberErr;
    const memberById = new Map((members ?? []).map((m: any) => [m.id as string, m]));
    const leadByClient = new Map(
      (assignments ?? []).map((a: any) => {
        const member = memberById.get(a.team_member_id as string);
        return [a.client_id as string, {
          id: a.team_member_id as string,
          name: member?.name as string | undefined,
          slack: member?.slack_user_id as string | undefined,
        }];
      }),
    );

    let targets = (mappings ?? []).filter((m) => nameById.has(m.client_id as string));
    if (onlyClients) targets = targets.filter((m) => onlyClients.includes(m.client_id as string));
    if (onlyNames) {
      const wanted = onlyNames.map((n) => n.toLowerCase());
      targets = targets.filter((m) => wanted.includes((nameById.get(m.client_id as string) ?? '').toLowerCase()));
    }

    const results: Record<string, unknown>[] = [];

    for (const target of targets) {
      const clientId = target.client_id as string;
      const clientName = nameById.get(clientId) ?? 'Unknown client';
      try {
        const metrics = await collectClientMetrics(supabase, clientId, clientName, forDate);
        const lead = leadByClient.get(clientId);
        const mention = lead?.slack ? `<@${lead.slack}>` : lead?.name ? `@${lead.name}` : '@account lead';

        const kind = metrics.has_data ? 'draft' : 'prompt';
        const draftText = kind === 'draft'
          ? await draftWithModel(factSheet(metrics), style as { guidance: string; example_text: string })
          : promptSkeleton(clientName, mention, metrics);

        const { data: saved, error: saveErr } = await supabase.from('client_daily_updates')
          .upsert({
            client_id: clientId, for_date: forDate, kind, draft_text: draftText,
            status: 'draft', metrics: metrics as unknown as Record<string, unknown>,
            slack_channel_id: target.channel_id as string,
          }, { onConflict: 'client_id,for_date' })
          .select('id').single();
        if (saveErr) throw saveErr;

        let posted: unknown = { skipped: 'dry_run' };
        if (!dryRun) {
          const header = kind === 'draft'
            ? `${mention} — draft daily update for *${clientName}*, ${forDate}. Edit and send on.`
            : `${mention} — daily update needs writing for *${clientName}*, ${forDate}.`;
          const link = `${HUB_BASE}/tasks?daily_update=${saved.id}`;
          // Every Slack write in this project goes through postToSlack().
          const out = await postToSlack({
            channel: target.channel_id as string,
            text: `${header}\n\n${draftText}\n\n<${link}|[Edit in hub]>`,
          });
          posted = out;
          if (out.ok && out.ts) {
            await supabase.from('client_daily_updates').update({ slack_ts: out.ts }).eq('id', saved.id);
          }
        }

        results.push({
          client: clientName, client_id: clientId, kind, channel: target.channel_name,
          lead: lead?.name ?? null, draft_text: draftText,
          spend_sources: metrics.spend_sources, call_sources: metrics.call_sources,
          gaps: metrics.gaps, posted,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`draft-daily-updates FAILED for ${clientName}:`, message);
        results.push({ client: clientName, client_id: clientId, error: message });
      }
    }

    return json({
      success: true, for_date: forDate, dry_run: dryRun,
      drafts: results.filter((r) => r.kind === 'draft').length,
      prompts: results.filter((r) => r.kind === 'prompt').length,
      errors: results.filter((r) => r.error).length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('draft-daily-updates FAILED:', message);
    return json({ error: message }, 500);
  }
});
