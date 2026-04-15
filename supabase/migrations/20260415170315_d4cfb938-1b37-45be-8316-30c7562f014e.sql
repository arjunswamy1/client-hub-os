UPDATE public.team_members SET email = 'grant@flamingowl.co' WHERE id = '64d545c5-9886-4a25-aeb5-90cc9e64d4e3';

UPDATE auth.users SET email = 'grant@flamingowl.co', raw_user_meta_data = jsonb_set(raw_user_meta_data, '{email}', '"grant@flamingowl.co"') WHERE id = '4312fca3-21dc-453f-84c7-40b96bb93a9d';