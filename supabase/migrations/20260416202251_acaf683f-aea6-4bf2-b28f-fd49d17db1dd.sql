-- Add task type and structured data
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS type_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('general','landing_page','creative_brief','media_build'));

-- Add mentioned team member ids on comments
ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS mentioned_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON public.tasks(task_type);