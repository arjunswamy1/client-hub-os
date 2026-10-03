// WHICH CLIENT IS BEING ASKED ABOUT — resolved from the database, never from a
// hardcoded keyword table. Order of precedence:
//   1. the channel's slack_channel_mappings.client_id (in #int_cannaball it is obvious)
//   2. an exact or fuzzy match of the message text against clients.name / .slug / .aliases
//   3. the same match over recent conversation text
// If nothing resolves we ASK. If several resolve we list them. We never guess.

export interface ResolvedClientRow {
  id: string;
  name: string;
  slug: string;
  engagement_type: string | null;
  expected_sources: string[] | null;
  data_model_note: string | null;
  aliases: string[] | null;
  /** Explicit money column, when the engagement-type default is wrong here. */
  revenue_field?: string | null;
  /** Where this account's calls live. Empty = not recorded; never guess. */
  call_source_tables?: string[] | null;
  /** Where this account's media spend lives. Empty = not recorded. */
  spend_source_tables?: string[] | null;
  /** Spend feeds carrying a campaign dimension. Empty = spend cannot be split per campaign. */
  campaign_spend_source_tables?: string[] | null;
  /** Timezone the platform cuts this account's reporting day on. Null = UTC, as stored. */
  reporting_timezone?: string | null;
  /** First date revenue capture can be trusted. Null = all history reliable. */
  metrics_reliable_from?: string | null;
}

export interface ClientResolution {
  client: ResolvedClientRow | null;
  /** More than one candidate matched — the caller must list them and ask. */
  candidates: ResolvedClientRow[];
  /** Plain-language provenance for the log and the prompt. */
  how: 'channel_mapping' | 'text_match' | 'history_match' | 'ambiguous' | 'unresolved';
}

export async function loadActiveClients(supabase: any): Promise<ResolvedClientRow[]> {
  const { data } = await supabase
    .from('clients')
    .select('id, name, slug, engagement_type, expected_sources, data_model_note, aliases, revenue_field, call_source_tables, spend_source_tables, campaign_spend_source_tables, reporting_timezone, metrics_reliable_from')
    .eq('status', 'active')
    .order('name');
  return (data || []) as ResolvedClientRow[];
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistanceWithin1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diffs = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    diffs++;
    if (diffs > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) i++;
    else j++;
  }
  if (i < la || j < lb) diffs++;
  return diffs <= 1;
}

/** Every string that should identify this client. */
function needlesFor(c: ResolvedClientRow): string[] {
  const out = [c.name, c.slug, ...(c.aliases || [])];
  return out.map(norm).filter((s) => s.length >= 2);
}

/**
 * Does this text name the client? Multi-word needles must appear as a phrase;
 * single-word needles match a whole word, allowing one typo when long enough
 * ("Spectrafin" for Spektrafin). Two-letter needles are ignored to avoid noise.
 */
function textNamesClient(textNorm: string, words: string[], c: ResolvedClientRow): boolean {
  for (const needle of needlesFor(c)) {
    if (needle.includes(' ')) {
      if (textNorm.includes(needle)) return true;
      continue;
    }
    if (needle.length <= 2) continue;
    if (words.includes(needle)) return true;
    if (needle.length >= 6 && words.some((w) => w.length >= 5 && editDistanceWithin1(w, needle))) return true;
  }
  return false;
}

export function matchClientsInText(text: string, clients: ResolvedClientRow[]): ResolvedClientRow[] {
  const t = norm(text);
  if (!t) return [];
  const words = t.split(' ');
  return clients.filter((c) => textNamesClient(t, words, c));
}

export async function resolveClient(
  supabase: any,
  opts: { channelId?: string | null; text?: string | null; historyText?: string | null; clients?: ResolvedClientRow[] },
): Promise<ClientResolution & { clients: ResolvedClientRow[] }> {
  const clients = opts.clients ?? (await loadActiveClients(supabase));

  // The message text wins over the channel: in a client channel someone may
  // still ask "how is Spektrafin doing".
  const fromText = matchClientsInText(opts.text || '', clients);
  if (fromText.length === 1) return { client: fromText[0], candidates: [], how: 'text_match', clients };
  if (fromText.length > 1) return { client: null, candidates: fromText, how: 'ambiguous', clients };

  if (opts.channelId) {
    const { data: mapping } = await supabase
      .from('slack_channel_mappings')
      .select('client_id')
      .eq('channel_id', opts.channelId)
      .maybeSingle();
    if (mapping?.client_id) {
      const hit = clients.find((c) => c.id === mapping.client_id);
      if (hit) return { client: hit, candidates: [], how: 'channel_mapping', clients };
    }
  }

  const fromHistory = matchClientsInText(opts.historyText || '', clients);
  if (fromHistory.length === 1) return { client: fromHistory[0], candidates: [], how: 'history_match', clients };
  if (fromHistory.length > 1) return { client: null, candidates: fromHistory, how: 'ambiguous', clients };

  return { client: null, candidates: [], how: 'unresolved', clients };
}
