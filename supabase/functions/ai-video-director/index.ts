// AI Video Director — turns a creative brief into a shot list, VO script,
// music direction, and text-overlay plan using Claude.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropic } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Brief {
  title?: string;
  vertical?: string;
  objective?: string;
  target_audience?: string;
  key_message?: string;
  cta?: string;
  landing_page_url?: string;
  tone_mood?: string[];
  visual_style?: string[];
  target_length_seconds?: number;
  target_platforms?: string[];
  aspect_ratio?: string;
  reference_video_urls?: string[];
  reference_image_urls?: string[];
  additional_direction?: string;
  freeform_brief?: string;
}

async function fetchLandingPageSummary(url?: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 CPM-Bot" } });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

function buildPrompt(brief: Brief, landingSummary: string): string {
  const length = brief.target_length_seconds ?? 30;
  const numClips = Math.max(2, Math.round(length / 8));
  return `You are an elite AI Video Director producing a ${length}-second performance ad.

BRIEF (structured):
${JSON.stringify(brief, null, 2)}

${brief.freeform_brief ? `FREEFORM DIRECTION:\n${brief.freeform_brief}\n` : ""}
${landingSummary ? `LANDING PAGE CONTENT (truncated):\n${landingSummary}\n` : ""}

Produce a shot list of EXACTLY ${numClips} clips, each 8 seconds. Each Veo prompt must include:
- subject + action
- camera direction (close-up, wide, tracking, overhead, etc.)
- lighting (golden hour, studio, natural daylight, dramatic side-light, etc.)
- cinematic descriptors (shallow depth of field, rack focus, slow-motion if needed)
- aspect ratio reminder ("${brief.aspect_ratio ?? "9:16"} portrait/landscape")
- the word "realistic" at the end

Use the "generate_shot_list" tool to return the result. Do NOT include any prose outside the tool call.`;
}

const TOOL = {
  name: "generate_shot_list",
  description: "Returns a structured shot list, VO script, music direction, and overlay plan.",
  input_schema: {
    type: "object",
    properties: {
      shot_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clip_number: { type: "number" },
            label: { type: "string", description: "Short label like 'THE PROBLEM'" },
            veo_prompt: { type: "string" },
            text_overlay: { type: "string" },
            vo_segment: { type: "string" },
            duration_seconds: { type: "number" },
          },
          required: ["clip_number", "veo_prompt", "vo_segment", "duration_seconds"],
        },
      },
      vo_script: { type: "string", description: "Full VO script joined together with natural pacing." },
      music_prompt: { type: "string", description: "ElevenLabs Music prompt — genre, energy, tempo, mood." },
      overlay_plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clip_number: { type: "number" },
            text: { type: "string" },
            position: { type: "string", enum: ["top", "center", "bottom"] },
            animation: { type: "string", enum: ["fade", "slide_up", "pop", "none"] },
            appear_at_ms: { type: "number" },
            disappear_at_ms: { type: "number" },
          },
          required: ["clip_number", "text", "position"],
        },
      },
    },
    required: ["shot_list", "vo_script", "music_prompt", "overlay_plan"],
  },
} as const;

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

    const { project_id } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    const { data: project, error: projErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (projErr || !project) return json({ error: "Project not found" }, 404);

    const landingSummary = await fetchLandingPageSummary(project.landing_page_url);
    const userPrompt = buildPrompt(project as Brief, landingSummary);

    // Call Claude with the structured tool
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY missing" }, 500);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "generate_shot_list" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("Claude error:", res.status, t);
      return json({ error: "AI Director failed", detail: t.slice(0, 500) }, 500);
    }
    const data = await res.json();
    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!toolUse) return json({ error: "No tool_use in response" }, 500);

    const out = toolUse.input as {
      shot_list: any[]; vo_script: string; music_prompt: string; overlay_plan: any[];
    };

    // Persist to project
    const { error: updErr } = await supabase
      .from("ai_video_projects")
      .update({
        shot_list: out.shot_list,
        vo_script: out.vo_script,
        music_prompt: out.music_prompt,
        overlay_plan: out.overlay_plan,
        landing_page_analysis: landingSummary ? { length: landingSummary.length, summary: landingSummary.slice(0, 500) } : null,
        status: "shot_list_review",
      })
      .eq("id", project_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, ...out });
  } catch (e) {
    console.error("ai-video-director error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
