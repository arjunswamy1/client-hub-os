CREATE TABLE public.daily_update_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  for_date date,
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted','produced','skipped','failed')),
  reason text,
  calls numeric,
  revenue numeric,
  missing_figures text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, client_id)
);
GRANT SELECT ON public.daily_update_run_log TO authenticated;
GRANT ALL ON public.daily_update_run_log TO service_role;
ALTER TABLE public.daily_update_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read daily update run log" ON public.daily_update_run_log
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
COMMENT ON TABLE public.daily_update_run_log IS 'One row per enabled client per drafter run. A row left at attempted means the run died before that client finished — a silent skip made loud.';

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS update_context_note text;
COMMENT ON COLUMN public.clients.update_context_note IS 'A standing sentence printed in every daily update for this account (e.g. what CPM''s media there actually is).';