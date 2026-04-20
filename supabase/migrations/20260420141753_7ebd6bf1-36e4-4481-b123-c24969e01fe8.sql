
-- Create 4Js client
INSERT INTO public.clients (name, slug, color, status)
VALUES ('4Js', '4js', '#8B5CF6', 'active')
ON CONFLICT (slug) DO NOTHING;

-- Assign Henry to 4Js
INSERT INTO public.client_assignments (client_id, team_member_id, role_on_account)
SELECT c.id, '30c0acc7-b385-4bcf-9b80-25a5a559a7e5', 'account_manager'
FROM public.clients c
WHERE c.slug = '4js'
ON CONFLICT DO NOTHING;
