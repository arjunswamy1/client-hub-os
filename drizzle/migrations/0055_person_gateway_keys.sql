-- Migration 0055: person-owned gateway keys (PROPOSAL.md rev 2). Ships with person_keys_enabled = false.
-- QA-cleared by CPM Build QA; AJ approved Oct 24, 2026 ("Yes, build it now with the switch off").
-- No BEGIN/COMMIT: the Lovable migration tool manages the transaction. No key is minted; no existing key or grant is changed.

-- 0. Pre-flight: abort unless the live functions are exactly what this migration was built and tested against.
DO $pf$
DECLARE r record; v_bad text[] := '{}';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_write_auto_approve','7e802d3c387103219041446fc4a1309c'),
    ('agent_alert_outbox_result','5e8226e8a846ce56d9cd6fae9ff95b7e'),
    ('agent_auto_execute_lock','85bb2afe6b73616cba2f9e27b2031937'),
    ('agent_change_risk_report','64a48e6801b6b3d96a8825a98020000f'),
    ('agent_write_to_change_log','8d3e0aff837d41fa969f1c463741f673'),
    ('agent_write_request_create','63606ecd131287b5867b43e35930b0a9'),
    ('agent_gateway_token_write_lock','27eda24f71b415bce44d0c7485f89585'),
    ('agent_write_arm_blocker','35e7b5b6f70e3104afaf9704e2e955bb'),
    ('agent_lock_ddl_watch','a63adbfbd2f1daea13d63bc415ecc6c9'),
    ('agent_key_lock_cutoff','b4e1d992b19b99c024b19edb10dc2fc1'),
    ('agent_gateway_token_leak_lock','2198ef912fca12368f03367de020e69a'),
    ('agent_owner_write_lock','01fd82744c5f66da87373c3c8f4e5174')) AS t(fn, want) LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = r.fn AND md5(p.prosrc) = r.want) <> 1 THEN
      v_bad := v_bad || r.fn;
    END IF;
  END LOOP;
  IF cardinality(v_bad) > 0 THEN RAISE EXCEPTION '0055 pre-flight: live function md5 mismatch: %', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_gateway_tokens' AND column_name='kind') THEN
    RAISE EXCEPTION '0055 pre-flight: agent_gateway_tokens.kind already exists';
  END IF;
END $pf$;

-- 1. Settings switch (default OFF, AJ-only).
ALTER TABLE public.agent_gateway_settings ADD COLUMN person_keys_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.agent_person_keys_flag_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.person_keys_enabled IS DISTINCT FROM OLD.person_keys_enabled THEN
    IF auth.uid() IS NULL OR public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
      RAISE EXCEPTION 'denied_person_keys_owner: only the write owner may change person_keys_enabled';
    END IF;
    INSERT INTO agent_access_log (scope, event_type, outcome, detail, subject_table)
      VALUES ('write', 'admin', 'write_control_changed', 'person_keys_enabled=' || NEW.person_keys_enabled::text, 'agent_gateway_settings');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_person_keys_flag_lock BEFORE UPDATE ON public.agent_gateway_settings
  FOR EACH ROW EXECUTE FUNCTION public.agent_person_keys_flag_lock();
ALTER TABLE public.agent_gateway_settings ENABLE ALWAYS TRIGGER agent_person_keys_flag_lock;

-- 2. Key kind, holder and per-key limits. Existing rows become kind='agent' and are otherwise unchanged.
ALTER TABLE public.agent_gateway_tokens
  ADD COLUMN kind text NOT NULL DEFAULT 'agent',
  ADD COLUMN owner_team_member_id uuid REFERENCES public.team_members(id),
  ADD COLUMN rate_per_minute integer,
  ADD COLUMN rate_per_day integer,
  ADD COLUMN write_requests_per_day integer;
