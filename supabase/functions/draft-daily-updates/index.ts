// Drafts one daily client update per account and posts it to that client's
// INTERNAL Slack channel for the account lead to edit and send on.
//
// It never posts to a client-facing channel: every post goes through
// `postToSlack()`, whose fail-closed allowlist refuses any channel that is
// external, unmapped or unclassified. The channel is additionally selected only
// from `slack_channel_mappings` rows with channel_purpose = 'client_internal'.
//
// Two blocks are produced per client and stored separately: client-facing prose
// with no tooling talk in it, and internal notes for the lead carrying the data
// gaps, the source systems and the campaigns sitting at zero.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createOpenAI } from 'npm:@ai-sdk/openai';
import { streamText } from 'npm:ai';
import { postToSlack } from '../_shared/slack-post.ts';
import { collectClientMetrics, type ClientMetrics, type DayRow } from '../_shared/daily-update-metrics.ts';

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
const pretty = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/**
 * The week's direction for the headline metric. Day-over-day is noise; the
 * useful sentence is whether cost per call is drifting while call quality holds.
 *
 * Returns null when the reporting day itself has no spend — a cost-per-call
 * trend that ends days before the report describes a stale feed, not the market.
 */
function weeklyDirection(trend: DayRow[], forDate: string): { series: string; direction: string } | null {
  const priced = trend.filter((d) => d.cost_per_call !== null);
  if (priced.length < 3) return null;
  if (priced[priced.length - 1].date !== forDate) return null;
  const first = priced[0].cost_per_call!;
  const last = priced[priced.length - 1].cost_per_call!;
  const pct = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;

  const qualityDays = priced.filter((d) => d.calls > 0).map((d) => Number(d.band_pct.d90 ?? 0));
  const spread = qualityDays.length >= 2 ? Math.max(...qualityDays) - Math.min(...qualityDays) : null;

  const move = Math.abs(pct) < 5 ? 'held roughly flat' : pct > 0 ? `rose ${pct}%` : `fell ${Math.abs(pct)}%`;
  let quality = '';
  if (spread !== null) {
    quality = spread <= 10
      ? ` over the same week the share of calls past 90 seconds stayed within ${Math.round(spread * 10) / 10} points, so call quality did not move`
      : ` over the same week the share of calls past 90 seconds moved ${Math.round(spread * 10) / 10} points, so quality moved too`;
  }

  return {
    series: priced.map((d) => `${d.date} ${money(d.cost_per_call!)}`).join(' → '),
    direction: `Across the 7-day window cost per call ${move} (${money(first)} → ${money(last)}).${quality}.`,
  };
}

/** True when calls arrived on the reporting day but no spend has landed for it. */
const spendMissingForDay = (m: ClientMetrics) =>
  !!m.yesterday && m.yesterday.calls > 0 && m.yesterday.spend <= 0;

