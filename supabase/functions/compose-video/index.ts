// Compose final video via Shotstack: stitches Veo clips + VO + music + overlays + end card.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Accept either a stage name ('v1' / 'stage') OR a full URL in SHOTSTACK_ENV — normalize to stage.
const RAW_ENV = (Deno.env.get('SHOTSTACK_ENV') ?? 'v1').trim();
const STAGE_MATCH = RAW_ENV.match(/(stage|v1)/i);
const SHOTSTACK_ENV = (STAGE_MATCH ? STAGE_MATCH[1].toLowerCase() : 'v1');
const SHOTSTACK_HOST = `https://api.shotstack.io/edit/${SHOTSTACK_ENV}`;
const SHOTSTACK_API_KEY = (SHOTSTACK_ENV === 'stage'
  ? (Deno.env.get('SHOTSTACK_API_KEY_STAGE') ?? Deno.env.get('SHOTSTACK_API_KEY'))
  : Deno.env.get('SHOTSTACK_API_KEY')) ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function aspectToSize(aspect: string): { width: number; height: number; ratio: '16:9' | '9:16' | '1:1' | '4:5' } {
  switch (aspect) {
    case '16:9': return { width: 1920, height: 1080, ratio: '16:9' };
    case '1:1':  return { width: 1080, height: 1080, ratio: '1:1' };
    case '4:5':  return { width: 1080, height: 1350, ratio: '4:5' };
    case '9:16':
    default:     return { width: 1080, height: 1920, ratio: '9:16' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { project_id } = await req.json();
    if (!project_id) throw new Error('project_id required');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: project, error: pErr } = await supabase
      .from('ai_video_projects').select('*').eq('id', project_id).single();
    if (pErr || !project) throw new Error(pErr?.message ?? 'Project not found');

    const version = project.current_version ?? 1;

    const { data: clips } = await supabase
      .from('ai_video_clips').select('*')
      .eq('project_id', project_id).eq('version', version).order('clip_number');

    const { data: audio } = await supabase
      .from('ai_video_audio').select('*')
      .eq('project_id', project_id).eq('version', version);

    const voiceover = audio?.find((a: any) => a.audio_type === 'voiceover');
    const music = audio?.find((a: any) => a.audio_type === 'music');

    const shotList: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
    if (!shotList.length) throw new Error('No shot list to compose');

    const { width, height, ratio } = aspectToSize(project.aspect_ratio ?? '9:16');
    const brand = (project.brand_kit ?? {}) as Record<string, any>;
    const phone = brand.phone ?? brand.phone_number ?? '';
    const disclaimer = brand.disclaimer ?? '';
    const endCardHeadline = brand.end_card_headline ?? project.cta ?? '';
    const endCardSub = brand.end_card_sub ?? phone;
    const primaryColor = brand.primary_color ?? '#0F172A';
    const accentColor = brand.accent_color ?? '#3B82F6';

    // Pre-flight: list ALL missing clips so the user fixes them in one pass
    const missing: number[] = [];
    for (const shot of shotList) {
      const dbClip = clips?.find((c: any) => c.clip_number === shot.clip_number);
      const opt = dbClip?.generated_options?.[dbClip?.selected_option_index ?? 0];
      const url = dbClip?.override_video_url || opt?.url;
      if (!url) missing.push(shot.clip_number);
    }
    if (missing.length) {
      throw new Error(`Cannot compose — ${missing.length} of ${shotList.length} clips not generated yet. Missing: ${missing.join(', ')}. Generate each clip with Veo first.`);
    }
    // Voiceover only required when at least one shot uses narrator_vo
    const needsNarrator = shotList.some((s: any) => s?.speaker === 'narrator_vo' && String(s?.vo_segment || '').trim());
    if (needsNarrator && !voiceover?.audio_url) {
      throw new Error(`Narrator voiceover required for this shot list but missing. Click "Generate Voiceover" first.`);
    }

    // Build clip track + caption track from vo_segment
    let cursor = 0;
    const videoClips: any[] = [];
    const overlayClips: any[] = [];
    const captionClips: any[] = [];

    const captionStyle = String((project as any).caption_style || 'tiktok').toLowerCase();
    // Single, readable system across styles. Captions sit in a dark pill near the lower-third,
    // chunked into 3–5 word groups, soft fade in/out — no zoom pop, no per-word flicker.
    const STYLES: Record<string, any> = {
      tiktok:    { font: 'Montserrat ExtraBold', size: 52, color: '#ffffff', highlight: '#FFEB3B', stroke: 4, wordsPerChunk: 4, yOffset: 0.14 },
      hormozi:   { font: 'Montserrat ExtraBold', size: 56, color: '#FFEB3B', highlight: '#22c55e', stroke: 5, wordsPerChunk: 4, yOffset: 0.14 },
      mrbeast:   { font: 'Montserrat ExtraBold', size: 60, color: '#ffffff', highlight: '#ff3b30', stroke: 5, wordsPerChunk: 3, yOffset: 0.16 },
      editorial: { font: 'Montserrat Bold',      size: 38, color: '#ffffff', highlight: '#ffffff', stroke: 2, wordsPerChunk: 6, yOffset: 0.10 },
      minimal:   { font: 'Montserrat Medium',    size: 34, color: '#ffffff', highlight: '#ffffff', stroke: 2, wordsPerChunk: 7, yOffset: 0.08 },
    };
    const S = STYLES[captionStyle] ?? STYLES.tiktok;
    const HIGHLIGHT_WORDS = new Set(['free','now','new','only','today','stop','never','best','huge','massive','crazy','shocking','warning','secret','proven','guaranteed','save','fast','easy','call','watch']);

    const chunkCaption = (text: string, totalDuration: number) => {
      const cleaned = String(text)
        .replace(/\b(Daughter|Mother|Father|Son|Narrator|Voiceover|VO|Speaker\s*\d*)\s*:/gi, '')
        .replace(/\s+/g, ' ').trim();
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (!words.length) return [] as { text: string; isHighlight: boolean; start: number; length: number }[];
      const wpc = S.wordsPerChunk;
      const chunks: { text: string; isHighlight: boolean }[] = [];
      for (let i = 0; i < words.length; i += wpc) {
        const slice = words.slice(i, i + wpc);
        chunks.push({
          text: slice.join(' '),
          isHighlight: slice.some((w) => HIGHLIGHT_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))),
        });
      }
      // Allocate time proportional to character count so longer chunks linger.
      const totalChars = chunks.reduce((sum, c) => sum + Math.max(1, c.text.length), 0);
      // Reserve a small lead-in so the first caption doesn't collide with cut-in.
      const usable = Math.max(0.5, totalDuration - 0.2);
      let t = 0.1;
      return chunks.map((c) => {
        const share = (Math.max(1, c.text.length) / totalChars) * usable;
        // Minimum 1.1s per chunk for readability, max 3.5s.
        const len = Math.min(3.5, Math.max(1.1, share));
        const out = { ...c, start: t, length: len };
        t += len;
        return out;
      });
    };

    for (const shot of shotList) {
      const dbClip = clips?.find((c: any) => c.clip_number === shot.clip_number);
      const opt = dbClip?.generated_options?.[dbClip?.selected_option_index ?? 0];
      const url = dbClip!.override_video_url || opt!.url;
      const duration = Number(shot.duration_seconds) || 8;

      // Keep Veo's native audio for in-scene character dialogue; mute narrator/silent shots.
      const speaker = shot.speaker;
      const isCharacterDialogue = speaker && speaker !== 'narrator_vo' && speaker !== 'none';
      const videoVolume = isCharacterDialogue ? 1 : 0;

      videoClips.push({
        asset: { type: 'video', src: url, volume: videoVolume },
        start: cursor,
        length: duration,
        fit: 'cover',
        transition: cursor === 0 ? undefined : { in: 'fade' },
      });

      if (shot.text_overlay) {
        const txt = typeof shot.text_overlay === 'string' ? shot.text_overlay : (shot.text_overlay.text ?? '');
        if (txt) {
          overlayClips.push({
            asset: {
              type: 'text', text: String(txt).toUpperCase(),
              font: { family: 'Montserrat ExtraBold', size: 56, color: '#ffffff' },
              background: { color: primaryColor, opacity: 0.7, padding: 18, borderRadius: 8 },
              alignment: { horizontal: 'center', vertical: 'center' },
            },
            start: cursor + 0.2,
            length: Math.min(2.0, duration - 0.4),
            position: 'top',
            offset: { y: -0.04 },
            transition: { in: 'fade', out: 'fade' },
          });
        }
      }

      const captionText = (shot.dialogue && String(shot.dialogue).trim()) || (shot.vo_segment && String(shot.vo_segment).trim()) || '';
      if (captionText) {
        const chunks = chunkCaption(captionText, duration);
        for (const ch of chunks) {
          captionClips.push({
            asset: {
              type: 'text', text: ch.text.toUpperCase(),
              font: { family: S.font, size: S.size, color: ch.isHighlight ? S.highlight : S.color, lineHeight: 1.1 },
              stroke: { color: '#000000', width: S.stroke },
              width: Math.round(width * 0.85),
              height: 200,
              alignment: { horizontal: 'center', vertical: 'center' },
            },
            start: cursor + ch.start,
            length: Math.max(0.5, ch.length - 0.02),
            position: 'bottom',
            offset: { y: S.yOffset },
            transition: { in: 'zoom', out: 'fade' },
          });
        }
      }
      cursor += duration;
    }

    const totalDuration = cursor;

    // End card (last 3s overlay band)
    const endCardLen = 3;
    const endCardStart = Math.max(0, totalDuration - endCardLen);
    overlayClips.push({
      asset: { type: 'shape', shape: 'rectangle', width, height,
        rectangle: { width, height }, fill: { color: primaryColor, opacity: 0.85 } },
      start: endCardStart, length: endCardLen, position: 'center',
      transition: { in: 'fade' },
    });
    if (endCardHeadline) overlayClips.push({
      asset: { type: 'text', text: endCardHeadline,
        font: { family: 'Montserrat ExtraBold', size: 80, color: '#ffffff' },
        alignment: { horizontal: 'center', vertical: 'center' } },
      start: endCardStart + 0.2, length: endCardLen - 0.2,
      position: 'center', offset: { y: 0.05 },
    });
    if (endCardSub) overlayClips.push({
      asset: { type: 'text', text: endCardSub,
        font: { family: 'Montserrat', size: 56, color: accentColor },
        alignment: { horizontal: 'center', vertical: 'center' } },
      start: endCardStart + 0.4, length: endCardLen - 0.4,
      position: 'center', offset: { y: -0.08 },
    });

    // Persistent phone footer (skip during end card) — sits ABOVE the caption band
    if (phone && endCardStart > 0) {
      overlayClips.push({
        asset: { type: 'text', text: `Call ${phone}`,
          font: { family: 'Montserrat Bold', size: 36, color: '#ffffff' },
          background: { color: primaryColor, opacity: 0.75, padding: 12, borderRadius: 8 },
          alignment: { horizontal: 'center', vertical: 'center' } },
        start: 0, length: endCardStart,
        position: 'bottom', offset: { y: 0.22 },
      });
    }
    // Disclaimer (whole video, very small bottom)
    if (disclaimer) {
      overlayClips.push({
        asset: { type: 'text', text: disclaimer,
          font: { family: 'Montserrat', size: 18, color: '#ffffff' },
          alignment: { horizontal: 'center', vertical: 'center' } },
        start: 0, length: totalDuration,
        position: 'bottom', offset: { y: 0.005 },
      });
    }

    // Hide captions during the end card (so headline isn't covered)
    const trimmedCaptions = captionClips
      .filter((c) => c.start < endCardStart)
      .map((c) => ({ ...c, length: Math.min(c.length, Math.max(0.1, endCardStart - c.start)) }));

    const tracks: any[] = [
      { clips: trimmedCaptions }, // captions on very top so they're never hidden
      { clips: overlayClips },    // titles / end card / phone
      { clips: videoClips },      // base video
    ];

    if (voiceover?.audio_url) {
      tracks.push({ clips: [{ asset: { type: 'audio', src: voiceover.audio_url, volume: 1 }, start: 0, length: totalDuration }] });
    }
    if (music?.audio_url) {
      tracks.push({ clips: [{
        asset: { type: 'audio', src: music.audio_url, volume: voiceover?.audio_url ? 0.18 : 0.6 },
        start: 0, length: totalDuration,
        transition: { in: 'fade', out: 'fade' },
      }]});
    }

    const edit = {
      timeline: { background: '#000000', tracks },
      output: { format: 'mp4', resolution: 'hd', aspectRatio: ratio, fps: 30 },
    };

    // Insert render row
    const { data: renderRow, error: rErr } = await supabase
      .from('ai_video_renders')
      .insert({
        project_id, version,
        shotstack_env: SHOTSTACK_ENV,
        status: 'submitting',
        edit_json: edit,
        duration_seconds: totalDuration,
      })
      .select('id').single();
    if (rErr) throw new Error(rErr.message);

    // Submit to Shotstack
    console.log('[compose-video] POST', `${SHOTSTACK_HOST}/render`, 'env=', SHOTSTACK_ENV);
    console.log('[compose-video] edit payload:', JSON.stringify(edit));
    const ssResp = await fetch(`${SHOTSTACK_HOST}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': SHOTSTACK_API_KEY },
      body: JSON.stringify(edit),
    });
    const ssText = await ssResp.text();
    let ssJson: any = {};
    try { ssJson = JSON.parse(ssText); } catch { ssJson = { raw: ssText }; }
    console.log('[compose-video] Shotstack response status=', ssResp.status, 'body=', ssText);

    if (!ssResp.ok || !ssJson?.success) {
      // Shotstack validation errors usually live in response.error / response (array) / message
      const detail =
        ssJson?.response?.error ??
        (Array.isArray(ssJson?.response) ? ssJson.response : null) ??
        ssJson?.message ??
        ssText;
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      await supabase.from('ai_video_renders').update({ status: 'failed', error_message: msg }).eq('id', renderRow.id);
      throw new Error(`Shotstack ${ssResp.status}: ${msg}`);
    }

    await supabase.from('ai_video_renders').update({
      shotstack_id: ssJson.response.id,
      status: 'queued',
    }).eq('id', renderRow.id);

    return new Response(JSON.stringify({
      render_id: renderRow.id,
      shotstack_id: ssJson.response.id,
      duration_seconds: totalDuration,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
