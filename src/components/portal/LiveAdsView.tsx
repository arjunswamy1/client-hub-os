import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowUpDown, Chrome, Facebook, Image, Video, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

type SortField = 'spend' | 'impressions' | 'clicks' | 'conversions' | 'ctr' | 'cpa';
type SortDir = 'asc' | 'desc';

const DATE_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function formatCurrency(v: number | null) {
  if (v == null) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatNumber(v: number | null) {
  if (v == null) return '—';
  return v.toLocaleString();
}
function formatPct(v: number | null) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: 'Active', variant: 'default' },
  paused: { label: 'Paused', variant: 'secondary' },
  in_review: { label: 'In Review', variant: 'outline' },
};

const formatIcons: Record<string, typeof Image> = {
  image: Image,
  video: Video,
  carousel: Layers,
  static: Image,
};

export function LiveAdsView() {
  const { activeClient } = useClient();
  const [days, setDays] = useState(30);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const dateFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }, [days]);

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ['portal-live-ads', activeClient?.id, dateFrom, platformFilter, statusFilter],
    enabled: !!activeClient?.id,
    queryFn: async () => {
      let query = supabase
        .from('ad_creatives')
        .select('*')
        .eq('client_id', activeClient!.id)
        .gte('date_from', dateFrom);

      if (platformFilter !== 'all') query = query.eq('platform', platformFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);

      const { data, error } = await query.order('spend', { ascending: false }).limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const sorted = useMemo(() => {
    return [...ads].sort((a, b) => {
      const av = (a as any)[sortField] ?? 0;
      const bv = (b as any)[sortField] ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [ads, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const campaigns = useMemo(() => {
    const set = new Set(ads.map(a => a.campaign_name));
    return Array.from(set).sort();
  }, [ads]);

  if (!activeClient) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Live Ads</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map(r => (
                <SelectItem key={r.days} value={String(r.days)}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="meta">Meta</SelectItem>
              <SelectItem value="google">Google</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          No ads found for the selected filters.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Ad Name</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('spend')}>
                    <span className="flex items-center gap-1">Spend <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('impressions')}>
                    <span className="flex items-center gap-1">Impressions <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('clicks')}>
                    <span className="flex items-center gap-1">Clicks <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('ctr')}>
                    <span className="flex items-center gap-1">CTR <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('conversions')}>
                    <span className="flex items-center gap-1">Conv. <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort('cpa')}>
                    <span className="flex items-center gap-1">CPA <ArrowUpDown className="h-3 w-3" /></span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(ad => {
                  const status = statusConfig[ad.status || 'active'] || statusConfig.active;
                  const PlatformIcon = ad.platform === 'google' ? Chrome : Facebook;
                  const FormatIcon = formatIcons[(ad.format || 'static').toLowerCase()] || Image;
                  return (
                    <TableRow key={ad.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {ad.creative_thumbnail_url && (
                            <img src={ad.creative_thumbnail_url} className="h-8 w-8 rounded object-cover" alt="" />
                          )}
                          <span className="text-sm font-medium line-clamp-1">{ad.ad_name || ad.headline || 'Untitled'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground line-clamp-1 max-w-[160px]">{ad.campaign_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <PlatformIcon className="h-3.5 w-3.5" />
                          <span className="text-xs capitalize">{ad.platform}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <FormatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs capitalize">{ad.format || 'Static'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(ad.spend)}</TableCell>
                      <TableCell>{formatNumber(ad.impressions)}</TableCell>
                      <TableCell>{formatNumber(ad.clicks)}</TableCell>
                      <TableCell>{formatPct(ad.ctr)}</TableCell>
                      <TableCell>{formatNumber(ad.conversions)}</TableCell>
                      <TableCell>{formatCurrency(ad.cpa)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card layout */}
          <div className="space-y-3 md:hidden">
            {sorted.map(ad => {
              const status = statusConfig[ad.status || 'active'] || statusConfig.active;
              const PlatformIcon = ad.platform === 'google' ? Chrome : Facebook;
              return (
                <div key={ad.id} className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {ad.creative_thumbnail_url && (
                        <img src={ad.creative_thumbnail_url} className="h-10 w-10 rounded object-cover shrink-0" alt="" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{ad.ad_name || ad.headline || 'Untitled'}</p>
                        <p className="text-xs text-muted-foreground truncate">{ad.campaign_name}</p>
                      </div>
                    </div>
                    <Badge variant={status.variant} className="text-[10px] shrink-0">{status.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PlatformIcon className="h-3 w-3" />
                    <span className="capitalize">{ad.platform}</span>
                    <span>•</span>
                    <span className="capitalize">{ad.format || 'Static'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Spend</p>
                      <p className="text-sm font-medium">{formatCurrency(ad.spend)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Clicks</p>
                      <p className="text-sm font-medium">{formatNumber(ad.clicks)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Conv.</p>
                      <p className="text-sm font-medium">{formatNumber(ad.conversions)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">{sorted.length} ad{sorted.length !== 1 ? 's' : ''} found</p>
    </div>
  );
}
