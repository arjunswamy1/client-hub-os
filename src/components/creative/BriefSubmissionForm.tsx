
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Minus, Save, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { CREATIVE_TYPES, PLATFORMS, SIZE_PRESETS, FUNNEL_STAGES, SizePreset } from '@/types/creative';

interface BriefFormData {
  title: string;
  client_id: string;
  creative_types: string[];
  platforms: string[];
  sizes: SizePreset[];
  funnel_stage: string;
  num_concepts: number;
  objective: string;
  key_message: string;
  copy_suggestions: { primary_text: string; headline: string; description: string }[];
  target_audience: string;
  tone_style: string;
  dos_and_donts: string;
  reference_urls: string;
  due_date: string;
  priority: string;
  assigned_to_id: string;
  notes: string;
  custom_width: string;
  custom_height: string;
}

const SPECIAL_CLIENT_OPTIONS = [
  { id: '__new_business__', name: 'New Business', color: '#6366f1' },
  { id: '__other__', name: 'Other / Ad Hoc', color: '#94a3b8' },
];

const INITIAL_FORM: BriefFormData = {
  title: '', client_id: '', creative_types: [], platforms: [], sizes: [],
  funnel_stage: '', num_concepts: 1, objective: '', key_message: '',
  copy_suggestions: [{ primary_text: '', headline: '', description: '' }],
  target_audience: '', tone_style: '', dos_and_donts: '', reference_urls: '',
  due_date: '', priority: 'medium', assigned_to_id: '', notes: '',
  custom_width: '', custom_height: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}

