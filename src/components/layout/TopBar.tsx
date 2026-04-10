import { Search, LogOut } from 'lucide-react';
import { NotificationBell } from '@/components/creative/NotificationBell';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

export function TopBar() {
  const { user, teamMember, signOut } = useAuth();
  const { activeClient } = useClient();

  const initials = teamMember?.name
    ? teamMember.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : user?.email?.[0]?.toUpperCase() || '?';

  const roleBadge = teamMember?.role === 'admin' ? 'Admin'
    : teamMember?.role === 'account_manager' ? 'AM'
    : teamMember?.role === 'designer' ? 'Designer'
    : null;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        {activeClient && (
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: activeClient.color || 'hsl(220, 70%, 50%)' }}
            />
            <span className="text-sm font-medium">{activeClient.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Search className="h-4 w-4" />
        </button>
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {roleBadge && (
                <Badge variant="secondary" className="text-[10px] font-medium">
                  {roleBadge}
                </Badge>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{teamMember?.name || user?.email}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuItem onClick={signOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
