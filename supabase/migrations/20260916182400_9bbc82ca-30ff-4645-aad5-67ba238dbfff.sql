ALTER TABLE public.context_items
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED;
DROP INDEX IF EXISTS public.context_items_fts_idx;
CREATE INDEX IF NOT EXISTS context_items_search_vector_idx ON public.context_items USING GIN (search_vector);