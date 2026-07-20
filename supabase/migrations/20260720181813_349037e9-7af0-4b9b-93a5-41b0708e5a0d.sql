
-- Table to store minted RingFuel tracking numbers per creative
CREATE TABLE public.ringfuel_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_label text NOT NULL,           -- e.g. "FE CTV - 30s"
  ringfuel_campaign_id text NOT NULL,     -- RingFuel campaign UUID
  phone_number text NOT NULL,             -- E.164
  session_id text,
  visitor_id text,
  creative_label text,                    -- e.g. "Creative 1", or the actual creative name
  tags jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',  -- active | archived
  minted_by_id uuid REFERENCES public.team_members(id),
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, phone_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ringfuel_numbers TO authenticated;
GRANT ALL ON public.ringfuel_numbers TO service_role;

ALTER TABLE public.ringfuel_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to ringfuel_numbers"
  ON public.ringfuel_numbers FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Assigned team can view ringfuel_numbers"
  ON public.ringfuel_numbers FOR SELECT
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Assigned team can insert ringfuel_numbers"
  ON public.ringfuel_numbers FOR INSERT
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Assigned team can update ringfuel_numbers"
  ON public.ringfuel_numbers FOR UPDATE
  USING (public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_ringfuel_numbers_updated
  BEFORE UPDATE ON public.ringfuel_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ringfuel_numbers_client ON public.ringfuel_numbers(client_id);
CREATE INDEX idx_ringfuel_numbers_campaign ON public.ringfuel_numbers(ringfuel_campaign_id);
