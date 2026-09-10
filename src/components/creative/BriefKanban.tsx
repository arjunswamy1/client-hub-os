
import { useCallback, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Image, Video, LayoutGrid, Film, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { format, differenceInDays, isPast } from 'date-fns';
import { BRIEF_STATUSES, STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { EditBriefDialog } from './EditBriefDialog';

const TYPE_ICONS: Record<string, any> = {
  static: Image, video: Video, carousel: LayoutGrid,
  story_reel: Film, motion: Film, ugc: Video, other: Image,
};

interface Props {
  briefs: any[];
  onBriefClick: (briefId: string) => void;
  onStatusChange: (briefId: string, status: string) => void;
}

export function BriefKanban({ briefs, onBriefClick, onStatusChange }: Props) {
  const { isAdmin, teamMember } = useAuth();
  const canManage = isAdmin || ['account_manager', 'creative_director', 'designer'].includes(teamMember?.role || '');
  const queryClient = useQueryClient();
  const [editingBrief, setEditingBrief] = useState<any | null>(null);
  const [deletingBrief, setDeletingBrief] = useState<any | null>(null);

  const deleteBrief = useMutation({
    mutationFn: async (brief: any) => {
      const deletedAt = new Date().toISOString();
      // Soft-delete brief and any of its time entries together
      const { error } = await supabase
        .from('creative_briefs')
        .update({ deleted_at: deletedAt } as any)
        .eq('id', brief.id);
      if (error) throw error;
      await supabase
        .from('creative_time_entries')
        .update({ deleted_at: deletedAt } as any)
        .eq('brief_id', brief.id)
        .is('deleted_at', null);
      return { brief, deletedAt };
    },
    onSuccess: ({ brief }) => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      toast.success(`Deleted "${brief.title}"`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await supabase.from('creative_briefs').update({ deleted_at: null } as any).eq('id', brief.id);
            await supabase.from('creative_time_entries').update({ deleted_at: null } as any).eq('brief_id', brief.id);
            queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
            queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
            toast.success('Brief restored');
          },
        },
      });
      setDeletingBrief(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const briefId = result.draggableId;
    const brief = briefs.find((b: any) => b.id === briefId);
    if (brief && brief.status !== newStatus) {
      onStatusChange(briefId, newStatus);
    }
  }, [briefs, onStatusChange]);

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4 min-w-max">
            {BRIEF_STATUSES.map(status => {
              const config = STATUS_CONFIG[status];
              const col = briefs.filter((b: any) => b.status === status);
              return (
                <div key={status} className="w-72 shrink-0">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Badge variant="secondary" className={`text-[10px] ${config.color}`}>{config.label}</Badge>
                    <span className="text-xs text-muted-foreground">{col.length}</span>
                  </div>
                  <Droppable droppableId={status}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`space-y-2.5 min-h-[60px] rounded-lg p-1 transition-colors ${snapshot.isDraggingOver ? 'bg-accent/50 ring-1 ring-primary/20' : ''}`}
                      >
                        {col.map((brief: any, index: number) => (
                          <Draggable key={brief.id} draggableId={brief.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={dragSnapshot.isDragging ? 'opacity-90 rotate-1' : ''}
                              >
                                <BriefCard
                                  brief={brief}
                                  onClick={() => onBriefClick(brief.id)}
                                  canManage={canManage}
                                  onEdit={() => setEditingBrief(brief)}
                                  onDelete={() => setDeletingBrief(brief)}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {col.length === 0 && !snapshot.isDraggingOver && (
                          <div className="rounded-lg border border-dashed p-4 text-center">
                            <p className="text-xs text-muted-foreground">No briefs</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </DragDropContext>

      {editingBrief && (
        <EditBriefDialog
          brief={editingBrief}
          open={!!editingBrief}
          onOpenChange={(o) => { if (!o) setEditingBrief(null); }}
        />
      )}

      <AlertDialog open={!!deletingBrief} onOpenChange={(o) => { if (!o) setDeletingBrief(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this brief?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deletingBrief?.title}" will be removed. You'll have 15 seconds to undo from the toast.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingBrief && deleteBrief.mutate(deletingBrief)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BriefCard({ brief, onClick, canManage, onEdit, onDelete }: {
  brief: any;
  onClick: () => void;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const TypeIcon = TYPE_ICONS[brief.creative_type] || Image;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

  const dueDate = brief.due_date ? new Date(brief.due_date) : null;
  const daysUntilDue = dueDate ? differenceInDays(dueDate, new Date()) : null;
  const isOverdue = dueDate ? isPast(dueDate) && !['approved', 'delivered'].includes(brief.status) : false;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 2 && daysUntilDue >= 0;

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20 group relative"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="rounded bg-accent p-1">
              <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              {brief.client_name && (
                <p className="text-[9px] text-muted-foreground font-medium">{brief.client_name}</p>
              )}
              <p className="text-sm font-medium truncate">{brief.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className={`text-[9px] ${priorityConf.color}`}>
              {priorityConf.label}
            </Badge>
            {canManage && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete brief"
                  title="Delete brief"
                  className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-60 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

          </div>
        </div>

        {/* Platforms */}
        {brief.platforms?.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {brief.platforms.slice(0, 3).map((p: string) => (
              <Badge key={p} variant="outline" className="text-[9px] px-1.5 py-0 capitalize">{p.replace('_', ' ')}</Badge>
            ))}
            {brief.platforms.length > 3 && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">+{brief.platforms.length - 3}</Badge>
            )}
          </div>
        )}

        {/* Due date */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            {brief.assigned_to ? (
              <>
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                    {brief.assigned_to.name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="text-muted-foreground">{brief.assigned_to.name?.split(' ')[0]}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </div>
          {dueDate && (
            <span className={`text-xs font-medium ${isOverdue ? 'text-destructive' : isDueSoon ? 'text-warning' : 'text-muted-foreground'}`}>
              {isOverdue ? 'Overdue' : isDueSoon ? `Due in ${daysUntilDue}d` : format(dueDate, 'MMM d')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
