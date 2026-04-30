import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Save, X, Plus, Globe, Users, Target as TargetIcon, MonitorSmartphone, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

// ISO 3166-1 alpha-2 country codes accepted by Meta
const ISO2_COUNTRIES = new Set([
  'AF','AX','AL','DZ','AS','AD','AO','AI','AQ','AG','AR','AM','AW','AU','AT','AZ','BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BQ','BA','BW','BV','BR','IO','BN','BG','BF','BI','CV','KH','CM','CA','KY','CF','TD','CL','CN','CX','CC','CO','KM','CG','CD','CK','CR','CI','HR','CU','CW','CY','CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FK','FO','FJ','FI','FR','GF','PF','TF','GA','GM','GE','DE','GH','GI','GR','GL','GD','GP','GU','GT','GG','GN','GW','GY','HT','HM','VA','HN','HK','HU','IS','IN','ID','IR','IQ','IE','IM','IL','IT','JM','JP','JE','JO','KZ','KE','KI','KP','KR','KW','KG','LA','LV','LB','LS','LR','LY','LI','LT','LU','MO','MG','MW','MY','MV','ML','MT','MH','MQ','MR','MU','YT','MX','FM','MD','MC','MN','ME','MS','MA','MZ','MM','NA','NR','NP','NL','NC','NZ','NI','NE','NG','NU','NF','MK','MP','NO','OM','PK','PW','PS','PA','PG','PY','PE','PH','PN','PL','PT','PR','QA','RE','RO','RU','RW','BL','SH','KN','LC','MF','PM','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SX','SK','SI','SB','SO','ZA','GS','SS','ES','LK','SD','SR','SJ','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TK','TO','TT','TN','TR','TM','TC','TV','UG','UA','AE','GB','US','UM','UY','UZ','VU','VE','VN','VG','VI','WF','EH','YE','ZM','ZW',
]);

const META_ID_RE = /^\d{6,20}$/;
const CITY_KEY_RE = /^\d{3,12}$/;

type FieldErrors = {
  country?: string;
  city?: string;
  age?: string;
  audience?: string;
  excludedAudience?: string;
  interest?: string;
  placements?: string;
};

interface Props {
  campaign: any;
}

type Targeting = {
  geo_locations?: { countries?: string[]; regions?: { key: string }[]; cities?: { key: string; radius?: number; distance_unit?: string }[] };
  age_min?: number;
  age_max?: number;
  genders?: number[]; // 1 = male, 2 = female
  custom_audiences?: { id: string; name?: string }[];
  excluded_custom_audiences?: { id: string; name?: string }[];
  interests?: { id: string; name: string }[];
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  audience_network_positions?: string[];
  device_platforms?: string[];
  flexible_spec?: any[];
};

const PUBLISHER_PLATFORMS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'audience_network', label: 'Audience Network' },
  { id: 'messenger', label: 'Messenger' },
];

const FB_POSITIONS = ['feed', 'right_hand_column', 'video_feeds', 'story', 'instream_video', 'facebook_reels', 'marketplace', 'search'];
const IG_POSITIONS = ['stream', 'story', 'explore', 'reels', 'shop', 'profile_feed'];
const DEVICE_PLATFORMS = [
  { id: 'mobile', label: 'Mobile' },
  { id: 'desktop', label: 'Desktop' },
];

const OPTIMIZATION_GOALS = [
  'OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'POST_ENGAGEMENT',
  'LANDING_PAGE_VIEWS', 'LEAD_GENERATION', 'VIDEO_VIEWS', 'THRUPLAY', 'VALUE',
];