ALTER TABLE public.agent_gateway_tokens ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE public.agent_gateway_tokens ADD CONSTRAINT agent_gateway_tokens_kind_shape CHECK (
  (kind = 'agent' AND agent_id IS NOT NULL AND owner_team_member_id IS NULL
     AND rate_per_minute IS NULL AND rate_per_day IS NULL AND write_requests_per_day IS NULL)
  OR (kind = 'person' AND agent_id IS NULL AND owner_team_member_id IS NOT NULL AND audience = 'gateway'
     AND rate_per_minute BETWEEN 1 AND 600 AND rate_per_day BETWEEN 1 AND 100000 AND write_requests_per_day BETWEEN 0 AND 200));

-- 3. Required allowlist: which of the holder's bots a person key may act for. Default deny.
CREATE TABLE public.agent_gateway_token_agents (
  token_id uuid NOT NULL REFERENCES public.agent_gateway_tokens(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  added_by_id uuid REFERENCES public.team_members(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, agent_id)
);
CREATE INDEX agent_gateway_token_agents_agent ON public.agent_gateway_token_agents (agent_id);
ALTER TABLE public.agent_gateway_token_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read person key allowlist" ON public.agent_gateway_token_agents FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins remove person key allowlist" ON public.agent_gateway_token_agents FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.agent_gateway_token_agents FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.agent_gateway_token_agents TO authenticated;
GRANT SELECT ON public.agent_gateway_token_agents TO service_role;

-- 4. Per-key counters.
CREATE TABLE public.agent_gateway_key_counters (
  token_id uuid NOT NULL REFERENCES public.agent_gateway_tokens(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN ('minute','day')),
  bucket_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, bucket, bucket_start)
);
ALTER TABLE public.agent_gateway_key_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_gateway_key_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.agent_gateway_key_counters TO service_role;

-- 5. Audit: who held the key and which bot acted.
ALTER TABLE public.agent_access_log
  ADD COLUMN acting_agent_id uuid,
  ADD COLUMN key_kind text CHECK (key_kind IS NULL OR key_kind IN ('agent','person')),
  ADD COLUMN key_owner_team_member_id uuid;

-- 6. Helpers.
ALTER FUNCTION public.agent_key_lock_cutoff() SET search_path = public, pg_temp;

