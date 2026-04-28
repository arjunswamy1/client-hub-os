-- 1) Add per-stage timestamps to shoot_briefs
ALTER TABLE public.shoot_briefs
  ADD COLUMN IF NOT EXISTS scheduled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS production_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS footage_uploaded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS post_prod_handoff_at  timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at          timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at           timestamptz;

-- 2) Status history table (immutable audit trail)
CREATE TABLE IF NOT EXISTS public.shoot_brief_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id    uuid NOT NULL REFERENCES public.shoot_briefs(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  changed_by_id uuid,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brief_status_history_brief ON public.shoot_brief_status_history(brief_id, changed_at DESC);

ALTER TABLE public.shoot_brief_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage status history" ON public.shoot_brief_status_history;
CREATE POLICY "Admins manage status history" ON public.shoot_brief_status_history
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Team members view brief status history" ON public.shoot_brief_status_history;
CREATE POLICY "Team members view brief status history" ON public.shoot_brief_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shoot_briefs b
    WHERE b.id = shoot_brief_status_history.brief_id
      AND get_team_member_id(auth.uid()) IS NOT NULL
      AND (
        cardinality(b.client_ids) = 0
        OR EXISTS (SELECT 1 FROM unnest(b.client_ids) cid WHERE has_client_access(auth.uid(), cid))
        OR b.assigned_producer_id = get_team_member_id(auth.uid())
        OR b.created_by_id = get_team_member_id(auth.uid())
      )
  ));

DROP POLICY IF EXISTS "Designers view linked brief status history" ON public.shoot_brief_status_history;
CREATE POLICY "Designers view linked brief status history" ON public.shoot_brief_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shoot_briefs b
    JOIN public.creative_briefs cb ON cb.id = b.linked_creative_brief_id
    WHERE b.id = shoot_brief_status_history.brief_id
      AND cb.assigned_to_id = get_team_member_id(auth.uid())
  ));

-- Allow inserts via the trigger (which runs as the row owner). We don't need a user INSERT policy
-- because all writes go through the trigger below; admins still have ALL.

-- 3) Trigger: when shoot_briefs.status changes, stamp the right column AND insert history row
CREATE OR REPLACE FUNCTION public.shoot_brief_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    -- Stamp the appropriate timestamp on first entry to a stage
    IF NEW.status = 'scheduled'           AND NEW.scheduled_at IS NULL          THEN NEW.scheduled_at          := now(); END IF;
    IF NEW.status = 'in_production'       AND NEW.production_started_at IS NULL THEN NEW.production_started_at := now(); END IF;
    IF NEW.status = 'footage_uploaded'    AND NEW.footage_uploaded_at IS NULL   THEN NEW.footage_uploaded_at   := now(); END IF;
    IF NEW.status = 'in_post_production'  AND NEW.post_prod_handoff_at IS NULL  THEN NEW.post_prod_handoff_at  := now(); END IF;
    IF NEW.status = 'delivered'           AND NEW.delivered_at IS NULL          THEN NEW.delivered_at          := now(); END IF;
    IF NEW.status = 'canceled'            AND NEW.canceled_at IS NULL           THEN NEW.canceled_at           := now(); END IF;

    -- Record history (skip the trivial INSERT-as-draft case to keep history clean)
    IF TG_OP = 'UPDATE' THEN
      INSERT INTO public.shoot_brief_status_history (brief_id, from_status, to_status, changed_by_id)
      VALUES (NEW.id, OLD.status, NEW.status, get_team_member_id(auth.uid()));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shoot_brief_status_changed ON public.shoot_briefs;
CREATE TRIGGER trg_shoot_brief_status_changed
  BEFORE INSERT OR UPDATE OF status ON public.shoot_briefs
  FOR EACH ROW EXECUTE FUNCTION public.shoot_brief_status_changed();