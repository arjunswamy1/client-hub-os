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

  const userMeta = (user?.user_metadata || {}) as Record<string, string | undefined>;
  const initialCompany = searchParams.get('company') || userMeta.company_name || 'Acme Brand';
  const initialIndustry = (searchParams.get('industry') as DemoIndustry) || inferIndustryFromCompany(initialCompany);
  const initialSpend =
    (searchParams.get('spend') as DemoSpendTier) ||
    (userMeta.monthly_ad_spend ? mapSpendStringToTier(userMeta.monthly_ad_spend) : '250k_plus');

  const [companyName, setCompanyName] = useState(initialCompany);
  const [industry, setIndustry] = useState<DemoIndustry>(initialIndustry);
  const [spendTier, setSpendTier] = useState<DemoSpendTier>(initialSpend);
  const [activeTab, setActiveTab] = useState<TabId>('highlights');
  const [showCustomizer, setShowCustomizer] = useState(false);

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="px-4 py-3 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => navigate('/demo')}
              className="flex items-center gap-2"
              aria-label="Back to demo home"
            >
              <img src="/logo.png" alt="Connect Paid Media" className="h-7 w-7 rounded-lg object-contain" />
              <span className="text-xs font-semibold text-slate-700">Connect Paid Media</span>
            </button>
            <button
              onClick={() => setShowCustomizer((s) => !s)}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              {showCustomizer ? 'Done' : 'Customize'}
            </button>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 truncate">{data.companyName}</h1>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge className="text-[10px] py-0 h-4 bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,28%)] border-[hsl(94,55%,45%)]/30">
                  {data.industryLabel}
                </Badge>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  ${data.monthlySpend.toLocaleString()}/mo
                </span>
                <span className="text-[10px] text-slate-400">·</span>
                <span className="text-[10px] text-slate-500">Last 7 days</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 justify-end">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(94,55%,45%)] animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(94,55%,32%)] font-semibold">Live</span>
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">Updated just now</span>
            </div>
          </div>

          {showCustomizer && (
            <Card className="mt-3 p-3 bg-white border-slate-200 shadow-sm space-y-2.5">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Company</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[hsl(94,55%,45%)]/30 focus:border-[hsl(94,55%,45%)]"
                  placeholder="Brand name"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Industry</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIndustry(opt.value)}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors border',
                        industry === opt.value
                          ? 'bg-[hsl(94,55%,38%)] text-white font-semibold border-[hsl(94,55%,38%)]'
                          : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Monthly Spend</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SPEND_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSpendTier(opt.value)}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors border',
                        spendTier === opt.value
                          ? 'bg-[hsl(94,55%,38%)] text-white font-semibold border-[hsl(94,55%,38%)]'
                          : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
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

        {/* ─── Top Tab Nav ─── */}
        <nav className="border-t border-slate-200 bg-white">
          <div className="max-w-2xl mx-auto grid grid-cols-5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors min-h-[52px]',
                    active ? 'text-[hsl(94,55%,32%)]' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <Icon className={cn('h-4 w-4', active && 'scale-110')} strokeWidth={active ? 2.5 : 2} />
                  <span className={cn('text-[10px] font-semibold', active && 'text-[hsl(94,55%,32%)]')}>
                    {tab.label}
                  </span>
                  {active && <span className="absolute bottom-0 h-0.5 w-8 rounded-t-full bg-[hsl(94,55%,38%)]" />}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* ─── Body ─── */}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-8 space-y-5">
        {activeTab === 'highlights' && (
          <>
            <DemoKpiGrid kpis={data.kpis} />

            {problems[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-rose-600">Top Leak</h3>
                </div>
                <DemoCalloutCard callout={problems[0]} />
              </div>
            )}

            {opportunities[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-amber-700">Top Opportunity</h3>
                </div>
                <DemoCalloutCard callout={opportunities[0]} />
              </div>
            )}

            {wins[0] && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[hsl(94,55%,38%)]" />
                  <h3 className="text-[11px] uppercase tracking-wider font-bold text-[hsl(94,55%,28%)]">Top Win</h3>
                </div>
                <DemoCalloutCard callout={wins[0]} />
              </div>
            )}

            <Card className="p-4 bg-gradient-to-br from-[hsl(94,55%,45%)]/[0.12] via-white to-amber-50 border-[hsl(94,55%,45%)]/30 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(94,55%,45%)]/15">
                  <Sparkles className="h-5 w-5 text-[hsl(94,55%,32%)]" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[hsl(94,55%,28%)] font-bold">Total Recoverable</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
                    ${Math.round(data.kpis[0].rawValue * 0.18).toLocaleString()}/wk
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed mt-1">
                    AI identified {data.recommendations.length} actions that could recover this lost revenue. Tap "AI Plan" for the full breakdown.
                  </p>
                  <button
                    onClick={() => setActiveTab('recs')}
                    className="mt-2 text-[11px] font-semibold text-[hsl(94,55%,28%)] flex items-center gap-1 hover:text-[hsl(94,55%,22%)]"
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
        <Card className="p-4 bg-white border-slate-200 shadow-sm space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Want this for your real account?</h4>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Connect your Meta + Google accounts in 60 seconds. We'll surface the leaks, wins, and AI recommendations from YOUR data.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-[hsl(94,55%,38%)] hover:bg-[hsl(94,55%,32%)] text-white gap-1.5"
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
              className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 gap-1.5"
              onClick={() => navigate('/auth')}
            >
              <Phone className="h-3.5 w-3.5" />
              Sign in
            </Button>
          </div>
        </Card>
      </main>

    </div>
  );
}
