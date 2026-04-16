import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import { TaskType, PLATFORM_OPTIONS } from './taskTypes';

interface Props {
  taskType: TaskType;
  data: any;
  onChange: (next: any) => void;
}

export function TaskTypeFields({ taskType, data, onChange }: Props) {
  const set = (key: string, value: any) => onChange({ ...(data || {}), [key]: value });

  if (taskType === 'landing_page') {
    const variants: { label: string; url: string; notes?: string }[] = data?.variants || [];
    const updateVariant = (idx: number, patch: Partial<typeof variants[0]>) => {
      const next = [...variants];
      next[idx] = { ...next[idx], ...patch };
      set('variants', next);
    };
    return (
      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="space-y-2">
          <Label className="text-xs">Landing Page URL</Label>
          <Input
            value={data?.landing_page_url || ''}
            onChange={e => set('landing_page_url', e.target.value)}
            placeholder="https://..."
            className="h-8"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border bg-background p-2">
          <div>
            <Label className="text-xs font-medium">Tracking confirmed</Label>
            <p className="text-[11px] text-muted-foreground">Pixel / GA4 / call tracking verified</p>
          </div>
          <Switch
            checked={!!data?.tracking_confirmed}
            onCheckedChange={v => set('tracking_confirmed', v)}
          />
        </div>

        {!data?.tracking_confirmed && (
          <div className="space-y-2">
            <Label className="text-xs">Tracking notes / what's needed</Label>
            <Textarea
              value={data?.tracking_notes || ''}
              onChange={e => set('tracking_notes', e.target.value)}
              placeholder="What needs to be set up?"
              rows={2}
              className="text-xs"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Must-haves / important details to capture</Label>
          <Textarea
            value={data?.must_haves || ''}
            onChange={e => set('must_haves', e.target.value)}
            placeholder="Hero copy, CTAs, form fields, brand guardrails..."
            rows={3}
            className="text-xs"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border bg-background p-2">
          <div>
            <Label className="text-xs font-medium">A/B test</Label>
            <p className="text-[11px] text-muted-foreground">Capture variants below</p>
          </div>
          <Switch
            checked={!!data?.is_ab_test}
            onCheckedChange={v => {
              set('is_ab_test', v);
              if (v && (!variants || variants.length === 0)) {
                set('variants', [
                  { label: 'A', url: '', notes: '' },
                  { label: 'B', url: '', notes: '' },
                ]);
              }
            }}
          />
        </div>

        {data?.is_ab_test && (
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="rounded-md border bg-background p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={v.label}
                    onChange={e => updateVariant(i, { label: e.target.value })}
                    placeholder="Label (A, B, C...)"
                    className="h-7 w-20 text-xs"
                  />
                  <Input
                    value={v.url}
                    onChange={e => updateVariant(i, { url: e.target.value })}
                    placeholder="Variant URL"
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => set('variants', variants.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  value={v.notes || ''}
                  onChange={e => updateVariant(i, { notes: e.target.value })}
                  placeholder="Hypothesis / what's different"
                  className="h-7 text-xs"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => set('variants', [...variants, { label: String.fromCharCode(65 + variants.length), url: '', notes: '' }])}
            >
              <Plus className="h-3 w-3 mr-1" /> Add variant
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (taskType === 'creative_brief') {
    return (
      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="space-y-2">
          <Label className="text-xs">Briefs needed (what to brief out)</Label>
          <Textarea
            value={data?.briefs_needed || ''}
            onChange={e => set('briefs_needed', e.target.value)}
            placeholder="Describe the briefs: angles, hooks, scripts, themes..."
            rows={3}
            className="text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs"># of ads to build</Label>
            <Input
              type="number"
              min={1}
              value={data?.num_ads ?? ''}
              onChange={e => set('num_ads', e.target.value ? Number(e.target.value) : null)}
              className="h-8 text-xs"
              placeholder="e.g. 4"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Deadline</Label>
            <Input
              type="date"
              value={data?.deadline || ''}
              onChange={e => set('deadline', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Formats / sizes</Label>
          <Input
            value={data?.formats || ''}
            onChange={e => set('formats', e.target.value)}
            placeholder="Static 1:1, video 9:16, carousel..."
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={data?.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Tone, do's & don'ts, references..."
            rows={2}
            className="text-xs"
          />
        </div>
      </div>
    );
  }

  if (taskType === 'media_build') {
    return (
      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs">Platform</Label>
            <Select value={data?.platform || ''} onValueChange={v => set('platform', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Vertical</Label>
            <Input
              value={data?.vertical || ''}
              onChange={e => set('vertical', e.target.value)}
              placeholder="Pest, Flights, HVAC..."
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs">Objective</Label>
            <Input
              value={data?.campaign_objective || ''}
              onChange={e => set('campaign_objective', e.target.value)}
              placeholder="Calls, leads, conversions"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Budget</Label>
            <Input
              value={data?.budget || ''}
              onChange={e => set('budget', e.target.value)}
              placeholder="$/day or total"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Notable details</Label>
          <Textarea
            value={data?.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Geo, ad groups, bid strategy, special instructions..."
            rows={3}
            className="text-xs"
          />
        </div>
      </div>
    );
  }

  return null;
}