export function MetaTargetingTab({ campaign }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [t, setT] = useState<Targeting>(campaign.targeting_spec || {});
  const [optimizationGoal, setOptimizationGoal] = useState<string>(campaign.optimization_goal || '');
  const [billingEvent, setBillingEvent] = useState<string>(campaign.billing_event || 'IMPRESSIONS');

  // Country / city input state
  const [countryInput, setCountryInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [interestInput, setInterestInput] = useState({ id: '', name: '' });
  const [audienceInput, setAudienceInput] = useState({ id: '', name: '' });
  const [excludedAudienceInput, setExcludedAudienceInput] = useState({ id: '', name: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setT(campaign.targeting_spec || {});
    setOptimizationGoal(campaign.optimization_goal || '');
    setBillingEvent(campaign.billing_event || 'IMPRESSIONS');
    setErrors({});
  }, [campaign.id]);

  const update = (patch: Partial<Targeting>) => setT((prev) => ({ ...prev, ...patch }));
  const setError = (key: keyof FieldErrors, msg?: string) =>
    setErrors((prev) => ({ ...prev, [key]: msg }));

  const togglePlatform = (id: string) => {
    const cur = t.publisher_platforms || [];
    update({ publisher_platforms: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    setError('placements', undefined);
  };
  const togglePosition = (key: 'facebook_positions' | 'instagram_positions', pos: string) => {
    const cur = (t[key] as string[]) || [];
    update({ [key]: cur.includes(pos) ? cur.filter((x) => x !== pos) : [...cur, pos] } as Targeting);
  };
  const toggleDevice = (id: string) => {
    const cur = t.device_platforms || [];
    update({ device_platforms: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const toggleGender = (g: number) => {
    const cur = t.genders || [];
    update({ genders: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] });
  };

  const addCountry = () => {
    const code = countryInput.trim().toUpperCase();
    if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) {
      setError('country', 'Use 2 letters (e.g. US, GB, CA).');
      return;
    }
    if (!ISO2_COUNTRIES.has(code)) {
      setError('country', `${code} is not a valid ISO-3166 alpha-2 country code.`);
      return;
    }
    const cur = t.geo_locations?.countries || [];
    if (cur.includes(code)) {
      setError('country', `${code} is already added.`);
      return;
    }
    update({ geo_locations: { ...t.geo_locations, countries: [...cur, code] } });
    setCountryInput('');
    setError('country', undefined);
  };
  const removeCountry = (code: string) => {
    update({ geo_locations: { ...t.geo_locations, countries: (t.geo_locations?.countries || []).filter((c) => c !== code) } });
  };

  const addCity = () => {
    const key = cityInput.trim();
    if (!CITY_KEY_RE.test(key)) {
      setError('city', 'City key must be a numeric Meta city ID (e.g. 2418779).');
      return;
    }
    const cur = t.geo_locations?.cities || [];
    if (cur.some((c) => c.key === key)) {
      setError('city', 'City already added.');
      return;
    }
    update({ geo_locations: { ...t.geo_locations, cities: [...cur, { key, radius: 25, distance_unit: 'mile' }] } });
    setCityInput('');
    setError('city', undefined);
  };
  const removeCity = (key: string) => {
    update({ geo_locations: { ...t.geo_locations, cities: (t.geo_locations?.cities || []).filter((c) => c.key !== key) } });
  };

  const addInterest = () => {
    const id = interestInput.id.trim();
    const name = interestInput.name.trim();
    if (!META_ID_RE.test(id)) {
      setError('interest', 'Interest ID must be 6–20 digits (Meta numeric ID).');
      return;
    }
    if (!name) {
      setError('interest', 'Interest name is required for audit logging.');
      return;
    }
    if ((t.interests || []).some((i) => i.id === id)) {
      setError('interest', 'Interest already added.');
      return;
    }
    update({ interests: [...(t.interests || []), { id, name }] });
    setInterestInput({ id: '', name: '' });
    setError('interest', undefined);
  };
  const removeInterest = (id: string) => update({ interests: (t.interests || []).filter((i) => i.id !== id) });

  const addAudience = (excluded = false) => {
    const inp = excluded ? excludedAudienceInput : audienceInput;
    const id = inp.id.trim();
    const errKey = excluded ? 'excludedAudience' : 'audience';
    if (!META_ID_RE.test(id)) {
      setError(errKey, 'Audience ID must be 6–20 digits (Meta numeric ID).');
      return;
    }
    const list = excluded ? t.excluded_custom_audiences : t.custom_audiences;
    if ((list || []).some((a) => a.id === id)) {
      setError(errKey, 'Audience already added.');
      return;
    }
    if (excluded) {
      update({ excluded_custom_audiences: [...(t.excluded_custom_audiences || []), { id, name: inp.name.trim() || id }] });
      setExcludedAudienceInput({ id: '', name: '' });
    } else {
      update({ custom_audiences: [...(t.custom_audiences || []), { id, name: inp.name.trim() || id }] });
      setAudienceInput({ id: '', name: '' });
    }
    setError(errKey, undefined);
  };
  const removeAudience = (id: string, excluded = false) => {
    if (excluded) update({ excluded_custom_audiences: (t.excluded_custom_audiences || []).filter((a) => a.id !== id) });
    else update({ custom_audiences: (t.custom_audiences || []).filter((a) => a.id !== id) });
  };

  // Full pre-save validation via zod
  const targetingSchema = z
    .object({
      age_min: z.number().int().min(13).max(65).optional(),
      age_max: z.number().int().min(13).max(65).optional(),
      publisher_platforms: z.array(z.string()).optional(),
    })
    .refine((v) => !(v.age_min && v.age_max) || v.age_min <= v.age_max, {
      message: 'Age min must be ≤ age max.',
      path: ['age_max'],
    });

  const validateAll = (): boolean => {
    const next: FieldErrors = {};
    const parsed = targetingSchema.safeParse({
      age_min: t.age_min,
      age_max: t.age_max,
      publisher_platforms: t.publisher_platforms,
    });
    if (!parsed.success) {
      next.age = parsed.error.issues[0]?.message || 'Invalid age range.';
    }
    if (t.age_min !== undefined && (t.age_min < 13 || t.age_min > 65)) {
      next.age = 'Age min must be between 13 and 65.';
    }
    if (t.age_max !== undefined && (t.age_max < 13 || t.age_max > 65)) {
      next.age = 'Age max must be between 13 and 65.';
    }
    if (t.publisher_platforms && t.publisher_platforms.length === 0) {
      next.placements = 'Select at least one publisher platform, or leave unset for automatic placements.';
    }
    setErrors((prev) => ({ ...prev, ...next, country: undefined, city: undefined, audience: undefined, excludedAudience: undefined, interest: undefined }));
    return Object.values(next).every((v) => !v);
  };

  const handleSave = async () => {
    if (!validateAll()) {
      toast({ title: 'Fix validation errors', description: 'Some fields need attention before saving.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('trafficking_campaigns')
      .update({
        targeting_spec: t as any,
        optimization_goal: optimizationGoal || null,
        billing_event: billingEvent || 'IMPRESSIONS',
      })
      .eq('id', campaign.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Targeting saved', description: 'Will be used on next push to Meta.' });
      qc.invalidateQueries({ queryKey: ['trafficking_campaigns'] });
    }
  };

  const FieldError = ({ msg }: { msg?: string }) =>
    msg ? (
      <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
        <AlertCircle className="h-3 w-3" /> {msg}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm">Meta Targeting & Delivery</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Configure audience and placements. Saved values are sent to Meta on push.</p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Save className="h-3 w-3 mr-1.5" />}
          Save Targeting
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Geo */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Geographic Targeting</h3>
          </div>
          <div>
            <Label className="text-xs">Countries (ISO-2)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={countryInput}
                onChange={(e) => { setCountryInput(e.target.value); setError('country', undefined); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCountry())}
                placeholder="US"
                className={`h-8 max-w-[120px] ${errors.country ? 'border-destructive' : ''}`}
                maxLength={2}
                aria-invalid={!!errors.country}
              />
              <Button size="sm" variant="outline" onClick={addCountry}><Plus className="h-3 w-3 mr-1" /> Add</Button>
            </div>
            <FieldError msg={errors.country} />
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.geo_locations?.countries || []).map((c) => (
                <Badge key={c} variant="secondary" className="text-xs gap-1">
                  {c}
                  <button onClick={() => removeCountry(c)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
              {!(t.geo_locations?.countries?.length) && <p className="text-xs text-muted-foreground">No countries — defaults to US on push.</p>}
            </div>
          </div>
          <div>
            <Label className="text-xs">Cities (Meta city key, e.g. <code>2418779</code> for NYC)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={cityInput}
                onChange={(e) => { setCityInput(e.target.value); setError('city', undefined); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCity())}
                placeholder="Meta city key"
                className={`h-8 max-w-[200px] ${errors.city ? 'border-destructive' : ''}`}
                aria-invalid={!!errors.city}
              />
              <Button size="sm" variant="outline" onClick={addCity}><Plus className="h-3 w-3 mr-1" /> Add</Button>
            </div>
            <FieldError msg={errors.city} />
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.geo_locations?.cities || []).map((c) => (
                <Badge key={c.key} variant="secondary" className="text-xs gap-1">
                  City {c.key} • {c.radius}{c.distance_unit?.[0]}
                  <button onClick={() => removeCity(c.key)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>
        </section>

        <Separator />

        {/* Demographics */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Demographics</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Age Min</Label>
              <Input
                type="number"
                min={13}
                max={65}
                value={t.age_min ?? ''}
                onChange={(e) => { update({ age_min: e.target.value ? Number(e.target.value) : undefined }); setError('age', undefined); }}
                className={`h-8 ${errors.age ? 'border-destructive' : ''}`}
                aria-invalid={!!errors.age}
              />
            </div>
            <div>
              <Label className="text-xs">Age Max</Label>
              <Input
                type="number"
                min={13}
                max={65}
                value={t.age_max ?? ''}
                onChange={(e) => { update({ age_max: e.target.value ? Number(e.target.value) : undefined }); setError('age', undefined); }}
                className={`h-8 ${errors.age ? 'border-destructive' : ''}`}
                aria-invalid={!!errors.age}
              />
            </div>
            <div>
              <Label className="text-xs">Genders</Label>
              <div className="flex gap-2 mt-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={(t.genders || []).includes(1)} onCheckedChange={() => toggleGender(1)} /> Male
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={(t.genders || []).includes(2)} onCheckedChange={() => toggleGender(2)} /> Female
                </label>
              </div>
            </div>
          </div>
          <FieldError msg={errors.age} />
        </section>

        <Separator />

        {/* Custom Audiences */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <TargetIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Custom Audiences & Lookalikes</h3>
          </div>
          <div>
            <Label className="text-xs">Include audience (paste Meta audience ID)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={audienceInput.id} onChange={(e) => setAudienceInput((p) => ({ ...p, id: e.target.value }))} placeholder="120000000000000" className="h-8 max-w-[200px]" />
              <Input value={audienceInput.name} onChange={(e) => setAudienceInput((p) => ({ ...p, name: e.target.value }))} placeholder="Label (optional)" className="h-8 flex-1" />
              <Button size="sm" variant="outline" onClick={() => addAudience(false)}><Plus className="h-3 w-3 mr-1" /> Include</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.custom_audiences || []).map((a) => (
                <Badge key={a.id} className="text-xs gap-1">
                  {a.name || a.id}
                  <button onClick={() => removeAudience(a.id, false)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Exclude audience</Label>
            <div className="flex gap-2 mt-1">
              <Input value={excludedAudienceInput.id} onChange={(e) => setExcludedAudienceInput((p) => ({ ...p, id: e.target.value }))} placeholder="120000000000000" className="h-8 max-w-[200px]" />
              <Input value={excludedAudienceInput.name} onChange={(e) => setExcludedAudienceInput((p) => ({ ...p, name: e.target.value }))} placeholder="Label (optional)" className="h-8 flex-1" />
              <Button size="sm" variant="outline" onClick={() => addAudience(true)}><Plus className="h-3 w-3 mr-1" /> Exclude</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.excluded_custom_audiences || []).map((a) => (
                <Badge key={a.id} variant="destructive" className="text-xs gap-1">
                  {a.name || a.id}
                  <button onClick={() => removeAudience(a.id, true)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Detailed Interests (Meta interest ID + name)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={interestInput.id} onChange={(e) => setInterestInput((p) => ({ ...p, id: e.target.value }))} placeholder="6003107902433" className="h-8 max-w-[180px]" />
              <Input value={interestInput.name} onChange={(e) => setInterestInput((p) => ({ ...p, name: e.target.value }))} placeholder="Interest name" className="h-8 flex-1" />
              <Button size="sm" variant="outline" onClick={addInterest}><Plus className="h-3 w-3 mr-1" /> Add</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(t.interests || []).map((i) => (
                <Badge key={i.id} variant="outline" className="text-xs gap-1">
                  {i.name}
                  <button onClick={() => removeInterest(i.id)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Tip: find interest IDs via Meta's Targeting Search API or Ads Manager URL.</p>
          </div>
        </section>

        <Separator />

        {/* Placements */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Placements</h3>
          </div>
          <div>
            <Label className="text-xs">Publisher Platforms</Label>
            <div className="flex flex-wrap gap-3 mt-2">
              {PUBLISHER_PLATFORMS.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={(t.publisher_platforms || []).includes(p.id)} onCheckedChange={() => togglePlatform(p.id)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          {(t.publisher_platforms || []).includes('facebook') && (
            <div>
              <Label className="text-xs">Facebook Positions</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {FB_POSITIONS.map((pos) => (
                  <label key={pos} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(t.facebook_positions || []).includes(pos)} onCheckedChange={() => togglePosition('facebook_positions', pos)} />
                    {pos}
                  </label>
                ))}
              </div>
            </div>
          )}
          {(t.publisher_platforms || []).includes('instagram') && (
            <div>
              <Label className="text-xs">Instagram Positions</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {IG_POSITIONS.map((pos) => (
                  <label key={pos} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(t.instagram_positions || []).includes(pos)} onCheckedChange={() => togglePosition('instagram_positions', pos)} />
                    {pos}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs">Devices</Label>
            <div className="flex gap-3 mt-2">
              {DEVICE_PLATFORMS.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={(t.device_platforms || []).includes(d.id)} onCheckedChange={() => toggleDevice(d.id)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <Separator />

        {/* Delivery */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Delivery & Optimization</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Optimization Goal</Label>
              <Select value={optimizationGoal} onValueChange={setOptimizationGoal}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Auto from objective" /></SelectTrigger>
                <SelectContent>
                  {OPTIMIZATION_GOALS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Billing Event</Label>
              <Select value={billingEvent} onValueChange={setBillingEvent}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IMPRESSIONS">Impressions</SelectItem>
                  <SelectItem value="LINK_CLICKS">Link Clicks</SelectItem>
                  <SelectItem value="THRUPLAY">ThruPlay (video)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
