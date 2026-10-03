ALTER TABLE public.client_daily_updates
  ADD COLUMN IF NOT EXISTS form text CHECK (form IS NULL OR form IN ('one_line','full','prompt')),
  ADD COLUMN IF NOT EXISTS triggers jsonb,
  ADD COLUMN IF NOT EXISTS context_used jsonb;

CREATE TABLE IF NOT EXISTS public.task_digest_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind text NOT NULL CHECK (item_kind IN ('task','brief')),
  item_id uuid NOT NULL,
  assignee_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  escalated_to_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  days_late integer NOT NULL,
  digest_date date NOT NULL,
  slack_ts text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_kind, item_id)
);
GRANT SELECT ON public.task_digest_escalations TO authenticated;
GRANT ALL ON public.task_digest_escalations TO service_role;
ALTER TABLE public.task_digest_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and AMs read digest escalations" ON public.task_digest_escalations
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));