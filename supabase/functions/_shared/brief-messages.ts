// Pure message builders for brief assignment / acceptance DMs. No Deno or
// network imports so the unit tests can exercise them directly.

export const HUB_URL = 'https://hub.connectpaidmedia.com';
export const briefUrl = (briefId: string) => `${HUB_URL}/creative?brief=${briefId}`;

export interface BriefForMessage {
  id: string;
  title: string;
  owner_name?: string | null;
  due_date?: string | null; // yyyy-mm-dd
  priority?: string | null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== 'null' && s !== 'undefined' ? s : null;
};

export function formatDueDate(d: string | null | undefined): string | null {
  const s = clean(d);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function designerAssignedText(b: BriefForMessage): string {
  const lines = [`New creative brief assigned to you: ${clean(b.title) ?? 'Untitled brief'}`];
  const owner = clean(b.owner_name);
  if (owner) lines.push(`Submitted by: ${owner}`);
  const due = formatDueDate(b.due_date);
  if (due) lines.push(`Due: ${due}`);
  const pr = clean(b.priority);
  if (pr) lines.push(`Priority: ${cap(pr)}`);
  return lines.join('\n');
}

const viewButton = (briefId: string) => ({
  type: 'button',
  action_id: 'view_brief',
  text: { type: 'plain_text', text: 'View Brief' },
  url: briefUrl(briefId),
});

export function designerAssignedBlocks(b: BriefForMessage): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: designerAssignedText(b) } },
    {
      type: 'actions',
      block_id: `brief_${b.id}`,
      elements: [
        { type: 'button', action_id: 'accept_brief', style: 'primary', value: b.id, text: { type: 'plain_text', text: 'Accept Brief' } },
        viewButton(b.id),
      ],
    },
  ];
}

export function formatAcceptedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) + ' ET';
}

/** Replaces the designer's original DM after acceptance — Accept button removed. */
export function designerAcceptedBlocks(b: BriefForMessage, acceptedAtIso: string): unknown[] {
  const text = `${designerAssignedText(b)}\n\n:white_check_mark: You accepted this brief at ${formatAcceptedAt(acceptedAtIso)}.`;
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', block_id: `brief_${b.id}`, elements: [viewButton(b.id)] },
  ];
}

export function ownerAcceptedText(designer: string, title: string, acceptedAtIso: string): string {
  return `${clean(designer) ?? 'Your designer'} has accepted your brief: ${clean(title) ?? 'Untitled brief'}\nAccepted at ${formatAcceptedAt(acceptedAtIso)}`;
}

export function ownerAcceptedBlocks(briefId: string, designer: string, title: string, acceptedAtIso: string): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ownerAcceptedText(designer, title, acceptedAtIso) } },
    { type: 'actions', block_id: `brief_${briefId}`, elements: [viewButton(briefId)] },
  ];
}

export type AcceptOutcome =
  | 'accepted' | 'rejected_not_assignee' | 'rejected_not_submitted'
  | 'rejected_already_accepted' | 'rejected_unknown_actor' | 'duplicate_retry' | 'error';

export interface AcceptResult {
  outcome: AcceptOutcome;
  status?: string;
  accepted_by?: string | null;
  accepted_at?: string;
  reassigned?: boolean;
  current_assignee?: string | null;
  detail?: string;
}

const STATUS_WORDS: Record<string, string> = {
  draft: 'back in draft', in_design: 'already in design', ready_for_review: 'in review',
  revision_requested: 'in revision', approved: 'approved', delivered: 'delivered',
};

/** The ephemeral text a refused clicker sees. Never silent. */
export function refusalText(r: AcceptResult): string {
  switch (r.outcome) {
    case 'rejected_unknown_actor':
      return "I couldn't match your Slack account to a CPM team member, so I can't accept this brief for you. Ask AJ to add your Slack ID in Team settings.";
    case 'rejected_already_accepted':
      return r.accepted_by
        ? `This brief was already accepted by ${r.accepted_by}${r.accepted_at ? ` at ${formatAcceptedAt(r.accepted_at)}` : ''}.`
        : 'This brief has already been accepted.';
    case 'rejected_not_assignee':
      if (r.reassigned) {
        return r.current_assignee
          ? `This brief was reassigned to ${r.current_assignee}, so you can't accept it any more.`
          : "This brief is no longer assigned to anyone, so it can't be accepted from here.";
      }
      return r.current_assignee
        ? `This brief is assigned to ${r.current_assignee}, not you — only the assigned designer can accept it.`
        : "This brief isn't assigned to you, so you can't accept it.";
    case 'rejected_not_submitted':
      return r.status
        ? `This brief is ${STATUS_WORDS[r.status] ?? r.status.replace(/_/g, ' ')}, so it can no longer be accepted.`
        : 'This brief is no longer available to accept.';
    case 'duplicate_retry':
      return 'Already handled.';
    case 'error':
      return "Something went wrong accepting this brief. Nothing was changed — please try again or accept it in the hub.";
    default:
      return '';
  }
}

/** Exponential backoff for the manual retry path: 0, 2, 4, 8, 16 minutes. */
export function retryDue(attempts: number, updatedAtIso: string, now = Date.now()): boolean {
  if (attempts >= 5) return false;
  if (attempts === 0) return true;
  return now - new Date(updatedAtIso).getTime() >= Math.pow(2, attempts) * 60_000;
}
