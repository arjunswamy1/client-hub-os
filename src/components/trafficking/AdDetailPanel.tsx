import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import { useTraffickingAdMutations } from '@/hooks/useTrafficking';
import { useAuth } from '@/contexts/AuthContext';
import { AttachCreativeModal } from './AttachCreativeModal';
import { GoogleAdPreview } from './GoogleAdPreview';

const STATUS_FLOW = ['draft', 'in_progress', 'ready_for_preview', 'pending_approval', 'approved', 'live', 'paused', 'killed'];

interface Props {
  ad: any;
  onClose: () => void;
  clientId: string;
}

export function AdDetailPanel({ ad, onClose, clientId }: Props) {
  const { updateAd } = useTraffickingAdMutations(clientId);
  const { teamMember } = useAuth();
  const [attachOpen, setAttachOpen] = useState(false);

  const checklist = ad.launch_checklist || [];
  const requiredUnchecked = checklist.filter((c: any) => c.required && !c.checked);
  const canApprove = requiredUnchecked.length === 0;

  const handleChecklistToggle = (idx: number) => {
    const updated = [...checklist];
    updated[idx] = {
      ...updated[idx],
      checked: !updated[idx].checked,
      checked_by: !updated[idx].checked ? teamMember?.id : null,
      checked_at: !updated[idx].checked ? new Date().toISOString() : null,
    };
    updateAd.mutate({ id: ad.id, launch_checklist: updated });
  };

  const handleStatusChange = (status: string) => {
    if (status === 'approved' && !canApprove) return;
    const updates: any = { id: ad.id, status };
    if (status === 'approved') {
      updates.approved_by_id = teamMember?.id;
      updates.approved_at = new Date().toISOString();
    }
    updateAd.mutate(updates);
  };

  return (
    <>
      <Sheet open onOpenChange={() => onClose()}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">{ad.ad_name}</SheetTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px]">{ad.platform}</Badge>
              {ad.format && <Badge variant="outline" className="text-[10px]">{ad.format}</Badge>}
            </div>
          </SheetHeader>

          <Tabs defaultValue="details" className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
              <TabsTrigger value="checklist" className="flex-1">Checklist</TabsTrigger>
              <TabsTrigger value="preview" className="flex-1">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              {/* Status */}
              <div>
                <label className="text-xs font-medium">Status</label>
                <Select value={ad.status} onValueChange={handleStatusChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FLOW.map(s => (
                      <SelectItem key={s} value={s} disabled={s === 'approved' && !canApprove}>
                        {s.replace(/_/g, ' ')}
                        {s === 'approved' && !canApprove ? ' (checklist incomplete)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Copy */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase">Ad Copy</h4>
                {ad.primary_text && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Primary Text</span>
                    <p className="text-sm">{ad.primary_text}</p>
                  </div>
                )}
                {ad.headline && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Headline</span>
                    <p className="text-sm font-medium">{ad.headline}</p>
                  </div>
                )}
                {ad.description && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">Description</span>
                    <p className="text-sm">{ad.description}</p>
                  </div>
                )}
                {ad.cta && <p className="text-xs"><span className="font-medium">CTA:</span> {ad.cta}</p>}
                {ad.final_url && (
                  <p className="text-xs flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    <a href={ad.final_url} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate">{ad.final_url}</a>
                  </p>
                )}
              </div>

              {/* Creative Assets */}
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">Creative Assets</h4>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAttachOpen(true)}>
                    <ImageIcon className="h-3 w-3 mr-1" /> Attach Creative
                  </Button>
                </div>
                {ad.deliverable_ids?.length > 0 ? (
                  <p className="text-xs mt-1">{ad.deliverable_ids.length} deliverable(s) attached</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">No creative assets attached yet.</p>
                )}
              </div>

              {/* Notes */}
              {ad.notes && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">Notes</h4>
                  <p className="text-sm mt-1">{ad.notes}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="checklist" className="mt-4">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Launch Checklist</h4>
                {checklist.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 py-1">
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={() => handleChecklistToggle(idx)}
                    />
                    <div className="flex-1">
                      <span className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : ''}`}>
                        {item.item}
                      </span>
                      {item.required && !item.checked && (
                        <span className="text-[9px] text-red-500 ml-1">required</span>
                      )}
                      {item.checked_at && (
                        <p className="text-[10px] text-muted-foreground">
                          Checked {new Date(item.checked_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {!canApprove && (
                  <p className="text-xs text-amber-600 mt-3">
                    ⚠ {requiredUnchecked.length} required item(s) must be checked before approval.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              {ad.platform === 'google' ? (
                <GoogleAdPreview ad={ad} />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Meta ad previews require API integration. Use the "Generate Preview" button to create a real preview via the Meta Ad Preview API.
                  </p>
                  <Button size="sm" variant="outline" disabled>
                    Generate Meta Preview (Coming Soon)
                  </Button>
                  {/* Show basic text preview */}
                  <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
                    <p className="text-xs text-muted-foreground">Text Preview:</p>
                    {ad.primary_text && <p className="text-sm">{ad.primary_text}</p>}
                    <div className="border-t pt-2">
                      {ad.headline && <p className="text-sm font-semibold text-primary">{ad.headline}</p>}
                      {ad.description && <p className="text-xs text-muted-foreground">{ad.description}</p>}
                    </div>
                    {ad.cta && (
                      <div className="pt-1">
                        <Badge className="bg-primary text-primary-foreground text-xs">{ad.cta}</Badge>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <AttachCreativeModal open={attachOpen} onOpenChange={setAttachOpen} ad={ad} clientId={clientId} />
    </>
  );
}
