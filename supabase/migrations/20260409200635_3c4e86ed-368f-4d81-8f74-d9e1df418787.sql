-- Create update_updated_at function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- CLIENTS TABLE
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT,
  logo_url TEXT,
  communication_channel TEXT CHECK (communication_channel IN ('slack', 'teams', 'email')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'offboarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TEAM MEMBERS TABLE
CREATE TABLE public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'account_manager', 'designer', 'client')),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CLIENT ASSIGNMENTS TABLE
CREATE TABLE public.client_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  role_on_account TEXT,
  assigned_by_id UUID REFERENCES public.team_members(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, team_member_id)
);
ALTER TABLE public.client_assignments ENABLE ROW LEVEL SECURITY;

-- TASKS TABLE
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  assignee_id UUID REFERENCES public.team_members(id),
  created_by_id UUID REFERENCES public.team_members(id),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_tasks_client_id ON public.tasks(client_id);
CREATE INDEX idx_tasks_assignee_id ON public.tasks(assignee_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);

-- TASK COMMENTS TABLE
CREATE TABLE public.task_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.team_members(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- TASK TIME ENTRIES TABLE
CREATE TABLE public.task_time_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;

-- CALL AGENDAS TABLE
CREATE TABLE public.call_agendas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_date DATE NOT NULL,
  call_type TEXT NOT NULL DEFAULT 'weekly' CHECK (call_type IN ('weekly', 'adhoc', 'strategy', 'creative_review')),
  title TEXT NOT NULL,
  agenda_content JSONB DEFAULT '[]',
  notes_content JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed')),
  published_at TIMESTAMPTZ,
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.call_agendas ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_call_agendas_updated_at BEFORE UPDATE ON public.call_agendas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CALL ACTION ITEMS TABLE
CREATE TABLE public.call_action_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_agenda_id UUID NOT NULL REFERENCES public.call_agendas(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id),
  description TEXT NOT NULL,
  assignee_id UUID REFERENCES public.team_members(id),
  due_date DATE,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.call_action_items ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER FUNCTIONS
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE user_id = check_user_id AND role = 'admin' AND is_active = true);
$$;

CREATE OR REPLACE FUNCTION public.has_client_access(check_user_id UUID, check_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.client_assignments ca ON ca.team_member_id = tm.id
    WHERE tm.user_id = check_user_id AND ca.client_id = check_client_id AND tm.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_team_member_id(check_user_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.team_members WHERE user_id = check_user_id AND is_active = true LIMIT 1;
$$;

-- RLS POLICIES
CREATE POLICY "Admins see all clients" ON public.clients FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members see assigned clients" ON public.clients FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), id));

CREATE POLICY "Admins manage team members" ON public.team_members FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Authenticated users can read team members" ON public.team_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage assignments" ON public.client_assignments FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members see own assignments" ON public.client_assignments FOR SELECT TO authenticated USING (team_member_id = public.get_team_member_id(auth.uid()));

CREATE POLICY "Admins manage all tasks" ON public.tasks FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client tasks" ON public.tasks FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Admins manage all comments" ON public.task_comments FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client comments" ON public.task_comments FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.has_client_access(auth.uid(), t.client_id)));

CREATE POLICY "Admins manage all time entries" ON public.task_time_entries FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client time entries" ON public.task_time_entries FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.has_client_access(auth.uid(), t.client_id)));

CREATE POLICY "Admins manage all agendas" ON public.call_agendas FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client agendas" ON public.call_agendas FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Admins manage all action items" ON public.call_action_items FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client action items" ON public.call_action_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.call_agendas ca WHERE ca.id = call_agenda_id AND public.has_client_access(auth.uid(), ca.client_id)));

-- SEED DATA
INSERT INTO public.team_members (name, email, role) VALUES
  ('Arjun Swamy', 'aj@creaitivapp.com', 'admin'),
  ('Charles', 'charles@connectpaidmedia.com', 'admin'),
  ('Henry', 'henry@connectpaidmedia.com', 'account_manager'),
  ('Omar', 'omar@connectpaidmedia.com', 'account_manager'),
  ('Belu', 'belu@connectpaidmedia.com', 'account_manager'),
  ('Malena', 'malena@connectpaidmedia.com', 'designer');

INSERT INTO public.clients (name, slug, color, status) VALUES
  ('Sample Client', 'sample-client', '#3B82F6', 'active');