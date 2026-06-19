
ALTER TABLE public.creative_time_entries ALTER COLUMN brief_id DROP NOT NULL;
ALTER TABLE public.creative_time_entries ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.creative_time_entries ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'task';
-- Loosen the designer policy: allow logging non-task time (no brief) and updating own entries.
DROP POLICY IF EXISTS "Designers manage own time entries on assigned briefs" ON public.creative_time_entries;
CREATE POLICY "Designers manage own time entries"
  ON public.creative_time_entries
  FOR ALL
  USING (team_member_id = get_team_member_id(auth.uid()))
  WITH CHECK (team_member_id = get_team_member_id(auth.uid()));