/** The measured facts, written out so the model never has to derive a number. */
function factSheet(m: ClientMetrics): string {
  const y = m.yesterday;
  const noSpend = spendMissingForDay(m);
  const lines: string[] = [];
  lines.push(`Client: ${m.client_name}`);
  lines.push(`Reporting day: ${m.for_date} (7-day window from ${m.window_start})`);
  if (y) {
    if (noSpend) {
      lines.push(`Yesterday: ${y.calls} inbound calls. Spend and cost per call for this day are NOT available — do not mention spend, cost per call or budget efficiency anywhere in the update, and never write "$0". Build the update from call volume, the duration mix and campaign activity.`);
    } else {
      lines.push(`Yesterday: spend ${money(y.spend)}, ${y.calls} inbound calls, cost per call ${y.cost_per_call === null ? 'not available' : money(y.cost_per_call)}`);
    }
    if (y.calls > 0) {
      lines.push(`Yesterday duration mix: ${y.band_pct.d10}% past 10 seconds, ${y.band_pct.d25}% past 25 seconds, ${y.band_pct.d90}% past 90 seconds, ${y.band_pct.d600}% past 10 minutes, ${y.band_pct.d1200}% past 20 minutes`);
    }
    if (y.calls > 0 && y.calls < 10) {
      lines.push(`NOTE: only ${y.calls} calls yesterday — too few to read a day-over-day change as a real shift. Say so in the prose; this is a caveat the client needs in order to read the number.`);
    }
  }
  const dir = noSpend ? null : weeklyDirection(m.trend, m.for_date);
  if (dir) {
    lines.push(`Cost per call by day: ${dir.series}`);
    lines.push(`WEEKLY DIRECTION (lead with this, not with yesterday vs the day before): ${dir.direction}`);
  } else {
    const callSeries = m.trend.map((d) => `${d.date} ${d.calls} calls`).join(' → ');
    lines.push(`Call volume by day (use the direction of this series instead of a cost-per-call trend): ${callSeries}`);
  }
  lines.push('7-day series (date | spend | calls | cost per call | % past 90s):');
  for (const d of m.trend) {
    lines.push(`  ${d.date} | ${money(d.spend)} | ${d.calls} | ${d.cost_per_call === null ? 'not available' : money(d.cost_per_call)} | ${d.calls > 0 ? `${d.band_pct.d90}%` : 'not available'}`);
  }
  if (m.campaign_breakdown.length) {
    lines.push('Campaign spend yesterday:');
    for (const c of m.campaign_breakdown) lines.push(`  ${c.campaign} | ${money(c.spend)}`);
  }
  if (m.anomalies.length) {
    lines.push('Campaigns that spent earlier in the week but nothing yesterday (part three is about these):');
    for (const a of m.anomalies) lines.push(`  ${a.campaign}: ${a.detail}`);
  }
  if (m.media_brain) {
    lines.push(`Latest Media Brain review: ${m.media_brain.window_start} to ${m.media_brain.window_end}, status ${m.media_brain.status}, circuit breakers ${JSON.stringify(m.media_brain.breakers)}`);
  }
  lines.push('Numbers not listed above do not exist. Leave them out entirely rather than mentioning that they are missing.');
  return lines.join('\n');
}

/**
 * Internal notes. Everything the lead needs and the client should not read:
 * which systems the numbers came from, what we could not compute, what is dark.
 */
function buildAmNotes(m: ClientMetrics): string {
  const notes: string[] = [];
  if (m.spend_sources.length) notes.push(`Spend read from: ${m.spend_sources.join('; ')}`);
  if (m.call_sources.length) notes.push(`Calls read from: ${m.call_sources.join('; ')}`);
  for (const gap of m.gaps) notes.push(gap.charAt(0).toUpperCase() + gap.slice(1));

  const noCpc = m.trend.filter((d) => d.cost_per_call === null).map((d) => pretty(d.date));
  if (noCpc.length && noCpc.length < m.trend.length) {
    notes.push(`No cost per call for ${noCpc.join(', ')} — spend or calls missing on those days`);
  }
  const noQuality = m.trend.filter((d) => d.calls === 0).map((d) => pretty(d.date));
  if (noQuality.length && noQuality.length < m.trend.length) {
    notes.push(`No duration mix for ${noQuality.join(', ')} — no calls recorded`);
  }
  if (m.anomalies.length) {
    notes.push(`${m.anomalies.length} campaign${m.anomalies.length === 1 ? '' : 's'} at $0 yesterday: ${m.anomalies.map((a) => a.campaign).join(', ')}`);
  }
  if (!m.campaign_breakdown.length && m.spend_sources.length) {
    notes.push('No campaign-level spend breakdown available for this account');
  }
  return notes.map((n) => `• ${n}`).join('\n');
}

