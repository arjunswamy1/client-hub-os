-- lovable-cron-fallback-reviewed: 48 runs/day; scores pending task suggestions shortly after each Slack sync so the review queue reflects new client messages within the hour, and no suggestion sits unscored
select cron.schedule(
  'gate-task-candidates-every-30min',
  '7,37 * * * *',
  $$
  with n as (
    insert into public.cron_invocation_tokens (job_name) values ('gate-task-candidates') returning token
  )
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/gate-task-candidates',
    headers := jsonb_build_object('Content-Type','application/json','Lovable-Context','cron','x-cron-nonce',(select token::text from n)),
    body := '{"action":"run"}'::jsonb
  ) as request_id;
  $$
);