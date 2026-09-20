/**
 * Roku's reporting feed carries delivery only — spend, impressions, completions.
 * It exposes no bid-strategy or audience objects the way Meta's graph does, so the
 * buying setup for a Roku campaign lives in the name the buyer typed. These helpers
 * READ that name and nothing more: every value here is a label the buyer wrote, not
 * a field the platform confirmed, and the UI must say so wherever it shows them.
 */
export interface RokuCampaignAttributes {
  /** Daily budget cap as written in the name, e.g. "$8k/day" → 8000. */
  dailyBudget: number | null;
  /** EST / CST / PST grouping the buyer used to split delivery. */
  timezone: string | null;
  /** Hours of the day the buyer restricted delivery to, verbatim. */
  daypart: string | null;
  /** Geography note: "All States", "No CA", "Georgia", "exc GA", etc. */
  geo: string | null;
  /** Buying intent the buyer tagged: awareness, winners, expansion, test. */
  intent: string | null;
  /** Genre or inventory target, e.g. "All Genres (Target 1279)". */
  genreTarget: string | null;
  /** Tracking number embedded in the name, normalised to E.164. */
  did: string | null;
  /** Date prefix the buyer used to version the campaign, e.g. "9/13". */
  launchLabel: string | null;
}

const BUDGET = /\$\s?([\d.]+)\s?(k)?\s?\/?\s?day/i;
const TZ = /\b(EST|CST|MST|PST|ET|CT|PT)\b/i;
const DAYPART = /\(?\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM)?\s?[-–]\s?\d{1,2}(?::\d{2})?\s?(?:AM|PM)?(?:\s?[A-Z]{2,3})?)\b\)?/i;
const DID = /\b1?(8\d{9})\b/;
const LAUNCH = /^(\d{1,2}[./]\d{1,2})/;
const GENRE = /(all genres[^-]*)/i;
const INTENTS: Array<[RegExp, string]> = [
  [/\[awareness\]/i, "awareness"],
  [/\bwinners?\b/i, "winners"],
  [/\bexpansion\b/i, "expansion"],
  [/\btest\b/i, "test"],
  [/\bretarget/i, "retargeting"],
];
const GEOS: RegExp[] = [
  /\bmainland states\b/i,
  /\ball states\b/i,
  /\bno\s+[A-Z]{2}\b/,
  /\bexc\.?\s+[A-Z]{2}\b/i,
  /\b(?:CA|NV|GA|TX|FL|NY|NC|AZ|OH|PA)(?:,\s?(?:CA|NV|GA|TX|FL|NY|NC|AZ|OH|PA))+\b/,
  /\bGeorgia\b/i,
];

export function parseRokuCampaignName(name: string): RokuCampaignAttributes {
  const budgetMatch = name.match(BUDGET);
  let dailyBudget: number | null = null;
  if (budgetMatch) {
    const value = Number(budgetMatch[1]);
    if (Number.isFinite(value)) dailyBudget = budgetMatch[2] ? value * 1000 : value;
  }

  const didMatch = name.match(DID);
  const genreMatch = name.match(GENRE);
  const geo = GEOS.map((r) => name.match(r)?.[0]).find(Boolean) ?? null;
  const intent = INTENTS.find(([r]) => r.test(name))?.[1] ?? null;
  const daypart = name.match(DAYPART)?.[1]?.trim() ?? null;

  return {
    dailyBudget,
    timezone: name.match(TZ)?.[1]?.toUpperCase() ?? null,
    daypart,
    geo: geo ? geo.trim() : null,
    intent,
    genreTarget: genreMatch ? genreMatch[1].replace(/\s+$/, "") : null,
    did: didMatch ? `+1${didMatch[1]}` : null,
    launchLabel: name.match(LAUNCH)?.[1] ?? null,
  };
}
