import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id, ad_id, platform, campaign_name, format, current_copy } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch top-performing ads for this client
    const { data: topAds } = await supabaseAdmin
      .from("ad_campaigns")
      .select("campaign_name, spend, revenue, impressions, clicks, conversions, roas, bidding_strategy_type")
      .eq("client_id", client_id)
      .gt("spend", 0)
      .order("roas", { ascending: false })
      .limit(20);

    const topByRoas = (topAds || []).slice(0, 10);

    const { data: topByCtr } = await supabaseAdmin
      .from("ad_campaigns")
      .select("campaign_name, spend, impressions, clicks, conversions")
      .eq("client_id", client_id)
      .gt("impressions", 100)
      .order("clicks", { ascending: false })
      .limit(10);

    const performanceContext = [
      "TOP PERFORMERS BY ROAS:",
      ...topByRoas.map((a: any) => `- "${a.campaign_name}" ROAS: ${Number(a.roas || 0).toFixed(2)}x, Spend: $${Number(a.spend).toFixed(0)}, Revenue: $${Number(a.revenue).toFixed(0)}`),
      "",
      "TOP PERFORMERS BY ENGAGEMENT:",
      ...(topByCtr || []).map((a: any) => {
        const ctr = Number(a.impressions) > 0 ? (Number(a.clicks) / Number(a.impressions) * 100).toFixed(1) : "0";
        return `- "${a.campaign_name}" CTR: ${ctr}%, Clicks: ${a.clicks}`;
      }),
    ].join("\n");

    const adsAnalyzed = (topByRoas?.length || 0) + (topByCtr?.length || 0);

    const systemPrompt = `You are an expert performance marketing copywriter. You write ad copy that converts. 
You analyze historical ad performance data to identify winning patterns and generate copy that follows proven formulas.
Always return structured JSON with your copy options.`;

    const userPrompt = `Generate ad copy for a ${platform || "meta"} ad.
${campaign_name ? `Campaign: ${campaign_name}` : ""}
${format ? `Format: ${format}` : ""}
${current_copy?.primary_text ? `Current primary text: "${current_copy.primary_text}"` : ""}
${current_copy?.headline ? `Current headline: "${current_copy.headline}"` : ""}

Historical performance data for this client:
${performanceContext || "No historical data available yet."}

Generate 3 options each for Primary Text, Headline, and Description.
Each option should have a different angle (e.g., benefit-led, urgency, social proof).
Include reasoning referencing the performance data where relevant.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_copy_options",
            description: "Return structured ad copy options",
            parameters: {
              type: "object",
              properties: {
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string", enum: ["Primary Text", "Headline", "Description"] },
                      option_number: { type: "integer" },
                      text: { type: "string" },
                      reasoning: { type: "string" },
                    },
                    required: ["field", "option_number", "text", "reasoning"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["options"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_copy_options" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI error:", response.status, errText);
      throw new Error("AI generation failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let options = [];

    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      options = parsed.options || [];
    }

    // Log the generation
    await supabaseAdmin.from("ai_copy_generations").insert({
      client_id,
      trafficking_ad_id: ad_id || null,
      campaign_context: { platform, campaign_name, format },
      ads_analyzed: adsAnalyzed,
      generated_options: options,
    });

    return new Response(JSON.stringify({ options, ads_analyzed: adsAnalyzed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-ad-copy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
