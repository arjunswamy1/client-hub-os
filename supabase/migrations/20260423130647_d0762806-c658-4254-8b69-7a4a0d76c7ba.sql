UPDATE creative_briefs
SET client_id = '719cca0b-fdde-439f-948c-71d5692f8e6e', updated_at = now()
WHERE client_id IS NULL AND title ILIKE 'TFC%';