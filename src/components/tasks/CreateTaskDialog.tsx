import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { toast } from 'sonner';
import { TaskType, TASK_TYPE_CONFIG } from './taskTypes';
import { TaskTypeFields } from './TaskTypeFields';
import { ArrowLeft } from 'lucide-react';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  teamMembers: any[];
  currentMemberId?: string;
}

export function CreateTaskDialog({ open, onOpenChange, clientId, teamMembers, currentMemberId }: CreateTaskDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [taskType, setTaskType] = useState<TaskType | null>(null);
  const [typeData, setTypeData] = useState<any>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState('');

  const createTask = useMutation({
    mutationFn: async () => {
      if (!taskType) throw new Error('Pick a task type first');
      const { error } = await supabase.from('tasks').insert({
        client_id: clientId,
        title,
        description: description || null,
        priority,
        assignee_id: assigneeId || null,
        created_by_id: currentMemberId || null,
        due_date: dueDate || null,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        task_type: taskType,
        type_data: typeData || {},
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task created');
      onOpenChange(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => {
    setStep('type');
    setTaskType(null);
    setTypeData({});
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssigneeId('');
    setDueDate('');
    setTags('');
  };

  const handleClose = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'details' && (
              <Button variant="ghost" size="icon" className="h-6 w-6 -ml-1" onClick={() => setStep('type')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {step === 'type' ? 'What kind of task?' : `New ${TASK_TYPE_CONFIG[taskType!].label} Task`}
          </DialogTitle>
        </DialogHeader>

        {step === 'type' && (
          <div className="grid grid-cols-2 gap-2 py-2">
            {(Object.keys(TASK_TYPE_CONFIG) as TaskType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setTaskType(t); setStep('details'); }}
                className="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left hover:border-primary hover:bg-accent/50 transition-colors"
              >
                <span className="text-xl">{TASK_TYPE_CONFIG[t].emoji}</span>
                <span className="text-sm font-medium">{TASK_TYPE_CONFIG[t].label}</span>
                <span className="text-[11px] text-muted-foreground leading-tight">
                  {TASK_TYPE_CONFIG[t].description}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 'details' && taskType && (
          <form
            onSubmit={(e) => { e.preventDefault(); createTask.mutate(); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Task title"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            <TaskTypeFields taskType={taskType} data={typeData} onChange={setTypeData} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {teamMembers.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="due_date">Due Date</Label>
                <Input
                  id="due_date"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  placeholder="Meta Ads, Creative"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTask.isPending || !title.trim()}>
                {createTask.isPending ? 'Creating...' : 'Create Task'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
