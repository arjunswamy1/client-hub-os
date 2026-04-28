import { useState, useMemo } from 'react';
import { useShootLocations, useUpsertLocation, useDeleteLocation } from '@/hooks/useShootLocations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, MapPin, Trash2, Pencil, Upload, Loader2 } from 'lucide-react';
import { VERTICAL_OPTIONS, type ShootLocation } from '@/types/production';

const LOCATION_TYPES = [
  { value: 'studio', label: 'Studio' },
  { value: 'residential_interior', label: 'Residential Interior' },
  { value: 'residential_exterior', label: 'Residential Exterior' },
  { value: 'outdoor_public', label: 'Outdoor / Public' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'airbnb', label: 'Airbnb / Rental' },
];

export function LocationsDatabase() {
  const { data: locations = [], isLoading } = useShootLocations();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('all');
  const [vertical, setVertical] = useState('all');
  const [editing, setEditing] = useState<ShootLocation | null>(null);
  const [open, setOpen] = useState(false);
  const deleteLocation = useDeleteLocation();

  const cities = useMemo(() => Array.from(new Set(locations.map((l) => l.city))).sort(), [locations]);
  const filtered = locations.filter((l) =>
    (search === '' || l.name.toLowerCase().includes(search.toLowerCase())) &&
    (city === 'all' || l.city === city) &&
    (vertical === 'all' || l.good_for_verticals.includes(vertical))
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Locations</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} of {locations.length}</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-2" />Add location</Button>
      </div>

      <Card className="p-4 grid sm:grid-cols-3 gap-2">
        <Input placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={city} onValueChange={setCity}><SelectTrigger><SelectValue placeholder="City" /></SelectTrigger><SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
        <Select value={vertical} onValueChange={setVertical}><SelectTrigger><SelectValue placeholder="Good for" /></SelectTrigger><SelectContent><SelectItem value="all">All verticals</SelectItem>{VERTICAL_OPTIONS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No locations yet. Add your first one.</Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((loc) => (
            <Card key={loc.id} className="overflow-hidden">
              {loc.photos[0] ? (
                <img src={loc.photos[0].url} alt="" className="w-full h-40 object-cover" />
              ) : (
                <div className="w-full h-40 bg-slate-100 flex items-center justify-center"><MapPin className="h-10 w-10 text-muted-foreground" /></div>
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{loc.name}</div>
                    <div className="text-xs text-muted-foreground">{loc.city}{loc.location_type ? ` · ${loc.location_type.replace('_', ' ')}` : ''}</div>
                  </div>
                  <Badge variant={loc.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{loc.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {loc.good_for_verticals.slice(0, 4).map((v) => <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {loc.cost_type === 'free' ? 'Free' : loc.cost_type ? `$${loc.cost_amount} ${loc.cost_type}` : '—'}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(loc); setOpen(true); }}><Pencil className="h-3 w-3 mr-1" />Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete this location?')) deleteLocation.mutate(loc.id); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <LocationDialog open={open} onOpenChange={setOpen} location={editing} />
    </div>
  );
}

function LocationDialog({ open, onOpenChange, location }: { open: boolean; onOpenChange: (o: boolean) => void; location: ShootLocation | null }) {
  const upsert = useUpsertLocation();
  const [uploading, setUploading] = useState(false);
  const blank = {
    name: '', address: '', city: 'Chicago', location_type: 'residential_interior',
    good_for_verticals: [] as string[], cost_type: 'free' as const, cost_amount: 0,
    photos: [] as { url: string }[], contact_name: '', contact_phone: '', contact_email: '',
    availability_notes: '', producer_notes: '', status: 'active' as const,
  };
  const [f, setF] = useState<any>(location || blank);

  // Reset on dialog open
  useMemo(() => { setF(location || blank); }, [location, open]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `locations/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('talent-photos').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('talent-photos').getPublicUrl(path);
      setF({ ...f, photos: [...(f.photos || []), { url: data.publicUrl }] });
    } catch (e: any) { toast.error(e.message); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!f.name || !f.city) { toast.error('Name and city required'); return; }
    try {
      await upsert.mutateAsync(f);
      toast.success('Saved');
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleVertical = (v: string) => setF({
    ...f,
    good_for_verticals: f.good_for_verticals.includes(v)
      ? f.good_for_verticals.filter((x: string) => x !== v)
      : [...f.good_for_verticals, v],
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{location ? 'Edit location' : 'Add location'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Name *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><Label>City *</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
          </div>
          <div><Label>Address</Label><Input value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={f.location_type || ''} onValueChange={(v) => setF({ ...f, location_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LOCATION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                  <SelectItem value="needs_rescouting">Needs re-scouting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Good for verticals</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {VERTICAL_OPTIONS.map((v) => (
                <label key={v} className="flex items-center gap-1 text-xs cursor-pointer">
                  <Checkbox checked={f.good_for_verticals.includes(v)} onCheckedChange={() => toggleVertical(v)} />{v}
                </label>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Cost type</Label>
              <Select value={f.cost_type || ''} onValueChange={(v) => setF({ ...f, cost_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="flat">Flat fee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Amount ($)</Label><Input type="number" value={f.cost_amount || 0} onChange={(e) => setF({ ...f, cost_amount: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div>
            <Label>Photos</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(f.photos || []).map((p: any, i: number) => (
                <div key={i} className="relative">
                  <img src={p.url} alt="" className="w-20 h-20 rounded object-cover border" />
                  <button type="button" onClick={() => setF({ ...f, photos: f.photos.filter((_: any, x: number) => x !== i) })} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-5 h-5 text-xs">×</button>
                </div>
              ))}
              <label className="w-20 h-20 rounded border-2 border-dashed flex items-center justify-center cursor-pointer text-muted-foreground hover:bg-slate-50">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><Label>Contact name</Label><Input value={f.contact_name || ''} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={f.contact_phone || ''} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={f.contact_email || ''} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></div>
          </div>
          <div><Label>Availability notes</Label><Textarea rows={2} value={f.availability_notes || ''} onChange={(e) => setF({ ...f, availability_notes: e.target.value })} /></div>
          <div><Label>Producer notes</Label><Textarea rows={2} value={f.producer_notes || ''} onChange={(e) => setF({ ...f, producer_notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={upsert.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
