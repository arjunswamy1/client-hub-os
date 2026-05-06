// Generate a single Veo 3.1 clip via the Gemini API.
// Kicks off generation, returns 202 immediately, and runs the long-running
// poll/download/upload in the background via EdgeRuntime.waitUntil.
// Frontend polls the ai_video_clips row to observe status transitions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logMediaGenUsage } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VEO_MODEL = "veo-3.1-generate-preview";
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function aspectToVeo(aspect?: string): string {
  if (!aspect) return "9:16";
  if (aspect === "1:1") return "9:16";
  return aspect;
}

// @ts-ignore - EdgeRuntime is provided by Supabase edge runtime
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

function classifyError(status: number | null, raw: string): { code: string; message: string } {
  const text = (raw || "").toLowerCase();
  if (status === 429 || text.includes("resource_exhausted") || text.includes("quota") || text.includes("prepayment")) {
    return { code: "out_of_credits", message: "Google AI Studio prepayment credits depleted. Add credits at ai.studio/projects, then retry." };
  }
  if (status === 401 || status === 403 || text.includes("api key") || text.includes("permission")) {
    return { code: "auth", message: "Gemini API key invalid or missing Veo access." };
  }
  if (text.includes("safety") || text.includes("blocked") || text.includes("policy")) {
    return { code: "safety_block", message: "Prompt blocked by Veo safety filters. Edit the prompt and retry." };
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return { code: "timeout", message: "Veo generation timed out (>10 min). Retry the clip." };
  }
  if (status && status >= 500) {
    return { code: "upstream_5xx", message: `Veo upstream error (${status}). Retry in a moment.` };
  }
  return { code: "unknown", message: raw?.slice(0, 500) || "Unknown error" };
}

async function failClip(admin: any, clipId: string, code: string, message: string) {
  await admin.from("ai_video_clips").update({
    status: "failed",
    error_code: code,
    error_message: message,
    failed_at: new Date().toISOString(),
    progress_pct: 0,
    progress_message: `Failed: ${message}`,
    progress_updated_at: new Date().toISOString(),
  }).eq("id", clipId);
}

async function progress(admin: any, clipId: string, pct: number, message: string) {
  try {
    await admin.from("ai_video_clips").update({
      progress_pct: Math.max(0, Math.min(100, Math.round(pct))),
      progress_message: message,
      progress_updated_at: new Date().toISOString(),
    }).eq("id", clipId);
  } catch (e) {
    console.error("progress update failed:", e);
  }
}

