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

## Campaign and vertical grain (added 2026-09-20)

An account total cannot answer "does auto beat home". Three account facts make the
finer read possible, and all three live on the records, never in code:

1. `clients.call_source_tables` — every supported call feed records
   `campaign_name`, so calls and revenue always split per campaign.
2. `clients.campaign_spend_source_tables` — the spend feeds that carry a campaign
   dimension (`ad_campaigns`, `roku_daily_metrics`, `universal_ads_geo_metrics`,
   `cannaball_spend`, `platform_spend_4js`). Empty means spend CANNOT be split:
   cost per call and margin per vertical are UNKNOWN, never zero, and never
   borrowed from the account-level total.
3. `client_verticals` — `ringba_patterns` assign CALLS by call-feed campaign name
   (on every feed, not only Ringba); `meta_patterns` / `google_patterns` assign
   SPEND. A name matching no vertical, or more than one, is UNCLASSIFIED and is
   reported as such.

`_shared/client-breakdown.ts` computes the rows. Every account-level rule applies
per row: a group with any uncaptured money row publishes no revenue, profit or
margin; spend that misses a group's call days makes cost per call a FLOOR and
withholds margin. More calls than clicks in a group is an attribution warning
(other publishers routed into the same call campaign), never engagement.

On RTB pay-per-call accounts the spend campaign name and the call campaign name
routinely differ (Hablyte spends on "Auto Insurance - Test CBO" and receives calls
on "Auto RTB"). The VERTICAL is therefore the finest grain where both sides join;
per-campaign profit stays UNKNOWN there and the read says so.

The breakdown is a READ, not a verdict. Cut / hold / scale stay ad-level.