-- Active team member = team_members.is_active (the hub's only offboarding flag; get_team_member_id uses it too) and not a service account.
CREATE FUNCTION public.agent_team_member_active(p_tm uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM team_members WHERE id = p_tm AND is_active AND NOT is_service_account)
$$;

-- Leaked / pre-0040 blockers now include person keys that list the agent.
CREATE OR REPLACE FUNCTION public.agent_write_arm_blocker(p_agent_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
 SELECT CASE
  WHEN EXISTS (SELECT 1 FROM agent_gateway_tokens t WHERE t.revoked_at IS NULL AND t.expires_at > now() AND t.created_at < public.agent_key_lock_cutoff()
               AND (t.agent_id = p_agent_id OR (t.kind = 'person' AND EXISTS (SELECT 1 FROM agent_gateway_token_agents a WHERE a.token_id = t.id AND a.agent_id = p_agent_id)))) THEN 'denied_pre_0040_key'
  WHEN EXISTS (SELECT 1 FROM agent_gateway_tokens t WHERE t.revoked_at IS NULL AND t.expires_at > now() AND t.leaked
               AND (t.agent_id = p_agent_id OR (t.kind = 'person' AND EXISTS (SELECT 1 FROM agent_gateway_token_agents a WHERE a.token_id = t.id AND a.agent_id = p_agent_id)))) THEN 'denied_leaked_key'
 END $function$;

-- Per-key rate counter (service role only).
CREATE FUNCTION public.agent_gateway_key_hit(p_token_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m int; d int; t record; mb timestamptz := date_trunc('minute', now()); db timestamptz := date_trunc('day', now());
BEGIN
  SELECT rate_per_minute, rate_per_day INTO t FROM agent_gateway_tokens WHERE id = p_token_id AND kind = 'person';
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'outcome', 'denied_not_person_key'); END IF;
  INSERT INTO agent_gateway_key_counters VALUES (p_token_id, 'minute', mb, 1)
    ON CONFLICT (token_id, bucket, bucket_start) DO UPDATE SET hits = agent_gateway_key_counters.hits + 1 RETURNING hits INTO m;
  INSERT INTO agent_gateway_key_counters VALUES (p_token_id, 'day', db, 1)
    ON CONFLICT (token_id, bucket, bucket_start) DO UPDATE SET hits = agent_gateway_key_counters.hits + 1 RETURNING hits INTO d;
  DELETE FROM agent_gateway_key_counters WHERE token_id = p_token_id AND bucket_start < now() - interval '2 days';
  RETURN jsonb_build_object('allowed', m <= t.rate_per_minute AND d <= t.rate_per_day, 'minute', m, 'day', d);
END $$;

-- 7. Key write lock: person keys are AJ-only to create, rotate, reactivate, extend, re-home or loosen. Agent-key rules unchanged.
CREATE OR REPLACE FUNCTION public.agent_gateway_token_write_lock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_owner uuid := public.agent_gateway_write_owner();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NULL THEN RAISE EXCEPTION 'a gateway key can only be created by a signed-in team member'; END IF;
    NEW.created_by_id := v_me;
    IF NEW.kind = 'person' AND v_me IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'denied_person_key_owner: only the write owner may create person keys';
    END IF;
    IF NEW.kind = 'agent' AND public.agent_has_write_grant(NEW.agent_id) AND v_me IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'only the write owner may create keys for an agent with write access';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN RAISE EXCEPTION 'a gateway key''s creator cannot be changed'; END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'denied_key_kind_change: a key''s kind cannot be changed'; END IF;
  IF OLD.kind = 'person' THEN
    IF (NEW.token_hash IS DISTINCT FROM OLD.token_hash
        OR NEW.owner_team_member_id IS DISTINCT FROM OLD.owner_team_member_id
        OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
        OR NEW.expires_at > OLD.expires_at
        OR (OLD.leaked AND NOT NEW.leaked)
        OR NEW.rate_per_minute > OLD.rate_per_minute OR NEW.rate_per_day > OLD.rate_per_day
        OR NEW.write_requests_per_day > OLD.write_requests_per_day)
       AND v_me IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'denied_person_key_owner: only the write owner may rotate, re-home, reactivate, extend or loosen a person key';
    END IF;
    RETURN NEW;
  END IF;
  IF (public.agent_has_write_grant(NEW.agent_id) OR public.agent_has_write_grant(OLD.agent_id))
     AND (NEW.token_hash IS DISTINCT FROM OLD.token_hash
          OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
          OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
          OR NEW.expires_at > OLD.expires_at)
     AND v_me IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'only the write owner may rotate, move or reactivate keys for an agent with write access';
  END IF;
  RETURN NEW;
END $function$;

-- 8. Allowlist lock: adding is AJ-only; the bot must belong to the key holder; armed bots re-run the leaked / pre-0040 checks.
CREATE FUNCTION public.agent_person_key_allowlist_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); t record; v_agent_owner uuid; v_block text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'denied_allowlist_update: remove and re-add instead'; END IF;
  IF v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'denied_allowlist_owner: only the write owner may add a bot to a person key';
  END IF;
  SELECT kind, owner_team_member_id, leaked, created_at, revoked_at INTO t FROM agent_gateway_tokens WHERE id = NEW.token_id;
  IF t.kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'denied_not_person_key'; END IF;
  IF t.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'denied_token_revoked'; END IF;
  SELECT owner_team_member_id INTO v_agent_owner FROM agents WHERE id = NEW.agent_id;
  IF v_agent_owner IS DISTINCT FROM t.owner_team_member_id THEN RAISE EXCEPTION 'denied_agent_not_owned: the bot must belong to the key holder'; END IF;
  IF public.agent_has_write_grant(NEW.agent_id) OR (SELECT write_by_default FROM agents WHERE id = NEW.agent_id) THEN
    IF t.leaked THEN RAISE EXCEPTION 'denied_leaked_key'; END IF;
    IF t.created_at < public.agent_key_lock_cutoff() THEN RAISE EXCEPTION 'denied_pre_0040_key'; END IF;
    v_block := public.agent_write_arm_blocker(NEW.agent_id);
    IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
  END IF;
  NEW.added_by_id := v_me; NEW.added_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER agent_person_key_allowlist_lock BEFORE INSERT OR UPDATE ON public.agent_gateway_token_agents
  FOR EACH ROW EXECUTE FUNCTION public.agent_person_key_allowlist_lock();
ALTER TABLE public.agent_gateway_token_agents ENABLE ALWAYS TRIGGER agent_person_key_allowlist_lock;

-- 9. Non-empty allowlist, checked at commit: an unrevoked person key must list at least one bot.
CREATE FUNCTION public.agent_person_key_nonempty_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tok uuid;
BEGIN
  IF TG_TABLE_NAME = 'agent_gateway_tokens' THEN v_tok := NEW.id; ELSE v_tok := OLD.token_id; END IF;
  IF EXISTS (SELECT 1 FROM agent_gateway_tokens t WHERE t.id = v_tok AND t.kind = 'person' AND t.revoked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM agent_gateway_token_agents a WHERE a.token_id = t.id)) THEN
    RAISE EXCEPTION 'denied_allowlist_empty: a person key must list at least one bot';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER agent_person_key_nonempty_tok AFTER INSERT OR UPDATE ON public.agent_gateway_tokens
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.agent_person_key_nonempty_check();
CREATE CONSTRAINT TRIGGER agent_person_key_nonempty_list AFTER DELETE ON public.agent_gateway_token_agents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.agent_person_key_nonempty_check();
ALTER TABLE public.agent_gateway_tokens ENABLE ALWAYS TRIGGER agent_person_key_nonempty_tok;
ALTER TABLE public.agent_gateway_token_agents ENABLE ALWAYS TRIGGER agent_person_key_nonempty_list;

