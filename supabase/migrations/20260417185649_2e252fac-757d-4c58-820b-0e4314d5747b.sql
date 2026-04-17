
-- Add client_role to existing client_users table
ALTER TABLE public.client_users
ADD COLUMN IF NOT EXISTS client_role text NOT NULL DEFAULT 'viewer';

-- Create client_invites table
CREATE TABLE public.client_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by_id uuid REFERENCES public.team_members(id),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  accepted_at timestamp with time zone,
  UNIQUE(client_id, email)
);

ALTER TABLE public.client_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all invites"
  ON public.client_invites FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members manage assigned client invites"
  ON public.client_invites FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));
