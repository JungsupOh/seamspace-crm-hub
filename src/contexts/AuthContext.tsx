import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type UserRole = 'admin' | 'sub_admin' | 'guest';
export type UserStatus = 'invite_failed' | 'invited' | 'active' | 'inactive';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  is_first_login: boolean;
  created_by: string | null;
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
  canEdit: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

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
        setProfileLoading(true);
        fetchProfile(session.user.id).then((profile) => {
          setUserProfile(profile);
          setProfileLoading(false);
        });
      } else {
        setUserProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
      }
      throw new Error(error.message);
    }
    // Check inactive status after successful auth
    if (data.user) {
      const profile = await fetchProfile(data.user.id);
      if (profile?.status === 'inactive') {
        await supabase.auth.signOut();
        throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
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
      if (verifyError) throw new Error('현재 비밀번호가 올바르지 않습니다.');
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
  const canEdit = isAdmin || isSubAdmin;

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
        canEdit,
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