async function runVeoJob(params: {
  admin: ReturnType<typeof createClient>;
  GEMINI_API_KEY: string;
  clipId: string;
  project_id: string;
  client_id: string | null;
  version: number;
  clip_number: number;
  prompt: string;
  aspect: string;
  duration_seconds: number;
}) {
  const { admin, GEMINI_API_KEY, clipId, project_id, client_id, version, clip_number, prompt, aspect, duration_seconds } = params;
  try {
    await progress(admin, clipId, 5, "Submitting prompt to Veo…");
    const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_API_KEY}`;
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: aspect, resolution: "1080p", personGeneration: "allow_all" },
      }),
    });
    if (!startRes.ok) {
      const t = await startRes.text();
      console.error("Veo start error:", startRes.status, t);
      const { code, message } = classifyError(startRes.status, t);
      await failClip(admin, clipId, code, message);
      return;
    }
    const startData = await startRes.json();
    const opName: string | undefined = startData.name;
    if (!opName) {
      await failClip(admin, clipId, "no_operation", "Veo did not return an operation name.");
      return;
    }
    await progress(admin, clipId, 15, "Veo job queued. Waiting for render…");

    const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`;
    const startedAt = Date.now();
    let opData: any = null;
    let lastReportedPct = 15;
    // Estimate render time: ~25s per second of generated video, capped at MAX_POLL_MS.
    const estMs = Math.min(MAX_POLL_MS, Math.max(60_000, duration_seconds * 25_000));
    while (Date.now() - startedAt < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const elapsed = Date.now() - startedAt;
      // Map elapsed/estMs into 15..80 range so progress feels live.
      const elapsedPct = Math.min(80, 15 + Math.round((elapsed / estMs) * 65));
      if (elapsedPct > lastReportedPct + 4) {
        await progress(admin, clipId, elapsedPct, `Rendering with Veo… ${Math.round(elapsed / 1000)}s elapsed`);
        lastReportedPct = elapsedPct;
      }
      const pr = await fetch(pollUrl);
      if (!pr.ok) continue;
      const pd = await pr.json();
      if (pd.done) { opData = pd; break; }
    }
    if (!opData) {
      console.error("Veo poll timeout", opName);
      await failClip(admin, clipId, "timeout", "Veo generation timed out (>10 min). Retry the clip.");
      return;
    }
    if (opData.error) {
      console.error("Veo op error:", opData.error);
      const msg = typeof opData.error === "string" ? opData.error : JSON.stringify(opData.error);
      const { code, message } = classifyError(opData.error?.code ?? null, msg);
      await failClip(admin, clipId, code, message);
      return;
    }
    await progress(admin, clipId, 85, "Render complete. Downloading video…");

    const generated =
      opData.response?.generateVideoResponse?.generatedSamples ??
      opData.response?.generatedVideos ??
      opData.response?.videos ?? [];
    const first = generated[0];
    const videoUri: string | undefined = first?.video?.uri || first?.videoUri || first?.video?.videoUri;
    const inlineB64: string | undefined = first?.video?.inlineData?.data || first?.bytesBase64Encoded;

    let videoBytes: Uint8Array | null = null;
    if (videoUri) {
      const sep = videoUri.includes("?") ? "&" : "?";
      const dl = await fetch(`${videoUri}${sep}key=${GEMINI_API_KEY}`);
      if (!dl.ok) {
        const t = await dl.text();
        console.error("Veo download failed:", t);
        const { code, message } = classifyError(dl.status, t);
        await failClip(admin, clipId, code, message);
        return;
      }
      videoBytes = new Uint8Array(await dl.arrayBuffer());
    } else if (inlineB64) {
      const bin = atob(inlineB64);
      videoBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) videoBytes[i] = bin.charCodeAt(i);
    } else {
      console.error("No video in response", opData.response);
      await failClip(admin, clipId, "no_video", "Veo finished but returned no video data. Likely safety-filtered. Edit the prompt and retry.");
      return;
    }

    await progress(admin, clipId, 92, "Uploading to storage…");
    const path = `ai-video/${project_id}/clips/v${version}/clip-${clip_number}-${Date.now()}.mp4`;
    const { error: upErr } = await admin.storage
      .from("creative-assets")
      .upload(path, videoBytes, { contentType: "video/mp4", upsert: true });
    if (upErr) {
      console.error("Storage upload failed:", upErr.message);
      await failClip(admin, clipId, "storage", `Storage upload failed: ${upErr.message}`);
      return;
    }
    const { data: pub } = admin.storage.from("creative-assets").getPublicUrl(path);

    await admin.from("ai_video_clips").update({
      generated_options: [{ url: pub.publicUrl, source: "veo", generated_at: new Date().toISOString() }],
      selected_option_index: 0,
      status: "generated",
      error_code: null,
      error_message: null,
      failed_at: null,
      progress_pct: 100,
      progress_message: "Done",
      progress_updated_at: new Date().toISOString(),
    }).eq("id", clipId);

    // Cost tracking — Veo billed per second of generated video.
    logMediaGenUsage({
      client_id,
      service: "google_veo",
      surface: "ai-video-studio",
      model: VEO_MODEL,
      unit: "seconds",
      quantity: duration_seconds,
      metadata: { project_id, clip_number, aspect },
    }).catch((e) => console.error("logMediaGenUsage failed:", e));
  } catch (e) {
    console.error("runVeoJob error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    const { code, message } = classifyError(null, msg);
    await failClip(admin, clipId, code, message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    const { project_id, clip_number } = await req.json();
    if (!project_id || typeof clip_number !== "number") {
      return json({ error: "project_id and clip_number required" }, 400);
    }

    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const shots: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
    const shot = shots.find((s) => Number(s.clip_number) === Number(clip_number));
    if (!shot) return json({ error: `Shot ${clip_number} not found in shot_list` }, 404);

    const aspect = aspectToVeo(project.aspect_ratio);
    const version = project.current_version ?? 1;

    // Inject character descriptions and anti-caption guard if the director omitted them.
    const characters: any[] = Array.isArray(project.characters) ? project.characters : [];
    let prompt: string = String(shot.veo_prompt || "");
    if (shot.speaker && shot.speaker !== "narrator_vo" && shot.speaker !== "none") {
      const ch = characters.find((c) => c?.name?.toLowerCase() === String(shot.speaker).toLowerCase());
      if (ch && !prompt.toLowerCase().includes(String(ch.description).slice(0, 30).toLowerCase())) {
        prompt = `${ch.description}. ${prompt}`;
      }
      if (shot.dialogue && !prompt.includes(shot.dialogue)) {
        const tone = ch?.voice_direction ? ` (${ch.voice_direction})` : "";
        prompt = `${prompt} The character speaks${tone} with natural lip sync, saying: "${shot.dialogue}".`;
      }
    }
    const ANTI_CAPTION = "(no on-screen text of any kind: no subtitles, no captions, no watermarks, no UI overlays, no headlines, no phone numbers, no legal disclaimer text, no fine-print paragraphs, no lorem ipsum, no fake or scrambled text. Any required text will be added in post-production.)";
    if (!prompt.toLowerCase().includes("no subtitles") && !prompt.toLowerCase().includes("no captions")) {
      prompt = `${prompt} ${ANTI_CAPTION}`;
    }

    const baseRow = {
      project_id,
      version,
      clip_number,
      veo_prompt: prompt,
      veo_model: VEO_MODEL,
      veo_aspect_ratio: aspect,
      veo_resolution: "1080p",
      vo_text: shot.dialogue || shot.vo_segment || null,
      text_overlay: shot.text_overlay ? { text: shot.text_overlay } : null,
      status: "generating",
      error_code: null,
      error_message: null,
      failed_at: null,
      progress_pct: 1,
      progress_message: "Queued — starting Veo job…",
      progress_updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    };

    const { data: existing } = await admin
      .from("ai_video_clips")
      .select("id")
      .eq("project_id", project_id).eq("version", version).eq("clip_number", clip_number)
      .maybeSingle();

    let clipId: string;
    if (existing) {
      clipId = (existing as any).id;
      await admin.from("ai_video_clips").update(baseRow).eq("id", clipId);
    } else {
      const { data: ins, error: insErr } = await admin
        .from("ai_video_clips").insert(baseRow).select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      clipId = (ins as any).id;
    }

    await admin.from("ai_video_projects").update({ status: "generating" }).eq("id", project_id);

    const durationSec = Number(shot.duration_seconds) > 0 ? Number(shot.duration_seconds) : 8;
    EdgeRuntime.waitUntil(runVeoJob({
      admin, GEMINI_API_KEY, clipId, project_id,
      client_id: (project as any).client_id ?? null,
      version, clip_number, prompt, aspect,
      duration_seconds: durationSec,
    }));

    return json({ ok: true, clip_id: clipId, status: "generating" }, 202);
  } catch (e) {
    console.error("generate-veo-clip error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
