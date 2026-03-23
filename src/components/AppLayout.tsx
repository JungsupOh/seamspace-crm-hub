import { ReactNode, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Search, Bell, Moon, Sun, ChevronDown, KeyRound, LogOut, UserCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';

type UserRole = 'admin' | 'sub_admin' | 'guest';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  sub_admin: '서브관리자',
  guest: '게스트',
};

const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  sub_admin: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  guest: 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400',
};

export function AppLayout({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const role = userProfile?.role as UserRole | undefined;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 px-4 border-b border-border glass-header sticky top-0 z-30">
            <SidebarTrigger className="shrink-0" />
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="검색..."
                className="pl-8 h-8 text-data bg-secondary/50 border-0 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDark(!dark)}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 relative">
                <Bell className="h-4 w-4" />
              </Button>

              {/* User menu */}
              {userProfile && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-8 gap-2 px-2 ml-1 hover:bg-accent"
                    >
                      <UserCircle2 className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="hidden sm:block text-sm font-medium max-w-[120px] truncate">
                        {userProfile.name || userProfile.email.split('@')[0]}
                      </span>
                      {role && (
                        <span
                          className={`hidden sm:inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_BADGE_CLASSES[role]}`}
                        >
                          {ROLE_LABELS[role]}
                        </span>
                      )}
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-0.5">
                        <p className="text-sm font-medium leading-none truncate">
                          {userProfile.name || '—'}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground truncate">
                          {userProfile.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/change-password')} className="gap-2 cursor-pointer">
                      <KeyRound className="h-4 w-4" />
                      비밀번호 변경
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <LogOut className="h-4 w-4" />
                      로그아웃
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="max-w-[1440px] mx-auto px-6 py-6 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
