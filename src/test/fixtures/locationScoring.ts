/**
 * Location scoring fixture. The SAME input is fed to
 * scripts/media-brain/score_locations.py, and the parity test asserts the
 * TypeScript port produces the same tiers, exclusions and launch list.
 *
 * CSV equivalent (header order matters for the Python run):
 *   zip,total_calls,accepted,avg_payout,no_coverage
 */

import type { LocationInputRow } from '@/lib/mediaBrain/locationScoring';

export const LOCATION_FIXTURE: LocationInputRow[] = [
  // Strong, deep samples — these should headline.
  { id: '33101', volume: 180, success: 150, value: 42, hardFail: 4 },
  { id: '33102', volume: 160, success: 128, value: 39, hardFail: 3 },
  { id: '33103', volume: 140, success: 112, value: 36, hardFail: 2 },
  { id: '33104', volume: 120, success: 90, value: 34, hardFail: 5 },
  { id: '33105', volume: 100, success: 72, value: 30, hardFail: 1 },
  { id: '33106', volume: 90, success: 60, value: 28, hardFail: 0 },
  { id: '33107', volume: 80, success: 52, value: 26, hardFail: 2 },
  { id: '33108', volume: 60, success: 38, value: 24, hardFail: 1 },
  { id: '33109', volume: 45, success: 27, value: 22, hardFail: 0 },
  { id: '33110', volume: 30, success: 18, value: 20, hardFail: 1 },
  { id: '33111', volume: 22, success: 12, value: 18, hardFail: 0 },
  { id: '33112', volume: 15, success: 8, value: 16, hardFail: 0 },
  // Thin sample, perfect success, enormous payout — the fluke that must never
  // headline a launch list.
  { id: '99999', volume: 2, success: 2, value: 500, hardFail: 0 },
  // Structurally broken: half its events failed for lack of buyer coverage.
  { id: '00001', volume: 40, success: 30, value: 30, hardFail: 20 },
  // Quality failure: connects far too rarely.
  { id: '00002', volume: 50, success: 5, value: 45, hardFail: 0 },
];

export const LOCATION_FIXTURE_CSV = [
  'zip,total_calls,accepted,avg_payout,no_coverage',
  ...LOCATION_FIXTURE.map((r) => `${r.id},${r.volume},${r.success},${r.value},${r.hardFail}`),
].join('\n');
