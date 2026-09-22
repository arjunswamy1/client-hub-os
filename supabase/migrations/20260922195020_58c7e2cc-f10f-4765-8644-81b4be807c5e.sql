DROP INDEX IF EXISTS public.idx_task_feedback_slack_message;
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_feedback_slack_message
  ON public.task_feedback (slack_channel_id, slack_ts);