import { LayoutDashboard, Users, Briefcase, Building2, FlaskConical, Upload, Key, UserCog } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext';

const mainItems = [
  { title: '대시보드', url: '/', icon: LayoutDashboard, guestAllowed: true },
  { title: '고객', url: '/contacts', icon: Users, guestAllowed: true },
  { title: '딜 관리', url: '/deals', icon: Briefcase, guestAllowed: true },
  { title: '이용권 관리', url: '/licenses', icon: Key, guestAllowed: false },
  { title: '파트너 관리', url: '/partners', icon: Building2, guestAllowed: false },
  { title: '이벤트(무료체험)', url: '/trials', icon: FlaskConical, guestAllowed: false },
  { title: '데이터 업로드', url: '/upload', icon: Upload, guestAllowed: false },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { isAdmin, isGuest } = useAuth();
  const collapsed = state === 'collapsed';
  const visibleItems = mainItems.filter(item => !isGuest || item.guestAllowed);

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
              {visibleItems.map((item) => (
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

        {/* Admin-only section */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>관리</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/users" activeClassName="bg-accent font-medium">
                      <UserCog className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>사용자 관리</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
