
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { format } from 'date-fns';

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-medium text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <h4 className="text-sm font-medium">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => markAllRead.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notifications</p>
          ) : (
            <div className="divide-y">
              {notifications.map((n: any) => (
                <button
                  key={n.id}
                  className={`w-full text-left px-4 py-3 hover:bg-accent transition-colors ${!n.is_read ? 'bg-primary/5' : ''}`}
                  onClick={() => !n.is_read && markRead.mutate(n.id)}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(n.created_at), 'MMM d, HH:mm')}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
