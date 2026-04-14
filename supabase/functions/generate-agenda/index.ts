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
    const { client_id, agenda_id, template_sections, additional_context, call_date } = await req.json();

    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Use the agenda's call_date as the reference point, falling back to today
    const referenceDate = call_date ? new Date(call_date + 'T23:59:59Z') : new Date();
    const todayStr = referenceDate.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(referenceDate.getTime() - 7 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(referenceDate.getTime() - 30 * 86400000).toISOString().split('T')[0];

    const [
      { data: contextItems },
      { data: recentCampaigns },
      { data: ringbaCalls },
      { data: actionItems },
      { data: lastAgenda },
      { data: recommendations },
      { data: clientInfo },
      { data: slackSummaries },
      { data: slackMessages },
      { data: recentTasks },
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
      // Slack AI summaries (last 7 days)
      supabase
        .from('context_items')
        .select('content, metadata, occurred_at')
        .eq('client_id', client_id)
        .eq('source', 'slack')
        .eq('content_type', 'ai_summary')
        .gte('occurred_at', sevenDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(5),
      // Recent Slack messages for behind-the-scenes context
      supabase
        .from('context_items')
        .select('title, content, participants, occurred_at, metadata')
        .eq('client_id', client_id)
        .eq('source', 'slack')
        .eq('content_type', 'message')
        .gte('occurred_at', sevenDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(50),
      // Recently created tasks (especially Slack-generated)
      supabase
        .from('tasks')
        .select('title, description, status, priority, tags')
        .eq('client_id', client_id)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // Vertical detection patterns
    const VERTICALS = ['flights', 'pest control', 'porta potty', 'bathroom remodel', 'hvac', 'garage doors'];
    function detectVertical(name: string): string {
      const lower = (name || '').toLowerCase();
      for (const v of VERTICALS) {
        if (lower.includes(v.replace(' ', '')) || lower.includes(v)) return v;
      }
      if (lower.includes('pest') || lower.includes('exterminator')) return 'pest control';
      if (lower.includes('flight') || lower.includes('airline')) return 'flights';
      if (lower.includes('porta') || lower.includes('portable toilet')) return 'porta potty';
      if (lower.includes('bathroom') || lower.includes('bath remodel') || lower.includes('br ')) return 'bathroom remodel';
      if (lower.includes('hvac') || lower.includes('heating') || lower.includes('cooling')) return 'hvac';
      if (lower.includes('garage') || lower.includes('a1 garage')) return 'garage doors';
      return 'unclassified';
    }

    // Aggregate campaign metrics by platform AND by vertical+platform
    type MetricBucket = { spend: number; revenue: number; conversions: number; clicks: number; impressions: number; campaigns: string[] };
    const newBucket = (): MetricBucket => ({ spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, campaigns: [] });

    const platformMetrics: Record<string, MetricBucket> = {};
    const verticalMetrics: Record<string, Record<string, MetricBucket>> = {};

    for (const c of recentCampaigns || []) {
      const p = c.platform || 'unknown';
      const v = detectVertical(c.campaign_name);
      if (!platformMetrics[p]) platformMetrics[p] = newBucket();
      platformMetrics[p].spend += Number(c.spend);
      platformMetrics[p].revenue += Number(c.revenue);
      platformMetrics[p].conversions += Number(c.conversions);
      platformMetrics[p].clicks += Number(c.clicks);
      platformMetrics[p].impressions += Number(c.impressions);
      if (!platformMetrics[p].campaigns.includes(c.campaign_name)) platformMetrics[p].campaigns.push(c.campaign_name);

      if (!verticalMetrics[v]) verticalMetrics[v] = {};
      if (!verticalMetrics[v][p]) verticalMetrics[v][p] = newBucket();
      verticalMetrics[v][p].spend += Number(c.spend);
      verticalMetrics[v][p].revenue += Number(c.revenue);
      verticalMetrics[v][p].conversions += Number(c.conversions);
      verticalMetrics[v][p].clicks += Number(c.clicks);
      verticalMetrics[v][p].impressions += Number(c.impressions);
      if (!verticalMetrics[v][p].campaigns.includes(c.campaign_name)) verticalMetrics[v][p].campaigns.push(c.campaign_name);
    }

    // Aggregate Ringba by vertical
    const ringbaAgg = { totalCalls: 0, converted: 0, totalRevenue: 0, totalPayout: 0 };
    const ringbaByVertical: Record<string, { totalCalls: number; converted: number; totalRevenue: number; totalPayout: number }> = {};
    for (const call of ringbaCalls || []) {
      ringbaAgg.totalCalls++;
      if (call.converted) ringbaAgg.converted++;
      ringbaAgg.totalRevenue += Number(call.revenue);
      ringbaAgg.totalPayout += Number(call.payout);

      const v = detectVertical(call.campaign_name || '');
      if (!ringbaByVertical[v]) ringbaByVertical[v] = { totalCalls: 0, converted: 0, totalRevenue: 0, totalPayout: 0 };
      ringbaByVertical[v].totalCalls++;
      if (call.converted) ringbaByVertical[v].converted++;
      ringbaByVertical[v].totalRevenue += Number(call.revenue);
      ringbaByVertical[v].totalPayout += Number(call.payout);
    }

    // Build context summary for AI
    const contextSummary = {
      client_name: clientInfo?.name || 'Unknown',
      period: `${sevenDaysAgo} to ${todayStr}`,
      platform_performance: platformMetrics,
      vertical_performance: verticalMetrics,
      ringba_performance: ringbaAgg,
      ringba_by_vertical: ringbaByVertical,
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
You analyze the TRAILING 7 DAYS of performance data ending on the agenda date.

The agenda follows a specific template structure. The structure has:
1. "Marketing Updates" — a top-level section for links/resources. Leave items empty.
2. Per-vertical sections (Pest Control, Porta Potty, Flights, HVAC, Bathroom Remodel, Garage Doors) each with subsections: Google, Meta, Bing, Ringba / Calls, Notes.
   - For platform subsections marked [AI SHOULD POPULATE], generate 2-5 concise bullet points with actual spend, conversions, CPA, and notable campaign callouts. Format like: "Spend: $X | Y conversions | $Z CPA" on the first bullet, then specific campaign callouts.
   - If a vertical has no data for a platform, OMIT that platform subsection entirely (do not include it). Only include platforms that have real activity data.
   - For "Notes" subsections (not AI populatable), leave items empty for manual input.
3. "Feedback from Client" — leave items empty for manual input.

ABSOLUTE RULES — VIOLATION = FAILURE:
1. You may ONLY cite numbers that appear verbatim in the DATA sections below. If the data says spend is $2,322 then you write $2,322 — not $2,300, not $2.3K rounded differently, and absolutely not a made-up number.
2. Revenue in ad platforms may be $0 if tracking is not connected. If revenue = 0, say "Revenue: $0 (platform revenue tracking not connected)" — do NOT invent a revenue figure.
3. Ringba call data is the ONLY source of call-based revenue. Use the exact totals provided.
4. If a vertical or platform has NO rows in the data, write "No activity this period."
5. NEVER use placeholder numbers, industry benchmarks, or estimates. Every dollar figure must come from the data below.
6. ALL metrics are for the trailing 7-day window (${contextSummary.period}) ONLY.
7. Use the client's actual campaign names when referencing specific campaigns.
8. Keep each bullet point concise (1-2 sentences max).
9. Reference open action items from previous calls if any exist.
10. Format spend/revenue as dollars with commas (e.g. $2,322.37). Format ROAS to 2 decimal places.
11. For the first bullet in each platform subsection, lead with the summary line: "Spend: $X | Y conversions | $Z CPA"

Return ONLY valid JSON matching the template structure.`;

    const userPrompt = `Generate the weekly agenda for ${contextSummary.client_name}.
DATA PERIOD: ${contextSummary.period} (trailing 7 days ending ${todayStr}).

=== OVERALL PLATFORM PERFORMANCE (use these exact numbers — do NOT make up figures) ===
${JSON.stringify(contextSummary.platform_performance, null, 2)}

=== PERFORMANCE BROKEN DOWN BY VERTICAL (use for vertical-specific sections) ===
${JSON.stringify(contextSummary.vertical_performance, null, 2)}

=== OVERALL RINGBA CALL DATA ===
${JSON.stringify(contextSummary.ringba_performance, null, 2)}

=== RINGBA CALLS BY VERTICAL ===
${JSON.stringify(contextSummary.ringba_by_vertical, null, 2)}

=== RECENT CONTEXT/COMMUNICATIONS ===
${JSON.stringify(contextSummary.recent_context_items, null, 2)}

=== OPEN ACTION ITEMS FROM PREVIOUS CALLS ===
${JSON.stringify(contextSummary.open_action_items, null, 2)}

=== PENDING OPTIMIZATION RECOMMENDATIONS ===
${JSON.stringify(contextSummary.pending_recommendations, null, 2)}

${contextSummary.additional_context ? `=== ADDITIONAL CONTEXT FROM TEAM ===\n${contextSummary.additional_context}` : ''}

TEMPLATE STRUCTURE TO FOLLOW:
${templateDesc}

Return the complete agenda_content as a JSON array of sections matching the template structure. For ai_populatable subsections, fill in the items array with relevant bullet points using ONLY the real data above. For non-ai_populatable subsections, keep items as empty arrays.`;

    console.log('Calling AI with', Object.keys(contextSummary.vertical_performance).length, 'verticals,', Object.keys(contextSummary.platform_performance).length, 'platforms');

    // Call AI
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errText);
      throw new Error(`AI API error: ${aiResponse.status} ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content;
    console.log('AI response length:', rawContent?.length, 'finish_reason:', aiData.choices?.[0]?.finish_reason);

    let generatedSections: AgendaSection[];
    try {
      const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        generatedSections = parsed;
      } else if (Array.isArray(parsed.sections)) {
        generatedSections = parsed.sections;
      } else if (Array.isArray(parsed.agenda_content)) {
        generatedSections = parsed.agenda_content;
      } else {
        // AI returned an object keyed by section name — merge into template
        console.log('AI returned object with keys, merging into template sections');
        const tpl = JSON.parse(JSON.stringify(template_sections)) as AgendaSection[];
        for (const section of tpl) {
          const aiSection = parsed[section.section];
          if (!aiSection) continue;
          if (section.subsections) {
            for (const sub of section.subsections) {
              // Try matching by subsection title
              const aiSub = aiSection[sub.title] || aiSection[sub.title.toLowerCase()];
              if (Array.isArray(aiSub)) {
                sub.items = aiSub;
              } else if (aiSub && typeof aiSub === 'object' && Array.isArray(aiSub.items)) {
                sub.items = aiSub.items;
              }
            }
          }
        }
        generatedSections = tpl;
      }
    } catch (parseErr: any) {
      console.error('JSON parse error:', parseErr.message, 'raw preview:', rawContent?.slice(0, 200));
      generatedSections = template_sections as AgendaSection[];
    }

    // Post-process: remove platform subsections with no activity
    const NO_ACTIVITY_PATTERNS = ['no activity', 'no data', 'no spend', 'n/a'];
    const PLATFORM_SUBS = ['google', 'meta', 'bing', 'ringba / calls'];

    for (const section of generatedSections) {
      if (!section.subsections || !section.vertical) continue;
      section.subsections = section.subsections.filter(sub => {
        const subTitle = sub.title.toLowerCase();
        // Always keep non-platform subsections (Notes, etc.)
        if (!PLATFORM_SUBS.includes(subTitle)) return true;
        // Remove if no items
        if (!sub.items || sub.items.length === 0) return false;
        // Remove if only "no activity" type bullets
        const allNoActivity = sub.items.every(item =>
          NO_ACTIVITY_PATTERNS.some(p => item.toLowerCase().includes(p))
        );
        return !allNoActivity;
      });
    }
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
