// Phase 4: Executes a classified edit using the cheapest possible action.
// Quick-fix categories (overlay/caption/timing/music) only patch project state and recompose.
// VO_EDIT regenerates voiceover. VISUAL_EDIT regenerates a single Veo clip.
// Logs the action in ai_video_feedback_log and tags the resulting render.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const {
      project_id,
      feedback_text,
      classification, // { category, affected_clips, changes, estimated_cost, summary }
      is_quick_fix,
      parent_render_id,
    } = body;

    if (!project_id || !classification?.category) {
      return json({ error: "project_id and classification.category required" }, 400);
    }

    const category: string = classification.category;
    const changes: any = classification.changes ?? {};
    const affected: number[] = Array.isArray(classification.affected_clips) ? classification.affected_clips : [];

    // Look up team_member id for audit trail (table column is created_by_id, project schema).
    const { data: tm } = await admin.from("team_members").select("id").eq("user_id", userData.user.id).maybeSingle();

    const { data: project, error: pErr } = await admin.from("ai_video_projects").select("*").eq("id", project_id).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const projectUpdate: Record<string, any> = {};
    let actionTaken = "recompose";

    // Apply patches by category.
    if (category === "OVERLAY_EDIT") {
      if (changes.phone !== undefined) projectUpdate.phone_overlay = String(changes.phone || "");
      if (changes.cta !== undefined) projectUpdate.cta_overlay = String(changes.cta || "");
      if (changes.disclaimer !== undefined) projectUpdate.disclaimer_overlay = String(changes.disclaimer || "");
      if (changes.end_card !== undefined || changes.end_card_text !== undefined) {
        projectUpdate.end_card_text = String(changes.end_card ?? changes.end_card_text ?? "");
      }
    } else if (category === "CAPTION_EDIT") {
      const cs = (project as any).caption_settings ?? {};
      const next = { ...cs };
      if (changes.font_size !== undefined) next.font_size = Number(changes.font_size);
      if (changes.words_per_chunk !== undefined) next.words_per_chunk = Number(changes.words_per_chunk);
      if (changes.background_opacity !== undefined) next.background_opacity = Number(changes.background_opacity);
      if (changes.fade_duration !== undefined) next.fade_duration = Number(changes.fade_duration);
      if (changes.style !== undefined) projectUpdate.caption_style = String(changes.style);
      projectUpdate.caption_settings = next;
    } else if (category === "MUSIC_EDIT") {
      if (changes.music_volume !== undefined) projectUpdate.music_volume = Math.max(0, Math.min(1, Number(changes.music_volume)));
      if (changes.music_prompt !== undefined) projectUpdate.music_prompt = String(changes.music_prompt);
    } else if (category === "TIMING_EDIT") {
      // Patch durations / trims / order on shot_list.
      const shots = Array.isArray((project as any).shot_list) ? [...(project as any).shot_list] : [];
      const setShot = (cn: number, patch: Record<string, any>) => {
        const idx = shots.findIndex((s: any) => Number(s.clip_number) === cn);
        if (idx >= 0) shots[idx] = { ...shots[idx], ...patch };
      };
      // Pattern 1: explicit clip_N_duration / clip_N_trim_start
      Object.entries(changes).forEach(([k, v]) => {
        const md = k.match(/^clip_(\d+)_duration$/);
        if (md) setShot(Number(md[1]), { duration_seconds: Math.max(0.5, Math.min(8, Number(v))) });
        const mt = k.match(/^clip_(\d+)_trim_start$/);
        if (mt) setShot(Number(mt[1]), { trim_start_seconds: Math.max(0, Math.min(8, Number(v))) });
      });
      // Pattern 2: affected_clips + trim_start / trim_end (treat as "remove seconds [trim_start..trim_end] from each clip")
      const ts = changes.trim_start !== undefined ? Number(changes.trim_start) : null;
      const te = changes.trim_end !== undefined ? Number(changes.trim_end) : null;
      if (affected.length && (ts !== null || te !== null)) {
        for (const cn of affected) {
          const cur = shots.find((s: any) => Number(s.clip_number) === cn);
          const sourceLen = Number(cur?.duration_seconds) > 0 ? Number(cur.duration_seconds) : 8;
          const start = ts !== null ? Math.max(0, ts) : 0;
          const end = te !== null ? Math.min(sourceLen, te) : sourceLen;
          // Two interpretations: if trim_start>0 keep [0..start] (drop tail), else trim from front.
          // Most common feedback is "cut seconds X to Y" = remove that range. If start==0 → keep [end..sourceLen] (trim front).
          // Otherwise → keep [0..start] (drop tail). Pick whichever leaves more content.
          const keepHead = start;
          const keepTail = sourceLen - end;
          if (keepHead >= keepTail) {
            setShot(cn, { duration_seconds: Math.max(0.5, keepHead), trim_start_seconds: 0 });
          } else {
            setShot(cn, { duration_seconds: Math.max(0.5, keepTail), trim_start_seconds: end });
          }
        }
      }
      if (Array.isArray(changes.order)) {
        const order: number[] = changes.order.map((n: any) => Number(n));
        const reordered = order.map((cn) => shots.find((s: any) => Number(s.clip_number) === cn)).filter(Boolean);
        if (reordered.length === shots.length) projectUpdate.shot_list = reordered;
        else projectUpdate.shot_list = shots;
      } else {
        projectUpdate.shot_list = shots;
      }
    }

    if (Object.keys(projectUpdate).length > 0) {
      const { error: uErr } = await admin.from("ai_video_projects").update(projectUpdate).eq("id", project_id);
      if (uErr) return json({ error: uErr.message }, 500);
    }

    // Side-effect calls for VO_EDIT / VISUAL_EDIT.
    let triggered: string[] = [];
    if (category === "VO_EDIT") {
      // For now regenerate the entire VO (segments). A future iteration can target a single segment.
      if (changes.vo_script) {
        await admin.from("ai_video_projects").update({ vo_script: String(changes.vo_script) }).eq("id", project_id);
      }
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-voiceover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ project_id }),
      });
      await r.text();
      triggered.push("generate-voiceover");
      actionTaken = "regenerate_voiceover";
    } else if (category === "VISUAL_EDIT") {
      const targets = affected.length ? affected : [];
      if (targets.length === 0) {
        return json({ error: "VISUAL_EDIT requires affected_clips" }, 400);
      }
      // Optional prompt rewrite: apply to shot_list before generating.
      if (changes.veo_prompt && targets.length === 1) {
        const shots = Array.isArray((project as any).shot_list) ? [...(project as any).shot_list] : [];
        const idx = shots.findIndex((s: any) => Number(s.clip_number) === targets[0]);
        if (idx >= 0) {
          shots[idx] = { ...shots[idx], veo_prompt: String(changes.veo_prompt) };
          await admin.from("ai_video_projects").update({ shot_list: shots }).eq("id", project_id);
        }
      }
      for (const cn of targets) {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-veo-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ project_id, clip_number: cn }),
        });
        await r.text();
      }
      triggered.push(`generate-veo-clip(${targets.join(",")})`);
      actionTaken = "regenerate_clip";
      // Don't recompose immediately — Veo runs in background. Caller can recompose after clip(s) finish.
    }

    // Recompose for non-Veo edits (overlay/caption/timing/music). VO_EDIT also recomposes after audio settles client-side.
    let renderId: string | null = null;
    if (category !== "VISUAL_EDIT" && category !== "VO_EDIT") {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/compose-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ project_id, parent_render_id: parent_render_id ?? null }),
      });
      const txt = await r.text();
      try {
        const j = JSON.parse(txt);
        renderId = j.render_id ?? null;
      } catch { /* ignore */ }
      triggered.push("compose-video");

      // Tag the new render with feedback metadata.
      if (renderId) {
        await admin.from("ai_video_renders").update({
          feedback_category: category,
          feedback_text: feedback_text ?? null,
          changes_applied: { ...changes, affected_clips: affected, summary: classification.summary },
          cost_estimate: classification.estimated_cost ?? null,
          is_quick_fix: Boolean(is_quick_fix),
        }).eq("id", renderId);
      }
    }

    // Audit log.
    await admin.from("ai_video_feedback_log").insert({
      project_id,
      render_id: renderId,
      feedback_text: feedback_text ?? classification.summary ?? "(no text)",
      classification,
      action_taken: actionTaken,
      cost_actual: classification.estimated_cost ?? null,
      created_by_id: tm?.id ?? null,
    });

    return json({ ok: true, render_id: renderId, action_taken: actionTaken, triggered });
  } catch (e) {
    console.error("apply-video-edit error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
