-- Allow designers to manage their own time entries on briefs assigned to them
-- This fixes the case where a designer is assigned to a brief for a client
-- they don't have a client_assignments row for.

CREATE POLICY "Designers manage own time entries on assigned briefs"
ON public.creative_time_entries
FOR ALL
USING (
  team_member_id = public.get_team_member_id(auth.uid())
)
WITH CHECK (
  team_member_id = public.get_team_member_id(auth.uid())
);