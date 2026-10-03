ALTER TABLE public.brief_notifications DROP CONSTRAINT brief_notifications_kind_check;
ALTER TABLE public.brief_notifications ADD CONSTRAINT brief_notifications_kind_check
  CHECK (kind = ANY (ARRAY['designer_assigned','owner_accepted','designer_declined']));

ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS is_creative_lead boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.team_members.is_creative_lead IS 'Receives designer_declined notifications so a declined brief can be reassigned.';
UPDATE public.team_members SET is_creative_lead = true WHERE slack_user_id = 'U09HG10GAJ0';

-- Decline: status and assignee untouched. One conditional INSERT per recipient; the
-- WHERE clause is the authorisation, the dedupe_key makes a re-decline a no-op.
CREATE OR REPLACE FUNCTION public.decline_creative_brief_as(p_brief_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; b record; v_assignee_name text; v_key text;
BEGIN
  IF p_actor IS NULL THEN RETURN jsonb_build_object('outcome','rejected_unknown_actor'); END IF;
  v_key := 'brief:' || p_brief_id || ':designer_declined:' || p_actor;

  WITH ok AS (
    SELECT cb.id, cb.created_by_id FROM creative_briefs cb
     WHERE cb.id = p_brief_id AND cb.assigned_to_id = p_actor AND cb.status = 'submitted'
       AND cb.accepted_at IS NULL AND cb.deleted_at IS NULL
  ), recips AS (
    SELECT ok.id, tm.id AS tm_id, NULLIF(trim(tm.slack_user_id),'') AS slack, v_key AS k
      FROM ok JOIN team_members tm ON tm.id = ok.created_by_id AND tm.is_active
    UNION
    SELECT ok.id, tm.id, NULLIF(trim(tm.slack_user_id),''), v_key || ':creative_lead:' || tm.id
      FROM ok JOIN team_members tm ON tm.is_creative_lead AND tm.is_active
     WHERE tm.id IS DISTINCT FROM ok.created_by_id
  ), ins AS (
    INSERT INTO brief_notifications (brief_id, kind, recipient_team_member_id, recipient_slack_user_id, status, last_error, dedupe_key)
    SELECT id, 'designer_declined', tm_id, slack,
           CASE WHEN slack IS NULL THEN 'skipped_no_slack_mapping' ELSE 'pending' END,
           CASE WHEN slack IS NULL THEN 'Recipient has no slack_user_id' END, k
      FROM recips
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins) INTO n;

  IF n > 0 THEN RETURN jsonb_build_object('outcome','declined'); END IF;

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
      'reassigned', EXISTS (SELECT 1 FROM brief_notifications x WHERE x.brief_id = p_brief_id
                             AND x.kind = 'designer_assigned' AND x.recipient_team_member_id = p_actor),
      'current_assignee', v_assignee_name);
  END IF;
  IF b.status <> 'submitted' THEN
    RETURN jsonb_build_object('outcome','rejected_not_submitted','status',b.status);
  END IF;
  IF EXISTS (SELECT 1 FROM brief_notifications WHERE dedupe_key LIKE v_key || '%') THEN
    RETURN jsonb_build_object('outcome','duplicate_decline');
  END IF;
  RETURN jsonb_build_object('outcome','error','detail','decline recorded no recipients (no active owner or creative lead)');
END $$;
REVOKE ALL ON FUNCTION public.decline_creative_brief_as(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_creative_brief_as(uuid, uuid) TO service_role;