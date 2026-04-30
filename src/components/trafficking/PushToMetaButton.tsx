import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  campaign: any;
}

export function PushToMetaButton({ campaign }: Props) {
  const [open, setOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [adAccountId, setAdAccountId] = useState(campaign.meta_ad_account_id || '');
  const [pageId, setPageId] = useState(campaign.meta_page_id || '');
  const [igActorId, setIgActorId] = useState(campaign.meta_instagram_actor_id || '');
  const [pixelId, setPixelId] = useState(campaign.meta_pixel_id || '');
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  if (campaign.platform !== 'meta') return null;

  const isPushed = !!campaign.meta_campaign_id;

  const handlePush = async () => {
    if (!adAccountId.startsWith('act_')) {
      toast({ title: 'Invalid ad account', description: 'Ad account ID must start with "act_"', variant: 'destructive' });
      return;
    }
    if (!pageId) {
      toast({ title: 'Page required', description: 'A Facebook Page ID is required', variant: 'destructive' });
      return;
    }
    setPushing(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('meta-push-campaign', {
        body: {
          campaign_id: campaign.id,
          ad_account_id: adAccountId,
          page_id: pageId,
          instagram_actor_id: igActorId || undefined,
          pixel_id: pixelId || undefined,
        },
      });
      if (error) throw error;
      setResult(data);
      if (data?.success) {
        toast({ title: 'Pushed to Meta', description: data.message });
        qc.invalidateQueries({ queryKey: ['trafficking_campaigns'] });
        qc.invalidateQueries({ queryKey: ['trafficking_ads'] });
      } else {
        toast({ title: 'Push failed', description: data?.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Push failed', description: err.message, variant: 'destructive' });
      setResult({ error: err.message });
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      <Button size="sm" variant={isPushed ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        <Send className="h-3 w-3 mr-1.5" />
        {isPushed ? 'Re-push to Meta' : 'Push to Meta'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Push Campaign to Meta as Draft</DialogTitle>
            <DialogDescription>
              Creates the campaign, ad set, and all ads in <strong>PAUSED</strong> status. Review and activate inside Meta Ads Manager before launching.
            </DialogDescription>
          </DialogHeader>

          {isPushed && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Already pushed. Meta Campaign ID: <code>{campaign.meta_campaign_id}</code>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="ad-account">Meta Ad Account ID *</Label>
              <Input id="ad-account" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="act_1234567890" />
              <p className="text-xs text-muted-foreground mt-1">From Ads Manager → Account Overview. Must start with <code>act_</code>.</p>
            </div>
            <div>
              <Label htmlFor="page-id">Facebook Page ID *</Label>
              <Input id="page-id" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1234567890" />
            </div>
            <div>
              <Label htmlFor="ig-actor">Instagram Actor ID (optional)</Label>
              <Input id="ig-actor" value={igActorId} onChange={(e) => setIgActorId(e.target.value)} placeholder="17841400000000000" />
            </div>
            <div>
              <Label htmlFor="pixel">Meta Pixel ID (required for Sales objective)</Label>
              <Input id="pixel" value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="1234567890" />
            </div>
          </div>

          {result && (
            <Alert variant={result.success ? 'default' : 'destructive'} className="mt-2">
              {result.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertDescription className="text-xs space-y-1">
                <div>{result.message || result.error}</div>
                {result.success && result.ads && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {result.ads.map((a: any) => (
                      <Badge key={a.ad_id} variant={a.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">
                        {a.status === 'success' ? '✓' : '✗'} {a.meta_ad_id || a.error?.slice(0, 30)}
                      </Badge>
                    ))}
                  </div>
                )}
                {result.success && (
                  <a
                    href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace('act_', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline mt-2"
                  >
                    Open in Ads Manager <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={handlePush} disabled={pushing || !adAccountId || !pageId}>
              {pushing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {isPushed ? 'Re-push' : 'Push as PAUSED Draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
