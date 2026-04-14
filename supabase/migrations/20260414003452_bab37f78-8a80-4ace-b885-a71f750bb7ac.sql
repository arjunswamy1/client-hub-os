CREATE TABLE public.slack_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_name text NOT NULL,
  sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_ts text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id)
);

ALTER TABLE public.slack_channel_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all slack mappings"
  ON public.slack_channel_mappings FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members view assigned client mappings"
  ON public.slack_channel_mappings FOR SELECT TO authenticated
  USING (has_client_access(auth.uid(), client_id));