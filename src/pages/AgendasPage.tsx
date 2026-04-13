import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Plus, Calendar, FileText, Copy, MoreHorizontal,
  Sparkles, LayoutTemplate, Loader2, CheckCircle2,
  Clock, Send, Search, ChevronDown, Zap, BarChart3, Phone, MessageSquare, ListChecks,
  TrendingUp, Minus, Bug, Plane, Toilet, Wrench, Bath
} from 'lucide-react';
import { format, addDays, nextMonday, isThisWeek, isThisMonth } from 'date-fns';
import { toast } from 'sonner';

/* ───── Types ───── */

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
  vertical?: string;
}

/* ───── Constants ───── */

const STATUS_CONFIG: Record<string, { label: string; dotClass: string; badgeClass: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', dotClass: 'bg-amber-400', badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-200', icon: Clock },
  published: { label: 'Published', dotClass: 'bg-blue-500', badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-200', icon: Send },
  completed: { label: 'Completed', dotClass: 'bg-emerald-500', badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
};

const TYPE_LABELS: Record<string, string> = {
  weekly: 'Weekly Review',
  adhoc: 'Ad Hoc',
  strategy: 'Strategy Session',
  creative_review: 'Creative Review',
};

const SECTION_COLORS: Record<string, { bg: string; border: string; icon: string; headerBg: string }> = {
  'Development Update': { bg: 'bg-violet-500/5', border: 'border-violet-500/20', icon: 'text-violet-500', headerBg: 'bg-violet-500/10' },
  'Marketing Strategy': { bg: 'bg-blue-500/5', border: 'border-blue-500/20', icon: 'text-blue-500', headerBg: 'bg-blue-500/10' },
  'General Connect Paid Media Needs': { bg: 'bg-orange-500/5', border: 'border-orange-500/20', icon: 'text-orange-500', headerBg: 'bg-orange-500/10' },
  'Notes from Billy.com Team': { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', icon: 'text-emerald-500', headerBg: 'bg-emerald-500/10' },
  'Notes from Client': { bg: 'bg-pink-500/5', border: 'border-pink-500/20', icon: 'text-pink-500', headerBg: 'bg-pink-500/10' },
};

const SECTION_ICONS: Record<string, typeof FileText> = {
  'Development Update': Zap,
  'Marketing Strategy': BarChart3,
  'General Connect Paid Media Needs': ListChecks,
  'Notes from Billy.com Team': MessageSquare,
  'Notes from Client': MessageSquare,
};

const VERTICAL_ICONS: Record<string, typeof Bug> = {
  'pest': Bug,
  'bathroom': Bath,
  'hvac': Wrench,
  'flight': Plane,
  'porta': Toilet,
};

function getVerticalIcon(vertical?: string) {
  if (!vertical) return null;
  const key = Object.keys(VERTICAL_ICONS).find(k => vertical.toLowerCase().includes(k));
  return key ? VERTICAL_ICONS[key] : TrendingUp;
}

const VERTICAL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'pest control': { bg: 'bg-green-500/8', border: 'border-green-500/25', text: 'text-green-700' },
  'bathroom remodel': { bg: 'bg-cyan-500/8', border: 'border-cyan-500/25', text: 'text-cyan-700' },
  'hvac': { bg: 'bg-red-500/8', border: 'border-red-500/25', text: 'text-red-700' },
  'flights': { bg: 'bg-sky-500/8', border: 'border-sky-500/25', text: 'text-sky-700' },
  'porta potty': { bg: 'bg-amber-500/8', border: 'border-amber-500/25', text: 'text-amber-700' },
};

function getVerticalColor(vertical?: string) {
  if (!vertical) return { bg: 'bg-muted/30', border: 'border-muted', text: 'text-muted-foreground' };
  const key = Object.keys(VERTICAL_COLORS).find(k => vertical.toLowerCase().includes(k));
  return key ? VERTICAL_COLORS[key] : { bg: 'bg-primary/5', border: 'border-primary/20', text: 'text-primary' };
}

/* ───── Main Component ───── */

export default function AgendasPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'ai' | 'manual'>('ai');
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newType, setNewType] = useState('weekly');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('blank');
  const [aiContext, setAiContext] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  const groupedAgendas = useMemo(() => {
    const filtered = searchQuery
      ? agendas.filter((a: any) => a.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : agendas;

    const groups: { label: string; items: any[] }[] = [];
    const thisWeek: any[] = [];
    const thisMonth: any[] = [];
    const older: any[] = [];

    for (const a of filtered) {
      const d = new Date(a.call_date);
      if (isThisWeek(d, { weekStartsOn: 1 })) thisWeek.push(a);
      else if (isThisMonth(d)) thisMonth.push(a);
      else older.push(a);
    }

    if (thisWeek.length) groups.push({ label: 'This Week', items: thisWeek });
    if (thisMonth.length) groups.push({ label: 'This Month', items: thisMonth });
    if (older.length) groups.push({ label: 'Earlier', items: older });

    return groups;
  }, [agendas, searchQuery]);

  /* ───── Mutations ───── */

  const createAgenda = useMutation({
    mutationFn: async () => {
      let agendaContent: AgendaSection[];
      let templateId: string | null = null;
      if (selectedTemplateId !== 'blank') {
        const tpl = templates.find((t: any) => t.id === selectedTemplateId);
        if (tpl) { agendaContent = tpl.sections as AgendaSection[]; templateId = tpl.id; }
        else agendaContent = defaultSections();
      } else agendaContent = defaultSections();

      const { data, error } = await supabase.from('call_agendas').insert({
        client_id: activeClient!.id,
        title: newTitle,
        call_date: newDate,
        call_type: newType,
        created_by_id: teamMember?.id || null,
        agenda_content: agendaContent,
        ...(templateId ? { template_id: templateId } : {}),
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('Agenda created');
      setIsCreateOpen(false);
      resetCreateForm();
      if (data) setSelectedId(data.id);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const generateWithAI = async (agendaId?: string) => {
    if (!activeClient) return;
    setIsGenerating(true);
    try {
      const defaultTemplate = templates.find((t: any) => t.is_default);
      const templateSections = defaultTemplate?.sections || defaultSections();
      const { data, error } = await supabase.functions.invoke('generate-agenda', {
        body: { client_id: activeClient.id, agenda_id: agendaId, template_sections: templateSections, additional_context: aiContext },
      });
      if (error) throw error;
      if (agendaId) {
        queryClient.invalidateQueries({ queryKey: ['agendas'] });
        toast.success('Agenda populated with AI insights');
      }
      setAiContext('');
      return data;
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate');
    } finally {
      setIsGenerating(false);
    }
  };

  const createAndGenerate = async () => {
    if (!activeClient) return;
    setIsGenerating(true);
    try {
      const defaultTemplate = templates.find((t: any) => t.is_default);
      const templateSections = defaultTemplate?.sections || defaultSections();
      const { data: newAgenda, error: insertError } = await supabase.from('call_agendas').insert({
        client_id: activeClient.id,
        title: newTitle || 'Weekly Digital Marketing Review',
        call_date: newDate || format(nextMonday(new Date()), 'yyyy-MM-dd'),
        call_type: newType,
        created_by_id: teamMember?.id || null,
        agenda_content: templateSections,
        template_id: defaultTemplate?.id || null,
      } as any).select().single();
      if (insertError) throw insertError;

      const { error: genError } = await supabase.functions.invoke('generate-agenda', {
        body: { client_id: activeClient.id, agenda_id: newAgenda.id, template_sections: templateSections, additional_context: aiContext },
      });
      if (genError) throw genError;

      queryClient.invalidateQueries({ queryKey: ['agendas'] });
      toast.success('AI agenda generated');
      setIsCreateOpen(false);
      resetCreateForm();
      setSelectedId(newAgenda.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate');
      queryClient.invalidateQueries({ queryKey: ['agendas'] });
    } finally {
      setIsGenerating(false);
    }
  };

  const duplicateAgenda = useMutation({
    mutationFn: async ({ source, withContent }: { source: any; withContent: boolean }) => {
      const nextDate = nextMonday(addDays(new Date(source.call_date), 1));
      const sections = (source.agenda_content || []) as AgendaSection[];
      const content = withContent ? sections : sections.map((s: AgendaSection) => ({
        ...s, items: [], subsections: s.subsections?.map((sub: AgendaSubsection) => ({ ...sub, items: [] })),
      }));
      const { error } = await supabase.from('call_agendas').insert({
        client_id: activeClient!.id, title: source.title, call_date: format(nextDate, 'yyyy-MM-dd'),
        call_type: source.call_type, created_by_id: teamMember?.id || null, agenda_content: content,
        notes_content: [], source_agenda_id: source.id, template_id: source.template_id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['agendas'] }); toast.success('Agenda duplicated'); },
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
      const { error } = await supabase.from('call_action_items').insert({ call_agenda_id: selectedId!, description });
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
    setNewTitle(''); setNewDate(''); setNewType('weekly');
    setSelectedTemplateId('blank'); setAiContext(''); setCreateMode('ai');
  };

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* ───── LEFT PANEL: Agenda List ───── */}
      <div className="w-[300px] shrink-0 border-r flex flex-col bg-card">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold tracking-tight">Agendas</h1>
            <div className="flex gap-1.5">
              <Button
                size="sm" variant="outline"
                className="h-8 gap-1.5 text-xs border-primary/20 text-primary hover:bg-primary/5"
                onClick={() => { setCreateMode('ai'); setIsCreateOpen(true); }}
              >
                <Sparkles className="h-3.5 w-3.5" /> AI
              </Button>
              <Button size="sm" className="h-8 gap-1" onClick={() => { setCreateMode('manual'); setIsCreateOpen(true); }}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs bg-muted/50 border-0"
              placeholder="Search agendas..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {groupedAgendas.map(group => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">
                  {group.label}
                </p>
                {group.items.map((agenda: any) => {
                  const cfg = STATUS_CONFIG[agenda.status] || STATUS_CONFIG.draft;
                  const isActive = selectedId === agenda.id;
                  return (
                    <div
                      key={agenda.id}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                        isActive ? 'bg-primary/8 ring-1 ring-primary/20' : 'hover:bg-muted/60'
                      }`}
                      onClick={() => setSelectedId(agenda.id)}
                    >
                      <div className={`shrink-0 w-2 h-2 rounded-full ${cfg.dotClass}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate leading-tight">{agenda.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(agenda.call_date), 'MMM d')}
                          </span>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-[11px] text-muted-foreground">
                            {TYPE_LABELS[agenda.call_type]?.split(' ')[0] || agenda.call_type}
                          </span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted">
                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => duplicateAgenda.mutate({ source: agenda, withContent: false })}>
                            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate (Empty)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateAgenda.mutate({ source: agenda, withContent: true })}>
                            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate with Content
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { setSelectedId(agenda.id); generateWithAI(agenda.id); }}>
                            <Sparkles className="mr-2 h-3.5 w-3.5" /> Regenerate with AI
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            ))}
            {groupedAgendas.length === 0 && (
              <div className="text-center py-16 space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
                  <FileText className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">No agendas yet</p>
                <p className="text-xs text-muted-foreground/60">Create your first one</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ───── RIGHT PANEL: Detail (full width) ───── */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <ScrollArea className="h-full">
            <div className="py-6 px-8 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">{selected.title}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(selected.call_date), 'EEEE, MMMM d, yyyy')}
                    </span>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_CONFIG[selected.status]?.badgeClass || ''}`}>
                      {STATUS_CONFIG[selected.status]?.label || selected.status}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABELS[selected.call_type] || selected.call_type}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  {selected.status === 'draft' && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                      onClick={() => generateWithAI(selected.id)} disabled={isGenerating}>
                      {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      AI Populate
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                        <Copy className="h-3.5 w-3.5" /> Duplicate <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => duplicateAgenda.mutate({ source: selected, withContent: false })}>
                        Empty (structure only)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateAgenda.mutate({ source: selected, withContent: true })}>
                        With current content
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {selected.status === 'draft' && (
                    <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => updateStatus.mutate({ id: selected.id, status: 'published' })}>
                      <Send className="h-3.5 w-3.5" /> Publish
                    </Button>
                  )}
                  {selected.status === 'published' && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => updateStatus.mutate({ id: selected.id, status: 'completed' })}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                    </Button>
                  )}
                </div>
              </div>

              {/* AI generating overlay */}
              {isGenerating && (
                <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Generating with AI...</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Analyzing dashboards, Ringba, context feed, and open items</p>
                  </div>
                </div>
              )}

              {/* Agenda Content — color-coded sections */}
              <div className="space-y-4">
                <AgendaContentView
                  content={(selected.agenda_content as any) || []}
                  onChange={(c) => updateContent.mutate({ id: selected.id, field: 'agenda_content', value: c })}
                  readOnly={selected.status === 'completed'}
                />
              </div>

              {/* Meeting Notes */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5" /> Meeting Notes
                </h3>
                <div className="rounded-xl border bg-card overflow-hidden">
                  <SimpleEditor
                    content={(selected.notes_content as any) || []}
                    onChange={(c) => updateContent.mutate({ id: selected.id, field: 'notes_content', value: c })}
                    readOnly={selected.status !== 'completed' && selected.status !== 'published'}
                  />
                </div>
              </div>

              {/* Action Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Action Items
                  </h3>
                  {actionItems.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {actionItems.filter((i: any) => i.completed).length}/{actionItems.length} complete
                    </span>
                  )}
                </div>
                <div className="rounded-xl border bg-card p-4 space-y-2">
                  {actionItems.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-3 group">
                      <button
                        onClick={() => toggleActionItem.mutate({ id: item.id, completed: !item.completed })}
                        className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          item.completed ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground/30 hover:border-primary/50'
                        }`}
                      >
                        {item.completed && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </button>
                      <span className={`text-sm flex-1 ${item.completed ? 'line-through text-muted-foreground/50' : ''}`}>
                        {item.description}
                      </span>
                      {item.assignee && (
                        <Badge variant="secondary" className="text-[10px] font-normal">{item.assignee.name}</Badge>
                      )}
                    </div>
                  ))}
                  <ActionItemInput onAdd={(desc) => addActionItem.mutate({ description: desc })} />
                </div>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-6 max-w-xs">
              <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto">
                <FileText className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <div>
                <p className="text-sm font-medium">No agenda selected</p>
                <p className="text-xs text-muted-foreground mt-1">Choose one from the list or generate a new agenda with AI</p>
              </div>
              <div className="flex gap-2 justify-center">
                <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => { setCreateMode('manual'); setIsCreateOpen(true); }}>
                  <Plus className="h-3.5 w-3.5" /> Manual
                </Button>
                <Button size="sm" className="gap-1.5 h-9" onClick={() => { setCreateMode('ai'); setIsCreateOpen(true); }}>
                  <Sparkles className="h-3.5 w-3.5" /> AI Generate
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ───── CREATE DIALOG ───── */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <div className="flex border-b">
            <button
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-2 ${
                createMode === 'ai' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setCreateMode('ai')}
            >
              <Sparkles className="h-4 w-4" /> AI Generate
            </button>
            <button
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-2 ${
                createMode === 'manual' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setCreateMode('manual')}
            >
              <FileText className="h-4 w-4" /> Manual
            </button>
          </div>

          <div className="p-5 space-y-4">
            {createMode === 'ai' ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: BarChart3, label: 'Dashboards', desc: 'Meta + Google performance' },
                    { icon: Phone, label: 'Ringba', desc: 'Call data & revenue' },
                    { icon: MessageSquare, label: 'Context', desc: 'Comms & feed items' },
                  ].map(src => (
                    <div key={src.label} className="rounded-lg border bg-muted/30 p-2.5 text-center">
                      <src.icon className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                      <p className="text-[11px] font-medium">{src.label}</p>
                      <p className="text-[10px] text-muted-foreground">{src.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Call Date</Label>
                    <Input type="date" className="h-9 text-sm"
                      value={newDate || format(nextMonday(new Date()), 'yyyy-MM-dd')}
                      onChange={e => setNewDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select value={newType} onValueChange={setNewType}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly Review</SelectItem>
                        <SelectItem value="adhoc">Ad Hoc</SelectItem>
                        <SelectItem value="strategy">Strategy Session</SelectItem>
                        <SelectItem value="creative_review">Creative Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Additional Context <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea
                    placeholder="e.g. 'Focus on Bathroom Remodel launch' or 'Client raised budget concerns'"
                    value={aiContext} onChange={e => setAiContext(e.target.value)}
                    className="h-20 text-sm resize-none"
                  />
                </div>

                <Button className="w-full h-10 gap-2" onClick={createAndGenerate} disabled={isGenerating}>
                  {isGenerating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing & generating...</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Generate Agenda</>
                  )}
                </Button>
              </>
            ) : (
              <form onSubmit={e => { e.preventDefault(); createAgenda.mutate(); }} className="space-y-4">
                {templates.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5"><LayoutTemplate className="h-3.5 w-3.5" /> Template</Label>
                    <Select value={selectedTemplateId} onValueChange={(v) => {
                      setSelectedTemplateId(v);
                      if (v !== 'blank') {
                        const t = templates.find((t: any) => t.id === v);
                        if (t && !newTitle) { setNewTitle(t.name); setNewType(t.template_type || 'weekly'); }
                      }
                    }}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blank">Blank Agenda</SelectItem>
                        {templates.map((t: any) => (
                          <SelectItem key={t.id} value={t.id}>{t.name} {t.is_default && '★'}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Title</Label>
                  <Input className="h-9" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Weekly Digital Marketing Review" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Call Date</Label>
                    <Input type="date" className="h-9" value={newDate} onChange={e => setNewDate(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select value={newType} onValueChange={setNewType}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly Review</SelectItem>
                        <SelectItem value="adhoc">Ad Hoc</SelectItem>
                        <SelectItem value="strategy">Strategy Session</SelectItem>
                        <SelectItem value="creative_review">Creative Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" className="w-full h-10" disabled={createAgenda.isPending}>Create Agenda</Button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───── Default Sections with vertical breakdowns ───── */

function defaultSections(): AgendaSection[] {
  const verticals = [
    { name: 'Flights', id: 'flights' },
    { name: 'Pest Control', id: 'pest_control' },
    { name: 'Porta Potty', id: 'porta_potty' },
    { name: 'Bathroom Remodel', id: 'bathroom_remodel' },
    { name: 'HVAC', id: 'hvac' },
  ];

  return [
    { section: 'Development Update', subsections: [
      { title: 'In Progress', items: [], placeholder: 'Current development work...' },
      { title: 'Upcoming Priorities', items: [], placeholder: 'Next priorities...' },
      { title: 'Action Items / Needs', items: [], placeholder: 'Dev action items...' },
    ]},
    { section: 'Marketing Strategy — Overview', subsections: [
      { title: 'Overall Performance Recap', items: [], placeholder: 'High-level cross-vertical metrics...', ai_populatable: true },
      { title: 'Budget & Pacing', items: [], placeholder: 'Budget status across verticals...', ai_populatable: true },
      { title: 'Upcoming Launches', items: [], placeholder: 'Planned launches...' },
    ]},
    ...verticals.map(v => ({
      section: `${v.name} — Vertical Update`,
      vertical: v.id,
      subsections: [
        { title: 'Google Ads', items: [], placeholder: `Google performance for ${v.name}...`, ai_populatable: true },
        { title: 'Meta Ads', items: [], placeholder: `Meta performance for ${v.name}...`, ai_populatable: true },
        { title: 'Ringba / Calls', items: [], placeholder: `Call metrics for ${v.name}...`, ai_populatable: true },
        { title: 'Notes & Action Items', items: [], placeholder: `${v.name} action items...` },
      ],
    })),
    { section: 'General Connect Paid Media Needs', subsections: [
      { title: 'Items', items: [], placeholder: 'Broader support requests...' },
    ]},
    { section: 'Notes from Client', subsections: [
      { title: 'Items', items: [], placeholder: 'Client comments...' },
    ]},
  ];
}

/* ───── Color-Coded Agenda Content View ───── */

function AgendaContentView({ content, onChange, readOnly }: { content: AgendaSection[]; onChange: (c: AgendaSection[]) => void; readOnly: boolean }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const sections = Array.isArray(content) ? content : [];

  const addItem = (si: number, subIdx?: number) => {
    if (!newItem.trim()) return;
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[si].subsections) {
      updated[si].subsections[subIdx].items.push(newItem.trim());
    } else {
      if (!updated[si].items) updated[si].items = [];
      updated[si].items.push(newItem.trim());
    }
    onChange(updated);
    setNewItem('');
    setEditingKey(null);
  };

  const removeItem = (si: number, ii: number, subIdx?: number) => {
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[si].subsections) updated[si].subsections[subIdx].items.splice(ii, 1);
    else updated[si].items?.splice(ii, 1);
    onChange(updated);
  };

  const updateItem = (si: number, ii: number, value: string, subIdx?: number) => {
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[si].subsections) {
      updated[si].subsections[subIdx].items[ii] = value;
    } else if (updated[si].items) {
      updated[si].items[ii] = value;
    }
    onChange(updated);
  };

  if (sections.length === 0) {
    return <div className="p-6 text-center"><p className="text-sm text-muted-foreground">No content yet.</p></div>;
  }

  // Detect if this is a vertical section
  const isVerticalSection = (section: AgendaSection) => {
    return section.vertical || section.section.includes('Vertical Update');
  };

  return (
    <div className="space-y-4">
      {sections.map((section, si) => {
    const isVertical = isVerticalSection(section);
        const sectionName = section.section;
        const vc = isVertical ? getVerticalColor(sectionName) : null;
        const sc = !isVertical ? (SECTION_COLORS[sectionName] || { bg: 'bg-muted/20', border: 'border-muted', icon: 'text-muted-foreground', headerBg: 'bg-muted/30' }) : null;
        const Icon = isVertical
          ? (getVerticalIcon(sectionName) || TrendingUp)
          : (SECTION_ICONS[sectionName] || FileText);

        const borderClass = isVertical ? vc!.border : sc!.border;
        const headerBgClass = isVertical ? vc!.bg : sc!.headerBg;
        const iconBgClass = isVertical ? `${vc!.bg} border ${vc!.border}` : sc!.bg;
        const iconColorClass = isVertical ? vc!.text : sc!.icon;

        return (
          <div key={si} className={`rounded-xl border ${borderClass} overflow-hidden`}>
            {/* Section Header */}
            <div className={`px-4 py-3 flex items-center gap-3 ${headerBgClass}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBgClass}`}>
                <Icon className={`h-4 w-4 ${iconColorClass}`} />
              </div>
              <h4 className="text-sm font-semibold flex-1">{sectionName}</h4>
              {isVertical && vc && (
                <Badge variant="outline" className={`text-[10px] ${vc.text} ${vc.border}`}>
                  Vertical
                </Badge>
              )}
            </div>

            {/* Section Body */}
            <div className="bg-card">
              {section.subsections ? (
                <div className="divide-y divide-border/50">
                  {section.subsections.map((sub, subi) => {
                    const key = `${si}-${subi}`;
                    const hasItems = sub.items && sub.items.length > 0;
                    return (
                      <div key={subi} className="px-5 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{sub.title}</h5>
                          {sub.ai_populatable && (
                            <Sparkles className="h-2.5 w-2.5 text-primary/40" />
                          )}
                        </div>
                        <ul className="space-y-1">
                          {sub.items?.map((item, ii) => (
                            <EditableItem
                              key={ii}
                              value={item}
                              readOnly={readOnly}
                              onUpdate={(val) => updateItem(si, ii, val, subi)}
                              onRemove={() => removeItem(si, ii, subi)}
                            />
                          ))}
                        </ul>
                        {!hasItems && readOnly && (
                          <p className="text-xs text-muted-foreground/40 italic pl-5">—</p>
                        )}
                        {!readOnly && (
                          <Input
                            className="h-7 text-xs mt-2 border-dashed border-muted-foreground/15 bg-transparent focus:bg-card"
                            placeholder={sub.placeholder || 'Add item...'}
                            value={editingKey === key ? newItem : ''}
                            onFocus={() => { setEditingKey(key); setNewItem(''); }}
                            onChange={e => setNewItem(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si, subi))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-3">
                  <ul className="space-y-1">
                    {section.items?.map((item, ii) => (
                      <EditableItem
                        key={ii}
                        value={item}
                        readOnly={readOnly}
                        onUpdate={(val) => updateItem(si, ii, val)}
                        onRemove={() => removeItem(si, ii)}
                      />
                    ))}
                  </ul>
                  {!readOnly && (
                    <Input
                      className="h-7 text-xs mt-2 border-dashed border-muted-foreground/15 bg-transparent focus:bg-card"
                      placeholder="Add item..."
                      value={editingKey === `${si}-flat` ? newItem : ''}
                      onFocus={() => { setEditingKey(`${si}-flat`); setNewItem(''); }}
                      onChange={e => setNewItem(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si))}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───── Simple Editor (for notes) ───── */

function SimpleEditor({ content, onChange, readOnly }: { content: AgendaSection[]; onChange: (c: AgendaSection[]) => void; readOnly: boolean }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const sections = Array.isArray(content) ? content : [];

  const addItem = (si: number, subIdx?: number) => {
    if (!newItem.trim()) return;
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[si].subsections) {
      updated[si].subsections[subIdx].items.push(newItem.trim());
    } else {
      if (!updated[si].items) updated[si].items = [];
      updated[si].items.push(newItem.trim());
    }
    onChange(updated);
    setNewItem('');
    setEditingKey(null);
  };

  const removeItem = (si: number, ii: number, subIdx?: number) => {
    const updated = JSON.parse(JSON.stringify(sections));
    if (subIdx !== undefined && updated[si].subsections) updated[si].subsections[subIdx].items.splice(ii, 1);
    else updated[si].items?.splice(ii, 1);
    onChange(updated);
  };

  if (sections.length === 0) {
    return <div className="p-6 text-center"><p className="text-sm text-muted-foreground">No notes yet.</p></div>;
  }

  return (
    <div className="divide-y">
      {sections.map((section, si) => (
        <div key={si} className="p-4">
          <h4 className="text-sm font-semibold mb-2">{section.section}</h4>
          {section.subsections ? (
            <div className="space-y-3 pl-4">
              {section.subsections.map((sub, subi) => {
                const key = `note-${si}-${subi}`;
                return (
                  <div key={subi}>
                    <h5 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{sub.title}</h5>
                    <ul className="space-y-1">
                      {sub.items?.map((item, ii) => (
                        <li key={ii} className="flex items-start gap-2 text-[13px] leading-relaxed group/item">
                          <Minus className="h-3 w-3 mt-1 shrink-0 text-muted-foreground/30" />
                          <span className="flex-1">{item}</span>
                          {!readOnly && (
                            <button className="opacity-0 group-hover/item:opacity-100 text-xs text-destructive/60 hover:text-destructive" onClick={() => removeItem(si, ii, subi)}>×</button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {!readOnly && (
                      <Input
                        className="h-7 text-xs mt-1 border-dashed border-muted-foreground/15 bg-transparent"
                        placeholder={sub.placeholder || 'Add note...'}
                        value={editingKey === key ? newItem : ''}
                        onFocus={() => { setEditingKey(key); setNewItem(''); }}
                        onChange={e => setNewItem(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si, subi))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="pl-4">
              <ul className="space-y-1">
                {section.items?.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2 text-[13px] group/item">
                    <Minus className="h-3 w-3 mt-1 shrink-0 text-muted-foreground/30" />
                    <span className="flex-1">{item}</span>
                    {!readOnly && (
                      <button className="opacity-0 group-hover/item:opacity-100 text-xs text-destructive/60 hover:text-destructive" onClick={() => removeItem(si, ii)}>×</button>
                    )}
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <Input
                  className="h-7 text-xs mt-1 border-dashed border-muted-foreground/15 bg-transparent"
                  placeholder="Add note..."
                  value={editingKey === `note-${si}-flat` ? newItem : ''}
                  onFocus={() => { setEditingKey(`note-${si}-flat`); setNewItem(''); }}
                  onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(si))}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ───── Editable Item ───── */

function EditableItem({ value, readOnly, onUpdate, onRemove }: {
  value: string; readOnly: boolean; onUpdate: (val: string) => void; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing && !readOnly) {
    return (
      <li className="flex items-start gap-2 text-[13px] leading-relaxed">
        <span className="text-muted-foreground/40 mt-1 shrink-0">•</span>
        <Input
          autoFocus
          className="h-7 text-[13px] flex-1 border-primary/30 bg-primary/5"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() && draft !== value) onUpdate(draft.trim());
            setEditing(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim() && draft !== value) onUpdate(draft.trim()); setEditing(false); }
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed group/item">
      <span className="text-muted-foreground/40 mt-0.5 shrink-0">•</span>
      <span
        className={`flex-1 ${!readOnly ? 'cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors' : ''}`}
        onClick={() => { if (!readOnly) { setDraft(value); setEditing(true); } }}
      >
        {value}
      </span>
      {!readOnly && (
        <button className="opacity-0 group-hover/item:opacity-100 text-xs text-destructive/60 hover:text-destructive shrink-0 transition-opacity" onClick={onRemove}>×</button>
      )}
    </li>
  );
}

/* ───── Action Item Input ───── */

function ActionItemInput({ onAdd }: { onAdd: (desc: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-dashed">
      <Input
        className="h-8 text-sm bg-transparent border-dashed"
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
      <Button size="sm" variant="secondary" className="h-8 text-xs shrink-0" onClick={() => { if (value.trim()) { onAdd(value.trim()); setValue(''); } }}>
        Add
      </Button>
    </div>
  );
}
