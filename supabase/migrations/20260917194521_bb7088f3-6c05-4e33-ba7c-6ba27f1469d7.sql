ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.tasks ALTER COLUMN client_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_wispr_dedupe_key_idx
  ON public.tasks ((type_data->>'dedupe_key'))
  WHERE (type_data->>'dedupe_key') IS NOT NULL;

CREATE POLICY "Admins and AMs access agency tasks"
  ON public.tasks FOR ALL
  TO authenticated
  USING (client_id IS NULL AND (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid())))
  WITH CHECK (client_id IS NULL AND (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid())));