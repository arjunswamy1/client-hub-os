// AI Video Director — turns a creative brief into a winning ad: shot list with
// per-shot speaker assignment (in-scene dialogue vs. narrator VO), reusable
// character profiles, 3 hook variants, and music direction.
import { forcedToolCall } from "../_shared/lovable-ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/cost-tracking.ts";

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
  ad_framework?: string;
}

const FRAMEWORK_GUIDE: Record<string, string> = {
  PAS: "Problem → Agitate → Solve → CTA. Open on the pain, intensify it, reveal the product as relief, end with action.",
  AIDA: "Attention → Interest → Desire → Action. Open with a pattern interrupt, build curiosity, stoke desire, drive CTA.",
  HOOK_DRIVEN: "First 3 seconds = pattern interrupt hook (visual surprise + bold claim). Then proof, then offer, then CTA.",
  TESTIMONIAL: "Real-feeling person speaking to camera (UGC style). Their problem → their result → recommendation → CTA card.",
  BEFORE_AFTER: "Show the bad before-state, transition to the after-state via the product, end with social proof + CTA.",
};

async function fetchLandingPageSummary(url?: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 CPM-Bot" } });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return "";
  }
}

function buildPrompt(brief: Brief, landingSummary: string): string {
  const length = brief.target_length_seconds ?? 30;
  const numClips = Math.max(2, Math.round(length / 8));
  const framework = (brief.ad_framework ?? "PAS").toUpperCase();
  const frameworkInstr = FRAMEWORK_GUIDE[framework] ?? FRAMEWORK_GUIDE.PAS;
  const aspect = brief.aspect_ratio ?? "9:16";

  return `You are a world-class direct-response video advertising director. You write ads that win on Meta, TikTok, and YouTube — measured by hook rate, hold rate, and CTR.

You are producing a ${length}-second ${aspect} performance ad using the ${framework} framework:
${frameworkInstr}

BRIEF:
${JSON.stringify(brief, null, 2)}

${brief.freeform_brief ? `FREEFORM DIRECTION:\n${brief.freeform_brief}\n` : ""}
${landingSummary ? `LANDING PAGE CONTENT (truncated):\n${landingSummary}\n` : ""}

============================================================
CRITICAL RULES — read carefully, these determine if the ad works:
============================================================

1. CHARACTERS (consistency is everything)
   - Define 1–3 named characters in the "characters" array (e.g. "daughter", "mother", "technician").
   - Each character needs a vivid, repeatable visual description: ethnicity, age, hair, build, signature wardrobe, distinguishing features.
   - In every shot that features a character, repeat their full description in the veo_prompt — Veo has no memory between clips, so repetition = consistency.

2. DIALOGUE vs. NARRATOR VO (this is the most important rule)
   - Veo 3.1 generates SYNCHRONIZED LIP-SYNCED DIALOGUE natively. Use it.
   - For each shot, set "speaker" to one of:
       * "narrator_vo"  → off-camera narrator. Add the line to "vo_segment". Do NOT mention the line in veo_prompt.
       * "<character_name>"  → the named on-screen character speaks. Add the EXACT spoken line to "dialogue". Embed it in veo_prompt like:  Daughter says with worried tone: "How are we supposed to pay for that?". Set vo_segment to "" (empty).
       * "none"  → silent shot (b-roll, montage). vo_segment and dialogue both empty.
   - NEVER write speaker labels ("Daughter:", "Mother:") inside vo_segment or dialogue text.

3. ANTI-CAPTION (mandatory)
   - Every veo_prompt must end with: "(no on-screen text, no subtitles, no captions, no watermarks, no UI overlays)".
   - Veo will burn-in captions unless you explicitly forbid them.

4. CINEMATOGRAPHY (every veo_prompt must include)
   - Subject + specific action
   - Named character description (re-stated every shot)
   - Camera: shot size + movement (e.g. "medium close-up, slow push-in", "handheld over-shoulder", "static wide")
   - Lighting: e.g. "warm golden hour through window", "harsh midday sun", "soft north-facing window light"
   - Setting + props
   - Lens/style: "shot on ARRI Alexa, 35mm, shallow depth of field, anamorphic, photoreal"
   - Aspect: "${aspect}"
   - End with: "Photorealistic, cinematic. (no on-screen text, no subtitles, no captions, no watermarks, no UI overlays)"

5. PACING
   - Clip 1 = HOOK. Pattern interrupt in first 1.5s. Make the viewer stop scrolling.
   - Clips 2..N-1 = problem → agitate → solve.
   - Final clip = product/CTA payoff. Hold the offer on screen.

6. HOOK VARIANTS (3 of them, mandatory)
   - Generate 3 different cold-open lines for clip 1, each <= 9 words.
   - Each must be a different angle: question hook, contrarian/shocking hook, story hook.

7. TEXT_OVERLAY
   - Optional, max 3 words, ALL CAPS power words only (e.g. "SHOCKED", "STOP PAYING", "WATCH THIS"). Most shots = empty.

8. MUSIC PROMPT
   - Genre, BPM, energy arc, mood. Should match framework: PAS = tense → resolved; HOOK_DRIVEN = punchy from frame 1.

9. TRANSITIONS (assign one per shot, applied between THIS shot and the NEXT)
   - "hard_cut" — DEFAULT. Use for hooks, pattern interrupts, comedic beats, energetic talking-head edits. Most shots.
   - "j_cut" — next clip's audio (VO/dialogue) starts ~0.3s BEFORE its video. Use when narration continues across a visual change ("...and that's why" [cut to product]). Smooths talky stretches.
   - "l_cut" — current clip's audio bleeds ~0.5s INTO the next clip's video. Use for emotional reactions or to overlap dialogue with cutaways. Pairs well with shots that end on a beat the listener should sit with.
   - "fade_black" — full ~0.4s dip to black. ONLY for major scene/time/location changes (e.g. before-and-after, day→night). Never between consecutive talking-head shots.
   - The FINAL shot's transition is ignored.

Use the "generate_shot_list" tool to return the result. Produce EXACTLY ${numClips} shots, each ~${Math.round(length/numClips)} seconds. No prose outside the tool call.`;
}

