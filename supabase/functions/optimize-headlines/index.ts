import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { keyword, matchType, qualityScore, currentHeadlines, currentDescriptions, campaignName, adGroupName, customPrompt } = await req.json();

    const systemPrompt = `You are a Google Ads optimization expert specializing in Quality Score improvement.
Your job is to analyze a keyword's current ad copy and suggest improved headlines and descriptions that will boost Quality Score.

Quality Score is determined by:
1. Expected CTR - How likely your ad is to be clicked
2. Ad Relevance - How closely your ad matches the searcher's intent
3. Landing Page Experience - How relevant and useful your landing page is

Focus on:
- Including the exact keyword or close variants in headlines
- Creating compelling, specific headlines that match search intent
- Using strong calls to action
- Ensuring headlines are distinct from each other (not repetitive)
- Following Google Ads character limits: Headlines max 30 chars, Descriptions max 90 chars
- Using emotional triggers and urgency where appropriate
- Including numbers/stats when relevant`;

    let userPrompt = `Analyze this keyword and its current ads, then suggest optimized headlines and descriptions to improve Quality Score.

**Keyword:** "${keyword}"
**Match Type:** ${matchType || "broad"}
**Current Quality Score:** ${qualityScore != null ? `${qualityScore}/10` : "Unknown"}
**Campaign:** ${campaignName || "N/A"}
**Ad Group:** ${adGroupName || "N/A"}

**Current Headlines:**
${currentHeadlines?.length ? currentHeadlines.map((h: string, i: number) => `${i + 1}. ${h}`).join("\n") : "No headlines found"}

**Current Descriptions:**
${currentDescriptions?.length ? currentDescriptions.map((d: string, i: number) => `${i + 1}. ${d}`).join("\n") : "No descriptions found"}

Please provide:
1. Analysis of why the current Quality Score may be low
2. 5 optimized headline suggestions (max 30 chars each)
3. 3 optimized description suggestions (max 90 chars each)
4. Specific tips to improve this keyword's QS

Format your response as JSON using the tool provided.`;

    if (customPrompt) {
      userPrompt += `\n\n**IMPORTANT — Additional direction from the media buyer:**\n${customPrompt}\n\nMake sure your headline and description suggestions strongly reflect the above direction while still optimizing for Quality Score.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "headline_suggestions",
              description: "Return optimized headline and description suggestions for improving Quality Score.",
              parameters: {
                type: "object",
                properties: {
                  analysis: {
                    type: "string",
                    description: "Brief analysis of why Quality Score is low and what to improve",
                  },
                  headlines: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string", description: "Headline text, max 30 characters" },
                        rationale: { type: "string", description: "Why this headline will improve QS" },
                      },
                      required: ["text", "rationale"],
                    },
                  },
                  descriptions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string", description: "Description text, max 90 characters" },
                        rationale: { type: "string", description: "Why this description will improve QS" },
                      },
                      required: ["text", "rationale"],
                    },
                  },
                  tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "Actionable tips to improve Quality Score for this keyword",
                  },
                },
                required: ["analysis", "headlines", "descriptions", "tips"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "headline_suggestions" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No suggestions returned" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suggestions = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("optimize-headlines error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
