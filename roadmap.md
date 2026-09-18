# Roadmap

- [x] Add candidate-to-candidate trigram RPC and merged candidate relationship.
- [x] Make Gate B compare tasks and pending candidates, choose deterministic survivors, and record evidence.
- [x] Add force re-scoring and run it across all 314 archived Slack replay candidates.
- [x] Make Gate C completion results visible and useful.
- [x] Route Fathom webhook and backfill through task candidates.
- [x] Enforce that only the shared task gate inserts or upserts tasks.
- [x] Validate merged totals, Facebook Page survivor, pending/auto-promote counts, and inspect questionable merges.

## Data integrity monitor
- [x] Exceptions table with reason and expiry; Tinned Fish Club call-data exception seeded.
- [x] Setup and integration checks filed to AJ as candidates through the shared gate.
- [x] One open task per (check, client) via dedupe_key; auto-close when the condition clears.
- [x] Weekday 8:30am ET schedule ahead of the 9am drafts.
- [x] Dry run validated against AJ's hand-run; nothing filed.
