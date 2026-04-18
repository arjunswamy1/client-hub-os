/**
 * Industry-aware synthetic demo data for the conference demo dashboard.
 * No real client data is referenced. Numbers are tailored to each prospect's
 * industry vertical and ad-spend tier so the dashboard feels like THEIR account.
 *
 * Designed to surface a clear narrative on a phone screen:
 *   1. Big wins worth celebrating
 *   2. Specific leaks burning budget
 *   3. Creative fatigue + winners
 *   4. Cross-channel attribution story
 *   5. AI recommendations with projected impact
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type DemoIndustry =
  | 'ecommerce'
  | 'leadgen'
  | 'saas'
  | 'local_services'
  | 'healthcare'
  | 'agency'
  | 'other';

export type DemoSpendTier = 'under_10k' | '10_25k' | '25_50k' | '50_100k' | '100_250k' | '250k_plus';

export interface DemoCallout {
  id: string;
  type: 'win' | 'problem' | 'opportunity';
  severity: 'high' | 'medium' | 'low';
  title: string;
  metric: string;
  description: string;
  recommendation?: string;
  projectedImpact?: string;
  vertical?: string;
  platform?: string;
}

export interface DemoKPI {
  label: string;
  value: string;
  rawValue: number;
  change: number;
  isCurrency?: boolean;
  trend?: number[]; // sparkline
}

export interface DemoTrendPoint {
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
}

export interface DemoChannelRow {
  channel: 'Google Search' | 'Google PMax' | 'Meta Prospecting' | 'Meta Retargeting' | 'Call Tracking';
  spend: number;
  revenue: number;
  roas: number;
  conversions: number;
  cpa: number;
  trend: 'up' | 'down' | 'flat';
  changePct: number;
}

export interface DemoCreative {
  id: string;
  thumbnail: string; // emoji as visual
  name: string;
  format: 'Static' | 'Video' | 'Carousel' | 'UGC';
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  frequency: number;
  status: 'winner' | 'fatigued' | 'testing' | 'underperformer';
  insight: string;
}

export interface DemoRecommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium';
  title: string;
  reasoning: string;
  action: string;
  projectedImpact: string;
  effort: 'quick' | 'medium' | 'big';
  category: 'budget' | 'creative' | 'audience' | 'bid' | 'landing';
}

export interface DemoData {
  companyName: string;
  industry: DemoIndustry;
  industryLabel: string;
  spendTier: DemoSpendTier;
  monthlySpend: number;
  kpis: DemoKPI[];
  trend: DemoTrendPoint[];
  channels: DemoChannelRow[];
  creatives: DemoCreative[];
  callouts: DemoCallout[];
  recommendations: DemoRecommendation[];
  crossChannelStory: {
    title: string;
    summary: string;
    metaInfluencedSearchLift: number; // percentage
    callsAttributedToMeta: number;
    incrementalRevenue: number;
  };
}

// ─── Industry profiles ────────────────────────────────────────────────────

const INDUSTRY_PROFILES: Record<DemoIndustry, {
  label: string;
  blendedRoas: number; // baseline blended ROAS
  conversionType: string;
  conversionUnit: string; // 'orders' | 'leads' | 'calls' | 'signups'
  channelMix: Record<DemoChannelRow['channel'], number>; // share of spend
  topCreativeThemes: string[];
  industryLeak: string;
  industryWin: string;
}> = {
  ecommerce: {
    label: 'E-commerce',
    blendedRoas: 3.2,
    conversionType: 'orders',
    conversionUnit: 'orders',
    channelMix: {
      'Google Search': 0.22,
      'Google PMax': 0.28,
      'Meta Prospecting': 0.30,
      'Meta Retargeting': 0.18,
      'Call Tracking': 0.02,
    },
    topCreativeThemes: ['Product Hero', 'UGC Testimonial', 'Carousel - Best Sellers', 'Lifestyle Video'],
    industryLeak: 'Performance Max bleeding into low-intent placements',
    industryWin: 'Branded search defending +$1 LTV multiplier',
  },
  leadgen: {
    label: 'Lead Generation',
    blendedRoas: 4.5,
    conversionType: 'leads',
    conversionUnit: 'leads',
    channelMix: {
      'Google Search': 0.38,
      'Google PMax': 0.10,
      'Meta Prospecting': 0.20,
      'Meta Retargeting': 0.12,
      'Call Tracking': 0.20,
    },
    topCreativeThemes: ['Quote Form CTA', 'Before/After', 'Customer Story', 'Direct-Response Hook'],
    industryLeak: 'Lead form abandons + low-quality FB leads from broad audiences',
    industryWin: 'Phone calls converting 3x better than form-fills',
  },
  saas: {
    label: 'SaaS / B2B',
    blendedRoas: 2.4,
    conversionType: 'trials',
    conversionUnit: 'signups',
    channelMix: {
      'Google Search': 0.45,
      'Google PMax': 0.05,
      'Meta Prospecting': 0.25,
      'Meta Retargeting': 0.20,
      'Call Tracking': 0.05,
    },
    topCreativeThemes: ['Demo Video', 'Feature Comparison', 'Case Study', 'Free Trial Hook'],
    industryLeak: 'Search bidding on competitor terms with low conversion intent',
    industryWin: 'LinkedIn-style retargeting beating prospecting on demo requests',
  },
  local_services: {
    label: 'Local Services',
    blendedRoas: 5.8,
    conversionType: 'service calls',
    conversionUnit: 'calls',
    channelMix: {
      'Google Search': 0.45,
      'Google PMax': 0.15,
      'Meta Prospecting': 0.10,
      'Meta Retargeting': 0.05,
      'Call Tracking': 0.25,
    },
    topCreativeThemes: ['Emergency CTA', 'Local Trust Badges', '5-Star Review', 'Service-Area Video'],
    industryLeak: 'Out-of-service-area clicks wasting spend',
    industryWin: 'Call extensions driving 60% of conversions',
  },
  healthcare: {
    label: 'Healthcare / Wellness',
    blendedRoas: 3.6,
    conversionType: 'appointments',
    conversionUnit: 'appointments',
    channelMix: {
      'Google Search': 0.42,
      'Google PMax': 0.08,
      'Meta Prospecting': 0.22,
      'Meta Retargeting': 0.13,
      'Call Tracking': 0.15,
    },
    topCreativeThemes: ['Patient Story', 'Doctor Intro', 'Service Education', 'Before/After'],
    industryLeak: 'Disapproved ads in Meta limiting reach',
    industryWin: 'Educational video content driving high-intent inbound',
  },
  agency: {
    label: 'Agency / Services',
    blendedRoas: 4.0,
    conversionType: 'qualified leads',
    conversionUnit: 'leads',
    channelMix: {
      'Google Search': 0.40,
      'Google PMax': 0.08,
      'Meta Prospecting': 0.22,
      'Meta Retargeting': 0.20,
      'Call Tracking': 0.10,
    },
    topCreativeThemes: ['Case Study Reel', 'Founder POV', 'Results Carousel', 'Client Testimonial'],
    industryLeak: 'Broad audience prospecting with no creative testing cadence',
    industryWin: 'Founder-led video content cutting CPA in half',
  },
  other: {
    label: 'Direct Response',
    blendedRoas: 3.0,
    conversionType: 'conversions',
    conversionUnit: 'conversions',
    channelMix: {
      'Google Search': 0.30,
      'Google PMax': 0.20,
      'Meta Prospecting': 0.25,
      'Meta Retargeting': 0.15,
      'Call Tracking': 0.10,
    },
    topCreativeThemes: ['Hero Offer', 'Testimonial', 'Comparison', 'Limited-Time'],
    industryLeak: 'Underperforming PMax campaign leaking budget',
    industryWin: 'Top creative carrying the account',
  },
};

const SPEND_TIER_BUDGETS: Record<DemoSpendTier, number> = {
  under_10k: 7500,
  '10_25k': 18000,
  '25_50k': 38000,
  '50_100k': 75000,
  '100_250k': 175000,
  '250k_plus': 550000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

const fmtNumber = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n.toFixed(0)}`;

// Deterministic-ish jitter so the same inputs produce the same output but feel random
function seedRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ─── Industry/spend mappers ───────────────────────────────────────────────

export function mapSpendStringToTier(spend?: string | null): DemoSpendTier {
  if (!spend) return '25_50k';
  const s = spend.toLowerCase();
  if (s.includes('under') || s.includes('10,000')) return 'under_10k';
  if (s.includes('10,000') && s.includes('25,000')) return '10_25k';
  if (s.includes('25,000') && s.includes('50,000')) return '25_50k';
  if (s.includes('50,000') && s.includes('100,000')) return '50_100k';
  if (s.includes('100,000') && s.includes('250,000')) return '100_250k';
  if (s.includes('250,000+') || s.includes('250000+')) return '250k_plus';
  return '25_50k';
}

export function inferIndustryFromCompany(name?: string | null): DemoIndustry {
  if (!name) return 'other';
  const n = name.toLowerCase();
  if (/shop|store|brand|apparel|beauty|cosmetic|supplement|gear|coffee|tea|wine|food|drink/.test(n)) return 'ecommerce';
  if (/agency|marketing|media|consulting|consultancy/.test(n)) return 'agency';
  if (/saas|software|app|cloud|tech|platform|api|.io|.ai/.test(n)) return 'saas';
  if (/clinic|health|medical|dental|wellness|therapy|spa/.test(n)) return 'healthcare';
  if (/plumb|hvac|roof|electric|repair|service|contractor|landscap|cleaning|pest/.test(n)) return 'local_services';
  if (/lead|insurance|loan|legal|law|attorney|finance|mortgage/.test(n)) return 'leadgen';
  return 'other';
}

// ─── Generator ────────────────────────────────────────────────────────────

export function generateDemoData(opts: {
  companyName?: string;
  industry?: DemoIndustry;
  spendTier?: DemoSpendTier;
}): DemoData {
  const companyName = opts.companyName || 'Your Brand';
  const industry = opts.industry || inferIndustryFromCompany(companyName);
  const spendTier = opts.spendTier || '25_50k';
  const profile = INDUSTRY_PROFILES[industry];
  const monthlySpend = SPEND_TIER_BUDGETS[spendTier];

  // Stable randomness per company name + tier so refresh shows same data
  const seed = (companyName.length * 17 + monthlySpend) % 99991;
  const rand = seedRand(seed);
  const jitter = (base: number, pct = 0.1) => base * (1 + (rand() - 0.5) * 2 * pct);

  // Last 7 days view - weekly spend = monthly / 4.3
  const weeklySpend = monthlySpend / 4.3;
  const blendedRoas = jitter(profile.blendedRoas, 0.05);
  const weeklyRevenue = weeklySpend * blendedRoas;
  const weeklyConversions = Math.round(weeklyRevenue / (industry === 'leadgen' ? 80 : industry === 'local_services' ? 220 : 95));

  // ── KPIs with sparklines ──
  const sparkline = (peak: number) =>
    Array.from({ length: 7 }, (_, i) => peak * (0.7 + rand() * 0.5) * (1 + i * 0.02));

  const kpis: DemoKPI[] = [
    {
      label: 'Total Spend',
      value: fmtCurrency(weeklySpend),
      rawValue: weeklySpend,
      change: Math.round(jitter(11, 0.5)),
      isCurrency: true,
      trend: sparkline(weeklySpend / 7),
    },
    {
      label: 'Revenue',
      value: fmtCurrency(weeklyRevenue),
      rawValue: weeklyRevenue,
      change: Math.round(jitter(24, 0.4)),
      isCurrency: true,
      trend: sparkline(weeklyRevenue / 7),
    },
    {
      label: 'Blended ROAS',
      value: `${blendedRoas.toFixed(2)}x`,
      rawValue: blendedRoas,
      change: Math.round(jitter(13, 0.4)),
      trend: sparkline(blendedRoas),
    },
    {
      label: profile.conversionUnit.charAt(0).toUpperCase() + profile.conversionUnit.slice(1),
      value: fmtNumber(weeklyConversions),
      rawValue: weeklyConversions,
      change: Math.round(jitter(18, 0.4)),
      trend: sparkline(weeklyConversions / 7),
    },
  ];

  // ── 7-day trend ──
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const trend: DemoTrendPoint[] = days.map((d, i) => {
    const dailySpend = (weeklySpend / 7) * (0.85 + rand() * 0.3);
    const dailyRoas = blendedRoas * (0.8 + rand() * 0.4);
    return {
      date: d,
      spend: Math.round(dailySpend),
      revenue: Math.round(dailySpend * dailyRoas),
      conversions: Math.round((dailySpend * dailyRoas) / 95),
    };
  });

  // ── Channel breakdown ──
  const channels: DemoChannelRow[] = (Object.entries(profile.channelMix) as [DemoChannelRow['channel'], number][])
    .filter(([, share]) => share > 0.01)
    .map(([channel, share]) => {
      const channelSpend = weeklySpend * share;
      // Each channel has a different ROAS multiplier vs blended
      const roasMultiplier = channel === 'Google Search'
        ? 1.4
        : channel === 'Meta Retargeting'
          ? 1.6
          : channel === 'Google PMax'
            ? rand() < 0.5 ? 0.75 : 1.1 // PMax is the leak in many accounts
            : channel === 'Call Tracking'
              ? 1.8
              : 0.85;
      const channelRoas = blendedRoas * roasMultiplier * (0.9 + rand() * 0.2);
      const revenue = channelSpend * channelRoas;
      const conversions = Math.round(revenue / 95);
      const change = Math.round((rand() - 0.4) * 40);
      return {
        channel,
        spend: Math.round(channelSpend),
        revenue: Math.round(revenue),
        roas: Number(channelRoas.toFixed(2)),
        conversions,
        cpa: Math.round(channelSpend / Math.max(1, conversions)),
        trend: change > 5 ? 'up' : change < -5 ? 'down' : 'flat',
        changePct: change,
      };
    });

  // ── Creatives ──
  const creativeEmojis = ['🎬', '📸', '🎯', '💎', '🔥', '⚡', '🌟', '💡'];
  const creatives: DemoCreative[] = profile.topCreativeThemes.map((theme, i) => {
    const isWinner = i === 0;
    const isFatigued = i === 1;
    const isUnder = i === 3;
    const baseSpend = (weeklySpend / 6) * (isWinner ? 2.2 : isFatigued ? 1.4 : 0.8);
    const creativeRoas = isWinner ? blendedRoas * 1.8 : isFatigued ? blendedRoas * 0.6 : isUnder ? blendedRoas * 0.4 : blendedRoas * 1.1;
    const revenue = baseSpend * creativeRoas;
    return {
      id: `c${i}`,
      thumbnail: creativeEmojis[i % creativeEmojis.length],
      name: theme,
      format: i === 0 ? 'Video' : i === 1 ? 'Static' : i === 2 ? 'Carousel' : 'UGC',
      spend: Math.round(baseSpend),
      revenue: Math.round(revenue),
      roas: Number(creativeRoas.toFixed(2)),
      ctr: Number((isWinner ? 2.4 : isFatigued ? 0.6 : 1.3).toFixed(2)),
      frequency: Number((isWinner ? 2.1 : isFatigued ? 8.4 : isUnder ? 5.8 : 3.2).toFixed(1)),
      status: isWinner ? 'winner' : isFatigued ? 'fatigued' : isUnder ? 'underperformer' : 'testing',
      insight: isWinner
        ? `Carrying the account - drives ${Math.round((revenue / weeklyRevenue) * 100)}% of revenue. Scale variants this week.`
        : isFatigued
          ? `Frequency at 8.4x - CTR collapsed from 2.1% to 0.6%. Refresh or kill.`
          : isUnder
            ? `Negative ROAS contribution. Pause and reallocate to top performer.`
            : `In testing - needs more spend to reach statistical significance.`,
    };
  });

  // ── Callouts (wins / problems / opportunities) ──
  const wastedSpendChannel = channels.find(c => c.roas < blendedRoas * 0.85);
  const topChannel = [...channels].sort((a, b) => b.roas - a.roas)[0];
  const wastedAmount = wastedSpendChannel ? Math.round(wastedSpendChannel.spend * 0.35) : 0;

  const callouts: DemoCallout[] = [
    {
      id: 'w1',
      type: 'win',
      severity: 'high',
      title: `${topChannel.channel} delivering ${topChannel.roas.toFixed(1)}x ROAS`,
      metric: `${topChannel.roas.toFixed(2)}x`,
      description: `${topChannel.channel} is your strongest channel this week - ${fmtCurrency(topChannel.revenue)} in revenue from ${fmtCurrency(topChannel.spend)} spend.`,
      platform: topChannel.channel,
    },
    {
      id: 'w2',
      type: 'win',
      severity: 'medium',
      title: `Top creative carrying the account`,
      metric: fmtCurrency(creatives[0].revenue),
      description: `"${creatives[0].name}" drove ${Math.round((creatives[0].revenue / weeklyRevenue) * 100)}% of total revenue this week - clear winner to scale.`,
      platform: 'Meta',
    },
    ...(wastedSpendChannel ? [{
      id: 'p1',
      type: 'problem' as const,
      severity: 'high' as const,
      title: `${wastedSpendChannel.channel} below break-even`,
      metric: `${wastedSpendChannel.roas.toFixed(2)}x`,
      description: `${wastedSpendChannel.channel} is returning less than $1 for every $1 spent. Approximately ${fmtCurrency(wastedAmount)} of weekly spend at risk.`,
      recommendation: `Pause underperforming asset groups and reallocate to ${topChannel.channel}.`,
      projectedImpact: `+${fmtCurrency(wastedAmount * 1.2)} weekly revenue`,
      platform: wastedSpendChannel.channel,
    }] : []),
    {
      id: 'p2',
      type: 'problem',
      severity: 'high',
      title: 'Creative fatigue detected',
      metric: '8.4x frequency',
      description: `Top retargeting ad shown 8.4x to same users this week. CTR dropped 71% - audience is burned out.`,
      recommendation: `Refresh creative or expand audience. Use top-performing variant as the new control.`,
      projectedImpact: `+18% CTR recovery`,
      platform: 'Meta',
    },
    {
      id: 'p3',
      type: 'problem',
      severity: 'medium',
      title: profile.industryLeak,
      metric: fmtCurrency(weeklySpend * 0.04),
      description: `Search terms report shows wasted spend on irrelevant queries this week.`,
      recommendation: 'Add 14 negative keywords across active search campaigns.',
      projectedImpact: `Recover ${fmtCurrency(weeklySpend * 0.04)}/week`,
      platform: 'Google',
    },
    {
      id: 'o1',
      type: 'opportunity',
      severity: 'high',
      title: 'Cross-channel halo effect untapped',
      metric: `+${Math.round(jitter(34, 0.2))}%`,
      description: `Days when Meta spend is high, branded search clicks lift +34% - but you're not budgeting for the halo.`,
      recommendation: 'Increase Meta prospecting by 20% on days you push branded search.',
      projectedImpact: `+${fmtCurrency(weeklyRevenue * 0.12)} weekly`,
    },
  ];

  // ── AI Recommendations ──
  const recommendations: DemoRecommendation[] = [
    {
      id: 'r1',
      priority: 'critical',
      title: `Reallocate ${fmtCurrency(wastedAmount || weeklySpend * 0.08)} from underperforming PMax to top search campaign`,
      reasoning: `${wastedSpendChannel?.channel || 'Performance Max'} ROAS (${(wastedSpendChannel?.roas || 0.8).toFixed(2)}x) is 60% below your top campaign. Reallocating frees up budget without raising total spend.`,
      action: `Lower PMax daily budget by 30%. Increase top search campaign by the same amount.`,
      projectedImpact: `+${fmtCurrency(weeklyRevenue * 0.15)} weekly revenue`,
      effort: 'quick',
      category: 'budget',
    },
    {
      id: 'r2',
      priority: 'high',
      title: `Launch 3 variants of "${creatives[0].name}" this week`,
      reasoning: `Your top creative is driving ${Math.round((creatives[0].revenue / weeklyRevenue) * 100)}% of revenue at ${creatives[0].roas.toFixed(1)}x ROAS. Single point of failure - and we're leaving scale on the table.`,
      action: `Brief 3 variants: hook change, format swap (video → carousel), and audience-specific cut.`,
      projectedImpact: `+${fmtCurrency(weeklyRevenue * 0.22)} potential weekly`,
      effort: 'medium',
      category: 'creative',
    },
    {
      id: 'r3',
      priority: 'high',
      title: 'Refresh fatigued retargeting creative',
      reasoning: 'Frequency hit 8.4x with collapsing CTR. Spend is going to people who already saw the ad and didn\'t convert.',
      action: 'Pause current ad. Promote the next-best testing variant to primary.',
      projectedImpact: `+18% CTR, ${fmtCurrency(weeklySpend * 0.06)} efficiency gain`,
      effort: 'quick',
      category: 'creative',
    },
    {
      id: 'r4',
      priority: 'medium',
      title: 'Add 14 negative keywords to search campaigns',
      reasoning: `Search terms report shows ~${fmtCurrency(weeklySpend * 0.04)}/week going to irrelevant queries (e.g. "free", "cheap", "diy").`,
      action: 'Apply negative keyword list across 3 active search campaigns.',
      projectedImpact: `Recover ${fmtCurrency(weeklySpend * 0.04 * 4)}/month`,
      effort: 'quick',
      category: 'audience',
    },
    {
      id: 'r5',
      priority: 'medium',
      title: 'Test landing page variant for top campaign',
      reasoning: 'Conversion rate on primary LP dropped from 2.4% to 1.7% week-over-week. Likely culprit: form length added Tuesday.',
      action: 'A/B test a 3-field form vs the current 6-field form.',
      projectedImpact: `+${Math.round(jitter(28, 0.2))}% conversion rate`,
      effort: 'medium',
      category: 'landing',
    },
  ];

  // ── Cross-channel attribution story ──
  const crossChannelStory = {
    title: 'Meta lifts Google performance by 34%',
    summary: `On days you spend more on Meta prospecting, branded search clicks rise +34% and call volume rises +28% - pure halo effect that single-channel attribution misses.`,
    metaInfluencedSearchLift: 34,
    callsAttributedToMeta: Math.round(weeklyConversions * 0.18),
    incrementalRevenue: Math.round(weeklyRevenue * 0.21),
  };

  return {
    companyName,
    industry,
    industryLabel: profile.label,
    spendTier,
    monthlySpend,
    kpis,
    trend,
    channels,
    creatives,
    callouts,
    recommendations,
    crossChannelStory,
  };
}

// ─── Backwards-compat exports for existing PerformanceCallouts ────────────

export const DEMO_KPIS: DemoKPI[] = generateDemoData({}).kpis;
export const DEMO_TREND: DemoTrendPoint[] = generateDemoData({}).trend;
export const DEMO_CALLOUTS: DemoCallout[] = generateDemoData({}).callouts;
export const DEMO_VERTICALS = ['All Verticals', 'E-commerce', 'Lead Gen', 'Brand', 'Local Services'];
export const DEMO_PLATFORMS = ['All Platforms', 'Google', 'Meta', 'Cross-channel', 'Google Search', 'Google PMax', 'Meta Prospecting', 'Meta Retargeting'];
