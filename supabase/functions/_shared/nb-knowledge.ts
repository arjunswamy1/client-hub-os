// New-business knowledge — pure rules for turning a meeting into reusable entries.
//
// Everything here is deterministic and testable. The model proposes; these rules
// decide what may land. Three things are never negotiable:
//   1. Confidentiality is always `internal_only` on insert. Clearance is a human act
//      recorded in the hub (and enforced again by the nb_knowledge_clearance trigger).
//   2. Evidence must be a verbatim line from the meeting. A paraphrase cannot be
//      traced, so it cannot be cited.
//   3. A proof point needs a real figure that appears in its evidence.

export const KINDS = ['pricing', 'objection', 'proof_point', 'scope', 'positioning', 'process', 'competitor'] as const;
export type Kind = typeof KINDS[number];

/**
 * Controlled vocabulary, derived from current clients' verticals and the verticals
 * that come up in meetings. Labels are what is stored; the patterns map whatever the
 * model wrote onto them. Anything that does not map is stored as null, never guessed.
 */
export const VERTICALS: { label: string; re: RegExp }[] = [
  { label: 'final expense', re: /final[\s_-]*expense|burial|\bfe\b/i },
  { label: 'auto insurance', re: /auto[\s_-]*insurance|\bauto\b|car insurance/i },
  { label: 'home insurance', re: /home(owners?)?[\s_-]*insurance/i },
  { label: 'medicare', re: /medicare|\baca\b|health insurance/i },
  { label: 'hvac', re: /\bhvac\b|heating|air condition/i },
  { label: 'plumbing', re: /plumb/i },
  { label: 'roofing', re: /roof/i },
  { label: 'water damage', re: /water[\s_-]*damage|restoration/i },
  { label: 'windows', re: /window/i },
  { label: 'bathroom remodel', re: /bath(room)?[\s_-]*remodel|walk[\s_-]*in[\s_-]*tub|\btubs?\b/i },
  { label: 'solar', re: /solar/i },
  { label: 'debt relief', re: /debt|credit repair|personal loan/i },
  { label: 'hearing', re: /hearing/i },
  { label: 'mental health', re: /neuropsych|mental health|psychiatr|\btms\b/i },
  { label: 'legal', re: /legal|mass tort|attorney|\blaw\b/i },
  { label: 'ecommerce', re: /e-?commerce|\bdtc\b|direct[\s_-]*to[\s_-]*consumer|shopify/i },
  { label: 'home services', re: /home[\s_-]*services?|home improvement|pest|moving/i },
];
export const VERTICAL_LABELS = VERTICALS.map((v) => v.label);

export const CHANNELS: { label: string; re: RegExp }[] = [
  { label: 'ctv', re: /\bctv\b|connected tv|\bott\b|roku|universal ads|streaming tv/i },
  { label: 'meta', re: /meta|facebook|instagram/i },
  { label: 'google', re: /google|\bppc\b|search ads|adwords|pmax|performance max/i },
  { label: 'youtube', re: /youtube/i },
  { label: 'tiktok', re: /tiktok/i },
  { label: 'programmatic', re: /programmatic|pubmatic|\bdsp\b|display/i },
  { label: 'native', re: /native|taboola|outbrain/i },
  { label: 'call marketplace', re: /ringba|ringfuel|callgrid|pay[\s_-]*per[\s_-]*call network|call marketplace|buyer/i },
  { label: 'email', re: /e-?mail/i },
];
export const CHANNEL_LABELS = CHANNELS.map((c) => c.label);

const mapTo = (list: { label: string; re: RegExp }[], raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const exact = list.find((v) => v.label === raw.trim().toLowerCase());
  if (exact) return exact.label;
  return list.find((v) => v.re.test(raw))?.label ?? null;
};
export const mapVertical = (raw: unknown) => mapTo(VERTICALS, raw);
export const mapChannel = (raw: unknown) => mapTo(CHANNELS, raw);

