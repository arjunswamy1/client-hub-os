ALTER TABLE public.task_feedback DROP CONSTRAINT IF EXISTS task_feedback_action_check;
ALTER TABLE public.task_feedback ADD CONSTRAINT task_feedback_action_check
  CHECK (action = ANY (ARRAY['not_a_task'::text, 'not_mine'::text, 'duplicate'::text, 'reworded'::text, 'confirmed'::text, 'feedback'::text]));