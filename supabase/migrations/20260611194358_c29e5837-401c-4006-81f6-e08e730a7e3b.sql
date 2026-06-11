
WITH new_client AS (
  INSERT INTO public.clients (name, slug, color, status)
  VALUES ('Spektrafin', 'spektrafin', '#3CAB7A', 'active')
  RETURNING id, name
)
INSERT INTO public.onboarding_tokens
  (token, client_id, client_name, company, status, kickoff_video_url, kickoff_action_items)
SELECT
  'spektrafin' || substr(md5(random()::text), 1, 10),
  id,
  name,
  'Spektrafin',
  'invited',
  'https://youtu.be/ktMXZY3vL58',
  '[
    {"id":"sp1","owner":"client","label":"Send credit card authorization form (RJ to coordinate with Charles) so we can fund media spend"},
    {"id":"sp2","owner":"client","label":"Grant CPM access to your in-house call tracking platform and confirm we can request dedicated TFNs per creative/campaign"},
    {"id":"sp3","owner":"client","label":"Brief your agents: CTV call volume skews heavier in the afternoon/evening; staff accordingly"},
    {"id":"sp4","owner":"client","label":"Confirm call center hours in platform: Mon–Fri 7a–6p PT, Sat 8a–2p PT (no Sundays for now)"},
    {"id":"sp5","owner":"client","label":"Introduce Omar (CPM dev) to your team to scope RedTrack spend integration"},
    {"id":"cpm1","owner":"cpm","label":"Shoot new creative Wednesday with top actress; finalize scripts around $2/day for $25K coverage, same-day coverage, living benefits, 24–48hr payout, any health condition accepted, tax-free cash value"},
    {"id":"cpm2","owner":"cpm","label":"Launch on 2–4 CTV platforms (Roku, Universal, etc.) with 2–3 creatives each — target launch Mon June 22 (sooner if ready), ~$2K/day to start"},
    {"id":"cpm3","owner":"cpm","label":"Configure targeting: nationwide excluding NY, ages up to 85, top geos CA/TX/GA/IL/FL/PA/NC/OH"},
    {"id":"cpm4","owner":"cpm","label":"Provision dedicated TFNs per creative + campaign and share naming convention with Spektrafin team"},
    {"id":"cpm5","owner":"cpm","label":"Spin up shared Slack channel and set weekly strategy/reporting cadence"}
  ]'::jsonb
FROM new_client;

SELECT 'https://connectpaidmedia.lovable.app/onboarding/' || token AS onboarding_url
FROM public.onboarding_tokens
WHERE client_name = 'Spektrafin'
ORDER BY created_at DESC
LIMIT 1;
