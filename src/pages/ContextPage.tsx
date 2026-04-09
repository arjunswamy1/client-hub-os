import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  MessageSquare, Mail, Phone, FileText, BarChart3,
  Search, Database as DatabaseIcon
} from 'lucide-react';
import { format } from 'date-fns';

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Context Feed</h1>
        <p className="text-sm text-muted-foreground">All communications and data for {activeClient.name}</p>
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
            Connect integrations (Slack, Teams, Gmail, Fathom) to start populating the feed.
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
                        Participants: {item.participants.join(', ')}
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
