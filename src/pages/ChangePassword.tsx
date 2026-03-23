import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';

export default function ChangePassword() {
  const { changePassword, userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const isFirstLogin = userProfile?.status === 'invited' || userProfile?.status === 'invite_failed';

  const validate = (): string | null => {
    if (!isFirstLogin && !currentPassword) return '현재 비밀번호를 입력해 주세요.';
    if (newPassword.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
    if (newPassword !== confirmPassword) return '비밀번호가 일치하지 않습니다.';
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
      toast.success('비밀번호가 성공적으로 변경되었습니다.');
      navigate('/', { replace: true });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다.');
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
    if (len < 8) return { label: '너무 짧음', color: 'bg-destructive', width: '25%' };
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNum = /[0-9]/.test(newPassword);
    const hasSpec = /[^A-Za-z0-9]/.test(newPassword);
    const score = [hasUpper, hasLower, hasNum, hasSpec].filter(Boolean).length;
    if (score <= 2) return { label: '보통', color: 'bg-yellow-500', width: '50%' };
    if (score === 3) return { label: '강함', color: 'bg-blue-500', width: '75%' };
    return { label: '매우 강함', color: 'bg-green-500', width: '100%' };
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
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">처음 로그인하셨습니다.</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">보안을 위해 비밀번호를 변경해 주세요.</p>
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold mb-5">비밀번호 변경</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current password — only for voluntary change */}
            {!isFirstLogin && (
              <div className="space-y-1.5">
                <Label htmlFor="current-password">현재 비밀번호</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    placeholder="현재 비밀번호를 입력하세요"
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
              <Label htmlFor="new-password">새 비밀번호</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  placeholder="8자 이상 입력하세요"
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
                  <p className="text-xs text-muted-foreground">강도: {strength.label}</p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">비밀번호 확인</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="비밀번호를 다시 입력하세요"
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
                <p className="text-xs text-destructive">비밀번호가 일치하지 않습니다.</p>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && newPassword.length >= 8 && (
                <p className="text-xs text-green-600 dark:text-green-400">비밀번호가 일치합니다.</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>

          {!isFirstLogin && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                취소
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
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
