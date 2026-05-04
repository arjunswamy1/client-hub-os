import { useState } from 'react';
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
import { Sparkles, Film, Loader2, Plus, ArrowLeft, RefreshCw } from 'lucide-react';

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
  const { data: project, isLoading } = useQuery({
    queryKey: ['ai-video-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_video_projects').select('*').eq('id', projectId).single();
      if (error) throw error;
      return data;
    },
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

  if (isLoading || !project) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const shots: any[] = Array.isArray(project.shot_list) ? project.shot_list : [];

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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shots.map((s, i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Clip {s.clip_number} · {s.duration_seconds}s</CardTitle>
                    {s.label && <Badge variant="secondary">{s.label}</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
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
                </CardContent>
              </Card>
            ))}
          </div>

          {project.music_prompt && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Music Direction</CardTitle></CardHeader>
              <CardContent><p className="text-sm">{project.music_prompt}</p></CardContent>
            </Card>
          )}
          {project.vo_script && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Full VO Script</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm">{project.vo_script}</p></CardContent>
            </Card>
          )}

          <Card className="border-dashed">
            <CardContent className="py-4 text-center text-xs text-muted-foreground">
              Next phase: clip generation (Veo 3.1), voiceover (ElevenLabs), music, and final composition (Shotstack).
            </CardContent>
          </Card>
        </>
      )}
    </div>
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
