CREATE TABLE public.data_integrity_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  reason text NOT NULL,
  created_by_id uuid REFERENCES public.team_members(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_integrity_exceptions TO authenticated;
GRANT ALL ON public.data_integrity_exceptions TO service_role;

ALTER TABLE public.data_integrity_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view integrity exceptions"
  ON public.data_integrity_exceptions FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE POLICY "Team can manage integrity exceptions"
  ON public.data_integrity_exceptions FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE INDEX idx_integrity_exceptions_client_check
  ON public.data_integrity_exceptions (client_id, check_key);