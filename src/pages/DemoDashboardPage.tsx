import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  generateDemoData,
  inferIndustryFromCompany,
  mapSpendStringToTier,
  type DemoIndustry,
  type DemoSpendTier,
} from '@/data/demoFixtures';
import { DemoKpiGrid } from '@/components/demo/DemoKpiGrid';
import { DemoCalloutCard } from '@/components/demo/DemoCalloutCard';
import { DemoChannelTable } from '@/components/demo/DemoChannelTable';
import { DemoCreativeShowcase } from '@/components/demo/DemoCreativeShowcase';
import { DemoCrossChannel } from '@/components/demo/DemoCrossChannel';
import { DemoRecommendations } from '@/components/demo/DemoRecommendations';
import {
  Sparkles, Layers, Zap, Network, ChartBar, Calendar, ArrowRight, Phone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

type TabId = 'highlights' | 'performance' | 'creatives' | 'cross' | 'recs';

const TABS: Array<{ id: TabId; label: string; icon: typeof Sparkles }> = [
  { id: 'highlights', label: 'Highlights', icon: Sparkles },
  { id: 'performance', label: 'Channels', icon: ChartBar },
  { id: 'creatives', label: 'Creatives', icon: Layers },
  { id: 'cross', label: 'Cross', icon: Network },
  { id: 'recs', label: 'AI Plan', icon: Zap },
];

const INDUSTRY_OPTIONS: Array<{ value: DemoIndustry; label: string }> = [
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'leadgen', label: 'Lead Gen' },
  { value: 'local_services', label: 'Local Services' },
  { value: 'saas', label: 'SaaS / B2B' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'agency', label: 'Agency' },
];

const SPEND_OPTIONS: Array<{ value: DemoSpendTier; label: string }> = [
  { value: 'under_10k', label: '<$10k/mo' },
  { value: '10_25k', label: '$10-25k' },
  { value: '25_50k', label: '$25-50k' },
  { value: '50_100k', label: '$50-100k' },
  { value: '100_250k', label: '$100-250k' },
  { value: '250k_plus', label: '$250k+' },
];

