import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropic, truncate, ANTHROPIC_DEFAULT_MODEL } from "../_shared/anthropic.ts";
import { logAiUsage } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id, question, conversation_history } = await req.json();

    if (!client_id || !question) {
      return new Response(JSON.stringify({ error: 'client_id and question required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];

    // Gather all context in parallel — aggregated dashboard tables + trimmed context feed
    const [
      { data: clientInfo },
      { data: contextItems },
      { data: campaigns },
      { data: dailyMetrics },
      { data: ringbaCalls },
      { data: tasks },
      { data: actionItems },
      { data: creatives },
      { data: adSets },
      { data: keywords },
      { data: searchTerms },
      { data: recommendations },
      { data: agendas },
      { data: dashConfig },
      { data: verticals },
    ] = await Promise.all([
      supabase.from('clients').select('name, slug').eq('id', client_id).single(),
      // CONTEXT FEED — Slack/Fathom/email trimmed to 30 days, 100 items
      supabase.from('context_items')
        .select('title, content, content_type, source, occurred_at, metadata, participants')
        .eq('client_id', client_id)
        .gte('occurred_at', thirtyDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(100),
      // CAMPAIGNS — 14d window, fetched daily so we can aggregate by name AND build trend
      supabase.from('ad_campaigns')
        .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status, daily_budget, bidding_strategy_type, account_id, campaign_type, impression_share, date')
        .eq('client_id', client_id)
        .gte('date', fourteenDaysAgo)
        .lte('date', todayStr)
        .limit(2000),
      // DAILY METRICS — 14-day single source of truth for trends
      supabase.from('ad_daily_metrics')
        .select('date, platform, spend, revenue, impressions, clicks, conversions, cost_per_conversion')
        .eq('client_id', client_id)
        .gte('date', fourteenDaysAgo)
        .order('date', { ascending: false })
        .limit(200),
      // RINGBA — 14-day window
      supabase.from('ringba_calls')
        .select('campaign_name, revenue, payout, converted, connected, duration_seconds, target_name, call_date')
        .eq('client_id', client_id)
        .gte('call_date', fourteenDaysAgo)
        .limit(1500),
      supabase.from('tasks')
        .select('title, status, priority, due_date')
        .eq('client_id', client_id)
        .in('status', ['todo', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('call_action_items')
        .select('description, completed, due_date')
        .eq('completed', false)
        .limit(25),
      // CREATIVES — 30 day window, top 40 by spend
      supabase.from('ad_creatives')
        .select('campaign_name, ad_name, platform, spend, revenue, conversions, ctr, cpa, roas, headline, status, creative_type, format, frequency, video_views_3s, video_views_50, video_views_95')
        .eq('client_id', client_id)
        .gte('date_from', thirtyDaysAgo)
        .order('spend', { ascending: false })
        .limit(40),
      // AD SETS — top 50 by spend
      supabase.from('ad_sets')
        .select('adset_name, campaign_name, platform, spend, revenue, conversions, clicks, impressions, ctr, cpc, cpa, status')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .order('spend', { ascending: false })
        .limit(50),
      // GOOGLE KEYWORDS — top 40 by spend
      supabase.from('campaign_keywords')
        .select('keyword, ad_group, campaign_name, match_type, platform, spend, clicks, conversions, revenue, ctr, cpc, cpa, quality_score, impression_share, is_negative')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .order('spend', { ascending: false })
        .limit(40),
      // SEARCH TERMS — top 30 by spend
      supabase.from('search_terms')
        .select('search_term, keyword_text, match_type, campaign_name, spend, clicks, conversions, revenue, ctr, cpa')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .order('spend', { ascending: false })
        .limit(30),
      supabase.from('ai_optimization_recommendations')
        .select('title, description, severity, platform, recommendation_type')
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .limit(15),
      supabase.from('call_agendas')
        .select('title, call_date, status, call_type')
        .eq('client_id', client_id)
        .order('call_date', { ascending: false })
        .limit(5),
      supabase.from('dashboard_configs')
        .select('revenue_source, enabled_kpis, enabled_platforms')
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase.from('client_verticals')
        .select('label, vertical_id, emoji, google_patterns, meta_patterns, ringba_patterns')
        .eq('client_id', client_id)
        .order('position'),
    ]);

    // Aggregate campaign metrics by platform AND by campaign-name (collapses ~1000 daily rows → ~120 rows)
    const platformAgg: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    const campaignAgg: Record<string, {
      campaign_name: string; platform: string; status: string; daily_budget: number | null; bidding_strategy_type: string | null;
      spend: number; revenue: number; conversions: number; clicks: number; impressions: number; impr_share_sum: number; impr_share_n: number;
    }> = {};
    for (const c of campaigns || []) {
      const p = c.platform || 'unknown';
      if (!platformAgg[p]) platformAgg[p] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      platformAgg[p].spend += Number(c.spend);
      platformAgg[p].revenue += Number(c.revenue);
      platformAgg[p].conversions += Number(c.conversions);
      platformAgg[p].clicks += Number(c.clicks);
      platformAgg[p].impressions += Number(c.impressions);

      const key = `${c.campaign_name}|${p}`;
      if (!campaignAgg[key]) {
        campaignAgg[key] = {
          campaign_name: c.campaign_name, platform: p, status: c.status || 'unknown',
          daily_budget: c.daily_budget ?? null, bidding_strategy_type: c.bidding_strategy_type || null,
          spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, impr_share_sum: 0, impr_share_n: 0,
        };
      }
      const ca = campaignAgg[key];
      ca.spend += Number(c.spend);
      ca.revenue += Number(c.revenue);
      ca.conversions += Number(c.conversions);
      ca.clicks += Number(c.clicks);
      ca.impressions += Number(c.impressions);
      if (c.impression_share != null) {
        ca.impr_share_sum += Number(c.impression_share);
        ca.impr_share_n++;
      }
    }
    const aggregatedCampaigns = Object.values(campaignAgg).sort((a, b) => b.spend - a.spend);

    // Aggregate ringba — total, per-campaign, AND per-day
    const ringbaAgg = { totalCalls: 0, converted: 0, totalRevenue: 0, totalPayout: 0 };
    const ringbaByCampaign: Record<string, { calls: number; converted: number; revenue: number; payout: number; avgDuration: number; totalDuration: number }> = {};
    const ringbaByDay: Record<string, { calls: number; converted: number; revenue: number; payout: number }> = {};
    for (const call of ringbaCalls || []) {
      ringbaAgg.totalCalls++;
      if (call.converted) ringbaAgg.converted++;
      ringbaAgg.totalRevenue += Number(call.revenue || 0);
      ringbaAgg.totalPayout += Number(call.payout || 0);

      const cName = call.campaign_name || 'Unknown';
      if (!ringbaByCampaign[cName]) ringbaByCampaign[cName] = { calls: 0, converted: 0, revenue: 0, payout: 0, avgDuration: 0, totalDuration: 0 };
      ringbaByCampaign[cName].calls++;
      if (call.converted) ringbaByCampaign[cName].converted++;
      ringbaByCampaign[cName].revenue += Number(call.revenue || 0);
      ringbaByCampaign[cName].payout += Number(call.payout || 0);
      ringbaByCampaign[cName].totalDuration += Number(call.duration_seconds || 0);

      const day = (call.call_date || '').toString().split('T')[0];
      if (day) {
        if (!ringbaByDay[day]) ringbaByDay[day] = { calls: 0, converted: 0, revenue: 0, payout: 0 };
        ringbaByDay[day].calls++;
        if (call.converted) ringbaByDay[day].converted++;
        ringbaByDay[day].revenue += Number(call.revenue || 0);
        ringbaByDay[day].payout += Number(call.payout || 0);
      }
    }
    for (const key of Object.keys(ringbaByCampaign)) {
      const c = ringbaByCampaign[key];
      c.avgDuration = c.calls > 0 ? Math.round(c.totalDuration / c.calls) : 0;
    }

    // Aggregate ad-platform daily totals (14-day window, single source of truth)
    const dailyByDate: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    for (const m of dailyMetrics || []) {
      const d = (m.date || '').toString().split('T')[0];
      if (!d) continue;
      if (!dailyByDate[d]) dailyByDate[d] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      dailyByDate[d].spend += Number(m.spend || 0);
      dailyByDate[d].revenue += Number(m.revenue || 0);
      dailyByDate[d].conversions += Number(m.conversions || 0);
      dailyByDate[d].clicks += Number(m.clicks || 0);
      dailyByDate[d].impressions += Number(m.impressions || 0);
    }

    // Build a complete 14-day series, zero-filled, combining ad spend/revenue + Ringba calls
    const dailySeries: Array<{ date: string; calls: number; converted: number; callRevenue: number; payout: number; spend: number; adRevenue: number; conversions: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      const r = ringbaByDay[d] || { calls: 0, converted: 0, revenue: 0, payout: 0 };
      const a = dailyByDate[d] || { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      dailySeries.push({
        date: d, calls: r.calls, converted: r.converted, callRevenue: r.revenue, payout: r.payout,
        spend: a.spend, adRevenue: a.revenue, conversions: a.conversions,
      });
    }

    // Categorize context items
    const fathomMeetings = (contextItems || []).filter((c: any) => c.source === 'fathom');
    const slackItems = (contextItems || []).filter((c: any) => c.source === 'slack');
    const emailItems = (contextItems || []).filter((c: any) => c.source === 'email' || c.source === 'gmail');
    const otherContext = (contextItems || []).filter((c: any) => !['fathom', 'slack', 'email', 'gmail'].includes(c.source));

    // Build the data payload — aggregated tables + trimmed feed
    const dataContext = `
=== CLIENT: ${clientInfo?.name || 'Unknown'} ===
Data window: ad performance & ringba ${fourteenDaysAgo} to ${todayStr} | creatives ${thirtyDaysAgo} to ${todayStr} | context feed last 30 days
Revenue source: ${dashConfig?.revenue_source || 'manual'} | Enabled platforms: ${(dashConfig?.enabled_platforms || []).join(', ') || 'all'}

=== CLIENT VERTICALS ===
${(verticals || []).map((v: any) => `${v.emoji} ${v.label} (${v.vertical_id}) — google: [${(v.google_patterns || []).join(', ')}], meta: [${(v.meta_patterns || []).join(', ')}], ringba: [${(v.ringba_patterns || []).join(', ')}]`).join('\n') || 'No verticals configured'}

=== AD PLATFORM TOTALS (Last 14 Days, aggregated) ===
${Object.entries(platformAgg).map(([p, m]) => `${p}: $${m.spend.toFixed(2)} spend, $${m.revenue.toFixed(2)} rev, ${m.conversions} conv, ${m.clicks} clicks, ${m.impressions} impr`).join('\n') || 'No data'}

=== DAILY TIME-SERIES (Last 14 Days, zero-filled — SINGLE SOURCE OF TRUTH for any trend chart) ===
${dailySeries.map(d => `${d.date}: ${d.calls} calls, ${d.converted} converted, $${d.callRevenue.toFixed(2)} call rev, $${d.spend.toFixed(2)} spend, $${d.adRevenue.toFixed(2)} ad rev, ${d.conversions} ad conv`).join('\n')}

=== RINGBA TOTALS (Last 14 Days) ===
Total calls: ${ringbaAgg.totalCalls}, Converted: ${ringbaAgg.converted}, Revenue: $${ringbaAgg.totalRevenue.toFixed(2)}, Payout: $${ringbaAgg.totalPayout.toFixed(2)}

Per-Campaign Ringba Breakdown (top 30 by revenue):
${Object.entries(ringbaByCampaign).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 30).map(([name, d]) => `  ${name}: ${d.calls} calls, ${d.converted} converted, $${d.revenue.toFixed(2)} revenue, $${d.payout.toFixed(2)} payout, avg ${d.avgDuration}s`).join('\n') || 'None'}

=== CAMPAIGNS (Last 14 Days, aggregated by campaign — top 60 by spend) ===
${aggregatedCampaigns.slice(0, 60).map((c) => `${c.campaign_name} | ${c.platform} | ${c.status} | $${c.spend.toFixed(2)} spend | $${c.revenue.toFixed(2)} rev | ${c.conversions} conv | ${c.clicks} clicks | ${c.impressions} impr | ROAS ${c.spend > 0 ? (c.revenue / c.spend).toFixed(2) : 'N/A'} | budget $${c.daily_budget ?? 'N/A'} | ${c.bidding_strategy_type || ''} | impr_share ${c.impr_share_n > 0 ? (c.impr_share_sum / c.impr_share_n).toFixed(2) : 'N/A'}`).join('\n') || 'No campaigns'}

=== CREATIVES (Last 30 Days, top 40 by spend) ===
${(creatives || []).map((c: any) => `${c.ad_name || c.headline || '(no name)'} | ${c.platform} | ${c.creative_type || c.format || 'n/a'} | $${Number(c.spend || 0).toFixed(2)} spend | $${Number(c.revenue || 0).toFixed(2)} rev | ${c.conversions || 0} conv | CTR ${c.ctr || 'N/A'}% | CPA $${c.cpa || 'N/A'} | ROAS ${c.roas || 'N/A'} | freq ${c.frequency || 'N/A'} | 3s/50/95: ${c.video_views_3s || 0}/${c.video_views_50 || 0}/${c.video_views_95 || 0} | "${truncate(c.headline, 60)}" — ${c.campaign_name}`).join('\n') || 'No creatives'}

=== AD SETS (Last 7 Days, top 50 by spend) ===
${(adSets || []).map((s: any) => `${s.adset_name} → ${s.campaign_name} | ${s.platform} | $${Number(s.spend).toFixed(2)} spend | $${Number(s.revenue).toFixed(2)} rev | ${s.conversions} conv | CTR ${s.ctr || 'N/A'} | CPC ${s.cpc || 'N/A'} | CPA ${s.cpa || 'N/A'} | ${s.status || ''}`).join('\n') || 'No ad sets'}

=== GOOGLE KEYWORDS (Last 7 Days, top 40 by spend) ===
${(keywords || []).map((k: any) => `${k.keyword} [${k.match_type || 'n/a'}] (${k.ad_group} / ${k.campaign_name}) | $${Number(k.spend || 0).toFixed(2)} spend | ${k.clicks || 0} clicks | ${k.conversions || 0} conv | CPC $${k.cpc || 'N/A'} | CTR ${k.ctr || 'N/A'} | QS ${k.quality_score || 'N/A'} | impr_share ${k.impression_share || 'N/A'}${k.is_negative ? ' [NEGATIVE]' : ''}`).join('\n') || 'No keywords'}

=== SEARCH TERMS (Last 7 Days, top 30 by spend) ===
${(searchTerms || []).map((t: any) => `"${t.search_term}" → ${t.keyword_text || ''} [${t.match_type || ''}] (${t.campaign_name}) | $${Number(t.spend || 0).toFixed(2)} spend | ${t.clicks || 0} clicks | ${t.conversions || 0} conv | CTR ${t.ctr || 'N/A'} | CPA ${t.cpa || 'N/A'}`).join('\n') || 'No search terms'}

=== FATHOM MEETINGS (Last 30 Days, top 15) ===
${fathomMeetings.slice(0, 15).map((m: any) => `[${m.occurred_at}] ${m.title} | participants: ${(m.participants || []).join(', ') || 'n/a'}\n${truncate(m.content, 800) || 'No summary'}`).join('\n---\n') || 'None'}

=== SLACK COMMUNICATIONS (Last 30 Days, top 50) ===
${slackItems.slice(0, 50).map((s: any) => `[${s.occurred_at}] ${s.title || s.content_type}${(s.participants || []).length ? ' — ' + (s.participants || []).join(', ') : ''}: ${truncate(s.content, 400)}`).join('\n') || 'None'}

=== EMAIL THREADS (Last 30 Days, top 15) ===
${emailItems.slice(0, 15).map((e: any) => `[${e.occurred_at}] ${e.title}: ${truncate(e.content, 350)}`).join('\n') || 'None'}

=== OTHER CONTEXT (notes/docs, top 15) ===
${otherContext.slice(0, 15).map((c: any) => `[${c.source} • ${c.occurred_at}] ${c.title}: ${truncate(c.content, 300)}`).join('\n') || 'None'}

=== OPEN TASKS ===
${(tasks || []).map((t: any) => `[${t.status} • ${t.priority}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n') || 'None'}

=== OPEN ACTION ITEMS ===
${(actionItems || []).map((a: any) => `- ${a.description}${a.due_date ? ` (due ${a.due_date})` : ''}`).join('\n') || 'None'}

=== PENDING AI RECOMMENDATIONS ===
${(recommendations || []).map((r: any) => `[${r.severity} • ${r.platform}] ${r.title}: ${truncate(r.description, 200)}`).join('\n') || 'None'}

=== RECENT AGENDAS ===
${(agendas || []).map((a: any) => `[${a.call_date} • ${a.call_type}] ${a.title} (${a.status})`).join('\n') || 'None'}
`.trim();

    console.log(`[ai-assistant] payload size: ${dataContext.length} chars (~${Math.round(dataContext.length / 4)} tokens) | client: ${clientInfo?.name} | campaigns: ${aggregatedCampaigns.length} (from ${(campaigns || []).length} rows) | ringba: ${ringbaAgg.totalCalls} | context: ${(contextItems || []).length}`);

    // Build conversation messages
    const messages: any[] = [
      {
        role: 'system',
        content: `You are the AI assistant for ${clientInfo?.name || 'this client'} at Connect Paid Media, a digital advertising agency.

You have access to real-time data from:
- Ad platform performance (Google Ads, Meta Ads) — campaign, ad set, and creative level
- Ringba call tracking data (revenue, conversions, call volume)
- Fathom meeting recordings and summaries
- Slack communications
- Task management system
- Previous call agendas and action items
- AI optimization recommendations

RULES:
1. ONLY cite numbers that appear in the data provided. Never invent or estimate figures.
2. If asked about something not in the data, say you don't have that information yet.
3. Be concise and actionable. Use bullet points for clarity.
4. When referencing performance, always specify the time period.
5. Cite sources (e.g., "from the Fathom meeting on 4/10" or "per Google Ads data").
6. Format currency with $ and commas. Format percentages to 1 decimal.
7. If the question relates to a specific vertical (pest control, flights, porta potty, etc.), filter your response to that vertical's data. Match verticals by campaign name patterns (e.g. "Flight" for flights).
8. CRITICAL: For lead-gen / call-based verticals, Ringba calls ARE the primary conversions — not ad platform conversions. Always check the "Per-Campaign Ringba Breakdown" section when discussing conversions or performance. Ad platform "conversions" often only track landing page events, while Ringba tracks actual monetized phone calls and revenue.
9. Reference meeting notes and Slack conversations when relevant to provide full context.
10. Keep responses focused and under 500 words unless the user asks for a deep dive.
11. CHARTS: Use the generate_chart tool when a visual genuinely improves the answer. Pick the right type:
    - LINE chart for any trend over time. This is your default for time-based questions. Use the "DAILY TIME-SERIES" section as the source — it is zero-filled and contains EVERY day in the window. NEVER plot a partial range; always include all days, even days with 0 calls or 0 revenue.
    - PRIORITIZE THE METRICS THAT MATTER for this client: for call-based / lead-gen verticals (pest control, flights, porta potty, legal, etc.), the priority is RINGBA CALL REVENUE and CALL VOLUME — not ad spend. Plot revenue and/or calls as the primary series. Spend is a secondary metric, only worth charting alongside revenue if you're showing efficiency over time, and only when scales are comparable.
    - You may plot MULTIPLE series on one line chart (e.g. daily calls + daily converted calls, or daily revenue + daily payout) when they share a similar scale.
    - BAR chart only for comparing 3+ categories of similar magnitude (e.g. revenue across 5 campaigns).
    - PIE/DOUGHNUT only for proportion-of-whole with 3-6 slices.
    - DO NOT chart 2 values with very different scales (e.g. $521 revenue vs $9.88 spend) on the same axis — express as text + ratio (ROAS, margin) instead.
    - DO NOT chart just 2 numbers — state them inline.
    - Skip the chart entirely if a single sentence tells the story better.
    Always use REAL numbers from the context. Never fabricate or truncate time-series data. Label dates clearly (e.g. "Apr 11", "Apr 12"). After generating a chart, briefly summarize the takeaway; the chart appears inline.

You should answer questions about campaign performance, meeting summaries, action items, creative performance, optimization opportunities, and general client strategy.`
      }
    ];

    // Add conversation history if provided
    if (conversation_history && Array.isArray(conversation_history)) {
      for (const msg of conversation_history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add the current question with data context
    messages.push({
      role: 'user',
      content: `Here is the current data for ${clientInfo?.name}:\n\n${dataContext}\n\n---\nQuestion: ${question}`
    });

    // Call Anthropic Claude (with chart tool enabled)
    const aiRes = await callAnthropic(messages, {
      max_tokens: 4096,
      temperature: 0.3,
      enableCharts: true,
    });

    if (!aiRes.ok) {
      console.error('Anthropic error:', aiRes.status, aiRes.error);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited by Anthropic — try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Anthropic error: ${aiRes.status} ${aiRes.error}`);
    }

    const answer = aiRes.content || 'Sorry, I could not generate a response.';
    if (aiRes.usage) {
      console.log(`[ai-assistant] Anthropic tokens — input: ${aiRes.usage.input_tokens}, output: ${aiRes.usage.output_tokens}`);
      // Fire-and-forget cost log
      logAiUsage({
        client_id,
        surface: 'ai-assistant',
        model: ANTHROPIC_DEFAULT_MODEL,
        input_tokens: aiRes.usage.input_tokens,
        output_tokens: aiRes.usage.output_tokens,
        cache_read_tokens: aiRes.usage.cache_read_input_tokens,
        cache_write_tokens: aiRes.usage.cache_creation_input_tokens,
        metadata: { question_chars: question?.length ?? 0, charts: aiRes.charts.length },
      }).catch((e) => console.error('logAiUsage failed:', e));
    }

    // Determine which sources were relevant
    const sources: { title: string; source: string }[] = [];
    if (fathomMeetings.length > 0) sources.push({ title: `${fathomMeetings.length} Fathom recordings`, source: 'Fathom' });
    if (slackItems.length > 0) sources.push({ title: `${slackItems.length} Slack messages`, source: 'Slack' });
    if ((campaigns || []).length > 0) sources.push({ title: `${(campaigns || []).length} campaign records`, source: 'Ad Platforms' });
    if (ringbaAgg.totalCalls > 0) sources.push({ title: `${ringbaAgg.totalCalls} Ringba calls`, source: 'Ringba' });
    if ((tasks || []).length > 0) sources.push({ title: `${(tasks || []).length} tasks`, source: 'Tasks' });

    return new Response(JSON.stringify({ answer, sources, charts: aiRes.charts }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('AI Assistant error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
