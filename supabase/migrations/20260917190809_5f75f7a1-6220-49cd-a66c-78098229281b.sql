-- lovable-cron-fallback-reviewed: 96 runs/day; Slack has no outbound push for channel history, so unanswered client questions can only be detected by polling, and a 15-minute ceiling on detection latency is the requirement
select cron.schedule(
  'sync-slack-every-15min',
  '*/15 * * * *',
  $$
  with jobs as (
    select distinct m.client_id
    from public.slack_channel_mappings m
    where m.sync_enabled = true
  ), n as (
    insert into public.cron_invocation_tokens (job_name)
    select 'sync-slack' from jobs
    returning token
  ), paired as (
    select j.client_id, t.token
    from (select client_id, row_number() over () rn from jobs) j
    join (select token, row_number() over () rn from n) t on t.rn = j.rn
  )
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-slack',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'x-cron-nonce', p.token::text
    ),
    body := jsonb_build_object('action', 'sync', 'client_id', p.client_id)
  )
  from paired p;
  $$
);