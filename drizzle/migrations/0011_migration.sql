CREATE TABLE IF NOT EXISTS public.jacuzzi_lead_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id text NOT NULL UNIQUE,
  subject text,
  received_at timestamptz,
  attachment_name text,
  sheet_rows integer,
  leads_added integer,
  lead_dates text[],
  sheet_updates jsonb,
  status text NOT NULL DEFAULT 'processed',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jacuzzi_lead_email_log TO authenticated;
GRANT ALL ON public.jacuzzi_lead_email_log TO service_role;
ALTER TABLE public.jacuzzi_lead_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read Jacuzzi lead email log" ON public.jacuzzi_lead_email_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));