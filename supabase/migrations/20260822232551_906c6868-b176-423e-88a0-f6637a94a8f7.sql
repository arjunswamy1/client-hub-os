select cron.unschedule('sync-roku-live') where exists (select 1 from cron.job where jobname = 'sync-roku-live');

select cron.schedule(
  'sync-roku-live',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-roku-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := '{"days": 2}'::jsonb
  );
  $$
);