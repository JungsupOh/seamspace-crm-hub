import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { sendTelegramNotification } from '@/lib/telegram';
import { makeT } from '@/lib/partner-i18n';

export default function ChangePassword() {
  const { changePassword, userProfile, signOut, partnerLocale } = useAuth();
  const navigate = useNavigate();
  // 해외 파트너는 초대 메일이 영어/일본어로 나가므로 첫 관문인 이 화면도 같은 언어로 맞춘다.
  // 파트너가 아닌 사용자(관리자/게스트)는 partnerLocale 기본값 'ko' → 기존 한국어 그대로.
  const t = makeT(partnerLocale);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const isFirstLogin = userProfile?.status === 'invited' || userProfile?.status === 'invite_failed';

  const validate = (): string | null => {
    if (!isFirstLogin && !currentPassword)
      return t({ ko: '현재 비밀번호를 입력해 주세요.', ja: '現在のパスワードを入力してください。', en: 'Please enter your current password.' });
    if (newPassword.length < 8)
      return t({ ko: '비밀번호는 8자 이상이어야 합니다.', ja: 'パスワードは8文字以上で入力してください。', en: 'Password must be at least 8 characters.' });
    if (newPassword !== confirmPassword)
      return t({ ko: '비밀번호가 일치하지 않습니다.', ja: 'パスワードが一致しません。', en: 'Passwords do not match.' });
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setLoading(true);
    try {
      await changePassword(newPassword, isFirstLogin ? undefined : currentPassword);
      if (isFirstLogin && userProfile) {
        sendTelegramNotification(
          `👤 <b>사용자 활성화</b>\n\n` +
          `📧 ${userProfile.email}\n` +
          `🏷 ${userProfile.name || '—'}\n` +
          `🔑 역할: ${userProfile.role === 'partner' ? '파트너' : userProfile.role}`
        );
      }
      toast.success(t({ ko: '비밀번호가 성공적으로 변경되었습니다.', ja: 'パスワードを変更しました。', en: 'Your password has been changed.' }));
      navigate('/', { replace: true });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message
        : t({ ko: '비밀번호 변경에 실패했습니다.', ja: 'パスワードの変更に失敗しました。', en: 'Failed to change password.' }));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const passwordStrength = (): { label: string; color: string; width: string } => {
    const len = newPassword.length;
    if (len === 0) return { label: '', color: '', width: '0%' };
    if (len < 8) return { label: t({ ko: '너무 짧음', ja: '短すぎます', en: 'Too short' }), color: 'bg-destructive', width: '25%' };
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNum = /[0-9]/.test(newPassword);
    const hasSpec = /[^A-Za-z0-9]/.test(newPassword);
    const score = [hasUpper, hasLower, hasNum, hasSpec].filter(Boolean).length;
    if (score <= 2) return { label: t({ ko: '보통', ja: '普通', en: 'Fair' }), color: 'bg-yellow-500', width: '50%' };
    if (score === 3) return { label: t({ ko: '강함', ja: '強い', en: 'Strong' }), color: 'bg-blue-500', width: '75%' };
    return { label: t({ ko: '매우 강함', ja: '非常に強い', en: 'Very strong' }), color: 'bg-green-500', width: '100%' };
  };

  const strength = passwordStrength();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            Seamspace
            <span className="text-muted-foreground font-normal ml-1.5">GTM CRM</span>
          </h1>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {/* First login notice */}
          {isFirstLogin && (
            <div className="mb-5 flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {t({ ko: '처음 로그인하셨습니다.', ja: '初回ログインです。', en: 'This is your first sign-in.' })}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  {t({ ko: '보안을 위해 비밀번호를 변경해 주세요.', ja: 'セキュリティのため、パスワードを変更してください。', en: 'Please set a new password for security.' })}
                </p>
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold mb-5">
            {t({ ko: '비밀번호 변경', ja: 'パスワード変更', en: 'Change password' })}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current password — only for voluntary change */}
            {!isFirstLogin && (
              <div className="space-y-1.5">
                <Label htmlFor="current-password">
                  {t({ ko: '현재 비밀번호', ja: '現在のパスワード', en: 'Current password' })}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    placeholder={t({ ko: '현재 비밀번호를 입력하세요', ja: '現在のパスワードを入力', en: 'Enter your current password' })}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pl-9 pr-9"
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* New password */}
            <div className="space-y-1.5">
              <Label htmlFor="new-password">
                {t({ ko: '새 비밀번호', ja: '新しいパスワード', en: 'New password' })}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  placeholder={t({ ko: '8자 이상 입력하세요', ja: '8文字以上で入力', en: 'At least 8 characters' })}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-9 pr-9"
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Strength bar */}
              {newPassword.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                      style={{ width: strength.width }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t({ ko: '강도', ja: '強度', en: 'Strength' })}: {strength.label}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">
                {t({ ko: '비밀번호 확인', ja: 'パスワード確認', en: 'Confirm password' })}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder={t({ ko: '비밀번호를 다시 입력하세요', ja: 'パスワードを再入力', en: 'Re-enter your password' })}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-9 pr-9"
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">
                  {t({ ko: '비밀번호가 일치하지 않습니다.', ja: 'パスワードが一致しません。', en: 'Passwords do not match.' })}
                </p>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && newPassword.length >= 8 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {t({ ko: '비밀번호가 일치합니다.', ja: 'パスワードが一致しました。', en: 'Passwords match.' })}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? t({ ko: '변경 중...', ja: '変更中...', en: 'Changing...' })
                : t({ ko: '비밀번호 변경', ja: 'パスワード変更', en: 'Change password' })}
            </Button>
          </form>

          {!isFirstLogin && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                {t({ ko: '취소', ja: 'キャンセル', en: 'Cancel' })}
              </button>
            </div>
          )}

          {isFirstLogin && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                {t({ ko: '로그아웃', ja: 'ログアウト', en: 'Sign out' })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
