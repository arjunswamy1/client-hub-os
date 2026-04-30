import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Image as ImageIcon, Paperclip, ExternalLink, AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CreateAdDialog } from './CreateAdDialog';
import { AttachCreativeModal } from './AttachCreativeModal';
import { AdDetailPanel } from './AdDetailPanel';

interface Props {
  campaign: any;
  clientId: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-yellow-100 text-yellow-800',
  ready_for_preview: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-purple-100 text-purple-800',
  approved: 'bg-green-100 text-green-800',
  live: 'bg-emerald-100 text-emerald-800',
};

export function CampaignAdsTab({ campaign, clientId }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [attachAd, setAttachAd] = useState<any | null>(null);
  const [detailAdId, setDetailAdId] = useState<string | null>(null);

  const { data: ads = [] } = useQuery({
    queryKey: ['trafficking_ads_by_campaign', campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trafficking_ads')
        .select('*')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const detailAd = (ads as any[]).find((a: any) => a.id === detailAdId);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Ads in this campaign</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Attach approved creative deliverables to each ad before pushing to Meta.</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Ad
          </Button>
        </CardHeader>
        <CardContent>
          {(ads as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No ads yet. Create one and attach creative to push to Meta.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Preview</TableHead>
                  <TableHead>Ad</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Creative</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Meta</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ads as any[]).map((ad: any) => {
                  const assets = (ad.asset_urls as any[]) || [];
                  const firstAsset = assets[0];
                  const hasCreative = assets.length > 0;
                  return (
                    <TableRow key={ad.id} className="cursor-pointer" onClick={() => setDetailAdId(ad.id)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="h-12 w-12 rounded bg-muted flex items-center justify-center overflow-hidden">
                          {firstAsset?.thumbnail || firstAsset?.url ? (
                            <img src={firstAsset.thumbnail || firstAsset.url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{ad.ad_name}</p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{ad.headline || ad.primary_text || '—'}</p>
                      </TableCell>
                      <TableCell className="text-xs">{ad.format || '—'}</TableCell>
                      <TableCell>
                        {hasCreative ? (
                          <Badge variant="outline" className="text-[10px]">{assets.length} asset{assets.length > 1 ? 's' : ''}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                            <AlertTriangle className="h-2.5 w-2.5 mr-1" /> none
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${statusColors[ad.status] || 'bg-muted'}`}>{ad.status?.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {ad.platform_ad_id ? (
                          <Badge variant="secondary" className="text-[10px] font-mono">{ad.platform_ad_id.slice(-8)}</Badge>
                        ) : ad.meta_push_error ? (
                          <Badge variant="destructive" className="text-[10px]">error</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => setAttachAd(ad)}>
                          <Paperclip className="h-3 w-3 mr-1" />
                          {hasCreative ? 'Edit' : 'Attach'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {campaign.meta_pushed_at && (
            <div className="mt-4 pt-3 border-t">
              <a
                href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${(campaign.meta_ad_account_id || '').replace('act_', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Open campaign in Meta Ads Manager <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateAdDialog open={createOpen} onOpenChange={setCreateOpen} clientId={clientId} />

      {attachAd && (
        <AttachCreativeModal
          open={!!attachAd}
          onOpenChange={(o) => !o && setAttachAd(null)}
          ad={attachAd}
          clientId={clientId}
        />
      )}

      {detailAd && (
        <AdDetailPanel ad={detailAd} onClose={() => setDetailAdId(null)} clientId={clientId} />
      )}
    </>
  );
}
