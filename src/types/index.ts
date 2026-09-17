export type UserRole = 'admin' | 'account_manager' | 'designer' | 'client';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

export type ClientStatus = 'active' | 'paused' | 'offboarded';
export type CommunicationChannel = 'slack' | 'teams' | 'email';

export interface TeamMember {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  logo_url: string | null;
  communication_channel: CommunicationChannel | null;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
}

export interface ClientAssignment {
  id: string;
  client_id: string;
  team_member_id: string;
  role_on_account: string | null;
  assigned_by_id: string | null;
  assigned_at: string;
  client?: Client;
  team_member?: TeamMember;
}

export interface Task {
  id: string;
  /** Null for agency-lane tasks (no client), visible to admins and AMs only. */
  client_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  parent_task_id: string | null;
  position: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  assignee?: TeamMember;
  client?: Client;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: TeamMember;
}

export interface TaskTimeEntry {
  id: string;
  task_id: string;
  team_member_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  description: string | null;
  created_at: string;
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: 'hsl(220, 10%, 46%)' },
  todo: { label: 'To Do', color: 'hsl(220, 70%, 50%)' },
  in_progress: { label: 'In Progress', color: 'hsl(38, 92%, 50%)' },
  in_review: { label: 'In Review', color: 'hsl(270, 70%, 55%)' },
  done: { label: 'Done', color: 'hsl(142, 71%, 45%)' },
};

export const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'hsl(0, 72%, 51%)' },
  high: { label: 'High', color: 'hsl(25, 95%, 53%)' },
  medium: { label: 'Medium', color: 'hsl(38, 92%, 50%)' },
  low: { label: 'Low', color: 'hsl(142, 71%, 45%)' },
};

export const KANBAN_COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