function promptSkeleton(clientName: string, m: ClientMetrics): string {
  const missing = m.gaps.length ? m.gaps.join('; ') : 'no spend or call data synced in the last 7 days';
  return [
    `${missing} for ${clientName}, so there's nothing to summarise for ${m.for_date}.`,
    '',
    "Write-up needed: what changed / what we're testing / what we're watching / what we want from them.",
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
    'You draft the daily client update for a paid-media agency. An account lead reads, edits and sends it to the client, so it must be honest and unembellished.',
    '',
    'HOUSE STYLE:',
    style.guidance,
    '',
    'GOLD STANDARD EXAMPLE (match this voice and shape, not its numbers):',
    style.example_text,
    '',
    'HARD RULES:',
    '- Use only the numbers in the fact sheet. Never invent, extrapolate or round into a different number.',
    '- Flowing prose in short paragraphs. No bullet lists, no headings, no markdown emphasis.',
    '- Four parts in order: recap, one layer of stats, what we plan to do today or tomorrow, then questions for the client.',
    '- Lead the recap or the stats layer with the WEEKLY DIRECTION line. Comparing yesterday to the day before alone is noise.',
    '- Part three must name a decision and its reason. Where campaigns sat at $0 yesterday, that is what part three is about.',
    '- Part four asks for something only the client can see: their monetisation, close rates or buyer economics.',
    '- 200 to 320 words.',
    '',
    'VOICE:',
    '- State the observation and move on. Do not qualify it in the same breath.',
    '  Write: "So we\'re continuing to generate a meaningful percentage of longer-duration calls."',
    '  Not:   "That gives us a meaningful share of longer calls, though duration alone doesn\'t tell us how well they monetise."',
    '- Let the questions in part four carry the uncertainty, not the statements in parts one to three.',
    '',
    'NEVER WRITE:',
    '- Any name of a system we read data from. The client does not care which platform we pull from.',
    '  Write "105 inbound calls", never "105 calls in CallGrid" or "calls in Moja".',
    '- Any admission about our own data or tooling: nothing about attribution not being joined, metrics not being available, days we cannot compute, or numbers we do not have. Those go in a separate internal note. Simply write the update using what you do have.',
    '- The only caveat permitted is one the client needs in order to read a number, e.g. that a day with very few calls is too thin to draw a conclusion from.',
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

/** Cheap presence check so a client without a Slack channel is still covered. */
async function hasRecentActivity(db: SupabaseClient, clientId: string, windowStart: string, endIso: string) {
  const dated: [string, string][] = [['roku_daily_metrics', 'date'], ['ad_daily_metrics', 'date']];
  for (const [table, col] of dated) {
    const { count } = await db.from(table).select('client_id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte(col, windowStart);
    if ((count ?? 0) > 0) return true;
  }
  const calls: [string, string][] = [
    ['ringba_calls', 'call_date'], ['cannaball_calls', 'call_start'],
    ['moja_calls', 'call_start'], ['ringfuel_calls', 'call_start'],
  ];
  for (const [table, col] of calls) {
    const { count } = await db.from(table).select('client_id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte(col, `${windowStart}T00:00:00Z`).lt(col, endIso);
    if ((count ?? 0) > 0) return true;
  }
  return false;
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

    const { data: mappings, error: mapErr } = await supabase.from('slack_channel_mappings')
      .select('client_id, channel_id, channel_name')
      .eq('channel_purpose', 'client_internal').not('client_id', 'is', null);
    if (mapErr) throw mapErr;
    const channelByClient = new Map(
      (mappings ?? []).map((m: any) => [m.client_id as string, { id: m.channel_id as string, name: m.channel_name as string }]),
    );

    const { data: clients, error: clientErr } = await supabase.from('clients').select('id, name');
    if (clientErr) throw clientErr;

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

    const windowStartDate = new Date(`${forDate}T00:00:00Z`);
    windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 6);
    const windowStart = windowStartDate.toISOString().slice(0, 10);
    const endDate = new Date(`${forDate}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endIso = endDate.toISOString();

    // Scope: any client with an internal channel, plus any client with data in
    // the window even if no channel is registered yet — an account with the best
    // data in the agency must never be silently skipped.
    let candidates = (clients ?? []) as { id: string; name: string }[];
    if (onlyClients) candidates = candidates.filter((c) => onlyClients.includes(c.id));
    if (onlyNames) {
      const wanted = onlyNames.map((n) => n.toLowerCase());
      candidates = candidates.filter((c) => wanted.includes(c.name.toLowerCase()));
    }

    const targets: { id: string; name: string; reason: string }[] = [];
    for (const c of candidates) {
      if (channelByClient.has(c.id)) targets.push({ ...c, reason: 'internal channel registered' });
      else if (await hasRecentActivity(supabase, c.id, windowStart, endIso)) {
        targets.push({ ...c, reason: 'has data in window, no internal channel registered' });
      }
    }

    const results: Record<string, unknown>[] = [];
    const skipped: Record<string, unknown>[] = [];

    for (const target of targets) {
      const { id: clientId, name: clientName } = target;
      try {
        const lead = leadByClient.get(clientId);
        const channel = channelByClient.get(clientId);
        const metrics = await collectClientMetrics(supabase, clientId, clientName, forDate);

        // Never @-mention nobody: an unowned account is reported, not posted.
        const blockers: string[] = [];
        if (!lead?.slack && !lead?.name) blockers.push('no media_buyer assigned — account needs an owner');
        if (!channel) blockers.push('no internal Slack channel registered for this client');

        const kind = metrics.has_data ? 'draft' : 'prompt';
        const draftText = kind === 'draft'
          ? await draftWithModel(factSheet(metrics), style as { guidance: string; example_text: string })
          : promptSkeleton(clientName, metrics);
        const amNotes = buildAmNotes(metrics);

        const { data: saved, error: saveErr } = await supabase.from('client_daily_updates')
          .upsert({
            client_id: clientId, for_date: forDate, kind, draft_text: draftText,
            am_notes: amNotes || null, status: 'draft',
            metrics: metrics as unknown as Record<string, unknown>,
            slack_channel_id: channel?.id ?? null,
          }, { onConflict: 'client_id,for_date' })
          .select('id').single();
        if (saveErr) throw saveErr;

        let posted: unknown;
        if (blockers.length) {
          posted = { skipped: blockers.join('; ') };
        } else if (dryRun) {
          posted = { skipped: 'dry_run' };
        } else {
          const mention = lead!.slack ? `<@${lead!.slack}>` : `@${lead!.name}`;
          const link = `${HUB_BASE}/tasks?daily_update=${saved.id}`;
          const header = kind === 'draft'
            ? `${mention} — *${clientName}*, ${forDate}`
            : `${mention} — *${clientName}*, ${forDate}: daily update needs writing`;
          const text = [
            header,
            '',
            '📋 *Draft — edit and send*',
            draftText,
            '',
            '🔒 *Notes for you (not for the client)*',
            amNotes || '• Nothing to flag',
            '',
            `<${link}|[Edit in hub]>`,
          ].join('\n');
          // Every Slack write in this project goes through postToSlack().
          const out = await postToSlack({ channel: channel!.id, text });
          posted = out;
          if (out.ok && out.ts) {
            await supabase.from('client_daily_updates').update({ slack_ts: out.ts }).eq('id', saved.id);
          }
        }

        results.push({
          client: clientName, client_id: clientId, kind,
          channel: channel?.name ?? null, lead: lead?.name ?? null,
          blockers, draft_text: draftText, am_notes: amNotes,
          spend_sources: metrics.spend_sources, call_sources: metrics.call_sources, posted,
        });
        if (blockers.length) skipped.push({ client: clientName, blockers });
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
      not_posted: skipped,
      errors: results.filter((r) => r.error).length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('draft-daily-updates FAILED:', message);
    return json({ error: message }, 500);
  }
});
