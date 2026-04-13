const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

interface AgendaSubsection {
  title: string;
  items: string[];
  placeholder?: string;
  ai_populatable?: boolean;
}

interface AgendaSection {
  section: string;
  subsections?: AgendaSubsection[];
  items?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { client_id, agenda_id, template_sections, additional_context } = await req.json();

    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Gather context in parallel
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    const [
      { data: contextItems },
      { data: recentCampaigns },
      { data: ringbaCalls },
      { data: actionItems },
      { data: lastAgenda },
      { data: recommendations },
      { data: clientInfo },
    ] = await Promise.all([
      // Recent context feed items
      supabase
        .from('context_items')
        .select('title, content, content_type, source, occurred_at')
        .eq('client_id', client_id)
        .gte('occurred_at', sevenDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(20),
      // Campaign performance last 7 days
      supabase
        .from('ad_campaigns')
        .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status')
        .eq('client_id', client_id)
        .gte('date', sevenDaysAgo)
        .lte('date', todayStr)
        .limit(200),
      // Ringba calls last 7 days
      supabase
        .from('ringba_calls')
        .select('campaign_name, revenue, payout, converted, duration_seconds')
        .eq('client_id', client_id)
        .gte('call_date', sevenDaysAgo)
        .limit(200),
      // Open action items from previous agendas
      supabase
        .from('call_action_items')
        .select('description, completed, call_agenda_id')
        .eq('completed', false)
        .limit(30),
      // Last completed/published agenda
      supabase
        .from('call_agendas')
        .select('agenda_content, notes_content, call_date, title')
        .eq('client_id', client_id)
        .in('status', ['completed', 'published'])
        .order('call_date', { ascending: false })
        .limit(1),
      // Recent AI recommendations
      supabase
        .from('ai_optimization_recommendations')
        .select('title, description, severity, platform, status')
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10),
      // Client info
      supabase
        .from('clients')
        .select('name, slug')
        .eq('id', client_id)
        .single(),
    ]);

    // Aggregate campaign metrics by platform
    const platformMetrics: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    for (const c of recentCampaigns || []) {
      const p = c.platform || 'unknown';
      if (!platformMetrics[p]) platformMetrics[p] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      platformMetrics[p].spend += Number(c.spend);
      platformMetrics[p].revenue += Number(c.revenue);
      platformMetrics[p].conversions += Number(c.conversions);
      platformMetrics[p].clicks += Number(c.clicks);
      platformMetrics[p].impressions += Number(c.impressions);
    }

    // Aggregate Ringba
    const ringbaAgg = { totalCalls: 0, converted: 0, totalRevenue: 0, totalPayout: 0 };
    for (const call of ringbaCalls || []) {
      ringbaAgg.totalCalls++;
      if (call.converted) ringbaAgg.converted++;
      ringbaAgg.totalRevenue += Number(call.revenue);
      ringbaAgg.totalPayout += Number(call.payout);
    }

    // Build context summary for AI
    const contextSummary = {
      client_name: clientInfo?.name || 'Unknown',
      period: `${sevenDaysAgo} to ${todayStr}`,
      platform_performance: platformMetrics,
      ringba_performance: ringbaAgg,
      recent_context_items: (contextItems || []).map(ci => ({
        title: ci.title,
        type: ci.content_type,
        source: ci.source,
        date: ci.occurred_at,
        snippet: ci.content?.slice(0, 200),
      })),
      open_action_items: (actionItems || []).map(ai => ai.description),
      last_agenda_date: lastAgenda?.[0]?.call_date,
      pending_recommendations: (recommendations || []).map(r => ({
        title: r.title,
        severity: r.severity,
        platform: r.platform,
      })),
      additional_context: additional_context || '',
    };

    // Build template structure description
    const templateDesc = (template_sections as AgendaSection[] || [])
      .map((s: AgendaSection) => {
        const subs = s.subsections?.map(sub =>
          `  - ${sub.title}${sub.ai_populatable ? ' [AI SHOULD POPULATE]' : ' [LEAVE EMPTY for manual input]'}`
        ).join('\n') || '';
        return `${s.section}:\n${subs}`;
      })
      .join('\n\n');

    const systemPrompt = `You are an expert digital marketing account manager preparing a weekly client call agenda. 
You analyze LAST 7 DAYS performance data, context feed items, open action items, and optimization recommendations to create a focused, actionable agenda.

The agenda follows a specific template structure. For each section marked [AI SHOULD POPULATE], generate 3-6 concise bullet points based on the data provided.
For sections NOT marked for AI population, leave the items array empty — those are for manual input by the team.

IMPORTANT RULES:
- ALL metrics are from the LAST 7 DAYS ONLY — not all-time. Always reference the date range.
- Be specific with numbers: include actual spend, revenue, ROAS, conversion counts for the 7-day window
- Call out significant changes (>10% week-over-week)
- Highlight any campaigns that need attention (high spend/low return, paused campaigns that could be restarted)
- For Ringba/call metrics: include call volume, conversion rates, revenue
- Reference open action items from previous calls
- Include pending AI optimization recommendations
- Keep each bullet point concise (1-2 sentences max)
- Use the client's actual campaign names when referencing specific campaigns

Return ONLY valid JSON matching the template structure.`;

    const userPrompt = `Generate the weekly agenda for ${contextSummary.client_name}.
ALL DATA BELOW IS FROM THE LAST 7 DAYS (${contextSummary.period}). Report metrics for this period only.

PERFORMANCE DATA (${contextSummary.period}):
${JSON.stringify(contextSummary.platform_performance, null, 2)}

RINGBA CALL DATA:
${JSON.stringify(contextSummary.ringba_performance, null, 2)}

RECENT CONTEXT/COMMUNICATIONS:
${JSON.stringify(contextSummary.recent_context_items, null, 2)}

OPEN ACTION ITEMS FROM PREVIOUS CALLS:
${JSON.stringify(contextSummary.open_action_items, null, 2)}

PENDING OPTIMIZATION RECOMMENDATIONS:
${JSON.stringify(contextSummary.pending_recommendations, null, 2)}

${contextSummary.additional_context ? `ADDITIONAL CONTEXT FROM TEAM:\n${contextSummary.additional_context}` : ''}

TEMPLATE STRUCTURE TO FOLLOW:
${templateDesc}

Return the complete agenda_content as a JSON array of sections matching the template structure. For ai_populatable subsections, fill in the items array with relevant bullet points. For non-ai_populatable subsections, keep items as empty arrays.`;

    // Call AI
    const aiResponse = await fetch('https://ai.lovable.dev/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content;

    let generatedSections: AgendaSection[];
    try {
      const parsed = JSON.parse(rawContent);
      generatedSections = parsed.sections || parsed.agenda_content || parsed;
      if (!Array.isArray(generatedSections)) {
        generatedSections = template_sections as AgendaSection[];
      }
    } catch {
      generatedSections = template_sections as AgendaSection[];
    }

    // If agenda_id provided, update it directly
    if (agenda_id) {
      const { error } = await supabase
        .from('call_agendas')
        .update({
          agenda_content: generatedSections,
          ai_context: contextSummary,
        })
        .eq('id', agenda_id);
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      sections: generatedSections,
      context_summary: contextSummary,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
