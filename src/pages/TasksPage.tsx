import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Task, TaskStatus, KANBAN_COLUMNS, TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, LayoutGrid, List, Calendar as CalendarIcon } from 'lucide-react';
import { KanbanBoard } from '@/components/tasks/KanbanBoard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';

type ViewMode = 'kanban' | 'list';

export default function TasksPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assignee:team_members!tasks_assignee_id_fkey(*)')
        .eq('client_id', activeClient.id)
        .is('parent_task_id', null)
        .order('position');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!activeClient,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return data;
    },
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

  if (!activeClient) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select a client to manage tasks</p>
      </div>
    );
  }

  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} tasks for {activeClient.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('kanban')}
              className="rounded-r-none"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="rounded-l-none"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New Task
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            tasks={tasks}
            onTaskClick={setSelectedTaskId}
            onStatusChange={(taskId, status) => updateTaskStatus.mutate({ taskId, status })}
          />
        ) : (
          <TaskListView
            tasks={tasks}
            onTaskClick={setSelectedTaskId}
          />
        )}
      </div>

      <CreateTaskDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={activeClient.id}
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
