
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, Clock, CheckCircle2, AlertCircle, Send, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { useCreativeDeliverables, useCreativeReviews, useBriefComments, useBriefMutations } from '@/hooks/useCreativeBriefs';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  brief: any;
  onClose: () => void;
}

export function BriefDetailPanel({ brief, onClose }: Props) {
  const { teamMember, isDesigner } = useAuth();
  const { data: deliverables = [] } = useCreativeDeliverables(brief.id);
  const { data: reviews = [] } = useCreativeReviews(brief.id);
  const { data: comments = [] } = useBriefComments(brief.id);
  const { updateStatus, addComment, addReview } = useBriefMutations();

  const [reviewComments, setReviewComments] = useState('');
  const [commentText, setCommentText] = useState('');

  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

  const approvedCount = deliverables.filter((d: any) => d.status === 'approved').length;
  const uploadedCount = deliverables.filter((d: any) => d.status !== 'pending').length;
  const totalCount = deliverables.length;

  const handleComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate({ briefId: brief.id, content: commentText });
    setCommentText('');
  };

  const copySuggestions = Array.isArray(brief.copy_suggestions) ? brief.copy_suggestions : [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l bg-card shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={`text-xs ${statusConf.color}`}>{statusConf.label}</Badge>
          <Badge variant="secondary" className={`text-xs ${priorityConf.color}`}>{priorityConf.label}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
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

          {/* Details Tab */}
          <TabsContent value="details" className="p-5 space-y-5">
            <h2 className="text-lg font-semibold">{brief.title}</h2>

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

            {brief.notes && <InfoBlock label="Notes" text={brief.notes} />}

            {/* Reference assets */}
            {brief.reference_assets && Array.isArray(brief.reference_assets) && brief.reference_assets.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground block mb-2">Reference Assets</span>
                <div className="space-y-1">
                  {brief.reference_assets.map((ref: any, i: number) => (
                    <a key={i} href={ref.drive_url || ref.url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-primary hover:underline truncate">
                      {ref.file_name || ref.drive_url || ref.url}
                    </a>
                  ))}
                </div>
              </div>
            )}

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
            {deliverables.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deliverables generated yet.</p>
            ) : (
              deliverables.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="h-12 w-12 rounded bg-accent flex items-center justify-center shrink-0">
                    {d.file_url ? (
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
