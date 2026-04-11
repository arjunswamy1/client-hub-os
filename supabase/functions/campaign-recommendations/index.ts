import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { client_id, platform, vertical_id, action } = await req.json();

    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Action: analyze ───
    // Fetch recent campaign data and generate optimization recommendations
    if (action === "analyze" || !action) {
      // Get last 14 days of campaign data
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const fromDate = twoWeeksAgo.toISOString().split("T")[0];

      let campaignQuery = supabase
        .from("ad_campaigns")
        .select("campaign_name, platform, spend, revenue, clicks, impressions, conversions, status, daily_budget, bidding_strategy_type")
        .eq("client_id", client_id)
        .gte("date", fromDate);

      if (platform) campaignQuery = campaignQuery.eq("platform", platform);

      const { data: campaigns, error: campErr } = await campaignQuery;
      if (campErr) throw campErr;

      // Get Ringba data
      const { data: ringbaCalls } = await supabase
        .from("ringba_calls")
        .select("campaign_name, revenue, converted, connected")
        .eq("client_id", client_id)
        .gte("call_date", `${fromDate}T00:00:00`);

      // Aggregate campaigns
      const campaignMap = new Map<string, any>();
      for (const row of campaigns || []) {
        const key = `${row.campaign_name}__${row.platform}`;
        const existing = campaignMap.get(key) || {
          name: row.campaign_name, platform: row.platform,
          spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0,
          status: row.status, dailyBudget: row.daily_budget, bidStrategy: row.bidding_strategy_type,
        };
        existing.spend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        existing.clicks += Number(row.clicks);
        existing.impressions += Number(row.impressions);
        existing.conversions += Number(row.conversions);
        campaignMap.set(key, existing);
      }

      const aggregated = Array.from(campaignMap.values()).map(c => ({
        ...c,
        cpc: c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : 0,
        ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
        cpa: c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : 0,
        roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
      }));

      // Ringba summary
      const ringbaSummary = {
        totalCalls: (ringbaCalls || []).length,
        convertedCalls: (ringbaCalls || []).filter(c => c.converted).length,
        totalRevenue: (ringbaCalls || []).reduce((sum, c) => sum + Number(c.revenue || 0), 0),
      };

      const prompt = `You are a performance marketing optimization AI agent for a lead-gen business using Google Ads and Meta Ads with Ringba call tracking.

Analyze the following campaign data from the last 14 days and provide actionable optimization recommendations.

Campaign Data:
${JSON.stringify(aggregated, null, 2)}

Ringba Call Tracking Summary:
${JSON.stringify(ringbaSummary)}

Provide recommendations in this JSON format:
{
  "recommendations": [
    {
      "type": "budget_shift|bid_change|pause_campaign|negative_keywords|creative_refresh|scale_up",
      "entity_type": "campaign|ad_group|keyword",
      "entity_name": "campaign name or keyword",
      "severity": "high|medium|low",
      "title": "Short action title",
      "description": "Detailed explanation",
      "recommended_action": {
        "action": "specific action to take",
        "current_value": "current state",
        "recommended_value": "recommended state"
      },
      "projected_impact": {
        "metric": "CPA|ROAS|spend",
        "current": "current value",
        "projected": "projected value",
        "confidence": "high|medium|low"
      }
    }
  ],
  "summary": "Executive summary of findings",
  "budget_reallocation": {
    "total_spend": 0,
    "recommended_shifts": [
      { "from": "campaign A", "to": "campaign B", "amount": 100, "reason": "why" }
    ]
  },
  "anomalies": [
    { "type": "spend_spike|ctr_drop|conversion_drop", "campaign": "name", "detail": "description" }
  ]
}`;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        throw new Error(`AI error [${aiResponse.status}]: ${errText.substring(0, 200)}`);
      }

      const aiData = await aiResponse.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      let cleaned = content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const parsed = JSON.parse(cleaned);

      // Store recommendations in DB
      if (parsed.recommendations) {
        for (const rec of parsed.recommendations) {
          await supabase.from("ai_optimization_recommendations").insert({
            client_id,
            platform: rec.entity_name?.includes("Meta") ? "meta" : platform || "google",
            vertical_id: vertical_id || null,
            recommendation_type: rec.type,
            entity_type: rec.entity_type,
            entity_name: rec.entity_name,
            severity: rec.severity,
            title: rec.title,
            description: rec.description,
            recommended_action: rec.recommended_action,
            projected_impact: rec.projected_impact,
            current_metrics: { aggregated: true },
          });
        }
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Action: list ───
    // Return existing stored recommendations
    if (action === "list") {
      let query = supabase
        .from("ai_optimization_recommendations")
        .select("*")
        .eq("client_id", client_id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (platform) query = query.eq("platform", platform);

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ recommendations: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Action: resolve ───
    if (action === "resolve") {
      const { recommendation_id } = await req.json();
      const { error } = await supabase
        .from("ai_optimization_recommendations")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", recommendation_id);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("campaign-recommendations error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
