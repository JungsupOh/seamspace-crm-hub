// 어드민 — APK 관리 메인 페이지
// 왼쪽 탭: 버전 목록 / 메일링 리스트
// 버전 클릭 시 우측 패널에 발송·다운로드 이력 표시

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone, Upload, Plus, Loader2, Send, Trash2, CheckCircle2, AlertCircle, Search, Pause, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  listApkVersions, createApkVersion, deleteApkVersion, uploadApkFile, sha256Hex,
  listApkSubscribers, createSubscriber, updateSubscriberStatus, deleteSubscriber, findSubscriberByEmail,
  listSendHistoryByVersion, listDownloadsByVersion,
  type ApkVersion, type ApkSubscriber, type ApkSendHistory, type ApkDownload, type SubscriberStatus,
} from '@/lib/apk';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { useAuth } from '@/contexts/AuthContext';
import { formatPhone } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function ApkPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'versions' | 'subscribers'>('versions');
  const [selectedVersion, setSelectedVersion] = useState<ApkVersion | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [subAddOpen, setSubAddOpen] = useState(false);
  const [broadcasting, setBroadcasting] = useState<string | null>(null);  // broadcasting version id

  const { data: versions = [] } = useQuery({
    queryKey: ['apk_versions'],
    queryFn: listApkVersions,
  });
  const { data: subscribers = [] } = useQuery({
    queryKey: ['apk_subscribers'],
    queryFn: listApkSubscribers,
  });

  if (!canEdit) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">APK 관리</h1>
        <p className="text-sm text-muted-foreground mt-2">접근 권한이 없습니다.</p>
      </div>
    );
  }

  const activeCount = subscribers.filter(s => s.status === 'active').length;

  const broadcastVersion = async (v: ApkVersion) => {
    if (!confirm(`v${v.version_name}을(를) 활성 구독자 ${activeCount}명에게 일괄 발송할까요?`)) return;
    setBroadcasting(v.id);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/apk-broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({ version_id: v.id }),
      });
      const data = await r.json();
      if (data.ok) {
        toast.success(`발송 완료 — 신규 ${data.sent}건 / 중복 skip ${data.skipped}건 / 실패 ${data.failed}건`);
        qc.invalidateQueries({ queryKey: ['apk_send_history', v.id] });
      } else {
        toast.error(data.message || '발송 실패');
      }
    } catch (e) {
      toast.error(`발송 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBroadcasting(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Smartphone className="h-6 w-6" />
            APK 관리
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            심스페이스 Android 앱 배포 + 메일링 리스트 관리 (MDM sideload용)
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open('/apk/subscribe', '_blank')}>
            공개 신청폼 열기
          </Button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-border">
        <button onClick={() => setTab('versions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'versions' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}>
          버전 목록 ({versions.length})
        </button>
        <button onClick={() => setTab('subscribers')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'subscribers' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}>
          메일링 리스트 ({subscribers.length}, 활성 {activeCount})
        </button>
      </div>

      {tab === 'versions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 버전 목록 */}
          <div className="lg:col-span-1 space-y-2">
            <Button size="sm" className="w-full" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />새 버전 업로드
            </Button>
            {versions.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                등록된 버전이 없습니다.
              </div>
            ) : versions.map(v => (
              <button key={v.id} onClick={() => setSelectedVersion(v)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selectedVersion?.id === v.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">v{v.version_name}</span>
                  {v.is_latest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">최신</span>}
                </div>
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <p>빌드 {v.version_code} · {v.created_at.slice(0, 10)}</p>
                  {v.file_size && <p>{(v.file_size / 1024 / 1024).toFixed(1)} MB</p>}
                </div>
                <Button size="sm" variant="outline" className="w-full mt-2 h-7 text-xs"
                  disabled={broadcasting === v.id}
                  onClick={(e) => { e.stopPropagation(); broadcastVersion(v); }}>
                  {broadcasting === v.id ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />발송 중...</> : <><Send className="h-3 w-3 mr-1" />전체 발송</>}
                </Button>
              </button>
            ))}
          </div>

          {/* 버전 상세 (발송/다운로드 이력) */}
          <div className="lg:col-span-2">
            {selectedVersion ? (
              <VersionDetail version={selectedVersion} onDeleted={() => { setSelectedVersion(null); qc.invalidateQueries({ queryKey: ['apk_versions'] }); }} />
            ) : (
              <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                버전을 선택하면 발송/다운로드 이력을 확인할 수 있습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'subscribers' && (
        <SubscribersTab subscribers={subscribers} onChanged={() => qc.invalidateQueries({ queryKey: ['apk_subscribers'] })}
          onAdd={() => setSubAddOpen(true)} />
      )}

      {uploadOpen && (
        <UploadVersionDialog
          uploaderId={null}
          onClose={() => setUploadOpen(false)}
          onCreated={() => { setUploadOpen(false); qc.invalidateQueries({ queryKey: ['apk_versions'] }); }}
        />
      )}
      {subAddOpen && (
        <AddSubscriberDialog
          createdBy={null}
          onClose={() => setSubAddOpen(false)}
          onCreated={() => { setSubAddOpen(false); qc.invalidateQueries({ queryKey: ['apk_subscribers'] }); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 버전 상세 패널
// ─────────────────────────────────────────────────────
function VersionDetail({ version, onDeleted }: { version: ApkVersion; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: history = [] } = useQuery({
    queryKey: ['apk_send_history', version.id],
    queryFn: () => listSendHistoryByVersion(version.id),
  });
  const { data: downloads = [] } = useQuery({
    queryKey: ['apk_downloads', version.id],
    queryFn: () => listDownloadsByVersion(version.id),
  });
  const { data: subscribers = [] } = useQuery({
    queryKey: ['apk_subscribers'],
    queryFn: listApkSubscribers,
  });
  const subMap = new Map(subscribers.map(s => [s.id, s]));

  const handleDelete = async () => {
    try {
      await deleteApkVersion(version.id);
      toast.success('버전 삭제됨');
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const sizeMB = version.file_size ? (version.file_size / 1024 / 1024).toFixed(1) : '?';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold flex items-center gap-2">
            v{version.version_name} 상세
            {version.is_latest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">최신</span>}
          </h2>
          <Button size="sm" variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />삭제
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <p><span className="text-foreground/80">빌드</span> {version.version_code}</p>
          <p><span className="text-foreground/80">크기</span> {sizeMB} MB</p>
          {version.min_android && <p><span className="text-foreground/80">최소 Android</span> {version.min_android}</p>}
          <p><span className="text-foreground/80">업로드일</span> {version.created_at.slice(0, 10)}</p>
        </div>
        {version.changelog && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">변경 사항</p>
            <pre className="text-xs text-foreground whitespace-pre-wrap font-sans">{version.changelog}</pre>
          </div>
        )}
        {version.sha256 && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">SHA256</p>
            <p className="text-[10px] font-mono break-all text-muted-foreground">{version.sha256}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">발송 이력 ({history.length}건)</p>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">없음</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {history.map(h => {
                const s = subMap.get(h.subscriber_id);
                return (
                  <div key={h.id} className="text-xs border-b border-border last:border-0 pb-1.5">
                    <p className="font-medium">{s?.school_name ?? '(삭제됨)'} <span className="text-muted-foreground">{s?.contact_name ?? ''}</span></p>
                    <p className="text-muted-foreground">{s?.email ?? '-'}</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      {new Date(h.sent_at).toLocaleString('ko-KR')} · {h.email_status === 'sent' ? '✓ 발송' : '✗ 실패'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">다운로드 이력 ({downloads.length}건)</p>
          {downloads.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">없음</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {downloads.map(d => (
                <div key={d.id} className="text-xs border-b border-border last:border-0 pb-1.5">
                  <p className="font-medium font-mono">{d.email}</p>
                  <p className="text-[10px] text-muted-foreground/70">
                    {new Date(d.downloaded_at).toLocaleString('ko-KR')}
                    {d.ip && <> · {d.ip}</>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>버전 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              v{version.version_name}을(를) 삭제합니다. 발송 이력과 다운로드 이력도 함께 삭제됩니다.
              (Storage 파일은 별도 정리 필요)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 메일링 리스트 탭
// ─────────────────────────────────────────────────────
function SubscribersTab({ subscribers, onChanged, onAdd }: {
  subscribers: ApkSubscriber[];
  onChanged: () => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SubscriberStatus>('all');

  const filtered = subscribers.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return s.email.toLowerCase().includes(q) || s.school_name.toLowerCase().includes(q) || s.contact_name.toLowerCase().includes(q);
  });

  const handleToggleStatus = async (s: ApkSubscriber) => {
    const next: SubscriberStatus = s.status === 'active' ? 'paused' : 'active';
    try {
      await updateSubscriberStatus(s.id, next);
      toast.success(`상태 변경: ${next === 'active' ? '활성화' : '일시중지'}`);
      onChanged();
    } catch (e) {
      toast.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = async (s: ApkSubscriber) => {
    if (!confirm(`${s.email} 구독자를 삭제할까요?`)) return;
    try {
      await deleteSubscriber(s.id);
      toast.success('삭제됨');
      onChanged();
    } catch (e) {
      toast.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const statusLabel = (s: SubscriberStatus) => s === 'active' ? '활성' : s === 'paused' ? '일시중지' : '취소됨';
  const statusColor = (s: SubscriberStatus) =>
    s === 'active' ? 'bg-teal-100 text-teal-700' :
    s === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="이메일/학교/담당자 검색" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | SubscriberStatus)}
          className="h-8 text-sm border rounded px-2 bg-background">
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="paused">일시중지</option>
          <option value="unsubscribed">취소됨</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground self-center">{filtered.length}건</span>
        <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4 mr-1" />수동 추가</Button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">이메일</th>
              <th className="px-3 py-2 text-left">학교</th>
              <th className="px-3 py-2 text-left">담당자</th>
              <th className="px-3 py-2 text-left">연락처</th>
              <th className="px-3 py-2 text-left">등록일</th>
              <th className="px-3 py-2 text-right">동작</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">결과가 없습니다.</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColor(s.status)}`}>
                    {statusLabel(s.status)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{s.email}</td>
                <td className="px-3 py-2 text-xs">{s.school_name} {s.school_kind && <span className="text-muted-foreground">({s.school_kind})</span>}</td>
                <td className="px-3 py-2 text-xs">{s.contact_name}</td>
                <td className="px-3 py-2 text-xs font-mono">{s.phone || '-'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{s.created_at.slice(0, 10)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {s.status !== 'unsubscribed' && (
                      <button title={s.status === 'active' ? '일시중지' : '활성화'}
                        onClick={() => handleToggleStatus(s)}
                        className="text-muted-foreground hover:text-foreground p-1">
                        {s.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button title="삭제" onClick={() => handleDelete(s)}
                      className="text-muted-foreground hover:text-destructive p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 업로드 다이얼로그
// ─────────────────────────────────────────────────────
function UploadVersionDialog({ uploaderId, onClose, onCreated }: {
  uploaderId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState<string>('');
  const [changelog, setChangelog] = useState('');
  const [minAndroid, setMinAndroid] = useState('7.0+');
  const [isLatest, setIsLatest] = useState(true);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) { toast.error('APK 파일을 선택해 주세요.'); return; }
    if (!versionName.trim()) { toast.error('버전명을 입력해 주세요.'); return; }
    if (!versionCode.trim() || isNaN(Number(versionCode))) { toast.error('버전 코드(정수)를 입력해 주세요.'); return; }
    setUploading(true);
    try {
      // 1) SHA256 계산
      const hash = await sha256Hex(file);
      // 2) Storage 업로드
      const { path } = await uploadApkFile(versionName.trim(), file);
      // 3) DB INSERT
      await createApkVersion({
        version_name: versionName.trim(),
        version_code: Number(versionCode),
        file_path: path,
        file_size: file.size,
        sha256: hash,
        changelog: changelog.trim() || undefined,
        min_android: minAndroid.trim() || undefined,
        uploaded_by: uploaderId,
        is_latest: isLatest,
      });
      toast.success(`v${versionName} 업로드 완료`);
      onCreated();
    } catch (e) {
      toast.error(`업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>새 APK 버전 업로드</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">APK 파일 *</Label>
            <input type="file" accept=".apk" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
            {file && <p className="text-[11px] text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">버전명 *</Label>
              <Input value={versionName} onChange={e => setVersionName(e.target.value)}
                placeholder="1.2.0" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">버전 코드 *</Label>
              <Input value={versionCode} onChange={e => setVersionCode(e.target.value.replace(/\D/g, ''))}
                placeholder="12" className="h-8 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">최소 Android</Label>
            <Input value={minAndroid} onChange={e => setMinAndroid(e.target.value)}
              placeholder="7.0+" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">변경 사항 (markdown 한 줄당 하나)</Label>
            <textarea value={changelog} onChange={e => setChangelog(e.target.value)}
              placeholder="- 새 기능 추가&#10;- 버그 수정"
              rows={4}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isLatest} onChange={e => setIsLatest(e.target.checked)} className="accent-primary" />
            <span className="text-xs">이 버전을 최신(latest)으로 표시 (기존 latest는 해제됨)</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={uploading} onClick={handleUpload}>
            {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />업로드 중...</> : <><Upload className="h-4 w-4 mr-2" />업로드</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────
// 구독자 수동 추가 다이얼로그
// ─────────────────────────────────────────────────────
function AddSubscriberDialog({ createdBy, onClose, onCreated }: {
  createdBy: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSearch = (q: string) => {
    setSchoolQuery(q);
    setSchoolInfo(null);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setSchoolResults([]); setShowDropdown(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchSchools(q);
        setSchoolResults(r);
        setShowDropdown(r.length > 0);
      } catch { setSchoolResults([]); }
      finally { setSearching(false); }
    }, 300);
  };

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('이메일을 정확히 입력해 주세요.'); return;
    }
    if (!schoolInfo) { toast.error('학교명을 검색 결과에서 선택해 주세요.'); return; }
    if (!contactName.trim()) { toast.error('담당자명을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      // 중복 체크
      const exist = await findSubscriberByEmail(email.trim());
      if (exist) { toast.error(`이미 등록된 이메일입니다 (상태: ${exist.status})`); return; }
      await createSubscriber({
        email: email.trim(),
        school_name: schoolInfo.name,
        school_kind: schoolInfo.kind,
        contact_name: contactName.trim(),
        phone: phone.trim() || null,
        memo: memo.trim() || null,
        created_by: createdBy,
      });
      // 즉시 최신 버전 발송 (apk-subscribe Edge Function 흐름과 동일)
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/apk-subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            email: email.trim(),
            school_name: schoolInfo.name,
            school_kind: schoolInfo.kind,
            contact_name: contactName.trim(),
            phone: phone.trim() || null,
            memo: memo.trim() || null,
            consent: true,
          }),
        });
      } catch (e) { console.warn('즉시 발송 실패', e); }
      toast.success('구독자 등록 + 최신 버전 메일 발송됨');
      onCreated();
    } catch (e) {
      toast.error(`등록 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>구독자 수동 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">이메일 *</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@school.kr" type="email" className="h-8 text-sm" />
          </div>
          <div ref={schoolRef} className="relative space-y-1.5">
            <Label className="text-xs">학교명 * (NEIS 검색)</Label>
            <div className="relative">
              <Input value={schoolQuery} onChange={e => handleSearch(e.target.value)}
                placeholder="학교명 (2자 이상)" className="h-8 text-sm pr-8" />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
            {showDropdown && schoolResults.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                {schoolResults.map((s, i) => (
                  <button key={i} type="button" onClick={() => { setSchoolInfo(s); setSchoolQuery(s.name); setShowDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">{s.kind} · {s.eduOffice}</div>
                  </button>
                ))}
              </div>
            )}
            {schoolInfo && <p className="text-xs text-teal-700">✓ {schoolInfo.name} ({schoolInfo.kind})</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">담당자명 *</Label>
              <Input value={contactName} onChange={e => setContactName(e.target.value)}
                placeholder="홍길동" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">연락처</Label>
              <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="010-0000-0000" className="h-8 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">메모</Label>
            <Input value={memo} onChange={e => setMemo(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={saving} onClick={handleSubmit}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />등록 중...</> : '등록 + 즉시 메일 발송'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
