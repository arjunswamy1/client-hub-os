import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropic } from "../_shared/anthropic.ts";

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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];

    // Gather all context in parallel
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
      { data: recommendations },
      { data: agendas },
    ] = await Promise.all([
      supabase.from('clients').select('name, slug').eq('id', client_id).single(),
      supabase.from('context_items')
        .select('title, content, content_type, source, occurred_at, metadata, participants')
        .eq('client_id', client_id)
        .gte('occurred_at', thirtyDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(60),
      supabase.from('ad_campaigns')
        .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, roas, status, daily_budget, bidding_strategy_type, account_id')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .lte('date', todayStr)
        .limit(500),
      supabase.from('ad_daily_metrics')
        .select('date, platform, spend, revenue, impressions, clicks, conversions, cost_per_conversion')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .order('date', { ascending: false })
        .limit(100),
      supabase.from('ringba_calls')
        .select('campaign_name, revenue, payout, converted, duration_seconds, target_name, call_date')
        .eq('client_id', client_id)
        .gte('call_date', sevenDaysAgo)
        .limit(500),
      supabase.from('tasks')
        .select('title, description, status, priority, tags, assignee_id')
        .eq('client_id', client_id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('call_action_items')
        .select('description, completed, due_date')
        .eq('completed', false)
        .limit(30),
      supabase.from('ad_creatives')
        .select('campaign_name, ad_name, platform, spend, conversions, ctr, cpa, roas, headline, status, vertical')
        .eq('client_id', client_id)
        .gte('date_from', thirtyDaysAgo)
        .order('spend', { ascending: false })
        .limit(20),
      supabase.from('ad_sets')
        .select('adset_name, campaign_name, platform, spend, revenue, conversions, cpa, status')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .order('spend', { ascending: false })
        .limit(30),
      supabase.from('ai_optimization_recommendations')
        .select('title, description, severity, platform, status')
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .limit(10),
      supabase.from('call_agendas')
        .select('title, call_date, agenda_content, notes_content, status')
        .eq('client_id', client_id)
        .order('call_date', { ascending: false })
        .limit(3),
    ]);

    // Aggregate campaign metrics by platform
    const platformAgg: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    for (const c of campaigns || []) {
      const p = c.platform || 'unknown';
      if (!platformAgg[p]) platformAgg[p] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      platformAgg[p].spend += Number(c.spend);
      platformAgg[p].revenue += Number(c.revenue);
      platformAgg[p].conversions += Number(c.conversions);
      platformAgg[p].clicks += Number(c.clicks);
      platformAgg[p].impressions += Number(c.impressions);
    }

    // Aggregate ringba — total and per-campaign
    const ringbaAgg = { totalCalls: 0, converted: 0, totalRevenue: 0, totalPayout: 0 };
    const ringbaByCampaign: Record<string, { calls: number; converted: number; revenue: number; payout: number; avgDuration: number; totalDuration: number }> = {};
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
    }
    // Compute avg duration
    for (const key of Object.keys(ringbaByCampaign)) {
      const c = ringbaByCampaign[key];
      c.avgDuration = c.calls > 0 ? Math.round(c.totalDuration / c.calls) : 0;
    }

    // Categorize context items
    const fathomMeetings = (contextItems || []).filter((c: any) => c.source === 'fathom');
    const slackItems = (contextItems || []).filter((c: any) => c.source === 'slack');
    const otherContext = (contextItems || []).filter((c: any) => c.source !== 'fathom' && c.source !== 'slack');

    // Build the data payload for the AI
    const dataContext = `
=== CLIENT: ${clientInfo?.name || 'Unknown'} ===
Data period: ${sevenDaysAgo} to ${todayStr}

=== AD PLATFORM PERFORMANCE (Last 7 Days) ===
${JSON.stringify(platformAgg, null, 2)}

=== DAILY METRICS ===
${JSON.stringify(dailyMetrics?.slice(0, 14) || [], null, 2)}

=== RINGBA CALLS (Last 7 Days) ===
Total calls: ${ringbaAgg.totalCalls}, Converted: ${ringbaAgg.converted}, Revenue: $${ringbaAgg.totalRevenue.toFixed(2)}, Payout: $${ringbaAgg.totalPayout.toFixed(2)}

Per-Campaign Ringba Breakdown:
${Object.entries(ringbaByCampaign).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, d]) => `  ${name}: ${d.calls} calls, ${d.converted} converted, $${d.revenue.toFixed(2)} revenue, $${d.payout.toFixed(2)} payout, avg ${d.avgDuration}s`).join('\n')}

=== TOP CAMPAIGNS ===
${(campaigns || []).slice(0, 15).map((c: any) => `${c.campaign_name} (${c.platform}): $${c.spend} spend, ${c.conversions} conv, ROAS ${c.roas || 'N/A'}`).join('\n')}

=== TOP AD CREATIVES ===
${(creatives || []).slice(0, 10).map((c: any) => `${c.ad_name || c.headline || c.campaign_name} (${c.platform}): $${c.spend} spend, CPA $${c.cpa || 'N/A'}, CTR ${c.ctr || 'N/A'}%`).join('\n')}

=== TOP AD SETS ===
${(adSets || []).slice(0, 10).map((s: any) => `${s.adset_name} → ${s.campaign_name} (${s.platform}): $${s.spend} spend, ${s.conversions} conv, CPA $${s.cpa || 'N/A'}`).join('\n')}

=== FATHOM MEETING RECORDINGS (Last 30 Days) ===
${fathomMeetings.map((m: any) => `[${m.occurred_at}] ${m.title}\n${m.content?.slice(0, 400) || 'No summary'}\nRecording: ${m.metadata?.recording_url || 'N/A'}`).join('\n---\n')}

=== SLACK COMMUNICATIONS ===
${slackItems.slice(0, 20).map((s: any) => `[${s.occurred_at}] ${s.title}: ${s.content?.slice(0, 200) || ''}`).join('\n')}

=== OTHER CONTEXT ===
${otherContext.slice(0, 10).map((c: any) => `[${c.source}] ${c.title}: ${c.content?.slice(0, 200) || ''}`).join('\n')}

=== TASKS ===
${(tasks || []).map((t: any) => `[${t.status}] ${t.title} (${t.priority})`).join('\n')}

=== OPEN ACTION ITEMS ===
${(actionItems || []).map((a: any) => `- ${a.description}${a.due_date ? ` (due ${a.due_date})` : ''}`).join('\n') || 'None'}

=== PENDING AI RECOMMENDATIONS ===
${(recommendations || []).map((r: any) => `[${r.severity}] ${r.title}: ${r.description?.slice(0, 150)}`).join('\n') || 'None'}

=== RECENT AGENDAS ===
${(agendas || []).map((a: any) => `[${a.call_date}] ${a.title} (${a.status})`).join('\n') || 'None'}
`.trim();

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
      max_tokens: 2048,
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
