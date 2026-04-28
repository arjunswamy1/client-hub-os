import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useShootBrief, useShootScripts, useShootCast, useShootFootage, useUpdateBrief } from '@/hooks/useShootBriefs';
import { useTalentActors } from '@/hooks/useTalentActors';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Star, Upload, Loader2, Wand2, Search, Send, MessageSquare } from 'lucide-react';
import { STATUS_LABEL, STATUS_COLOR, type ShootStatus, type ShootScript, type ShootCast } from '@/types/production';
import { StatusTimeline, StatusHistory } from './StatusTimeline';
import { validShootTransitions } from '@/types/projectStage';
import { useShootBriefComments, useAddShootBriefComment } from '@/hooks/useShootBriefComments';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { format as formatDate } from 'date-fns';

interface Props {
  briefId: string | null;
  onClose: () => void;
}

export function ShootBriefDetail({ briefId, onClose }: Props) {
  const { data: brief } = useShootBrief(briefId || undefined);
  const updateBrief = useUpdateBrief();
  const { teamMember } = useAuth();
  const role = teamMember?.role;

  const allowed = brief ? validShootTransitions(role, brief.status) : [];

  const setStatus = async (s: ShootStatus) => {
    if (!brief) return;
    if (s === 'scheduled' && (!brief.location_confirmed || !brief.shoot_date)) {
      toast.error('Cannot schedule until location confirmed and shoot date set'); return;
    }
    if (s === 'footage_uploaded' && !confirm('Confirm: all footage uploaded for this shoot?')) return;
    await updateBrief.mutateAsync({ id: brief.id, updates: { status: s } });
    toast.success(`Status: ${STATUS_LABEL[s]}`);
  };

  return (
    <Sheet open={!!briefId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-3xl overflow-y-auto">
        {brief ? (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-4">
                <SheetTitle className="text-xl">{brief.title}</SheetTitle>
                <Badge variant="outline" className={STATUS_COLOR[brief.status]}>{STATUS_LABEL[brief.status]}</Badge>
              </div>
            </SheetHeader>

            <div className="mt-3"><StatusTimeline brief={brief} /></div>

            <div className="mt-2 flex flex-wrap gap-2 items-center">
              {allowed.length > 0 ? (
                <Select value="" onValueChange={(v: ShootStatus) => setStatus(v)}>
                  <SelectTrigger className="w-56 h-8 text-xs">
                    <SelectValue placeholder="Move to next stage…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowed.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground italic">No status changes available for your role.</span>
              )}
            </div>

            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="grid grid-cols-7 w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="scripts">Scripts</TabsTrigger>
                <TabsTrigger value="cast">Cast</TabsTrigger>
                <TabsTrigger value="footage">Footage</TabsTrigger>
                <TabsTrigger value="checklist">Day-of</TabsTrigger>
                <TabsTrigger value="comments"><MessageSquare className="h-3 w-3 mr-1" />Comments</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="overview"><Overview brief={brief} /></TabsContent>
              <TabsContent value="scripts"><Scripts briefId={brief.id} /></TabsContent>
              <TabsContent value="cast"><Cast brief={brief} /></TabsContent>
              <TabsContent value="footage"><Footage brief={brief} /></TabsContent>
              <TabsContent value="checklist"><Checklist /></TabsContent>
              <TabsContent value="comments"><Comments briefId={brief.id} /></TabsContent>
              <TabsContent value="history"><StatusHistory briefId={brief.id} /></TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Overview({ brief }: { brief: any }) {
  return (
    <div className="space-y-3 text-sm">
      <Card className="p-4 grid grid-cols-2 gap-3">
        <div><div className="text-xs text-muted-foreground">Priority</div><div>{brief.priority}</div></div>
        <div><div className="text-xs text-muted-foreground">Branding</div><div>{brief.branding}</div></div>
        <div><div className="text-xs text-muted-foreground">Shoot deadline</div><div>{brief.shoot_deadline || '—'}</div></div>
        <div><div className="text-xs text-muted-foreground">Content deadline</div><div>{brief.content_deadline || '—'}</div></div>
        <div><div className="text-xs text-muted-foreground">Date / time</div><div>{brief.shoot_date || '—'} {brief.shoot_start_time || ''}</div></div>
        <div><div className="text-xs text-muted-foreground">Estimated hours</div><div>{brief.estimated_shoot_hours || '—'}</div></div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground mb-2">Verticals</div>
        <div className="flex flex-wrap gap-1">{brief.verticals.map((v: string) => <Badge key={v} variant="outline">{v}</Badge>)}</div>
      </Card>
      {brief.broll_shot_list?.length > 0 && (
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-2">B-roll shot list</div>
          <ul className="space-y-1 text-sm list-disc pl-4">
            {brief.broll_shot_list.map((b: any, i: number) => <li key={i}>{b.description}{b.purpose ? ` — ${b.purpose}` : ''}</li>)}
          </ul>
        </Card>
      )}
      <Card className="p-4 bg-emerald-50">
        <div className="text-xs text-muted-foreground">Estimated total</div>
        <div className="text-xl font-semibold">${(brief.estimated_total || 0).toFixed(2)}</div>
      </Card>
    </div>
  );
}

function Scripts({ briefId }: { briefId: string }) {
  const { data: scripts = [] } = useShootScripts(briefId);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', full_script: '', hook_line: '', cta_line: '', tone_direction: '' });

  const add = async () => {
    if (!draft.title) { toast.error('Title required'); return; }
    const { error } = await supabase.from('shoot_scripts').insert({ ...draft, brief_id: briefId, position: scripts.length });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['shoot_scripts', briefId] });
    setAdding(false);
    setDraft({ title: '', full_script: '', hook_line: '', cta_line: '', tone_direction: '' });
  };

  const remove = async (id: string) => {
    if (!confirm('Delete script?')) return;
    await supabase.from('shoot_scripts').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['shoot_scripts', briefId] });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3 w-3 mr-1" />Script</Button></div>
      {scripts.length === 0 && !adding && <Card className="p-6 text-center text-sm text-muted-foreground">No scripts yet.</Card>}
      {scripts.map((s: ShootScript) => (
        <Card key={s.id} className="p-4 space-y-2">
          <div className="flex justify-between items-start">
            <div className="font-medium">{s.title}</div>
            <Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="h-3 w-3" /></Button>
          </div>
          {s.hook_line && <div className="text-sm bg-amber-50 p-2 rounded"><strong className="text-amber-800">HOOK:</strong> {s.hook_line}</div>}
          <div className="text-sm whitespace-pre-wrap">{s.full_script}</div>
          {s.cta_line && <div className="text-sm bg-blue-50 p-2 rounded"><strong>CTA:</strong> {s.cta_line}</div>}
          {s.tone_direction && <div className="text-xs text-muted-foreground italic">Tone: {s.tone_direction}</div>}
        </Card>
      ))}
      {adding && (
        <Card className="p-4 space-y-2 border-primary">
          <Input placeholder="Script title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Input placeholder="Hook line (the scroll-stopper)" value={draft.hook_line} onChange={(e) => setDraft({ ...draft, hook_line: e.target.value })} />
          <Textarea rows={6} placeholder="Full script..." value={draft.full_script} onChange={(e) => setDraft({ ...draft, full_script: e.target.value })} />
          <Input placeholder="CTA / closing line" value={draft.cta_line} onChange={(e) => setDraft({ ...draft, cta_line: e.target.value })} />
          <Input placeholder="Tone direction" value={draft.tone_direction} onChange={(e) => setDraft({ ...draft, tone_direction: e.target.value })} />
          <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button size="sm" onClick={add}>Add</Button></div>
        </Card>
      )}
    </div>
  );
}

function Cast({ brief }: { brief: any }) {
  const { data: cast = [] } = useShootCast(brief.id);
  const { data: actors = [] } = useTalentActors();
  const qc = useQueryClient();
  const [showFinder, setShowFinder] = useState(false);
  const [search, setSearch] = useState('');

  const matches = actors.filter((a) => {
    if (a.status === 'inactive') return false;
    if (brief.gender_preference && a.gender !== brief.gender_preference) return false;
    if (brief.age_range && a.age_range_appearance !== brief.age_range) return false;
    if (brief.specialties_needed?.length > 0 && !brief.specialties_needed.some((s: string) => a.specialties.includes(s))) return false;
    if (search && !a.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => (b.producer_rating || 0) - (a.producer_rating || 0) || b.total_shoots - a.total_shoots);

  const addActor = async (actorId: string, isFirst: boolean) => {
    const { error } = await supabase.from('shoot_cast').insert({ brief_id: brief.id, actor_id: actorId, is_first_shoot: isFirst });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['shoot_cast', brief.id] });
    toast.success('Actor added to cast');
  };

  const updateCast = async (id: string, updates: Partial<ShootCast>) => {
    await supabase.from('shoot_cast').update(updates as any).eq('id', id);
    qc.invalidateQueries({ queryKey: ['shoot_cast', brief.id] });
  };

  const remove = async (id: string) => {
    await supabase.from('shoot_cast').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['shoot_cast', brief.id] });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowFinder(!showFinder)}><Search className="h-3 w-3 mr-1" />Find Actors</Button>
      </div>

      {showFinder && (
        <Card className="p-3 space-y-2">
          <Input placeholder="Search talent database..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="text-xs text-muted-foreground">{matches.length} matches based on brief criteria</div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {matches.map((a) => {
              const isFirst = a.total_shoots === 0;
              const alreadyCast = cast.some((c) => c.actor_id === a.id);
              return (
                <div key={a.id} className="flex items-center gap-3 p-2 border rounded hover:bg-slate-50">
                  {a.headshot_url ? <img src={a.headshot_url} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-slate-200" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.full_name} {isFirst && <Badge variant="secondary" className="text-[9px] ml-1">Trial — 1hr limit</Badge>}</div>
                    <div className="text-xs text-muted-foreground">{a.city} · {a.total_shoots} shoots {a.producer_rating ? `· ${a.producer_rating}★` : ''}</div>
                  </div>
                  <Button size="sm" disabled={alreadyCast} onClick={() => addActor(a.id, isFirst)}>{alreadyCast ? 'Cast' : 'Add'}</Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {cast.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No actors cast yet.</Card>
      ) : (
        cast.map((c) => (
          <Card key={c.id} className="p-3 space-y-2">
            <div className="flex items-center gap-3">
              {c.actor?.headshot_url ? <img src={c.actor.headshot_url} alt="" className="w-12 h-12 rounded object-cover" /> : <div className="w-12 h-12 rounded bg-slate-200" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium">{c.actor?.full_name} {c.is_first_shoot && <Badge variant="secondary" className="text-[9px]">Trial</Badge>}</div>
                <div className="text-xs text-muted-foreground">{c.role_description || 'No role description'}</div>
              </div>
              <Select value={c.status} onValueChange={(v) => updateCast(c.id, { status: v as any, confirmed_at: v === 'confirmed' ? new Date().toISOString() : null })}>
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{['invited', 'interested', 'confirmed', 'declined', 'no_show'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Role" value={c.role_description || ''} onChange={(e) => updateCast(c.id, { role_description: e.target.value })} />
              <Input type="number" placeholder="Rate $/hr" value={c.hourly_rate || ''} onChange={(e) => updateCast(c.id, { hourly_rate: parseFloat(e.target.value) || null })} />
              <Input type="number" placeholder="Hours" value={c.estimated_hours || ''} onChange={(e) => updateCast(c.id, { estimated_hours: parseFloat(e.target.value) || null })} />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number; // 0-100
  status: 'queued' | 'uploading' | 'done' | 'error' | 'duplicate';
  error?: string;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Footage({ brief }: { brief: any }) {
  const { data: footage = [] } = useShootFootage(brief.id);
  const { data: scripts = [] } = useShootScripts(brief.id);
  const updateBrief = useUpdateBrief();
  const qc = useQueryClient();
  const { teamMember } = useAuth();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const isUploading = uploads.some((u) => u.status === 'uploading' || u.status === 'queued');

  // Detect duplicates among already-uploaded footage by (file_name, file_size_bytes)
  const dupKey = (name: string, size: number) => `${name}::${size}`;
  const existingKeys = new Set(footage.map((f: any) => dupKey(f.file_name || '', f.file_size_bytes || 0)));

  const handleUpload = async (files: FileList) => {
    const seenInBatch = new Set<string>();
    const initial: UploadItem[] = Array.from(files).map((file) => {
      const key = dupKey(file.name, file.size);
      let status: UploadItem['status'] = 'queued';
      let error: string | undefined;
      if (existingKeys.has(key)) { status = 'duplicate'; error = 'Already uploaded to this brief'; }
      else if (seenInBatch.has(key)) { status = 'duplicate'; error = 'Duplicate within this batch'; }
      seenInBatch.add(key);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
        name: file.name, size: file.size, progress: 0, status, error,
      };
    });
    setUploads((prev) => [...prev, ...initial]);

    for (let i = 0; i < initial.length; i++) {
      const item = initial[i];
      const file = files[i];
      if (item.status === 'duplicate') continue;

      setUploads((prev) => prev.map((u) => u.id === item.id ? { ...u, status: 'uploading', progress: 5 } : u));

      // Determine next take number for this script slot (scripted_take, no script assigned yet → 1)
      const path = `${brief.id}/${Date.now()}-${file.name}`;
      try {
        // Smooth progress polling (Supabase JS upload doesn't expose XHR progress yet)
        const tick = setInterval(() => {
          setUploads((prev) => prev.map((u) =>
            u.id === item.id && u.status === 'uploading' && u.progress < 90
              ? { ...u, progress: Math.min(90, u.progress + Math.random() * 10) }
              : u
          ));
        }, 250);

        const { error: upErr } = await supabase.storage.from('shoot-footage').upload(path, file);
        clearInterval(tick);
        if (upErr) throw upErr;

        const { data } = supabase.storage.from('shoot-footage').getPublicUrl(path);
        const nextTake = (footage.filter((f: any) => f.clip_type === 'scripted_take' && !f.script_id).length) +
          (initial.slice(0, i).filter((u) => u.status === 'done' || u.status === 'uploading').length) + 1;

        const { error } = await supabase.from('shoot_footage').insert({
          brief_id: brief.id, file_url: data.publicUrl, file_name: file.name,
          file_type: file.type, file_size_bytes: file.size, clip_type: 'scripted_take',
          take_number: nextTake, uploaded_by_id: teamMember?.id || null,
        });
        if (error) throw error;

        setUploads((prev) => prev.map((u) => u.id === item.id ? { ...u, status: 'done', progress: 100 } : u));
      } catch (e: any) {
        setUploads((prev) => prev.map((u) => u.id === item.id ? { ...u, status: 'error', error: e.message } : u));
      }
    }

    qc.invalidateQueries({ queryKey: ['shoot_footage', brief.id] });
    const okCount = initial.filter((_, idx) => initial[idx].status !== 'duplicate').length;
    if (okCount > 0) toast.success(`Processed ${okCount} file(s)`);
  };

  const dismissUpload = (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id));
  const clearFinished = () => setUploads((prev) => prev.filter((u) => u.status === 'queued' || u.status === 'uploading'));

  const updateClip = async (id: string, updates: any) => {
    await supabase.from('shoot_footage').update(updates).eq('id', id);
    qc.invalidateQueries({ queryKey: ['shoot_footage', brief.id] });
  };

  const removeClip = async (id: string) => {
    await supabase.from('shoot_footage').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['shoot_footage', brief.id] });
  };

  const markUploadComplete = async () => {
    await updateBrief.mutateAsync({ id: brief.id, updates: { status: 'footage_uploaded' } });
    toast.success('Marked footage as uploaded');
  };

  const createPostProdBrief = async () => {
    if (brief.linked_creative_brief_id) { toast.error('Already linked to a creative brief'); return; }
    try {
      const scriptsText = scripts.map((s: any) => `**${s.title}**\nHook: ${s.hook_line || ''}\n${s.full_script}\nCTA: ${s.cta_line || ''}`).join('\n\n---\n\n');
      const brollText = (brief.broll_shot_list || []).map((b: any) => `• ${b.description}${b.purpose ? ` — ${b.purpose}` : ''}`).join('\n');
      const footageLinks = footage.filter((f: any) => f.is_best_take).map((f: any) => `${f.file_name}: ${f.file_url}`).join('\n');
      const allFootageLinks = footage.map((f: any) => `${f.file_name}: ${f.file_url}`).join('\n');

      const notes = `**FROM SHOOT BRIEF: ${brief.title}**

**Scripts:**
${scriptsText}

**B-Roll direction:**
${brollText || '(none specified)'}

**Best takes:**
${footageLinks || '(producer to mark best takes in shoot brief)'}

**All raw footage:**
${allFootageLinks}

**Platforms:** ${(brief.platforms || []).join(', ')}
**Orientations:** ${(brief.orientations || []).join(', ')}`;

      const { data: designer } = await supabase
        .from('team_members')
        .select('id')
        .eq('role', 'designer')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: cb, error } = await supabase.from('creative_briefs').insert({
        title: `[Edit] ${brief.title}`,
        creative_type: 'video',
        client_id: brief.client_ids?.[0] || null,
        platforms: brief.platforms || [],
        notes,
        priority: brief.priority,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        due_date: brief.content_deadline,
        assigned_to_id: designer?.id || null,
        created_by_id: teamMember?.id || null,
      }).select('id').single();
      if (error) throw error;
      await updateBrief.mutateAsync({ id: brief.id, updates: { linked_creative_brief_id: cb.id, status: 'in_post_production' } });
      toast.success('Post-production brief created for editor');
    } catch (e: any) { toast.error(e.message); }
  };

  // Group clips by script (or "Unassigned / B-roll") and compute per-script take counts
  const grouped: Record<string, any[]> = { __unassigned: [] };
  scripts.forEach((s: any) => { grouped[s.id] = []; });
  footage.forEach((f: any) => {
    const k = f.script_id || '__unassigned';
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(f);
  });
  Object.values(grouped).forEach((arr) => arr.sort((a: any, b: any) => (a.take_number || 0) - (b.take_number || 0)));

  return (
    <div className="space-y-3">
      <Card className="p-4 border-dashed border-2">
        <label className="block text-center cursor-pointer">
          {isUploading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : <Upload className="h-6 w-6 mx-auto text-muted-foreground" />}
          <div className="text-sm mt-2">{isUploading ? 'Uploading…' : 'Click to upload video clips (multiple)'}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Duplicates (same name + size) are skipped automatically.</div>
          <input type="file" multiple accept="video/*" className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && handleUpload(e.target.files)} />
        </label>
      </Card>

      {uploads.length > 0 && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Upload progress ({uploads.filter((u) => u.status === 'done').length}/{uploads.length} complete)</div>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={clearFinished} disabled={isUploading}>Clear finished</Button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {uploads.map((u) => (
              <div key={u.id} className="text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {u.status === 'done' && <span className="text-emerald-600">✓</span>}
                    {u.status === 'error' && <span className="text-rose-600">✕</span>}
                    {u.status === 'duplicate' && <span className="text-amber-600">⚠</span>}
                    {u.status === 'uploading' && <Loader2 className="h-3 w-3 animate-spin text-blue-600 flex-shrink-0" />}
                    {u.status === 'queued' && <span className="text-slate-400">…</span>}
                    <span className="truncate">{u.name}</span>
                    <span className="text-muted-foreground flex-shrink-0">({formatBytes(u.size)})</span>
                  </div>
                  <button onClick={() => dismissUpload(u.id)} className="text-muted-foreground hover:text-foreground">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {u.status === 'uploading' && (
                  <div className="h-1 bg-slate-100 rounded overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${u.progress}%` }} />
                  </div>
                )}
                {u.error && (
                  <div className={`pl-4 ${u.status === 'duplicate' ? 'text-amber-700' : 'text-rose-600'}`}>{u.error}</div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {footage.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={markUploadComplete}>Mark upload complete</Button>
          <Button size="sm" onClick={createPostProdBrief} disabled={!!brief.linked_creative_brief_id}>
            <Wand2 className="h-3 w-3 mr-1" />{brief.linked_creative_brief_id ? 'Brief sent to editor' : 'Create Post-Production Brief'}
          </Button>
        </div>
      )}

      {footage.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No footage uploaded yet.</Card>
      ) : (
        Object.entries(grouped)
          .filter(([, clips]) => clips.length > 0)
          .map(([key, clips]) => {
            const script = scripts.find((s: any) => s.id === key);
            const groupLabel = script ? script.title : 'Unassigned / B-roll';
            const bestCount = clips.filter((c: any) => c.is_best_take).length;
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                  <span>{groupLabel}</span>
                  <Badge variant="outline" className="text-[10px]">{clips.length} take{clips.length === 1 ? '' : 's'}</Badge>
                  {bestCount > 0 && <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">★ {bestCount} best</Badge>}
                </div>
                {clips.map((f: any) => (
                  <Card key={f.id} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {f.take_number != null && (
                          <Badge variant="secondary" className="text-[10px] flex-shrink-0">Take {f.take_number}</Badge>
                        )}
                        <a href={f.file_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary truncate">{f.file_name}</a>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatBytes(f.file_size_bytes || 0)}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="flex items-center gap-1 text-xs cursor-pointer">
                          <Checkbox checked={f.is_best_take} onCheckedChange={(v) => updateClip(f.id, { is_best_take: !!v })} />
                          <Star className={`h-3 w-3 ${f.is_best_take ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />Best
                        </label>
                        <Button size="sm" variant="ghost" onClick={() => removeClip(f.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Select value={f.script_id || 'none'} onValueChange={(v) => updateClip(f.id, { script_id: v === 'none' ? null : v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Script" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No script (B-roll)</SelectItem>
                          {scripts.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={f.clip_type || 'scripted_take'} onValueChange={(v) => updateClip(f.id, { clip_type: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scripted_take">Scripted take</SelectItem>
                          <SelectItem value="broll">B-roll</SelectItem>
                          <SelectItem value="blooper">Blooper</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input className="h-8 text-xs" type="number" placeholder="Take #" value={f.take_number || ''} onChange={(e) => updateClip(f.id, { take_number: parseInt(e.target.value) || null })} />
                    </div>
                    <Input className="h-8 text-xs" placeholder="Notes..." value={f.producer_notes || ''} onChange={(e) => updateClip(f.id, { producer_notes: e.target.value })} />
                  </Card>
                ))}
              </div>
            );
          })
      )}
    </div>
  );
}

function Checklist() {
  const items = [
    'Equipment charged and packed',
    'Scripts printed / on tablet',
    'Location accessible and prepped',
    'Actor(s) arrived and briefed',
    'Audio check completed',
    'B-roll shot list reviewed',
    'All scripted takes captured (min 3 per script)',
    'B-roll captured',
    'Quick footage review on device',
    'Actor payment processed / noted',
  ];
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  return (
    <Card className="p-4 space-y-2">
      <div className="text-xs text-muted-foreground mb-2">Shoot day checklist (local — not saved)</div>
      {items.map((it, i) => (
        <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={!!checked[i]} onCheckedChange={(v) => setChecked({ ...checked, [i]: !!v })} />
          <span className={checked[i] ? 'line-through text-muted-foreground' : ''}>{it}</span>
        </label>
      ))}
    </Card>
  );
}

function Comments({ briefId }: { briefId: string }) {
  const { data: comments = [], isLoading } = useShootBriefComments(briefId);
  const addComment = useAddShootBriefComment();
  const [text, setText] = useState('');

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    addComment.mutate({ briefId, content }, { onSuccess: () => setText('') });
  };

  return (
    <div className="flex flex-col h-[60vh]">
      <div className="flex-1 space-y-3 overflow-y-auto mb-3 pr-1">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading comments…</div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No comments yet. Start the conversation.</div>
        ) : (
          comments.map((c: any) => (
            <div key={c.id} className="flex gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                  {c.author?.name?.[0] || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{c.author?.name || 'Unknown'}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(new Date(c.created_at), 'MMM d, h:mm a')}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{c.content}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 border-t pt-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          className="text-sm"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <Button size="icon" onClick={submit} disabled={!text.trim() || addComment.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
