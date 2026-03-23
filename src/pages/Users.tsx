import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, UserRole, UserStatus } from '@/contexts/AuthContext';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { UserPlus, RefreshCw, Trash2, Copy, Check, UserCog, Mail, Ban, CheckCircle } from 'lucide-react';
import { sendInviteEmail, sendPasswordResetEmail } from '@/lib/email';

interface UserProfileRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  is_first_login: boolean;
  created_at: string;
  last_sign_in_at?: string | null;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  sub_admin: '서브관리자',
  guest: '게스트',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  invite_failed: '초대실패',
  invited: '초대',
  active: '활성',
  inactive: '비활성',
};

const STATUS_BADGE_CLASSES: Record<UserStatus, string> = {
  invite_failed: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800',
  invited: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
  active: 'bg-green-50 text-green-600 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800',
  inactive: 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800/60 dark:text-gray-500 dark:border-gray-700',
};

const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
  sub_admin: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  guest: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-700',
};

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export default function Users() {
  const { isAdmin, currentUser } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('guest');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ code: string; email: string } | null>(null);

  // Resend invite confirm
  const [resendTarget, setResendTarget] = useState<UserProfileRow | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<UserProfileRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reset password
  const [resetTarget, setResetTarget] = useState<UserProfileRow | null>(null);
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [copied, setCopied] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('사용자 목록을 불러오지 못했습니다.');
      setLoadingUsers(false);
      return;
    }

    // Fetch last_sign_in_at from auth.users via admin API
    let authUsers: Record<string, string | null> = {};
    if (supabaseAdmin) {
      const { data: adminData } = await supabaseAdmin.auth.admin.listUsers();
      if (adminData) {
        authUsers = Object.fromEntries(
          adminData.users.map((u) => [u.id, u.last_sign_in_at ?? null])
        );
      }
    }

    const merged = (data as UserProfileRow[]).map((u) => ({
      ...u,
      last_sign_in_at: authUsers[u.id] ?? null,
    }));

    setUsers(merged);
    setLoadingUsers(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/', { replace: true });
      return;
    }
    fetchUsers();
  }, [isAdmin, navigate, fetchUsers]);

  // ----- Invite -----
  const openInviteDialog = () => {
    setInviteName('');
    setInviteEmail('');
    setInviteRole('guest');
    setInviteCode(generateCode());
    setInviteResult(null);
    setInviteOpen(true);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('이메일을 입력해 주세요.');
      return;
    }
    if (!inviteCode.trim()) {
      toast.error('초대 코드를 생성해 주세요.');
      return;
    }

    setInviteLoading(true);

    if (!supabaseAdmin) {
      // No service key: just show the invite info without creating auth user
      const { error } = await supabase.from('user_profiles').insert({
        id: crypto.randomUUID(),
        email: inviteEmail.trim().toLowerCase(),
        name: inviteName.trim() || null,
        role: inviteRole,
        is_first_login: true,
        created_by: currentUser?.id ?? null,
      });

      if (error) {
        toast.error('사용자 정보 저장에 실패했습니다: ' + error.message);
        setInviteLoading(false);
        return;
      }

      setInviteResult({ code: inviteCode, email: inviteEmail.trim().toLowerCase() });
      await fetchUsers();
      setInviteLoading(false);
      return;
    }

    // Use admin API to create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: inviteEmail.trim().toLowerCase(),
      password: inviteCode,
      email_confirm: true,
      user_metadata: {
        name: inviteName.trim() || null,
        role: inviteRole,
      },
    });

    if (authError) {
      toast.error('사용자 생성 실패: ' + authError.message);
      setInviteLoading(false);
      return;
    }

    // Send invite email first to determine status
    let emailSent = false;
    try {
      await sendInviteEmail({
        to: inviteEmail.trim().toLowerCase(),
        name: inviteName.trim(),
        inviteCode,
        role: inviteRole,
        invitedBy: currentUser?.email ?? '관리자',
      });
      emailSent = true;
      toast.success('초대 이메일이 발송되었습니다.');
    } catch (e) {
      toast.warning('사용자는 생성됐지만 이메일 발송에 실패했습니다: ' + (e as Error).message);
    }

    // Upsert profile with correct status
    if (authData.user) {
      await supabase.from('user_profiles').upsert({
        id: authData.user.id,
        email: inviteEmail.trim().toLowerCase(),
        name: inviteName.trim() || null,
        role: inviteRole,
        is_first_login: true,
        status: emailSent ? 'invited' : 'invite_failed',
        created_by: currentUser?.id ?? null,
      });
    }

    setInviteResult({ code: inviteCode, email: inviteEmail.trim().toLowerCase() });
    await fetchUsers();
    setInviteLoading(false);
  };

  const closeInviteDialog = () => {
    setInviteOpen(false);
    setInviteResult(null);
  };

  // ----- Delete -----
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(deleteTarget.id);
      if (error) {
        toast.error('사용자 삭제 실패: ' + error.message);
        setDeleteLoading(false);
        setDeleteTarget(null);
        return;
      }
    } else {
      // Fallback: delete only profile row (auth user remains)
      const { error } = await supabase.from('user_profiles').delete().eq('id', deleteTarget.id);
      if (error) {
        toast.error('사용자 삭제 실패: ' + error.message);
        setDeleteLoading(false);
        setDeleteTarget(null);
        return;
      }
    }

    toast.success('사용자가 삭제되었습니다.');
    await fetchUsers();
    setDeleteLoading(false);
    setDeleteTarget(null);
  };

  // ----- Resend Invite Email -----
  const handleResendInvite = async () => {
    if (!resendTarget || !supabaseAdmin) return;
    setResendLoading(true);

    const newCode = generateCode();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(resendTarget.id, {
      password: newCode,
    });

    if (error) {
      toast.error('비밀번호 재발급 실패: ' + error.message);
      setResendLoading(false);
      setResendTarget(null);
      return;
    }

    try {
      await sendInviteEmail({
        to: resendTarget.email,
        name: resendTarget.name ?? '',
        inviteCode: newCode,
        role: resendTarget.role,
        invitedBy: currentUser?.email ?? '관리자',
      });
      await supabase.from('user_profiles').update({ status: 'invited' }).eq('id', resendTarget.id);
      toast.success(`초대 메일을 ${resendTarget.email}로 재발송했습니다.`);
    } catch (e) {
      toast.warning(`비밀번호는 재발급됐지만 메일 발송 실패: ${(e as Error).message}`);
    }

    setResendLoading(false);
    setResendTarget(null);
  };

  // ----- Toggle Active/Inactive -----
  const handleToggleActive = async (user: UserProfileRow) => {
    const newStatus: UserStatus = user.status === 'inactive' ? 'active' : 'inactive';
    const { error } = await supabase
      .from('user_profiles')
      .update({ status: newStatus })
      .eq('id', user.id);

    if (error) {
      toast.error('상태 변경 실패: ' + error.message);
      return;
    }
    toast.success(newStatus === 'inactive' ? `${user.email} 계정을 비활성화했습니다.` : `${user.email} 계정을 활성화했습니다.`);
    await fetchUsers();
  };

  // ----- Reset Password -----
  const handleResetPassword = async (user: UserProfileRow) => {
    if (!supabaseAdmin) {
      toast.error('서비스 롤 키가 필요합니다. .env에 VITE_SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요.');
      return;
    }
    setResetTarget(user);
    setResetCode(null);
    setResetOpen(true);
    setResetLoading(true);

    const newCode = generateCode();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newCode,
    });

    if (error) {
      toast.error('비밀번호 초기화 실패: ' + error.message);
      setResetOpen(false);
      setResetLoading(false);
      return;
    }

    // Mark as first login again
    await supabase
      .from('user_profiles')
      .update({ is_first_login: true })
      .eq('id', user.id);

    // Send reset email
    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name ?? '',
        tempPassword: newCode,
        resetBy: currentUser?.email ?? '관리자',
      });
      toast.success('임시 비밀번호 이메일이 발송되었습니다.');
    } catch (e) {
      toast.warning('비밀번호는 초기화됐지만 이메일 발송에 실패했습니다: ' + (e as Error).message);
    }

    setResetCode(newCode);
    setResetLoading(false);
    await fetchUsers();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCog className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">사용자 관리</h1>
            <p className="text-sm text-muted-foreground">CRM 사용자를 초대하고 관리합니다.</p>
          </div>
        </div>
        <Button onClick={openInviteDialog} className="gap-2">
          <UserPlus className="h-4 w-4" />
          사용자 초대
        </Button>
      </div>

      {/* Service key warning */}
      {!supabaseAdmin && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">주의:</span> VITE_SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.
          일부 기능(사용자 생성, 비밀번호 초기화, 삭제)이 제한됩니다.
        </div>
      )}

      {/* User table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>가입일</TableHead>
              <TableHead>최근 로그인</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingUsers ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  사용자가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_CLASSES[user.role]}`}
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[user.status ?? 'invited']}`}>
                      {STATUS_LABELS[user.status ?? 'invited']}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(user.created_at)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {user.last_sign_in_at ? formatDate(user.last_sign_in_at) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {/* 재발송: 초대/실패 상태이거나 status 미존재시 is_first_login 폴백 */}
                      {(user.status === 'invited' || user.status === 'invite_failed' || (!user.status && user.is_first_login)) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          onClick={() => setResendTarget(user)}
                          disabled={!supabaseAdmin}
                          title="초대 메일 재발송 (비밀번호 새로 발급)"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          재발송
                        </Button>
                      )}
                      {/* 비밀번호 초기화: 관리자 계정 제외 */}
                      {user.role !== 'admin' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => handleResetPassword(user)}
                          disabled={!supabaseAdmin}
                          title={!supabaseAdmin ? '서비스 롤 키 필요' : '비밀번호 초기화'}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          초기화
                        </Button>
                      )}
                      {/* 비활성화/활성화·삭제: 관리자 계정 및 본인 제외 */}
                      {user.role !== 'admin' && user.id !== currentUser?.id && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 gap-1.5 text-xs ${user.status === 'inactive' ? 'text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30' : 'text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}
                            onClick={() => handleToggleActive(user)}
                            title={user.status === 'inactive' ? '활성화' : '비활성화'}
                          >
                            {user.status === 'inactive'
                              ? <><CheckCircle className="h-3.5 w-3.5" />활성화</>
                              : <><Ban className="h-3.5 w-3.5" />비활성화</>
                            }
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(user)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            삭제
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ---- Invite Dialog ---- */}
      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) closeInviteDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>사용자 초대</DialogTitle>
            <DialogDescription>
              새 사용자를 초대합니다. 생성된 초대 코드가 초기 비밀번호입니다.
            </DialogDescription>
          </DialogHeader>

          {inviteResult ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">초대가 완료되었습니다!</p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  초대 이메일이 <span className="font-semibold">{inviteResult.email}</span>으로 발송되었습니다.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">첫 로그인 시 비밀번호 변경 화면이 표시됩니다.</p>
              <DialogFooter>
                <Button onClick={closeInviteDialog} className="w-full">닫기</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">이름</Label>
                <Input
                  id="invite-name"
                  placeholder="홍길동"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  disabled={inviteLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-email">이메일 <span className="text-destructive">*</span></Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="name@seamspace.co.kr"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={inviteLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-role">역할</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)} disabled={inviteLoading}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">관리자</SelectItem>
                    <SelectItem value="sub_admin">서브관리자</SelectItem>
                    <SelectItem value="guest">게스트</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                초대 코드가 자동 생성되어 이메일로 발송됩니다.
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={closeInviteDialog} disabled={inviteLoading}>
                  취소
                </Button>
                <Button onClick={handleInvite} disabled={inviteLoading} className="gap-2">
                  {inviteLoading ? '처리 중...' : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      초대 생성
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Reset Password Dialog ---- */}
      <Dialog open={resetOpen} onOpenChange={(open) => { if (!open) { setResetOpen(false); setResetTarget(null); setResetCode(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>비밀번호 초기화</DialogTitle>
            <DialogDescription>
              {resetTarget?.email}의 비밀번호를 초기화합니다.
            </DialogDescription>
          </DialogHeader>

          {resetLoading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">초기화 중...</div>
          ) : resetCode ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">비밀번호가 초기화되었습니다.</p>
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  아래 임시 비밀번호를 사용자에게 전달해 주세요.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">임시 비밀번호</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono tracking-wider border border-border">
                    {resetCode}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => handleCopy(resetCode)}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? '복사됨' : '복사'}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                다음 로그인 시 비밀번호 변경 화면이 표시됩니다.
              </p>

              <DialogFooter>
                <Button
                  onClick={() => { setResetOpen(false); setResetTarget(null); setResetCode(null); }}
                  className="w-full"
                >
                  닫기
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ---- Resend Invite Confirm Dialog ---- */}
      <AlertDialog open={!!resendTarget} onOpenChange={(open) => { if (!open) setResendTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>초대 메일 재발송</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{resendTarget?.email}</span>로 초대 메일을 재발송합니다.<br />
              새 비밀번호가 자동 발급되어 기존 비밀번호는 무효화됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resendLoading}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleResendInvite} disabled={resendLoading}>
              {resendLoading ? '발송 중...' : '재발송'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Delete Confirm Dialog ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{deleteTarget?.email}</span> 사용자를 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? '삭제 중...' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
