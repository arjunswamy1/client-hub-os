import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, Phone, Palette, Globe,
  Database, Bot, Settings, Users, Shield, Rocket, Film, Sparkles, PhoneCall, Upload, Tv,
  ClipboardList, Gauge, CalendarCheck PhoneForwarded,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter,
  SidebarHeader, useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { ClientSwitcher } from '@/components/layout/ClientSwitcher';


const clientNavItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Tasks', url: '/tasks', icon: CheckSquare },
  { title: 'Agendas', url: '/agendas', icon: Phone },
  { title: 'Creative Production', url: '/creative', icon: Palette },
  { title: 'Production', url: '/production', icon: Film },
  { title: 'AI Video Studio', url: '/ai-video', icon: Sparkles },
  { title: 'Landing Pages', url: '/landing-pages', icon: Globe },
  { title: 'Context Feed', url: '/context', icon: Database },
  { title: 'AI Assistant', url: '/ai', icon: Bot },
  { title: 'Campaign Build', url: '/campaign-build', icon: Rocket },
  { title: 'DIDs', url: '/dids', icon: PhoneCall },
  { title: 'RingFuel Numbers', url: '/ringfuel-numbers', icon: PhoneCall },
  { title: 'Spend Upload', url: '/spend-upload', icon: Upload },
  { title: 'Roku Connections', url: '/roku-connections', icon: Tv },
];

const bottomItems = [
  { title: 'Settings', url: '/settings', icon: Settings },
  { title: 'Team', url: '/team', icon: Users },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { isAdmin, isAccountManager } = useAuth();
  const { activeClient } = useClient();

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-3 py-4">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-1">
            <img src="/logo.png" alt="Connect Paid Media" className="h-8 w-8 rounded-lg object-contain" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-accent-foreground">Connect Paid Media</span>
              <span className="text-[11px] text-sidebar-muted">Client Hub</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <img src="/logo.png" alt="CPM" className="h-8 w-8 rounded-lg object-contain" />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-2">
        {/* Client Switcher */}
        {!collapsed && (
          <div className="px-1 pb-2">
            <ClientSwitcher />
          </div>
        )}

        {/* Client Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {clientNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild size="sm">
                    <NavLink
                      to={item.url}
                      end={item.url === '/dashboard'}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Media Brain — admins and assigned account managers only */}
        {(isAdmin || isAccountManager) && activeClient?.id && (
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel>Media Brain</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {[
                  { title: 'Intake', url: `/media-brain/${activeClient.id}/intake`, icon: ClipboardList },
                  { title: 'Daily', url: `/media-brain/${activeClient.id}/daily`, icon: Gauge },
                  { title: 'Weekly Review', url: `/media-brain/${activeClient.id}/weekly`, icon: CalendarCheck },
                  { title: 'DID Mappings', url: `/media-brain/${activeClient.id}/mappings`, icon: PhoneForwarded },
                ].map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild size="sm">
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>


      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          {bottomItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild size="sm">
                <NavLink
                  to={item.url}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="sm">
                <NavLink
                  to="/admin"
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                >
                  <Shield className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Admin</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
