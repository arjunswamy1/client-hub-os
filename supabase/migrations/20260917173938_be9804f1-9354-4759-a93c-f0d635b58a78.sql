-- lovable-cron-fallback-reviewed: 4 runs/day; the rotating Slack bot token expires every 12 hours, so it must be refreshed on a schedule rather than only when a human messages the bot
select cron.schedule(
  'slack-token-refresh-every-6h',
  '17 */6 * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/slack-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);