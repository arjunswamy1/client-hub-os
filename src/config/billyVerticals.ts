export interface VerticalConfig {
  id: string;
  label: string;
  emoji: string;
  meta: {
    patterns: string[];
    accountIds?: string[];
  };
  google: {
    patterns: string[];
    accountIds?: string[];
  };
  ringba: {
    patterns: string[];
    exactMatch?: boolean;
  };
}

export const BILLY_VERTICALS: VerticalConfig[] = [
  {
    id: "all",
    label: "All Verticals",
    emoji: "📊",
    meta: { patterns: [] },
    google: { patterns: [] },
    ringba: { patterns: [] },
  },
  {
    id: "flights",
    label: "Flights",
    emoji: "✈️",
    meta: { patterns: ["Flight"] },
    google: { patterns: ["Flight"] },
    ringba: { patterns: ["flight", "premium flights call flow"] },
  },
  {
    id: "porta-potties",
    label: "Porta Potties",
    emoji: "🚽",
    meta: { patterns: ["Porta", "Potty"] },
    google: { patterns: ["Porta", "Potty"], accountIds: ["1939246766"] },
    ringba: { patterns: ["porta potty", "porta", "potty"] },
  },
  {
    id: "pest-control",
    label: "Pest Control",
    emoji: "🐛",
    meta: {
      patterns: ["Pest", "PestControl", "Bed Bug", "BedBug"],
      accountIds: ["448669084867269", "1779578786137314"],
    },
    google: {
      patterns: ["Pest", "Bed Bug", "BedBug"],
      accountIds: ["1939246766"],
    },
    ringba: {
      patterns: ["pest control", "pest control call flow", "pest control us"],
    },
  },
];

/** Check if a campaign name matches a vertical's patterns for a given platform */
export function matchesVertical(
  campaignName: string,
  vertical: VerticalConfig,
  platform: "meta" | "google"
): boolean {
  const config = vertical[platform];
  if (config.patterns.length === 0) return true; // "all" vertical
  return config.patterns.some((pattern) =>
    campaignName.toLowerCase().includes(pattern.toLowerCase())
  );
}
