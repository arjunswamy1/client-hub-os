
-- Agenda templates table for reusable section structures per client
CREATE TABLE public.agenda_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'weekly',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add source tracking to call_agendas for duplication and AI generation
ALTER TABLE public.call_agendas
  ADD COLUMN source_agenda_id UUID REFERENCES public.call_agendas(id),
  ADD COLUMN template_id UUID REFERENCES public.agenda_templates(id),
  ADD COLUMN ai_context JSONB DEFAULT NULL;

-- RLS for agenda_templates
ALTER TABLE public.agenda_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all agenda templates"
  ON public.agenda_templates FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client templates"
  ON public.agenda_templates FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

-- Trigger for updated_at
CREATE TRIGGER update_agenda_templates_updated_at
  BEFORE UPDATE ON public.agenda_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