export default function DemoDashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Read from URL params first, fall back to user metadata, then sane defaults
  const userMeta = (user?.user_metadata || {}) as Record<string, string | undefined>;
  const initialCompany = searchParams.get('company') || userMeta.company_name || 'Acme Brand';
  const initialIndustry = (searchParams.get('industry') as DemoIndustry) || inferIndustryFromCompany(initialCompany);
  const initialSpend = (searchParams.get('spend') as DemoSpendTier) || mapSpendStringToTier(userMeta.monthly_ad_spend);

  const [companyName, setCompanyName] = useState(initialCompany);
  const [industry, setIndustry] = useState<DemoIndustry>(initialIndustry);
  const [spendTier, setSpendTier] = useState<DemoSpendTier>(initialSpend);
  const [activeTab, setActiveTab] = useState<TabId>('highlights');
  const [showCustomizer, setShowCustomizer] = useState(false);

  // Persist customizations to URL so the demo can be shared
  useEffect(() => {
    const params = new URLSearchParams();
    if (companyName) params.set('company', companyName);
    params.set('industry', industry);
    params.set('spend', spendTier);
    setSearchParams(params, { replace: true });
  }, [companyName, industry, spendTier, setSearchParams]);

  const data = useMemo(
    () => generateDemoData({ companyName, industry, spendTier }),
    [companyName, industry, spendTier]
  );

  const wins = data.callouts.filter((c) => c.type === 'win');
  const problems = data.callouts.filter((c) => c.type === 'problem');
  const opportunities = data.callouts.filter((c) => c.type === 'opportunity');

  return (
    <div className="min-h-screen bg-[hsl(222,47%,7%)] text-white">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 bg-[hsl(222,47%,7%)]/95 backdrop-blur border-b border-white/5">
        <div className="px-4 py-3 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => navigate('/demo')}
              className="flex items-center gap-2"
              aria-label="Back to demo home"
            >
              <img src="/logo.png" alt="Connect Paid Media" className="h-7 w-7 rounded-lg object-contain" />
              <span className="text-xs font-semibold text-white/80">Connect Paid Media</span>
            </button>
            <button
              onClick={() => setShowCustomizer((s) => !s)}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
            >
              {showCustomizer ? 'Done' : 'Customize'}
            </button>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{data.companyName}</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge className="text-[10px] py-0 h-4 bg-[hsl(94,55%,45%)]/20 text-[hsl(94,55%,60%)] border-[hsl(94,55%,45%)]/30">
                  {data.industryLabel}
                </Badge>
                <span className="text-[10px] text-white/50 tabular-nums">
                  ${data.monthlySpend.toLocaleString()}/mo
                </span>
                <span className="text-[10px] text-white/50">·</span>
                <span className="text-[10px] text-white/50">Last 7 days</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 justify-end">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(94,55%,55%)] animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(94,55%,60%)] font-semibold">Live</span>
              </div>
              <span className="text-[10px] text-white/40 tabular-nums">Updated just now</span>
            </div>
          </div>

          {showCustomizer && (
            <Card className="mt-3 p-3 bg-white/[0.04] border-white/10 space-y-2.5">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-semibold">Company</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white"
                  placeholder="Brand name"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-semibold">Industry</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIndustry(opt.value)}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                        industry === opt.value
                          ? 'bg-[hsl(94,55%,45%)] text-white font-semibold'
                          : 'bg-white/5 text-white/65 hover:bg-white/10'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/50 font-semibold">Monthly Spend</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SPEND_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSpendTier(opt.value)}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                        spendTier === opt.value
                          ? 'bg-[hsl(94,55%,45%)] text-white font-semibold'
                          : 'bg-white/5 text-white/65 hover:bg-white/10'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </header>

      {/* ─── Body ─── */}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-28 space-y-5">
        {activeTab === 'highlights' && (
          <>
            <DemoKpiGrid kpis={data.kpis} />

            {/* Critical leak callout */}
            {problems[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-rose-300">Top Leak</h3>
                </div>
                <DemoCalloutCard callout={problems[0]} />
              </div>
            )}

            {/* Top opportunity */}
            {opportunities[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-amber-200">Top Opportunity</h3>
                </div>
                <DemoCalloutCard callout={opportunities[0]} />
              </div>
            )}

            {/* Top win */}
            {wins[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[hsl(94,55%,55%)]" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-[hsl(94,55%,60%)]">Top Win</h3>
                </div>
                <DemoCalloutCard callout={wins[0]} />
              </div>
            )}

            {/* Total opportunity callout */}
            <Card className="p-4 bg-gradient-to-br from-[hsl(94,55%,45%)]/15 via-white/[0.03] to-amber-400/10 border-[hsl(94,55%,45%)]/30">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(94,55%,45%)]/20">
                  <Sparkles className="h-5 w-5 text-[hsl(94,55%,55%)]" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[hsl(94,55%,60%)] font-bold">Total Recoverable</p>
                  <p className="text-2xl font-bold text-white tabular-nums leading-tight">
                    ${Math.round(data.kpis[0].rawValue * 0.18).toLocaleString()}/wk
                  </p>
                  <p className="text-xs text-white/65 leading-relaxed mt-1">
                    AI identified {data.recommendations.length} actions that could recover this lost revenue. Tap "AI Plan" for the full breakdown.
                  </p>
                  <button
                    onClick={() => setActiveTab('recs')}
                    className="mt-2 text-[11px] font-semibold text-[hsl(94,55%,60%)] flex items-center gap-1"
                  >
                    See the plan <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </Card>
          </>
        )}

        {activeTab === 'performance' && (
          <>
            <DemoKpiGrid kpis={data.kpis} />
            <DemoChannelTable channels={data.channels} />
          </>
        )}

        {activeTab === 'creatives' && <DemoCreativeShowcase creatives={data.creatives} />}

        {activeTab === 'cross' && <DemoCrossChannel data={data} />}

        {activeTab === 'recs' && <DemoRecommendations recommendations={data.recommendations} />}

        {/* CTA */}
        <Card className="p-4 bg-white/[0.04] border-white/10 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-white">Want this for your real account?</h4>
            <p className="text-xs text-white/60 mt-1 leading-relaxed">
              Connect your Meta + Google accounts in 60 seconds. We'll surface the leaks, wins, and AI recommendations from YOUR data.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-[hsl(94,55%,40%)] hover:bg-[hsl(94,55%,35%)] text-white gap-1.5"
              onClick={() =>
                window.open(
                  'https://calendly.com/charles-connectpaidmedia/30min',
                  '_blank',
                  'noopener,noreferrer'
                )
              }
            >
              <Calendar className="h-3.5 w-3.5" />
              Book a call
            </Button>
            <Button
              variant="outline"
              className="border-white/15 bg-transparent text-white hover:bg-white/5 gap-1.5"
              onClick={() => navigate('/auth')}
            >
              <Phone className="h-3.5 w-3.5" />
              Sign in
            </Button>
          </div>
        </Card>
      </main>

      {/* ─── Bottom Tab Nav (mobile) ─── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[hsl(222,47%,9%)]/95 backdrop-blur border-t border-white/10">
        <div className="max-w-2xl mx-auto grid grid-cols-5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors min-h-[60px]',
                  active ? 'text-[hsl(94,55%,60%)]' : 'text-white/55 hover:text-white/85'
                )}
              >
                <Icon className={cn('h-4 w-4', active && 'scale-110')} strokeWidth={active ? 2.5 : 2} />
                <span className={cn('text-[10px] font-semibold', active && 'text-[hsl(94,55%,60%)]')}>
                  {tab.label}
                </span>
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-[hsl(94,55%,55%)]" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
