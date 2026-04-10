import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface VideoScript {
  id: string;
  title: string;
  platform: string;
  duration: string;
  script_text: string;
  enhanced_text?: string;
}

interface Props {
  scripts: VideoScript[];
  onChange: (scripts: VideoScript[]) => void;
  objective?: string;
  targetAudience?: string;
  toneStyle?: string;
}

const DURATION_OPTIONS = [
  { value: '6s', label: '6s (Bumper)' },
  { value: '15s', label: '15s' },
  { value: '30s', label: '30s' },
  { value: '60s', label: '60s' },
  { value: '90s', label: '90s' },
  { value: '2min', label: '2 min' },
];

const PLATFORM_OPTIONS = [
  { value: 'meta', label: 'Meta (FB/IG)' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'google_display', label: 'Google Display' },
  { value: 'other', label: 'Other' },
];

export function VideoScriptEditor({ scripts, onChange, objective, targetAudience, toneStyle }: Props) {
  const [enhancingId, setEnhancingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addScript = () => {
    const newScript: VideoScript = {
      id: crypto.randomUUID(),
      title: `Script ${String.fromCharCode(65 + scripts.length)}`,
      platform: 'meta',
      duration: '15s',
      script_text: '',
    };
    onChange([...scripts, newScript]);
    setExpandedId(newScript.id);
  };

  const updateScript = (id: string, field: keyof VideoScript, value: string) => {
    onChange(scripts.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeScript = (id: string) => {
    onChange(scripts.filter(s => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const enhanceWithAI = async (script: VideoScript) => {
    if (!script.script_text.trim()) {
      toast.error('Write a script first before enhancing');
      return;
    }
    setEnhancingId(script.id);
    try {
      const { data, error } = await supabase.functions.invoke('enhance-script', {
        body: {
          script: script.script_text,
          platform: script.platform,
          duration: script.duration,
          objective,
          target_audience: targetAudience,
          tone_style: toneStyle,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      onChange(scripts.map(s => s.id === script.id ? { ...s, enhanced_text: data.enhanced_script } : s));
      toast.success('Script enhanced!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to enhance script');
    } finally {
      setEnhancingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>Video Scripts</Label>
          <p className="text-xs text-muted-foreground">Optional — add scripts for each video needed</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addScript}>
          <Plus className="h-3 w-3 mr-1" /> Add Script
        </Button>
      </div>

      {scripts.map((script) => (
        <div key={script.id} className="rounded-lg border bg-card">
          {/* Collapsed header */}
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 text-left hover:bg-accent/50 transition-colors"
            onClick={() => setExpandedId(expandedId === script.id ? null : script.id)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{script.title || 'Untitled Script'}</span>
              <Badge variant="outline" className="text-[10px]">
                {PLATFORM_OPTIONS.find(p => p.value === script.platform)?.label || script.platform}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{script.duration}</Badge>
              {script.enhanced_text && (
                <Badge className="text-[10px] bg-purple-100 text-purple-700">
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI Enhanced
                </Badge>
              )}
            </div>
            {expandedId === script.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {/* Expanded content */}
          {expandedId === script.id && (
            <div className="p-3 pt-0 space-y-3 border-t">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium">Title</label>
                  <Input
                    value={script.title}
                    onChange={e => updateScript(script.id, 'title', e.target.value)}
                    placeholder="Script A"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Platform</label>
                  <Select value={script.platform} onValueChange={v => updateScript(script.id, 'platform', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORM_OPTIONS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Duration</label>
                  <Select value={script.duration} onValueChange={v => updateScript(script.id, 'duration', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map(d => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">Script</label>
                <Textarea
                  value={script.script_text}
                  onChange={e => updateScript(script.id, 'script_text', e.target.value)}
                  rows={6}
                  placeholder="Write the full script with timing cues, voiceover, and visual direction..."
                  className="text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-purple-700 border-purple-200 hover:bg-purple-50"
                  onClick={() => enhanceWithAI(script)}
                  disabled={enhancingId === script.id}
                >
                  {enhancingId === script.id ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Enhancing...</>
                  ) : (
                    <><Sparkles className="h-3 w-3 mr-1" /> Edit & Enhance with AI</>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeScript(script.id)}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Remove
                </Button>
              </div>

              {/* Enhanced version */}
              {script.enhanced_text && (
                <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-purple-700 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI-Enhanced Version
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      onClick={() => {
                        updateScript(script.id, 'script_text', script.enhanced_text!);
                        updateScript(script.id, 'enhanced_text', '');
                        toast.success('Enhanced version applied');
                      }}
                    >
                      Use This Version
                    </Button>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap text-foreground/80 max-h-64 overflow-y-auto">
                    {script.enhanced_text}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
