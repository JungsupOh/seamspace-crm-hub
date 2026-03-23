import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Contacts from "./pages/Contacts";
import Deals from "./pages/Deals";
import Partners from "./pages/Partners";
import Trials from "./pages/Trials";
import Licenses from "./pages/Licenses";
import Upload from "./pages/Upload";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Users from "./pages/Users";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 2,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser, userProfile, loading, profileLoading } = useAuth();
  const location = useLocation();

  if (loading || (currentUser && profileLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Force password change for invited users
  const needsPasswordChange = userProfile?.status === 'invited' || userProfile?.status === 'invite_failed'
    || (!userProfile?.status && userProfile?.is_first_login);
  if (needsPasswordChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Guest access restriction
  const guestBlockedPaths = ['/licenses', '/partners', '/trials', '/upload', '/users'];
  if (userProfile?.role === 'guest' && guestBlockedPaths.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { currentUser, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    );
  }

  // Redirect logged-in users away from /login
  if (currentUser && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />

      {/* Change password - requires auth but not full layout */}
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePassword />
          </RequireAuth>
        }
      />

      {/* Protected routes inside AppLayout */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout>
              <Index />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/contacts"
        element={
          <RequireAuth>
            <AppLayout>
              <Contacts />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/deals"
        element={
          <RequireAuth>
            <AppLayout>
              <Deals />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/partners"
        element={
          <RequireAuth>
            <AppLayout>
              <Partners />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/trials"
        element={
          <RequireAuth>
            <AppLayout>
              <Trials />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/licenses"
        element={
          <RequireAuth>
            <AppLayout>
              <Licenses />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireAuth>
            <AppLayout>
              <Upload />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <AppLayout>
              <Users />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
