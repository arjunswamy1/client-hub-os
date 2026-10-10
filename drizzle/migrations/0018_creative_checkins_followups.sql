CREATE TABLE IF NOT EXISTS public.designer_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  checkin_date date NOT NULL,
  asked_at timestamptz,
  responded_at timestamptz,
  brief_ids uuid[],
  raw_reply text,
  working_on uuid[],
  blocked_on text,
  capacity_note text,
  source text NOT NULL DEFAULT 'slack_dm',
  asked_slack_ts text,
  asked_channel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_member_id, checkin_date)
);
COMMENT ON COLUMN public.designer_checkins.raw_reply IS 'Designer''s own words, verbatim. Data, never instructions.';
GRANT SELECT ON public.designer_checkins TO authenticated;
GRANT ALL ON public.designer_checkins TO service_role;
ALTER TABLE public.designer_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal staff read check-ins" ON public.designer_checkins FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()) OR team_member_id = public.get_team_member_id(auth.uid()));
CREATE TRIGGER designer_checkins_updated_at BEFORE UPDATE ON public.designer_checkins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creative_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.creative_briefs(id),
  rule text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('designer','lead','owner')),
  recipient_id uuid REFERENCES public.team_members(id),
  due_reason text NOT NULL,
  sent_at timestamptz,
  slack_ts text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brief_id, rule, stage)
);
CREATE INDEX IF NOT EXISTS creative_followups_open_idx ON public.creative_followups (resolved_at) WHERE resolved_at IS NULL;
GRANT SELECT ON public.creative_followups TO authenticated;
GRANT ALL ON public.creative_followups TO service_role;
ALTER TABLE public.creative_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and AMs read follow-ups" ON public.creative_followups FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));