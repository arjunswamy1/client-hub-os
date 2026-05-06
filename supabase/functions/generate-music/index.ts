// Generate background music for an AI video project using ElevenLabs Music API.
// Uses the project's music_prompt (from the AI Director) and the target
// length, stores the MP3 in creative-assets, writes ai_video_audio row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logMediaGenUsage } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parsePermissionError(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail);
    const status = parsed?.detail?.status;
    const message = parsed?.detail?.message;
    if (status === "missing_permissions" && typeof message === "string") return message;
  } catch {
    // Non-JSON upstream errors are handled by the generic response below.
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const ELEVEN_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVEN_KEY) return json({ error: "ELEVENLABS_API_KEY not configured" }, 500);

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

    const { project_id, prompt_override, length_seconds_override } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const prompt = (prompt_override || project.music_prompt || "").toString().trim();
    if (!prompt) return json({ error: "No music_prompt on project — generate shot list first" }, 400);

    const lengthSec = Math.max(10, Math.min(180, length_seconds_override || project.target_length_seconds || 30));
    const version = project.current_version ?? 1;

    const musicRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        duration_seconds: lengthSec,
      }),
    });
    if (!musicRes.ok) {
      const t = await musicRes.text();
      console.error("ElevenLabs Music error:", musicRes.status, t);
      const permissionMessage = parsePermissionError(t);
      if (permissionMessage) {
        return json({
          error: "ElevenLabs API key is missing music-generation permission",
          detail: permissionMessage,
        }, 403);
      }
      return json({ error: "Music generation failed", detail: t.slice(0, 300) }, 500);
    }
    const audioBytes = new Uint8Array(await musicRes.arrayBuffer());

    const path = `ai-video/${project_id}/audio/music-v${version}-${Date.now()}.mp3`;
    const { error: upErr } = await admin.storage
      .from("creative-assets")
      .upload(path, audioBytes, { contentType: "audio/mpeg", upsert: true });
    if (upErr) return json({ error: "Storage upload failed", detail: upErr.message }, 500);
    const { data: pub } = admin.storage.from("creative-assets").getPublicUrl(path);

    const { data: row, error: insErr } = await admin
      .from("ai_video_audio")
      .insert({
        project_id,
        audio_type: "music",
        version,
        prompt,
        audio_url: pub.publicUrl,
        duration_ms: lengthSec * 1000,
      })
      .select("id, audio_url").single();
    if (insErr) return json({ error: insErr.message }, 500);

    // Cost tracking — ElevenLabs Music billed per second of generated audio.
    logMediaGenUsage({
      client_id: (project as any).client_id ?? null,
      service: "elevenlabs",
      surface: "ai-video-studio",
      model: "music",
      unit: "seconds",
      quantity: lengthSec,
      metadata: { project_id, audio_type: "music" },
    }).catch((e) => console.error("logMediaGenUsage failed:", e));

    return json({ ok: true, audio_id: row.id, audio_url: row.audio_url });
  } catch (e) {
    console.error("generate-music error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
