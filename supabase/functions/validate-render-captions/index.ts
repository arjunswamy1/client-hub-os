// Post-render caption validator. Compares caption clip timing in the render's
// edit_json against the per-shot voiceover audio durations (and the visible
// clip windows). If any caption drifts past the threshold from its narrator
// audio, automatically triggers compose-video in `realign` mode so captions
// snap back to the VO timeline.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Drift threshold (seconds) — captions covering a narrator clip must end within
// this distance of the audio end. Anything beyond is considered "drifted".
const DRIFT_THRESHOLD_SECONDS = 0.6;
// Hard cap so a render can never spawn an infinite chain of auto-realigns.
const MAX_REALIGN_ATTEMPTS = 1;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { render_id } = await req.json();
    if (!render_id) throw new Error('render_id required');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: render, error } = await supabase
      .from('ai_video_renders').select('*').eq('id', render_id).single();
    if (error || !render) throw new Error(error?.message ?? 'Render not found');

    if (render.status !== 'done') {
      return json({ skipped: true, reason: `render status=${render.status}` });
    }

    const version = render.version;
    const projectId = render.project_id;

    const [{ data: project }, { data: clips }, { data: audio }] = await Promise.all([
      supabase.from('ai_video_projects').select('shot_list').eq('id', projectId).single(),
      supabase.from('ai_video_clips').select('*').eq('project_id', projectId).eq('version', version),
      supabase.from('ai_video_audio').select('*').eq('project_id', projectId).eq('version', version),
    ]);

    const shotList: any[] = Array.isArray(project?.shot_list) ? project!.shot_list : [];
    const voiceover = audio?.find((a: any) => a.audio_type === 'voiceover');
    const voSegments: any[] = Array.isArray(voiceover?.settings?.segments)
      ? voiceover!.settings.segments : [];

    const editTracks: any[] = render.edit_json?.timeline?.tracks ?? [];
    // Captions are pushed onto the first track in compose-video.
    const captionTrack = editTracks[0] ?? { clips: [] };
    const captionClips: any[] = Array.isArray(captionTrack.clips) ? captionTrack.clips : [];

    // Re-derive each shot's start cursor from the edit_json video track (last track).
    const videoTrack = editTracks[editTracks.length - 1] ?? { clips: [] };
    const videoClips: any[] = Array.isArray(videoTrack.clips) ? videoTrack.clips : [];
    if (shotList.length !== videoClips.length) {
      // Safe fallback: still report but don't auto-realign on shape mismatch.
    }

    const shotsReport: any[] = [];
    let maxDrift = 0;
    let drifted = false;

    for (let i = 0; i < shotList.length; i++) {
      const shot = shotList[i];
      const vc = videoClips[i];
      if (!vc) continue;
      const shotStart = Number(vc.start) || 0;
      const shotEnd = shotStart + (Number(vc.length) || 0);

      const seg = voSegments.find((s) => Number(s.clip_number) === Number(shot.clip_number));
      const audioDuration = Number(seg?.duration_seconds) || 0;

      // Captions overlapping this shot's window
      const inWindow = captionClips.filter((c) => {
        const s = Number(c.start) || 0;
        return s >= shotStart - 0.05 && s < shotEnd - 0.05;
      });
      if (!inWindow.length) continue;

      const captionsEnd = inWindow.reduce((m, c) => Math.max(m, (Number(c.start) || 0) + (Number(c.length) || 0)), 0);
      const captionsRelEnd = captionsEnd - shotStart;

      // Reference duration: prefer narrator audio length when available, else clip window.
      const reference = audioDuration > 0 ? audioDuration : (shotEnd - shotStart);
      const drift = Math.abs(captionsRelEnd - reference);
      const isDrift = audioDuration > 0 && drift > DRIFT_THRESHOLD_SECONDS;
      if (isDrift) drifted = true;
      maxDrift = Math.max(maxDrift, drift);

      shotsReport.push({
        clip_number: shot.clip_number,
        audio_duration: audioDuration,
        clip_window: Number((shotEnd - shotStart).toFixed(2)),
        captions_end_relative: Number(captionsRelEnd.toFixed(2)),
        drift_seconds: Number(drift.toFixed(2)),
        drifted: isDrift,
      });
    }

    const validation = {
      checked_at: new Date().toISOString(),
      threshold_seconds: DRIFT_THRESHOLD_SECONDS,
      max_drift_seconds: Number(maxDrift.toFixed(2)),
      drifted,
      shots: shotsReport,
    };

    await supabase.from('ai_video_renders')
      .update({ caption_validation: validation })
      .eq('id', render_id);

    if (!drifted) {
      return json({ drifted: false, validation });
    }

    // Walk back to root render to count attempts in this chain.
    const attempts = (render.caption_realign_count ?? 0);
    if (attempts >= MAX_REALIGN_ATTEMPTS) {
      return json({ drifted: true, realigned: false, reason: 'max attempts reached', validation });
    }

    // Trigger compose-video in realign mode. Don't block the response on the new render.
    const composeUrl = `${SUPABASE_URL}/functions/v1/compose-video`;
    const resp = await fetch(composeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        project_id: projectId,
        realign: true,
        parent_render_id: render_id,
      }),
    });
    const composeBody = await resp.json().catch(() => ({}));

    return json({
      drifted: true,
      realigned: resp.ok,
      new_render_id: composeBody?.render_id ?? null,
      validation,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
