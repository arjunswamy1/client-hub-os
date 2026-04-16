
CREATE POLICY "Client users view assigned client ringba calls"
  ON public.ringba_calls FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = ringba_calls.client_id AND cu.user_id = auth.uid()
    )
  );