-- 10. Leaked after arming: revoke the person key and close its open write requests.
CREATE FUNCTION public.agent_person_key_leak_cascade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF NEW.kind = 'person' AND NEW.leaked AND NOT OLD.leaked THEN
    UPDATE agent_gateway_tokens SET revoked_at = coalesce(revoked_at, now()), revoked_by_id = coalesce(revoked_by_id, public.get_team_member_id(auth.uid()))
      WHERE id = NEW.id;
    UPDATE agent_write_requests SET status = 'denied', decided_at = now(), decision_note = 'denied_key_leaked: person key flagged leaked'
      WHERE token_id = NEW.id AND status IN ('pending','approved');
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO agent_access_log (token_id, key_kind, key_owner_team_member_id, scope, event_type, outcome, detail, subject_table, subject_id)
      VALUES (NEW.id, 'person', NEW.owner_team_member_id, 'write', 'admin', 'person_key_leaked', 'open write requests closed: ' || n, 'agent_gateway_tokens', NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER agent_person_key_leak_cascade AFTER UPDATE OF leaked ON public.agent_gateway_tokens
  FOR EACH ROW EXECUTE FUNCTION public.agent_person_key_leak_cascade();
ALTER TABLE public.agent_gateway_tokens ENABLE ALWAYS TRIGGER agent_person_key_leak_cascade;

-- 11. Owner change: the bot leaves every allowlist of a different holder; a key left empty is revoked; armed bots re-checked.
CREATE FUNCTION public.agent_person_key_owner_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_block text;
BEGIN
  IF NEW.owner_team_member_id IS DISTINCT FROM OLD.owner_team_member_id THEN
    UPDATE agent_gateway_tokens t SET revoked_at = now(), revoked_by_id = public.get_team_member_id(auth.uid())
      WHERE t.kind = 'person' AND t.revoked_at IS NULL AND t.owner_team_member_id IS DISTINCT FROM NEW.owner_team_member_id
        AND EXISTS (SELECT 1 FROM agent_gateway_token_agents a WHERE a.token_id = t.id AND a.agent_id = NEW.id)
        AND NOT EXISTS (SELECT 1 FROM agent_gateway_token_agents a WHERE a.token_id = t.id AND a.agent_id <> NEW.id);
    DELETE FROM agent_gateway_token_agents a USING agent_gateway_tokens t
      WHERE a.token_id = t.id AND a.agent_id = NEW.id AND t.owner_team_member_id IS DISTINCT FROM NEW.owner_team_member_id;
    IF public.agent_has_write_grant(NEW.id) THEN
      v_block := public.agent_write_arm_blocker(NEW.id);
      IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER agent_person_key_owner_change AFTER UPDATE OF owner_team_member_id ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agent_person_key_owner_change();
ALTER TABLE public.agents ENABLE ALWAYS TRIGGER agent_person_key_owner_change;

-- 12. Write request create: accepts a person key only for an allowlisted bot owned by an active holder; per-key daily write ceiling.
CREATE OR REPLACE FUNCTION public.agent_write_request_create(p_row jsonb, p_per_day integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_agent uuid := (p_row->>'agent_id')::uuid; v_count integer; v_open record; v_id uuid; v_owner uuid;
        v_tok uuid := nullif(p_row->>'token_id', '')::uuid; v_tok_creator uuid; v_t record;
BEGIN
  SELECT id, kind, agent_id, owner_team_member_id, created_by_id, revoked_at, expires_at, leaked, write_requests_per_day
    INTO v_t FROM agent_gateway_tokens WHERE id = v_tok;
  IF v_tok IS NULL OR v_t.id IS NULL OR v_t.created_by_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_unknown_key'); END IF;
  SELECT owner_team_member_id INTO v_owner FROM agents WHERE id = v_agent;
  IF v_t.kind = 'agent' THEN
    IF v_t.agent_id IS DISTINCT FROM v_agent THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_unknown_key'); END IF;
  ELSE
    IF v_t.revoked_at IS NOT NULL OR v_t.leaked OR v_t.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_token_revoked'); END IF;
    IF NOT EXISTS (SELECT 1 FROM agent_gateway_token_agents WHERE token_id = v_tok AND agent_id = v_agent) THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_agent_not_allowlisted'); END IF;
    IF v_owner IS DISTINCT FROM v_t.owner_team_member_id THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_agent_not_owned'); END IF;
    IF NOT public.agent_team_member_active(v_t.owner_team_member_id) THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_key_holder_inactive'); END IF;
  END IF;
  v_tok_creator := v_t.created_by_id;
  PERFORM pg_advisory_xact_lock(hashtext('agent_write_request:' || v_agent::text));
  IF v_t.kind = 'person' THEN PERFORM pg_advisory_xact_lock(hashtext('agent_write_request_key:' || v_tok::text)); END IF;
  SELECT id, status, diff_text, decision_expires_at INTO v_open FROM agent_write_requests
    WHERE agent_id = v_agent AND action = p_row->>'action' AND object_id = p_row->>'object_id'
      AND status IN ('pending','approved','executing') LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', v_open.id, 'status', v_open.status,
      'diff_text', v_open.diff_text, 'decision_expires_at', v_open.decision_expires_at);
  END IF;
  SELECT count(*) INTO v_count FROM agent_write_requests
    WHERE agent_id = v_agent AND requested_at >= public.agent_write_day_start(now());
  IF v_count >= p_per_day THEN RETURN jsonb_build_object('ok', false, 'outcome', 'write_rate_limited', 'count', v_count); END IF;
  IF v_t.kind = 'person' THEN
    SELECT count(*) INTO v_count FROM agent_write_requests WHERE token_id = v_tok AND requested_at >= public.agent_write_day_start(now());
    IF v_count >= v_t.write_requests_per_day THEN RETURN jsonb_build_object('ok', false, 'outcome', 'key_write_rate_limited', 'count', v_count); END IF;
  END IF;
  INSERT INTO agent_write_requests (agent_id, agent_owner_team_member_id, token_id, token_created_by_id, grant_id, integration_id, action, account_id, account_name, currency,
    object_type, object_id, object_name, before, after, diff_text, reason, requested_at, decision_expires_at, account_label)
  VALUES (v_agent, v_owner, v_tok, v_tok_creator, (p_row->>'grant_id')::uuid, (p_row->>'integration_id')::uuid, p_row->>'action', p_row->>'account_id',
    p_row->>'account_name', p_row->>'currency', p_row->>'object_type', p_row->>'object_id', p_row->>'object_name',
    p_row->'before', p_row->'after', p_row->>'diff_text', p_row->>'reason', now(), (p_row->>'decision_expires_at')::timestamptz, p_row->>'account_label')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'token_created_by_id', v_tok_creator);
