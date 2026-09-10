create or replace function public.is_account_manager(check_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = check_user_id and role = 'account_manager' and is_active = true);
$$;
create policy "Account managers view all time entries" on public.creative_time_entries
  for select to authenticated using (public.is_account_manager(auth.uid()));
create policy "Account managers view caps" on public.designer_monthly_caps
  for select to authenticated using (public.is_account_manager(auth.uid()));
grant select on public.creative_time_entries to authenticated;
grant select on public.designer_monthly_caps to authenticated;