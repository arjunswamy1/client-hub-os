CREATE TABLE IF NOT EXISTS public.task_digest_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date date NOT NULL,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  lane text NOT NULL CHECK (lane IN ('media','creative')),
  channel_id text NOT NULL,
  channel_name text,
  slack_ts text,
  message_text text NOT NULL,
  task_ids uuid[] NOT NULL DEFAULT '{}',
  brief_ids uuid[] NOT NULL DEFAULT '{}',
  shown_count integer NOT NULL DEFAULT 0,
  hidden_count integer NOT NULL DEFAULT 0,
  acknowledged_at timestamptz,
  ack_kind text CHECK (ack_kind IN ('aligned','editing','not_mine')),
  ack_slack_user_id text,
  ack_reaction text,
  nudged_at timestamptz,
  rolled_up_at timestamptz,
  correction_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_digest_posts_unique_person_lane_day
  ON public.task_digest_posts (digest_date, team_member_id, lane);
CREATE INDEX IF NOT EXISTS task_digest_posts_ts_idx
  ON public.task_digest_posts (channel_id, slack_ts);

GRANT SELECT ON public.task_digest_posts TO authenticated;
GRANT ALL ON public.task_digest_posts TO service_role;

ALTER TABLE public.task_digest_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and account managers can read task digest posts"
  ON public.task_digest_posts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE TRIGGER update_task_digest_posts_updated_at
  BEFORE UPDATE ON public.task_digest_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();