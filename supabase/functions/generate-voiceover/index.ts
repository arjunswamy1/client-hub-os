// Generate per-shot voiceover audio for an AI video project.
// Produces ONE MP3 per narrator shot so the compose step can place each
// segment exactly during its own clip — never overlapping Veo's native
// in-scene character dialogue. Segments are stored under settings.segments.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logMediaGenUsage } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Jessica — friendly American female
const MODEL_ID = "eleven_multilingual_v2";

function parsePermissionError(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail);
    const status = parsed?.detail?.status;
    const message = parsed?.detail?.message;
    if (status === "missing_permissions" && typeof message === "string") return message;
  } catch { /* ignore */ }
  return null;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function cleanLine(text: string): string {
  return String(text)
    .replace(/\b(Daughter|Mother|Father|Son|Narrator|Voiceover|VO|Speaker\s*\d*)\s*:/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateSpeechDuration(text: string, fallbackSeconds: number): number {
  const words = cleanLine(text).split(/\s+/).filter(Boolean).length;
  const punctuationPauses = (text.match(/[,.!?;:]/g) || []).length * 0.12;
  const estimated = words / 2.55 + punctuationPauses + 0.15;
  const cap = Number.isFinite(fallbackSeconds) && fallbackSeconds > 0 ? fallbackSeconds : 8;
  return Math.round(Math.min(cap, Math.max(0.7, estimated)) * 100) / 100;
}

async function tts(text: string, voiceId: string, key: string): Promise<Uint8Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.0 },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    const perm = parsePermissionError(t);
    throw new Error(perm ?? `ElevenLabs TTS ${res.status}: ${t.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
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

    const { project_id, voice_id } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const shots: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
    const narratorShots = shots
      .filter((s) => s?.speaker === "narrator_vo" && cleanLine(s?.vo_segment || ""))
      .map((s) => ({
        clip_number: Number(s.clip_number),
        text: cleanLine(s.vo_segment),
        duration_seconds: estimateSpeechDuration(s.vo_segment, Number(s.duration_seconds) || 8),
      }));

    if (narratorShots.length === 0) {
      return json({
        ok: true,
        skipped: true,
        reason: "No narrator voiceover needed — all dialogue is in-scene (Veo native).",
      });
    }

    const voiceId = voice_id || project.vo_voice_id || DEFAULT_VOICE_ID;
    const version = project.current_version ?? 1;

    // Generate one MP3 per narrator shot in parallel.
    const segments: { clip_number: number; audio_url: string; text: string; chars: number; duration_seconds: number }[] = [];
    let totalChars = 0;

    const results = await Promise.allSettled(narratorShots.map(async (shot) => {
      const bytes = await tts(shot.text, voiceId, ELEVEN_KEY);
      const path = `ai-video/${project_id}/audio/vo-v${version}-clip${shot.clip_number}-${Date.now()}.mp3`;
      const { error: upErr } = await admin.storage
        .from("creative-assets")
        .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: pub } = admin.storage.from("creative-assets").getPublicUrl(path);
      return { clip_number: shot.clip_number, audio_url: pub.publicUrl, text: shot.text, chars: shot.text.length, duration_seconds: shot.duration_seconds };
    }));

    for (const r of results) {
      if (r.status === "fulfilled") {
        segments.push(r.value);
        totalChars += r.value.chars;
      } else {
        console.error("Segment failed:", r.reason);
      }
    }
    if (segments.length === 0) {
      return json({ error: "All voiceover segments failed", detail: String((results[0] as any)?.reason ?? "") }, 500);
    }
    segments.sort((a, b) => a.clip_number - b.clip_number);

    // Replace any existing voiceover row for this version.
    await admin.from("ai_video_audio")
      .delete()
      .eq("project_id", project_id).eq("version", version).eq("audio_type", "voiceover");

    const combinedScript = segments.map((s) => s.text).join(" ");
    const { data: row, error: insErr } = await admin
      .from("ai_video_audio")
      .insert({
        project_id,
        audio_type: "voiceover",
        version,
        elevenlabs_voice_id: voiceId,
        elevenlabs_model: MODEL_ID,
        script_text: combinedScript,
        // First segment URL kept in audio_url for backwards-compat preview;
        // compose-video reads settings.segments for true per-shot placement.
        audio_url: segments[0].audio_url,
        settings: {
          stability: 0.55, similarity_boost: 0.8, style: 0.35, speed: 1.0,
          per_shot: true,
          segments,
        },
      })
      .select("id, audio_url").single();
    if (insErr) return json({ error: insErr.message }, 500);

    await admin.from("ai_video_projects")
      .update({ vo_voice_id: voiceId })
      .eq("id", project_id);

    logMediaGenUsage({
      client_id: (project as any).client_id ?? null,
      service: "elevenlabs",
      surface: "ai-video-studio",
      model: MODEL_ID,
      unit: "characters",
      quantity: totalChars,
      metadata: { project_id, voice_id: voiceId, audio_type: "voiceover", segments: segments.length },
    }).catch((e) => console.error("logMediaGenUsage failed:", e));

    return json({ ok: true, audio_id: row.id, segments: segments.length });
  } catch (e) {
    console.error("generate-voiceover error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