END $function$;

-- 13. Mint (AJ only). Returns the raw key once; only its SHA-256 is stored.
CREATE FUNCTION public.mint_person_gateway_key(p_owner_team_member_id uuid, p_label text, p_expires_at timestamptz, p_allowlist uuid[],
  p_rate_per_minute integer DEFAULT 30, p_rate_per_day integer DEFAULT 2000, p_write_requests_per_day integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_key text; v_id uuid; a uuid;
BEGIN
  IF auth.uid() IS NULL OR v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'denied_person_key_owner: only the write owner may mint person keys';
  END IF;
  IF NOT public.agent_team_member_active(p_owner_team_member_id) THEN RAISE EXCEPTION 'denied_key_holder_inactive'; END IF;
  IF p_allowlist IS NULL OR cardinality(p_allowlist) = 0 THEN RAISE EXCEPTION 'denied_allowlist_empty: a person key must list at least one bot'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '366 days' THEN RAISE EXCEPTION 'denied_bad_expiry'; END IF;
  v_key := 'agp_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO agent_gateway_tokens (kind, owner_team_member_id, token_hash, token_prefix, label, expires_at, audience, rate_per_minute, rate_per_day, write_requests_per_day)
    VALUES ('person', p_owner_team_member_id, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), left(v_key, 12), p_label, p_expires_at, 'gateway',
            p_rate_per_minute, p_rate_per_day, p_write_requests_per_day)
    RETURNING id INTO v_id;
  FOREACH a IN ARRAY p_allowlist LOOP
    INSERT INTO agent_gateway_token_agents (token_id, agent_id) VALUES (v_id, a);
  END LOOP;
  RETURN jsonb_build_object('token_id', v_id, 'key', v_key, 'prefix', left(v_key, 12));
