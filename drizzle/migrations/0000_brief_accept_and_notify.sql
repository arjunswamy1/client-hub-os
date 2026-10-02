-- Queue the designer DM on the transition INTO submitted (or a reassignment while
-- submitted). The row is written before any Slack call; the unique dedupe_key is
-- what makes "exactly one DM per (brief, assignee)" true across retries.
CREATE OR REPLACE FUNCTION public.queue_brief_designer_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_slack text;
BEGIN
  IF NEW.status <> 'submitted' OR NEW.assigned_to_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted'
     AND OLD.assigned_to_id IS NOT DISTINCT FROM NEW.assigned_to_id THEN
    RETURN NEW; -- already submitted, same assignee: an edit, not a transition
  END IF;
  SELECT NULLIF(trim(slack_user_id), '') INTO v_slack FROM team_members WHERE id = NEW.assigned_to_id;
  INSERT INTO brief_notifications (brief_id, kind, recipient_team_member_id, recipient_slack_user_id, status, last_error, dedupe_key)
  VALUES (NEW.id, 'designer_assigned', NEW.assigned_to_id, v_slack,
          CASE WHEN v_slack IS NULL THEN 'skipped_no_slack_mapping' ELSE 'pending' END,
          CASE WHEN v_slack IS NULL THEN 'Assigned designer has no slack_user_id on team_members' END,
          'brief:' || NEW.id || ':designer_assigned:' || NEW.assigned_to_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER creative_briefs_queue_designer_notification
AFTER INSERT OR UPDATE OF status, assigned_to_id ON public.creative_briefs
FOR EACH ROW EXECUTE FUNCTION public.queue_brief_designer_notification();

-- The ONE accept statement. Slack and tracker both call this; authorisation and
-- staleness are a single conditional UPDATE, never read-then-write. On success the
-- owner_accepted notification is queued in the same transaction (dedupe key has
-- no assignee: acceptance happens once per brief).
CREATE OR REPLACE FUNCTION public.accept_creative_brief_as(p_brief_id uuid, p_actor uuid, p_via text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; b record; v_owner_slack text; v_assignee_name text;
BEGIN
  IF p_via NOT IN ('slack','tracker') THEN RAISE EXCEPTION 'invalid accepted_via %', p_via; END IF;
  IF p_actor IS NULL THEN RETURN jsonb_build_object('outcome','rejected_unknown_actor'); END IF;

  UPDATE creative_briefs
     SET status = 'in_design', accepted_by_id = p_actor, accepted_at = now(), accepted_via = p_via
   WHERE id = p_brief_id AND assigned_to_id = p_actor AND status = 'submitted'
     AND accepted_at IS NULL AND deleted_at IS NULL
  RETURNING id, created_by_id, accepted_at INTO r;

  IF r.id IS NOT NULL THEN
    SELECT NULLIF(trim(slack_user_id),'') INTO v_owner_slack FROM team_members WHERE id = r.created_by_id;
    IF r.created_by_id IS NOT NULL THEN
      INSERT INTO brief_notifications (brief_id, kind, recipient_team_member_id, recipient_slack_user_id, status, last_error, dedupe_key)
      VALUES (p_brief_id, 'owner_accepted', r.created_by_id, v_owner_slack,
              CASE WHEN v_owner_slack IS NULL THEN 'skipped_no_slack_mapping' ELSE 'pending' END,
              CASE WHEN v_owner_slack IS NULL THEN 'Brief owner has no slack_user_id on team_members' END,
              'brief:' || p_brief_id || ':owner_accepted')
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('outcome','accepted','accepted_at',r.accepted_at,'owner_id',r.created_by_id);
  END IF;

  -- Zero rows: a follow-up read only decides which refusal to report.
  SELECT cb.status, cb.assigned_to_id, cb.accepted_at, cb.accepted_by_id, cb.deleted_at INTO b
    FROM creative_briefs cb WHERE cb.id = p_brief_id;
  IF NOT FOUND OR b.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','rejected_not_submitted','detail','brief not found or deleted');
  END IF;
  IF b.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','rejected_already_accepted','accepted_at',b.accepted_at,
      'accepted_by', (SELECT name FROM team_members WHERE id = b.accepted_by_id));
  END IF;
  IF b.assigned_to_id IS DISTINCT FROM p_actor THEN
    SELECT name INTO v_assignee_name FROM team_members WHERE id = b.assigned_to_id;
    RETURN jsonb_build_object('outcome','rejected_not_assignee',
      'reassigned', EXISTS (SELECT 1 FROM brief_notifications n WHERE n.brief_id = p_brief_id
                             AND n.kind = 'designer_assigned' AND n.recipient_team_member_id = p_actor),
      'current_assignee', v_assignee_name);
  END IF;
  RETURN jsonb_build_object('outcome','rejected_not_submitted','status',b.status);
END $$;

REVOKE ALL ON FUNCTION public.accept_creative_brief_as(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_creative_brief_as(uuid, uuid, text) TO service_role;

-- Tracker entrypoint: the actor is always the signed-in user, never a parameter.
CREATE OR REPLACE FUNCTION public.accept_creative_brief(p_brief_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.accept_creative_brief_as(p_brief_id, public.get_team_member_id(auth.uid()), 'tracker');
$$;
REVOKE ALL ON FUNCTION public.accept_creative_brief(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_creative_brief(uuid) TO authenticated;