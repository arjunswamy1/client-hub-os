INSERT INTO team_members (id, user_id, name) VALUES
 ('1fdd684e-6cb7-447e-b616-7e1b9c598971','aaaaaaaa-0000-4000-8000-000000000001','AJ'),
 ('014fa04a-80a5-41ce-9368-d1a81f6d2eec','aaaaaaaa-0000-4000-8000-000000000002','Charles'),
 ('004cb16a-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000003','Juan');
INSERT INTO integrations VALUES ('55694453-95b2-4c49-829b-517a50952d7b');
INSERT INTO agents (id, name, owner_team_member_id) VALUES
 ('b0000000-0000-4000-8000-00000000000a','Juan bot','004cb16a-0000-4000-8000-000000000003'),
 ('b0000000-0000-4000-8000-00000000000c','Charles bot','014fa04a-80a5-41ce-9368-d1a81f6d2eec'),
 ('b0000000-0000-4000-8000-00000000000d','AJ bot','1fdd684e-6cb7-447e-b616-7e1b9c598971'),
 ('b0000000-0000-4000-8000-00000000000e','Ownerless bot',NULL);
INSERT INTO agent_grants (id, agent_id, integration_id) SELECT gen_random_uuid(), id, '55694453-95b2-4c49-829b-517a50952d7b' FROM agents;
-- One key per agent, made by Juan (signed in; not an approver) before any write scope exists.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000003',false);
INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) SELECT id, 'h-' || id, '004cb16a-0000-4000-8000-000000000003' FROM agents;
SELECT set_config('request.jwt.claim.sub','',false);
CREATE FUNCTION pg_temp.tok(p_agent uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM agent_gateway_tokens WHERE agent_id = p_agent ORDER BY created_at, id LIMIT 1 $$;
CREATE FUNCTION pg_temp.req(p_agent uuid, p_obj text, p_status text DEFAULT 'pending', p_at timestamptz DEFAULT now()) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO agent_write_requests (agent_owner_team_member_id, token_id, token_created_by_id, agent_id, grant_id, integration_id, action, account_id, object_type, object_id, before, after, diff_text, decision_expires_at, status, requested_at)
  SELECT (SELECT owner_team_member_id FROM agents WHERE id = p_agent), pg_temp.tok(p_agent), (SELECT created_by_id FROM agent_gateway_tokens WHERE id = pg_temp.tok(p_agent)), p_agent, g.id, g.integration_id, 'meta.ad.pause', '111', 'ad', p_obj, '{}', '{}', 'd', now() + interval '1 day', p_status, p_at
  FROM agent_grants g WHERE g.agent_id = p_agent RETURNING id $$;
