import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Plus, Calendar, FileText, ChevronRight, Copy, MoreVertical, Sparkles, LayoutTemplate } from 'lucide-react';
import { format, addDays, nextMonday } from 'date-fns';
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

interface AgendaSubsection {
  title: string;
  items: string[];
  placeholder?: string;
  ai_populatable?: boolean;
}

interface AgendaSection {
  section: string;
  items?: string[];
  subsections?: AgendaSubsection[];
}

export default function AgendasPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newType, setNewType] = useState('weekly');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('blank');

  // Fetch agendas
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

  // Fetch templates for client
  const { data: templates = [] } = useQuery({
    queryKey: ['agenda_templates', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('agenda_templates' as any)
        .select('*')
        .eq('client_id', activeClient.id)
        .order('is_default', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!activeClient,
  });

  // Fetch action items
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

  // Create agenda (from template or blank)
  const createAgenda = useMutation({
    mutationFn: async () => {
      let agendaContent: AgendaSection[];
      let templateId: string | null = null;

      if (selectedTemplateId !== 'blank') {
        const template = templates.find((t: any) => t.id === selectedTemplateId);
        if (template) {
          agendaContent = template.sections as AgendaSection[];
          templateId = template.id;
        } else {
          agendaContent = defaultSections();
        }
      } else {
        agendaContent = defaultSections();
      }

      const insertData: any = {
        client_id: activeClient!.id,
        title: newTitle,
        call_date: newDate,
        call_type: newType,
        created_by_id: teamMember?.id || null,
        agenda_content: agendaContent,
      };
      if (templateId) insertData.template_id = templateId;

      const { error } = await supabase.from('call_agendas').insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('Agenda created');
      setIsCreateOpen(false);
      resetCreateForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Duplicate agenda for next week
  const duplicateAgenda = useMutation({
    mutationFn: async (sourceAgenda: any) => {
      const sourceDate = new Date(sourceAgenda.call_date);
      const nextDate = nextMonday(addDays(sourceDate, 1));

      // Carry forward the section structure but clear items
      const sourceSections = (sourceAgenda.agenda_content || []) as AgendaSection[];
      const clearedSections = sourceSections.map((section: AgendaSection) => ({
        ...section,
        items: [],
        subsections: section.subsections?.map((sub: AgendaSubsection) => ({
          ...sub,
          items: [],
        })),
      }));

      const { error } = await supabase.from('call_agendas').insert({
        client_id: activeClient!.id,
        title: sourceAgenda.title,
        call_date: format(nextDate, 'yyyy-MM-dd'),
        call_type: sourceAgenda.call_type,
        created_by_id: teamMember?.id || null,
        agenda_content: clearedSections,
        source_agenda_id: sourceAgenda.id,
        template_id: sourceAgenda.template_id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('Agenda duplicated for next week');
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Duplicate with content carried forward
  const duplicateWithContent = useMutation({
    mutationFn: async (sourceAgenda: any) => {
      const sourceDate = new Date(sourceAgenda.call_date);
      const nextDate = nextMonday(addDays(sourceDate, 1));

      const { error } = await supabase.from('call_agendas').insert({
        client_id: activeClient!.id,
        title: sourceAgenda.title,
        call_date: format(nextDate, 'yyyy-MM-dd'),
        call_type: sourceAgenda.call_type,
        created_by_id: teamMember?.id || null,
        agenda_content: sourceAgenda.agenda_content,
        notes_content: [],
        source_agenda_id: sourceAgenda.id,
        template_id: sourceAgenda.template_id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('Agenda duplicated with content');
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

  const resetCreateForm = () => {
    setNewTitle('');
    setNewDate('');
    setNewType('weekly');
    setSelectedTemplateId('blank');
  };

  // When template selected, auto-fill title
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId !== 'blank') {
      const template = templates.find((t: any) => t.id === templateId);
      if (template && !newTitle) {
        setNewTitle(template.name);
        setNewType(template.template_type || 'weekly');
      }
    }
  };

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
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{agenda.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(agenda.call_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[agenda.status] || ''}`}>
                      {agenda.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {TYPE_LABELS[agenda.call_type] || agenda.call_type}
                    </Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => duplicateAgenda.mutate(agenda)}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate for Next Week
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateWithContent.mutate(agenda)}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate with Content
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                  {(selected as any).source_agenda_id && (
                    <span className="ml-2 text-xs text-muted-foreground/60">· duplicated</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Copy className="mr-1 h-3.5 w-3.5" /> Duplicate
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => duplicateAgenda.mutate(selected)}>
                      Empty (structure only)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => duplicateWithContent.mutate(selected)}>
                      With current content
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

            {/* Agenda Content - rich section editor */}
            <Card>
              <CardHeader><CardTitle className="text-base">Agenda</CardTitle></CardHeader>
              <CardContent>
                <RichAgendaEditor
                  content={(selected.agenda_content as any) || []}
                  onChange={(content) => updateContent.mutate({ id: selected.id, field: 'agenda_content', value: content })}
                  readOnly={selected.status === 'completed'}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader><CardTitle className="text-base">Meeting Notes</CardTitle></CardHeader>
              <CardContent>
                <RichAgendaEditor
                  content={(selected.notes_content as any) || []}
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

            {/* AI Context indicator */}
            {(selected as any).ai_context && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-3 flex items-center gap-2 text-sm text-primary">
                  <Sparkles className="h-4 w-4" />
                  <span>This agenda was generated with AI assistance</span>
                </CardContent>
              </Card>
            )}
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

      {/* Create Dialog with template selection */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Agenda</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); createAgenda.mutate(); }} className="space-y-4">
            {/* Template selection */}
            {templates.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <LayoutTemplate className="h-3.5 w-3.5" /> Template
                </Label>
                <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank Agenda</SelectItem>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.is_default && '★'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Weekly Digital Marketing Review" required />
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

            {/* Template preview */}
            {selectedTemplateId !== 'blank' && (
              <div className="rounded-md border bg-muted/50 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">Template Sections</p>
                {(templates.find((t: any) => t.id === selectedTemplateId)?.sections as AgendaSection[] || []).map((s: AgendaSection, i: number) => (
                  <div key={i} className="text-xs text-foreground">
                    • {s.section}
                    {s.subsections && s.subsections.length > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({s.subsections.map(sub => sub.title).join(', ')})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={createAgenda.isPending}>Create Agenda</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function defaultSections(): AgendaSection[] {
  return [
    { section: 'Topics', subsections: [{ title: 'Items', items: [], placeholder: 'Discussion topics...' }] },
    { section: 'Metrics Review', subsections: [{ title: 'Items', items: [], placeholder: 'Key metrics...' }] },
    { section: 'Action Items', subsections: [{ title: 'Items', items: [], placeholder: 'Action items from this call...' }] },
    { section: 'Open Questions', subsections: [{ title: 'Items', items: [], placeholder: 'Questions to address...' }] },
  ];
}

// Rich agenda editor that supports subsections
function RichAgendaEditor({ content, onChange, readOnly }: { content: AgendaSection[]; onChange: (c: AgendaSection[]) => void; readOnly: boolean }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');

  const sections = Array.isArray(content) ? content : [];

  // Handle flat sections (legacy) and subsection-based sections
  const addItem = (sectionIdx: number, subIdx?: number) => {
    if (!newItem.trim()) return;
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[sectionIdx].subsections) {
      updated[sectionIdx].subsections[subIdx].items.push(newItem.trim());
    } else {
      if (!updated[sectionIdx].items) updated[sectionIdx].items = [];
      updated[sectionIdx].items.push(newItem.trim());
    }
    onChange(updated);
    setNewItem('');
    setEditingKey(null);
  };

  const removeItem = (sectionIdx: number, itemIdx: number, subIdx?: number) => {
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[sectionIdx].subsections) {
      updated[sectionIdx].subsections[subIdx].items.splice(itemIdx, 1);
    } else {
      updated[sectionIdx].items?.splice(itemIdx, 1);
    }
    onChange(updated);
  };

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No content yet.</p>;
  }

  return (
    <div className="space-y-5">
      {sections.map((section, si) => (
        <div key={si}>
          <h4 className="text-sm font-semibold mb-2 text-foreground border-b pb-1">{section.section}</h4>

          {section.subsections ? (
            // Subsection-based layout
            <div className="space-y-3 pl-1">
              {section.subsections.map((sub, subi) => {
                const key = `${si}-${subi}`;
                return (
                  <div key={subi}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{sub.title}</h5>
                      {sub.ai_populatable && (
                        <Sparkles className="h-3 w-3 text-primary/50" title="AI can populate this section" />
                      )}
                    </div>
                    <ul className="space-y-1">
                      {sub.items?.map((item, ii) => (
                        <li key={ii} className="flex items-start gap-2 text-sm">
                          <ChevronRight className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
                          <span className="flex-1">{item}</span>
                          {!readOnly && (
                            <button className="text-xs text-destructive hover:underline shrink-0" onClick={() => removeItem(si, ii, subi)}>×</button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {sub.items?.length === 0 && readOnly && (
                      <p className="text-xs text-muted-foreground/60 italic pl-5">No items</p>
                    )}
                    {!readOnly && (
                      <div className="flex gap-1 mt-1.5">
                        <Input
                          className="h-7 text-xs"
                          placeholder={sub.placeholder || 'Add item...'}
                          value={editingKey === key ? newItem : ''}
                          onFocus={() => { setEditingKey(key); setNewItem(''); }}
                          onChange={e => setNewItem(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si, subi))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            // Flat items (legacy format)
            <div className="pl-1">
              <ul className="space-y-1">
                {section.items?.map((item, ii) => (
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
                    value={editingKey === `${si}-flat` ? newItem : ''}
                    onFocus={() => { setEditingKey(`${si}-flat`); setNewItem(''); }}
                    onChange={e => setNewItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si))}
                  />
                </div>
              )}
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
