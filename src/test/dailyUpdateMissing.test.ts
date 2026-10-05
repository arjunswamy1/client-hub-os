import { describe, it, expect } from 'vitest';
import {
  collapseTrigger, costPerQualified, falseZeroProblems, oneLiner, type SeriesDay,
} from '../../supabase/functions/_shared/daily-update-rules';
import { newAccounts } from '../../supabase/functions/_shared/scope-detect';

const day = (date: string, o: Partial<SeriesDay> = {}): SeriesDay =>
  ({ date, spend: 2000, calls: 0, qualified: 0, impressions: null, ...o });

describe('missing call figures never render as zero', () => {
  it('one-liner says "not recorded" for a missing day, never "no calls" or 0', () => {
    const text = oneLiner({ client: 'Jacuzzi', forDate: '2026-10-04', day: day('2026-10-04', { callsKnown: false }) } as any);
    expect(text).toMatch(/not recorded/);
    expect(falseZeroProblems(text, true)).toEqual([]);
  });

  it('the guard catches every false-zero shape the Jacuzzi draft produced', () => {
    const bad = '$4,177 spend · $0.00 revenue · −$4,177 profit · 0 calls\nvs Thu–Fri: spend −0%, calls 0 → 0';
    expect(falseZeroProblems(bad, true).length).toBe(2);
    expect(falseZeroProblems(bad, false)).toEqual([]);
  });

  it('a missing day can never produce a cost-per-qualified headline', () => {
    const hist = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']
      .map((d) => day(d, { calls: 40, qualified: 20, spend: 2000 }));
    const t = costPerQualified([...hist, day("2026-10-04", { callsKnown: false, qualified: 30 })], "2026-10-04").day;
    expect(t ?? null).toBeNull();
  });
});

describe('collapse trigger', () => {
  it('fires on Spektrafin-style −98% calls on a material account', () => {
    const t = collapseTrigger({ calls: 18, revenue: 96, spend: 3000 }, { calls: 1199, revenue: 13600, spend: 3000 }, 'vs last Sunday');
    expect(t?.code).toBe('volume_collapse');
  });
  it('does not fire below the spend floor or on a missing side', () => {
    expect(collapseTrigger({ calls: 1, revenue: 0, spend: 5 }, { calls: 50, revenue: 500, spend: 5 }, 'x')).toBeNull();
    expect(collapseTrigger({ calls: null, revenue: null, spend: 3000 }, { calls: 1199, revenue: 13600, spend: 3000 }, 'x')).toBeNull();
  });
});

describe('accounts_added detection', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => ({ date: `2026-09-${String(Math.max(1, i - 9)).padStart(2, '0')}`, account: 'A' })),
    { date: '2026-08-27', account: 'A' },
    { date: '2026-10-02', account: 'B' }, { date: '2026-10-03', account: 'B' },
  ];
  it('names an account first seen this week, dated its first day', () => {
    expect(newAccounts(rows, '2026-10-04')).toEqual([{ account: 'B', firstDate: '2026-10-02' }]);
  });
  it('ignores placeholder ids', () => {
    expect(newAccounts([...rows, { date: '2026-10-03', account: 'default' }], '2026-10-04').map((a) => a.account)).toEqual(['B']);
  });
});
