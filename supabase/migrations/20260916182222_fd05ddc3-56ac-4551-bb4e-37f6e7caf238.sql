DROP INDEX IF EXISTS public.context_items_source_source_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS context_items_source_source_id_key
  ON public.context_items (source, source_id);