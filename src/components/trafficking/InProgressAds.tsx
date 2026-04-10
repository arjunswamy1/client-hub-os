import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Sparkles, Eye, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { useTraffickingAds, useTraffickingAdMutations } from '@/hooks/useTrafficking';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreateAdDialog } from './CreateAdDialog';
import { AdDetailPanel } from './AdDetailPanel';
import { AICopyPanel } from './AICopyPanel';

const IN_PROGRESS_STATUSES = ['draft', 'in_progress', 'ready_for_preview', 'pending_approval', 'approved'];

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-yellow-100 text-yellow-800',
  ready_for_preview: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-purple-100 text-purple-800',
  approved: 'bg-green-100 text-green-800',
};

interface Props {
  clientId: string;
}

export function InProgressAds({ clientId }: Props) {
  const { data: ads = [] } = useTraffickingAds(clientId, IN_PROGRESS_STATUSES);
  const { updateAd } = useTraffickingAdMutations(clientId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [aiCopyAdId, setAiCopyAdId] = useState<string | null>(null);

  const selectedAd = (ads as any[]).find((a: any) => a.id === selectedAdId);
  const aiCopyAd = (ads as any[]).find((a: any) => a.id === aiCopyAdId);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">In Progress / Upcoming</CardTitle>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Ad
          </Button>
        </CardHeader>
        <CardContent>
          {(ads as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No ads in progress. Create one to start building.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Name</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Launch Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ads as any[]).map((ad: any) => {
                  const checklist = ad.launch_checklist || [];
                  const checked = checklist.filter((c: any) => c.checked).length;
                  const total = checklist.length;

                  return (
                    <TableRow key={ad.id} className="cursor-pointer" onClick={() => setSelectedAdId(ad.id)}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{ad.ad_name}</p>
                          {ad.platform && <span className="text-[10px] text-muted-foreground">{ad.platform}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{ad.campaign?.name || '—'}</TableCell>
                      <TableCell className="text-xs">{ad.format || '—'}</TableCell>
                      <TableCell className="text-xs">{ad.launch_target ? format(new Date(ad.launch_target), 'MMM d') : '—'}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${statusColors[ad.status] || 'bg-muted'}`}>
                          {ad.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {total > 0 ? `${checked}/${total}` : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="AI Copy" onClick={() => setAiCopyAdId(ad.id)}>
                            <Sparkles className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateAdDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} clientId={clientId} />

      {selectedAd && (
        <AdDetailPanel ad={selectedAd} onClose={() => setSelectedAdId(null)} clientId={clientId} />
      )}

      {aiCopyAd && (
        <AICopyPanel ad={aiCopyAd} onClose={() => setAiCopyAdId(null)} clientId={clientId} />
      )}
    </>
  );
}
