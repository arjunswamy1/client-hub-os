/**
 * Context Feed.
 *
 * Two lanes, never merged: the active client's timeline, and agency / internal
 * items that belong to no client (`client_id IS NULL`). Agency items are visible
 * only to admins and account managers — RLS enforces that, this page only has to
 * avoid pretending an internal discussion belongs to a client.
 *
 * Search runs as Postgres full text over title + transcript (GIN index on
 * `search_vector`), because the point of storing transcripts is finding the one
 * sentence where something was agreed.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  MessageSquare, Mail, Phone, FileText, BarChart3, Mic,
  Search, Database as DatabaseIcon, RefreshCw, Link2, Hash, Loader2, Check,
  ChevronDown, ChevronRight, ExternalLink, Building2, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  CONTEXT_SOURCES,
  SUMMARY_PREVIEW_CHARS,
  laneOf,
  mappingConfidence,
  meetingType,
  shareLink,
  sourceLabel,
  splitMeetingContent,
  websearchQuery,
  type ContextItemRow,
} from '@/lib/contextFeed';
import { useContextSyncStatus } from '@/hooks/useContextSyncStatus';
import { syncBreakers, REVIEW_WINDOW_HOURS } from '@/hooks/useMediaBrainSyncStatus';

const SOURCE_ICON: Record<string, { icon: typeof MessageSquare; color: string }> = {
  slack: { icon: MessageSquare, color: 'text-purple-600 bg-purple-100' },
  teams: { icon: MessageSquare, color: 'text-blue-600 bg-blue-100' },
  gmail: { icon: Mail, color: 'text-red-600 bg-red-100' },
  fathom: { icon: Phone, color: 'text-green-600 bg-green-100' },
  wispr: { icon: Mic, color: 'text-indigo-600 bg-indigo-100' },
  drive: { icon: FileText, color: 'text-yellow-600 bg-yellow-100' },
  meta_ads: { icon: BarChart3, color: 'text-blue-500 bg-blue-50' },
  google_ads: { icon: BarChart3, color: 'text-green-500 bg-green-50' },
  tiktok_ads: { icon: BarChart3, color: 'text-pink-500 bg-pink-50' },
  internal: { icon: DatabaseIcon, color: 'text-gray-600 bg-gray-100' },
};

const SELECT_COLS =
  'id, client_id, source, source_id, content_type, title, content, participants, occurred_at, created_at, updated_at, metadata';

async function fetchItems(opts: { clientId: string | null; source: string; search: string }) {
  // `as any`: search_vector is a generated column not present in the generated types.
  let query = (supabase.from('context_items') as any)
    .select(SELECT_COLS)
    .order('occurred_at', { ascending: false })
    .limit(100);

  query = opts.clientId === null ? query.is('client_id', null) : query.eq('client_id', opts.clientId);
  if (opts.source !== 'all') query = query.eq('source', opts.source);

  const q = websearchQuery(opts.search);
  if (q) query = query.textSearch('search_vector', q, { type: 'websearch', config: 'english' });

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ContextItemRow[];
}

export default function ContextPage() {
  const { activeClient, clients } = useClient();
  const { isAdmin, isAccountManager } = useAuth();
  const canSeeAgency = isAdmin || isAccountManager;
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [lane, setLane] = useState<'client' | 'agency'>('client');
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const clientItems = useQuery({
    queryKey: ['context_items', 'client', activeClient?.id, sourceFilter, search],
    queryFn: () => fetchItems({ clientId: activeClient!.id, source: sourceFilter, search }),
    enabled: !!activeClient,
  });

  const agencyItems = useQuery({
    queryKey: ['context_items', 'agency', sourceFilter, search],
    queryFn: () => fetchItems({ clientId: null, source: sourceFilter, search }),
    enabled: canSeeAgency,
  });

  const contextSync = useContextSyncStatus(activeClient?.id);
  const contextBreakers = contextSync.data ? syncBreakers([contextSync.data]) : [];

  const reassign = useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }) => {
      const { error } = await supabase.from('context_items').update({ client_id: clientId }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Moved to the client record');
      queryClient.invalidateQueries({ queryKey: ['context_items'] });
    },
    onError: (err: Error) => toast.error(`Could not reassign: ${err.message}`),
  });

  // Slack sync mutation
  const syncSlack = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-slack`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ action: 'sync', client_id: activeClient?.id }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Sync failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      const parts = [`Synced ${data.synced} messages`];
      if (data.tasks_created > 0) parts.push(`${data.tasks_created} tasks auto-created`);
      toast.success(parts.join(' · '));
      queryClient.invalidateQueries({ queryKey: ['context_items'] });
    },
    onError: (err: any) => {
      toast.error(`Slack sync failed: ${err.message}`);
    },
  });

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  const active = lane === 'agency' ? agencyItems : clientItems;
  const items = active.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Context Feed</h1>
          <p className="text-sm text-muted-foreground">
            Meetings, messages and notes behind the work — {activeClient.name} and agency-level records kept apart.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Link2 className="h-4 w-4 mr-1.5" />
                Manage Channels
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Slack Channel Mappings</DialogTitle>
              </DialogHeader>
              <ChannelMappingPanel clientId={activeClient.id} />
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            onClick={() => syncSlack.mutate()}
            disabled={syncSlack.isPending}
          >
            {syncSlack.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            Sync Slack
          </Button>
        </div>
      </div>

      {/* A feed that silently stops updating is judged the same way a broken ad sync is. */}
      {contextSync.data && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            contextBreakers.length > 0
              ? 'border-destructive bg-destructive/10'
              : 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/30'
          }`}
        >
          <p className="flex items-center gap-2 font-medium">
            {contextBreakers.length > 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            )}
            {contextBreakers.length > 0
              ? 'Meeting notes are not arriving'
              : `Meeting notes last synced ${
                  contextSync.data.last_succeeded_at
                    ? format(new Date(contextSync.data.last_succeeded_at), 'MMM d, yyyy HH:mm')
                    : 'never'
                }`}
          </p>
          {contextBreakers.map((b) => (
            <p key={b.state} className="mt-1 text-xs text-muted-foreground">
              {b.evidence}
              <span className="mt-1 block border-l-2 border-current/30 pl-2">
                <span className="font-medium uppercase tracking-wide">Recommended action · </span>
                {b.action}
              </span>
            </p>
          ))}
          {contextBreakers.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {contextSync.data.rows_written ?? 0} items on the last run, judged against a {REVIEW_WINDOW_HOURS}-hour
              window.
            </p>
          )}
        </div>
      )}

      {/* Lanes. An agency item is never mixed into a client's timeline. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={lane === 'client' ? 'default' : 'outline'} onClick={() => setLane('client')}>
          {activeClient.name}
          <Badge variant="secondary" className="ml-2">{clientItems.data?.length ?? 0}</Badge>
        </Button>
        {canSeeAgency && (
          <Button size="sm" variant={lane === 'agency' ? 'default' : 'outline'} onClick={() => setLane('agency')}>
            <Building2 className="mr-1.5 h-4 w-4" />
            Agency / internal
            <Badge variant="secondary" className="ml-2">{agencyItems.data?.length ?? 0}</Badge>
          </Button>
        )}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search titles and full transcripts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {CONTEXT_SOURCES.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lane === 'agency' && (
        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Agency-level records belong to no client — internal reviews, process sessions, vendor and prospect calls, and
          meetings whose client could not be established. Visible to admins and account managers only. Nothing here is
          guessed into a client record; use "Assign to client" when you know where an item belongs.
        </p>
      )}

      {active.isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : active.error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(active.error as Error).message}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <DatabaseIcon className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">
            {search ? 'Nothing matches that search' : 'No context items yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {search
              ? 'Search covers titles and full transcripts.'
              : lane === 'agency'
                ? 'Agency-level meetings appear here once the meeting sync runs.'
                : 'Map Slack channels or sync meeting notes to start populating this feed.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ContextCard
              key={item.id}
              item={item}
              clients={clients}
              canReassign={canSeeAgency && laneOf(item) === 'agency'}
              onReassign={(clientId) => reassign.mutate({ id: item.id, clientId })}
              reassigning={reassign.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextCard({
  item, clients, canReassign, onReassign, reassigning,
}: {
  item: ContextItemRow;
  clients: { id: string; name: string }[];
  canReassign: boolean;
  onReassign: (clientId: string) => void;
  reassigning: boolean;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);
  const conf = SOURCE_ICON[item.source] ?? SOURCE_ICON.internal;
  const Icon = conf.icon;
  const { summary, transcript } = splitMeetingContent(item.content);
  const link = shareLink(item);
  const type = meetingType(item);
  const confidence = mappingConfidence(item);
  const agency = laneOf(item) === 'agency';
  const summaryTooLong = summary.length > SUMMARY_PREVIEW_CHARS;

  return (
    <Card className={agency ? 'border-l-4 border-l-amber-500' : undefined}>
      <CardContent className="flex gap-3 p-4">
        <div className={`mt-0.5 rounded-md p-1.5 shrink-0 ${conf.color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{sourceLabel(item.source)}</Badge>
            <Badge variant="secondary" className="text-[10px]">{item.content_type}</Badge>
            {agency && (
              <Badge className="bg-amber-500 text-[10px] text-amber-50 hover:bg-amber-500">Agency / internal</Badge>
            )}
            {type && <Badge variant="outline" className="text-[10px] capitalize">{type}</Badge>}
            {confidence && (
              <Badge variant="outline" className="text-[10px] text-amber-700">client inferred · {confidence}</Badge>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {format(new Date(item.occurred_at), 'MMM d, yyyy HH:mm')}
            </span>
          </div>

          {item.title && <p className="text-sm font-medium">{item.title}</p>}

          {item.participants && item.participants.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.participants.join(', ')}</p>
          )}

          {summary && (
            <p className={`mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground ${showFullSummary ? '' : 'line-clamp-4'}`}>
              {summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {summaryTooLong && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowFullSummary(v => !v)}>
                {showFullSummary ? 'Show less' : 'Show full summary'}
              </Button>
            )}
            {transcript && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShowTranscript(v => !v)}>
                {showTranscript ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
                {showTranscript ? 'Hide transcript' : `Transcript (${Math.round(transcript.length / 1000)}k chars)`}
              </Button>
            )}
            {link && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <a href={link} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-3 w-3" /> Open notes
                </a>
              </Button>
            )}
            {canReassign && (
              <div className="ml-auto flex items-center gap-1">
                <Select disabled={reassigning} onValueChange={onReassign}>
                  <SelectTrigger className="h-7 w-44 text-xs">
                    <SelectValue placeholder="Assign to client…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {showTranscript && transcript && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 text-xs leading-relaxed">
              {transcript}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelMappingPanel({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();

  // Fetch bot channels from Slack
  const { data: slackChannels = [], isLoading: loadingChannels } = useQuery({
    queryKey: ['slack_bot_channels'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-slack`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ action: 'list_channels' }),
        }
      );
      const data = await res.json();
      return data.channels || [];
    },
  });

  // Fetch existing mappings for this client
  const { data: mappings = [], isLoading: loadingMappings } = useQuery({
    queryKey: ['slack_channel_mappings', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('slack_channel_mappings' as any)
        .select('*')
        .eq('client_id', clientId);
      if (error) throw error;
      return data || [];
    },
  });

  const mappedChannelIds = new Set((mappings as any[]).map((m: any) => m.channel_id));

  const mapChannel = useMutation({
    mutationFn: async ({ channelId, channelName }: { channelId: string; channelName: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-slack`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            action: 'map_channel',
            client_id: clientId,
            channel_id: channelId,
            channel_name: channelName,
          }),
        }
      );
      if (!res.ok) throw new Error('Failed to map channel');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Channel mapped');
      queryClient.invalidateQueries({ queryKey: ['slack_channel_mappings'] });
    },
  });

  const unmapChannel = useMutation({
    mutationFn: async (channelId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-slack`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ action: 'unmap_channel', channel_id: channelId }),
        }
      );
      if (!res.ok) throw new Error('Failed to unmap channel');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Channel unmapped');
      queryClient.invalidateQueries({ queryKey: ['slack_channel_mappings'] });
    },
  });

  if (loadingChannels || loadingMappings) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading channels...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      <p className="text-xs text-muted-foreground">
        Toggle channels to sync messages into this client's context feed.
      </p>
      {slackChannels.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No channels found. Make sure the bot is invited to channels.
        </p>
      ) : (
        slackChannels.map((ch: any) => {
          const isMapped = mappedChannelIds.has(ch.id);
          return (
            <div
              key={ch.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ch.name}</p>
                  {ch.topic && (
                    <p className="text-xs text-muted-foreground truncate">{ch.topic}</p>
                  )}
                </div>
              </div>
              {isMapped ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-green-600 hover:text-red-600"
                  onClick={() => unmapChannel.mutate(ch.id)}
                  disabled={unmapChannel.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Linked
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => mapChannel.mutate({ channelId: ch.id, channelName: ch.name })}
                  disabled={mapChannel.isPending}
                >
                  <Link2 className="h-4 w-4 mr-1" />
                  Link
                </Button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
