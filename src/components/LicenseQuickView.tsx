import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Phone, Building2, Calendar, Users, Ticket, LogIn, CheckCircle2 } from 'lucide-react';

// 만기 임박 라이선스 빠른 보기 — CRM Deal과 매핑되지 않은 직접 발급 라이선스용
// (deal_id='mdiary' 또는 deal 매핑 없는 케이스)

export interface LicenseQuickViewData {
  id:                string;
  deal_id:           string;
  coupon_code:       string;
  group_name?:       string | null;
  org_name?:         string | null;
  edu_office_name?:  string | null;
  contact_name?:     string;
  contact_phone?:    string;
  admin_name?:       string | null;
  admin_phone?:      string | null;
  admin_last_login?: string | null;
  effectiveName?:    string | null;
  effectivePhone?:   string | null;
  phoneSource?:      'admin' | 'deal' | null;
  duration?:         string;
  user_count?:       string;
  member_count?:     number | null;
  service_expire_at?: string | null;
  status?:           string;
  dd?:               number;
  sentStage?:        string;
}

interface Props {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  license:      LicenseQuickViewData | null;
}

export function LicenseQuickView({ open, onOpenChange, license }: Props) {
  if (!license) return null;
  const l = license;

  const loginDays = l.admin_last_login
    ? Math.floor((Date.now() - new Date(l.admin_last_login).getTime()) / 86400_000)
    : null;

  const ddLabel = l.dd != null
    ? (l.dd === 0 ? 'D-day 오늘 만료' : `D-${l.dd}`)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {l.group_name || l.org_name || '이용권 상세'}
            {ddLabel && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                (l.dd ?? 99) <= 1 ? 'bg-red-100 text-red-700'
                : (l.dd ?? 99) <= 3 ? 'bg-orange-100 text-orange-700'
                : (l.dd ?? 99) <= 7 ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600'
              }`}>
                {ddLabel}
              </span>
            )}
            {l.sentStage && (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-teal-100 text-teal-700 text-[10px] font-semibold px-1.5 py-0.5">
                <CheckCircle2 className="h-2.5 w-2.5" />{l.sentStage} 발송됨
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            이용권 상세 정보 — CRM 영업 딜에 매핑되지 않은 직접 발급 라이선스
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 기관 정보 */}
          <Section title="기관">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {l.group_name && <Field label="그룹명" value={l.group_name} />}
              {l.org_name && <Field label="학교/기관" value={l.org_name} />}
              {l.edu_office_name && <Field label="교육청" value={l.edu_office_name} />}
            </div>
          </Section>

          {/* 사용자 (선생님) */}
          {(l.effectiveName || l.effectivePhone) && (
            <Section title="사용자 (선생님)">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {l.effectiveName && <Field label="이름" value={`${l.effectiveName} 선생님`} />}
                {l.effectivePhone && (
                  <Field label="전화">
                    <a href={`tel:${l.effectivePhone}`} className="text-primary hover:underline flex items-center gap-1">
                      <Phone className="h-3 w-3" />{l.effectivePhone}
                    </a>
                  </Field>
                )}
                {l.phoneSource === 'deal' && (
                  <p className="col-span-2 text-[10px] text-amber-600">
                    ⓘ 운영DB에 사용자 정보가 없어 CRM 결제자 연락처를 표시 중
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* 이용권 정보 */}
          <Section title="이용권">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Field label="쿠폰코드" value={l.coupon_code} mono />
              {l.duration && <Field label="기간" value={`${l.duration}개월`} />}
              {l.user_count && <Field label="발급 인원" value={`${l.user_count}명`} />}
              {l.member_count != null && l.member_count > 0 && (
                <Field label="등록 인원">
                  <span className="text-teal-700 font-medium flex items-center gap-1">
                    <Users className="h-3 w-3" />{l.member_count}명
                  </span>
                </Field>
              )}
              {l.service_expire_at && <Field label="만료일" value={l.service_expire_at} />}
              {l.status && <Field label="상태" value={l.status} />}
            </div>
          </Section>

          {/* 사용 활동 */}
          {l.admin_last_login && (
            <Section title="사용 활동">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Field label="최근 접속">
                  <span className={`flex items-center gap-1 ${
                    loginDays === null ? 'text-muted-foreground'
                    : loginDays <= 7 ? 'text-teal-600'
                    : loginDays <= 30 ? 'text-amber-600'
                    : 'text-red-500'
                  }`}>
                    <LogIn className="h-3 w-3" />
                    {loginDays !== null ? `${loginDays}일 전 (${l.admin_last_login.slice(0, 10)})` : '미확인'}
                  </span>
                </Field>
              </div>
            </Section>
          )}

          {/* 출처 안내 */}
          <p className="text-[11px] text-muted-foreground italic">
            <Ticket className="h-3 w-3 inline mr-1" />
            이 라이선스는 캠페인 또는 직접 발급으로 등록된 이용권입니다 (CRM Deal 매핑 없음).
          </p>
        </div>

        <div className="flex justify-end pt-3 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
        <Calendar className="h-3 w-3" />{title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, children, mono }: { label: string; value?: string; children?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {children ?? (
        <p className={`text-sm truncate ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</p>
      )}
    </div>
  );
}
