import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { Sparkles, Film, Loader2, Plus, ArrowLeft, RefreshCw, Video, Mic, Music, Wand2, Download, AlertCircle, CheckCircle2, Clock, XCircle, Type, Zap, MessageSquare, DollarSign } from 'lucide-react';

const TONES = ['Urgent', 'Calm', 'Premium', 'Playful', 'Dramatic', 'Informational', 'Emotional', 'High-Energy'];
const STYLES = ['Cinematic', 'UGC-Style', 'Corporate', 'Lifestyle', 'Product-Focused', 'Abstract'];
const PLATFORMS = ['Meta Feed', 'Meta Stories/Reels', 'CTV', 'TikTok', 'YouTube Pre-Roll', 'YouTube Shorts'];

function MultiToggle({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = value.includes(opt);
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onChange(active ? value.filter(v => v !== opt) : [...value, opt])}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function aspectFromPlatforms(platforms: string[]): string {
  if (platforms.some(p => p.includes('Stories') || p === 'TikTok' || p === 'YouTube Shorts')) return '9:16';
  if (platforms.includes('CTV') || platforms.includes('YouTube Pre-Roll')) return '16:9';
  if (platforms.includes('Meta Feed')) return '1:1';
  return '9:16';
}

function ProjectListItem({ p, onOpen }: { p: any; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(p.id)}
      className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{p.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.target_length_seconds}s · {p.aspect_ratio} · {p.target_platforms?.join(', ') || 'No platform'}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">{String(p.status).replace(/_/g, ' ')}</Badge>
      </div>
    </button>
  );
}

