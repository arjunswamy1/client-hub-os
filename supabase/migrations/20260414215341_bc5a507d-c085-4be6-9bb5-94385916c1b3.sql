
-- Onboarding tokens table
CREATE TABLE public.onboarding_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  client_name TEXT NOT NULL,
  company TEXT,
  assigned_emails TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','onboarding','active','expired')),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_tokens ENABLE ROW LEVEL SECURITY;

-- Public can read tokens (needed for signup page to validate token)
CREATE POLICY "Anyone can read onboarding tokens" ON public.onboarding_tokens
  FOR SELECT USING (true);

-- Only admins can manage tokens
CREATE POLICY "Admins manage onboarding tokens" ON public.onboarding_tokens
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

-- Client users table (links auth.users to clients)
CREATE TABLE public.client_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT,
  onboarding_token_id UUID REFERENCES public.onboarding_tokens(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);

ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all client users" ON public.client_users
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Client users see own record" ON public.client_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Onboarding responses table
CREATE TABLE public.onboarding_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('campaign','creative','access','other')),
  data JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, section)
);

ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all onboarding responses" ON public.onboarding_responses
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Client users manage own onboarding" ON public.onboarding_responses
  FOR ALL TO authenticated 
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Client context table
CREATE TABLE public.client_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_context JSONB NOT NULL DEFAULT '{}',
  ai_summary JSONB,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.client_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all client context" ON public.client_context
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Client users see own context" ON public.client_context
  FOR SELECT TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.client_users cu WHERE cu.client_id = client_context.client_id AND cu.user_id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_onboarding_tokens_updated_at BEFORE UPDATE ON public.onboarding_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_onboarding_responses_updated_at BEFORE UPDATE ON public.onboarding_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
