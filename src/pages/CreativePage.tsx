import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Plus, Palette, Clock, CheckCircle2, AlertCircle, Image, Video, LayoutGrid } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: null },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700', icon: null },
  in_design: { label: 'In Design', color: 'bg-yellow-100 text-yellow-700', icon: Palette },
  ready_for_review: { label: 'Ready for Review', color: 'bg-purple-100 text-purple-700', icon: AlertCircle },
  revision_requested: { label: 'Revision Requested', color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  delivered: { label: 'Delivered', color: 'bg-green-200 text-green-800', icon: CheckCircle2 },
};

const TYPE_ICONS: Record<string, any> = {
  static: Image,
  video: Video,
  carousel: LayoutGrid,
  story_reel: Video,
  ugc: Video,
  other: Image,
};

export default function CreativePage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: briefs = [] } = useQuery({
    queryKey: ['briefs', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('creative_briefs')
        .select('*, assigned_to:team_members!creative_briefs_assigned_to_id_fkey(name, email), created_by:team_members!creative_briefs_created_by_id_fkey(name)')
        .eq('client_id', activeClient.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeClient,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('is_active', true);
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const { data, error } = await supabase
        .from('creative_reviews')
        .select('*, reviewer:team_members!creative_reviews_reviewer_id_fkey(name)')
        .eq('brief_id', selectedId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedId,
  });

  const updateBriefStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('creative_briefs').update({ status } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefs'] });
      toast.success('Status updated');
    },
  });

  const addReview = useMutation({
    mutationFn: async ({ briefId, action, comments }: { briefId: string; action: string; comments: string }) => {
      const { error: reviewError } = await supabase.from('creative_reviews').insert({
        brief_id: briefId,
        reviewer_id: teamMember!.id,
        action,
        comments,
      });
      if (reviewError) throw reviewError;

      const newStatus = action === 'approved' ? 'approved' : 'revision_requested';
      const { error } = await supabase.from('creative_briefs').update({ status: newStatus } as any).eq('id', briefId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefs'] });
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast.success('Review submitted');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const selected = briefs.find((b: any) => b.id === selectedId);

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creative Briefing</h1>
          <p className="text-sm text-muted-foreground">{briefs.length} briefs for {activeClient.name}</p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New Brief
        </Button>
      </div>

      {/* Brief cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {briefs.map((brief: any) => {
          const TypeIcon = TYPE_ICONS[brief.creative_type] || Image;
          const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
          return (
            <Card
              key={brief.id}
              className={`cursor-pointer transition-all hover:shadow-md ${selectedId === brief.id ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => setSelectedId(brief.id)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-accent p-1.5">
                      <TypeIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{brief.title}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{brief.creative_type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] shrink-0 ${statusConf.color}`}>
                    {statusConf.label}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    {brief.assigned_to ? (
                      <>
                        <Avatar className="h-4 w-4">
                          <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                            {brief.assigned_to.name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span>{brief.assigned_to.name}</span>
                      </>
                    ) : 'Unassigned'}
                  </div>
                  {brief.due_date && (
                    <span>{format(new Date(brief.due_date), 'MMM d')}</span>
                  )}
                </div>

                {brief.platforms?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {brief.platforms.map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[9px] px-1.5 py-0">{p}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <BriefDetailPanel
          brief={selected}
          reviews={reviews}
          teamMember={teamMember}
          onClose={() => setSelectedId(null)}
          onStatusChange={(status) => updateBriefStatus.mutate({ id: selected.id, status })}
          onReview={(action, comments) => addReview.mutate({ briefId: selected.id, action, comments })}
        />
      )}

      <CreateBriefDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={activeClient.id}
        teamMembers={teamMembers}
        currentMemberId={teamMember?.id}
      />
    </div>
  );
}

function BriefDetailPanel({ brief, reviews, teamMember, onClose, onStatusChange, onReview }: any) {
  const [reviewComments, setReviewComments] = useState('');
  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-card shadow-xl animate-slide-in-right overflow-y-auto">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <Badge variant="secondary" className={`text-xs ${statusConf.color}`}>{statusConf.label}</Badge>
        <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
      </div>

      <div className="p-5 space-y-5 flex-1 overflow-y-auto scrollbar-thin">
        <h2 className="text-lg font-semibold">{brief.title}</h2>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-xs text-muted-foreground block">Type</span><span className="capitalize">{brief.creative_type.replace('_', ' ')}</span></div>
          <div><span className="text-xs text-muted-foreground block">Objective</span><span className="capitalize">{brief.objective || '—'}</span></div>
          <div><span className="text-xs text-muted-foreground block">Assigned To</span>{brief.assigned_to?.name || 'Unassigned'}</div>
          <div><span className="text-xs text-muted-foreground block">Due Date</span>{brief.due_date ? format(new Date(brief.due_date), 'MMM d, yyyy') : '—'}</div>
          <div><span className="text-xs text-muted-foreground block">Priority</span><span className="capitalize">{brief.priority}</span></div>
          <div><span className="text-xs text-muted-foreground block">Created By</span>{brief.created_by?.name || '—'}</div>
        </div>

        {brief.target_audience && (
          <div><span className="text-xs text-muted-foreground block mb-1">Target Audience</span><p className="text-sm">{brief.target_audience}</p></div>
        )}

        {brief.key_message && (
          <div><span className="text-xs text-muted-foreground block mb-1">Key Message</span><p className="text-sm">{brief.key_message}</p></div>
        )}

        {brief.notes && (
          <div><span className="text-xs text-muted-foreground block mb-1">Notes</span><p className="text-sm whitespace-pre-wrap">{brief.notes}</p></div>
        )}

        {/* Status actions */}
        <div className="flex gap-2 flex-wrap">
          {brief.status === 'draft' && (
            <Button size="sm" onClick={() => onStatusChange('submitted')}>Submit Brief</Button>
          )}
          {brief.status === 'submitted' && (
            <Button size="sm" onClick={() => onStatusChange('in_design')}>Start Design</Button>
          )}
          {brief.status === 'in_design' && (
            <Button size="sm" onClick={() => onStatusChange('ready_for_review')}>Submit for Review</Button>
          )}
          {brief.status === 'approved' && (
            <Button size="sm" onClick={() => onStatusChange('delivered')}>Mark Delivered</Button>
          )}
        </div>

        {/* Review section */}
        {brief.status === 'ready_for_review' && teamMember && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <h4 className="text-sm font-medium">Review</h4>
              <Textarea
                value={reviewComments}
                onChange={e => setReviewComments(e.target.value)}
                placeholder="Comments..."
                rows={2}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => { onReview('revision_requested', reviewComments); setReviewComments(''); }}>
                  Request Revision
                </Button>
                <Button size="sm" onClick={() => { onReview('approved', reviewComments); setReviewComments(''); }}>
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Review history */}
        {reviews.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Review History</h4>
            <div className="space-y-2">
              {reviews.map((r: any) => (
                <div key={r.id} className="flex items-start gap-2 text-xs">
                  <Badge variant={r.action === 'approved' ? 'default' : 'destructive'} className="text-[10px]">
                    {r.action === 'approved' ? '✓ Approved' : '↻ Revision'}
                  </Badge>
                  <span className="text-muted-foreground">{r.reviewer?.name}</span>
                  <span className="text-muted-foreground">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>
                  {r.comments && <p className="text-foreground/80 mt-0.5">{r.comments}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateBriefDialog({ open, onOpenChange, clientId, teamMembers, currentMemberId }: any) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '', creative_type: 'static', platforms: '',
    objective: '', target_audience: '', key_message: '',
    due_date: '', priority: 'medium', assigned_to_id: '', notes: '',
  });

  const create = useMutation({
    mutationFn: async () => {
      const designer = teamMembers.find((m: any) => m.role === 'designer');
      const { error } = await supabase.from('creative_briefs').insert({
        client_id: clientId,
        title: form.title,
        creative_type: form.creative_type,
        platforms: form.platforms ? form.platforms.split(',').map((s: string) => s.trim()) : [],
        objective: form.objective || null,
        target_audience: form.target_audience || null,
        key_message: form.key_message || null,
        due_date: form.due_date || null,
        priority: form.priority,
        assigned_to_id: form.assigned_to_id || designer?.id || null,
        created_by_id: currentMemberId || null,
        notes: form.notes || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefs'] });
      toast.success('Brief created');
      onOpenChange(false);
      setForm({ title: '', creative_type: 'static', platforms: '', objective: '', target_audience: '', key_message: '', due_date: '', priority: 'medium', assigned_to_id: '', notes: '' });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Creative Brief</DialogTitle></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={e => set('title', e.target.value)} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Creative Type</Label>
              <Select value={form.creative_type} onValueChange={v => set('creative_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">Static Image</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="carousel">Carousel</SelectItem>
                  <SelectItem value="story_reel">Story/Reel</SelectItem>
                  <SelectItem value="ugc">UGC</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Objective</Label>
              <Select value={form.objective} onValueChange={v => set('objective', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="awareness">Awareness</SelectItem>
                  <SelectItem value="consideration">Consideration</SelectItem>
                  <SelectItem value="conversion">Conversion</SelectItem>
                  <SelectItem value="retargeting">Retargeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label>Platforms (comma-separated)</Label><Input value={form.platforms} onChange={e => set('platforms', e.target.value)} placeholder="Meta, Google, TikTok" /></div>
          <div className="space-y-2"><Label>Target Audience</Label><Textarea value={form.target_audience} onChange={e => set('target_audience', e.target.value)} rows={2} /></div>
          <div className="space-y-2"><Label>Key Message / CTA</Label><Input value={form.key_message} onChange={e => set('key_message', e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2"><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => set('priority', v)}>
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
              <Label>Assign To</Label>
              <Select value={form.assigned_to_id} onValueChange={v => set('assigned_to_id', v)}>
                <SelectTrigger><SelectValue placeholder="Designer" /></SelectTrigger>
                <SelectContent>
                  {teamMembers.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
          <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? 'Creating...' : 'Create Brief'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
