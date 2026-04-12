
CREATE TABLE public.client_verticals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vertical_id text NOT NULL,
  label text NOT NULL,
  emoji text NOT NULL DEFAULT '📋',
  meta_patterns text[] NOT NULL DEFAULT '{}',
  meta_account_ids text[] NOT NULL DEFAULT '{}',
  google_patterns text[] NOT NULL DEFAULT '{}',
  google_account_ids text[] NOT NULL DEFAULT '{}',
  ringba_patterns text[] NOT NULL DEFAULT '{}',
  ringba_exact_match boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, vertical_id)
);

ALTER TABLE public.client_verticals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all verticals"
  ON public.client_verticals FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client verticals"
  ON public.client_verticals FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));
