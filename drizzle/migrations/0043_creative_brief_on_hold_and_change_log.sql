ALTER TABLE public.creative_briefs DROP CONSTRAINT IF EXISTS creative_briefs_status_check;
ALTER TABLE public.creative_briefs ADD CONSTRAINT creative_briefs_status_check CHECK (status = ANY (ARRAY['draft','on_hold','submitted','in_design','ready_for_review','revision_requested','approved','delivered']));

CREATE TABLE public.creative_brief_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.creative_briefs(id),
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by_id uuid REFERENCES public.team_members(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','bot','system')),
  via text NOT NULL DEFAULT 'hub',
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.creative_brief_change_log IS 'Every change to a creative request, written only by triggers on creative_briefs and creative_brief_comments. Insert-only.';
GRANT SELECT ON public.creative_brief_change_log TO authenticated;
GRANT ALL ON public.creative_brief_change_log TO service_role;
ALTER TABLE public.creative_brief_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read brief change log with brief access" ON public.creative_brief_change_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.creative_briefs b WHERE b.id = brief_id AND (public.is_admin(auth.uid()) OR b.client_id IS NULL OR public.has_client_access(auth.uid(), b.client_id))));
CREATE INDEX creative_brief_change_log_brief_idx ON public.creative_brief_change_log (brief_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.creative_brief_change_actor(OUT actor uuid, OUT kind text, OUT via text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  IF actor IS NULL AND auth.uid() IS NOT NULL THEN actor := public.get_team_member_id(auth.uid()); END IF;
  via := COALESCE(NULLIF(current_setting('app.via', true), ''), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'hub' END);
  IF actor IS NULL THEN kind := 'system';
  ELSIF via IN ('agent','mcp','mcp-hub','slack_bot','bot') OR EXISTS (SELECT 1 FROM public.team_members WHERE id = actor AND is_service_account) THEN kind := 'bot';
  ELSE kind := 'user';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.creative_brief_log_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; f text; o jsonb; n jsonb;
  fields text[] := ARRAY['status','assigned_to_id','due_date','scheduled_date','priority','title','objective','target_audience','key_message','notes','tone_style','dos_and_donts','copy_suggestions','creative_type','creative_types','platforms','sizes','num_concepts','funnel_stage','video_scripts','brand_guidelines_url','reference_assets','raw_footage_url','final_assets_url','drive_wip_folder_id','drive_approved_folder_id','deleted_at'];
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
CREATE TRIGGER creative_briefs_log_changes AFTER UPDATE ON public.creative_briefs
  FOR EACH ROW EXECUTE FUNCTION public.creative_brief_log_changes();

CREATE OR REPLACE FUNCTION public.creative_brief_log_comment_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.creative_brief_change_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via)
    VALUES (NEW.brief_id, 'comment_added', NULL, NEW.content, COALESCE(a.actor, NEW.author_id), CASE WHEN a.actor IS NULL AND NEW.author_id IS NOT NULL THEN CASE WHEN EXISTS (SELECT 1 FROM public.team_members WHERE id = NEW.author_id AND is_service_account) THEN 'bot' ELSE 'user' END ELSE a.kind END, a.via);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via)
      VALUES (NEW.brief_id, 'comment_edited', OLD.content, NEW.content, a.actor, a.kind, a.via);
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO public.creative_brief_change_log (brief_id, field, old_value, new_value, changed_by_id, actor_kind, via)
    VALUES (OLD.brief_id, 'comment_deleted', OLD.content, NULL, a.actor, a.kind, a.via);
    RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER creative_brief_comments_log_changes AFTER INSERT OR UPDATE OR DELETE ON public.creative_brief_comments
  FOR EACH ROW EXECUTE FUNCTION public.creative_brief_log_comment_changes();

REVOKE ALL ON FUNCTION public.creative_brief_change_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_brief_log_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creative_brief_log_comment_changes() FROM PUBLIC, anon, authenticated;