const TOOL = {
  name: "generate_shot_list",
  description: "Returns a structured ad: characters, hooks, shot list, narrator VO script, music direction.",
  input_schema: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        description: "Named on-screen characters with persistent visual descriptions.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "lowercase id, e.g. 'daughter'" },
            description: { type: "string", description: "full visual description, repeated in every shot they appear in" },
            voice_direction: { type: "string", description: "voice tone, e.g. 'worried american female, mid-30s'" },
          },
          required: ["name", "description"],
        },
      },
      hook_variants: {
        type: "array",
        description: "Exactly 3 cold-open lines for clip 1, each a different angle (question / contrarian / story).",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", enum: ["question", "contrarian", "story"] },
            line: { type: "string" },
          },
          required: ["angle", "line"],
        },
      },
      shot_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clip_number: { type: "number" },
            label: { type: "string", description: "Story beat, e.g. 'HOOK', 'PROBLEM', 'AGITATE', 'SOLVE', 'CTA'" },
            speaker: { type: "string", description: "'narrator_vo' | character name | 'none'" },
            dialogue: { type: "string", description: "Exact spoken line if speaker is a character; empty otherwise." },
            vo_segment: { type: "string", description: "Narrator line if speaker='narrator_vo'; empty otherwise." },
            veo_prompt: { type: "string" },
            text_overlay: { type: "string" },
            duration_seconds: { type: "number" },
            transition_type: { type: "string", enum: ["hard_cut", "j_cut", "l_cut", "fade_black"], description: "Transition INTO the next shot. Default hard_cut." },
          },
          required: ["clip_number", "veo_prompt", "duration_seconds", "speaker"],
        },
      },
      music_prompt: { type: "string" },
    },
    required: ["characters", "hook_variants", "shot_list", "music_prompt"],
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


    const ai = await forcedToolCall({ prompt: userPrompt, tool: TOOL as any });
    logAiUsage({
      client_id: (project as any).client_id ?? null,
      surface: "ai-video-director",
      model: ai.model,
      input_tokens: ai.usage.input_tokens,
      output_tokens: ai.usage.output_tokens,
      cache_read_tokens: ai.usage.cached_tokens,
      cache_write_tokens: 0,
      metadata: { project_id, framework: (project as any).ad_framework },
    }).catch((e) => console.error("logAiUsage failed:", e));
    if (!ai.ok) {
      console.error("Lovable AI error:", ai.status, ai.error);
      return json({ error: "AI request failed", detail: ai.error }, ai.status === 402 || ai.status === 403 || ai.status === 429 ? ai.status : 500);
    }
    const toolUse = { input: ai.args };

    const out = toolUse.input as {
      characters: any[]; hook_variants: any[]; shot_list: any[]; music_prompt: string;
    };

    // Build narrator-only vo_script (filter out dialogue shots)
    const voScript = (out.shot_list || [])
      .filter((s: any) => s.speaker === "narrator_vo" && s.vo_segment?.trim())
      .map((s: any) => s.vo_segment.trim())
      .join(" ");

    const { error: updErr } = await supabase
      .from("ai_video_projects")
      .update({
        characters: out.characters ?? [],
        hook_variants: out.hook_variants ?? [],
        selected_hook_index: 0,
        shot_list: out.shot_list ?? [],
        vo_script: voScript,
        music_prompt: out.music_prompt,
        overlay_plan: [],
        landing_page_analysis: landingSummary ? { length: landingSummary.length, summary: landingSummary.slice(0, 500) } : null,
        status: "shot_list_review",
      })
      .eq("id", project_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, ...out, vo_script: voScript });
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
