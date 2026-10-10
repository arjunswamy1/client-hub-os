# Replace CPM Bot with Grokbot

## Your choices
- Grokbot answers every Slack question, including numbers and revenue. CPM Bot stops replying.
- Grokbot sends the daily client updates, task digests and alerts. The hub stops posting them.
- The hub keeps sending designers their brief DMs and accept/decline buttons, now under the Grokbot name.
- We control Grokbot's Slack app.

## One risk to settle first
Today every hub post goes through one gate that refuses to write to a client's shared Slack channel unless a person has approved that channel. If Grokbot posts itself, that gate no longer protects those messages. The plan keeps the gate: Grokbot gets each message from the hub ready to send, along with the hub's yes or no for that channel. Grokbot posts only when the hub says yes, and it reports back what it sent so the history stays in the hub.

## Steps
1. **Bot lanes.** Rewrite the lane note so Grokbot owns both the numbers and the creative queue. CPM Bot's lane is retired.
2. **CPM Bot goes quiet.** Add an on/off switch for CPM Bot's replies and turn it off. Its code stays in place, so you can switch it back on in one click.
3. **Hub hands posts to Grokbot.** The scheduled jobs (daily updates, task digests, data-health and Cannaball alerts, weekly reports, Jacuzzi lead summaries) keep running and writing their drafts. They no longer post to Slack; each draft waits in an outbox. Grokbot gets three new tools: list what's ready to send, mark it sent, and mark it skipped. The hub decides who can receive each message.
4. **Designer DMs.** Unchanged, but sent under the Grokbot name and picture.
5. **Grokbot's Slack app.** If Grokbot doesn't have a Slack app yet, set one up for this project under the name Grokbot. Slack then sends questions and mentions to Grokbot instead of CPM Bot.
6. **Changeover.** Turn off CPM Bot and turn on the Grokbot outbox at the same moment, so no update is sent twice or missed. Run one day of trial runs first.

## Open questions
- Where does Grokbot's brain run: in this hub, or in a separate service that calls the hub? If it's separate, someone has to build its schedule for picking up and sending posts.
- Should client-facing daily updates still need a person to approve them before Grokbot sends?

## Technical notes
- New additive table `slack_outbox` (kind, channel, payload, allow_decision, status, sent_ts, sent_by). Jobs insert into it instead of calling `postToSlack()` when `SLACK_SENDER=grokbot`.
- mcp-hub gets outbox tools (`list_outbox`, `mark_outbox_sent`, `mark_outbox_skipped`), still with no import of `_shared/slack-post.ts`. The channel allow check is a copy of the policy run in SQL.
- `slack-ai-bot` exits early when `CPM_BOT_REPLIES=false`.
- `postDirectMessage()` takes the Grokbot username and icon.
- Record the decisions in AGENTS.md and write a build_log row.
