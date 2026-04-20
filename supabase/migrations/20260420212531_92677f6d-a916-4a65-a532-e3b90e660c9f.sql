-- Schedule hourly sync jobs for Billy.com (Google Ads, Meta Ads, Ringba)
-- Runs every hour at :05, :10, :15 to stagger load.

SELECT cron.schedule(
  'sync-google-ads-billy-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-google-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('clientId', 'bca79e4b-e0da-42e6-ba79-0e3ae06011c8')
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'sync-meta-ads-billy-hourly',
  '10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-meta-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('clientId', 'bca79e4b-e0da-42e6-ba79-0e3ae06011c8')
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'sync-ringba-calls-billy-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-ringba-calls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('clientId', 'bca79e4b-e0da-42e6-ba79-0e3ae06011c8')
  ) AS request_id;
  $$
);