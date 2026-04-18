/**
 * Fully fabricated, anonymized demo data for the conference demo dashboard.
 * No real client data is referenced. Numbers are crafted to tell a story:
 * clear wins to celebrate AND clear problems to call out — so prospects
 * see how the Hub surfaces both.
 */

export interface DemoCallout {
  id: string;
  type: 'win' | 'problem';
  severity: 'high' | 'medium' | 'low';
  title: string;
  metric: string;
  description: string;
  recommendation?: string;
  vertical?: string;
  platform?: string;
}

export const DEMO_CALLOUTS: DemoCallout[] = [
  // WINS
  {
    id: 'w1',
    type: 'win',
    severity: 'high',
    title: 'Google Search ROAS up 38%',
    metric: '4.2x ROAS',
    description: 'Brand + non-brand search campaigns are returning $4.20 for every $1 spent — best week this quarter.',
    vertical: 'E-commerce',
    platform: 'Google',
  },
  {
    id: 'w2',
    type: 'win',
    severity: 'medium',
    title: 'Meta CPL dropped 22%',
    metric: '$18.40 CPL',
    description: 'Lead gen campaigns hit a new low cost per lead after creative refresh on Tuesday.',
    vertical: 'Lead Gen',
    platform: 'Meta',
  },
  {
    id: 'w3',
    type: 'win',
    severity: 'medium',
    title: 'Top creative driving 41% of revenue',
    metric: '$28,400',
    description: 'A single static ad concept is carrying the account — opportunity to scale variants.',
    vertical: 'E-commerce',
    platform: 'Meta',
  },

  // PROBLEMS
  {
    id: 'p1',
    type: 'problem',
    severity: 'high',
    title: 'Google Performance Max bleeding budget',
    metric: '0.8x ROAS',
    description: 'PMax campaign spent $4,200 last week with only $3,360 in revenue — losing $840/wk.',
    recommendation: 'Pause asset group "Broad Audience" and reallocate to the top-performing search campaign.',
    vertical: 'E-commerce',
    platform: 'Google',
  },
  {
    id: 'p2',
    type: 'problem',
    severity: 'high',
    title: 'Meta frequency cap exceeded',
    metric: '8.4x frequency',
    description: 'Top retargeting ad set has shown to the same users 8x in 7 days. CTR dropped from 2.1% → 0.6%.',
    recommendation: 'Refresh creative or expand audience — current ads are fatigued.',
    vertical: 'E-commerce',
    platform: 'Meta',
  },
  {
    id: 'p3',
    type: 'problem',
    severity: 'medium',
    title: 'Landing page conversion rate dropped',
    metric: '1.2% → 0.7%',
    description: 'Conversion rate on /lp/spring-offer fell 42% week-over-week — possible page speed or form regression.',
    recommendation: 'Audit page load time and form fields. Likely culprit: new tracking pixel added Monday.',
    vertical: 'Lead Gen',
    platform: 'Cross-channel',
  },
  {
    id: 'p4',
    type: 'problem',
    severity: 'medium',
    title: 'Negative keywords missing on 3 campaigns',
    metric: '$680 wasted',
    description: 'Search terms report shows $680 spent on irrelevant queries (e.g. "free", "cheap", "diy").',
    recommendation: 'Add 14 negative keywords across Google Search campaigns to block waste.',
    vertical: 'E-commerce',
    platform: 'Google',
  },
];

export interface DemoKPI {
  label: string;
  value: string;
  change: number; // percent change vs prior period
  isCurrency?: boolean;
}

export const DEMO_KPIS: DemoKPI[] = [
  { label: 'Total Spend', value: '$48,200', change: 12, isCurrency: true },
  { label: 'Total Revenue', value: '$142,800', change: 28, isCurrency: true },
  { label: 'Blended ROAS', value: '2.96x', change: 14 },
  { label: 'Conversions', value: '1,247', change: 19 },
];

export const DEMO_VERTICALS = ['All Verticals', 'E-commerce', 'Lead Gen', 'Brand'];
export const DEMO_PLATFORMS = ['All Platforms', 'Google', 'Meta', 'Cross-channel'];

export interface DemoTrendPoint {
  date: string;
  spend: number;
  revenue: number;
}

export const DEMO_TREND: DemoTrendPoint[] = [
  { date: 'Mon', spend: 6400, revenue: 18200 },
  { date: 'Tue', spend: 6800, revenue: 21400 },
  { date: 'Wed', spend: 7100, revenue: 19800 },
  { date: 'Thu', spend: 6900, revenue: 22600 },
  { date: 'Fri', spend: 7400, revenue: 24800 },
  { date: 'Sat', spend: 6800, revenue: 19600 },
  { date: 'Sun', spend: 6800, revenue: 16400 },
];
