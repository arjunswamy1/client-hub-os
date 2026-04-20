import { useState, useRef, useEffect, useCallback } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Send, Download, ChevronRight, ChevronDown, FolderOpen, FileText,
  Target, Hash, Type, Zap, Plus, Loader2, Bot, User, ArrowLeft,
  Sparkles, AlertTriangle, RefreshCw, FileSpreadsheet, Pencil, Check,
  MapPin, Upload, Copy
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReactMarkdown from 'react-markdown';

type Platform = 'google' | 'bing' | 'both';

type Message = { role: 'user' | 'assistant'; content: string };

type CampaignBuild = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  campaign_structure: any;
  generated_files: any[];
  conversation_history: Message[];
  platform?: Platform;
};

export default function CampaignBuildPage() {
  const { activeClient } = useClient();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('google');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [campaignStructure, setCampaignStructure] = useState<any>(null);
  const [isGeneratingCSVs, setIsGeneratingCSVs] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<any[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [zipcodesInput, setZipcodesInput] = useState('');
  const [isGeneratingLocations, setIsGeneratingLocations] = useState(false);
  const [locationFiles, setLocationFiles] = useState<any[]>([]);
  const [isCloning, setIsCloning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const zipFileInputRef = useRef<HTMLInputElement>(null);

  // Parse uploaded CSV/TXT file for zip codes
  const handleZipFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Extract all 5-digit numbers from the file (handles CSV with headers, plain text, etc.)
      const zips = Array.from(text.matchAll(/\b\d{5}\b/g)).map(m => m[0]);
      const unique = Array.from(new Set(zips));
      if (unique.length === 0) {
        toast({ title: 'No zip codes found', description: 'CSV must contain 5-digit US zip codes.', variant: 'destructive' });
        return;
      }
      // Append to existing or replace
      const merged = zipcodesInput.trim()
        ? Array.from(new Set([...zipcodesInput.split(/[\s,;\n]+/).map(z => z.trim()).filter(Boolean), ...unique]))
        : unique;
      setZipcodesInput(merged.join(', '));
      toast({ title: 'CSV uploaded', description: `${unique.length} unique zip codes loaded from ${file.name}.` });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      if (zipFileInputRef.current) zipFileInputRef.current.value = '';
    }
  };

  // Clone this build to the opposite platform (Google ↔ Bing)
  const handleCloneToPlatform = async (targetPlatform: 'google' | 'bing') => {
    if (!activeBuild || !activeClient) return;
    setIsCloning(true);
    try {
      const newTitle = `${activeBuild.title || 'Untitled'} (${targetPlatform === 'bing' ? 'Bing' : 'Google'})`;
      const { data, error } = await supabase
        .from('campaign_builds')
        .insert({
          client_id: activeClient.id,
          title: newTitle,
          platform: targetPlatform,
          campaign_structure: activeBuild.campaign_structure,
          conversation_history: [
            ...(activeBuild.conversation_history || []),
            {
              role: 'assistant',
              content: `🔄 **Cloned from ${platform === 'bing' ? 'Bing' : 'Google'} build.** This is now a **${targetPlatform === 'bing' ? 'Microsoft Advertising (Bing)' : 'Google Ads'}** campaign. The structure was copied as-is — character limits are identical across platforms. Click **"Generate & Download"** to produce ${targetPlatform === 'bing' ? 'Bing Ads Editor bulk CSVs' : 'Google Ads Editor CSVs'}, or ask me to optimize the copy/keywords for ${targetPlatform === 'bing' ? 'Bing audiences (older, higher-income, desktop-heavy, lower CPCs)' : 'Google'}.`,
            },
          ],
          status: 'in_progress',
        })
        .select('id')
        .single();
      if (error) throw error;
      toast({ title: 'Cloned to ' + (targetPlatform === 'bing' ? 'Bing' : 'Google'), description: 'Opening new build...' });
      qc.invalidateQueries({ queryKey: ['campaign_builds', activeClient.id] });
      // Load the new build
      setActiveBuildId(data.id);
      setPlatform(targetPlatform);
      setCampaignStructure(activeBuild.campaign_structure);
      setMessages([
        ...(activeBuild.conversation_history || []),
        {
          role: 'assistant' as const,
          content: `🔄 **Cloned from ${platform === 'bing' ? 'Bing' : 'Google'} build.** This is now a **${targetPlatform === 'bing' ? 'Microsoft Advertising (Bing)' : 'Google Ads'}** campaign. The structure was copied as-is — character limits are identical across platforms. Click **"Generate & Download"** to produce ${targetPlatform === 'bing' ? 'Bing Ads Editor bulk CSVs' : 'Google Ads Editor CSVs'}, or ask me to optimize the copy/keywords for ${targetPlatform === 'bing' ? 'Bing audiences (older, higher-income, desktop-heavy, lower CPCs)' : 'Google'}.`,
        },
      ]);
      setGeneratedFiles([]);
    } catch (e: any) {
      toast({ title: 'Clone failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsCloning(false);
    }
  };

  // Fetch existing builds
  const { data: builds } = useQuery({
    queryKey: ['campaign_builds', activeClient?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_builds')
        .select('id, title, status, created_at, campaign_structure, generated_files, conversation_history, platform')
        .eq('client_id', activeClient!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CampaignBuild[];
    },
    enabled: !!activeClient,
  });

  // Load a build
  const loadBuild = useCallback((build: CampaignBuild) => {
    setActiveBuildId(build.id);
    setPlatform((build.platform as Platform) || 'google');
    setMessages((build.conversation_history as Message[]) || []);
    setCampaignStructure(build.campaign_structure || null);
    setGeneratedFiles((build.generated_files as any[]) || []);
  }, []);

  // Create new build
  const createBuild = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('campaign_builds')
        .insert({ client_id: activeClient!.id, title: `New Build - ${new Date().toLocaleDateString()}`, platform })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setActiveBuildId(data.id);
      setMessages([]);
      setCampaignStructure(null);
      setGeneratedFiles([]);
      qc.invalidateQueries({ queryKey: ['campaign_builds', activeClient?.id] });
    },
  });

  // Rename build
  const activeBuild = builds?.find(b => b.id === activeBuildId);
  const handleStartRename = () => {
    setEditTitle(activeBuild?.title || '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  };
  const handleSaveTitle = async () => {
    if (!activeBuildId || !editTitle.trim()) return;
    setIsEditingTitle(false);
    await supabase.from('campaign_builds').update({ title: editTitle.trim() }).eq('id', activeBuildId);
    qc.invalidateQueries({ queryKey: ['campaign_builds', activeClient?.id] });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Send message with streaming
  const sendMessage = async (overrideContent?: string) => {
    const content = overrideContent || input.trim();
    if (!content || isStreaming) return;

    const userMsg: Message = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    if (!overrideContent) setInput('');
    setIsStreaming(true);

    // Create build if none active
    let buildId = activeBuildId;
    if (!buildId) {
      try {
        const { data, error } = await supabase
          .from('campaign_builds')
          .insert({ client_id: activeClient!.id, title: input.trim().slice(0, 80), platform })
          .select('id')
          .single();
        if (error) throw error;
        buildId = data.id;
        setActiveBuildId(buildId);
        qc.invalidateQueries({ queryKey: ['campaign_builds', activeClient?.id] });
      } catch (e) {
        console.error('Failed to create build:', e);
      }
    }

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-builder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: newMessages,
          build_id: buildId,
          platform,
          client_context: {
            client_name: activeClient?.name,
          },
        }),
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to stream');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let assistantContent = '';
      let toolCallArgs = '';
      let isToolCall = false;
      let toolCallName = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const choice = parsed.choices?.[0];

            // Check for tool calls
            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                if (tc.function?.name) {
                  toolCallName = tc.function.name;
                  isToolCall = true;
                }
                if (tc.function?.arguments) {
                  toolCallArgs += tc.function.arguments;
                }
              }
            }

            const content = choice?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { role: 'assistant', content: assistantContent }];
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Handle tool call result
      if (isToolCall && toolCallName === 'generate_campaign_structure' && toolCallArgs) {
        try {
          const structure = JSON.parse(toolCallArgs);
          setCampaignStructure(structure);

          // Save to DB
          if (buildId) {
            await supabase.from('campaign_builds').update({
              campaign_structure: structure,
              optimization_notes: structure.optimization_notes || '',
              conversation_history: [...newMessages, { role: 'assistant', content: assistantContent || 'Campaign structure generated! Review it in the preview panel on the right, then click "Generate & Download CSVs" when ready.' }],
              updated_at: new Date().toISOString(),
            }).eq('id', buildId);
          }

          // Add confirmation message if AI didn't say anything
          if (!assistantContent) {
            const confirmMsg = '✅ **Campaign structure generated!** Review it in the preview panel on the right. When you\'re happy with it, click **"Generate & Download CSVs"** to create your Google Ads Editor import files.\n\nYou can also ask me to make adjustments — add ad groups, change keywords, tweak ad copy, etc.';
            setMessages(prev => [...prev, { role: 'assistant', content: confirmMsg }]);
          }
        } catch (e) {
          console.error('Failed to parse tool call:', e);
        }
      }

      // Save conversation
      if (buildId) {
        const finalMessages = [...newMessages];
        if (assistantContent) finalMessages.push({ role: 'assistant', content: assistantContent });
        await supabase.from('campaign_builds').update({
          conversation_history: finalMessages,
          updated_at: new Date().toISOString(),
        }).eq('id', buildId);
      }
    } catch (e: any) {
      console.error('Stream error:', e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsStreaming(false);
    }
  };

  // Generate CSVs
  const handleGenerateCSVs = async () => {
    if (!campaignStructure || !activeBuildId) return;
    setIsGeneratingCSVs(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-builder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'generate_csvs',
          campaign_structure: campaignStructure,
          build_id: activeBuildId,
          client_name: activeClient?.name,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setGeneratedFiles(data.files);
        toast({ title: 'CSVs Generated', description: `${data.files.length} files ready for download.` });
        qc.invalidateQueries({ queryKey: ['campaign_builds', activeClient?.id] });
      } else {
        throw new Error(data.error || 'Failed to generate CSVs');
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsGeneratingCSVs(false);
    }
  };

  // Regenerate campaign structure
  const handleRegenerate = () => {
    setCampaignStructure(null);
    setGeneratedFiles([]);
    sendMessage('IMPORTANT: You MUST call the generate_campaign_structure tool now. Do NOT respond with text. Regenerate the full campaign structure with improvements — better keywords, tighter ad copy within character limits, and optimized structure. Keep the same goals, targeting, and landing page. Output the complete structure via the tool call immediately.');
  };

  // Generate bulk locations CSV from zip codes
  const handleGenerateLocations = async () => {
    if (!zipcodesInput.trim() || !campaignStructure || !activeBuildId) return;
    const zips = zipcodesInput.split(/[\s,;\n]+/).map(z => z.trim()).filter(z => /^\d{5}$/.test(z));
    if (zips.length === 0) {
      toast({ title: 'Invalid zip codes', description: 'Enter valid 5-digit US zip codes separated by commas or newlines.', variant: 'destructive' });
      return;
    }
    const campNames = campaignStructure.campaigns?.map((c: any) => c.name) || [];
    if (campNames.length === 0) return;

    setIsGeneratingLocations(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-builder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'generate_locations',
          zipcodes: zips,
          campaign_names: campNames,
          build_id: activeBuildId,
          client_name: activeClient?.name,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setLocationFiles(data.files);
        toast({ title: 'Locations CSV Generated', description: `${data.locations_count} zip codes × ${data.campaigns_count} campaigns ready for download.` });
      } else {
        throw new Error(data.error || 'Failed to generate locations');
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsGeneratingLocations(false);
    }
  };

  if (!activeClient) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Select a client to use Campaign Builder.
      </div>
    );
  }

  // List view when no build is active
  if (!activeBuildId) {
    return (
      <div className="space-y-6 p-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Campaign Builder
            </h1>
            <p className="text-sm text-muted-foreground">AI-powered Google Ads & Microsoft Advertising (Bing) campaign architect</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <TabsList>
                <TabsTrigger value="google">Google</TabsTrigger>
                <TabsTrigger value="bing">Bing</TabsTrigger>
                <TabsTrigger value="both">Both</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => createBuild.mutate()} disabled={createBuild.isPending}>
              <Plus className="h-4 w-4 mr-2" />
              New Campaign Build
            </Button>
          </div>
        </div>

        {builds?.length === 0 && (
          <Card className="p-12 text-center">
            <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-medium mb-2">No campaign builds yet</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Start a new build to have AI create a complete Google Ads campaign structure ready for import.
            </p>
            <Button onClick={() => createBuild.mutate()}>
              <Plus className="h-4 w-4 mr-2" />
              Start Your First Build
            </Button>
          </Card>
        )}

        <div className="grid gap-3">
          {builds?.map((build) => (
            <Card
              key={build.id}
              className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => loadBuild(build)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{build.title || 'Untitled Build'}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(build.created_at).toLocaleDateString()} · {(build.conversation_history as any[])?.length || 0} messages
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {build.platform === 'bing' ? 'Bing' : build.platform === 'both' ? 'Google + Bing' : 'Google'}
                  </Badge>
                  <Badge variant={
                    build.status === 'generated' ? 'default' :
                    build.status === 'downloaded' ? 'secondary' : 'outline'
                  }>
                    {build.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Active build view: Chat + Preview
  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 -m-4">
      {/* Left: Chat */}
      <div className="flex flex-col w-1/2 border-r">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button variant="ghost" size="icon" onClick={() => setActiveBuildId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                  className="h-7 text-sm font-medium"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveTitle}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group cursor-pointer" onClick={handleStartRename}>
                <p className="text-sm font-medium truncate">{activeBuild?.title || 'Untitled Build'}</p>
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              AI Campaign Architect
              <Badge variant="outline" className="text-[9px] uppercase h-4 px-1">
                {platform === 'bing' ? 'Bing' : platform === 'both' ? 'Google + Bing' : 'Google'}
              </Badge>
            </p>
          </div>
          {campaignStructure && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenerate}
                disabled={isStreaming}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </Button>
              <Button
                size="sm"
                onClick={handleGenerateCSVs}
                disabled={isGeneratingCSVs}
              >
                {isGeneratingCSVs ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                Generate & Download
              </Button>
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 p-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Sparkles className="h-10 w-10 mx-auto text-primary/60 mb-3" />
              <p className="font-medium mb-1">Ready to build a campaign</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tell me about the campaign you want to build — the vertical, goal, audience, landing page, and budget. I'll architect a complete {platform === 'bing' ? 'Microsoft Advertising (Bing)' : platform === 'both' ? 'Google Ads + Microsoft Advertising (Bing)' : 'Google Ads'} campaign structure.
              </p>
            </div>
          )}
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3.5 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder="Describe the campaign you want to build..."
              className="min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button onClick={() => sendMessage()} disabled={isStreaming || !input.trim()} size="icon" className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Right: Preview Panel */}
      <div className="flex flex-col w-1/2 bg-muted/30">
        <div className="px-4 py-3 border-b bg-background">
          <p className="text-sm font-medium">Campaign Structure Preview</p>
          <p className="text-xs text-muted-foreground">
            {campaignStructure ? `${campaignStructure.campaigns?.length || 0} campaign(s)` : 'Structure will appear here after AI generates it'}
          </p>
        </div>

        <ScrollArea className="flex-1 p-4">
          {!campaignStructure ? (
            <div className="text-center py-16 text-muted-foreground">
              <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Chat with the AI to build your campaign structure.</p>
              <p className="text-xs mt-1">It will appear here as an interactive tree.</p>
            </div>
          ) : (
            <CampaignTree structure={campaignStructure} />
          )}

          {/* Download section */}
          {generatedFiles.length > 0 && (
            <div className="mt-6 space-y-3">
              {/* Master Excel - prominent */}
              {generatedFiles.filter((f: any) => f.file_type === 'xlsx').map((f: any, i: number) => (
                <a
                  key={`xlsx-${i}`}
                  href={f.storage_url}
                  download={f.filename}
                  className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                >
                  <FileSpreadsheet className="h-5 w-5 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{f.filename}</p>
                    <p className="text-[10px] text-muted-foreground">Master workbook — all sheets for team audit</p>
                  </div>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}

              {/* Individual CSVs */}
              <p className="text-xs font-medium text-muted-foreground pt-1">Individual CSV Files</p>
              {generatedFiles.filter((f: any) => f.file_type !== 'xlsx').map((f: any, i: number) => (
                <a
                  key={i}
                  href={f.storage_url}
                  download={f.filename}
                  className="flex items-center gap-2 p-2 rounded-md bg-background border hover:bg-accent/50 transition-colors text-sm"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {f.filename}
                </a>
              ))}
            </div>
          )}

          {/* Bulk Locations Upload */}
          {campaignStructure && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Bulk Location Targeting</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste zip codes below to generate a bulk locations CSV with Google Ads Editor headers and Location IDs.
              </p>
              <Textarea
                value={zipcodesInput}
                onChange={(e) => setZipcodesInput(e.target.value)}
                placeholder="Paste zip codes here (comma, space, or newline separated)&#10;e.g. 90210, 10001, 30301, 60601"
                className="min-h-[80px] text-xs font-mono"
                rows={4}
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  {zipcodesInput.trim() ? `${zipcodesInput.split(/[\s,;\n]+/).filter(z => /^\d{5}$/.test(z.trim())).length} valid zip codes` : 'No zip codes entered'}
                </p>
                <Button
                  size="sm"
                  onClick={handleGenerateLocations}
                  disabled={isGeneratingLocations || !zipcodesInput.trim()}
                >
                  {isGeneratingLocations ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
                  Generate Locations CSV
                </Button>
              </div>

              {/* Location files download */}
              {locationFiles.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground">Location Files</p>
                  {locationFiles.map((f: any, i: number) => (
                    <a
                      key={i}
                      href={f.storage_url}
                      download={f.filename}
                      className={`flex items-center gap-2 p-2 rounded-md border hover:bg-accent/50 transition-colors text-sm ${
                        f.file_type === 'xlsx' ? 'bg-primary/5 border-primary/20' : 'bg-background'
                      }`}
                    >
                      {f.file_type === 'xlsx' ? <FileSpreadsheet className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                      {f.filename}
                      <Download className="h-3 w-3 ml-auto text-muted-foreground" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

// Campaign tree component
function CampaignTree({ structure }: { structure: any }) {
  return (
    <div className="space-y-3">
      {structure.campaigns?.map((campaign: any, ci: number) => (
        <CampaignNode key={ci} campaign={campaign} />
      ))}
      {structure.optimization_notes && (
        <Card className="p-3 mt-4 bg-amber-500/5 border-amber-500/20">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Optimization Notes
          </p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{structure.optimization_notes}</p>
        </Card>
      )}
    </div>
  );
}

function CampaignNode({ campaign }: { campaign: any }) {
  const [open, setOpen] = useState(true);
  const totalKw = campaign.ad_groups?.reduce((s: number, ag: any) => s + (ag.keywords?.length || 0), 0) || 0;
  const totalAds = campaign.ad_groups?.reduce((s: number, ag: any) => s + (ag.ads?.length || 0), 0) || 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="w-full p-3 flex items-center gap-2 text-left hover:bg-accent/50 transition-colors">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Target className="h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{campaign.name}</p>
            <p className="text-xs text-muted-foreground">
              {campaign.campaign_type} · ${campaign.daily_budget}/day · {campaign.ad_groups?.length || 0} ad groups · {totalKw} keywords · {totalAds} ads
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">{campaign.bid_strategy || 'Max Conv'}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 pb-3 space-y-2 pt-2">
            {/* Campaign details */}
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {campaign.location && <Badge variant="secondary" className="text-[10px]">📍 {campaign.location}</Badge>}
              {campaign.schedule && <Badge variant="secondary" className="text-[10px]">🕐 {campaign.schedule}</Badge>}
              {campaign.networks && <Badge variant="secondary" className="text-[10px]">🌐 {campaign.networks}</Badge>}
            </div>

            {/* Ad Groups */}
            {campaign.ad_groups?.map((ag: any, agi: number) => (
              <AdGroupNode key={agi} adGroup={ag} campaignName={campaign.name} />
            ))}

            {/* Campaign negatives */}
            {campaign.campaign_negatives?.length > 0 && (
              <NegativesList negatives={campaign.campaign_negatives} label="Campaign Negatives" />
            )}

            {/* Extensions */}
            {campaign.extensions && <ExtensionsNode extensions={campaign.extensions} />}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function AdGroupNode({ adGroup }: { adGroup: any; campaignName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-accent/50 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FolderOpen className="h-3.5 w-3.5 text-blue-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{adGroup.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {adGroup.keywords?.length || 0} keywords · {adGroup.ads?.length || 0} ads
            {adGroup.theme && ` · ${adGroup.theme}`}
          </p>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-8 space-y-2 mt-1">
        {/* Keywords */}
        {adGroup.keywords?.length > 0 && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Hash className="h-3 w-3" /> Keywords
            </p>
            <div className="flex flex-wrap gap-1">
              {adGroup.keywords.map((kw: any, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-[10px] ${
                    kw.intent === 'high' ? 'border-green-500/40 text-green-700 dark:text-green-400' :
                    kw.intent === 'medium' ? 'border-yellow-500/40 text-yellow-700 dark:text-yellow-400' :
                    'border-muted-foreground/30'
                  }`}
                >
                  {kw.match_type === 'Exact' ? `[${kw.keyword}]` : kw.match_type === 'Phrase' ? `"${kw.keyword}"` : kw.keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Ads */}
        {adGroup.ads?.map((ad: any, i: number) => (
          <div key={i} className="rounded-md border p-2 bg-background">
            <p className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Type className="h-3 w-3" /> RSA {i + 1} {ad.ad_name && `— ${ad.ad_name}`}
            </p>
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {ad.headlines?.slice(0, 5).map((h: string, hi: number) => (
                  <span key={hi} className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{h}</span>
                ))}
                {(ad.headlines?.length || 0) > 5 && (
                  <span className="text-[10px] text-muted-foreground">+{ad.headlines.length - 5} more</span>
                )}
              </div>
              {ad.descriptions?.slice(0, 2).map((d: string, di: number) => (
                <p key={di} className="text-[10px] text-muted-foreground truncate">{d}</p>
              ))}
              {ad.final_url && (
                <p className="text-[10px] text-green-600 truncate">{ad.final_url}</p>
              )}
            </div>
          </div>
        ))}

        {/* Ad group negatives */}
        {adGroup.negative_keywords?.length > 0 && (
          <NegativesList negatives={adGroup.negative_keywords} label="Ad Group Negatives" />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NegativesList({ negatives, label }: { negatives: any[]; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 hover:underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        🚫 {label} ({negatives.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <div className="flex flex-wrap gap-1">
          {negatives.map((nk: any, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px] border-red-500/30 text-red-600 dark:text-red-400">
              {nk.keyword}
            </Badge>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExtensionsNode({ extensions }: { extensions: any }) {
  const [open, setOpen] = useState(false);
  const count = (extensions.sitelinks?.length || 0) + (extensions.callouts?.length || 0) + (extensions.structured_snippets?.length || 0);
  if (count === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Zap className="h-3 w-3" /> Extensions ({count})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1.5 pl-4">
        {extensions.sitelinks?.map((sl: any, i: number) => (
          <div key={i} className="text-[10px]">
            <span className="font-medium">{sl.text}</span>
            {sl.description1 && <span className="text-muted-foreground"> — {sl.description1}</span>}
          </div>
        ))}
        {extensions.callouts?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {extensions.callouts.map((c: string, i: number) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        )}
        {extensions.structured_snippets?.map((ss: any, i: number) => (
          <div key={i} className="text-[10px]">
            <span className="font-medium">{ss.header}:</span>{' '}
            <span className="text-muted-foreground">{ss.values}</span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
