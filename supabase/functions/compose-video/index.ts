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

function clipTimelineDuration(shot: any, opt: any, dbClip?: any) {
  const planned = Number(shot?.duration_seconds) > 0 ? Number(shot.duration_seconds) : MAX_SAFE_VEO_CLIP_SECONDS;
  // Prefer the actual measured duration from the downloaded MP4 if available.
  const measured = Number(dbClip?.actual_duration_seconds);
  const generated = Number(opt?.duration_seconds ?? opt?.metadata?.duration_seconds ?? opt?.duration);
  const sourceLen = Number.isFinite(measured) && measured > 0
    ? measured
    : (generated || Math.min(planned, MAX_SAFE_VEO_CLIP_SECONDS));
  const trimStart = Math.max(0, Number(shot?.trim_start_seconds) || 0);
  const available = Math.max(0.5, sourceLen - trimStart);
  // shot.duration_seconds acts as an UPPER CAP on the timeline length so TIMING_EDIT trims work.
  const capped = Math.min(available, planned);
  return clampNumber(capped, 0.5, MAX_SAFE_VEO_CLIP_SECONDS, Math.min(planned, MAX_SAFE_VEO_CLIP_SECONDS));
}

interface WordTiming { word: string; start: number; end: number; }

const PHRASE_LEAD_WORDS = new Set(['and', 'but', 'or', 'so', 'when', 'because', 'that', 'which', 'while', 'if', 'though']);
const PREP_WORDS = new Set(['in', 'on', 'at', 'for', 'to', 'with', 'from', 'of', 'by', 'into', 'over', 'under']);

