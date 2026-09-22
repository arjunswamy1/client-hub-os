CREATE TABLE public.improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_surface text NOT NULL,
  category text NOT NULL,
  problem_statement text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_change text NOT NULL,
  generated_prompt text NOT NULL,
  feedback_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  injection_suspected boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  applied_note text,
  recurred_after_apply boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.improvement_proposals TO authenticated;
GRANT ALL ON public.improvement_proposals TO service_role;

ALTER TABLE public.improvement_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view improvement proposals"
  ON public.improvement_proposals FOR SELECT TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Admins and account managers can manage improvement proposals"
  ON public.improvement_proposals FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE TRIGGER update_improvement_proposals_updated_at
  BEFORE UPDATE ON public.improvement_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_improvement_proposals_open
  ON public.improvement_proposals (status, occurrences DESC, created_at DESC);

ALTER TABLE public.task_feedback
  ADD COLUMN IF NOT EXISTS slack_channel_id text,
  ADD COLUMN IF NOT EXISTS slack_ts text,
  ADD COLUMN IF NOT EXISTS slack_thread_ts text,
  ADD COLUMN IF NOT EXISTS slack_user_id text,
  ADD COLUMN IF NOT EXISTS permalink text,
  ADD COLUMN IF NOT EXISTS surface_target text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS category_confidence numeric,
  ADD COLUMN IF NOT EXISTS injection_suspected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS injection_signals jsonb,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS digest_post_id uuid REFERENCES public.task_digest_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS daily_update_id uuid REFERENCES public.client_daily_updates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES public.improvement_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_feedback_slack_message
  ON public.task_feedback (slack_channel_id, slack_ts)
  WHERE slack_channel_id IS NOT NULL AND slack_ts IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_feedback_uncategorised
  ON public.task_feedback (created_at DESC) WHERE category IS NULL;