
-- Allow client_users to see ad_daily_metrics for their clients
CREATE POLICY "Client users view assigned client metrics"
  ON public.ad_daily_metrics FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = ad_daily_metrics.client_id AND cu.user_id = auth.uid()
    )
  );

-- Allow client_users to see ad_campaigns for their clients
CREATE POLICY "Client users view assigned client campaigns"
  ON public.ad_campaigns FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = ad_campaigns.client_id AND cu.user_id = auth.uid()
    )
  );

-- Allow client_users to see ad_creatives for their clients
CREATE POLICY "Client users view assigned client creatives"
  ON public.ad_creatives FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = ad_creatives.client_id AND cu.user_id = auth.uid()
    )
  );

-- Allow client_users to see ad_sets for their clients
CREATE POLICY "Client users view assigned client ad sets"
  ON public.ad_sets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = ad_sets.client_id AND cu.user_id = auth.uid()
    )
  );

-- Allow client_users to see client_verticals for their clients
CREATE POLICY "Client users view assigned client verticals"
  ON public.client_verticals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = client_verticals.client_id AND cu.user_id = auth.uid()
    )
  );

-- Allow client_users to see dashboard_configs for their clients
CREATE POLICY "Client users view assigned client dashboard configs"
  ON public.dashboard_configs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = dashboard_configs.client_id AND cu.user_id = auth.uid()
    )
  );
