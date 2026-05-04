// Generate a single Veo 3.1 clip via the Gemini API.
// Long-running: kicks off the operation, polls until done (or up to ~8 min),
// downloads the MP4, uploads to the `creative-assets` bucket, and stores
// the public URL on the matching ai_video_clips row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VEO_MODEL = "veo-3.1-generate-preview";
const POLL_INTERVAL_MS = 8000;
const MAX_POLL_MS = 8 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function aspectToVeo(aspect?: string): string {
  if (!aspect) return "9:16";
  if (aspect === "1:1") return "9:16"; // Veo 3.1 supports 16:9 / 9:16
  return aspect;
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

    // Load project + shot for this clip
    const { data: project, error: pErr } = await supabase
      .from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const shots: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
    const shot = shots.find((s) => Number(s.clip_number) === Number(clip_number));
    if (!shot) return json({ error: `Shot ${clip_number} not found in shot_list` }, 404);

    const aspect = aspectToVeo(project.aspect_ratio);
    const version = project.current_version ?? 1;

    // Upsert pending clip row
    const baseRow = {
      project_id,
      version,
      clip_number,
      veo_prompt: shot.veo_prompt,
      veo_model: VEO_MODEL,
      veo_aspect_ratio: aspect,
      veo_resolution: "1080p",
      vo_text: shot.vo_segment ?? null,
      text_overlay: shot.text_overlay ? { text: shot.text_overlay } : null,
      status: "generating",
    };

    // Try update first; if no row, insert
    const { data: existing } = await admin
      .from("ai_video_clips")
      .select("id")
      .eq("project_id", project_id).eq("version", version).eq("clip_number", clip_number)
      .maybeSingle();

    let clipId: string;
    if (existing) {
      clipId = existing.id;
      await admin.from("ai_video_clips").update(baseRow).eq("id", clipId);
    } else {
      const { data: ins, error: insErr } = await admin
        .from("ai_video_clips").insert(baseRow).select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      clipId = ins.id;
    }

    // Mark project generating
    await admin.from("ai_video_projects").update({ status: "generating" }).eq("id", project_id);

    // 1. Kick off Veo long-running operation
    const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_API_KEY}`;
    const startBody = {
      instances: [{ prompt: shot.veo_prompt }],
      parameters: {
        aspectRatio: aspect,
        resolution: "1080p",
        personGeneration: "allow_all",
      },
    };
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(startBody),
    });
    if (!startRes.ok) {
      const t = await startRes.text();
      console.error("Veo start error:", startRes.status, t);
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "Veo start failed", detail: t.slice(0, 500) }, 500);
    }
    const startData = await startRes.json();
    const opName: string | undefined = startData.name;
    if (!opName) {
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "No operation name from Veo", detail: startData }, 500);
    }

    // 2. Poll
    const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`;
    const startedAt = Date.now();
    let opData: any = null;
    while (Date.now() - startedAt < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pr = await fetch(pollUrl);
      if (!pr.ok) continue;
      const pd = await pr.json();
      if (pd.done) { opData = pd; break; }
    }
    if (!opData) {
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "Veo polling timed out" }, 504);
    }
    if (opData.error) {
      console.error("Veo op error:", opData.error);
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "Veo generation failed", detail: opData.error }, 500);
    }

    // 3. Extract video URI (Veo returns a uri requiring API key) or inline bytes
    const generated =
      opData.response?.generateVideoResponse?.generatedSamples ??
      opData.response?.generatedVideos ??
      opData.response?.videos ??
      [];
    const first = generated[0];
    const videoUri: string | undefined =
      first?.video?.uri || first?.videoUri || first?.video?.videoUri;
    const inlineB64: string | undefined =
      first?.video?.inlineData?.data || first?.bytesBase64Encoded;

    let videoBytes: Uint8Array | null = null;
    if (videoUri) {
      const sep = videoUri.includes("?") ? "&" : "?";
      const dl = await fetch(`${videoUri}${sep}key=${GEMINI_API_KEY}`);
      if (!dl.ok) {
        const t = await dl.text();
        await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
        return json({ error: "Veo download failed", detail: t.slice(0, 300) }, 500);
      }
      videoBytes = new Uint8Array(await dl.arrayBuffer());
    } else if (inlineB64) {
      const bin = atob(inlineB64);
      videoBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) videoBytes[i] = bin.charCodeAt(i);
    } else {
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "No video in Veo response", detail: opData.response }, 500);
    }

    // 4. Upload to storage
    const path = `ai-video/${project_id}/clips/v${version}/clip-${clip_number}-${Date.now()}.mp4`;
    const { error: upErr } = await admin.storage
      .from("creative-assets")
      .upload(path, videoBytes, { contentType: "video/mp4", upsert: true });
    if (upErr) {
      await admin.from("ai_video_clips").update({ status: "failed" }).eq("id", clipId);
      return json({ error: "Storage upload failed", detail: upErr.message }, 500);
    }
    const { data: pub } = admin.storage.from("creative-assets").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // 5. Save to clip row as the first generated option, mark generated/selected
    await admin
      .from("ai_video_clips")
      .update({
        generated_options: [{ url: publicUrl, source: "veo", generated_at: new Date().toISOString() }],
        selected_option_index: 0,
        status: "generated",
      })
      .eq("id", clipId);

    return json({ ok: true, clip_id: clipId, video_url: publicUrl });
  } catch (e) {
    console.error("generate-veo-clip error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
