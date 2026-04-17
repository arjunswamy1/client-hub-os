-- Move rogue cpm_malena Slack auto-tasks into creative_briefs as drafts, then delete them.
-- These should never have been tasks per business rule (creative-only channel).

WITH rogue AS (
  SELECT id, client_id, title, description, priority, assignee_id
  FROM public.tasks
  WHERE 'slack-auto' = ANY(tags)
    AND ('cpm_malena' = ANY(tags) OR '#cpm_malena' = ANY(tags))
)
INSERT INTO public.creative_briefs (client_id, title, status, priority, creative_type, assigned_to_id, notes)
SELECT
  client_id,
  title,
  'draft',
  CASE WHEN priority IN ('high','medium','low') THEN priority ELSE 'medium' END,
  'static',
  assignee_id,
  COALESCE(description, '') || E'\n\n[Migrated from auto-created Slack task]'
FROM rogue;

DELETE FROM public.tasks
WHERE 'slack-auto' = ANY(tags)
  AND ('cpm_malena' = ANY(tags) OR '#cpm_malena' = ANY(tags));