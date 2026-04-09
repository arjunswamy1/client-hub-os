import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { KANBAN_COLUMNS, TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface KanbanBoardProps {
  tasks: any[];
  onTaskClick: (taskId: string) => void;
  onStatusChange: (taskId: string, status: string) => void;
}

export function KanbanBoard({ tasks, onTaskClick, onStatusChange }: KanbanBoardProps) {
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    onStatusChange(result.draggableId, newStatus);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((status) => {
          const config = TASK_STATUS_CONFIG[status];
          const columnTasks = tasks.filter(t => t.status === status);

          return (
            <div key={status} className="flex w-64 shrink-0 flex-col">
              <div className="mb-2 flex items-center gap-2 px-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
                <span className="text-xs text-muted-foreground/60">{columnTasks.length}</span>
              </div>

              <Droppable droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 space-y-2 rounded-lg p-1.5 transition-colors ${
                      snapshot.isDraggingOver ? 'bg-accent/50' : ''
                    }`}
                  >
                    {columnTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            onClick={() => onTaskClick(task.id)}
                            className={`cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md ${
                              snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20' : ''
                            }`}
                          >
                            <p className="text-sm font-medium leading-snug">{task.title}</p>

                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0"
                                style={{ color: TASK_PRIORITY_CONFIG[task.priority as keyof typeof TASK_PRIORITY_CONFIG]?.color }}
                              >
                                {task.priority}
                              </Badge>
                              {task.tags?.map((tag: string) => (
                                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                                  {tag}
                                </Badge>
                              ))}
                            </div>

                            <div className="mt-2.5 flex items-center justify-between">
                              {task.due_date && (
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Calendar className="h-3 w-3" />
                                  {format(new Date(task.due_date), 'MMM d')}
                                </div>
                              )}
                              {task.assignee && (
                                <Avatar className="h-5 w-5">
                                  <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                    {task.assignee.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
