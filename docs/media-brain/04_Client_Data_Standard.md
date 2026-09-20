# 04 — Client Data Standard

How every account records performance data, so one reader (dashboards, the
drafter, the integrity monitor, the Slack bot) gets the same answer.

## The account record is the single source of account facts

On `public.clients`:

| Column | Meaning | Empty means |
| --- | --- | --- |
| `engagement_type` | How CPM earns: `pay_per_call`, `performance_media`, `creative_only`, `self_managed`, `ecommerce`, `pre_launch` | UNKNOWN — no revenue, profit or margin may be stated |
| `revenue_field` | `revenue` or `payout`: which call column is CPM's income | Derive from `engagement_type` (performance_media → `revenue`, pay_per_call → `payout`) |
| `call_source_tables` | Tables holding this account's calls/leads | Not recorded — calls and revenue are NOT AVAILABLE, never zero |
| `spend_source_tables` | Tables holding this account's media spend | Not recorded — spend is NOT AVAILABLE, never $0 |
| `expected_sources` | What the account *should* have (intake intent) | No expectation stated; the integrity monitor has nothing to check against |
| `aliases` | Names people actually use in Slack | Only the exact name resolves |
| `data_model_note` | Plain-language provenance and caveats | No provenance for readers |

Rules:

1. **Never guess a data location from a slug or a name.** Readers read
   `call_source_tables` / `spend_source_tables`. An unlisted account is a named
   setup gap, not an empty result.
2. **Never infer the money column from the engagement type alone.**
   `revenue_field` wins. Cannaball is `performance_media` yet its feed carries
   only `payout` — reading `revenue` there reported "unknown" on an account that
   was plainly profitable.
3. **Absent stays absent.** Capture flags (`revenue_captured`,
   `conversion_captured`, `payload_shape`) gate revenue, profit and margin. A
   feed that does not report a field yields UNKNOWN, never 0.
4. Formulas stay in `src/lib/mediaBrain/engine.ts` and
   `_shared/client-revenue.ts`; the account record only says *where* and *which
   column*, never *how to compute*.

## Supported feeds

Calls: `ringfuel_calls`, `ringba_calls`, `ringba_calls_4js`, `cannaball_calls`,
`moja_calls`. Spend: `ad_daily_metrics` (Meta/Google), `roku_daily_metrics`,
`universal_ads_geo_metrics`, `platform_spend_4js`, `cannaball_spend`.
Entity-scoped spend feeds (Roku, Universal Ads) are read at `entity = 'campaign'`
so nothing double-counts.

Jacuzzi is the one domain exception: it is paid per **lead**, so `jacuzzi_leads`
(calls + QR scans) is the count and `ringfuel_calls` is a subset of it. That is a
payment rule, not a data-location rule.
