import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
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
  MessageSquare, Mail, Phone, FileText, BarChart3,
  Search, Database as DatabaseIcon, RefreshCw, Link2, Hash, Loader2, Check
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const SOURCE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  slack: { label: 'Slack', icon: MessageSquare, color: 'text-purple-600 bg-purple-100' },
  teams: { label: 'Teams', icon: MessageSquare, color: 'text-blue-600 bg-blue-100' },
  gmail: { label: 'Gmail', icon: Mail, color: 'text-red-600 bg-red-100' },
  fathom: { label: 'Fathom', icon: Phone, color: 'text-green-600 bg-green-100' },
  drive: { label: 'Drive', icon: FileText, color: 'text-yellow-600 bg-yellow-100' },
  meta_ads: { label: 'Meta Ads', icon: BarChart3, color: 'text-blue-500 bg-blue-50' },
  google_ads: { label: 'Google Ads', icon: BarChart3, color: 'text-green-500 bg-green-50' },
  tiktok_ads: { label: 'TikTok Ads', icon: BarChart3, color: 'text-pink-500 bg-pink-50' },
  internal: { label: 'Internal', icon: DatabaseIcon, color: 'text-gray-600 bg-gray-100' },
};

export default function ContextPage() {
  const { activeClient } = useClient();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['context_items', activeClient?.id, sourceFilter],
    queryFn: async () => {
      if (!activeClient) return [];
      let query = supabase
        .from('context_items')
        .select('*')
        .eq('client_id', activeClient.id)
        .order('occurred_at', { ascending: false })
        .limit(100);

      if (sourceFilter !== 'all') {
        query = query.eq('source', sourceFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!activeClient,
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

  // Auto-map channels mutation
  const autoMap = useMutation({
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
          body: JSON.stringify({ action: 'auto_map' }),
        }
      );
      if (!res.ok) throw new Error('Auto-map failed');
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Auto-mapped ${data.mapped} of ${data.total_channels} channels`);
      queryClient.invalidateQueries({ queryKey: ['slack_channel_mappings'] });
    },
    onError: (err: any) => {
      toast.error(`Auto-map failed: ${err.message}`);
    },
  });

  const filtered = search
    ? items.filter((item: any) =>
        item.title?.toLowerCase().includes(search.toLowerCase()) ||
        item.content?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Context Feed</h1>
          <p className="text-sm text-muted-foreground">All communications and data for {activeClient.name}</p>
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

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search context..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {Object.entries(SOURCE_CONFIG).map(([key, conf]) => (
              <SelectItem key={key} value={key}>{conf.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <DatabaseIcon className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No context items yet</p>
          <p className="text-xs text-muted-foreground">
            Map Slack channels and click "Sync Slack" to start populating the feed.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item: any) => {
            const conf = SOURCE_CONFIG[item.source] || SOURCE_CONFIG.internal;
            const Icon = conf.icon;
            return (
              <Card key={item.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="flex gap-3 p-4">
                  <div className={`mt-0.5 rounded-md p-1.5 shrink-0 ${conf.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className="text-[10px]">{conf.label}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{item.content_type}</Badge>
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {format(new Date(item.occurred_at), 'MMM d, yyyy HH:mm')}
                      </span>
                    </div>
                    {item.title && <p className="text-sm font-medium">{item.title}</p>}
                    {item.content && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.content}</p>
                    )}
                    {item.participants?.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {item.participants.join(', ')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
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
