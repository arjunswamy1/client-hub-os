ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS campaign_spend_source_tables text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.clients.campaign_spend_source_tables IS
  'Spend feeds that carry a campaign dimension, for per-campaign and per-vertical reads. Empty = campaign-level spend is NOT recorded for this account; readers must report that as a setup gap, never as $0 and never by falling back to an account-level total.';

COMMENT ON COLUMN public.client_verticals.ringba_patterns IS
  'Patterns matched against the CALL FEED campaign name to assign CALLS (and therefore revenue) to this vertical. Applies to every call feed - ringba_calls, ringba_calls_4js, cannaball_calls, moja_calls, ringfuel_calls - not only Ringba. Supports * wildcards. Empty = calls cannot be assigned to this vertical, which is a setup gap, not zero calls.';

COMMENT ON COLUMN public.client_verticals.meta_patterns IS
  'Patterns matched against campaign / ad names on the SPEND side to assign SPEND to this vertical. Supports * wildcards.';

-- Campaign-level spend feeds, measured from the data that actually exists.
UPDATE public.clients SET campaign_spend_source_tables = '{ad_campaigns}'
  WHERE slug IN ('hablyte','buyologyiq','ppc-media','rrm');
UPDATE public.clients SET campaign_spend_source_tables = '{roku_daily_metrics}'
  WHERE slug IN ('cannaball','jacuzzi','spektrafin','ratequote');
UPDATE public.clients SET campaign_spend_source_tables = '{universal_ads_geo_metrics}'
  WHERE slug = 'hear-com';
UPDATE public.clients SET campaign_spend_source_tables = '{platform_spend_4js}'
  WHERE slug = '4js';

-- Link Hablyte's verticals to the call campaigns that feed them.
UPDATE public.client_verticals SET ringba_patterns = '{Home Insurance,*Home Insurance*}'
  WHERE vertical_id = 'home-insurance'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'hablyte');
UPDATE public.client_verticals SET ringba_patterns = '{Auto RTB,Auto RTB - Ping,*Auto*}'
  WHERE vertical_id = 'auto-insurance'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'hablyte');

-- PPC Media: the CallGrid campaign name carries vertical and language.
UPDATE public.client_verticals SET ringba_patterns = '{*| Home | EN*}'
  WHERE vertical_id = 'home-insurance'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'ppc-media');
UPDATE public.client_verticals SET ringba_patterns = '{*| Home | ES*}'
  WHERE vertical_id = 'home-insurance-es'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'ppc-media');
UPDATE public.client_verticals SET ringba_patterns = '{*| Auto | EN*}'
  WHERE vertical_id = 'auto-insurance'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'ppc-media');
UPDATE public.client_verticals SET ringba_patterns = '{*| Auto | ES*}'
  WHERE vertical_id = 'auto-insurance-es'
    AND client_id = (SELECT id FROM public.clients WHERE slug = 'ppc-media');