# Repair task deduplication and enforce one task writer

## Outcome
- Gate B will compare candidates with each other and with open tasks, using database trigram similarity only as a shortlist and the model as the final duplicate decision.
- Confirmed duplicate candidates will collapse onto one inspectable survivor rather than becoming parallel tasks.
- Gate C will remain a separate gate and will surface both explicit “already completed” evidence and later completion evidence.
- Fathom webhook and backfill action items will enter `task_candidates`; only the shared gate may create `tasks`.

## Implementation
1. Add an additive database migration:
   - Confirm/retain `pg_trgm` in the `extensions` schema.
   - Add nullable `merged_into_candidate_id` to `task_candidates`, referencing another candidate.
   - Add a candidate-pair lookup function using `extensions.similarity()` at the 0.45 threshold, scoped to the same client and requested candidate set.
   - Grant only authenticated/service-role access consistent with the existing candidate policies.
2. Rework Gate B:
   - Rank a duplicate cluster’s survivor by Gate A confidence, then title length, then stable ID.
   - Compare candidate pairs and open-task matches; exact normalized matches merge directly, fuzzy matches require model confirmation.
   - Persist `similarity`, `match_title`, and `confirmed_by: 'trigram+llm'` for confirmed fuzzy matches.
   - Point losers to `merged_into_candidate_id`; when the survivor later promotes, propagate its task ID to merged candidates.
   - Distinguish “comparison ran with no match” from model/check unavailability instead of defaulting skipped checks to `none`.
3. Fix Gate C rather than removing it:
   - Preserve an explicit completion signal from Gate A when the source text itself says the work is done.
   - Resolve the source timestamp for archived Slack replays and search only later client context for completion evidence.
   - Run Gate C for all relevant candidates so completion evidence remains visible in `gate_results` even when Gate A rejects the item.
4. Route both Fathom functions through candidates:
   - Store source traceability, raw text, proposed title, owner data, and deterministic dedupe keys.
   - Use exact active-team matching only; unresolved owners stay pending.
   - Invoke the shared gate and report candidates/promotions rather than writing tasks directly.
5. Replace the narrow guard with a repository-wide edge-function guard that permits task inserts/upserts only in `_shared/task-gate.ts`; retain the transitive `sync-slack` assertion.
6. Deploy the migration and changed functions, then re-score the 314 archived replay candidates as one comparison set. Verify the Facebook Page variants collapse to one survivor and report total merged candidates.

## Validation
- Confirm `pg_trgm` is installed and the new candidate relationship/function exist.
- Run focused gate/guard tests and inspect current build diagnostics.
- Query the 314 replay candidates for status totals, Gate B evidence, Gate C completions, and the Facebook Page cluster.
- Grep every edge function for direct task writes and confirm only the shared gate remains.
- Do not post to Slack, invite the bot, change membership, or modify/delete archived task evidence.
