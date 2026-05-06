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

const MAX_SAFE_VEO_CLIP_SECONDS = 8;

function clampNumber(v: any, min: number, max: number, fb: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
}

function cleanCaptionLine(text: string) {
  return String(text)
    .replace(/\b(Daughter|Mother|Father|Son|Narrator|Voiceover|VO|Speaker\s*\d*)\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipTimelineDuration(shot: any, opt: any) {
  const planned = Number(shot?.duration_seconds) > 0 ? Number(shot.duration_seconds) : MAX_SAFE_VEO_CLIP_SECONDS;
  const generated = Number(opt?.duration_seconds ?? opt?.metadata?.duration_seconds ?? opt?.duration);
  // Older generated clips do not have stored media duration. Veo clips are capped at 8s here so
  // Shotstack does not hold/freeze a source after the real clip has ended.
  return clampNumber(generated || Math.min(planned, MAX_SAFE_VEO_CLIP_SECONDS), 1, MAX_SAFE_VEO_CLIP_SECONDS, Math.min(planned, MAX_SAFE_VEO_CLIP_SECONDS));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, realign, parent_render_id } = await req.json();
    if (!project_id) throw new Error('project_id required');
    const isRealign = Boolean(realign);

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

    const voSegments: any[] = Array.isArray(voiceover?.settings?.segments) ? voiceover.settings.segments : [];

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
    // Voiceover only required when at least one shot uses narrator_vo.
    // Mixed dialogue/narrator projects must use per-shot VO segments; a legacy
    // full-length narrator file would overlap Veo's native character dialogue.
    const needsNarrator = shotList.some((s: any) => s?.speaker === 'narrator_vo' && String(s?.vo_segment || '').trim());
    const hasCharacterDialogue = shotList.some((s: any) => s?.speaker && s.speaker !== 'narrator_vo' && s.speaker !== 'none');
    if (needsNarrator && (!voiceover?.audio_url || (hasCharacterDialogue && voSegments.length === 0))) {
      throw new Error(`Narrator voiceover must be regenerated as per-clip segments before composing. Click "Regenerate Voiceover", then compose again.`);
    }

    // Build clip track + caption track from vo_segment
    let cursor = 0;
    const videoClips: any[] = [];
    const overlayClips: any[] = [];
    const captionClips: any[] = [];
    const shotStartByNumber = new Map<number, number>();

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
    const baseStyle = STYLES[captionStyle] ?? STYLES.tiktok;
    // User-tunable overrides from project.caption_settings
    const cs = ((project as any).caption_settings ?? {}) as Record<string, any>;
    const S = {
      ...baseStyle,
      size: clampNumber(cs.font_size, 18, 96, baseStyle.size),
      wordsPerChunk: clampNumber(cs.words_per_chunk, 1, 10, baseStyle.wordsPerChunk),
      bgOpacity: clampNumber(cs.background_opacity, 0, 1, 0.55),
      fadeDuration: clampNumber(cs.fade_duration, 0, 0.5, 0),
    };
    const HIGHLIGHT_WORDS = new Set(['free','now','new','only','today','stop','never','best','huge','massive','crazy','shocking','warning','secret','proven','guaranteed','save','fast','easy','call','watch']);

    const chunkCaption = (text: string, totalDuration: number, audioDuration?: number) => {
      const cleaned = cleanCaptionLine(text);
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
      // In realign mode we ignore the visible-clip duration entirely and snap captions to the
      // narrator audio length, with no per-chunk cap and zero pre-roll. This is what the
      // post-render validator triggers when drift is detected.
      const targetDuration = isRealign && Number(audioDuration) > 0
        ? Number(audioDuration)
        : clampNumber(audioDuration, 0.5, totalDuration, totalDuration);
      const usable = isRealign
        ? Math.max(0.5, targetDuration)
        : Math.max(0.5, Math.min(totalDuration, targetDuration) - 0.1);
      let t = isRealign ? 0 : 0.05;
      const perChunkCap = isRealign ? targetDuration : 3.0;
      const perChunkFloor = isRealign ? 0.4 : 0.8;
      return chunks.map((c) => {
        const share = (Math.max(1, c.text.length) / totalChars) * usable;
        const len = Math.min(perChunkCap, Math.max(perChunkFloor, share));
        const out = { ...c, start: t, length: len };
        t += len;
        return out;
      });
    };

    for (const shot of shotList) {
      const dbClip = clips?.find((c: any) => c.clip_number === shot.clip_number);
      const opt = dbClip?.generated_options?.[dbClip?.selected_option_index ?? 0];
      const url = dbClip!.override_video_url || opt!.url;
      const voSegment = voSegments.find((seg) => Number(seg.clip_number) === Number(shot.clip_number));
      const duration = clipTimelineDuration(shot, opt);
      shotStartByNumber.set(Number(shot.clip_number), cursor);

      // Keep Veo's native audio for in-scene character dialogue; mute narrator/silent shots.
      const speaker = shot.speaker;
      const isCharacterDialogue = speaker && speaker !== 'narrator_vo' && speaker !== 'none';
      const videoVolume = isCharacterDialogue ? 1 : 0;

      videoClips.push({
        asset: { type: 'video', src: url, volume: videoVolume },
        start: cursor,
        length: duration,
        fit: 'cover',
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
        const chunks = chunkCaption(captionText, duration, voSegment?.duration_seconds);
        for (const ch of chunks) {
          // Map numeric fade duration to Shotstack transition names
          const fadeName = S.fadeDuration <= 0.05
            ? undefined
            : S.fadeDuration < 0.2 ? 'fadeFast'
            : S.fadeDuration > 0.5 ? 'fadeSlow'
            : 'fade';
          captionClips.push({
            asset: {
              type: 'text', text: ch.text.toUpperCase(),
              font: { family: S.font, size: S.size, color: ch.isHighlight ? S.highlight : S.color, lineHeight: 1.15 },
              stroke: { color: '#000000', width: S.stroke },
              background: { color: '#000000', opacity: S.bgOpacity, padding: 16, borderRadius: 12 },
              width: Math.round(width * 0.82),
              height: 220,
              alignment: { horizontal: 'center', vertical: 'center' },
            },
            start: cursor + ch.start,
            length: Math.max(0.9, ch.length - 0.05),
            position: 'bottom',
            offset: { y: S.yOffset },
            transition: fadeName ? { in: fadeName, out: fadeName } : undefined,
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

    // Voiceover — prefer per-shot segments so narrator only plays during narrator clips,
    // never overlapping Veo's in-scene character dialogue. Falls back to a single track for
    // legacy projects.
    if (voSegments.length > 0) {
      const voClips = voSegments
        .map((seg) => {
          const start = shotStartByNumber.get(Number(seg.clip_number));
          if (start === undefined || !seg.audio_url) return null;
          const shot = shotList.find((s: any) => Number(s.clip_number) === Number(seg.clip_number));
          const dbClip = clips?.find((c: any) => c.clip_number === Number(seg.clip_number));
          const opt = dbClip?.generated_options?.[dbClip?.selected_option_index ?? 0];
          const len = Math.min(clipTimelineDuration(shot, opt), clampNumber(seg.duration_seconds, 0.5, MAX_SAFE_VEO_CLIP_SECONDS, MAX_SAFE_VEO_CLIP_SECONDS));
          return {
            asset: { type: 'audio', src: seg.audio_url, volume: 1 },
            start,
            length: len,
          };
        })
        .filter(Boolean);
      if (voClips.length) tracks.push({ clips: voClips });
    } else if (voiceover?.audio_url && !hasCharacterDialogue) {
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
