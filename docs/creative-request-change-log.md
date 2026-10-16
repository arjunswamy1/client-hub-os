# Creative request change log and on-hold

## Who is recorded as the actor
Every change to a creative request (and its comments) is written to `creative_brief_change_log` by database triggers that are `ENABLE ALWAYS` (they fire in replica/maintenance sessions too). No client role can write the log; anon has no access; signed-in users can only read.

The actor is resolved in this order:
1. `app.actor_id` (transaction setting). `agent_write_creative_brief` sets it for every bot write via mcp-hub; any job acting for a person must set it too.
2. The signed-in user's team member (`get_team_member_id(auth.uid())`).
3. Neither: the entry is recorded as **System** (`actor_kind = 'system'`). This is used for background jobs that do not say who is acting.

Bots are service-account team members, or writes whose `app.via` is agent/mcp/bot.

## Who can read a request's history
Admins, members with access to the request's client, and additionally the request's assignee and its creator.

## Comments
Added and edited comments keep their text (edits keep before and after). A deleted comment is logged as "comment deleted" with the comment author, who deleted it, and when — no text — and its text is removed from every earlier log entry for that comment. Entries written before comment ids were recorded were matched by text on the same request when scrubbed.

Deleting a request (or its client) deletes its log with it.

## On hold
- Putting a request on hold requires a reason (board, edit form, and `update_brief_status`); the database refuses it otherwise, for every role.
- The hold start time and the due date at that moment (original due date) are recorded by trigger and cannot be rewritten while on hold; they clear when the request leaves hold.
- On hold is never late, is excluded from designers' "today" lists, and shows as Paused in My Work.
- More than 7 days on hold is a **long hold**: listed in `get_followups` and the Monday roll-up, never chased.
