import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { script, platform, duration, brand_context, objective, target_audience, tone_style } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an elite creative director and direct-response copywriter specializing in paid media video ads. Your job is to take a rough script and transform it into a polished, high-converting video ad script.

CRITICAL RULES:
- Maintain the core message and angle of the original script
- Optimize for the specific platform and video duration
- Use proven direct-response frameworks: pattern interrupt → problem → agitation → solution → CTA
- Write in a conversational, authentic tone — avoid sounding like a corporate robot
- Include specific timing cues (e.g., "0-3s", "3-10s") for the editor/designer
- Include visual direction notes for each section
- The first 3 seconds MUST be a scroll-stopping hook
- End with a clear, urgent CTA
- Match the tone/style if provided

PLATFORM-SPECIFIC GUIDANCE:
- Meta (Facebook/Instagram): Hook in first 1-2 seconds. 15-30s optimal. Captions essential. Vertical (9:16) for Stories/Reels, square or 4:5 for feed.
- YouTube: Can be longer (30s-2min). First 5 seconds must hook before skip button. Include branded elements.
- TikTok: Native, authentic feel. 15-60s. Fast cuts. Trending audio consideration. UGC-style performs best.
- Google Display/Pre-roll: 6s bumper or 15s non-skippable. Get to the point FAST.

OUTPUT FORMAT:
Return the enhanced script in this exact structure:
1. "Straight Script" — the full voiceover/dialogue as continuous text
2. Timed sections with:
   - Time range (e.g., "0-3s")
   - Section label (Opening/Mid/Promo/CTA)
   - Voice direction
   - Visual direction
   - Text overlay suggestions`;

    const userPrompt = `Please enhance this video ad script:

ORIGINAL SCRIPT:
${script}

PLATFORM: ${platform || 'Meta'}
TARGET DURATION: ${duration || '15 seconds'}
${brand_context ? `BRAND CONTEXT: ${brand_context}` : ''}
${objective ? `OBJECTIVE: ${objective}` : ''}
${target_audience ? `TARGET AUDIENCE: ${target_audience}` : ''}
${tone_style ? `TONE/STYLE: ${tone_style}` : ''}

Enhance this script to maximize engagement, conversions, and stopping power. Keep the same angle and core message but make it sharper, more compelling, and optimized for ${platform || 'Meta'}.`;

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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const enhanced = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ enhanced_script: enhanced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("enhance-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
