-- Create ringba_calls table for Billy.com call revenue tracking
CREATE TABLE public.ringba_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  call_date TIMESTAMP WITH TIME ZONE NOT NULL,
  campaign_name TEXT,
  target_name TEXT,
  caller_number TEXT,
  duration_seconds INTEGER DEFAULT 0,
  connected BOOLEAN DEFAULT false,
  converted BOOLEAN DEFAULT false,
  revenue NUMERIC NOT NULL DEFAULT 0,
  payout NUMERIC NOT NULL DEFAULT 0,
  inbound_number TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, call_id)
);

-- Enable RLS
ALTER TABLE public.ringba_calls ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins manage all ringba calls"
  ON public.ringba_calls FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client calls"
  ON public.ringba_calls FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

-- Index for date range queries
CREATE INDEX idx_ringba_calls_client_date ON public.ringba_calls (client_id, call_date);
CREATE INDEX idx_ringba_calls_campaign ON public.ringba_calls (campaign_name);
