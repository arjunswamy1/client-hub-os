
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
import { Plus, Minus, FileUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { PLATFORMS, SIZE_PRESETS, SizePreset, getRelevantSizeGroups } from '@/types/creative';

interface BriefFormData {
  title: string;
  client_id: string;
  format: 'video' | 'static' | '';
  platforms: string[];
  sizes: SizePreset[];
  num_concepts: number;
  description: string;
  reference_urls: string;
  due_date: string;
  priority: string;
  custom_width: string;
  custom_height: string;
}

const SPECIAL_CLIENT_OPTIONS = [
  { id: '__new_business__', name: 'New Business', color: '#6366f1' },
  { id: '__other__', name: 'Other / Ad Hoc', color: '#94a3b8' },
];

const INTERNAL_OPTIONS = [
  { id: '__internal__', name: '🏢 Internal / Marketing', color: '#6366f1' },
];

interface UploadedReference {
  file_name: string;
  url: string;
  file_type: string;
  size: number;
}

const INITIAL_FORM: BriefFormData = {
  title: '', client_id: '', format: '', platforms: [], sizes: [],
  num_concepts: 1, description: '', reference_urls: '',
  due_date: '', priority: 'medium', custom_width: '', custom_height: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
}

export function BriefSubmissionForm({ open, onOpenChange, clientId }: Props) {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth();
  const [form, setForm] = useState<BriefFormData>({ ...INITIAL_FORM, client_id: clientId || '' });
  const [uploadedRefs, setUploadedRefs] = useState<UploadedReference[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showSpecs, setShowSpecs] = useState(false);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX_BYTES = 50 * 1024 * 1024;
    const oversized = Array.from(files).filter(f => f.size > MAX_BYTES);
    if (oversized.length) {
      toast.error(
        `${oversized[0].name} is ${(oversized[0].size / 1024 / 1024).toFixed(1)} MB. Files over 50 MB can't be uploaded directly — please share via Google Drive / Dropbox and paste the link in the links field above.`,
        { duration: 8000 }
      );
      return;
    }
    setUploading(true);
    try {
      const newRefs: UploadedReference[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop();
        const path = `brief-refs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const contentType = file.type || (ext?.toLowerCase() === 'zip' ? 'application/zip' : 'application/octet-stream');
        const { error } = await supabase.storage.from('creative-assets').upload(path, file, {
          cacheControl: '3600', upsert: false, contentType,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from('creative-assets').getPublicUrl(path);
        newRefs.push({ file_name: file.name, url: pub.publicUrl, file_type: contentType, size: file.size });
      }
      setUploadedRefs(prev => [...prev, ...newRefs]);
      toast.success(`${newRefs.length} file(s) uploaded`);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeUploadedRef = (idx: number) => {
    setUploadedRefs(prev => prev.filter((_, i) => i !== idx));
  };

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

  const set = (field: keyof BriefFormData, value: any) => setForm(f => ({ ...f, [field]: value }));

  const togglePlatform = (value: string) => {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(value) ? f.platforms.filter(v => v !== value) : [...f.platforms, value],
    }));
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

  const setDueIn = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    set('due_date', d.toISOString().slice(0, 10));
  };

  const expectedDeliverables = form.sizes.length * form.num_concepts;

  const createBrief = useMutation({
    mutationFn: async () => {
      const designer = teamMembers.find((m: any) => m.role === 'designer');
      const assignedTo = designer?.id || null;
      const urlRefs = form.reference_urls
        ? form.reference_urls.split('\n').filter(Boolean).map(url => ({ source: 'url', drive_url: url.trim(), note: '' }))
        : [];
      const fileRefs = uploadedRefs.map(r => ({
        source: 'upload', url: r.url, drive_url: r.url, file_name: r.file_name, file_type: r.file_type, size: r.size,
      }));
      const references = [...urlRefs, ...fileRefs];

      const isSpecialClient = form.client_id.startsWith('__');
      const specialLabel = SPECIAL_CLIENT_OPTIONS.find(o => o.id === form.client_id)?.name || INTERNAL_OPTIONS.find(o => o.id === form.client_id)?.name;
      const isInternal = form.client_id === '__internal__' || !form.client_id;
      const resolvedClientId = isInternal ? null : (isSpecialClient ? (clientId || null) : form.client_id);

      const { data: brief, error } = await supabase.from('creative_briefs').insert({
        client_id: resolvedClientId,
        title: form.title,
        creative_type: form.format || 'static',
        creative_types: form.format ? [form.format] : [],
        platforms: form.platforms,
        sizes: form.sizes,
        num_concepts: form.num_concepts,
        objective: form.description || null,
        reference_assets: references,
        due_date: form.due_date || null,
        priority: form.priority,
        assigned_to_id: assignedTo,
        created_by_id: teamMember?.id || null,
        notes: isSpecialClient ? `[${specialLabel}]` : null,
        status: 'draft',
      } as any).select().single();
      if (error) throw error;

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
      toast.success('Brief created');
      onOpenChange(false);
      setForm({ ...INITIAL_FORM });
      setUploadedRefs([]);
      setShowSpecs(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Creative Brief</DialogTitle>
        </DialogHeader>

        <form onSubmit={e => { e.preventDefault(); createBrief.mutate(); }} className="space-y-4">
          {/* Client + title */}
          <div className="grid gap-3 sm:grid-cols-2">
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
                  {[...SPECIAL_CLIENT_OPTIONS, ...INTERNAL_OPTIONS].map(opt => (
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
              <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder='e.g., "ACA Aggro Scripts"' required />
            </div>
          </div>

          {/* Format + platform */}
          <div className="space-y-2">
            <Label>Format *</Label>
            <div className="flex gap-2">
              {(['video', 'static'] as const).map(f => (
                <Badge
                  key={f}
                  variant={form.format === f ? 'default' : 'outline'}
                  className="cursor-pointer capitalize px-3 py-1"
                  onClick={() => set('format', form.format === f ? '' : f)}
                >
                  {f}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Platform(s)</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <Badge
                  key={p.value}
                  variant={form.platforms.includes(p.value) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => togglePlatform(p.value)}
                >
                  {p.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* The brief */}
          <div className="space-y-2">
            <Label>The Brief *</Label>
            <Textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={10}
              placeholder="Write everything Malena needs: concept, script, hooks, copy, do's and don'ts, references. One box — dump it all here."
            />
          </div>

          {/* Priority + due date */}
          <div className="grid gap-3 sm:grid-cols-2">
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
              <Label>Due Date</Label>
              <Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
              <div className="flex gap-1.5">
                {[{ l: 'ASAP', d: 0 }, { l: '+2 days', d: 2 }, { l: 'Next week', d: 7 }].map(o => (
                  <button key={o.l} type="button" onClick={() => setDueIn(o.d)}
                    className="text-[11px] rounded-full border px-2 py-0.5 text-muted-foreground hover:bg-accent">
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Links + files */}
          <div className="space-y-2">
            <Label>Links (one per line)</Label>
            <Textarea value={form.reference_urls} onChange={e => set('reference_urls', e.target.value)} rows={2} placeholder="Drive folders, competitor ads, Figma..." />
          </div>

          <div className="space-y-2">
            <label className="block rounded-lg border-2 border-dashed border-muted p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors">
              <FileUp className="h-6 w-6 text-muted-foreground mx-auto mb-1.5" />
              <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Upload reference files'}</p>
              <p className="text-xs text-muted-foreground">Images, video, PDFs, zips — 50 MB max per file</p>
              <input
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.psd,.ai,.fig,.sketch,.zip,.rar,.7z,.doc,.docx"
                className="hidden"
                disabled={uploading}
                onChange={(e) => { handleFileUpload(e.target.files); e.target.value = ''; }}
              />
            </label>
            {uploadedRefs.length > 0 && (
              <div className="space-y-1.5">
                {uploadedRefs.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded border bg-background px-2.5 py-1.5 text-xs">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline flex-1">
                      {r.file_name}
                    </a>
                    <span className="text-muted-foreground shrink-0">{(r.size / 1024).toFixed(0)} KB</span>
                    <button type="button" onClick={() => removeUploadedRef(i)} className="text-muted-foreground hover:text-destructive">
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Optional export specs */}
          <div className="rounded-lg border">
            <button type="button" onClick={() => setShowSpecs(s => !s)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium">
              <span>Export specs & concepts <span className="text-xs font-normal text-muted-foreground">(optional — needed for CTV/OTT)</span></span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showSpecs ? 'rotate-180' : ''}`} />
            </button>
            {showSpecs && (
              <div className="space-y-3 border-t px-3 py-3">
                {getRelevantSizeGroups(form.platforms).map(group => (
                  <div key={group.category} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.sizes.map(sp => (
                        <Badge
                          key={sp.label}
                          variant={form.sizes.find(s => s.label === sp.label) ? 'default' : 'outline'}
                          className="cursor-pointer text-[11px]"
                          onClick={() => toggleSize(sp)}
                        >
                          {sp.label.includes('×') ? sp.label : `${sp.label} (${sp.width}×${sp.height})`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input className="w-20 h-8 text-xs" placeholder="W" value={form.custom_width} onChange={e => set('custom_width', e.target.value)} />
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input className="w-20 h-8 text-xs" placeholder="H" value={form.custom_height} onChange={e => set('custom_height', e.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={addCustomSize}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
                {form.sizes.filter(s => !SIZE_PRESETS.find(p => p.label === s.label)).map(s => (
                  <Badge key={s.label} variant="default" className="cursor-pointer" onClick={() => toggleSize(s)}>
                    {s.label} ×
                  </Badge>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-xs"># of Concepts</Label>
                  <Button type="button" size="icon" variant="outline" className="h-7 w-7"
                    onClick={() => set('num_concepts', Math.max(1, form.num_concepts - 1))}
                  ><Minus className="h-3 w-3" /></Button>
                  <span className="text-sm font-medium w-6 text-center">{form.num_concepts}</span>
                  <Button type="button" size="icon" variant="outline" className="h-7 w-7"
                    onClick={() => set('num_concepts', form.num_concepts + 1)}
                  ><Plus className="h-3 w-3" /></Button>
                  {expectedDeliverables > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">{expectedDeliverables} deliverables</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={createBrief.isPending || !form.title || !form.client_id}>
            {createBrief.isPending ? 'Creating...' : 'Create Brief'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
