/** Statuses where a passed due date does not make a request late. */
export const BRIEF_NOT_LATE_STATUSES = ['on_hold', 'approved', 'delivered'];

/** A request is late only when its due date has passed and it is not on hold or finished. */
export function isBriefLate(status: string | null | undefined, dueDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  if (BRIEF_NOT_LATE_STATUSES.includes(status ?? 'draft')) return false;
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  return d.getTime() < now.getTime();
}
