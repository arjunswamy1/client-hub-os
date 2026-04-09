import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

interface TaskListViewProps {
  tasks: any[];
  onTaskClick: (taskId: string) => void;
}

export function TaskListView({ tasks, onTaskClick }: TaskListViewProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Tags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No tasks yet. Create one to get started.
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TableRow
                key={task.id}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => onTaskClick(task.id)}
              >
                <TableCell className="font-medium">{task.title}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">
                    <div
                      className="mr-1 h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]?.color }}
                    />
                    {TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]?.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    className="text-xs font-medium capitalize"
                    style={{ color: TASK_PRIORITY_CONFIG[task.priority as keyof typeof TASK_PRIORITY_CONFIG]?.color }}
                  >
                    {task.priority}
                  </span>
                </TableCell>
                <TableCell>
                  {task.assignee ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                          {task.assignee.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs">{task.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {task.tags?.map((tag: string) => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
