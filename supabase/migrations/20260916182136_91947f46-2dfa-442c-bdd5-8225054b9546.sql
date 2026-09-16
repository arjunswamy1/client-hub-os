-- 1. Agency-level rows: client_id becomes optional
ALTER TABLE public.context_items ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.context_sync_log ALTER COLUMN client_id DROP NOT NULL;

-- 2. Recognise wispr as a source
ALTER TABLE public.context_items DROP CONSTRAINT IF EXISTS context_items_source_check;
ALTER TABLE public.context_items ADD CONSTRAINT context_items_source_check
  CHECK (source = ANY (ARRAY['fathom','teams','slack','gmail','drive','meta_ads','google_ads','tiktok_ads','internal','wispr']));

-- context_sync_log.source has no CHECK constraint (it already holds values such
-- as 'fathom-backfill'), so 'wispr' needs no schema change there.

-- 3. Idempotent re-sync
CREATE UNIQUE INDEX IF NOT EXISTS context_items_source_source_id_key
  ON public.context_items (source, source_id)
  WHERE source_id IS NOT NULL;

-- 4. Edited meetings are visible as edited
ALTER TABLE public.context_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS update_context_items_updated_at ON public.context_items;
CREATE TRIGGER update_context_items_updated_at
  BEFORE UPDATE ON public.context_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Full-text search over title + content (transcripts are long)
CREATE INDEX IF NOT EXISTS context_items_fts_idx ON public.context_items
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
CREATE INDEX IF NOT EXISTS context_items_agency_occurred_idx ON public.context_items (occurred_at DESC)
  WHERE client_id IS NULL;

-- 6. RLS: the null-client case gets its own explicit policy.
--    has_client_access(uid, NULL) is NULL, so agency rows are invisible to
--    every existing policy. Only admins and account managers may see them.
DROP POLICY IF EXISTS "Admins and AMs manage agency-level context" ON public.context_items;
CREATE POLICY "Admins and AMs manage agency-level context"
  ON public.context_items FOR ALL TO authenticated
  USING (
    client_id IS NULL
    AND (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
  )
  WITH CHECK (
    (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
    AND (
      client_id IS NULL
      OR public.is_admin(auth.uid())
      OR public.has_client_access(auth.uid(), client_id)
    )
  );

DROP POLICY IF EXISTS "Admins and AMs manage agency-level sync logs" ON public.context_sync_log;
CREATE POLICY "Admins and AMs manage agency-level sync logs"
  ON public.context_sync_log FOR ALL TO authenticated
  USING (
    client_id IS NULL
    AND (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
  )
  WITH CHECK (
    (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
    AND (client_id IS NULL OR public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.context_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.context_sync_log TO authenticated;
GRANT ALL ON public.context_items TO service_role;
GRANT ALL ON public.context_sync_log TO service_role;