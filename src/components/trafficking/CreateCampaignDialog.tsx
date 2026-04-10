import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCampaignMutations } from '@/hooks/useTrafficking';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}

export function CreateCampaignDialog({ open, onOpenChange, clientId }: Props) {
  const { teamMemberId } = useAuth();
  const { createCampaign } = useCampaignMutations(clientId);
  const [form, setForm] = useState({
    name: '',
    platform: 'meta',
    objective: '',
    location: 'United States',
    bidding_strategy: '',
    start_date: '',
    end_date: '',
    total_budget: '',
  });

  const handleSubmit = () => {
    createCampaign.mutate({
      ...form,
      total_budget: form.total_budget ? parseFloat(form.total_budget) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      created_by_id: teamMemberId,
    }, {
      onSuccess: () => {
        onOpenChange(false);
        setForm({ name: '', platform: 'meta', objective: '', location: 'United States', bidding_strategy: '', start_date: '', end_date: '', total_budget: '' });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Campaign Name *</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder='e.g. "Search | Mothers Day 2026"' />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Platform *</label>
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
              <label className="text-xs font-medium">Objective</label>
              <Select value={form.objective} onValueChange={v => setForm(f => ({ ...f, objective: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="seasonal_sales">Seasonal Sales</SelectItem>
                  <SelectItem value="evergreen">Evergreen</SelectItem>
                  <SelectItem value="product_launch">Product Launch</SelectItem>
                  <SelectItem value="retargeting">Retargeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Bidding Strategy</label>
              <Select value={form.bidding_strategy} onValueChange={v => setForm(f => ({ ...f, bidding_strategy: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="maximize_conversions">Maximize Conversions</SelectItem>
                  <SelectItem value="target_cpa">Target CPA</SelectItem>
                  <SelectItem value="target_roas">Target ROAS</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Location</label>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium">Start Date</label>
              <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">End Date</label>
              <Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Total Budget ($)</label>
              <Input type="number" value={form.total_budget} onChange={e => setForm(f => ({ ...f, total_budget: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!form.name || createCampaign.isPending}>Create Campaign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
