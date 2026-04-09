import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Plus, Globe, ExternalLink, LayoutGrid, List } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  in_development: 'bg-yellow-100 text-yellow-700',
  staging: 'bg-blue-100 text-blue-700',
  live: 'bg-green-100 text-green-700',
  testing: 'bg-purple-100 text-purple-700',
  paused: 'bg-orange-100 text-orange-700',
  archived: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  in_development: 'In Development',
  staging: 'Staging',
  live: 'Live',
  testing: 'Testing',
  paused: 'Paused',
  archived: 'Archived',
};

export default function LandingPagesPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data: pages = [] } = useQuery({
    queryKey: ['landing_pages', activeClient?.id],
    queryFn: async () => {
      if (!activeClient) return [];
      const { data, error } = await supabase
        .from('landing_pages')
        .select('*, created_by:team_members!landing_pages_created_by_id_fkey(name)')
        .eq('client_id', activeClient.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeClient,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('landing_pages').update({ status } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing_pages'] });
      toast.success('Status updated');
    },
  });

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Pages</h1>
          <p className="text-sm text-muted-foreground">{pages.length} pages for {activeClient.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className="rounded-r-none">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className="rounded-l-none">
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Page
          </Button>
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Globe className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">No landing pages tracked yet</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((page: any) => (
            <Card key={page.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{page.title}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">{page.platform_source}</Badge>
                  </div>
                  <Select
                    value={page.status}
                    onValueChange={(v) => updateStatus.mutate({ id: page.id, status: v })}
                  >
                    <SelectTrigger className="h-6 w-auto border-0 p-0">
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[page.status] || ''}`}>
                        {STATUS_LABELS[page.status] || page.status}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {page.url && (
                  <a href={page.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> {new URL(page.url).hostname}
                  </a>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Added {format(new Date(page.created_at), 'MMM d, yyyy')}
                  {page.created_by ? ` by ${page.created_by.name}` : ''}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page: any) => (
                <TableRow key={page.id}>
                  <TableCell className="font-medium">{page.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[page.status] || ''}`}>
                      {STATUS_LABELS[page.status] || page.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{page.platform_source}</TableCell>
                  <TableCell>
                    {page.url ? (
                      <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" /> View
                      </a>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">{format(new Date(page.created_at), 'MMM d, yyyy')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreatePageDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clientId={activeClient.id}
        currentMemberId={teamMember?.id}
      />
    </div>
  );
}

function CreatePageDialog({ open, onOpenChange, clientId, currentMemberId }: any) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [stagingUrl, setStagingUrl] = useState('');
  const [platform, setPlatform] = useState('custom');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('landing_pages').insert({
        client_id: clientId,
        title,
        url: url || null,
        staging_url: stagingUrl || null,
        platform_source: platform,
        notes: notes || null,
        created_by_id: currentMemberId || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing_pages'] });
      toast.success('Page added');
      onOpenChange(false);
      setTitle(''); setUrl(''); setStagingUrl(''); setPlatform('custom'); setNotes('');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Landing Page</DialogTitle></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Live URL</Label><Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></div>
          <div className="space-y-2"><Label>Staging URL</Label><Input value={stagingUrl} onChange={e => setStagingUrl(e.target.value)} placeholder="https://" /></div>
          <div className="space-y-2">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lovable">Lovable</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? 'Adding...' : 'Add Page'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
