select cron.schedule(
  'extract-meeting-tasks-daily',
  '30 10 * * *',
  $$
  with n as (
    insert into public.cron_invocation_tokens (job_name) values ('extract-meeting-tasks') returning token
  )
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/extract-meeting-tasks',
    headers := jsonb_build_object('Content-Type','application/json','Lovable-Context','cron','x-cron-nonce',(select token::text from n)),
    body := '{}'::jsonb
  ) as request_id;
  $$
);