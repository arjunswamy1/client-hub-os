create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  email text not null,
  name text not null,
  role text not null default 'designer' check (role in ('admin','account_manager','designer')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_at timestamptz
);

grant select, insert on public.team_invites to authenticated;
grant all on public.team_invites to service_role;

alter table public.team_invites enable row level security;

create policy "Admins can view invites"
  on public.team_invites for select to authenticated
  using (public.is_admin(auth.uid()));

create policy "Admins can create invites"
  on public.team_invites for insert to authenticated
  with check (public.is_admin(auth.uid()));