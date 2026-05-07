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

### Phase 2 — Smart transitions (J-cuts / L-cuts) ✅ SHIPPED

- `ai-video-director`: tool schema gains `transition_type` per shot + prompt guidance for when to pick which.
- `generate-veo-clip`: persists `transition_type` onto the `ai_video_clips` row.
- `compose-video`: precomputes a `ShotTiming[]` honoring transitions — J-cut = next VO/caption leads visual by 0.3s; L-cut = current VO bleeds 0.5s into next clip's video; fade_black = 0.4s fade-through-black on the seam (Shotstack `fade` in/out on the boundary clips). Captions follow audio timing, not video timing, so a J-cut caption appears at the audio start.

Schema: `ai_video_clips.transition_type TEXT DEFAULT 'hard_cut'`, `transition_overlap_seconds NUMERIC(3,2) DEFAULT 0`.

---

### Phase 3 — Cost reductions ✅ SHIPPED

- **1 take by default**: `generate-veo-clip` already produces a single take per call. New **"Try Another Take"** button per clip card calls `generate-veo-clip` with `append_take: true`, which appends to `generated_options[]` instead of overwriting and auto-selects the new take. A take selector dropdown appears on the clip card once 2+ options exist.
- (Storyboard preview gate deferred — the existing `shot_list_review` status + per-clip Generate buttons already act as the gate. We can add an explicit "approve storyboard" toggle later if needed.)

---

### Phase 4 — Feedback routing engine + targeted UI ✅ SHIPPED

- **`classify-video-feedback`** edge function: Claude (Sonnet 4.5, tool-use) classifies free-form feedback into `{ category, affected_clips[], changes, summary, estimated_cost }`. Categories: `OVERLAY_EDIT`, `CAPTION_EDIT`, `TIMING_EDIT`, `VO_EDIT`, `MUSIC_EDIT`, `VISUAL_EDIT`. Cost lookup table picks the cheapest viable action.
- **`apply-video-edit`** edge function: executes the patch — overlay/caption/timing/music edits write to `ai_video_projects` and recompose only ($0.03); VO_EDIT calls `generate-voiceover`; VISUAL_EDIT optionally rewrites the shot's `veo_prompt` and calls `generate-veo-clip` for the affected clip(s). Tags the resulting render with `feedback_category`/`feedback_text`/`changes_applied`/`cost_estimate`/`is_quick_fix` and writes an audit row to `ai_video_feedback_log`.
- **Quick Fix panel** (frontend, no AI cost): phone, CTA, end card text, disclaimer, music volume. Save-only or "Apply & Re-render" with a clear "$0.03, ~30s" indicator. Patches `ai_video_projects` and re-invokes `compose-video` directly.
- **Targeted Feedback panel** (frontend): textarea → "Analyze" calls the classifier and shows category badge, affected clips, summary, raw changes JSON, and `$X.XX` cost estimate. Confirm runs `apply-video-edit`. VISUAL_EDIT renders a destructive-styled badge so the user sees it's the expensive path before confirming.
- `compose-video` now reads project-level `phone_overlay`, `cta_overlay`, `disclaimer_overlay`, `end_card_text`, and `music_volume` (with fallback to `brand_kit`).

Schema:
- `ai_video_projects`: `phone_overlay`, `cta_overlay`, `disclaimer_overlay`, `end_card_text` TEXT; `music_volume` NUMERIC(3,2) DEFAULT 0.18.
- `ai_video_renders`: `feedback_category TEXT`, `feedback_text TEXT`, `changes_applied JSONB`, `cost_estimate NUMERIC(6,4)`, `is_quick_fix BOOL DEFAULT false`.
- New table `ai_video_feedback_log` (project_id, render_id, feedback_text, classification JSONB, action_taken TEXT, cost_actual NUMERIC, created_by_id, created_at) with RLS via `is_admin OR has_client_access` on the project's client.

---

### Status

All four phases shipped. Future iteration ideas: per-segment VO regeneration, click-to-edit overlay on the preview player with timeline scrubbing, and an explicit storyboard-approval gate.
