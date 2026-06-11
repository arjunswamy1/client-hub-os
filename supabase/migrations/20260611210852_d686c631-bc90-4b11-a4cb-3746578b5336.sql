DROP POLICY IF EXISTS "Client users manage own onboarding" ON public.onboarding_responses;
CREATE POLICY "Client users manage onboarding by client" ON public.onboarding_responses
FOR ALL TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.client_users cu WHERE cu.user_id = auth.uid() AND cu.client_id = onboarding_responses.client_id)
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.client_users cu WHERE cu.user_id = auth.uid() AND cu.client_id = onboarding_responses.client_id)
);