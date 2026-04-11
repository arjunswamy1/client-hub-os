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
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { keywords, client_id, vertical_id } = await req.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return new Response(
        JSON.stringify({ error: "No keywords provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = `You are a Google Ads quality score optimization expert.

Given the following keywords with low quality scores, provide specific recommendations to improve each.

For each keyword, analyze:
1. **Ad Relevance**: How to improve ad copy to match keyword intent
2. **Expected CTR**: Specific headline and description suggestions
3. **Landing Page Relevance**: Keyword-to-intent alignment issues
4. **Match Type**: Whether to tighten or broaden
5. **Negative Keywords**: Terms to exclude

Keywords data:
${JSON.stringify(keywords.slice(0, 20), null, 2)}

Respond with ONLY valid JSON:
{
  "summary": "Brief overall summary (1-2 sentences)",
  "recommendations": [
    {
      "keyword": "keyword text",
      "currentQS": 3,
      "issue": "Brief issue description",
      "suggestedHeadline": "New headline suggestion",
      "suggestedDescription": "New description suggestion",
      "suggestedNegatives": ["negative1", "negative2"],
      "matchTypeAdvice": "Match type recommendation",
      "priority": "High|Medium|Low",
      "estimatedImpact": "Expected improvement description"
    }
  ],
  "negativeKeywordSuggestions": ["broad negatives"],
  "adGroupRestructuring": ["restructuring suggestions"]
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
        max_tokens: 3000,
      }),
    });

    if (aiResponse.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limited — try again shortly" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (aiResponse.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted — please add funds" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI Gateway error [${aiResponse.status}]: ${errText.substring(0, 200)}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "";

    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("quality-score-audit error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
