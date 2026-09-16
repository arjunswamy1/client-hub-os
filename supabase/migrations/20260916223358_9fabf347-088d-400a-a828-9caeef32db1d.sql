DELETE FROM public.media_brain_economics e
WHERE e.id = 'b6829ce2-96db-4b81-b0e7-884883af622b'
  AND NOT EXISTS (SELECT 1 FROM public.media_brain_instances i WHERE i.economics_id = e.id);