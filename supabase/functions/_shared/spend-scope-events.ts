// Pure rules: when a spend platform pauses or restarts. Detected events become
// client_scope_events (source 'auto_detected'), so comparisons treat the change
// as a scope break instead of a performance swing.

export const PAUSE_MIN_WEEKDAYS = 2;

export interface DetectedScopeEvent {
  date: string;
  platform: string;
  kind: 'source_paused' | 'source_resumed';
  description: string;
  detected_key: string;
}

function isWeekday(d: string): boolean {
  const day = new Date(`${d}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * spendByDay: date -> platform -> spend (a missing platform on a day = $0).
 * A pause is the first weekday at $0 after spend, held for PAUSE_MIN_WEEKDAYS
 * consecutive weekdays. A restart is the first weekday with spend after a pause.
 * Weekends never start or end a pause on their own; days with no row at all are skipped.
 */
export function detectSpendScopeEvents(
  clientId: string,
  from: string,
  to: string,
  spendByDay: Map<string, Record<string, number>>,
): DetectedScopeEvent[] {
  const platforms = new Set<string>();
  for (const m of spendByDay.values()) for (const p of Object.keys(m)) platforms.add(p);
  const weekdays: string[] = [];
  // A weekday with no spend row from any source is UNKNOWN (feed gap), never a $0 day.
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d) && spendByDay.has(d)) weekdays.push(d);

  const out: DetectedScopeEvent[] = [];
  for (const platform of [...platforms].sort()) {
    let seenSpend = false;
    let paused = false;
    for (let i = 0; i < weekdays.length; i++) {
      const d = weekdays[i];
      const s = Number(spendByDay.get(d)?.[platform] ?? 0);
      if (s > 0) {
        if (paused) {
          out.push({ date: d, platform, kind: 'source_resumed', description: `${platform} spend restarted (${money(s)} on ${d}) after a pause.`, detected_key: `${clientId}|${platform}|source_resumed|${d}` });
          paused = false;
        }
        seenSpend = true;
        continue;
      }
      if (!seenSpend || paused) continue;
      const run = weekdays.slice(i, i + PAUSE_MIN_WEEKDAYS);
      if (run.length < PAUSE_MIN_WEEKDAYS) continue;
      if (run.every((x) => !(Number(spendByDay.get(x)?.[platform] ?? 0) > 0))) {
        out.push({ date: d, platform, kind: 'source_paused', description: `${platform} spend stopped from ${d} ($0 for ${PAUSE_MIN_WEEKDAYS}+ weekdays).`, detected_key: `${clientId}|${platform}|source_paused|${d}` });
        paused = true;
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}
