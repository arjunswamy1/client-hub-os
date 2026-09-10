select cron.schedule(
  'sync-universal-ads-cannaball',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/sync-universal-ads',
    headers := jsonb_build_object('Content-Type','application/json','Lovable-Context','cron'),
    body := jsonb_build_object('client_id','a1dabea1-5518-4c7f-a29d-23739cb52f9b','days',7)
  );
  $$
);