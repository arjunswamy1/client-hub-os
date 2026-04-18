CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'rollup-tech-usage-hourly',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/rollup-tech-usage',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtd2p3c3hmcHp6cnVpdGV2bm14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTU3MzgsImV4cCI6MjA5MTMzMTczOH0.hA5JenwDGIUiz0PCpFB3dfmgGuKRoNrgAlU_LU-vgzU"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);