END $$;

-- 13b. Add a bot to an existing person key (AJ only; the allowlist trigger re-checks everything).
CREATE FUNCTION public.add_person_key_agent(p_token_id uuid, p_agent_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'denied_allowlist_owner: only the write owner may add a bot to a person key';
  END IF;
  INSERT INTO agent_gateway_token_agents (token_id, agent_id) VALUES (p_token_id, p_agent_id);
END $$;
REVOKE ALL ON FUNCTION public.add_person_key_agent(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_person_key_agent(uuid, uuid) TO authenticated;

-- 14. Privileges (0050 pattern: nothing for sandbox_exec; trigger functions not callable by API roles).
REVOKE ALL ON FUNCTION public.mint_person_gateway_key(uuid, text, timestamptz, uuid[], integer, integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mint_person_gateway_key(uuid, text, timestamptz, uuid[], integer, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.agent_gateway_key_hit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_gateway_key_hit(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.agent_team_member_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_team_member_active(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.agent_person_keys_flag_lock(), public.agent_person_key_allowlist_lock(), public.agent_person_key_nonempty_check(),
  public.agent_person_key_leak_cascade(), public.agent_person_key_owner_change() FROM PUBLIC, anon, authenticated, service_role;
DO $sx$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON public.agent_gateway_token_agents, public.agent_gateway_key_counters FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.mint_person_gateway_key(uuid, text, timestamptz, uuid[], integer, integer, integer), public.agent_gateway_key_hit(uuid), public.agent_team_member_active(uuid), public.agent_person_keys_flag_lock(), public.agent_person_key_allowlist_lock(), public.agent_person_key_nonempty_check(), public.agent_person_key_leak_cascade(), public.agent_person_key_owner_change() FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_person_key_agent(uuid, uuid) FROM sandbox_exec';
  END IF;
END $sx$;

-- 15. DDL watch gains the request/auto-approve functions, the access log and every new object.
CREATE OR REPLACE FUNCTION public.agent_lock_ddl_watch()
 RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE c record; v_hit text[] := '{}';
  v_watch text[] := ARRAY['agent_grant_write_scope_lock','grant_agent_write_scope','agent_gateway_write_owner',
    'agent_gateway_token_write_lock','agent_gateway_settings_write_lock','agent_owner_write_lock','agent_write_granters_guard',
    'agent_grant_audit_append_only','agent_grants_row_audit','decide_agent_write_request','is_write_granter',
    'grant_agent_write_scope_all','agent_write_arm_blocker','agent_write_default_lock','agent_gateway_token_leak_lock',
    'agent_write_granters','agent_grant_audit','agent_grants','agent_gateway_tokens','agent_gateway_settings','agents',
    'agent_write_request_create','agent_write_auto_approve','agent_access_log',
    'mint_person_gateway_key','add_person_key_agent','agent_gateway_key_hit','agent_team_member_active','agent_person_keys_flag_lock',
    'agent_person_key_allowlist_lock','agent_person_key_nonempty_check','agent_person_key_leak_cascade','agent_person_key_owner_change',
    'agent_gateway_token_agents','agent_gateway_key_counters','agent_key_lock_cutoff'];
BEGIN
  IF TG_EVENT = 'sql_drop' THEN
    FOR c IN SELECT object_type, object_identity FROM pg_event_trigger_dropped_objects() LOOP
      IF EXISTS (SELECT 1 FROM unnest(v_watch) w WHERE c.object_identity ~ ('(^|[ .])' || w || '([ (]|$)')) THEN
        v_hit := v_hit || (c.object_type || ' ' || c.object_identity);
      END IF;
    END LOOP;
  ELSE
    FOR c IN SELECT command_tag, object_type, object_identity FROM pg_event_trigger_ddl_commands() LOOP
      IF EXISTS (SELECT 1 FROM unnest(v_watch) w WHERE c.object_identity ~ ('(^|[ .])' || w || '([ (]|$)')) THEN
        v_hit := v_hit || (c.command_tag || ' ' || c.object_identity);
      END IF;
    END LOOP;
  END IF;
  IF cardinality(v_hit) > 0 THEN
    INSERT INTO agent_grant_audit (action, actor_team_member_id, detail)
      VALUES ('ddl_' || lower(TG_EVENT), get_team_member_id(auth.uid()),
              jsonb_build_object('tag', TG_TAG, 'objects', to_jsonb(v_hit), 'session_user', session_user));
    INSERT INTO notifications (recipient_id, type, title, message)
      VALUES (agent_gateway_write_owner(), 'agent_write_control', 'Agent write lock DDL changed',
              TG_TAG || ': ' || array_to_string(v_hit, ', '));
  END IF;
END $function$;