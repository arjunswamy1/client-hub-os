
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Image, Video, LayoutGrid, Film } from 'lucide-react';
import { format, differenceInDays, isPast } from 'date-fns';
import { BRIEF_STATUSES, STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';

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
  return (
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
              <div className="space-y-2.5">
                {col.map((brief: any) => (
                  <BriefCard key={brief.id} brief={brief} onClick={() => onBriefClick(brief.id)} />
                ))}
                {col.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center">
                    <p className="text-xs text-muted-foreground">No briefs</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function BriefCard({ brief, onClick }: { brief: any; onClick: () => void }) {
  const TypeIcon = TYPE_ICONS[brief.creative_type] || Image;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

  const dueDate = brief.due_date ? new Date(brief.due_date) : null;
  const daysUntilDue = dueDate ? differenceInDays(dueDate, new Date()) : null;
  const isOverdue = dueDate ? isPast(dueDate) && !['approved', 'delivered'].includes(brief.status) : false;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 2 && daysUntilDue >= 0;

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="rounded bg-accent p-1">
              <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium truncate">{brief.title}</p>
          </div>
          <Badge variant="secondary" className={`text-[9px] shrink-0 ${priorityConf.color}`}>
            {priorityConf.label}
          </Badge>
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
