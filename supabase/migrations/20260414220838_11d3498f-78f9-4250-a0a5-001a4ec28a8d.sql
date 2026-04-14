-- Reset BuyologyIQ onboarding: delete test responses and regenerate token
DELETE FROM onboarding_responses WHERE client_id = 'b3d600f5-5d6b-4378-aa96-b395c05e9297';
DELETE FROM client_context WHERE client_id = 'b3d600f5-5d6b-4378-aa96-b395c05e9297';

-- Reset the existing token status back to invited with a fresh token
UPDATE onboarding_tokens 
SET status = 'invited', token = 'biq' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), updated_at = now()
WHERE client_name = 'BuyologyIQ';