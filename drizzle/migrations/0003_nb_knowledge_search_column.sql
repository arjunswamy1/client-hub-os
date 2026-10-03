ALTER TABLE public.nb_knowledge
  ADD COLUMN IF NOT EXISTS fts_doc tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(headline,'') || ' ' || coalesce(detail,'') || ' ' || coalesce(evidence,''))) STORED;
CREATE INDEX IF NOT EXISTS nb_knowledge_fts_doc_idx ON public.nb_knowledge USING gin (fts_doc);
COMMENT ON COLUMN public.nb_knowledge.fts_doc IS 'Full-text document over headline + detail + evidence, for hub search.';