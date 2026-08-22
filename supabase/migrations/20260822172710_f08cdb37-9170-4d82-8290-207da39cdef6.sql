
CREATE TABLE public.jacuzzi_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  transaction_id text not null,
  transaction_date date not null,
  transaction_time time,
  lead_type text not null default 'call',
  station_code text,
  attributed_station text,
  toll_free_number text,
  caller_ani text,
  area_code text,
  billing_city text,
  billing_state text,
  billing_zip text,
  call_status text,
  payout_rate numeric not null default 0,
  source text not null default 'client_sheet',
  notes text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, transaction_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jacuzzi_leads TO authenticated;
GRANT ALL ON public.jacuzzi_leads TO service_role;
ALTER TABLE public.jacuzzi_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jacuzzi_leads_admin_all" ON public.jacuzzi_leads FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "jacuzzi_leads_team_read" ON public.jacuzzi_leads FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE TRIGGER trg_jacuzzi_leads_updated BEFORE UPDATE ON public.jacuzzi_leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_jacuzzi_leads_date ON public.jacuzzi_leads (client_id, transaction_date);

CREATE TABLE public.jacuzzi_delivery (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  station_code text not null,
  campaign_name text,
  impressions bigint not null default 0,
  spend numeric not null default 0,
  cpm numeric not null default 0,
  source text not null default 'sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, station_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jacuzzi_delivery TO authenticated;
GRANT ALL ON public.jacuzzi_delivery TO service_role;
ALTER TABLE public.jacuzzi_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jacuzzi_delivery_admin_all" ON public.jacuzzi_delivery FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "jacuzzi_delivery_team_read" ON public.jacuzzi_delivery FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE TRIGGER trg_jacuzzi_delivery_updated BEFORE UPDATE ON public.jacuzzi_delivery FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.jacuzzi_hourly_delivery (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  hour smallint not null,
  station_code text not null default 'CT14',
  impressions bigint not null default 0,
  spend numeric not null default 0,
  source text not null default 'roku_api',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, hour, station_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jacuzzi_hourly_delivery TO authenticated;
GRANT ALL ON public.jacuzzi_hourly_delivery TO service_role;
ALTER TABLE public.jacuzzi_hourly_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jacuzzi_hourly_admin_all" ON public.jacuzzi_hourly_delivery FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "jacuzzi_hourly_team_read" ON public.jacuzzi_hourly_delivery FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE TRIGGER trg_jacuzzi_hourly_updated BEFORE UPDATE ON public.jacuzzi_hourly_delivery FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.jacuzzi_payout_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  effective_from date not null,
  rate numeric not null,
  created_at timestamptz not null default now(),
  unique (client_id, effective_from)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jacuzzi_payout_rates TO authenticated;
GRANT ALL ON public.jacuzzi_payout_rates TO service_role;
ALTER TABLE public.jacuzzi_payout_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jacuzzi_rates_admin_all" ON public.jacuzzi_payout_rates FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "jacuzzi_rates_team_read" ON public.jacuzzi_payout_rates FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