// Split a transcript into natural phrase-sized caption chunks using ElevenLabs word timings.
// Falls back to a heuristic word-count split when no timings are present.
function chunkByPhrases(
  text: string,
  words: WordTiming[],
  opts: { wordCap?: number; charCap?: number } = {},
): { text: string; start: number; end: number }[] {
  const wordCap = Math.max(2, Math.min(8, opts.wordCap ?? 4));
  const charCap = Math.max(14, Math.min(40, opts.charCap ?? 26));
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  // Best-effort align tokens to word timings (whitespace tokenization may differ slightly).
  const timed = words.length === tokens.length
    ? tokens.map((t, i) => ({ word: t, start: words[i].start, end: words[i].end }))
    : tokens.map((t, i) => {
        const w = words[i];
        return w ? { word: t, start: w.start, end: w.end } : null;
      }).filter(Boolean) as WordTiming[];

  if (!timed.length) return [];

  const chunks: { text: string; start: number; end: number }[] = [];
  let buf: WordTiming[] = [];
  const flush = () => {
    if (!buf.length) return;
    chunks.push({
      text: buf.map((w) => w.word).join(' '),
      start: buf[0].start,
      end: buf[buf.length - 1].end,
    });
    buf = [];
  };

  for (let i = 0; i < timed.length; i++) {
    const w = timed[i];
    buf.push(w);
    const next = timed[i + 1];
    const nextClean = next?.word.replace(/[^a-z]/gi, '').toLowerCase();
    const endsWithPunct = /[,.\-!?;:]$/.test(w.word);
    const breathGap = next ? (next.start - w.end) > 0.2 : false;
    const beforeConj = next && buf.length >= 2 && PHRASE_LEAD_WORDS.has(nextClean ?? '');
    const beforePrep = next && buf.length >= 3 && PREP_WORDS.has(nextClean ?? '');
    const currentChars = buf.reduce((n, x) => n + x.word.length, 0) + (buf.length - 1);
    const nextChars = next ? currentChars + 1 + next.word.length : currentChars;
    const wordCapHit = buf.length >= wordCap;
    const charCapHit = next ? nextChars > charCap : false;
    if (endsWithPunct || breathGap || beforeConj || beforePrep || wordCapHit || charCapHit || !next) {
      flush();
    }
  }
  return chunks;
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
    // Phase 3+4: project-level Quick Fix overrides take precedence over brand_kit.
    const phone = (project as any).phone_overlay || brand.phone || brand.phone_number || '';
    const disclaimer = (project as any).disclaimer_overlay || brand.disclaimer || '';
    const endCardHeadline = (project as any).end_card_text || brand.end_card_headline || project.cta || '';
    const endCardSub = brand.end_card_sub ?? phone;
    const primaryColor = brand.primary_color ?? '#0F172A';
    const accentColor = brand.accent_color ?? '#3B82F6';
    const musicVolume = clampNumber((project as any).music_volume, 0, 1, 0.18);

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
    // (Phase 2: timing now driven by per-shot transition_type — see ShotTiming below.)
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

    // Phrase-based caption builder. When the VO segment carries word-level timestamps
    // from ElevenLabs (alignment), we snap each chunk's start/length to the actual audio.
    // Otherwise we fall back to a proportional split inside the visible clip duration.
    const chunkCaption = (text: string, totalDuration: number, voSeg?: any) => {
      const cleaned = cleanCaptionLine(text);
      if (!cleaned) return [] as { text: string; isHighlight: boolean; start: number; length: number }[];

      const words: WordTiming[] = Array.isArray(voSeg?.words) ? voSeg.words : [];
      const audioDuration = Number(voSeg?.duration_seconds);

      const markHighlight = (chunkText: string) =>
        chunkText.split(/\s+/).some((w) => HIGHLIGHT_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));

      // Path A — phrase chunking from real ElevenLabs timestamps.
      if (words.length) {
        // Char cap scales inversely with font size so chunks always fit the asset width.
        // Tuned for Montserrat ExtraBold uppercase at the styles defined above.
        const charCap = Math.round(1500 / Math.max(28, S.size));
        const phrased = chunkByPhrases(cleaned, words, { wordCap: S.wordsPerChunk, charCap });
        if (phrased.length) {
          // Cap last chunk's end so it never exceeds the clip's visible duration.
          const ceiling = Math.max(0.5, totalDuration);
          return phrased.map((p) => {
            const start = Math.max(0, Math.min(ceiling - 0.1, p.start));
            const end = Math.max(start + 0.4, Math.min(ceiling, p.end));
            return {
              text: p.text,
              isHighlight: markHighlight(p.text),
              start,
              length: Math.max(0.4, end - start),
            };
          });
        }
      }

      // Path B — fallback heuristic when alignment is missing (legacy segments).
      const allWords = cleaned.split(/\s+/).filter(Boolean);
      const wpc = S.wordsPerChunk;
      const chunks: { text: string; isHighlight: boolean }[] = [];
      for (let i = 0; i < allWords.length; i += wpc) {
        const slice = allWords.slice(i, i + wpc);
        chunks.push({
          text: slice.join(' '),
          isHighlight: slice.some((w) => HIGHLIGHT_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))),
        });
      }
      const totalChars = chunks.reduce((sum, c) => sum + Math.max(1, c.text.length), 0);
      const targetDuration = isRealign && Number.isFinite(audioDuration) && audioDuration > 0
        ? audioDuration
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

    // ---- Phase 2: pre-compute per-shot timings honoring transition_type ----
    // J-cut: NEXT shot's audio leads its video by ~0.3s.
    // L-cut: THIS shot's audio bleeds ~0.5s into the next shot's video.
    // fade_black: ~0.4s dip-to-black on the seam (handled via Shotstack fade transitions).
    type ShotTiming = {
      shot: any;
      voSegment: any | undefined;
      url: string;
      videoStart: number;
      videoLen: number;
      audioStart: number;
      audioLen: number;
      transition: 'hard_cut' | 'j_cut' | 'l_cut' | 'fade_black';
      videoFade: boolean;
    };

    const J_CUT_LEAD = 0.30;
    const L_CUT_TAIL = 0.50;

    const timings: ShotTiming[] = [];
    let cur = 0;
    for (let i = 0; i < shotList.length; i++) {
      const shot = shotList[i];
      const dbClip = clips?.find((c: any) => c.clip_number === shot.clip_number);
      const opt = dbClip?.generated_options?.[dbClip?.selected_option_index ?? 0];
      const url = dbClip!.override_video_url || opt!.url;
      const voSegment = voSegments.find((seg) => Number(seg.clip_number) === Number(shot.clip_number));
      const videoLen = clipTimelineDuration(shot, opt, dbClip);

      const rawT = String((dbClip?.transition_type ?? shot.transition_type ?? 'hard_cut')).toLowerCase();
      const transition = (i === shotList.length - 1 ? 'hard_cut'
        : (['hard_cut', 'j_cut', 'l_cut', 'fade_black'].includes(rawT) ? rawT : 'hard_cut')) as ShotTiming['transition'];

      const prevT = i > 0 ? timings[i - 1].transition : 'hard_cut';
      const audioLead = prevT === 'j_cut' ? J_CUT_LEAD : 0;
      const audioTail = transition === 'l_cut' ? L_CUT_TAIL : 0;

      const videoStart = cur;
      const audioStart = Math.max(0, videoStart - audioLead);
      const segDur = clampNumber(voSegment?.duration_seconds, 0.5, MAX_SAFE_VEO_CLIP_SECONDS + L_CUT_TAIL, videoLen);
      const audioLen = Math.min(MAX_SAFE_VEO_CLIP_SECONDS + L_CUT_TAIL, segDur + audioTail);

      timings.push({
        shot, voSegment, url,
        videoStart, videoLen, audioStart, audioLen, transition,
        videoFade: prevT === 'fade_black' || transition === 'fade_black',
      });
      shotStartByNumber.set(Number(shot.clip_number), videoStart);
      cur += videoLen;
    }
    const totalDuration = cur;

    for (const t of timings) {
      const { shot, voSegment, url, videoStart, videoLen, audioStart, audioLen, videoFade } = t;
      const speaker = shot.speaker;
      const isCharacterDialogue = speaker && speaker !== 'narrator_vo' && speaker !== 'none';
      const videoVolume = isCharacterDialogue ? 1 : 0;

      videoClips.push({
        asset: { type: 'video', src: url, volume: videoVolume },
        start: videoStart,
        length: videoLen,
        fit: 'cover',
        transition: videoFade ? { in: 'fade', out: 'fade' } : undefined,
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
            start: videoStart + 0.2,
            length: Math.min(2.0, videoLen - 0.4),
            position: 'top',
            offset: { y: -0.04 },
            transition: { in: 'fade', out: 'fade' },
          });
        }
      }

      const captionText = (shot.dialogue && String(shot.dialogue).trim()) || (shot.vo_segment && String(shot.vo_segment).trim()) || '';
      if (captionText) {
        // Captions follow AUDIO timing so j-cut captions appear slightly before the visual cut.
        const chunks = chunkCaption(captionText, audioLen, voSegment);
        for (const ch of chunks) {
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
              width: Math.round(width * 0.78),
              height: 240,
              alignment: { horizontal: 'center', vertical: 'center' },
            },
            start: audioStart + ch.start,
            length: Math.max(0.9, ch.length - 0.05),
            position: 'bottom',
            offset: { y: S.yOffset },
            transition: fadeName ? { in: fadeName, out: fadeName } : undefined,
          });
        }
      }
    }

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
          if (!seg.audio_url) return null;
          const t = timings.find((x) => Number(x.shot.clip_number) === Number(seg.clip_number));
          if (!t) return null;
          // J-cut: VO leads the visual cut. L-cut: VO trails into next shot's video.
          return {
            asset: { type: 'audio', src: seg.audio_url, volume: 1 },
            start: t.audioStart,
            length: t.audioLen,
          };
        })
        .filter(Boolean);
      if (voClips.length) tracks.push({ clips: voClips });
    } else if (voiceover?.audio_url && !hasCharacterDialogue) {
      tracks.push({ clips: [{ asset: { type: 'audio', src: voiceover.audio_url, volume: 1 }, start: 0, length: totalDuration }] });
    }
    if (music?.audio_url) {
      tracks.push({ clips: [{
        asset: { type: 'audio', src: music.audio_url, volume: voiceover?.audio_url || voSegments.length > 0 ? musicVolume : Math.max(musicVolume, 0.5) },
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
        parent_render_id: parent_render_id ?? null,
        caption_realign_count: isRealign ? 1 : 0,
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
