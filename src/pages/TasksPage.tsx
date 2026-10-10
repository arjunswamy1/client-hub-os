import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, LayoutGrid, List, User, Users, Building2 } from 'lucide-react';
import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

type ViewMode = 'kanban' | 'list';
type Scope = 'mine' | 'client' | 'all';

export default function TasksPage() {
  const { activeClient } = useClient();
  const { teamMember, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [scope, setScope] = useState<Scope>('mine');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Fetch tasks based on scope
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', scope, teamMember?.id, activeClient?.id, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select('*, assignee:team_members!tasks_assignee_id_fkey(*), client:clients(id, name, color)')
        .is('parent_task_id', null)
        .order('position');

      if (scope === 'mine' && teamMember?.id) {
        query = query.eq('assignee_id', teamMember.id);
      } else if (scope === 'client' && activeClient?.id) {
        query = query.eq('client_id', activeClient.id);
      }
      // scope === 'all' → admin only, no extra filter

      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
    enabled: !!teamMember,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('is_active', true)
        .eq('is_service_account', false)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: allClients = [] } = useQuery({
    queryKey: ['all_clients_for_tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, color')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: scope === 'all',
  });

  const updateTaskStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const updates: any = { status };
      if (status === 'done') updates.completed_at = new Date().toISOString();
      else updates.completed_at = null;
      const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  // Apply admin-only filters in 'all' scope
  const filteredTasks = useMemo(() => {
    let t = tasks;
    if (scope === 'all' && assigneeFilter !== 'all') {
      t = t.filter((task: any) =>
        assigneeFilter === 'unassigned'
          ? !task.assignee_id
          : task.assignee_id === assigneeFilter
      );
    }
    if (scope === 'all' && clientFilter !== 'all') {
      t = t.filter((task: any) => task.client_id === clientFilter);
    }
    return t;
  }, [tasks, scope, assigneeFilter, clientFilter]);

  const selectedTask = filteredTasks.find((t: any) => t.id === selectedTaskId);

  // Counts by assignee for admin view
  const assigneeCounts = useMemo(() => {
    if (scope !== 'all') return [];
    const counts = new Map<string, number>();
    tasks.forEach((t: any) => {
      const key = t.assignee_id || 'unassigned';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries());
  }, [tasks, scope]);

  // Block client scope when no client is selected
  if (scope === 'client' && !activeClient) {
    return (
      <div className="flex h-full flex-col">
        <Header
          scope={scope} setScope={setScope} isAdmin={isAdmin}
          viewMode={viewMode} setViewMode={setViewMode}
          onCreate={() => setIsCreateOpen(true)}
          taskCount={0}
          subtitle="Select a client to view client tasks"
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">Select a client from the top bar to view its tasks.</p>
        </div>
      </div>
    );
  }

  const subtitle =
    scope === 'mine'
      ? `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''} assigned to you`
      : scope === 'client'
      ? `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''} for ${activeClient?.name}`
      : `${filteredTasks.length} of ${tasks.length} tasks across all clients`;

  return (
    <div className="flex h-full flex-col">
      <Header
        scope={scope} setScope={setScope} isAdmin={isAdmin}
        viewMode={viewMode} setViewMode={setViewMode}
        onCreate={() => setIsCreateOpen(true)}
        taskCount={filteredTasks.length}
        subtitle={subtitle}
      />

      {/* Admin filters - only in "All Tasks" mode */}
      {scope === 'all' && isAdmin && (
        <div className="flex items-center gap-2 pb-3 flex-wrap">
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Filter by assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {teamMembers.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Filter by client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {allClients.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {assigneeCounts.slice(0, 8).map(([id, count]) => {
              const member = teamMembers.find((m: any) => m.id === id);
              const label = id === 'unassigned' ? 'Unassigned' : member?.name || '—';
              return (
                <Badge key={id} variant="secondary" className="text-[10px]">
                  {label}: {count}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading tasks…
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {scope === 'mine'
              ? "You don't have any tasks assigned. Take a break ☕"
              : 'No tasks match the current filters.'}
          </div>
        ) : viewMode === 'kanban' ? (
          <KanbanBoard
            tasks={filteredTasks}
            onTaskClick={setSelectedTaskId}
            onStatusChange={(taskId, status) => updateTaskStatus.mutate({ taskId, status })}
          />
        ) : (
          <TaskListView
            tasks={filteredTasks}
            onTaskClick={setSelectedTaskId}
          />
        )}
      </div>

      <CreateTaskDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={activeClient?.id || ''}
        teamMembers={teamMembers}
        currentMemberId={teamMember?.id}
      />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          teamMembers={teamMembers}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}

function Header({
  scope, setScope, isAdmin, viewMode, setViewMode, onCreate, subtitle,
}: {
  scope: Scope;
  setScope: (s: Scope) => void;
  isAdmin: boolean;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  onCreate: () => void;
  taskCount: number;
  subtitle: string;
}) {
  return (
    <div className="flex items-center justify-between pb-4 gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {scope === 'mine' ? 'My Tasks' : scope === 'client' ? 'Client Tasks' : 'All Tasks (Admin)'}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Scope tabs */}
        <div className="flex rounded-md border">
          <ScopeBtn active={scope === 'mine'} onClick={() => setScope('mine')} icon={<User className="h-3.5 w-3.5" />} label="Mine" />
          <ScopeBtn active={scope === 'client'} onClick={() => setScope('client')} icon={<Building2 className="h-3.5 w-3.5" />} label="Client" />
          {isAdmin && (
            <ScopeBtn active={scope === 'all'} onClick={() => setScope('all')} icon={<Users className="h-3.5 w-3.5" />} label="All" />
          )}
        </div>

        {/* View mode */}
        <div className="flex rounded-md border">
          <Button
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm" onClick={() => setViewMode('kanban')}
            className="rounded-r-none"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm" onClick={() => setViewMode('list')}
            className="rounded-l-none"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" />
          New Task
        </Button>
      </div>
    </div>
  );
}

function ScopeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      className="rounded-none first:rounded-l-md last:rounded-r-md gap-1.5 text-xs"
    >
      {icon}
      {label}
    </Button>
  );
}
