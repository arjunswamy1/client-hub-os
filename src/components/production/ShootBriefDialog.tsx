import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useShootLocations } from '@/hooks/useShootLocations';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  SHOOT_TYPE_OPTIONS, PLATFORM_OPTIONS, ORIENTATION_OPTIONS, SPECIALTY_OPTIONS,
  AGE_RANGE_OPTIONS, VERTICAL_OPTIONS, type ShootBrief, type BRollItem,
} from '@/types/production';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brief: ShootBrief | null;
}

export function ShootBriefDialog({ open, onOpenChange, brief }: Props) {
  const { clients } = useClient();
  const { data: locations = [] } = useShootLocations();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const blank: Partial<ShootBrief> = {
    title: '', client_ids: [], verticals: [], priority: 'medium',
    shoot_types: [], num_scripts: 1, takes_per_script: 3, target_script_length: '30sec',
    platforms: [], orientations: [], branding: 'unbranded',
    num_actors: 1, specialties_needed: [], new_actor_ok: true,
    location_confirmed: false, location_cost: 0,
    broll_shot_list: [], status: 'draft',
  };
  const [f, setF] = useState<any>(blank);

  useEffect(() => {
    setF(brief || blank);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, open]);

  const update = (patch: any) => setF((prev: any) => ({ ...prev, ...patch }));
  const toggleArr = (key: string, val: string) => setF((prev: any) => ({
    ...prev,
    [key]: (prev[key] || []).includes(val) ? prev[key].filter((v: string) => v !== val) : [...(prev[key] || []), val],
  }));

  const filteredLocations = locations.filter((l) =>
    f.verticals.length === 0 || f.verticals.some((v: string) => l.good_for_verticals.includes(v))
  );

  const estimatedHours = ((f.num_scripts || 1) * (f.takes_per_script || 3) * 0.15 + (f.num_actors || 1) * 0.5).toFixed(1);

  const computeTotal = () => {
    const fields = ['estimated_actor_cost', 'estimated_location_cost', 'estimated_crew_cost', 'estimated_equipment_cost', 'estimated_travel_cost'];
    return fields.reduce((s, k) => s + (parseFloat(f[k]) || 0), 0);
  };

  const addBRoll = () => update({ broll_shot_list: [...(f.broll_shot_list || []), { description: '' } as BRollItem] });
  const updBRoll = (i: number, patch: Partial<BRollItem>) => {
    const list = [...(f.broll_shot_list || [])];
    list[i] = { ...list[i], ...patch };
    update({ broll_shot_list: list });
  };
  const rmBRoll = (i: number) => update({ broll_shot_list: f.broll_shot_list.filter((_: any, x: number) => x !== i) });

  const save = async () => {
    if (!f.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...f,
        estimated_total: computeTotal(),
        estimated_shoot_hours: parseFloat(estimatedHours),
      };
      if (brief?.id) {
        const { error } = await supabase.from('shoot_briefs').update(payload).eq('id', brief.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('shoot_briefs').insert(payload);
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ['shoot_briefs'] });
      toast.success(brief ? 'Brief updated' : 'Brief created');
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{brief ? 'Edit Shoot Brief' : 'New Shoot Brief'}</DialogTitle></DialogHeader>

        <Tabs defaultValue="header">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="header">Header</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="actors">Actors</TabsTrigger>
            <TabsTrigger value="location">Location</TabsTrigger>
            <TabsTrigger value="budget">Budget</TabsTrigger>
          </TabsList>

          <TabsContent value="header" className="space-y-3 mt-4">
            <div><Label>Title *</Label><Input value={f.title || ''} onChange={(e) => update({ title: e.target.value })} placeholder="Billy HVAC — Bathroom Remodel UGC Set" /></div>
            <div>
              <Label>Clients (multi-select for unbranded cross-client content)</Label>
              <div className="flex flex-wrap gap-2 mt-2 max-h-32 overflow-y-auto p-2 border rounded">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-1 text-sm cursor-pointer">
                    <Checkbox checked={(f.client_ids || []).includes(c.id)} onCheckedChange={() => toggleArr('client_ids', c.id)} />{c.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Verticals</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {VERTICAL_OPTIONS.map((v) => (
                  <label key={v} className="flex items-center gap-1 text-xs cursor-pointer">
                    <Checkbox checked={(f.verticals || []).includes(v)} onCheckedChange={() => toggleArr('verticals', v)} />{v}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={f.priority} onValueChange={(v) => update({ priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['urgent', 'high', 'medium', 'low'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Shoot deadline</Label><Input type="date" value={f.shoot_deadline || ''} onChange={(e) => update({ shoot_deadline: e.target.value })} /></div>
              <div><Label>Content deadline</Label><Input type="date" value={f.content_deadline || ''} onChange={(e) => update({ content_deadline: e.target.value })} /></div>
            </div>
          </TabsContent>

          <TabsContent value="content" className="space-y-3 mt-4">
            <div>
              <Label>Shoot type(s)</Label>
              <div className="grid sm:grid-cols-2 gap-1 mt-2">
                {SHOOT_TYPE_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-1 text-sm cursor-pointer">
                    <Checkbox checked={(f.shoot_types || []).includes(s.value)} onCheckedChange={() => toggleArr('shoot_types', s.value)} />{s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label># Scripts</Label><Input type="number" min={1} value={f.num_scripts || 1} onChange={(e) => update({ num_scripts: parseInt(e.target.value) || 1 })} /></div>
              <div><Label>Takes per script</Label><Input type="number" min={1} value={f.takes_per_script || 3} onChange={(e) => update({ takes_per_script: parseInt(e.target.value) || 3 })} /></div>
              <div>
                <Label>Target length</Label>
                <Select value={f.target_script_length || ''} onValueChange={(v) => update({ target_script_length: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['15sec', '30sec', '60sec', '90sec', '2min+'].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Platforms</Label>
              <div className="flex gap-3 mt-2 flex-wrap">
                {PLATFORM_OPTIONS.map((p) => (
                  <label key={p.value} className="flex items-center gap-1 text-sm cursor-pointer">
                    <Checkbox checked={(f.platforms || []).includes(p.value)} onCheckedChange={() => toggleArr('platforms', p.value)} />{p.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Orientations</Label>
              <div className="flex gap-3 mt-2 flex-wrap">
                {ORIENTATION_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1 text-sm cursor-pointer">
                    <Checkbox checked={(f.orientations || []).includes(o.value)} onCheckedChange={() => toggleArr('orientations', o.value)} />{o.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Branding</Label>
              <Select value={f.branding} onValueChange={(v) => update({ branding: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unbranded">Unbranded (reusable across clients)</SelectItem>
                  <SelectItem value="branded">Branded (client-specific)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card className="p-3 bg-slate-50">
              <Label className="text-xs">B-Roll shot list</Label>
              <div className="space-y-2 mt-2">
                {(f.broll_shot_list || []).map((b: BRollItem, i: number) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 grid sm:grid-cols-2 gap-2">
                      <Input placeholder="Description" value={b.description} onChange={(e) => updBRoll(i, { description: e.target.value })} />
                      <Input placeholder="Purpose / overlay use" value={b.purpose || ''} onChange={(e) => updBRoll(i, { purpose: e.target.value })} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => rmBRoll(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addBRoll}><Plus className="h-3 w-3 mr-1" />Add B-roll shot</Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="actors" className="space-y-3 mt-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label># Actors</Label><Input type="number" min={1} value={f.num_actors || 1} onChange={(e) => update({ num_actors: parseInt(e.target.value) || 1 })} /></div>
              <div>
                <Label>Gender preference</Label>
                <Select value={f.gender_preference || 'any'} onValueChange={(v) => update({ gender_preference: v === 'any' ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Age range</Label>
                <Select value={f.age_range || 'any'} onValueChange={(v) => update({ age_range: v === 'any' ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {AGE_RANGE_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Specialties needed</Label>
              <div className="grid sm:grid-cols-2 gap-1 mt-2">
                {SPECIALTY_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-1 text-sm cursor-pointer">
                    <Checkbox checked={(f.specialties_needed || []).includes(s.value)} onCheckedChange={() => toggleArr('specialties_needed', s.value)} />{s.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={f.new_actor_ok ?? true} onCheckedChange={(v) => update({ new_actor_ok: !!v })} />
              New actors OK (will be flagged with 1-hour trial limit)
            </label>
            <p className="text-xs text-muted-foreground">Use "Find Actors" inside the brief detail view to cast specific people from the talent database.</p>
          </TabsContent>

          <TabsContent value="location" className="space-y-3 mt-4">
            <div>
              <Label>Pick from saved locations {f.verticals?.length > 0 && <span className="text-xs text-muted-foreground">(filtered by verticals)</span>}</Label>
              <Select value={f.location_id || 'none'} onValueChange={(v) => update({ location_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Choose a location..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None / TBD</SelectItem>
                  {filteredLocations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.city})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Location notes</Label><Textarea rows={2} value={f.location_notes || ''} onChange={(e) => update({ location_notes: e.target.value })} placeholder="Need a bathroom that looks recently remodeled..." /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Location cost ($)</Label><Input type="number" value={f.location_cost || 0} onChange={(e) => update({ location_cost: parseFloat(e.target.value) || 0 })} /></div>
              <label className="flex items-center gap-2 mt-7 text-sm cursor-pointer">
                <Checkbox checked={f.location_confirmed || false} onCheckedChange={(v) => update({ location_confirmed: !!v })} />Location confirmed
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Camera setup</Label><Input value={f.camera_setup || ''} onChange={(e) => update({ camera_setup: e.target.value })} /></div>
              <div>
                <Label>Audio</Label>
                <Select value={f.audio_setup || 'lavalier'} onValueChange={(v) => update({ audio_setup: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lavalier">Lavalier</SelectItem>
                    <SelectItem value="boom">Boom</SelectItem>
                    <SelectItem value="phone_mic">Phone Mic</SelectItem>
                    <SelectItem value="no_audio">No audio (B-roll)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Lighting notes</Label><Input value={f.lighting_notes || ''} onChange={(e) => update({ lighting_notes: e.target.value })} /></div>
            <div><Label>Support crew notes</Label><Textarea rows={2} value={f.support_crew_notes || ''} onChange={(e) => update({ support_crew_notes: e.target.value })} /></div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label>Shoot date</Label><Input type="date" value={f.shoot_date || ''} onChange={(e) => update({ shoot_date: e.target.value })} /></div>
              <div><Label>Start time</Label><Input type="time" value={f.shoot_start_time || ''} onChange={(e) => update({ shoot_start_time: e.target.value })} /></div>
              <div><Label>End time</Label><Input type="time" value={f.shoot_end_time || ''} onChange={(e) => update({ shoot_end_time: e.target.value })} /></div>
            </div>
            <Card className="p-3 bg-blue-50 text-sm">
              <strong>Estimated shoot time:</strong> {estimatedHours} hours
              <div className="text-xs text-muted-foreground mt-1">{f.num_scripts} scripts × {f.takes_per_script} takes × {f.num_actors} actor(s)</div>
            </Card>
          </TabsContent>

          <TabsContent value="budget" className="space-y-3 mt-4">
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ['estimated_actor_cost', 'Actor cost'],
                ['estimated_location_cost', 'Location cost'],
                ['estimated_crew_cost', 'Crew cost'],
                ['estimated_equipment_cost', 'Equipment cost'],
                ['estimated_travel_cost', 'Travel cost'],
              ].map(([k, l]) => (
                <div key={k}><Label>{l} ($)</Label><Input type="number" value={f[k] || 0} onChange={(e) => update({ [k]: parseFloat(e.target.value) || 0 })} /></div>
              ))}
            </div>
            <Card className="p-4 bg-emerald-50">
              <div className="text-sm text-muted-foreground">Estimated total</div>
              <div className="text-2xl font-semibold">${computeTotal().toFixed(2)}</div>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save brief'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
