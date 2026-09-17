-- lovable-cron-fallback-reviewed: 4 runs/day; the rotating Slack bot token expires every 12 hours and must be refreshed on a schedule
-- The previous registration authenticated with a vault-held key that the function
-- does not accept (verified: HTTP 401). Use the project's single-use
-- cron_invocation_tokens nonce instead, which the function does accept.
select cron.unschedule('slack-token-refresh-every-6h');

select cron.schedule(
  'slack-token-refresh-every-6h',
  '17 */6 * * *',
  $$
  with n as (
    insert into public.cron_invocation_tokens (job_name)
    values ('slack-token-refresh')
    returning token
  )
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/slack-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'x-cron-nonce', (select token::text from n)
    ),
    body := '{}'::jsonb
  );
  $$
);