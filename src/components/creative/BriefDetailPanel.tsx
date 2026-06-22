
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, CheckCircle2, Send, Image as ImageIcon, Sparkles, Upload, Clock, Download, Pencil, Paperclip, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { useCreativeDeliverables, useCreativeReviews, useBriefComments, useBriefMutations, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EditBriefDialog } from '@/components/creative/EditBriefDialog';

interface Props {
  brief: any;
  onClose: () => void;
}

export function BriefDetailPanel({ brief, onClose }: Props) {
  const { teamMember, isDesigner } = useAuth();
  const queryClient = useQueryClient();
  const { data: deliverables = [] } = useCreativeDeliverables(brief.id);
  const { data: reviews = [] } = useCreativeReviews(brief.id);
  const { data: comments = [] } = useBriefComments(brief.id);
  const { data: timeEntries = [] } = useTimeEntries(brief.id);
  const { updateStatus, addComment, addReview } = useBriefMutations();

  const [reviewComments, setReviewComments] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingRefs, setIsUploadingRefs] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

  const approvedCount = deliverables.filter((d: any) => d.status === 'approved').length;
  const uploadedCount = deliverables.filter((d: any) => d.status !== 'pending').length;
  const totalCount = deliverables.length;

  // Actual hours logged
  const actualMinutes = timeEntries.reduce((sum: number, e: any) => sum + (e.duration_minutes || 0), 0);
  const actualHours = +(actualMinutes / 60).toFixed(1);
  const estimatedHours = brief.estimated_hours || null;
  

  const handleComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate({ briefId: brief.id, content: commentText });
    setCommentText('');
  };

  // Upload assets to storage bucket organized by client
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !teamMember) return;

    setIsUploading(true);
    try {
      const clientName = brief.client?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
      const briefSlug = brief.title?.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) || brief.id.slice(0, 8);
      const basePath = `${clientName}/${briefSlug}`;

      for (const file of Array.from(files)) {
        const filePath = `${basePath}/${Date.now()}_${file.name}`;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('creative-assets')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('creative-assets')
          .getPublicUrl(filePath);

        // Create deliverable record
        const { error: dbError } = await supabase.from('creative_deliverables').insert({
          brief_id: brief.id,
          file_name: file.name,
          file_url: urlData.publicUrl,
          file_type: file.type,
          file_size_bytes: file.size,
          uploaded_by_id: teamMember.id,
          status: 'uploaded',
          concept_label: 'Upload',
          size_label: file.name,
          version: 1,
        });
        if (dbError) throw dbError;
      }

      queryClient.invalidateQueries({ queryKey: ['creative_deliverables'] });
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };


  // Upload reference assets (videos, images, PDFs) attached to the brief itself
  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setIsUploadingRefs(true);
    try {
      const clientName = brief.client?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
      const briefSlug = brief.title?.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) || brief.id.slice(0, 8);
      const newRefs: any[] = [];
      for (const file of Array.from(files)) {
        const filePath = `${clientName}/${briefSlug}/refs/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('creative-assets').upload(filePath, file);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('creative-assets').getPublicUrl(filePath);
        newRefs.push({
          source: 'upload', url: urlData.publicUrl, drive_url: urlData.publicUrl,
          file_name: file.name, file_type: file.type, size: file.size, storage_path: filePath,
        });
      }
      const existing = Array.isArray(brief.reference_assets) ? brief.reference_assets : [];
      const { error: updErr } = await supabase
        .from('creative_briefs')
        .update({ reference_assets: [...existing, ...newRefs] as any })
        .eq('id', brief.id);
      if (updErr) throw updErr;
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success(`${newRefs.length} reference${newRefs.length > 1 ? 's' : ''} attached`);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setIsUploadingRefs(false);
      e.target.value = '';
    }
  };

  const handleRemoveReference = async (idx: number) => {
    const existing = Array.isArray(brief.reference_assets) ? [...brief.reference_assets] : [];
    const removed = existing.splice(idx, 1)[0];
    try {
      if (removed?.storage_path) {
        await supabase.storage.from('creative-assets').remove([removed.storage_path]);
      }
      const { error } = await supabase
        .from('creative_briefs')
        .update({ reference_assets: existing as any })
        .eq('id', brief.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success('Reference removed');
    } catch (err: any) {
      toast.error(err.message || 'Remove failed');
    }
  };

  const isVideo = (ref: any) =>
    (ref.file_type && ref.file_type.startsWith('video/')) ||
    /\.(mp4|mov|webm|m4v|avi)$/i.test(ref.file_name || ref.url || ref.drive_url || '');
  const isImage = (ref: any) =>
    (ref.file_type && ref.file_type.startsWith('image/')) ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(ref.file_name || ref.url || ref.drive_url || '');

  const copySuggestions = Array.isArray(brief.copy_suggestions) ? brief.copy_suggestions : [];


  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l bg-card shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={`text-xs ${statusConf.color}`}>{statusConf.label}</Badge>
          <Badge variant="secondary" className={`text-xs ${priorityConf.color}`}>{priorityConf.label}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="details" className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b px-5 bg-transparent">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="deliverables">
              Deliverables {totalCount > 0 && `(${uploadedCount}/${totalCount})`}
            </TabsTrigger>
            <TabsTrigger value="review">
              Review {reviews.length > 0 && `(${reviews.length})`}
            </TabsTrigger>
            <TabsTrigger value="comments">
              Comments {comments.length > 0 && `(${comments.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="p-5 space-y-5">
            <h2 className="text-lg font-semibold">{brief.title}</h2>

            {/* Time Tracking Card */}
            {(estimatedHours || actualHours > 0) && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    Time Tracking
                  </span>
                  <span className={`font-mono font-semibold ${
                    estimatedHours && actualHours > estimatedHours ? 'text-destructive' : 'text-foreground'
                  }`}>
                    {actualHours}h {estimatedHours ? `/ ${estimatedHours}h est.` : 'logged'}
                  </span>
                </div>
                {estimatedHours && (
                  <>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          actualHours > estimatedHours ? 'bg-destructive' :
                          actualHours / estimatedHours > 0.7 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(120, (actualHours / estimatedHours) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {actualHours > estimatedHours
                        ? `⚠ Over by ${(actualHours - estimatedHours).toFixed(1)}h — update future estimates`
                        : actualHours / estimatedHours > 0.7
                        ? `Getting close — ${(estimatedHours - actualHours).toFixed(1)}h remaining`
                        : `${(estimatedHours - actualHours).toFixed(1)}h remaining of estimate`}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoField label="Creative Type(s)" value={(brief.creative_types || [brief.creative_type]).join(', ')} />
              <InfoField label="Platforms" value={(brief.platforms || []).join(', ')} />
              <InfoField label="Funnel Stage" value={brief.funnel_stage} />
              <InfoField label="Concepts" value={brief.num_concepts} />
              <InfoField label="Assigned To" value={brief.assigned_to?.name || 'Unassigned'} />
              <InfoField label="Created By" value={brief.created_by?.name} />
              <InfoField label="Due Date" value={brief.due_date ? format(new Date(brief.due_date), 'MMM d, yyyy') : '—'} />
              <InfoField label="Deliverables" value={`${approvedCount}/${totalCount} approved`} />
            </div>

            {/* Sizes */}
            {brief.sizes && Array.isArray(brief.sizes) && brief.sizes.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Sizes</span>
                <div className="flex flex-wrap gap-1">
                  {brief.sizes.map((s: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{s.label} ({s.width}×{s.height})</Badge>
                  ))}
                </div>
              </div>
            )}

            {brief.objective && <InfoBlock label="Objective" text={brief.objective} />}
            {brief.key_message && <InfoBlock label="Key Message / CTA" text={brief.key_message} />}
            {brief.target_audience && <InfoBlock label="Target Audience" text={brief.target_audience} />}
            {brief.tone_style && <InfoBlock label="Tone / Style" text={brief.tone_style} />}
            {brief.dos_and_donts && <InfoBlock label="Do's and Don'ts" text={brief.dos_and_donts} />}

            {copySuggestions.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground block mb-2">Copy Suggestions</span>
                {copySuggestions.map((c: any, i: number) => (
                  <div key={i} className="rounded border p-2 mb-2 space-y-1 text-xs">
                    {c.primary_text && <div><span className="text-muted-foreground">Primary:</span> {c.primary_text}</div>}
                    {c.headline && <div><span className="text-muted-foreground">Headline:</span> {c.headline}</div>}
                    {c.description && <div><span className="text-muted-foreground">Description:</span> {c.description}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Video Scripts */}
            {brief.video_scripts && Array.isArray(brief.video_scripts) && brief.video_scripts.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground block mb-2">Video Scripts ({brief.video_scripts.length})</span>
                {brief.video_scripts.map((s: any, i: number) => (
                  <div key={s.id || i} className="rounded-lg border p-3 mb-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.title || `Script ${i + 1}`}</span>
                      <Badge variant="outline" className="text-[10px]">{s.platform}</Badge>
                      <Badge variant="outline" className="text-[10px]">{s.duration}</Badge>
                      {s.enhanced_text && (
                        <Badge className="text-[10px] bg-purple-100 text-purple-700">
                          <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI Enhanced
                        </Badge>
                      )}
                    </div>
                    <pre className="text-xs whitespace-pre-wrap text-foreground/80">{s.script_text}</pre>
                    {s.enhanced_text && (
                      <details className="mt-1">
                        <summary className="text-xs text-purple-600 cursor-pointer">View AI-Enhanced Version</summary>
                        <pre className="text-xs whitespace-pre-wrap text-foreground/70 mt-1 p-2 rounded bg-purple-50/50 border border-purple-100">{s.enhanced_text}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}

            {brief.notes && <InfoBlock label="Notes" text={brief.notes} />}

            {/* Reference assets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Reference Assets</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline">
                  <Paperclip className="h-3 w-3" />
                  {isUploadingRefs ? 'Uploading…' : 'Attach files'}
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.psd,.ai,.fig,.sketch,.zip,.doc,.docx"
                    className="hidden"
                    onChange={handleReferenceUpload}
                    disabled={isUploadingRefs}
                  />
                </label>
              </div>
              {Array.isArray(brief.reference_assets) && brief.reference_assets.length > 0 ? (
                <div className="space-y-2">
                  {brief.reference_assets.map((ref: any, i: number) => {
                    const href = ref.drive_url || ref.url;
                    return (
                      <div key={i} className="rounded-lg border p-2 space-y-1.5">
                        {isVideo(ref) && href && (
                          <video src={href} controls className="w-full max-h-64 rounded bg-black" />
                        )}
                        {isImage(ref) && href && !isVideo(ref) && (
                          <img src={href} alt={ref.file_name || ''} className="w-full max-h-64 object-contain rounded bg-muted" />
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <a href={href} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline truncate flex-1">
                            {ref.file_name || href}
                          </a>
                          {ref.source === 'upload' && (
                            <button
                              type="button"
                              onClick={() => handleRemoveReference(i)}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No references yet — attach videos, images, or docs above.</p>
              )}
            </div>

            {/* Status actions */}
            <div className="flex gap-2 flex-wrap pt-2 border-t">
              {brief.status === 'draft' && (
                <Button size="sm" onClick={() => updateStatus.mutate({ id: brief.id, status: 'submitted' })}>Submit Brief</Button>
              )}
              {brief.status === 'submitted' && !isDesigner && (
                <Button size="sm" onClick={() => updateStatus.mutate({ id: brief.id, status: 'in_design' })}>Start Design</Button>
              )}
              {brief.status === 'submitted' && isDesigner && (
                <Button size="sm" onClick={() => updateStatus.mutate({ id: brief.id, status: 'in_design' })}>Pick Up</Button>
              )}
              {brief.status === 'in_design' && isDesigner && (
                <Button size="sm"
                  disabled={uploadedCount === 0}
                  onClick={() => updateStatus.mutate({ id: brief.id, status: 'ready_for_review' })}
                >
                  Submit for Review
                </Button>
              )}
              {brief.status === 'approved' && (
                <Button size="sm" onClick={() => updateStatus.mutate({ id: brief.id, status: 'delivered' })}>
                  Mark as Trafficked
                </Button>
              )}
              {brief.status === 'revision_requested' && isDesigner && (
                <Button size="sm" onClick={() => updateStatus.mutate({ id: brief.id, status: 'in_design' })}>
                  Resume Work
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Deliverables Tab */}
          <TabsContent value="deliverables" className="p-5 space-y-3">
            {/* Upload button for designers */}
            {isDesigner && ['in_design', 'revision_requested'].includes(brief.status) && (
              <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 cursor-pointer hover:bg-primary/10 transition-colors">
                <Upload className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {isUploading ? 'Uploading...' : 'Upload Completed Assets'}
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.psd,.ai,.fig,.sketch,.pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
              </label>
            )}
            <p className="text-[10px] text-muted-foreground">
              Files are auto-organized: <span className="font-mono">{brief.client?.name || 'Client'} / {brief.title?.slice(0, 30)}</span>
            </p>

            {deliverables.length === 0 && !isUploading ? (
              <p className="text-sm text-muted-foreground text-center py-4">No deliverables yet. Upload your completed assets above.</p>
            ) : (
              deliverables.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="h-12 w-12 rounded bg-accent flex items-center justify-center shrink-0">
                    {d.file_url && (d.file_type?.startsWith('image/') || !d.file_type) ? (
                      <img src={d.file_url} alt="" className="h-full w-full object-cover rounded" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{d.concept_label} — {d.size_label}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>v{d.version}</span>
                      {d.uploaded_at && <span>• {format(new Date(d.uploaded_at), 'MMM d, HH:mm')}</span>}
                      {d.uploaded_by?.name && <span>• {d.uploaded_by.name}</span>}
                    </div>
                    {d.revision_note && (
                      <p className="text-xs text-orange-600 mt-1">⚠ {d.revision_note}</p>
                    )}
                  </div>
                  <Badge variant="secondary" className={`text-[9px] shrink-0 ${
                    d.status === 'approved' ? 'bg-green-100 text-green-700' :
                    d.status === 'revision_requested' ? 'bg-orange-100 text-orange-700' :
                    d.status === 'uploaded' ? 'bg-blue-100 text-blue-700' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {d.status === 'pending' ? 'Pending' : d.status === 'uploaded' ? 'Uploaded' :
                     d.status === 'approved' ? 'Approved' : 'Needs Revision'}
                  </Badge>
                  {d.file_url && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      title="Download"
                      onClick={async () => {
                        const filename = d.file_name || `${d.concept_label || 'deliverable'}-${d.size_label || ''}`.trim();
                        const triggerDownload = (blob: Blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = filename;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        };
                        try {
                          // Prefer Supabase SDK download for storage-hosted assets (avoids CORS)
                          const match = d.file_url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
                          if (match) {
                            const [, bucket, path] = match;
                            const { data, error } = await supabase.storage
                              .from(bucket)
                              .download(decodeURIComponent(path));
                            if (error || !data) throw error || new Error('Download failed');
                            triggerDownload(data);
                            return;
                          }
                          // Non-storage URL — fetch directly
                          const res = await fetch(d.file_url);
                          if (!res.ok) throw new Error('Download failed');
                          triggerDownload(await res.blob());
                        } catch (err: any) {
                          // Fallback: open in new tab so user can right-click → save
                          window.open(d.file_url, '_blank');
                          toast.error('Direct download blocked — opened in new tab (right-click → Save As)');
                        }
                      }}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </TabsContent>

          {/* Review Tab */}
          <TabsContent value="review" className="p-5 space-y-4">
            {brief.status === 'ready_for_review' && teamMember && !isDesigner && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h4 className="text-sm font-medium">Submit Review</h4>
                  <Textarea value={reviewComments} onChange={e => setReviewComments(e.target.value)}
                    placeholder="Review comments..." rows={3} className="text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-destructive"
                      onClick={() => { addReview.mutate({ briefId: brief.id, action: 'revision_requested', comments: reviewComments }); setReviewComments(''); }}>
                      Request Revision
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => { addReview.mutate({ briefId: brief.id, action: 'approved_with_notes', comments: reviewComments }); setReviewComments(''); }}>
                      Approve with Notes
                    </Button>
                    <Button size="sm"
                      onClick={() => { addReview.mutate({ briefId: brief.id, action: 'approved', comments: reviewComments }); setReviewComments(''); }}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Approve All
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Per-deliverable review (for ready_for_review status) */}
            {brief.status === 'ready_for_review' && !isDesigner && deliverables.filter((d: any) => d.status === 'uploaded').length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Per-Deliverable Review</h4>
                {deliverables.filter((d: any) => d.status === 'uploaded').map((d: any) => (
                  <div key={d.id} className="flex items-center gap-2 rounded border p-2">
                    <div className="flex-1 text-xs">{d.concept_label} — {d.size_label}</div>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive"
                      onClick={() => {
                        const note = prompt('Revision note:');
                        if (note) addReview.mutate({ briefId: brief.id, deliverableId: d.id, action: 'revision_requested', comments: note });
                      }}>
                      Revise
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-green-700"
                      onClick={() => addReview.mutate({ briefId: brief.id, deliverableId: d.id, action: 'approved', comments: '' })}>
                      ✓ Approve
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Review history */}
            {reviews.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Review History</h4>
                <div className="space-y-2">
                  {reviews.map((r: any) => (
                    <div key={r.id} className="rounded border p-2.5 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant={r.action === 'approved' ? 'default' : r.action === 'approved_with_notes' ? 'secondary' : 'destructive'} className="text-[9px]">
                          {r.action === 'approved' ? '✓ Approved' : r.action === 'approved_with_notes' ? '✓ Approved w/ Notes' : '↻ Revision'}
                        </Badge>
                        <span className="text-muted-foreground">{r.reviewer?.name}</span>
                        <span className="text-muted-foreground">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>
                      </div>
                      {r.comments && <p className="text-xs text-foreground/80">{r.comments}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Comments Tab */}
          <TabsContent value="comments" className="p-5 flex flex-col h-[calc(100%-48px)]">
            <div className="flex-1 space-y-3 overflow-y-auto mb-3">
              {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
              {comments.map((c: any) => (
                <div key={c.id} className="flex gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{c.author?.name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{c.author?.name}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(c.created_at), 'MMM d, HH:mm')}</span>
                    </div>
                    <p className="text-sm">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={commentText} onChange={e => setCommentText(e.target.value)}
                placeholder="Add a comment..." className="text-sm"
                onKeyDown={e => e.key === 'Enter' && handleComment()} />
              <Button size="icon" onClick={handleComment} disabled={!commentText.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {editOpen && (
        <EditBriefDialog brief={brief} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block">{label}</span>
      <span className="text-sm capitalize">{value || '—'}</span>
    </div>
  );
}

function InfoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-1">{label}</span>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}
