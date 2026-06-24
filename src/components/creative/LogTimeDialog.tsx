import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Brief { id: string; title: string; client_id?: string | null; client_name?: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  briefs: Brief[];
  /** When provided, edits an existing entry instead of inserting */
  editEntry?: any | null;
  /** Pre-fill a task when opening (e.g. quick "log to current timer task") */
  defaultBriefId?: string | null;
  defaultMinutes?: number;
}

const CATEGORIES = [
  { value: 'task', label: 'Task work' },
  { value: 'call', label: 'Call / Meeting' },
  { value: 'admin', label: 'Admin' },
  { value: 'break', label: 'Break' },
  { value: 'other', label: 'Other' },
];

export function LogTimeDialog({ open, onOpenChange, briefs, editEntry, defaultBriefId, defaultMinutes }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string>('task');
  const [briefId, setBriefId] = useState<string>('');
  const [minutes, setMinutes] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    if (editEntry) {
      setCategory(editEntry.category || 'task');
      setBriefId(editEntry.brief_id || '');
      setMinutes(String(editEntry.duration_minutes ?? ''));
      setDate((editEntry.started_at || new Date().toISOString()).slice(0, 10));
      setNote(editEntry.description || '');
    } else {
      setCategory(defaultBriefId ? 'task' : 'task');
      setBriefId(defaultBriefId || '');
      setMinutes(defaultMinutes ? String(defaultMinutes) : '');
      setDate(new Date().toISOString().slice(0, 10));
      setNote('');
    }
  }, [open, editEntry, defaultBriefId, defaultMinutes]);

  const save = useMutation({
    mutationFn: async () => {
      if (!teamMember) throw new Error('Not signed in');
      const mins = parseFloat(minutes);
      if (!mins || mins <= 0) throw new Error('Enter minutes greater than 0');
      const chosenBrief = briefs.find(b => b.id === briefId);
      const startedAt = new Date(`${date}T12:00:00`);
      const endedAt = new Date(startedAt.getTime() + mins * 60000);

      const payload: any = {
        team_member_id: teamMember.id,
        brief_id: category === 'task' ? (chosenBrief?.id || null) : null,
        client_id: category === 'task' ? (chosenBrief?.client_id || null) : null,
        category,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_minutes: Math.round(mins),
        is_manual: true,
        description: note || null,
      };

      if (editEntry) {
        const { error } = await supabase.from('creative_time_entries').update(payload).eq('id', editEntry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('creative_time_entries').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      toast.success(editEntry ? 'Entry updated' : 'Time logged');
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!editEntry) return;
      const { error } = await supabase
        .from('creative_time_entries')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', editEntry.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      const entryId = editEntry?.id;
      toast.success('Entry deleted', {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await supabase.from('creative_time_entries').update({ deleted_at: null } as any).eq('id', entryId);
            queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
            toast.success('Entry restored');
          },
        },
      });
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editEntry ? 'Edit time entry' : 'Log time'}</DialogTitle>
          <DialogDescription>
            {editEntry ? 'Correct or remove a logged entry.' : 'Add time for a task, call, or admin work.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {category === 'task' && (
            <div>
              <Label className="text-xs">Task</Label>
              <Select value={briefId} onValueChange={setBriefId}>
                <SelectTrigger><SelectValue placeholder="Pick a task…" /></SelectTrigger>
                <SelectContent>
                  {briefs.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.client_name ? `[${b.client_name}] ` : ''}{b.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Minutes</Label>
              <Input type="number" min="1" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What did you work on?" />
          </div>
        </div>
        <DialogFooter className="flex sm:justify-between gap-2">
          <div>
            {editEntry && (
              <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editEntry ? 'Save' : 'Log'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
