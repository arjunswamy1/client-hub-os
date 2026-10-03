// Phase 4: Classifies free-form video feedback using Claude into a routing decision.
// Returns { category, affected_clips[], changes, estimated_cost, summary }.
// Categories: OVERLAY_EDIT, CAPTION_EDIT, TIMING_EDIT, VO_EDIT, MUSIC_EDIT, VISUAL_EDIT.
import { forcedToolCall } from "../_shared/lovable-ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOOL = {
  name: "classify_feedback",
  description: "Classify the user's video edit request into a single cheapest action.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["OVERLAY_EDIT", "CAPTION_EDIT", "TIMING_EDIT", "VO_EDIT", "MUSIC_EDIT", "VISUAL_EDIT", "UNKNOWN"],
        description:
          "OVERLAY_EDIT: change phone/CTA/disclaimer/end-card/static text overlay. " +
          "CAPTION_EDIT: change subtitle font/size/position/style/wording. " +
          "TIMING_EDIT: reorder, trim, or extend clip durations. " +
          "VO_EDIT: change narrator wording, voice, pace (regenerate VO only). " +
          "MUSIC_EDIT: change music volume, mood, or replace track. " +
          "VISUAL_EDIT: regenerate one Veo clip with a new prompt (most expensive).",
      },
      affected_clips: { type: "array", items: { type: "number" }, description: "Clip numbers affected, [] for global." },
      changes: {
        type: "object",
        description: "Concrete patch values keyed by category. Examples: {phone:'555-1234'}, {font_size:64}, {clip_5_duration:6}, {vo_segment:'New line'}, {music_volume:0.3}, {veo_prompt:'New prompt'}.",
      },
      summary: { type: "string", description: "One-line description for the user." },
    },
    required: ["category", "affected_clips", "changes", "summary"],
  },
} as const;

// Rough per-action estimates (USD).
const COST_TABLE: Record<string, number> = {
  OVERLAY_EDIT: 0.03,
  CAPTION_EDIT: 0.03,
  TIMING_EDIT: 0.03,
  MUSIC_EDIT: 0.03,
  VO_EDIT: 0.05,    // single-segment ElevenLabs regen + Shotstack
  VISUAL_EDIT: 3.50, // ~8s Veo @ ~$0.40/s + composite
  UNKNOWN: 0.03,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    const { project_id, feedback_text } = await req.json();
    if (!project_id || !feedback_text) return json({ error: "project_id and feedback_text required" }, 400);

    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("id, client_id, shot_list, vo_script, music_prompt, phone_overlay, cta_overlay, disclaimer_overlay, end_card_text").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);


    const shots = Array.isArray((project as any).shot_list) ? (project as any).shot_list : [];
    const shotSummary = shots.map((s: any) => `Clip ${s.clip_number}: ${s.label || ''} | ${s.duration_seconds}s | speaker=${s.speaker} | "${(s.dialogue || s.vo_segment || '').slice(0, 80)}"`).join("\n");

    const prompt = `You route ad-edit requests to the CHEAPEST possible action.

Project context:
- Phone overlay: "${(project as any).phone_overlay || '(none)'}"
- CTA overlay: "${(project as any).cta_overlay || '(none)'}"
- End card: "${(project as any).end_card_text || '(none)'}"
- Disclaimer: "${(project as any).disclaimer_overlay || '(none)'}"

Shot list:
${shotSummary}

User feedback:
"""
${feedback_text}
"""

Choose ONE category. Prefer the cheapest action that satisfies the feedback. Only choose VISUAL_EDIT if the user explicitly wants different visuals/footage that cannot be solved with overlays, captions, timing, audio, or VO.

REQUIRED key formats for "changes" by category:
- OVERLAY_EDIT: {phone, cta, disclaimer, end_card}
- CAPTION_EDIT: {font_size, words_per_chunk, background_opacity, fade_duration, style}
- MUSIC_EDIT: {music_volume (0..1), music_prompt}
- TIMING_EDIT: EITHER per-clip "clip_<N>_duration" (final length sec, 0.5-8) and/or "clip_<N>_trim_start" (skip sec from front), OR set affected_clips=[N] plus {trim_start, trim_end} describing seconds to REMOVE from the source clip. You may also set {order: [clip_numbers]} to reorder. Example: "cut seconds 4-8 of clip 2" → affected_clips=[2], changes={trim_start:4, trim_end:8}. "make clip 1 only 3 seconds" → changes={clip_1_duration:3}.
- VO_EDIT: {vo_script}
- VISUAL_EDIT: {veo_prompt} with affected_clips=[N]

Use the classify_feedback tool.`;

    const ai = await forcedToolCall({ prompt: prompt, tool: TOOL as any });
    logAiUsage({
      client_id: (project as any).client_id ?? null,
      surface: "classify-video-feedback",
      model: ai.model,
      input_tokens: ai.usage.input_tokens,
      output_tokens: ai.usage.output_tokens,
      cache_read_tokens: ai.usage.cached_tokens,
      cache_write_tokens: 0,
      metadata: { project_id },
    }).catch((e) => console.error("logAiUsage failed:", e));
    if (!ai.ok) {
      console.error("Lovable AI error:", ai.status, ai.error);
      return json({ error: "AI request failed", detail: ai.error }, ai.status === 402 || ai.status === 403 || ai.status === 429 ? ai.status : 500);
    }
    const toolUse = { input: ai.args };

    const out = toolUse.input as { category: string; affected_clips: number[]; changes: any; summary: string };
    const estimated_cost = COST_TABLE[out.category] ?? COST_TABLE.UNKNOWN;
    return json({ ...out, estimated_cost });
  } catch (e) {
    console.error("classify-video-feedback error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
