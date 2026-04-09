import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Plus, Calendar, FileText, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const TYPE_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  adhoc: 'Ad Hoc',
  strategy: 'Strategy',
  creative_review: 'Creative Review',
};

export default function AgendasPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newType, setNewType] = useState('weekly');

  const { data: agendas = [] } = useQuery({
    queryKey: ['agendas', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('call_agendas')
        .select('*, created_by:team_members!call_agendas_created_by_id_fkey(name)')
        .eq('client_id', activeClient.id)
        .order('call_date', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeClient,
  });

  const { data: actionItems = [] } = useQuery({
    queryKey: ['action_items', selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const { data, error } = await supabase
        .from('call_action_items')
        .select('*, assignee:team_members!call_action_items_assignee_id_fkey(name)')
        .eq('call_agenda_id', selectedId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedId,
  });

  const createAgenda = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('call_agendas').insert({
        client_id: activeClient!.id,
        title: newTitle,
        call_date: newDate,
        call_type: newType,
        created_by_id: teamMember?.id || null,
        agenda_content: [
          { section: 'Topics', items: [] },
          { section: 'Metrics Review', items: [] },
          { section: 'Action Items', items: [] },
          { section: 'Open Questions', items: [] },
        ],
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('Agenda created');
      setIsCreateOpen(false);
      setNewTitle(''); setNewDate(''); setNewType('weekly');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === 'published') updates.published_at = new Date().toISOString();
      const { error } = await supabase.from('call_agendas').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agendas'] }),
  });

  const updateContent = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase.from('call_agendas').update({ [field]: value } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agendas'] }),
  });

  const addActionItem = useMutation({
    mutationFn: async ({ description }: { description: string }) => {
      const { error } = await supabase.from('call_action_items').insert({
        call_agenda_id: selectedId!,
        description,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['action_items'] }),
  });

  const toggleActionItem = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from('call_action_items').update({ completed }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['action_items'] }),
  });

  const selected = agendas.find((a: any) => a.id === selectedId);

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left panel: agenda list */}
      <div className="w-80 shrink-0 space-y-3 overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Agendas</h1>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New
          </Button>
        </div>

        {agendas.map((agenda: any) => (
          <Card
            key={agenda.id}
            className={`cursor-pointer transition-all hover:shadow-sm ${selectedId === agenda.id ? 'ring-2 ring-primary/30' : ''}`}
            onClick={() => setSelectedId(agenda.id)}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{agenda.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(agenda.call_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[agenda.status] || ''}`}>
                    {agenda.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {TYPE_LABELS[agenda.call_type] || agenda.call_type}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {agendas.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No agendas yet</p>
        )}
      </div>

      {/* Right panel: agenda detail */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selected.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(selected.call_date), 'EEEE, MMMM d, yyyy')} · {TYPE_LABELS[selected.call_type]}
                </p>
              </div>
              <div className="flex gap-2">
                {selected.status === 'draft' && (
                  <Button size="sm" onClick={() => updateStatus.mutate({ id: selected.id, status: 'published' })}>
                    Publish to Client
                  </Button>
                )}
                {selected.status === 'published' && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: selected.id, status: 'completed' })}>
                    Mark Completed
                  </Button>
                )}
              </div>
            </div>

            {/* Agenda Content */}
            <Card>
              <CardHeader><CardTitle className="text-base">Agenda</CardTitle></CardHeader>
              <CardContent>
                <AgendaEditor
                  content={selected.agenda_content || []}
                  onChange={(content) => updateContent.mutate({ id: selected.id, field: 'agenda_content', value: content })}
                  readOnly={selected.status === 'completed'}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader><CardTitle className="text-base">Meeting Notes</CardTitle></CardHeader>
              <CardContent>
                <AgendaEditor
                  content={selected.notes_content || []}
                  onChange={(content) => updateContent.mutate({ id: selected.id, field: 'notes_content', value: content })}
                  readOnly={selected.status !== 'completed' && selected.status !== 'published'}
                />
              </CardContent>
            </Card>

            {/* Action Items */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Action Items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {actionItems.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggleActionItem.mutate({ id: item.id, completed: !item.completed })}
                      className="rounded"
                    />
                    <span className={`text-sm flex-1 ${item.completed ? 'line-through text-muted-foreground' : ''}`}>
                      {item.description}
                    </span>
                    {item.assignee && (
                      <Badge variant="outline" className="text-[10px]">{item.assignee.name}</Badge>
                    )}
                  </div>
                ))}
                <ActionItemInput onAdd={(desc) => addActionItem.mutate({ description: desc })} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Select an agenda to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New Agenda</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); createAgenda.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Weekly Sync" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Call Date</Label>
                <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="adhoc">Ad Hoc</SelectItem>
                    <SelectItem value="strategy">Strategy</SelectItem>
                    <SelectItem value="creative_review">Creative Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createAgenda.isPending}>Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Simple agenda content editor
function AgendaEditor({ content, onChange, readOnly }: { content: any[]; onChange: (c: any[]) => void; readOnly: boolean }) {
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [newItem, setNewItem] = useState('');

  const sections = Array.isArray(content) ? content : [];

  const addItem = (sectionIdx: number) => {
    if (!newItem.trim()) return;
    const updated = [...sections];
    if (!updated[sectionIdx].items) updated[sectionIdx].items = [];
    updated[sectionIdx].items.push(newItem.trim());
    onChange(updated);
    setNewItem('');
  };

  const removeItem = (sectionIdx: number, itemIdx: number) => {
    const updated = [...sections];
    updated[sectionIdx].items.splice(itemIdx, 1);
    onChange(updated);
  };

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No content yet.</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((section: any, si: number) => (
        <div key={si}>
          <h4 className="text-sm font-medium mb-1.5">{section.section}</h4>
          <ul className="space-y-1">
            {section.items?.map((item: string, ii: number) => (
              <li key={ii} className="flex items-start gap-2 text-sm">
                <ChevronRight className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
                <span className="flex-1">{item}</span>
                {!readOnly && (
                  <button className="text-xs text-destructive hover:underline" onClick={() => removeItem(si, ii)}>×</button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <div className="flex gap-1 mt-1.5">
              <Input
                className="h-7 text-xs"
                placeholder="Add item..."
                value={editingSection === si ? newItem : ''}
                onFocus={() => setEditingSection(si)}
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si))}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionItemInput({ onAdd }: { onAdd: (desc: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-1 mt-2">
      <Input
        className="h-7 text-xs"
        placeholder="Add action item..."
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            onAdd(value.trim());
            setValue('');
          }
        }}
      />
      <Button size="sm" className="h-7 text-xs" onClick={() => { if (value.trim()) { onAdd(value.trim()); setValue(''); } }}>
        Add
      </Button>
    </div>
  );
}
