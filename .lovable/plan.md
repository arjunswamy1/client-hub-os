## AI Video Studio v2 — Editing Quality, Cost & Targeted Feedback

This is a substantial multi-part upgrade. Splitting into 4 phases so you can stop/redirect after any phase.

---

### Phase 1 — Audio-truthful timing (foundation for everything else)

Goal: kill the heuristic. Captions stop drifting, validation loop becomes obsolete.

- `generate-voiceover/index.ts`: switch to ElevenLabs `with-timestamps` endpoint. Store `alignment` (characters + start/end times) and **measured** `duration_seconds` per segment in `ai_video_audio.settings.segments[].alignment`.
- `compose-video/index.ts`: new phrase-based chunker driven by word timings — splits on punctuation, before conjunctions/prepositions (when chunk ≥3–4 words), at >200ms breath gaps, hard-cap 6 words. Each chunk's start/end comes directly from alignment. Falls back to the old heuristic only if alignment is missing.
- `generate-veo-clip/index.ts`: probe the downloaded MP4 (ffprobe via WASM/`ffprobe-static` is heavy in Deno; instead read the MP4 `mvhd`/`mdhd` atoms directly — small inline parser) and store `actual_duration_seconds` on `ai_video_clips`.
- `compose-video`: use `actual_duration_seconds` as the source of truth instead of `min(planned, 8)`.
- Mark `validate-render-captions` as legacy (still callable, but no longer auto-invoked from `shotstack-render-status`).

Schema: `ai_video_clips.actual_duration_seconds NUMERIC(5,2)`.

---

### Phase 2 — Smart transitions (J-cuts / L-cuts)

- `ai-video-director`: tool schema gains `transition_type` (`hard_cut` | `j_cut` | `l_cut` | `fade_black`) and `overlap_seconds` per shot, plus prompt guidance for when to pick which.
- `compose-video`: implement overlaps in the Shotstack timeline — J-cut starts next clip's audio 0.3s early; L-cut extends prior audio 0.5s into next clip's video; subtle 0.3s cross-dissolve on J/L; full fade-through-black only on `fade_black`. Recompute total duration accounting for overlaps.

Schema: `ai_video_clips.transition_type TEXT DEFAULT 'hard_cut'`, `transition_overlap_seconds NUMERIC(3,2) DEFAULT 0`.

---

### Phase 3 — Cost reductions

- **Storyboard preview gate**: new project status `storyboard_review` between `shot_list_review` and Veo generation. `AIVideoStudioPage.tsx` gets a Storyboard panel: cards per shot with prompt summary, VO text, overlay preview, transition tag, editable inline. "Generate Video" button is the only thing that fires Veo.
- **1 take by default**: `generate-veo-clip` defaults to `number_of_videos: 1`. New "Try Another Take" button per clip generates an additional option on demand and appends to `ai_video_clips.options`.

---

### Phase 4 — Feedback routing engine + targeted UI

- New edge function `classify-video-feedback`: Claude classifies free-form feedback → `{ category, affected_clips[], changes, estimated_cost }`. Categories: OVERLAY_EDIT, CAPTION_EDIT, TIMING_EDIT, VO_EDIT, MUSIC_EDIT, VISUAL_EDIT.
- New edge function `apply-video-edit`: executes the cheapest action — patches Shotstack JSON for overlay/caption/timing edits and re-renders only; calls `generate-voiceover` for a single segment on VO_EDIT; calls `generate-veo-clip` for one clip on VISUAL_EDIT (with Director rewriting just that prompt and showing a diff).
- **Quick Fix panel** (frontend, no AI cost): phone, CTA, disclaimer, end card text, caption font size, caption style preset, music volume, clip reorder. Batches into one re-render with a clear "$0.03, ~30s" indicator.
- **Click-to-edit overlay** on the preview player: timeline highlights active clip; clicking text overlays opens inline editors; clicking subtitles opens caption editor with timing handles; free-form feedback box at bottom routes through classifier with cost preview before confirm.

Schema:
- `ai_video_renders`: `feedback_category TEXT`, `feedback_text TEXT`, `changes_applied JSONB`, `cost_estimate NUMERIC(6,4)`, `is_quick_fix BOOL DEFAULT false`.
- New table `ai_video_feedback_log` (project_id, render_id, feedback_text, classification JSONB, action_taken TEXT, cost_actual NUMERIC, created_by_id, created_at) with RLS via `has_client_access` on the project's client.

---

### Risks / notes

- Deno doesn't have a clean MP4 duration lib; I'll inline a tiny `mvhd` atom reader (~30 lines) rather than pulling ffmpeg.
- ElevenLabs `with-timestamps` returns base64 audio + alignment in one JSON response; existing upload flow stays the same, just a different parse step.
- Each phase ships independently and is verifiable on a fresh render.

### Suggested order

Recommend shipping **Phase 1 first** in isolation — it alone fixes the bulk of the "robotic captions / drift" complaint and makes Phases 2–4 trivially correct. Want me to start there, or run all 4 phases back-to-back?