function BriefForm({ clientId, onCreated }: { clientId: string; onCreated: (id: string) => void }) {
  const { teamMember } = useAuth();
  const [title, setTitle] = useState('');
  const [vertical, setVertical] = useState('');
  const [objective, setObjective] = useState('Conversion');
  const [audience, setAudience] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [cta, setCta] = useState('');
  const [landingUrl, setLandingUrl] = useState('');
  const [tone, setTone] = useState<string[]>([]);
  const [style, setStyle] = useState<string[]>([]);
  const [length, setLength] = useState(30);
  const [platforms, setPlatforms] = useState<string[]>(['Meta Stories/Reels']);
  const [direction, setDirection] = useState('');
  const [freeform, setFreeform] = useState('');
  const [framework, setFramework] = useState('PAS');
  const [captionStyle, setCaptionStyle] = useState('tiktok');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return toast.error('Title required');
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('ai_video_projects')
        .insert({
          client_id: clientId,
          title: title.trim(),
          vertical: vertical || null,
          objective,
          target_audience: audience || null,
          key_message: keyMessage || null,
          cta: cta || null,
          landing_page_url: landingUrl || null,
          tone_mood: tone,
          visual_style: style,
          target_length_seconds: length,
          target_platforms: platforms,
          aspect_ratio: aspectFromPlatforms(platforms),
          additional_direction: direction || null,
          freeform_brief: freeform || null,
          ad_framework: framework,
          caption_style: captionStyle,
          created_by_id: teamMember?.id ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      toast.success('Brief saved');
      onCreated(data.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New AI Video Brief</CardTitle>
        <CardDescription>Describe the ad you want. The AI Director will generate a shot list.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Ad Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Billy HVAC Emergency Repair" />
          </div>
          <div>
            <Label>Vertical</Label>
            <Input value={vertical} onChange={e => setVertical(e.target.value)} placeholder="HVAC" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Objective</Label>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Awareness">Awareness</SelectItem>
                <SelectItem value="Consideration">Consideration</SelectItem>
                <SelectItem value="Conversion">Conversion</SelectItem>
                <SelectItem value="Retargeting">Retargeting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Target Length</Label>
            <Select value={String(length)} onValueChange={v => setLength(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 sec (2 clips)</SelectItem>
                <SelectItem value="30">30 sec (4 clips)</SelectItem>
                <SelectItem value="45">45 sec (6 clips)</SelectItem>
                <SelectItem value="60">60 sec (8 clips)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Target Audience</Label>
          <Input value={audience} onChange={e => setAudience(e.target.value)} placeholder="Homeowners 30-55 with broken AC" />
        </div>
        <div>
          <Label>Key Message</Label>
          <Input value={keyMessage} onChange={e => setKeyMessage(e.target.value)} placeholder="Fast, reliable emergency HVAC repair" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>CTA</Label>
            <Input value={cta} onChange={e => setCta(e.target.value)} placeholder="Get Emergency Repair — Call Now" />
          </div>
          <div>
            <Label>Landing Page URL</Label>
            <Input value={landingUrl} onChange={e => setLandingUrl(e.target.value)} placeholder="https://billy.com/hvac" />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Tone / Mood</Label>
          <MultiToggle options={TONES} value={tone} onChange={setTone} />
        </div>
        <div>
          <Label className="mb-2 block">Visual Style</Label>
          <MultiToggle options={STYLES} value={style} onChange={setStyle} />
        </div>
        <div>
          <Label className="mb-2 block">Target Platforms</Label>
          <MultiToggle options={PLATFORMS} value={platforms} onChange={setPlatforms} />
          <p className="mt-2 text-xs text-muted-foreground">Aspect ratio will be set to <strong>{aspectFromPlatforms(platforms)}</strong>.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Ad Framework</Label>
            <Select value={framework} onValueChange={setFramework}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PAS">PAS — Problem · Agitate · Solve</SelectItem>
                <SelectItem value="AIDA">AIDA — Attention · Interest · Desire · Action</SelectItem>
                <SelectItem value="HOOK_DRIVEN">Hook-Driven (3-sec pattern interrupt)</SelectItem>
                <SelectItem value="TESTIMONIAL">Testimonial / UGC</SelectItem>
                <SelectItem value="BEFORE_AFTER">Before / After</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Caption Style</Label>
            <Select value={captionStyle} onValueChange={setCaptionStyle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tiktok">TikTok (yellow highlights, 2-word pops)</SelectItem>
                <SelectItem value="hormozi">Hormozi (yellow + green emphasis)</SelectItem>
                <SelectItem value="mrbeast">MrBeast (1-word punchy red)</SelectItem>
                <SelectItem value="editorial">Editorial (clean, full sentences)</SelectItem>
                <SelectItem value="minimal">Minimal (small, unobtrusive)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Additional Direction</Label>
          <Textarea value={direction} onChange={e => setDirection(e.target.value)} rows={3} placeholder="Anything else the AI Director should know" />
        </div>
        <div>
          <Label>Or describe the whole ad in plain English</Label>
          <Textarea value={freeform} onChange={e => setFreeform(e.target.value)} rows={4}
            placeholder="I need a 30-second Meta ad… show someone sweating, then a technician arriving, then a happy family…" />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Save Brief
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ShotListView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [generatingClip, setGeneratingClip] = useState<number | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [genVO, setGenVO] = useState(false);
  const [genMusic, setGenMusic] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['ai-video-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_video_projects').select('*').eq('id', projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: clips } = useQuery({
    queryKey: ['ai-video-clips', projectId, project?.current_version],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_video_clips').select('*')
        .eq('project_id', projectId)
        .eq('version', project?.current_version ?? 1)
        .order('clip_number');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!project,
    refetchInterval: (q) => {
      const rows: any[] = (q.state.data as any[]) ?? [];
      const anyGenerating = rows.some(r => r.status === 'generating');
      // Realtime handles most updates; keep a slow safety poll while generating.
      return (anyGenerating || generatingClip !== null || generatingAll) ? 8000 : false;
    },
  });

  // Realtime subscription — push progress updates to the cache as the edge function writes them.
  useEffect(() => {
    if (!projectId || !project?.current_version) return;
    const channel = supabase
      .channel(`ai_video_clips:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_video_clips', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          if (!row || row.version !== project.current_version) return;
          qc.setQueryData(['ai-video-clips', projectId, project.current_version], (prev: any[] = []) => {
            const next = [...prev];
            const idx = next.findIndex((c) => c.id === row.id);
            if (payload.eventType === 'DELETE') return idx >= 0 ? next.filter((_, i) => i !== idx) : next;
            if (idx >= 0) next[idx] = { ...next[idx], ...row };
            else next.push(row);
            return next.sort((a, b) => a.clip_number - b.clip_number);
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, project?.current_version, qc]);

  const { data: audio } = useQuery({
    queryKey: ['ai-video-audio', projectId, project?.current_version],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_video_audio').select('*')
        .eq('project_id', projectId)
        .eq('version', project?.current_version ?? 1)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!project,
  });

  const { data: pricing } = useQuery({
    queryKey: ['tech-pricing-ai-video'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tech_pricing')
        .select('service, model, unit, rate_per_unit_usd')
        .in('service', ['google_veo', 'elevenlabs'])
        .or('effective_to.is.null,effective_to.gt.now()');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const runDirector = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('ai-video-director', { body: { project_id: projectId } });
      if (error) throw error;
      toast.success('Shot list generated');
      qc.invalidateQueries({ queryKey: ['ai-video-project', projectId] });
    } catch (e: any) {
      toast.error(e.message || 'AI Director failed');
    } finally {
      setRunning(false);
    }
  };

  const generateClip = async (clipNumber: number) => {
    setGeneratingClip(clipNumber);
    try {
      const { error } = await supabase.functions.invoke('generate-veo-clip', {
        body: { project_id: projectId, clip_number: clipNumber },
      });
      if (error) throw error;
      toast.success(`Clip ${clipNumber} started — generating in background (~1-3 min)`);
    } catch (e: any) {
      toast.error(e.message || `Clip ${clipNumber} failed`);
    } finally {
      setGeneratingClip(null);
      qc.invalidateQueries({ queryKey: ['ai-video-clips', projectId] });
    }
  };

  const generateAllClips = async () => {
    if (!project?.shot_list) return;
    setGeneratingAll(true);
    try {
      const list: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
      // Skip clips that are already successfully generated; (re)run the rest.
      const targets = list.filter((s) => {
        const c = clipByNum.get(s.clip_number);
        return !c || c.status === 'failed' || c.status === 'pending' || !c.generated_options?.length;
      });
      if (targets.length === 0) {
        toast.info('All clips already generated. Use Regenerate on a clip to redo it.');
        return;
      }
      await Promise.all(targets.map((s) =>
        supabase.functions.invoke('generate-veo-clip', {
          body: { project_id: projectId, clip_number: s.clip_number },
        }).then(({ error }) => {
          if (error) toast.error(`Clip ${s.clip_number}: ${error.message}`);
        })
      ));
      toast.success(`Started ${targets.length} clip${targets.length > 1 ? 's' : ''} — generating in background`);
      qc.invalidateQueries({ queryKey: ['ai-video-clips', projectId] });
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setGeneratingClip(null);
      setGeneratingAll(false);
    }
  };

  const retryFailedClips = async () => {
    const failed = (clips ?? []).filter((c: any) => c.status === 'failed');
    if (failed.length === 0) {
      toast.info('No failed clips to retry');
      return;
    }
    setGeneratingAll(true);
    try {
      await Promise.all(failed.map((c: any) =>
        supabase.functions.invoke('generate-veo-clip', {
          body: { project_id: projectId, clip_number: c.clip_number },
        }).then(({ error }) => {
          if (error) toast.error(`Clip ${c.clip_number}: ${error.message}`);
        })
      ));
      toast.success(`Retrying ${failed.length} failed clip${failed.length > 1 ? 's' : ''}`);
      qc.invalidateQueries({ queryKey: ['ai-video-clips', projectId] });
    } finally {
      setGeneratingAll(false);
    }
  };

  const generateVoiceover = async () => {
    setGenVO(true);
    try {
      const { error } = await supabase.functions.invoke('generate-voiceover', {
        body: { project_id: projectId },
      });
      if (error) throw error;
      toast.success('Voiceover generated');
      qc.invalidateQueries({ queryKey: ['ai-video-audio', projectId] });
    } catch (e: any) {
      toast.error(e.message || 'Voiceover failed');
    } finally {
      setGenVO(false);
    }
  };

  const generateMusic = async () => {
    setGenMusic(true);
    try {
      const { error } = await supabase.functions.invoke('generate-music', {
        body: { project_id: projectId },
      });
      if (error) throw error;
      toast.success('Music generated');
      qc.invalidateQueries({ queryKey: ['ai-video-audio', projectId] });
    } catch (e: any) {
      toast.error(e.message || 'Music failed');
    } finally {
      setGenMusic(false);
    }
  };

  if (isLoading || !project) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const shots: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];
  const clipByNum = new Map<number, any>((clips ?? []).map((c) => [c.clip_number, c]));
  const voiceover = (audio ?? []).find((a) => a.audio_type === 'voiceover');
  const music = (audio ?? []).find((a) => a.audio_type === 'music');

  // Cost estimator — uses live rates from tech_pricing with sensible fallbacks.
  const veoRate = pricing?.find((p: any) => p.service === 'google_veo' && p.unit === 'seconds')?.rate_per_unit_usd ?? 0.40;
  const voRate = pricing?.find((p: any) => p.service === 'elevenlabs' && p.unit === 'characters')?.rate_per_unit_usd ?? 0.00015;
  const musicRate = pricing?.find((p: any) => p.service === 'elevenlabs' && p.model === 'music' && p.unit === 'seconds')?.rate_per_unit_usd ?? 0.08;

  const totalClipSeconds = shots.reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0);
  const remainingShots = shots.filter((s) => {
    const c = clipByNum.get(s.clip_number);
    return !c || c.status === 'failed' || c.status === 'pending' || !c.generated_options?.length;
  });
  const remainingSeconds = remainingShots.reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0);
  const voChars = (project.vo_script || '').length;
  const musicSeconds = project.target_length_seconds || totalClipSeconds || 0;

  const veoTotalCost = totalClipSeconds * veoRate;
  const veoRemainingCost = remainingSeconds * veoRate;
  const voCost = voChars * voRate;
  const musicCost = musicSeconds * musicRate;
  const totalProjectCost = veoTotalCost + voCost + musicCost;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
          <div>
            <h2 className="text-lg font-semibold">{project.title}</h2>
            <p className="text-xs text-muted-foreground">
              {project.target_length_seconds}s · {project.aspect_ratio} · status: {String(project.status).replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        <Button onClick={runDirector} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {shots.length > 0 ? 'Regenerate Shot List' : 'Generate Shot List'}
        </Button>
      </div>

      {shots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click <strong>Generate Shot List</strong> to have the AI Director draft your ad.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> Cost Estimate
              </CardTitle>
              <CardDescription className="text-xs">
                Estimated AI spend before you generate. Based on current pricing — actual cost may vary.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Veo video (all)</div>
                  <div className="mt-1 text-lg font-semibold">{fmt(veoTotalCost)}</div>
                  <div className="text-[11px] text-muted-foreground">{shots.length} clips · {totalClipSeconds}s @ {fmt(veoRate)}/s</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Veo (remaining)</div>
                  <div className="mt-1 text-lg font-semibold text-primary">{fmt(veoRemainingCost)}</div>
                  <div className="text-[11px] text-muted-foreground">{remainingShots.length} to generate · {remainingSeconds}s</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Voiceover</div>
                  <div className="mt-1 text-lg font-semibold">{fmt(voCost)}</div>
                  <div className="text-[11px] text-muted-foreground">{voChars.toLocaleString()} chars @ {fmt(voRate * 1000)}/1k</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Music</div>
                  <div className="mt-1 text-lg font-semibold">{fmt(musicCost)}</div>
                  <div className="text-[11px] text-muted-foreground">{musicSeconds}s @ {fmt(musicRate)}/s</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Total project (full run)</div>
                <div className="text-base font-bold">{fmt(totalProjectCost)}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Production</CardTitle>
              <CardDescription className="text-xs">Generate Veo 3.1 video clips and ElevenLabs audio for this version.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" onClick={generateAllClips} disabled={generatingAll}>
                {generatingAll
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Video className="mr-2 h-4 w-4" />}
                {generatingAll ? `Generating clip ${generatingClip ?? '…'}` : 'Generate All Clips'}
              </Button>
              <Button size="sm" variant="outline" onClick={generateVoiceover} disabled={genVO || !project.vo_script}>
                {genVO ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
                {voiceover ? 'Regenerate Voiceover' : 'Generate Voiceover'}
              </Button>
              <Button size="sm" variant="outline" onClick={generateMusic} disabled={genMusic || !project.music_prompt}>
                {genMusic ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Music className="mr-2 h-4 w-4" />}
                {music ? 'Regenerate Music' : 'Generate Music'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  if (!voiceover) await generateVoiceover();
                  if (!music && project.music_prompt) await generateMusic();
                  toast.success('Audio ready — now click Compose Final Video');
                }}
                disabled={genVO || genMusic}
              >
                {(genVO || genMusic) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
                Generate VO + Music
              </Button>
              {(clips ?? []).some((c: any) => c.status === 'failed') && (
                <Button size="sm" variant="destructive" onClick={retryFailedClips} disabled={generatingAll}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry Failed ({(clips ?? []).filter((c: any) => c.status === 'failed').length})
                </Button>
              )}
              <p className="ml-2 self-center text-xs text-muted-foreground">
                Veo clips take ~1–3 minutes each. Keep this tab open.
              </p>
            </CardContent>
          </Card>

          {/* Generation status panel */}
          {shots.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Film className="h-4 w-4" /> Generation Status
                </CardTitle>
                <CardDescription className="text-xs">
                  Live status of every clip in this version. Click a row to jump to it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const counts = { generated: 0, generating: 0, failed: 0, pending: 0 };
                  shots.forEach((s) => {
                    const c = clipByNum.get(s.clip_number);
                    const st = c?.status ?? 'pending';
                    if (st === 'generated' || st === 'approved' || st === 'selected') counts.generated++;
                    else if (st === 'generating' || st === 'regenerating') counts.generating++;
                    else if (st === 'failed') counts.failed++;
                    else counts.pending++;
                  });
                  return (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {counts.generated} ready</Badge>
                      {counts.generating > 0 && <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {counts.generating} generating</Badge>}
                      {counts.failed > 0 && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {counts.failed} failed</Badge>}
                      {counts.pending > 0 && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {counts.pending} pending</Badge>}
                    </div>
                  );
                })()}
                <div className="divide-y rounded-md border">
                  {shots.map((s) => {
                    const c = clipByNum.get(s.clip_number);
                    const st = c?.status ?? 'pending';
                    const isFailed = st === 'failed';
                    return (
                      <div key={s.clip_number} className="flex items-start justify-between gap-3 p-2 text-xs">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          {st === 'generated' || st === 'approved' || st === 'selected' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 mt-0.5" />
                          ) : st === 'generating' || st === 'regenerating' ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 mt-0.5" />
                          ) : isFailed ? (
                            <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                          ) : (
                            <Clock className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              Clip {s.clip_number} {s.label && <span className="text-muted-foreground font-normal">· {s.label}</span>}
                            </div>
                            {isFailed && (c as any)?.error_message && (
                              <div className="mt-1 text-destructive">
                                <span className="font-mono text-[10px] uppercase tracking-wide opacity-70">{(c as any).error_code}</span>
                                <div className="leading-snug">{(c as any).error_message}</div>
                              </div>
                            )}
                            {!isFailed && (st === 'generating' || st === 'regenerating') && (
                              <div className="mt-1 space-y-1">
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span className="truncate pr-2">{(c as any)?.progress_message ?? 'Working…'}</span>
                                  <span className="font-mono tabular-nums">{(c as any)?.progress_pct ?? 0}%</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full bg-primary transition-all duration-500"
                                    style={{ width: `${Math.max(2, (c as any)?.progress_pct ?? 0)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            {!isFailed && st !== 'generating' && st !== 'regenerating' && (
                              <div className="text-muted-foreground capitalize">{st.replace(/_/g, ' ')}</div>
                            )}
                          </div>
                        </div>
                        {isFailed && (
                          <Button size="sm" variant="outline" className="h-7" onClick={() => generateClip(s.clip_number)} disabled={generatingAll || generatingClip === s.clip_number}>
                            <RefreshCw className="mr-1 h-3 w-3" /> Retry
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {Array.isArray((project as any).hook_variants) && (project as any).hook_variants.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hook Variants</CardTitle>
                <CardDescription className="text-xs">Pick the cold-open angle. Regenerate clip 1 after changing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(project as any).hook_variants.map((h: any, i: number) => (
                  <button
                    key={i}
                    onClick={async () => {
                      await supabase.from('ai_video_projects').update({ selected_hook_index: i }).eq('id', projectId);
                      qc.invalidateQueries({ queryKey: ['ai-video-project', projectId] });
                      toast.success(`Hook ${i + 1} selected — regenerate clip 1`);
                    }}
                    className={`w-full rounded-md border p-3 text-left text-sm transition-colors ${
                      (project as any).selected_hook_index === i ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                    }`}
                  >
                    <Badge variant="outline" className="mr-2 capitalize">{h.angle}</Badge>
                    "{h.line}"
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {Array.isArray((project as any).characters) && (project as any).characters.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Characters</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                {(project as any).characters.map((c: any, i: number) => (
                  <div key={i} className="rounded border p-2">
                    <div className="font-semibold capitalize">{c.name}</div>
                    <div className="text-muted-foreground">{c.description}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shots.map((s, i) => {
              const c = clipByNum.get(s.clip_number);
              const opt = c?.generated_options?.[c?.selected_option_index ?? 0];
              const isGen = generatingClip === s.clip_number;
              return (
                <Card key={i}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Clip {s.clip_number} · {s.duration_seconds}s</CardTitle>
                      <div className="flex items-center gap-2">
                        {s.label && <Badge variant="secondary">{s.label}</Badge>}
                        {c?.status && (
                          <Badge variant={c.status === 'generated' || c.status === 'approved' ? 'default' : c.status === 'failed' ? 'destructive' : 'outline'}>
                            {c.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {opt?.url ? (
                      <video
                        src={opt.url}
                        controls
                        className="w-full rounded-md border bg-black"
                        style={{ aspectRatio: project.aspect_ratio?.replace(':', ' / ') ?? '9 / 16' }}
                      />
                    ) : (
                      <div
                        className="flex flex-col items-center justify-center gap-2 rounded-md border bg-muted p-4 text-xs text-muted-foreground"
                        style={{ aspectRatio: project.aspect_ratio?.replace(':', ' / ') ?? '9 / 16' }}
                      >
                        {c?.status === 'generating' || c?.status === 'regenerating' || isGen ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <div className="text-center">
                              <div className="font-medium text-foreground">{c?.progress_message ?? 'Starting…'}</div>
                              <div className="mt-1 font-mono tabular-nums">{c?.progress_pct ?? 0}%</div>
                            </div>
                            <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-background">
                              <div
                                className="h-full bg-primary transition-all duration-500"
                                style={{ width: `${Math.max(2, c?.progress_pct ?? 0)}%` }}
                              />
                            </div>
                          </>
                        ) : c?.status === 'failed' ? (
                          <div className="text-center">
                            <AlertCircle className="mx-auto h-5 w-5 text-destructive" />
                            <div className="mt-1 font-medium text-destructive">{c.error_code ?? 'Failed'}</div>
                            <div className="mt-1 leading-snug">{c.error_message}</div>
                          </div>
                        ) : 'No clip yet'}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Veo prompt</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{s.veo_prompt}</p>
                    </div>
                    {s.text_overlay && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Text overlay</div>
                        <p className="mt-1 font-medium">{s.text_overlay}</p>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Voiceover</div>
                      <p className="mt-1 italic">"{s.vo_segment}"</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {opt?.url && (c?.generated_options?.length ?? 0) > 1 && (
                        <Select
                          value={String(c.selected_option_index ?? 0)}
                          onValueChange={async (v) => {
                            await supabase.from('ai_video_clips').update({ selected_option_index: Number(v) }).eq('id', c.id);
                            qc.invalidateQueries({ queryKey: ['ai-video-clips', projectId] });
                          }}
                        >
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(c.generated_options as any[]).map((_o: any, idx: number) => (
                              <SelectItem key={idx} value={String(idx)}>Take {idx + 1}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {opt?.url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              const { error } = await supabase.functions.invoke('generate-veo-clip', {
                                body: { project_id: projectId, clip_number: s.clip_number, append_take: true },
                              });
                              if (error) throw error;
                              toast.success(`Generating another take for clip ${s.clip_number}…`);
                              qc.invalidateQueries({ queryKey: ['ai-video-clips', projectId] });
                            } catch (e: any) {
                              toast.error(e.message || 'Failed');
                            }
                          }}
                          disabled={isGen || generatingAll}
                        >
                          <Plus className="mr-2 h-4 w-4" />Try Another Take
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => generateClip(s.clip_number)} disabled={isGen || generatingAll}>
                        {isGen ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Video className="mr-2 h-4 w-4" />}
                        {opt?.url ? 'Regenerate' : 'Generate Clip'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {(voiceover || music || project.music_prompt || project.vo_script) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Audio</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {project.vo_script && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Voiceover script</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{project.vo_script}</p>
                    {voiceover?.audio_url && <audio src={voiceover.audio_url} controls className="mt-2 w-full" />}
                  </div>
                )}
                {project.music_prompt && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Music direction</div>
                    <p className="mt-1 text-sm">{project.music_prompt}</p>
                    {music?.audio_url && <audio src={music.audio_url} controls className="mt-2 w-full" />}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <CaptionSettingsCard projectId={projectId} initial={(project as any).caption_settings ?? {}} captionStyle={(project as any).caption_style ?? 'tiktok'} />

          <FinalRenderCard projectId={projectId} version={project.current_version ?? 1} />
        </>
      )}
    </div>
  );
}

function CaptionSettingsCard({ projectId, initial, captionStyle }: { projectId: string; initial: Record<string, any>; captionStyle: string }) {
  const qc = useQueryClient();
  const STYLE_DEFAULTS: Record<string, { size: number; wpc: number }> = {
    tiktok:    { size: 52, wpc: 4 },
    hormozi:   { size: 56, wpc: 4 },
    mrbeast:   { size: 60, wpc: 3 },
    editorial: { size: 38, wpc: 6 },
    minimal:   { size: 34, wpc: 7 },
  };
  const def = STYLE_DEFAULTS[captionStyle] ?? STYLE_DEFAULTS.tiktok;
  const [fontSize, setFontSize] = useState<number>(Number(initial.font_size) || def.size);
  const [wpc, setWpc] = useState<number>(Number(initial.words_per_chunk) || def.wpc);
  const [opacity, setOpacity] = useState<number>(
    Number.isFinite(Number(initial.background_opacity)) ? Number(initial.background_opacity) : 0.55
  );
  const [fade, setFade] = useState<number>(
    Number.isFinite(Number(initial.fade_duration)) ? Number(initial.fade_duration) : 0.25
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ai_video_projects')
        .update({
          caption_settings: {
            font_size: fontSize,
            words_per_chunk: wpc,
            background_opacity: opacity,
            fade_duration: fade,
          },
        })
        .eq('id', projectId);
      if (error) throw error;
      toast.success('Caption settings saved — recompose to apply');
      qc.invalidateQueries({ queryKey: ['ai-video-project', projectId] });
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setFontSize(def.size);
    setWpc(def.wpc);
    setOpacity(0.55);
    setFade(0.25);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Type className="h-4 w-4" />Caption Tuning</CardTitle>
        <CardDescription className="text-xs">
          Override the <strong className="capitalize">{captionStyle}</strong> preset. Save and recompose to apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Font size</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{fontSize}px</span>
            </div>
            <Slider min={18} max={96} step={2} value={[fontSize]} onValueChange={(v) => setFontSize(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Words per chunk</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{wpc}</span>
            </div>
            <Slider min={1} max={10} step={1} value={[wpc]} onValueChange={(v) => setWpc(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Background opacity</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider min={0} max={1} step={0.05} value={[opacity]} onValueChange={(v) => setOpacity(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Fade duration</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{fade.toFixed(2)}s</span>
            </div>
            <Slider min={0} max={1} step={0.05} value={[fade]} onValueChange={(v) => setFade(v[0])} />
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Preview</div>
          <div className="flex justify-center">
            <div
              className="rounded-xl text-white text-center"
              style={{
                backgroundColor: `rgba(0,0,0,${opacity})`,
                padding: '12px 18px',
                fontSize: `${Math.max(14, fontSize / 2.2)}px`,
                fontWeight: 800,
                lineHeight: 1.15,
                textShadow: '0 0 4px rgba(0,0,0,0.8)',
                transition: `opacity ${fade}s ease`,
              }}
            >
              {Array.from({ length: wpc }).map((_, i) => `WORD${i + 1}`).join(' ')}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>Reset</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FinalRenderCard({ projectId, version }: { projectId: string; version: number }) {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const { data: render } = useQuery({
    queryKey: ['ai-video-render', projectId, version],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_video_renders').select('*')
        .eq('project_id', projectId).eq('version', version)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const inFlight = render && !['done', 'failed'].includes(render.status);

  // Poll Shotstack status while in flight
  useEffect(() => {
    if (!render?.id || !inFlight) return;
    const tick = async () => {
      try {
        await supabase.functions.invoke('shotstack-render-status', { body: { render_id: render.id } });
      } catch {/* ignore */}
      qc.invalidateQueries({ queryKey: ['ai-video-render', projectId, version] });
    };
    const t = setInterval(tick, 5000);
    tick();
    return () => clearInterval(t);
  }, [render?.id, inFlight, projectId, version, qc]);

  const compose = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke('compose-video', { body: { project_id: projectId } });
      if (error) throw error;
      toast.success('Render submitted');
      qc.invalidateQueries({ queryKey: ['ai-video-render', projectId, version] });
    } catch (e: any) {
      toast.error(e.message || 'Compose failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Wand2 className="h-4 w-4" />Final Video</CardTitle>
        <CardDescription className="text-xs">
          Stitches all clips, voiceover, music, overlays and end card via Shotstack.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={compose} disabled={submitting || !!inFlight}>
            {submitting || inFlight
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Wand2 className="mr-2 h-4 w-4" />}
            {render?.output_url ? 'Recompose Final Video' : 'Compose Final Video'}
          </Button>
          {render && (
            <Badge variant={render.status === 'done' ? 'default' : render.status === 'failed' ? 'destructive' : 'outline'}>
              {render.status}
            </Badge>
          )}
          {render?.duration_seconds && (
            <span className="text-xs text-muted-foreground">{Number(render.duration_seconds).toFixed(1)}s</span>
          )}
        </div>

        {render?.error_message && (
          <p className="text-xs text-destructive">{render.error_message}</p>
        )}

        {render?.output_url && (
          <>
            <video src={render.output_url} controls className="w-full rounded-md border bg-black" poster={render.poster_url ?? undefined} />
            <div className="flex justify-end">
              <Button asChild size="sm" variant="outline">
                <a href={render.output_url} target="_blank" rel="noreferrer" download>
                  <Download className="mr-2 h-4 w-4" />Download MP4
                </a>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AIVideoStudioPage() {
  const { activeClient } = useClient();
  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['ai-video-projects', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('ai_video_projects').select('*').eq('client_id', activeClient.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!activeClient,
  });

  if (!activeClient) {
    return <div className="p-8 text-sm text-muted-foreground">Select a client to start a video project.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Film className="h-6 w-6 text-primary" />
            AI Video Studio
          </h1>
          <p className="text-sm text-muted-foreground">Generate complete video ads from a brief — for {activeClient.name}.</p>
        </div>
        {view === 'list' && (
          <Button onClick={() => setView('new')}><Plus className="mr-2 h-4 w-4" />New Video</Button>
        )}
      </div>

      {view === 'new' && (
        <BriefForm
          clientId={activeClient.id}
          onCreated={(id) => { setActiveProjectId(id); setView('detail'); }}
        />
      )}

      {view === 'detail' && activeProjectId && (
        <ShotListView projectId={activeProjectId} onBack={() => { setView('list'); setActiveProjectId(null); }} />
      )}

      {view === 'list' && (
        isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !projects || projects.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Film className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No video projects yet.</p>
              <Button onClick={() => setView('new')}><Plus className="mr-2 h-4 w-4" />Create your first</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <ProjectListItem key={p.id} p={p} onOpen={(id) => { setActiveProjectId(id); setView('detail'); }} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
