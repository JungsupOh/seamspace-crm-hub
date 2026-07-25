import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { makeT, type PartnerLocale } from '@/lib/partner-i18n';

// 단일 역할 축. 파트너는 partner_admin/member/viewer로 세분.
export type UserRole =
  | 'admin' | 'sub_admin'
  | 'partner_admin' | 'partner_member' | 'partner_viewer'
  | 'guest';
export type UserStatus = 'invite_failed' | 'invited' | 'active' | 'inactive';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  is_first_login: boolean;
  created_by: string | null;
  partner_id: string | null;
  created_at: string;
}

interface AuthContextValue {
  currentUser: User | null;
  userProfile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  isAdmin: boolean;
  isSubAdmin: boolean;
  isGuest: boolean;
  isPartner: boolean;
  canEdit: boolean;
  // 파트너 옵션 (partners 테이블) — 파트너 포털 언어/통화/발급권한 게이팅용
  canIssueLicenses: boolean;
  partnerLocale: PartnerLocale;
  partnerCurrency: string;
  partnerCountry: string;
  // 파트너 역할 기반 권한
  canEditPartnerDeals: boolean;   // partner_admin | partner_member — 딜 등록/수정/삭제
  canManageLicenses: boolean;     // partner_admin AND 업체 발급허용 — 발급/재발송/무효화/코드열람
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [partnerOptions, setPartnerOptions] = useState<{ can_issue_licenses: boolean; locale: string; currency: string; country: string } | null>(null);
  // 이미 로드된 유저 ID 추적 — 탭 전환 시 토큰 갱신 이벤트에서 profileLoading 블로킹 방지
  const loadedUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('프로필 조회 오류:', error);
      return null;
    }
    return data as UserProfile;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!currentUser) return;
    const profile = await fetchProfile(currentUser.id);
    setUserProfile(profile);
  }, [currentUser, fetchProfile]);

  useEffect(() => {
    let resolved = false;

    // Safety timeout: if Supabase doesn't respond in 8s, unblock the UI
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.warn('Supabase getSession timed out — unblocking loading');
        resolved = true;
        setLoading(false);
      }
    }, 8000);

    // Get initial session
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        setSession(session);
        setCurrentUser(session?.user ?? null);
        if (session?.user) {
          const profile = await fetchProfile(session.user.id);
          setUserProfile(profile);
          loadedUserIdRef.current = session.user.id;
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('getSession 오류:', err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          setLoading(false);
        }
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setCurrentUser(session?.user ?? null);
      setLoading(false);

      if (session?.user) {
        if (loadedUserIdRef.current === session.user.id) {
          // 이미 이 유저의 프로필이 로드됨 (탭 복귀 시 TOKEN_REFRESHED/SIGNED_IN)
          // → profileLoading 없이 백그라운드에서만 조용히 갱신
          fetchProfile(session.user.id).then(p => { if (p) setUserProfile(p); });
        } else {
          // 신규 로그인 — 블로킹 로드
          loadedUserIdRef.current = session.user.id;
          setProfileLoading(true);
          fetchProfile(session.user.id).then(p => {
            setUserProfile(p);
            setProfileLoading(false);
          });
        }
      } else {
        loadedUserIdRef.current = null;
        setUserProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // 파트너 옵션 로드 (partner 계정일 때만) — 언어/통화/발급권한 게이팅용
  useEffect(() => {
    const pid = userProfile?.partner_id;
    if (!pid) { setPartnerOptions(null); return; }
    let cancelled = false;
    supabase
      .from('partners')
      .select('can_issue_licenses, locale, currency, country')
      .eq('id', pid)
      .single()
      .then(({ data }) => { if (!cancelled && data) setPartnerOptions(data as typeof partnerOptions); });
    return () => { cancelled = true; };
  }, [userProfile?.partner_id]);

  const signIn = async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // 로그인 전에는 사용자의 언어를 알 수 없으므로 로그인 화면 문구는 영어로 통일한다.
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Incorrect email or password.');
      }
      throw new Error(error.message);
    }
    // Check inactive status after successful auth
    if (data.user) {
      const profile = await fetchProfile(data.user.id);
      if (profile?.status === 'inactive') {
        await supabase.auth.signOut();
        throw new Error('This account is deactivated. Please contact your administrator.');
      }
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUserProfile(null);
    setSession(null);
  };

  const changePassword = async (newPassword: string, currentPassword?: string) => {
    // Verify current password first if provided
    if (currentPassword && currentUser?.email) {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPassword,
      });
      // 이 시점엔 로그인 상태라 파트너 언어를 알 수 있다 (비밀번호 변경 화면과 동일 언어)
      if (verifyError) throw new Error(makeT((partnerOptions?.locale as PartnerLocale) ?? 'ko')({
        ko: '현재 비밀번호가 올바르지 않습니다.',
        ja: '現在のパスワードが正しくありません。',
        en: 'Your current password is incorrect.',
      }));
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);

    // Mark first login as complete
    if (currentUser) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ is_first_login: false, status: 'active' })
        .eq('id', currentUser.id);

      if (profileError) console.error('프로필 업데이트 오류:', profileError);

      // Refresh local profile
      const profile = await fetchProfile(currentUser.id);
      setUserProfile(profile);
    }
  };

  const isAdmin = userProfile?.role === 'admin';
  const isSubAdmin = userProfile?.role === 'sub_admin';
  const isGuest = userProfile?.role === 'guest';
  const role = userProfile?.role;
  const isPartner = role === 'partner_admin' || role === 'partner_member' || role === 'partner_viewer';
  const canEdit = isAdmin || isSubAdmin;
  // 업체 스위치 — 이 파트너가 이용권을 발급할 수 있는 계약인가 (섹션 노출 여부)
  const canIssueLicenses = !!partnerOptions?.can_issue_licenses;
  const partnerLocale = (partnerOptions?.locale as PartnerLocale) ?? 'ko';
  const partnerCurrency = partnerOptions?.currency ?? 'KRW';
  const partnerCountry = partnerOptions?.country ?? 'KR';
  // 파트너 역할 기반 권한
  const canEditPartnerDeals = role === 'partner_admin' || role === 'partner_member';
  const canManageLicenses = canIssueLicenses && role === 'partner_admin';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        session,
        loading,
        profileLoading,
        signIn,
        signOut,
        changePassword,
        refreshProfile,
        isAdmin,
        isSubAdmin,
        isGuest,
        isPartner,
        canEdit,
        canIssueLicenses,
        partnerLocale,
        partnerCurrency,
        partnerCountry,
        canEditPartnerDeals,
        canManageLicenses,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
