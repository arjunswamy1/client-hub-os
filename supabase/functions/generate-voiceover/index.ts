// Generate the full voiceover for an AI video project using ElevenLabs TTS.
// Uses the project's vo_script (from the AI Director) and stores the MP3
// in the creative-assets bucket, then writes a row to ai_video_audio.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — confident male
const MODEL_ID = "eleven_multilingual_v2";

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const { project_id, voice_id, script_override } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const script = (script_override || project.vo_script || "").toString().trim();
    if (!script) return json({ error: "No vo_script on project — generate shot list first" }, 400);

    const voiceId = voice_id || project.vo_voice_id || DEFAULT_VOICE_ID;
    const version = project.current_version ?? 1;

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true, speed: 1.0 },
        }),
      },
    );
    if (!ttsRes.ok) {
      const t = await ttsRes.text();
      console.error("ElevenLabs TTS error:", ttsRes.status, t);
      return json({ error: "TTS failed", detail: t.slice(0, 300) }, 500);
    }
    const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());

    const path = `ai-video/${project_id}/audio/voiceover-v${version}-${Date.now()}.mp3`;
    const { error: upErr } = await admin.storage
      .from("creative-assets")
      .upload(path, audioBytes, { contentType: "audio/mpeg", upsert: true });
    if (upErr) return json({ error: "Storage upload failed", detail: upErr.message }, 500);
    const { data: pub } = admin.storage.from("creative-assets").getPublicUrl(path);

    const { data: row, error: insErr } = await admin
      .from("ai_video_audio")
      .insert({
        project_id,
        audio_type: "voiceover",
        version,
        elevenlabs_voice_id: voiceId,
        elevenlabs_model: MODEL_ID,
        script_text: script,
        audio_url: pub.publicUrl,
        settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, speed: 1.0 },
      })
      .select("id, audio_url").single();
    if (insErr) return json({ error: insErr.message }, 500);

    await admin.from("ai_video_projects")
      .update({ vo_voice_id: voiceId })
      .eq("id", project_id);

    return json({ ok: true, audio_id: row.id, audio_url: row.audio_url });
  } catch (e) {
    console.error("generate-voiceover error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
