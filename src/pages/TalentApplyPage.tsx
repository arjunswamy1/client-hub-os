import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Camera, Upload } from 'lucide-react';
import { SPECIALTY_OPTIONS, AGE_RANGE_OPTIONS, DAYS, TIME_SLOTS } from '@/types/production';

const CITIES = ['Chicago', 'New York', 'Los Angeles', 'Miami', 'Atlanta', 'Other'];
const LANGUAGES = ['English', 'Spanish', 'Other'];

export default function TalentApplyPage() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState<'headshot' | 'additional' | null>(null);

  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', instagram_handle: '',
    city: 'Chicago', city_other: '',
    headshot_url: '', additional_photos: [] as { url: string }[],
    demo_reel_url: '',
    experience_level: '' as '' | 'professional' | 'comedy_improv' | 'content_creator' | 'natural',
    specialties: [] as string[],
    languages: ['english'] as string[],
    age_range_appearance: '',
    gender: '',
    weekly_availability: {} as Record<string, string[]>,
    has_transportation: false,
    travel_radius_miles: '',
    bio: '',
    source: '',
    source_other: '',
  });

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const toggleArr = (key: 'specialties' | 'languages', value: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));
  };

  const toggleAvail = (day: string, slot: string) => {
    setForm((f) => {
      const cur = f.weekly_availability[day] || [];
      const next = cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot];
      return { ...f, weekly_availability: { ...f.weekly_availability, [day]: next } };
    });
  };

  const uploadFile = async (file: File, kind: 'headshot' | 'additional') => {
    setUploading(kind);
    try {
      const ext = file.name.split('.').pop();
      const path = `applicants/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('talent-photos').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('talent-photos').getPublicUrl(path);
      if (kind === 'headshot') update({ headshot_url: data.publicUrl });
      else update({ additional_photos: [...form.additional_photos, { url: data.publicUrl }] });
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name || !form.email || !form.phone || !form.instagram_handle) {
      toast.error('Please fill out the required fields'); return;
    }
    if (!form.headshot_url) { toast.error('A headshot photo is required'); return; }
    if (!form.experience_level) { toast.error('Please select your experience level'); return; }
    if (!form.age_range_appearance) { toast.error('Please select an age range'); return; }
    if (!form.gender) { toast.error('Please select your gender'); return; }

    setSubmitting(true);
    try {
      const city = form.city === 'Other' ? form.city_other : form.city;
      const source = form.source === 'other' ? form.source_other : form.source;
      const { error } = await supabase.from('talent_actors').insert({
        full_name: form.full_name,
        email: form.email.toLowerCase().trim(),
        phone: form.phone,
        instagram_handle: form.instagram_handle.replace(/^@/, ''),
        city: city || 'Chicago',
        headshot_url: form.headshot_url,
        additional_photos: form.additional_photos as any,
        demo_reel_url: form.demo_reel_url || null,
        experience_level: form.experience_level,
        specialties: form.specialties,
        languages: form.languages,
        age_range_appearance: form.age_range_appearance,
        gender: form.gender,
        weekly_availability: form.weekly_availability as any,
        has_transportation: form.has_transportation,
        travel_radius_miles: form.travel_radius_miles ? parseInt(form.travel_radius_miles) : null,
        bio: form.bio || null,
        source: source || null,
        status: 'new',
      } as any);
      if (error) throw error;
      setSubmitted(true);
    } catch (e: any) {
      toast.error(e.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md p-10 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-2">Application received!</h1>
          <p className="text-muted-foreground">
            Thanks for applying. We'll reach out when we have work that fits your profile.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Talent Application</h1>
          <p className="text-muted-foreground mt-2">
            Apply to be cast in upcoming Connect Paid Media productions.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Contact info</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label>Full name *</Label><Input value={form.full_name} onChange={(e) => update({ full_name: e.target.value })} required /></div>
              <div><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => update({ email: e.target.value })} required /></div>
              <div><Label>Phone *</Label><Input type="tel" value={form.phone} onChange={(e) => update({ phone: e.target.value })} required /></div>
              <div><Label>Instagram handle *</Label><Input placeholder="@yourhandle" value={form.instagram_handle} onChange={(e) => update({ instagram_handle: e.target.value })} required /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>City *</Label>
                <Select value={form.city} onValueChange={(v) => update({ city: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.city === 'Other' && (
                <div><Label>City name</Label><Input value={form.city_other} onChange={(e) => update({ city_other: e.target.value })} /></div>
              )}
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Photos & reel</h2>
            <div>
              <Label>Headshot * <span className="text-muted-foreground font-normal">(required)</span></Label>
              <div className="mt-2 flex items-center gap-4">
                {form.headshot_url ? (
                  <img src={form.headshot_url} alt="headshot" className="w-24 h-24 rounded-md object-cover border" />
                ) : (
                  <div className="w-24 h-24 rounded-md border-2 border-dashed flex items-center justify-center text-muted-foreground">
                    <Camera className="h-6 w-6" />
                  </div>
                )}
                <label className="cursor-pointer">
                  <Button type="button" variant="outline" disabled={uploading === 'headshot'} asChild>
                    <span>{uploading === 'headshot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4 mr-2" />{form.headshot_url ? 'Replace' : 'Upload'}</>}</span>
                  </Button>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], 'headshot')} />
                </label>
              </div>
            </div>
            <div>
              <Label>Additional photos (optional, different looks)</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {form.additional_photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.url} alt="" className="w-20 h-20 rounded object-cover border" />
                    <button type="button" onClick={() => update({ additional_photos: form.additional_photos.filter((_, x) => x !== i) })} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-5 h-5 text-xs">×</button>
                  </div>
                ))}
                <label className="w-20 h-20 rounded border-2 border-dashed flex items-center justify-center cursor-pointer text-muted-foreground hover:bg-slate-50">
                  {uploading === 'additional' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], 'additional')} />
                </label>
              </div>
            </div>
            <div><Label>Demo reel URL (optional)</Label><Input placeholder="https://..." value={form.demo_reel_url} onChange={(e) => update({ demo_reel_url: e.target.value })} /></div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Experience</h2>
            <div>
              <Label>Experience level *</Label>
              <Select value={form.experience_level} onValueChange={(v: any) => update({ experience_level: v })}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional Actor</SelectItem>
                  <SelectItem value="comedy_improv">Comedy / Improv</SelectItem>
                  <SelectItem value="content_creator">Content Creator</SelectItem>
                  <SelectItem value="natural">No Experience (Natural Talent)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Specialties (select all that apply)</Label>
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                {SPECIALTY_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.specialties.includes(s.value)} onCheckedChange={() => toggleArr('specialties', s.value)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Languages</Label>
              <div className="flex gap-4 mt-2">
                {LANGUAGES.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.languages.includes(l.toLowerCase())} onCheckedChange={() => toggleArr('languages', l.toLowerCase())} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Appearance</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Age range you appear *</Label>
                <Select value={form.age_range_appearance} onValueChange={(v) => update({ age_range_appearance: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{AGE_RANGE_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Gender *</Label>
                <Select value={form.gender} onValueChange={(v) => update({ gender: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Weekly availability</h2>
            <p className="text-xs text-muted-foreground">Check the times you're typically available.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr><th></th>{TIME_SLOTS.map((s) => <th key={s} className="text-xs font-medium text-muted-foreground capitalize px-2 py-1">{s}</th>)}</tr>
                </thead>
                <tbody>
                  {DAYS.map((d) => (
                    <tr key={d}>
                      <td className="text-xs font-medium uppercase pr-2 py-1">{d}</td>
                      {TIME_SLOTS.map((s) => (
                        <td key={s} className="px-2 py-1 text-center">
                          <Checkbox checked={form.weekly_availability[d]?.includes(s) || false} onCheckedChange={() => toggleAvail(d, s)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold">Other</h2>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.has_transportation} onCheckedChange={(v) => update({ has_transportation: !!v })} id="trans" />
              <Label htmlFor="trans" className="cursor-pointer">I have my own transportation</Label>
            </div>
            <div><Label>Willing to travel within (miles, optional)</Label><Input type="number" value={form.travel_radius_miles} onChange={(e) => update({ travel_radius_miles: e.target.value })} /></div>
            <div><Label>Short bio</Label><Textarea rows={3} value={form.bio} onChange={(e) => update({ bio: e.target.value })} /></div>
            <div>
              <Label>How did you hear about us?</Label>
              <Select value={form.source} onValueChange={(v) => update({ source: v })}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.source === 'other' && (
              <div><Label>Tell us more</Label><Input value={form.source_other} onChange={(e) => update({ source_other: e.target.value })} /></div>
            )}
          </Card>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit application
          </Button>
        </form>
      </div>
    </div>
  );
}
