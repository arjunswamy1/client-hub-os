create table if not exists public.meta_geo_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  platform_campaign_id text,
  campaign_name text,
  region text not null,
  country text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, platform_campaign_id, region)
);

grant select on public.meta_geo_metrics to authenticated;
grant all on public.meta_geo_metrics to service_role;

alter table public.meta_geo_metrics enable row level security;

create policy "Team can view meta geo for their clients"
on public.meta_geo_metrics for select to authenticated
using (is_admin(auth.uid()) or has_client_access(auth.uid(), client_id));

create trigger trg_meta_geo_metrics_updated
before update on public.meta_geo_metrics
for each row execute function public.update_updated_at_column();

create index if not exists meta_geo_metrics_client_date_idx
on public.meta_geo_metrics (client_id, date);