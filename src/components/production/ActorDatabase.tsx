import { useState, useMemo } from 'react';
import { useTalentActors, useUpdateActor } from '@/hooks/useTalentActors';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, ExternalLink, Search, Copy, Camera } from 'lucide-react';
import { SPECIALTY_OPTIONS, AGE_RANGE_OPTIONS, type ActorStatus, type TalentActor } from '@/types/production';
import { toast } from 'sonner';

const STATUS_COLORS: Record<ActorStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  active: 'bg-violet-100 text-violet-700',
  inactive: 'bg-slate-100 text-slate-500',
};

export function ActorDatabase() {
  const { data: actors = [], isLoading } = useTalentActors();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [experience, setExperience] = useState<string>('all');
  const [specialty, setSpecialty] = useState<string>('all');
  const [gender, setGender] = useState<string>('all');
  const [ageRange, setAgeRange] = useState<string>('all');
  const [selected, setSelected] = useState<TalentActor | null>(null);

  const cities = useMemo(() => Array.from(new Set(actors.map((a) => a.city))).sort(), [actors]);

  const filtered = useMemo(() => {
    return actors.filter((a) => {
      if (search && !`${a.full_name} ${a.email} ${a.instagram_handle || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (city !== 'all' && a.city !== city) return false;
      if (status !== 'all' && a.status !== status) return false;
      if (experience !== 'all' && a.experience_level !== experience) return false;
      if (specialty !== 'all' && !a.specialties.includes(specialty)) return false;
      if (gender !== 'all' && a.gender !== gender) return false;
      if (ageRange !== 'all' && a.age_range_appearance !== ageRange) return false;
      return true;
    });
  }, [actors, search, city, status, experience, specialty, gender, ageRange]);

  const copyApplyLink = () => {
    const url = `${window.location.origin}/talent-apply`;
    navigator.clipboard.writeText(url);
    toast.success('Application link copied');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Actor Database</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} of {actors.length} actors</p>
        </div>
        <Button onClick={copyApplyLink} variant="outline"><Copy className="h-4 w-4 mr-2" />Copy intake link</Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, email, IG handle..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Select value={city} onValueChange={setCity}><SelectTrigger><SelectValue placeholder="City" /></SelectTrigger><SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent>{['all', 'new', 'reviewed', 'approved', 'active', 'inactive'].map((s) => <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>)}</SelectContent></Select>
          <Select value={experience} onValueChange={setExperience}><SelectTrigger><SelectValue placeholder="Experience" /></SelectTrigger><SelectContent><SelectItem value="all">All experience</SelectItem><SelectItem value="professional">Professional</SelectItem><SelectItem value="comedy_improv">Comedy/Improv</SelectItem><SelectItem value="content_creator">Content Creator</SelectItem><SelectItem value="natural">Natural</SelectItem></SelectContent></Select>
          <Select value={specialty} onValueChange={setSpecialty}><SelectTrigger><SelectValue placeholder="Specialty" /></SelectTrigger><SelectContent><SelectItem value="all">All specialties</SelectItem>{SPECIALTY_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select>
          <Select value={gender} onValueChange={setGender}><SelectTrigger><SelectValue placeholder="Gender" /></SelectTrigger><SelectContent><SelectItem value="all">All genders</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="non_binary">Non-binary</SelectItem></SelectContent></Select>
          <Select value={ageRange} onValueChange={setAgeRange}><SelectTrigger><SelectValue placeholder="Age" /></SelectTrigger><SelectContent><SelectItem value="all">All ages</SelectItem>{AGE_RANGE_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading actors...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No actors match your filters.</Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((a) => (
            <Card key={a.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => setSelected(a)}>
              <div className="flex gap-3">
                {a.headshot_url ? (
                  <img src={a.headshot_url} alt={a.full_name} className="w-16 h-16 rounded-md object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-slate-100 flex items-center justify-center"><Camera className="h-6 w-6 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium truncate">{a.full_name}</div>
                    <Badge className={STATUS_COLORS[a.status]} variant="secondary">{a.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{a.city}{a.age_range_appearance ? ` · ${a.age_range_appearance}` : ''}</div>
                  {a.producer_rating && (
                    <div className="flex items-center gap-0.5 mt-1">
                      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-3 w-3 ${n <= (a.producer_rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {a.specialties.slice(0, 3).map((s) => <Badge key={s} variant="outline" className="text-[10px]">{s.replace('_', ' ')}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground mt-2">{a.total_shoots} shoot{a.total_shoots !== 1 ? 's' : ''}</div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selected && <ActorDetail actor={selected} onUpdate={(u) => setSelected({ ...selected, ...u })} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActorDetail({ actor, onUpdate }: { actor: TalentActor; onUpdate: (u: Partial<TalentActor>) => void }) {
  const updateActor = useUpdateActor();
  const [notes, setNotes] = useState(actor.producer_notes || '');
  const [rating, setRating] = useState(actor.producer_rating || 0);
  const [status, setStatus] = useState<ActorStatus>(actor.status);

  const save = async () => {
    await updateActor.mutateAsync({ id: actor.id, updates: { producer_notes: notes, producer_rating: rating || null, status } });
    onUpdate({ producer_notes: notes, producer_rating: rating || null, status });
    toast.success('Saved');
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{actor.full_name}</SheetTitle>
      </SheetHeader>
      <div className="space-y-5 mt-4">
        {actor.headshot_url && <img src={actor.headshot_url} alt="" className="w-full max-h-80 object-cover rounded-md" />}
        {actor.additional_photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {actor.additional_photos.map((p, i) => <img key={i} src={p.url} alt="" className="aspect-square object-cover rounded" />)}
          </div>
        )}
        <Card className="p-4 space-y-2 text-sm">
          <div><span className="text-muted-foreground">Email:</span> {actor.email}</div>
          <div><span className="text-muted-foreground">Phone:</span> {actor.phone}</div>
          {actor.instagram_handle && (
            <div><span className="text-muted-foreground">Instagram:</span>{' '}
              <a className="text-primary inline-flex items-center gap-1" href={`https://instagram.com/${actor.instagram_handle}`} target="_blank" rel="noreferrer">
                @{actor.instagram_handle}<ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div><span className="text-muted-foreground">City:</span> {actor.city}</div>
          <div><span className="text-muted-foreground">Age range:</span> {actor.age_range_appearance}</div>
          <div><span className="text-muted-foreground">Gender:</span> {actor.gender}</div>
          <div><span className="text-muted-foreground">Experience:</span> {actor.experience_level}</div>
          <div><span className="text-muted-foreground">Languages:</span> {actor.languages.join(', ')}</div>
          <div><span className="text-muted-foreground">Transportation:</span> {actor.has_transportation ? 'Yes' : 'No'}</div>
          {actor.demo_reel_url && (
            <div><a className="text-primary inline-flex items-center gap-1" href={actor.demo_reel_url} target="_blank" rel="noreferrer">Demo reel<ExternalLink className="h-3 w-3" /></a></div>
          )}
        </Card>

        {actor.specialties.length > 0 && (
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Specialties</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {actor.specialties.map((s) => <Badge key={s} variant="secondary">{s.replace('_', ' ')}</Badge>)}
            </div>
          </div>
        )}

        {Object.keys(actor.weekly_availability || {}).length > 0 && (
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Availability</Label>
            <div className="text-sm mt-1 space-y-0.5">
              {Object.entries(actor.weekly_availability).map(([d, slots]) => (
                <div key={d}><span className="font-medium uppercase">{d}:</span> {(slots as string[]).join(', ')}</div>
              ))}
            </div>
          </div>
        )}

        {actor.bio && <div><Label className="text-xs uppercase text-muted-foreground">Bio</Label><p className="text-sm mt-1">{actor.bio}</p></div>}

        <Card className="p-4 space-y-3">
          <h4 className="font-medium text-sm">Internal</h4>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v: ActorStatus) => setStatus(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['new', 'reviewed', 'approved', 'active', 'inactive'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Producer rating</Label>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n === rating ? 0 : n)}>
                  <Star className={`h-6 w-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Producer notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="text-xs text-muted-foreground">Total shoots: {actor.total_shoots}{actor.last_shoot_date ? ` · last ${actor.last_shoot_date}` : ''}</div>
          <Button onClick={save} disabled={updateActor.isPending} className="w-full">Save</Button>
        </Card>
      </div>
    </>
  );
}