/** Lowercase, unify quotes and dashes, collapse whitespace — so verbatim survives formatting. */
export const normalise = (s: string): string =>
  s.toLowerCase()
    .replace(/[\u2018\u2019\u201a\u2032`]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Evidence is verbatim when every segment (split on an ellipsis) of at least 12
 * characters appears in the meeting text. Shorter scraps are not evidence.
 */
export function evidenceIsVerbatim(evidence: string, content: string): boolean {
  const hay = normalise(content);
  const parts = normalise(evidence).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => p.length >= 12 && hay.includes(p));
}

/** Flatten a numbers object to its finite numeric values. */
export function numericValues(numbers: unknown): number[] {
  if (!numbers || typeof numbers !== 'object') return [];
  return Object.values(numbers as Record<string, unknown>)
    .map((v) => (typeof v === 'string' ? Number(v.replace(/[$,%]/g, '')) : v))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** Does this number appear in the text as written (allowing $ , % and k/K)? */
export function numberAppearsIn(n: number, text: string): boolean {
  const t = text.replace(/,/g, '');
  const forms = new Set<string>([String(n), n.toFixed(0), n.toFixed(1), n.toFixed(2)]);
  if (n >= 1000 && n % 1000 === 0) forms.add(`${n / 1000}k`);
  if (n >= 1000 && n % 100 === 0) forms.add(`${(n / 1000).toFixed(1)}k`);
  return [...forms].some((f) => new RegExp(`(^|[^0-9.])${f.replace('.', '\\.')}(?![0-9])`, 'i').test(t));
}

/** Words that describe a result without stating one. */
const VAGUE = /\b(improved|better|great|strong|good|positive|significant|solid|increased|decreased|lifted|grew)\b/i;

export interface Proposed {
  kind: string; headline: string; detail?: string | null; evidence: string;
  vertical?: string | null; channel?: string | null; org_name?: string | null; numbers?: Record<string, unknown> | null;
}
export interface Verdict { ok: boolean; reason?: string }

/**
 * Proof point bar: at least one figure, and at least one of those figures must be in
 * the evidence line itself. "Performance improved" has no figure and is rejected; a
 * headline number that only the model wrote down is rejected too.
 */
export function proofPointIsConcrete(p: Proposed): Verdict {
  const nums = numericValues(p.numbers);
  if (!nums.length) {
    return { ok: false, reason: VAGUE.test(p.evidence) ? 'describes a result without a figure' : 'no figure recorded' };
  }
  if (!nums.some((n) => numberAppearsIn(n, p.evidence))) {
    return { ok: false, reason: 'none of its figures appear in the quoted evidence' };
  }
  return { ok: true };
}

export function validateProposed(p: Proposed, content: string): Verdict {
  if (!KINDS.includes(p.kind as Kind)) return { ok: false, reason: `unknown kind "${p.kind}"` };
  if (!p.headline || p.headline.trim().length < 12) return { ok: false, reason: 'headline too thin to reuse' };
  if (!p.evidence || !evidenceIsVerbatim(p.evidence, content)) return { ok: false, reason: 'evidence is not a verbatim line from the meeting' };
  if (p.kind === 'proof_point') return proofPointIsConcrete(p);
  if (p.kind === 'pricing' && !numericValues(p.numbers).length) return { ok: false, reason: 'pricing with no figure' };
  return { ok: true };
}

/** source_kind from the meeting. Null means we cannot tell — skip, do not guess. */
export function sourceKindFor(item: { client_id: string | null; metadata?: any }): 'client' | 'prospect' | 'partner' | 'vendor' | 'internal' | null {
  if (item.client_id) return 'client';
  const k = String(item.metadata?.agency_kind ?? '').toLowerCase();
  return (['prospect', 'partner', 'vendor', 'internal'] as const).find((x) => x === k) ?? null;
}

/** Character-trigram Jaccard, for dedupe against rows already filed from the same meeting. */
export function trigramSim(a: string, b: string): number {
  const grams = (s: string) => {
    const t = ` ${normalise(s).replace(/[^a-z0-9 ]/g, '')} `;
    const out = new Set<string>();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export const DUPLICATE_SIM = 0.45;

export function isDuplicate(p: Proposed, existing: { kind: string; headline: string; evidence: string | null }[]): boolean {
  return existing.some((e) =>
    trigramSim(e.headline, p.headline) >= DUPLICATE_SIM
    || (e.evidence && trigramSim(e.evidence, p.evidence) >= 0.6)
    || (e.kind === p.kind && sharesFigures(e, p)),
  );
}

/** Same kind and two or more identical figures in the evidence → the same claim. */
function sharesFigures(e: { evidence: string | null }, p: Proposed): boolean {
  if (!e.evidence) return false;
  const nums = (s: string) => new Set((s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.length > 1));
  const A = nums(e.evidence), B = nums(p.evidence);
  let shared = 0;
  for (const n of A) if (B.has(n)) shared++;
  return shared >= 2;
}

// ── Copy-for-proposal ──────────────────────────────────────────────────────

export interface Entry {
  kind: string; headline: string; detail: string | null; evidence: string | null;
  vertical: string | null; channel: string | null; org_name: string | null; confidentiality: string;
}

const KIND_TITLE: Record<string, string> = {
  proof_point: 'Results', pricing: 'Pricing', scope: 'Scope', positioning: 'Positioning',
  process: 'How we work', objection: 'Common questions', competitor: 'Market context',
};

/**
 * Assemble selected entries into proposal text. Internal-only entries are excluded
 * entirely and counted. Anonymised entries drop the organisation name.
 */
export function assembleForProposal(entries: Entry[]): { text: string; included: number; withheld: number } {
  const usable = entries.filter((e) => e.confidentiality === 'public' || e.confidentiality === 'anonymised');
  const withheld = entries.length - usable.length;
  const lines: string[] = [];
  for (const kind of KINDS) {
    const group = usable.filter((e) => e.kind === kind);
    if (!group.length) continue;
    lines.push(KIND_TITLE[kind] ?? kind, '');
    for (const e of group) {
      const tags = [e.vertical, e.channel?.toUpperCase() === 'CTV' ? 'CTV' : e.channel].filter(Boolean).join(', ');
      const who = e.confidentiality === 'public' && e.org_name ? ` (${e.org_name})` : '';
      lines.push(`• ${e.headline}${who}${tags ? ` — ${tags}` : ''}`);
      if (e.detail) lines.push(`  ${e.detail}`);
    }
    lines.push('');
  }
  if (withheld) {
    lines.push(`[${withheld} selected ${withheld === 1 ? 'entry was' : 'entries were'} withheld: internal only, not cleared for external use.]`);
  }
  return { text: lines.join('\n').trim(), included: usable.length, withheld };
}
