# Framework Index

Media buying decision system for pay-per-call at Connect Paid Media.

**Objective:** scale as quickly as possible without losing money on the campaign.

**This file is a router.** It says which document covers what and in what order to do things. The rules themselves live in the documents below — read the relevant one before answering a media buying question or analyzing campaign data. Don't answer from general advertising knowledge when a framework document covers it.

## Documents

| File | Scope | Read it when... |
|---|---|---|
| `01_Decision_Engine.md` | Every rule. Metric hierarchy, confidence model, cut/hold/scale logic, graduation gates, diagnostic tree, circuit breakers, margin benchmarks. Static and RTB. | Any question involving a threshold, formula, or whether to cut, hold, or scale |
| `02_Client_Intake.md` | Prompt, run once per client. Collects variables, computes thresholds, outputs the client's two files. | Onboarding a client, or re-running after economics change |
| `03_Operating_Procedures.md` | Commands, the shared data pull spec, daily / weekly / monthly routines, failure handling. | Running any review, pulling any data |
| `05_Location_Scoring.md` | Location (ZIP/city/DMA) scoring: canonical column roles, hard excludes, the confidence gate, the blended percentile score, tiering, launch-list sizing. Explicitly carries **no margin input** and its confidence gate is **not** `{min_calls}`. | Choosing or revising geographic targeting — always before campaigns are built |

| `04_Client_Deck_Template.md` | Weekly deck structure and client-facing language. *(Not built.)* | Producing the client report |
| `Doctrine_Meta_Algorithm.md` | How Meta's system behaves — auction, learning phase, attribution, Advantage+, fatigue mechanics. | Diagnosing *why* Meta is behaving a certain way |

**Generated per client by running 02:**

| File | Holds | Changes |
|---|---|---|
| `[Client]_Economics.md` | Payout terms, billable definition, funnel structure, buyer hours, reporting cadence | Only when the client does |
| `[Client]_Instance.md` | Computed thresholds, lifecycle stage, current dispositions, change log, flags | Weekly |

Always read the client's Instance file before running any command. **A command run without one stops** — it does not fall back on defaults.

## Order of operations

**New client**

1. `INTAKE` → produces the Economics and Instance files
2. Read the Meta account's naming convention; record the parsing rule in the Instance file
3. `LOCATIONS` (`05_Location_Scoring.md`) → the ranked, tiered, budget-sized target list. Location targeting is the hardest constraint in a pay-per-call launch: buyer coverage and payout are both geographic, and a location the network cannot monetise is not fixable with creative or budget. Decide it here, then build everything else around it.
4. Build campaigns — testing CBO, angle count from the intake's computed maximum, 100% of budget on testing, targeting the launch list from step 3
5. Begin `DAILY`


**Ongoing**

| Command | Cadence | Does |
|---|---|---|
| `DAILY` | Every day | Circuit breakers and dashboard. No optimizations. |
| `WEEKLY` | Per volume tier | The full review. Every change happens here. |
| `MONTHLY` | Monthly | Trends, fatigue curves, structure fitness, economics re-validation |
| `DECK` | Weekly | Client report |

**Re-run** `INTAKE` **whenever economics change** — payout, budget, or a new buyer. Every threshold derives from those inputs; operating on stale ones is worse than operating on none.

## Standing rules for execution

- **Confirm the date range before any pull or report.** State start, end, and timezone, and get confirmation. Never infer the window.
- **Nothing executes without approval.** Propose actions with evidence and confidence attached; a human approves.
- **An empty data pull is a failure, not a zero.** Zero billable calls is a kill trigger — never let a failed pull look like performance.
- **When the framework and the account data disagree, say so.** This is a decision aid, not an authority. Don't force data to fit it.

## Out of scope

Routing and buyer waterfall decisions — the client owns these. Surface them as recommendations with evidence; don't build rules for them.

Creative production. Compliance review. Platforms other than Meta, until a client requires one.

`Doctrine_101_Fundamentals.md` and `Doctrine_201_MathMetrics.md` belong to the Sherpa library and are **not** authorities here. 201 in particular conflicts with `01_Decision_Engine.md` on the kill threshold. Do not read either when making a decision in this project.

## Status

Built: 01, 02, 03. Not built: 04.

Unverified: the volume tier boundaries, and whether the two per-client files should stay separate. Both get revisited after the first client runs.
