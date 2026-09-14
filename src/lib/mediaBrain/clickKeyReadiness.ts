/**
 * Media Brain — CLICK-KEY READINESS
 *
 * A test call answers one question: did the click keys arrive? "Missing" is not an
 * answer, because three different failures look like missing and each has a different
 * fix:
 *
 *   value          — the key arrived with real data. Nothing to do.
 *   macro_literal  — the key arrived as an unreplaced `[MACRO]`. The template references
 *                    a name the platform does not resolve, so the question goes to the
 *                    platform: what syntax references a CUSTOM tag in an outgoing
 *                    webhook template? (System-macro syntax may differ.)
 *   absent         — the key is not in the payload at all. The template does not list
 *                    it; add the field name to the webhook payload template.
 *   not_expected   — this client is not configured to send this key, so its absence is
 *                    not a defect.
 *
 * Pure. No React, no DB. The raw per-key values are captured on the receipt by the
 * webhook (values, not names — this feeds a deliberate operator test).
 */

/** The ten keys the landing-page capture requirement covers, in reading order. */
export const CLICK_READINESS_KEYS = [
  'gclid',
  'wbraid',
  'gbraid',
  'fbclid',
  'msclkid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type ClickReadinessKey = (typeof CLICK_READINESS_KEYS)[number];

/**
 * The keys that can name a SINGLE AD. `utm_campaign` cannot — it names a campaign, and
 * a campaign-level key never carries a per-ad verdict.
 */
export const AD_LEVEL_CLICK_KEYS: readonly string[] = [
  'gclid',
  'wbraid',
  'gbraid',
  'fbclid',
  'msclkid',
  'utm_content',
];

/** An unreplaced macro literal: `[GCLID]`, `[UTM_SOURCE]`. Not data, ever. */
export const MACRO_LITERAL_RE = /^\[[A-Z0-9_]+\]$/;

export const isMacroLiteral = (v: unknown): boolean =>
  typeof v === 'string' && MACRO_LITERAL_RE.test(v.trim());

export type ClickKeyState = 'value' | 'macro_literal' | 'absent' | 'not_expected';

export interface ClickKeyVerdict {
  key: string;
  state: ClickKeyState;
  /** Shown for `value` and `macro_literal`; null otherwise. */
  value: string | null;
  /** Whether this key, when it carries a value, could name a single ad. */
  adLevel: boolean;
  /** The one action that follows from this state. */
  fix: string;
}

const FIXES: Record<ClickKeyState, string> = {
  value: 'Arrived with a real value — nothing to do.',
  macro_literal:
    'The template references this name but the platform did not substitute it. Ask Moja what syntax references a custom tag in an outgoing webhook template — the system-macro syntax may not apply to custom tags.',
  absent:
    'Not in the payload at all — the template does not list it. Add this field name to the Moja webhook payload template.',
  not_expected: 'Not expected for this client, so its absence is not a defect.',
};

/**
 * Per-key verdicts, read from the top level of the receipt OR from the custom-tag bag —
 * the same two places the webhook itself reads, so the panel cannot disagree with the
 * stored row.
 */
export function clickKeyReadiness(
  bags: Array<Record<string, unknown> | null | undefined>,
  opts?: { expected?: readonly string[] },
): ClickKeyVerdict[] {
  const expected = opts?.expected ?? CLICK_READINESS_KEYS;
  const present = bags.filter(
    (b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b),
  );

  return CLICK_READINESS_KEYS.map((key) => {
    const adLevel = AD_LEVEL_CLICK_KEYS.includes(key);
    if (!expected.includes(key)) {
      return { key, state: 'not_expected' as const, value: null, adLevel, fix: FIXES.not_expected };
    }
    let literal: string | null = null;
    let found = false;
    for (const bag of present) {
      if (!(key in bag)) continue;
      found = true;
      const raw = bag[key];
      if (isMacroLiteral(raw)) {
        literal = String(raw).trim();
        continue;
      }
      const v = raw === null || raw === undefined ? '' : String(raw).trim();
      if (v) return { key, state: 'value' as const, value: v, adLevel, fix: FIXES.value };
    }
    if (literal) {
      return { key, state: 'macro_literal' as const, value: literal, adLevel, fix: FIXES.macro_literal };
    }
    // Present but empty is the same defect as absent: the template names it, nothing filled it.
    return {
      key,
      state: 'absent' as const,
      value: null,
      adLevel,
      fix: found
        ? 'Listed in the template but delivered empty — whatever should populate it did not.'
        : FIXES.absent,
    };
  });
}

export interface ClickKeyHeadline {
  /** True when at least one AD-LEVEL key arrived with a real value. */
  adLevelKeyArrived: boolean;
  /** Any key at all with a real value, ad level or not. */
  anyKeyArrived: boolean;
  keysWithValues: string[];
  keysAsLiterals: string[];
  keysAbsent: string[];
  /** The test's result, in one sentence. */
  headline: string;
}

export function clickKeyHeadline(verdicts: ClickKeyVerdict[]): ClickKeyHeadline {
  const withValues = verdicts.filter((v) => v.state === 'value');
  const adLevel = withValues.filter((v) => v.adLevel).map((v) => v.key);
  const literals = verdicts.filter((v) => v.state === 'macro_literal').map((v) => v.key);
  const absent = verdicts.filter((v) => v.state === 'absent').map((v) => v.key);

  const headline = adLevel.length
    ? `Ad-level click key arrived: ${adLevel.join(', ')}. This receipt can name a single ad.`
    : withValues.length
      ? `No ad-level click key arrived. ${withValues.map((v) => v.key).join(', ')} carried values, but none of those names a single ad.`
      : literals.length
        ? 'No click key arrived — every referenced key came back as an unreplaced [MACRO] literal, so the template names them but the platform did not substitute them.'
        : 'No click key arrived, and none was referenced in the payload at all.';

  return {
    adLevelKeyArrived: adLevel.length > 0,
    anyKeyArrived: withValues.length > 0,
    keysWithValues: withValues.map((v) => v.key),
    keysAsLiterals: literals,
    keysAbsent: absent,
    headline,
  };
}
