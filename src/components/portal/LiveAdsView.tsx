import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Chrome, Facebook, Image as ImageIcon, Video, Layers, ImageOff } from 'lucide-react';
import { useClientVerticals } from '@/hooks/useClientVerticals';
import { BILLY_VERTICALS, matchesVertical, matchesVerticalAccount, VerticalConfig } from '@/config/billyVerticals';

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

const formatIcons: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  carousel: Layers,
  static: ImageIcon,
};

export function LiveAdsView() {
  const { activeClient } = useClient();
  const { dbVerticals } = useClientVerticals();
  const [days, setDays] = useState(30);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [verticalFilter, setVerticalFilter] = useState('all');

  const verticals = useMemo<VerticalConfig[]>(() => {
    const existingIds = new Set(BILLY_VERTICALS.map(v => v.id));
    const custom = dbVerticals.filter(v => !existingIds.has(v.id));
    return [...BILLY_VERTICALS, ...custom];
  }, [dbVerticals]);

  const dateFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }, [days]);

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ['portal-live-ads', activeClient?.id, dateFrom, platformFilter],
    enabled: !!activeClient?.id,
    queryFn: async () => {
      let query = supabase
        .from('ad_creatives')
        .select('*')
        .eq('client_id', activeClient!.id)
        .eq('status', 'active')
        .gte('date_from', dateFrom);

      if (platformFilter !== 'all') query = query.eq('platform', platformFilter);

      const { data, error } = await query.order('spend', { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const activeVertical = verticals.find(v => v.id === verticalFilter);

  const filtered = useMemo(() => {
    if (!activeVertical || activeVertical.id === 'all') return ads;
    return ads.filter(ad => {
      const platform = (ad.platform === 'google' ? 'google' : 'meta') as 'meta' | 'google';
      const accountOk = matchesVerticalAccount(null, activeVertical, platform);
      const nameOk = matchesVertical(ad.campaign_name || '', activeVertical, platform);
      return accountOk && nameOk;
    });
  }, [ads, activeVertical]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    [filtered],
  );

  if (!activeClient) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Live Ads</h2>
          <p className="text-xs text-muted-foreground">Currently active creatives — share with your buyers</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map(r => (
                <SelectItem key={r.days} value={String(r.days)}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={verticalFilter} onValueChange={setVerticalFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {verticals.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  <span className="mr-1.5">{v.emoji}</span>{v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="meta">Meta</SelectItem>
              <SelectItem value="google">Google</SelectItem>
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
          No live ads currently running for the selected filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map(ad => {
            const PlatformIcon = ad.platform === 'google' ? Chrome : Facebook;
            const FormatIcon = formatIcons[(ad.format || 'static').toLowerCase()] || ImageIcon;
            const thumb = ad.creative_thumbnail_url;
            return (
              <div
                key={ad.id}
                className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
              >
                {/* Visual */}
                <div className="relative aspect-square w-full overflow-hidden bg-muted">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={ad.ad_name || ad.headline || 'Ad creative'}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-10 w-10" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                    <PlatformIcon className="h-3 w-3" />
                    <span className="capitalize">{ad.platform}</span>
                  </div>
                  <Badge className="absolute right-2 top-2 text-[10px]">Active</Badge>
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div>
                    <p className="line-clamp-1 text-sm font-medium">
                      {ad.ad_name || ad.headline || 'Untitled'}
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{ad.campaign_name}</p>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FormatIcon className="h-3 w-3" />
                    <span className="capitalize">{ad.format || 'Static'}</span>
                  </div>

                  <div className="mt-auto grid grid-cols-3 gap-1.5 border-t pt-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Spend</p>
                      <p className="text-xs font-semibold">{formatCurrency(ad.spend)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">CTR</p>
                      <p className="text-xs font-semibold">{formatPct(ad.ctr)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Conv</p>
                      <p className="text-xs font-semibold">{formatNumber(ad.conversions)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && sorted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {sorted.length} live ad{sorted.length !== 1 ? 's' : ''} shown
        </p>
      )}
    </div>
  );
}
