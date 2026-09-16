-- lovable-cron-fallback-reviewed: 96 runs/day; 15-minute call sync matches every other client's sync cadence and keeps calls near-real-time for dashboards
select cron.schedule(
  'sync-ringba-calls-hablyte-every-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-ringba-calls-hablyte',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := '{"days_back": 3}'::jsonb
  );
  $$
);