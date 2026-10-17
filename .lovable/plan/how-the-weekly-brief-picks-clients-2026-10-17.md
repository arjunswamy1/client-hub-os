Read-only answer: no changes proposed for approval yet. Approving this does nothing.

## How the weekly brief picks clients
- The client list is not taken from the daily-update roster. The weekly function runs every hour at :35 and sends only for rows in its own schedule list where the brief is switched on, the weekday and hour match, and it has not already sent that ISO week.
- Each row also has to use one of three hard-coded report types: BuyologyIQ, RRM or Jacuzzi. Any other type is refused as unsupported.
- The current rows are: BuyologyIQ (on, Mon 13:00 UTC, #in_buyologyiq), Jacuzzi (on, Mon 13:00 UTC, #int_jacuzzi) and RRM (off, no channel).
- No separate "weekly account review" exists in the code. The only weekly report is this AI optimizer brief.

## Where it goes
- It goes to the client's chosen Slack channel through the guarded Slack sender, which only allows approved channels.
- RRM and Jacuzzi briefs are also saved in the hub for comparing one week with the next. BuyologyIQ is saved by its own optimizer.

## Consumer Genius
- It is not included. It has no schedule row, and there is no Consumer Genius report type.

## Smallest change (needs your OK)
1. Add a "milestone" report type that writes a launch-milestone section (checklist, go-live date, blockers) from the client notes and records. It would show no performance figures and would not use AI.
2. Add one Consumer Genius schedule row: switched on, Monday 13:00 UTC, to an internal channel you pick that is already approved for Slack posts.
3. Change nothing else: the daily-update settings stay as they are and no daily update or task-list posting comes back.

Open questions: which channel to use, and where the milestone list should come from.
