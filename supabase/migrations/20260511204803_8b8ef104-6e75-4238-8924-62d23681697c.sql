ALTER TABLE public.onboarding_tokens
  ADD COLUMN IF NOT EXISTS kickoff_video_url text,
  ADD COLUMN IF NOT EXISTS kickoff_intro text,
  ADD COLUMN IF NOT EXISTS kickoff_action_items jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
DECLARE
  v_client_id uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE slug = 'evolve';

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (name, slug, color, status)
    VALUES ('Evolve', 'evolve', '#3CAB7A', 'active')
    RETURNING id INTO v_client_id;
  END IF;

  SELECT id INTO v_existing FROM public.onboarding_tokens WHERE client_id = v_client_id LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.onboarding_tokens (
      token, client_id, client_name, company, status,
      assigned_emails, kickoff_intro, kickoff_action_items
    ) VALUES (
      'evolve' || replace(gen_random_uuid()::text, '-', ''),
      v_client_id,
      'Evolve',
      'Welcome to Evolve',
      'invited',
      ARRAY['kenneth@welcometoevolve.com', 'ruairi@welcometoevolve.com'],
      'Thanks for the kickoff call! Here''s a quick recap from Charles plus the items we need from your team to launch Final Expense.',
      '[
        {"id":"everflow_login","label":"Provide Everflow login (publisher account for CPM)","owner":"Evolve","status":"pending"},
        {"id":"meta_ad_account","label":"Add CPM to the new Meta Ads account being set up for our traffic","owner":"Evolve","status":"pending"},
        {"id":"creative_dos_donts","label":"Share creative do''s & don''ts for e-coverage and SelectQuote (Final Expense)","owner":"Evolve","status":"pending"},
        {"id":"life_specialists_offer","label":"Share details on the Life Specialists offer (lower payout, higher CVR test)","owner":"Evolve","status":"pending"},
        {"id":"landing_page_requirements","label":"Document landing page requirements/disclaimers (TrustedForm, Jornaya, etc.) for buyer pages","owner":"Evolve","status":"pending"},
        {"id":"dayparting_schedule","label":"Confirm dayparting schedule per offer (e-coverage off Fri/weekends, SelectQuote off weekends)","owner":"Evolve","status":"pending"},
        {"id":"select_quote_prelander","label":"Decide on SelectQuote pre-lander approach (CPM to build if needed)","owner":"CPM","status":"pending"},
        {"id":"postback_setup","label":"Set up Everflow → Meta postback for conversion tracking","owner":"CPM","status":"pending"}
      ]'::jsonb
    );
  END IF;
END $$;