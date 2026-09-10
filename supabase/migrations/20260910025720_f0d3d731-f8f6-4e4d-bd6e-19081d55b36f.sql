-- lovable-cron-fallback-reviewed: 96 runs/day; CallGrid has no push feed configured for this account, near-real-time call dashboard needs 15-minute polling like the other client syncs
select cron.unschedule('cannaball-sync-callgrid') where exists (select 1 from cron.job where jobname = 'cannaball-sync-callgrid');

select cron.schedule(
  'cannaball-sync-callgrid',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/cannaball-sync-callgrid',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := '{"days": 2}'::jsonb
  );
  $$
);