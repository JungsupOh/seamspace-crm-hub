import { LayoutDashboard, Users, Briefcase, Building2, FlaskConical } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';

const items = [
  { title: '대시보드', url: '/', icon: LayoutDashboard },
  { title: '연락처', url: '/contacts', icon: Users },
  { title: '딜 관리', url: '/deals', icon: Briefcase },
  { title: '조직 관리', url: '/organizations', icon: Building2 },
  { title: 'Trial PQL', url: '/trials', icon: FlaskConical },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className={`px-4 pt-5 pb-2 ${collapsed ? 'px-2' : ''}`}>
          {!collapsed && (
            <h1 className="display-heading text-lg tracking-tight">
              Seamspace
              <span className="text-muted-foreground font-normal text-meta ml-1">GTM CRM</span>
            </h1>
          )}
          {collapsed && <span className="display-heading text-lg">S</span>}
        </div>
        <SidebarGroup>
          <SidebarGroupLabel>메뉴</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === '/'} activeClassName="bg-accent font-medium">
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