export function BriefSubmissionForm({ open, onOpenChange, clientId }: Props) {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth();
  const [form, setForm] = useState<BriefFormData>({ ...INITIAL_FORM, client_id: clientId });
  const [step, setStep] = useState(0);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_for_brief'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, color').eq('status', 'active').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('is_active', true);
      if (error) throw error;
      return data;
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['brief_templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('creative_brief_templates').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const set = (field: keyof BriefFormData, value: any) => setForm(f => ({ ...f, [field]: value }));

  const toggleArrayItem = (field: 'creative_types' | 'platforms', value: string) => {
    setForm(f => {
      const arr = f[field];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  const toggleSize = (preset: SizePreset) => {
    setForm(f => {
      const exists = f.sizes.find(s => s.label === preset.label);
      return { ...f, sizes: exists ? f.sizes.filter(s => s.label !== preset.label) : [...f.sizes, preset] };
    });
  };

  const addCustomSize = () => {
    const w = parseInt(form.custom_width);
    const h = parseInt(form.custom_height);
    if (w > 0 && h > 0) {
      const label = `Custom (${w}×${h})`;
      setForm(f => ({
        ...f, sizes: [...f.sizes, { label, width: w, height: h }],
        custom_width: '', custom_height: '',
      }));
    }
  };

  const addCopyVariation = () => {
    setForm(f => ({
      ...f,
      copy_suggestions: [...f.copy_suggestions, { primary_text: '', headline: '', description: '' }],
    }));
  };

  const updateCopy = (idx: number, field: string, value: string) => {
    setForm(f => {
      const copies = [...f.copy_suggestions];
      copies[idx] = { ...copies[idx], [field]: value };
      return { ...f, copy_suggestions: copies };
    });
  };

  const removeCopy = (idx: number) => {
    setForm(f => ({ ...f, copy_suggestions: f.copy_suggestions.filter((_, i) => i !== idx) }));
  };

  const loadTemplate = (templateData: any) => {
    if (!templateData) return;
    const td = typeof templateData === 'string' ? JSON.parse(templateData) : templateData;
    setForm(f => ({ ...f, ...td }));
    toast.success('Template loaded');
  };

  const saveTemplate = useMutation({
    mutationFn: async (name: string) => {
      const templateData = {
        creative_types: form.creative_types, platforms: form.platforms,
        sizes: form.sizes, funnel_stage: form.funnel_stage, num_concepts: form.num_concepts,
        priority: form.priority,
      };
      const { error } = await supabase.from('creative_brief_templates').insert({
        name,
        created_by_id: teamMember?.id,
        template_data: templateData as any,
        is_global: false,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brief_templates'] });
      toast.success('Template saved');
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Calculate expected deliverables
  const expectedDeliverables = form.sizes.length * form.num_concepts;

  const createBrief = useMutation({
    mutationFn: async () => {
      const designer = teamMembers.find((m: any) => m.role === 'designer');
      const assignedTo = form.assigned_to_id || designer?.id || null;
      const references = form.reference_urls
        ? form.reference_urls.split('\n').filter(Boolean).map(url => ({ source: 'url', drive_url: url.trim(), note: '' }))
        : [];

      const { data: brief, error } = await supabase.from('creative_briefs').insert({
        client_id: form.client_id.startsWith('__') ? clientId : form.client_id,
        title: form.title,
        creative_type: form.creative_types[0] || 'static',
        creative_types: form.creative_types,
        platforms: form.platforms,
        sizes: form.sizes,
        funnel_stage: form.funnel_stage || null,
        num_concepts: form.num_concepts,
        objective: form.objective || null,
        key_message: form.key_message || null,
        copy_suggestions: form.copy_suggestions.filter(c => c.primary_text || c.headline || c.description),
        target_audience: form.target_audience || null,
        tone_style: form.tone_style || null,
        dos_and_donts: form.dos_and_donts || null,
        reference_assets: references,
        due_date: form.due_date || null,
        priority: form.priority,
        assigned_to_id: assignedTo,
        created_by_id: teamMember?.id || null,
        notes: form.notes || null,
        status: 'draft',
      } as any).select().single();
      if (error) throw error;

      // Auto-generate deliverables
      if (brief && form.sizes.length > 0) {
        const conceptLabels = Array.from({ length: form.num_concepts }, (_, i) =>
          `Concept ${String.fromCharCode(65 + i)}`
        );
        const deliverables = conceptLabels.flatMap(concept =>
          form.sizes.map(size => ({
            brief_id: brief.id,
            concept_label: concept,
            size_label: `${size.label} (${size.width}×${size.height})`,
            width: size.width,
            height: size.height,
            file_name: '',
            file_url: '',
            status: 'pending',
          }))
        );
        const { error: delError } = await supabase.from('creative_deliverables').insert(deliverables as any);
        if (delError) console.error('Failed to create deliverables:', delError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success('Brief created with ' + expectedDeliverables + ' deliverables');
      onOpenChange(false);
      setForm({ ...INITIAL_FORM });
      setStep(0);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const steps = ['Basic Info', 'Creative Specs', 'Brief Content', 'References & Submit'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Creative Brief</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-4">
          {steps.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Template loader */}
        {step === 0 && templates.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <Select onValueChange={(v) => {
              const t = templates.find((t: any) => t.id === v);
              if (t) loadTemplate(t.template_data);
            }}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Load template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); createBrief.mutate(); }} className="space-y-4">
          {/* Step 0: Basic Info */}
          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label>Client *</Label>
                <Select value={form.client_id} onValueChange={v => set('client_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select client..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: c.color || '#94a3b8' }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                    {SPECIAL_CLIENT_OPTIONS.map(opt => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                          {opt.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Brief Title *</Label>
                <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder='e.g., "Spring Sale Static Set"' required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => set('priority', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">🔴 Urgent</SelectItem>
                      <SelectItem value="high">🟠 High</SelectItem>
                      <SelectItem value="medium">🔵 Medium</SelectItem>
                      <SelectItem value="low">⚪ Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due Date *</Label>
                  <Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select value={form.assigned_to_id} onValueChange={v => set('assigned_to_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Auto-assign to designer" /></SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>{m.name} ({m.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Step 1: Creative Specs */}
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label>Creative Type(s) *</Label>
                <div className="flex flex-wrap gap-2">
                  {CREATIVE_TYPES.map(ct => (
                    <Badge
                      key={ct.value}
                      variant={form.creative_types.includes(ct.value) ? 'default' : 'outline'}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggleArrayItem('creative_types', ct.value)}
                    >
                      {ct.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Platform(s) *</Label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <Badge
                      key={p.value}
                      variant={form.platforms.includes(p.value) ? 'default' : 'outline'}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggleArrayItem('platforms', p.value)}
                    >
                      {p.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Size/Format Variations *</Label>
                <div className="flex flex-wrap gap-2">
                  {SIZE_PRESETS.map(sp => (
                    <Badge
                      key={sp.label}
                      variant={form.sizes.find(s => s.label === sp.label) ? 'default' : 'outline'}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggleSize(sp)}
                    >
                      {sp.label} ({sp.width}×{sp.height})
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input className="w-24 h-8 text-xs" placeholder="Width" value={form.custom_width} onChange={e => set('custom_width', e.target.value)} />
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input className="w-24 h-8 text-xs" placeholder="Height" value={form.custom_height} onChange={e => set('custom_height', e.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={addCustomSize}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
                {form.sizes.filter(s => !SIZE_PRESETS.find(p => p.label === s.label)).map(s => (
                  <Badge key={s.label} variant="default" className="cursor-pointer" onClick={() => toggleSize(s)}>
                    {s.label} ×
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Funnel Stage</Label>
                  <Select value={form.funnel_stage} onValueChange={v => set('funnel_stage', v)}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {FUNNEL_STAGES.map(fs => (
                        <SelectItem key={fs.value} value={fs.value}>{fs.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label># of Concepts</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                      onClick={() => set('num_concepts', Math.max(1, form.num_concepts - 1))}
                    ><Minus className="h-3 w-3" /></Button>
                    <span className="text-sm font-medium w-8 text-center">{form.num_concepts}</span>
                    <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                      onClick={() => set('num_concepts', form.num_concepts + 1)}
                    ><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>
              </div>

              {expectedDeliverables > 0 && (
                <div className="rounded-lg border bg-accent/50 p-3">
                  <p className="text-xs font-medium text-foreground">Expected Deliverables: {expectedDeliverables}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {form.num_concepts} concept{form.num_concepts > 1 ? 's' : ''} × {form.sizes.length} size{form.sizes.length > 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Step 2: Brief Content */}
          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label>Objective / What this ad needs to do</Label>
                <Textarea value={form.objective} onChange={e => set('objective', e.target.value)} rows={3} placeholder="Stop the scroll with our best-seller..." />
              </div>
              <div className="space-y-2">
                <Label>Key Message / CTA</Label>
                <Input value={form.key_message} onChange={e => set('key_message', e.target.value)} placeholder="Shop the Spring Sale — 30% off everything" />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Copy Suggestions</Label>
                  <Button type="button" size="sm" variant="ghost" onClick={addCopyVariation}>
                    <Plus className="h-3 w-3 mr-1" /> Add Variation
                  </Button>
                </div>
                {form.copy_suggestions.map((copy, idx) => (
                  <div key={idx} className="rounded border p-3 space-y-2 relative">
                    {form.copy_suggestions.length > 1 && (
                      <button type="button" className="absolute top-2 right-2 text-muted-foreground hover:text-destructive" onClick={() => removeCopy(idx)}>×</button>
                    )}
                    <p className="text-[10px] font-medium text-muted-foreground">Variation {idx + 1}</p>
                    <Input placeholder="Primary text" value={copy.primary_text} onChange={e => updateCopy(idx, 'primary_text', e.target.value)} className="text-sm" />
                    <Input placeholder="Headline" value={copy.headline} onChange={e => updateCopy(idx, 'headline', e.target.value)} className="text-sm" />
                    <Input placeholder="Description" value={copy.description} onChange={e => updateCopy(idx, 'description', e.target.value)} className="text-sm" />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Target Audience</Label>
                <Textarea value={form.target_audience} onChange={e => set('target_audience', e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Tone / Style Direction</Label>
                <Input value={form.tone_style} onChange={e => set('tone_style', e.target.value)} placeholder='e.g., "Bold and urgent", "Calm and premium"' />
              </div>
              <div className="space-y-2">
                <Label>Do's and Don'ts</Label>
                <Textarea value={form.dos_and_donts} onChange={e => set('dos_and_donts', e.target.value)} rows={2} placeholder="Don't use red backgrounds. Must include promo code." />
              </div>
            </>
          )}

          {/* Step 3: References & Submit */}
          {step === 3 && (
            <>
              <div className="space-y-2">
                <Label>Reference URLs (one per line)</Label>
                <Textarea value={form.reference_urls} onChange={e => set('reference_urls', e.target.value)} rows={3} placeholder="Paste links to competitor ads, inspiration, Figma files..." />
              </div>
              <div className="space-y-2">
                <Label>Additional Notes</Label>
                <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
              </div>

              {/* Drive asset browser placeholder */}
              <div className="rounded-lg border-2 border-dashed border-muted p-6 text-center">
                <FileUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Google Drive Asset Browser</p>
                <p className="text-xs text-muted-foreground">Connect Google Drive in Settings to browse and attach client assets</p>
              </div>

              {/* Summary */}
              <div className="rounded-lg border bg-accent/50 p-4 space-y-2">
                <h4 className="text-sm font-medium">Brief Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Title:</span> {form.title || '—'}</div>
                  <div><span className="text-muted-foreground">Priority:</span> {form.priority}</div>
                  <div><span className="text-muted-foreground">Types:</span> {form.creative_types.join(', ') || '—'}</div>
                  <div><span className="text-muted-foreground">Platforms:</span> {form.platforms.join(', ') || '—'}</div>
                  <div><span className="text-muted-foreground">Deliverables:</span> {expectedDeliverables}</div>
                  <div><span className="text-muted-foreground">Due:</span> {form.due_date || '—'}</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => {
                  const name = prompt('Template name:');
                  if (name) saveTemplate.mutate(name);
                }}>
                  <Save className="h-3 w-3 mr-1" /> Save as Template
                </Button>
                <Button type="submit" className="flex-1" disabled={createBrief.isPending || !form.title}>
                  {createBrief.isPending ? 'Creating...' : 'Create Brief'}
                </Button>
              </div>
            </>
          )}

          {/* Navigation */}
          {step < 3 && (
            <div className="flex justify-between pt-2">
              <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep(s => s - 1)}>Back</Button>
              <Button type="button" onClick={() => setStep(s => s + 1)}>Next</Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
