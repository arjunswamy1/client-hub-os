import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Paperclip, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { BRIEF_STATUSES, STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';

interface Props {
  brief: any;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function EditBriefDialog({ brief, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: brief.title || '',
    status: brief.status || 'draft',
    priority: brief.priority || 'medium',
    due_date: brief.due_date ? brief.due_date.slice(0, 10) : '',
    scheduled_date: brief.scheduled_date ? brief.scheduled_date.slice(0, 10) : '',
    estimated_hours: brief.estimated_hours ?? '',
    assigned_to_id: brief.assigned_to_id || '',
    client_id: brief.client_id || '',
    notes: brief.notes || '',
    raw_footage_url: brief.raw_footage_url || '',
    final_assets_url: brief.final_assets_url || '',
  });

  // Reset form when brief changes
  useEffect(() => {
    setForm({
      title: brief.title || '',
      status: brief.status || 'draft',
      priority: brief.priority || 'medium',
      due_date: brief.due_date ? brief.due_date.slice(0, 10) : '',
      scheduled_date: brief.scheduled_date ? brief.scheduled_date.slice(0, 10) : '',
      estimated_hours: brief.estimated_hours ?? '',
      assigned_to_id: brief.assigned_to_id || '',
      client_id: brief.client_id || '',
      notes: brief.notes || '',
      raw_footage_url: brief.raw_footage_url || '',
      final_assets_url: brief.final_assets_url || '',
    });
  }, [brief]);

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team_members_active'],
    queryFn: async () => {
      const { data } = await supabase.from('team_members').select('id, name, role').eq('is_active', true).order('name');
      return data || [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_active_for_brief_edit'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name').eq('status', 'active').order('name');
      return data || [];
    },
  });

  // Reference attachments
  const initialRefs = Array.isArray(brief.reference_assets) ? brief.reference_assets : [];
  const [refs, setRefs] = useState<any[]>(initialRefs);
  const [uploadingRefs, setUploadingRefs] = useState(false);

  useEffect(() => {
    setRefs(Array.isArray(brief.reference_assets) ? brief.reference_assets : []);
  }, [brief.id, brief.reference_assets]);

  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingRefs(true);
    try {
      const clientName = brief.client?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
      const briefSlug = brief.title?.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) || brief.id.slice(0, 8);
      const added: any[] = [];
      for (const file of Array.from(files)) {
        const filePath = `${clientName}/${briefSlug}/refs/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('creative-assets').upload(filePath, file);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('creative-assets').getPublicUrl(filePath);
        added.push({
          source: 'upload', url: urlData.publicUrl, drive_url: urlData.publicUrl,
          file_name: file.name, file_type: file.type, size: file.size, storage_path: filePath,
        });
      }
      setRefs(prev => [...prev, ...added]);
      toast.success(`${added.length} file(s) attached`);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploadingRefs(false);
      e.target.value = '';
    }
  };

  const removeRef = async (idx: number) => {
    const next = [...refs];
    const removed = next.splice(idx, 1)[0];
    if (removed?.storage_path) {
      await supabase.storage.from('creative-assets').remove([removed.storage_path]).catch(() => {});
    }
    setRefs(next);
  };

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('creative_briefs').update({
        title: form.title,
        status: form.status,
        priority: form.priority,
        due_date: form.due_date || null,
        scheduled_date: form.scheduled_date || null,
        estimated_hours: form.estimated_hours === '' ? null : Number(form.estimated_hours),
        assigned_to_id: form.assigned_to_id || null,
        client_id: form.client_id || null,
        notes: form.notes || null,
        raw_footage_url: form.raw_footage_url.trim() || null,
        final_assets_url: form.final_assets_url.trim() || null,
        reference_assets: refs as any,
      } as any).eq('id', brief.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success('Brief updated');
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Edit Brief</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Client</Label>
            <Select
              value={form.client_id || 'none'}
              onValueChange={(v) => setForm(f => ({ ...f, client_id: v === 'none' ? '' : v }))}
            >
              <SelectTrigger><SelectValue placeholder="Internal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">🏢 Internal / Marketing</SelectItem>
                {clients.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BRIEF_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]: any) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <Label>Scheduled Date</Label>
              <Input type="date" value={form.scheduled_date} onChange={(e) => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Estimated Hours</Label>
              <Input
                type="number" step="0.5" min="0"
                value={form.estimated_hours}
                onChange={(e) => setForm(f => ({ ...f, estimated_hours: e.target.value as any }))}
              />
            </div>
            <div>
              <Label>Assigned To</Label>
              <Select value={form.assigned_to_id || 'none'} onValueChange={(v) => setForm(f => ({ ...f, assigned_to_id: v === 'none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name} ({m.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Raw footage link</Label>
              <Input value={form.raw_footage_url} onChange={(e) => setForm(f => ({ ...f, raw_footage_url: e.target.value }))} placeholder="Drive folder with raw footage..." />
            </div>
            <div>
              <Label>Final assets link</Label>
              <Input value={form.final_assets_url} onChange={(e) => setForm(f => ({ ...f, final_assets_url: e.target.value }))} placeholder="Where finished assets go..." />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Reference Files</Label>
              <label className="inline-flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline">
                <Paperclip className="h-3 w-3" />
                {uploadingRefs ? 'Uploading…' : 'Attach files'}
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.psd,.ai,.fig,.sketch,.zip,.doc,.docx"
                  className="hidden"
                  disabled={uploadingRefs}
                  onChange={handleRefUpload}
                />
              </label>
            </div>
            {refs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files attached. Click "Attach files" to add videos, images, or docs.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {refs.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded border bg-background px-2.5 py-1.5 text-xs">
                    <a href={r.drive_url || r.url} target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline truncate flex-1">
                      {r.file_name || r.drive_url || r.url}
                    </a>
                    {r.size && <span className="text-muted-foreground shrink-0">{(r.size / 1024).toFixed(0)} KB</span>}
                    <button type="button" onClick={() => removeRef(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
