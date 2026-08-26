select cron.schedule(
  'sync-ringba-calls-buyology-every-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-ringba-calls-buyology',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := '{"days_back": 3}'::jsonb
  );
  $$
);