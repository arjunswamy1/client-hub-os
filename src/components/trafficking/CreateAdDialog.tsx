import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTraffickingAdMutations, useCampaigns, DEFAULT_LAUNCH_CHECKLIST } from '@/hooks/useTrafficking';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}

export function CreateAdDialog({ open, onOpenChange, clientId }: Props) {
  const { teamMemberId } = useAuth();
  const { createAd } = useTraffickingAdMutations(clientId);
  const { data: campaigns = [] } = useCampaigns(clientId);

  const [form, setForm] = useState({
    ad_name: '',
    campaign_id: '',
    platform: 'meta',
    format: '',
    ad_group: '',
    primary_text: '',
    headline: '',
    description: '',
    cta: '',
    final_url: '',
    utm_parameters: '',
    launch_target: '',
    creative_deadline: '',
    notes: '',
  });

  const handleSubmit = () => {
    createAd.mutate({
      ...form,
      campaign_id: form.campaign_id || null,
      launch_target: form.launch_target || null,
      creative_deadline: form.creative_deadline || null,
      created_by_id: teamMemberId,
      launch_checklist: DEFAULT_LAUNCH_CHECKLIST.map(item => ({
        ...item,
        checked: false,
        checked_by: null,
        checked_at: null,
      })),
    }, {
      onSuccess: () => {
        onOpenChange(false);
        setForm({ ad_name: '', campaign_id: '', platform: 'meta', format: '', ad_group: '', primary_text: '', headline: '', description: '', cta: '', final_url: '', utm_parameters: '', launch_target: '', creative_deadline: '', notes: '' });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Ad</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Identity */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Identity</h4>
            <div>
              <label className="text-xs font-medium">Ad Name *</label>
              <Input value={form.ad_name} onChange={e => setForm(f => ({ ...f, ad_name: e.target.value }))} placeholder="e.g. Spring_Sale_Static_4x5_V1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium">Campaign</label>
                <Select value={form.campaign_id} onValueChange={v => setForm(f => ({ ...f, campaign_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {(campaigns as any[]).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Platform</label>
                <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta">Meta</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Format</label>
                <Input value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value }))} placeholder="Static 4:5, Video 9:16" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Ad Set / Ad Group</label>
              <Input value={form.ad_group} onChange={e => setForm(f => ({ ...f, ad_group: e.target.value }))} />
            </div>
          </div>

          {/* Copy */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Copy</h4>
            <div>
              <label className="text-xs font-medium">Primary Text</label>
              <Textarea value={form.primary_text} onChange={e => setForm(f => ({ ...f, primary_text: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Headline</label>
                <Input value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium">Description</label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">CTA</label>
                <Select value={form.cta} onValueChange={v => setForm(f => ({ ...f, cta: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select CTA..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Shop Now">Shop Now</SelectItem>
                    <SelectItem value="Learn More">Learn More</SelectItem>
                    <SelectItem value="Sign Up">Sign Up</SelectItem>
                    <SelectItem value="Subscribe">Subscribe</SelectItem>
                    <SelectItem value="Get Offer">Get Offer</SelectItem>
                    <SelectItem value="Contact Us">Contact Us</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Final URL</label>
                <Input value={form.final_url} onChange={e => setForm(f => ({ ...f, final_url: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">UTM Parameters</label>
              <Input value={form.utm_parameters} onChange={e => setForm(f => ({ ...f, utm_parameters: e.target.value }))} placeholder="utm_source=meta&utm_medium=paid..." />
            </div>
          </div>

          {/* Planning */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Planning</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Creative Deadline</label>
                <Input type="date" value={form.creative_deadline} onChange={e => setForm(f => ({ ...f, creative_deadline: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium">Launch Target</label>
                <Input type="date" value={form.launch_target} onChange={e => setForm(f => ({ ...f, launch_target: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!form.ad_name || createAd.isPending}>Create Ad</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
