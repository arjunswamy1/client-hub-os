-- Creative requests: hold reason/start/original due date; change log hardening.

-- 1. Hold fields. Set only by the hold guard trigger (start + original due date) and by the writer (reason).
ALTER TABLE public.creative_briefs ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE public.creative_briefs ADD COLUMN IF NOT EXISTS hold_started_at timestamptz;
ALTER TABLE public.creative_briefs ADD COLUMN IF NOT EXISTS hold_original_due_date date;
COMMENT ON COLUMN public.creative_briefs.hold_reason IS 'Why the request is on hold. Required to enter on_hold (trigger creative_brief_hold_guard); cleared when it leaves hold (the change log keeps it).';
COMMENT ON COLUMN public.creative_briefs.hold_started_at IS 'When the current hold started. Set by trigger; null when not on hold.';
COMMENT ON COLUMN public.creative_briefs.hold_original_due_date IS 'Due date at the moment the hold started. Set by trigger; null when not on hold.';

CREATE OR REPLACE FUNCTION public.creative_brief_hold_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'on_hold' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'on_hold') THEN
    IF NULLIF(btrim(COALESCE(NEW.hold_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'hold_reason_required: a reason is required to put a request on hold' USING ERRCODE = '23514';
    END IF;
    NEW.hold_reason := btrim(NEW.hold_reason);
    NEW.hold_started_at := now();
    NEW.hold_original_due_date := CASE WHEN TG_OP = 'INSERT' THEN NEW.due_date ELSE OLD.due_date END;
  ELSIF NEW.status = 'on_hold' THEN
    NEW.hold_started_at := OLD.hold_started_at;
    NEW.hold_original_due_date := OLD.hold_original_due_date;
    IF NULLIF(btrim(COALESCE(NEW.hold_reason, '')), '') IS NULL THEN NEW.hold_reason := OLD.hold_reason; END IF;
  ELSE
    NEW.hold_reason := NULL; NEW.hold_started_at := NULL; NEW.hold_original_due_date := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS creative_briefs_hold_guard ON public.creative_briefs;
CREATE TRIGGER creative_briefs_hold_guard BEFORE INSERT OR UPDATE ON public.creative_briefs
  FOR EACH ROW EXECUTE FUNCTION public.creative_brief_hold_guard();
ALTER TABLE public.creative_briefs ENABLE ALWAYS TRIGGER creative_briefs_hold_guard;
REVOKE ALL ON FUNCTION public.creative_brief_hold_guard() FROM PUBLIC, anon, authenticated;

-- The agent write path may now carry hold_reason in its patch.
CREATE OR REPLACE FUNCTION public.agent_write_creative_brief(p_brief_id uuid, p_actor_id uuid, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_comment text, p_via text, p_note text, p_forced boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_before public.creative_briefs; v_after public.creative_briefs;
BEGIN
  SELECT * INTO v_before FROM public.creative_briefs WHERE id = p_brief_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('outcome', 'refused_stale', 'current_updated_at', v_before.updated_at);
  END IF;
  IF p_patch->>'status' = 'on_hold' AND v_before.status IS DISTINCT FROM 'on_hold' AND NULLIF(btrim(COALESCE(p_patch->>'hold_reason', '')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome', 'refused_hold_reason_required');
  END IF;
  PERFORM set_config('app.actor_id', p_actor_id::text, true);
  PERFORM set_config('app.via', COALESCE(p_via, 'agent'), true);
  PERFORM set_config('app.note', COALESCE(p_note, ''), true);
  PERFORM set_config('app.forced', COALESCE(p_forced, false)::text, true);
  UPDATE public.creative_briefs SET
    status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE status END,
    hold_reason = CASE WHEN p_patch ? 'hold_reason' THEN p_patch->>'hold_reason' ELSE hold_reason END,
    assigned_to_id = CASE WHEN p_patch ? 'assigned_to_id' THEN (p_patch->>'assigned_to_id')::uuid ELSE assigned_to_id END,
    due_date = CASE WHEN p_patch ? 'due_date' THEN (p_patch->>'due_date')::date ELSE due_date END,
    submitted_at = CASE WHEN p_patch ? 'submitted_at' THEN (p_patch->>'submitted_at')::timestamptz ELSE submitted_at END,
    approved_at = CASE WHEN p_patch ? 'approved_at' THEN (p_patch->>'approved_at')::timestamptz ELSE approved_at END,
    delivered_at = CASE WHEN p_patch ? 'delivered_at' THEN (p_patch->>'delivered_at')::timestamptz ELSE delivered_at END,
    closed_out_at = CASE WHEN p_patch ? 'closed_out_at' THEN (p_patch->>'closed_out_at')::timestamptz ELSE closed_out_at END,
    closed_out_by_id = CASE WHEN p_patch ? 'closed_out_at' THEN p_actor_id ELSE closed_out_by_id END,
    closed_out_note = CASE WHEN p_patch ? 'closed_out_note' THEN p_patch->>'closed_out_note' ELSE closed_out_note END
  WHERE id = p_brief_id
  RETURNING * INTO v_after;
  IF p_comment IS NOT NULL AND length(p_comment) > 0 THEN
    INSERT INTO public.creative_brief_comments (brief_id, author_id, content) VALUES (p_brief_id, p_actor_id, p_comment);
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'before', to_jsonb(v_before), 'after', to_jsonb(v_after));
END $function$;

-- 2. Change log: cascade with its brief; comment identity for scrubbing.
ALTER TABLE public.creative_brief_change_log DROP CONSTRAINT IF EXISTS creative_brief_change_log_brief_id_fkey;
ALTER TABLE public.creative_brief_change_log ADD CONSTRAINT creative_brief_change_log_brief_id_fkey
  FOREIGN KEY (brief_id) REFERENCES public.creative_briefs(id) ON DELETE CASCADE;
ALTER TABLE public.creative_brief_change_log ADD COLUMN IF NOT EXISTS comment_id uuid;
ALTER TABLE public.creative_brief_change_log ADD COLUMN IF NOT EXISTS comment_author_id uuid;
COMMENT ON COLUMN public.creative_brief_change_log.comment_id IS 'The comment a comment_* entry is about (no FK: the comment may be deleted).';
COMMENT ON COLUMN public.creative_brief_change_log.comment_author_id IS 'Team member who wrote the comment; for comment_deleted the only detail kept besides time and who deleted it.';
CREATE INDEX IF NOT EXISTS creative_brief_change_log_comment_idx ON public.creative_brief_change_log (comment_id) WHERE comment_id IS NOT NULL;

-- Backfill comment identity on existing entries (match by text on the same brief), then scrub text of already-deleted comments.
UPDATE public.creative_brief_change_log l SET comment_id = c.id, comment_author_id = c.author_id
FROM public.creative_brief_comments c
WHERE l.comment_id IS NULL AND l.field IN ('comment_added','comment_edited') AND c.brief_id = l.brief_id AND c.content = l.new_value;
DO $$
DECLARE d record; texts text[]; prev int;
BEGIN
  FOR d IN SELECT id, brief_id, old_value FROM public.creative_brief_change_log WHERE field = 'comment_deleted' AND old_value IS NOT NULL LOOP
    texts := ARRAY[d.old_value];
    LOOP
      prev := cardinality(texts);
      SELECT array_agg(DISTINCT v) INTO texts FROM (
        SELECT unnest(texts) v
        UNION SELECT old_value FROM public.creative_brief_change_log
          WHERE brief_id = d.brief_id AND field = 'comment_edited' AND comment_id IS NULL AND new_value = ANY (texts) AND old_value IS NOT NULL) s;
      EXIT WHEN cardinality(texts) = prev;
    END LOOP;
    UPDATE public.creative_brief_change_log SET old_value = NULL, new_value = NULL
      WHERE brief_id = d.brief_id AND field IN ('comment_added','comment_edited') AND comment_id IS NULL
        AND (old_value = ANY (texts) OR new_value = ANY (texts));
    UPDATE public.creative_brief_change_log SET old_value = NULL WHERE id = d.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.creative_brief_log_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; f text; o jsonb; n jsonb;
  fields text[] := ARRAY['status','hold_reason','assigned_to_id','due_date','scheduled_date','priority','title','objective','target_audience','key_message','notes','tone_style','dos_and_donts','copy_suggestions','creative_type','creative_types','platforms','sizes','num_concepts','funnel_stage','video_scripts','brand_guidelines_url','reference_assets','raw_footage_url','final_assets_url','drive_wip_folder_id','drive_approved_folder_id','deleted_at'];
BEGIN
  SELECT * INTO a FROM public.creative_brief_change_actor();
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  FOREACH f IN ARRAY fields LOOP
    IF (o->f) IS DISTINCT FROM (n->f) THEN
      INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via)
      VALUES (NEW.id, f, o->>f, n->>f, a.actor, a.kind, a.via);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.creative_brief_log_comment_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.creative_brief_change_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via, comment_id, comment_author_id)
    VALUES (NEW.brief_id, 'comment_added', NULL, NEW.content, COALESCE(a.actor, NEW.author_id), CASE WHEN a.actor IS NULL AND NEW.author_id IS NOT NULL THEN CASE WHEN EXISTS (SELECT 1 FROM public.team_members WHERE id = NEW.author_id AND is_service_account) THEN 'bot' ELSE 'user' END ELSE a.kind END, a.via, NEW.id, NEW.author_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via, comment_id, comment_author_id)
      VALUES (NEW.brief_id, 'comment_edited', OLD.content, NEW.content, a.actor, a.kind, a.via, NEW.id, NEW.author_id);
    END IF;
    RETURN NEW;
  ELSE
    -- The brief itself is being deleted (cascade): its log goes with it, nothing to record.
    IF NOT EXISTS (SELECT 1 FROM public.creative_briefs WHERE id = OLD.brief_id) THEN RETURN OLD; END IF;
    UPDATE public.creative_brief_change_log SET old_value = NULL, new_value = NULL WHERE comment_id = OLD.id;
    INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via, comment_id, comment_author_id)
    VALUES (OLD.brief_id, 'comment_deleted', NULL, NULL, a.actor, a.kind, a.via, OLD.id, OLD.author_id);
    RETURN OLD;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.creative_brief_log_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_brief_log_comment_changes() FROM PUBLIC, anon, authenticated;

-- 4. Log security.
REVOKE ALL ON public.creative_brief_change_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.creative_brief_change_log FROM authenticated;
GRANT SELECT ON public.creative_brief_change_log TO authenticated;
GRANT ALL ON public.creative_brief_change_log TO service_role;
ALTER TABLE public.creative_briefs ENABLE ALWAYS TRIGGER creative_briefs_log_changes;
ALTER TABLE public.creative_brief_comments ENABLE ALWAYS TRIGGER creative_brief_comments_log_changes;
DROP POLICY IF EXISTS "Assignee and creator read brief change log" ON public.creative_brief_change_log;
CREATE POLICY "Assignee and creator read brief change log" ON public.creative_brief_change_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.creative_briefs b WHERE b.id = brief_id
    AND public.get_team_member_id(auth.uid()) IS NOT NULL
    AND (b.assigned_to_id = public.get_team_member_id(auth.uid()) OR b.created_by_id = public.get_team_member_id(auth.uid()))));
COMMENT ON TABLE public.creative_brief_change_log IS 'Every change to a creative request, written only by ALWAYS triggers on creative_briefs and creative_brief_comments; no client role may write it. Actor: app.actor_id (set by agent_write_creative_brief and any job that acts for someone), else the signed-in user''s team member; with neither the entry is actor_kind ''system'' (background jobs that do not say who is acting). Deleted comments keep author and time only: their text is scrubbed from every entry.';
COMMENT ON FUNCTION public.creative_brief_change_actor() IS 'Actor for the creative change log: app.actor_id, else get_team_member_id(auth.uid()); neither = system. via from app.via. Bots: service accounts or via agent/mcp/bot.';