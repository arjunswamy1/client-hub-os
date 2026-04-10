import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useState } from 'react';
import { Chrome, Facebook, Image, Video, LayoutGrid, Search, ExternalLink } from 'lucide-react';

interface Props {
  clientId: string;
}

const VERTICALS = [
  { value: 'all', label: 'All Verticals' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'flights', label: 'Flights' },
  { value: 'porta_potty', label: 'Porta Potty' },
  { value: 'siding', label: 'Siding' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'moving', label: 'Moving' },
  { value: 'other', label: 'Other' },
];

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  enabled: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  paused: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  removed: 'bg-red-500/10 text-red-700 border-red-500/20',
};

const creativeTypeIcon: Record<string, any> = {
  image: Image,
  video: Video,
  carousel: LayoutGrid,
  search: Search,
};

function fmt$(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDec(n: number, digits = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function LiveAdsTracker({ clientId }: Props) {
  const { dateRange } = useDateRange();
  const [vertical, setVertical] = useState('all');

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ['ad_creatives', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_creatives')
        .select('*')
        .eq('client_id', clientId)
        .order('spend', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  const filtered = vertical === 'all' ? ads : ads.filter((a: any) => a.vertical === vertical);
  const metaAds = filtered.filter((a: any) => a.platform === 'meta');
  const googleAds = filtered.filter((a: any) => a.platform === 'google');

  // Detect which verticals actually have data
  const activeVerticals = VERTICALS.filter(v => v.value === 'all' || ads.some((a: any) => a.vertical === v.value));

  return (
    <div className="space-y-4">
      {/* Vertical selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">Vertical:</span>
        {activeVerticals.map(v => (
          <Badge
            key={v.value}
            variant={vertical === v.value ? 'default' : 'outline'}
            className="cursor-pointer text-xs px-3 py-1 transition-colors"
            onClick={() => setVertical(v.value)}
          >
            {v.label}
            {v.value !== 'all' && (
              <span className="ml-1.5 opacity-60">
                ({ads.filter((a: any) => a.vertical === v.value).length})
              </span>
            )}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No ad creative data found for this vertical. Sync your ad platforms to populate.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={metaAds.length > 0 ? 'meta' : 'google'} className="space-y-4">
          <TabsList className="bg-secondary/50">
            {metaAds.length > 0 && (
              <TabsTrigger value="meta" className="gap-1.5 text-xs">
                <Facebook className="h-3.5 w-3.5" />
                Meta Ads ({metaAds.length})
              </TabsTrigger>
            )}
            {googleAds.length > 0 && (
              <TabsTrigger value="google" className="gap-1.5 text-xs">
                <Chrome className="h-3.5 w-3.5" />
                Google Ads ({googleAds.length})
              </TabsTrigger>
            )}
          </TabsList>

          {metaAds.length > 0 && (
            <TabsContent value="meta">
              <MetaAdGrid ads={metaAds} />
            </TabsContent>
          )}
          {googleAds.length > 0 && (
            <TabsContent value="google">
              <GoogleAdList ads={googleAds} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

function MetaAdGrid({ ads }: { ads: any[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {ads.map((ad: any) => {
        const Icon = creativeTypeIcon[ad.creative_type] || Image;
        return (
          <Card key={ad.id} className="overflow-hidden group hover:shadow-md transition-shadow">
            {/* Creative thumbnail */}
            <div className="relative aspect-square bg-muted">
              {ad.creative_thumbnail_url ? (
                <img
                  src={ad.creative_thumbnail_url}
                  alt={ad.ad_name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Icon className="h-10 w-10 text-muted-foreground/30" />
                </div>
              )}
              {/* Status badge overlay */}
              <div className="absolute top-2 left-2">
                <Badge variant="outline" className={`text-[10px] border ${statusColors[ad.status] || 'bg-muted text-muted-foreground'}`}>
                  {ad.status}
                </Badge>
              </div>
              {/* Creative type badge */}
              <div className="absolute top-2 right-2">
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Icon className="h-3 w-3" />
                  {ad.creative_type}
                </Badge>
              </div>
            </div>

            <CardContent className="p-3 space-y-2">
              {/* Ad name */}
              <p className="text-xs font-semibold truncate" title={ad.ad_name}>{ad.ad_name}</p>
              <p className="text-[10px] text-muted-foreground truncate" title={ad.campaign_name}>{ad.campaign_name}</p>

              {/* Primary text preview */}
              {ad.primary_text && (
                <p className="text-[11px] text-muted-foreground line-clamp-2">{ad.primary_text}</p>
              )}

              {/* Performance metrics */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t">
                <MetricRow label="Spend" value={fmt$(ad.spend || 0)} />
                <MetricRow label="Clicks" value={fmtDec(ad.clicks || 0, 0)} />
                <MetricRow label="Conv." value={fmtDec(ad.conversions || 0, 0)} />
                <MetricRow label="ROAS" value={ad.roas ? `${fmtDec(ad.roas)}x` : '—'} />
                <MetricRow label="CPA" value={ad.cpa ? fmt$(ad.cpa) : '—'} />
                <MetricRow label="CTR" value={ad.ctr ? `${fmtDec(ad.ctr, 1)}%` : '—'} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function GoogleAdList({ ads }: { ads: any[] }) {
  return (
    <div className="space-y-3">
      {ads.map((ad: any) => (
        <Card key={ad.id} className="hover:shadow-sm transition-shadow">
          <CardContent className="p-4">
            <div className="flex gap-6">
              {/* Google SERP-style preview */}
              <div className="flex-1 min-w-0 space-y-1">
                {/* URL line */}
                {ad.final_url && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="truncate">{ad.display_url || ad.final_url}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </div>
                )}
                {/* Headlines */}
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  {ad.headlines?.slice(0, 3).join(' | ') || ad.ad_name}
                </div>
                {/* Descriptions */}
                {ad.descriptions && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {ad.descriptions.slice(0, 2).join(' ')}
                  </p>
                )}
                {/* Ad group */}
                <div className="flex items-center gap-2 pt-1">
                  <Badge variant="outline" className="text-[10px]">{ad.adset_name || 'Ad Group'}</Badge>
                  <Badge variant="outline" className={`text-[10px] border ${statusColors[ad.status] || ''}`}>
                    {ad.status}
                  </Badge>
                </div>
              </div>

              {/* Performance metrics */}
              <div className="flex items-center gap-4 shrink-0 text-right">
                <MetricCol label="Spend" value={fmt$(ad.spend || 0)} />
                <MetricCol label="Clicks" value={fmtDec(ad.clicks || 0, 0)} />
                <MetricCol label="Conv." value={fmtDec(ad.conversions || 0, 0)} />
                <MetricCol label="CPA" value={ad.cpa ? fmt$(ad.cpa) : '—'} highlight={ad.cpa && ad.cpa < 150} />
                <MetricCol label="CTR" value={ad.ctr ? `${fmtDec(ad.ctr, 1)}%` : '—'} />
                <MetricCol label="ROAS" value={ad.roas ? `${fmtDec(ad.roas)}x` : '—'} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium">{value}</span>
    </div>
  );
}

function MetricCol({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-[52px]">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight ? 'text-emerald-600' : ''}`}>{value}</p>
    </div>
  );
}
