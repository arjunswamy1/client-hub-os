import { ReactNode, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { LogOut, LayoutDashboard, Megaphone } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { BookCallButton } from '@/components/portal/BookCallButton';
import { cn } from '@/lib/utils';

interface PortalLayoutProps {
  children: ReactNode;
  activeTab: 'dashboard' | 'live-ads';
  onTabChange: (tab: 'dashboard' | 'live-ads') => void;
  isAdminPreview?: boolean;
  adminName?: string;
}

export function PortalLayout({ children, activeTab, onTabChange, isAdminPreview, adminName }: PortalLayoutProps) {
  const { user, signOut } = useAuth();
  const { activeClient } = useClient();

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'User';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  const tabs = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live-ads' as const, label: 'Live Ads', icon: Megaphone },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isAdminPreview && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-1.5 text-center text-xs font-medium text-primary">
          Viewing as: {adminName} (Admin Preview)
        </div>
      )}

      {/* Top Navigation */}
      <header className="border-b bg-card px-4 sm:px-6">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between">
          {/* Left: Client branding */}
          <div className="flex items-center gap-3">
            {activeClient?.logo_url ? (
              <img src={activeClient.logo_url} alt={activeClient.name} className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: activeClient?.color || 'hsl(220, 70%, 50%)' }}
              >
                {activeClient?.name?.[0] || 'C'}
              </div>
            )}
            <span className="text-sm font-semibold">{activeClient?.name || 'Client Portal'}</span>
          </div>

          {/* Center: Tabs */}
          <nav className="flex items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <tab.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Right: Book a call + User menu */}
          <div className="flex items-center gap-2">
            <BookCallButton variant="outline" size="sm" className="hidden sm:inline-flex h-8 gap-1.5 text-xs" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              {!isAdminPreview && (
                <DropdownMenuItem onClick={signOut} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-3 text-center text-xs text-muted-foreground">
        Powered by CPM
      </footer>
    </div>
  );
}
