
-- Comments table mirroring creative_brief_comments pattern
CREATE TABLE public.shoot_brief_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brief_id uuid NOT NULL REFERENCES public.shoot_briefs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_shoot_brief_comments_brief ON public.shoot_brief_comments(brief_id, created_at);

ALTER TABLE public.shoot_brief_comments ENABLE ROW LEVEL SECURITY;

-- Helper: can the current user see this shoot brief?
-- A user can see/comment if: admin OR assigned producer OR assigned designer (via linked creative brief)
-- OR creator OR has access to any of the linked clients.

CREATE POLICY "Admins manage all shoot brief comments"
ON public.shoot_brief_comments
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Team members view shoot brief comments"
ON public.shoot_brief_comments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.shoot_briefs sb
    WHERE sb.id = shoot_brief_comments.brief_id
      AND (
        sb.created_by_id = public.get_team_member_id(auth.uid())
        OR sb.assigned_producer_id = public.get_team_member_id(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.creative_briefs cb
          WHERE cb.id = sb.linked_creative_brief_id
            AND cb.assigned_to_id = public.get_team_member_id(auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM unnest(sb.client_ids) AS cid
          WHERE public.has_client_access(auth.uid(), cid)
        )
      )
  )
);

CREATE POLICY "Team members add shoot brief comments"
ON public.shoot_brief_comments
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = public.get_team_member_id(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.shoot_briefs sb
    WHERE sb.id = shoot_brief_comments.brief_id
      AND (
        sb.created_by_id = public.get_team_member_id(auth.uid())
        OR sb.assigned_producer_id = public.get_team_member_id(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.creative_briefs cb
          WHERE cb.id = sb.linked_creative_brief_id
            AND cb.assigned_to_id = public.get_team_member_id(auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM unnest(sb.client_ids) AS cid
          WHERE public.has_client_access(auth.uid(), cid)
        )
      )
  )
);

CREATE POLICY "Authors edit own shoot brief comments"
ON public.shoot_brief_comments
FOR UPDATE
TO authenticated
USING (author_id = public.get_team_member_id(auth.uid()));

CREATE POLICY "Authors delete own shoot brief comments"
ON public.shoot_brief_comments
FOR DELETE
TO authenticated
USING (author_id = public.get_team_member_id(auth.uid()));
