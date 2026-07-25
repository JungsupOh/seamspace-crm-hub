import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Contacts from "./pages/Contacts";
import Deals from "./pages/Deals";
import Partners from "./pages/Partners";
import Campaigns from "./pages/Campaigns";
import CampaignForm from "./pages/CampaignForm";
import Licenses from "./pages/Licenses";
import PartnerPortal from "./pages/PartnerPortal";
import Upload from "./pages/Upload";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import OrderPay from "./pages/OrderPay";
import OrderTest from "./pages/OrderTest";
import OrderComplete from "./pages/OrderComplete";
import OrderFail from "./pages/OrderFail";
import ChangePassword from "./pages/ChangePassword";
import Users from "./pages/Users";
import AdminBackfillQuotePdfs from "./pages/AdminBackfillQuotePdfs";
import ApkPage from "./pages/Apk";
import ApkSubscribe from "./pages/ApkSubscribe";
import ApkInfo from "./pages/ApkInfo";
import ApkDownload from "./pages/ApkDownload";
import ApkUnsubscribe from "./pages/ApkUnsubscribe";
import Shop from "./pages/Shop";
import ShopProductDetail from "./pages/ShopProductDetail";
import ShopCart from "./pages/ShopCart";
import ShopCheckout from "./pages/ShopCheckout";
import ShopComplete from "./pages/ShopComplete";
import ShopFail from "./pages/ShopFail";
import ShopOrderLookup from "./pages/ShopOrderLookup";
import ShopOrders from "./pages/ShopOrders";
import ShopLuckySeven from "./pages/ShopLuckySeven";
import LuckySevenForm from "./pages/LuckySevenForm";
import LuckySevenPay from "./pages/LuckySevenPay";
import LuckySevenPayComplete from "./pages/LuckySevenPayComplete";
import LuckySevenPayFail from "./pages/LuckySevenPayFail";
import LuckySevenStatus from "./pages/LuckySevenStatus";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

function ForceSignOut() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  React.useEffect(() => {
    signOut().then(() => navigate('/login', { replace: true }));
  }, [signOut, navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">세션이 만료되었습니다. 다시 로그인해주세요.</p>
    </div>
  );
}

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

  // 프로필 없음 = 삭제/미등록 사용자 → 강제 로그아웃
  if (!userProfile) {
    return <ForceSignOut />;
  }

  // 비활성 계정 차단
  if (userProfile.status === 'inactive') {
    return <ForceSignOut />;
  }

  // Force password change for invited users
  const needsPasswordChange = userProfile.status === 'invited' || userProfile.status === 'invite_failed'
    || (!userProfile.status && userProfile.is_first_login);
  if (needsPasswordChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Partner: redirect to partner portal, block other pages
  if (userProfile?.role?.startsWith('partner_')) {
    if (location.pathname !== '/partner' && location.pathname !== '/change-password') {
      return <Navigate to="/partner" replace />;
    }
    return <>{children}</>;
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
      {/* 공개 캠페인 신청 폼 — 로그인 불필요 */}
      <Route path="/c/:slug" element={<CampaignForm />} />
      {/* 럭키세븐 이벤트 — 로그인 불필요 */}
      <Route path="/event/lucky-seven" element={<LuckySevenForm />} />
      <Route path="/event/lucky-seven/pay/complete" element={<LuckySevenPayComplete />} />
      <Route path="/event/lucky-seven/pay/fail" element={<LuckySevenPayFail />} />
      <Route path="/event/lucky-seven/pay/:quoteNumber" element={<LuckySevenPay />} />
      <Route path="/event/lucky-seven/status" element={<LuckySevenStatus />} />
      {/* APK 구독 — 공개 페이지 (로그인 불필요) */}
      <Route path="/apk/subscribe" element={<ApkSubscribe />} />
      <Route path="/apk/info" element={<ApkInfo />} />
      <Route path="/apk/download/:versionId" element={<ApkDownload />} />
      <Route path="/apk/unsubscribe" element={<ApkUnsubscribe />} />

      {/* /order — 견적 생성/조회/결제 통합 페이지 (구 /order-test) */}
      <Route path="/order" element={<OrderTest />} />
      <Route path="/order/pay/:quoteNumber" element={<OrderPay />} />
      <Route path="/order/complete" element={<OrderComplete />} />
      <Route path="/order/fail" element={<OrderFail />} />
      {/* 상품 스토어 — 로그인 불필요 */}
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/:id" element={<ShopProductDetail />} />
      <Route path="/shop/cart" element={<ShopCart />} />
      <Route path="/shop/checkout" element={<ShopCheckout />} />
      <Route path="/shop/complete" element={<ShopComplete />} />
      <Route path="/shop/fail" element={<ShopFail />} />
      <Route path="/shop/lookup" element={<ShopOrderLookup />} />
      {/* 럭키세븐 — Shop 카드 → 상세 이미지 → 신청 폼 진입 */}
      <Route path="/shop/lucky-seven" element={<ShopLuckySeven />} />
      {/* 레거시 호환 — 과거 /order-test로 이메일 발송된 건 그대로 동작 */}
      <Route path="/order-test" element={<OrderTest />} />
      <Route path="/order-test/complete" element={<OrderComplete />} />
      <Route path="/order-test/fail" element={<OrderFail />} />
      <Route path="/order-test/pay/:quoteNumber" element={<OrderPay />} />

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
        path="/campaigns"
        element={
          <RequireAuth>
            <AppLayout>
              <Campaigns />
            </AppLayout>
          </RequireAuth>
        }
      />
      {/* 레거시 경로 redirect */}
      <Route path="/trials" element={<Navigate to="/campaigns" replace />} />
      <Route
        path="/partner"
        element={
          <RequireAuth>
            <AppLayout>
              <PartnerPortal />
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
      <Route
        path="/admin/backfill-quote-pdfs"
        element={
          <RequireAuth>
            <AppLayout>
              <AdminBackfillQuotePdfs />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/apk"
        element={
          <RequireAuth>
            <AppLayout>
              <ApkPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/shop-orders"
        element={
          <RequireAuth>
            <AppLayout>
              <ShopOrders />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <AppErrorBoundary>
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
  </AppErrorBoundary>
);

export default App;
