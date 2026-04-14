import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { client_id, context } = await req.json();
    if (!client_id || !context) {
      return new Response(JSON.stringify({ error: "Missing client_id or context" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Build a prompt from the context
    const prompt = `You are an expert digital marketing strategist. Based on the following client onboarding data, generate a structured JSON summary.

Client Onboarding Data:
${JSON.stringify(context, null, 2)}

Generate a JSON object with these keys:
- business_summary: A 2-3 sentence summary of the client's business and goals
- key_risks: Array of 2-4 potential risks or challenges
- initial_strategy: A 2-3 sentence recommended initial campaign strategy
- recommended_platforms: Array of recommended advertising platforms based on their verticals
- priority_actions: Array of 3-5 immediate next steps

Return ONLY valid JSON, no markdown.`;

    // Call Lovable AI Gateway
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const response = await fetch("https://ai-gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    let aiSummary = null;
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      try {
        // Try to parse the AI response as JSON
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        aiSummary = JSON.parse(cleaned);
      } catch {
        aiSummary = { raw_summary: content };
      }
    }

    // Update client_context with AI summary
    if (aiSummary) {
      await supabase
        .from("client_context")
        .update({ ai_summary: aiSummary })
        .eq("client_id", client_id);
    }

    return new Response(JSON.stringify({ success: true, ai_summary: aiSummary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
