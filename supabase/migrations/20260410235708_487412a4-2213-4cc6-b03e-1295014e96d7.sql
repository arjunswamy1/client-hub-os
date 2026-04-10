
-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Team members access assigned client briefs" ON public.creative_briefs;

-- New policy: team members can access briefs for their assigned clients OR briefs with no client (internal) OR briefs assigned to them
CREATE POLICY "Team members access briefs"
ON public.creative_briefs
FOR ALL
TO authenticated
USING (
  has_client_access(auth.uid(), client_id)
  OR client_id IS NULL
  OR assigned_to_id = get_team_member_id(auth.uid())
  OR created_by_id = get_team_member_id(auth.uid())
)
WITH CHECK (
  has_client_access(auth.uid(), client_id)
  OR client_id IS NULL
  OR assigned_to_id = get_team_member_id(auth.uid())
  OR created_by_id = get_team_member_id(auth.uid())
);

-- Also fix related tables for NULL client_id briefs
DROP POLICY IF EXISTS "Team members access assigned client brief comments" ON public.creative_brief_comments;
CREATE POLICY "Team members access brief comments"
ON public.creative_brief_comments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM creative_briefs b
    WHERE b.id = creative_brief_comments.brief_id
    AND (
      has_client_access(auth.uid(), b.client_id)
      OR b.client_id IS NULL
      OR b.assigned_to_id = get_team_member_id(auth.uid())
      OR b.created_by_id = get_team_member_id(auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Team members access assigned client deliverables" ON public.creative_deliverables;
CREATE POLICY "Team members access deliverables"
ON public.creative_deliverables
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM creative_briefs b
    WHERE b.id = creative_deliverables.brief_id
    AND (
      has_client_access(auth.uid(), b.client_id)
      OR b.client_id IS NULL
      OR b.assigned_to_id = get_team_member_id(auth.uid())
      OR b.created_by_id = get_team_member_id(auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Team members access assigned client reviews" ON public.creative_reviews;
CREATE POLICY "Team members access reviews"
ON public.creative_reviews
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM creative_briefs b
    WHERE b.id = creative_reviews.brief_id
    AND (
      has_client_access(auth.uid(), b.client_id)
      OR b.client_id IS NULL
      OR b.assigned_to_id = get_team_member_id(auth.uid())
      OR b.created_by_id = get_team_member_id(auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Team members access assigned client deliverable versions" ON public.creative_deliverable_versions;
CREATE POLICY "Team members access deliverable versions"
ON public.creative_deliverable_versions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM creative_deliverables d
    JOIN creative_briefs b ON b.id = d.brief_id
    WHERE d.id = creative_deliverable_versions.deliverable_id
    AND (
      has_client_access(auth.uid(), b.client_id)
      OR b.client_id IS NULL
      OR b.assigned_to_id = get_team_member_id(auth.uid())
      OR b.created_by_id = get_team_member_id(auth.uid())
    )
  )
);
