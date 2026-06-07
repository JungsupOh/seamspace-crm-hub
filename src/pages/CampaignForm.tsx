// 공개 캠페인 신청 폼 — 로그인 불필요
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { formatPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { notifyCampaignLead } from '@/lib/telegram';
import { normalizePhone } from '@/lib/phone';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

import { issueCampaignCoupon, type CouponSettings } from '@/lib/campaign-coupons';
import { issueTrialLicense, type TrialLicenseSettings, type IssueOutcome } from '@/lib/campaign-trial-license';
import { upsertLeadContact } from '@/lib/luckySeven';
import { DEFAULT_FORM_SETTINGS, type FormSettings } from './Campaigns';

interface Campaign {
  id: string;
  name: string;
  title?: string;
  description?: string;
  image_url?: string;
  slug?: string;
  start_date?: string;
  end_date?: string;
  status: 'active' | 'ended' | 'planned';
  coupon_settings?: CouponSettings | null;
  form_settings?: FormSettings | null;
  trial_license_settings?: TrialLicenseSettings | null;
}

const SOURCE_OPTIONS = ['대면연수', '온라인연수', '전시회(행사)참가', '지인추천', '기타'];

export default function CampaignForm() {
  const { slug } = useParams<{ slug: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [issuedCouponCode, setIssuedCouponCode] = useState<string | null>(null);
  const [issuedTrialCode, setIssuedTrialCode] = useState<string | null>(null);
  const [trialOutcome, setTrialOutcome] = useState<IssueOutcome | null>(null);
  const [priorCampaignName, setPriorCampaignName] = useState<string | null>(null);
  const [priorIssuedAt, setPriorIssuedAt] = useState<string | null>(null);

  // 폼 필드
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [position, setPosition] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [sourceEtc, setSourceEtc] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  // 동적 필드 — usage_plan + 자유 질문 답변
  const [usagePlan, setUsagePlan] = useState('');
  const [customAnswers, setCustomAnswers] = useState<string[]>([]);

  // form_settings 결정 — 캠페인이 명시적 설정 없으면 기본값
  const formCfg: Required<FormSettings> = {
    locale:     campaign?.form_settings?.locale     ?? DEFAULT_FORM_SETTINGS.locale,
    school:     campaign?.form_settings?.school     ?? DEFAULT_FORM_SETTINGS.school,
    role:       campaign?.form_settings?.role       ?? DEFAULT_FORM_SETTINGS.role,
    source:     campaign?.form_settings?.source     ?? DEFAULT_FORM_SETTINGS.source,
    usage_plan: campaign?.form_settings?.usage_plan ?? DEFAULT_FORM_SETTINGS.usage_plan,
    custom_questions: campaign?.form_settings?.custom_questions ?? [],
  };
  const lang = formCfg.locale ?? 'ko';
  const isJP = lang === 'ja';
  const isEN = lang === 'en';
  const isIntl = isJP || isEN;  // 해외 캠페인 공통 동작 (이메일·자유입력·NEIS 미사용·출처 숨김·contact@)
  // 다국어 문자열 헬퍼 (i18n 라이브러리 도입 없이 인라인). en 미지정 시 ko로 폴백.
  const t = (ko: string, ja: string, en?: string) => (isEN ? (en ?? ko) : isJP ? ja : ko);
  // 저장된 라벨이 캠페인 언어와 다른 스크립트면 해당 언어 default로 폴백 (legacy 데이터 방어)
  const HANGUL_RE = /[가-힯]/;
  const CJK_RE = /[぀-ヿ一-鿿]/;
  const localeLabel = (saved: string | undefined, defaults: { ko: string; ja: string; en: string }): string => {
    const s = (saved ?? '').trim();
    if (!s) return defaults[lang];
    // 해외 캠페인인데 저장값이 한국어면 해당 언어 default로 치환
    if (isIntl && HANGUL_RE.test(s)) return defaults[lang];
    // 한국어 캠페인인데 저장값이 일본어/한자면 한국어 default로 치환
    if (lang === 'ko' && CJK_RE.test(s) && !HANGUL_RE.test(s)) return defaults.ko;
    return s;
  };
  const schoolLabel    = localeLabel(formCfg.school.label,     { ko: '학교명',    ja: '学校名・組織名',        en: 'School / Organization' });
  const roleLabel      = localeLabel(formCfg.role.label,       { ko: '담당 업무',  ja: 'ご担当・役職',          en: 'Role / Position' });
  const usagePlanLabel = localeLabel(formCfg.usage_plan.label, { ko: '활용 방안',  ja: '利用目的・関心領域',     en: 'Intended Use' });

  // 캠페인 로드 시 customAnswers 길이 맞춤
  useEffect(() => {
    if (formCfg.custom_questions.length > 0) {
      setCustomAnswers(prev => {
        const next = [...prev];
        while (next.length < formCfg.custom_questions.length) next.push('');
        return next.slice(0, formCfg.custom_questions.length);
      });
    }
  }, [campaign?.id, formCfg.custom_questions.length]);

  // 1. 캠페인 로드
  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/rest/v1/campaigns?slug=eq.${encodeURIComponent(slug)}&select=*`, { headers: HEADERS })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Campaign[]) => {
        if (rows.length === 0) setNotFound(true);
        else setCampaign(rows[0]);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // 2. 학교 검색 (디바운스)
  const handleSchoolSearch = useCallback((query: string) => {
    setSchoolQuery(query);
    setSchoolInfo(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setSchoolResults([]);
      setShowSchoolDropdown(false);
      return;
    }
    setSchoolSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchSchools(query);
        setSchoolResults(results.slice(0, 20));
        setShowSchoolDropdown(true);
      } catch {
        setSchoolResults([]);
      } finally {
        setSchoolSearching(false);
      }
    }, 300);
  }, []);

  const selectSchool = (s: SchoolInfo) => {
    setSchoolInfo(s);
    setSchoolQuery(s.name);
    setShowSchoolDropdown(false);
  };

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) {
        setShowSchoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 3. 기존 고객 판별: contacts에서 phone_normalized 매칭 + campaign_licenses에서 contact_phone 매칭
  const checkExistingCustomer = async (phoneNorm: string): Promise<boolean> => {
    try {
      const [contactsRes, licsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=contact_type`, { headers: HEADERS }),
        fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?contact_phone=ilike.*${encodeURIComponent(phoneNorm)}*&select=id`, { headers: HEADERS }),
      ]);
      const contacts = contactsRes.ok ? await contactsRes.json() : [];
      const lics = licsRes.ok ? await licsRes.json() : [];
      // 구매고객이거나, 체험권 수령 이력이 있으면 기존 고객
      const isPurchased = Array.isArray(contacts) && contacts.some((c: { contact_type?: string }) => c.contact_type === '구매고객');
      const hasTrialHistory = Array.isArray(lics) && lics.length > 0;
      return isPurchased || hasTrialHistory;
    } catch { return false; }
  };

  // 4. 폼 제출
  const handleSubmit = async () => {
    if (!campaign) return;
    // 항상 필수: 이름/연락처/이메일
    if (!name.trim()) { alert(t('성함을 입력해주세요.', 'お名前を入力してください。', 'Please enter your name.')); return; }
    if (!phone.trim()) { alert(t('연락처를 입력해주세요.', '電話番号を入力してください。', 'Please enter your phone number.')); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      alert(t('이메일을 정확히 입력해주세요.', 'メールアドレスを正しく入力してください。', 'Please enter a valid email address.')); return;
    }
    // 옵션 필드 — 켜져있을 때만 검증
    if (formCfg.school.enabled && !schoolInfo && !schoolQuery.trim()) {
      alert(t(
        `${schoolLabel}을(를) 입력해주세요.`,
        `${schoolLabel} を入力してください。`,
        `Please enter your ${schoolLabel}.`,
      )); return;
    }
    if (formCfg.role.enabled && !position.trim()) {
      alert(t(
        `${roleLabel}을(를) 입력해주세요.`,
        `${roleLabel} を入力してください。`,
        `Please enter your ${roleLabel}.`,
      )); return;
    }
    if (formCfg.source.enabled && !isIntl) {
      if (!source) { alert('소개받으신 경로를 선택해주세요.'); return; }
      if (source === '기타' && !sourceEtc.trim()) { alert('기타 경로를 직접 입력해주세요.'); return; }
    }

    setSubmitting(true);
    try {
      const phoneNorm = normalizePhone(phone, isEN ? 'intl' : isJP ? 'jp' : 'kr');
      const isExisting = await checkExistingCustomer(phoneNorm);

      // custom_fields 정리
      const customFields: Record<string, string> = {};
      if (formCfg.usage_plan.enabled && usagePlan.trim()) customFields.usage_plan = usagePlan.trim();
      formCfg.custom_questions.forEach((q, i) => {
        const v = customAnswers[i]?.trim();
        if (v) customFields[`custom_q${i + 1}`] = v;
      });

      const payload = {
        campaign_id:           campaign.id,
        school_name:           formCfg.school.enabled ? (schoolInfo?.name || schoolQuery.trim()) : null,
        school_code:           null,
        school_kind:           formCfg.school.enabled ? (schoolInfo?.kind || null) : null,
        position:              formCfg.role.enabled ? position.trim() : null,
        name:                  name.trim(),
        phone:                 phone,
        phone_normalized:      phoneNorm,
        email:                 email.trim(),
        source:                formCfg.source.enabled ? source : null,
        source_etc:            formCfg.source.enabled && source === '기타' ? sourceEtc.trim() : null,
        marketing_consent:     marketingConsent,
        status:                '신규',
        is_existing_customer:  isExisting,
        custom_fields:         Object.keys(customFields).length > 0 ? customFields : null,
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads`, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('제출 실패');
      const insertedRows = await res.json().catch(() => []);
      const insertedLead: { id?: string } = Array.isArray(insertedRows) ? insertedRows[0] ?? {} : {};

      // contacts upsert — 캠페인 리드도 contacts에 자동 등록 (메모리 정책)
      // 기존 고객 매칭 시 활동이력에 캠페인 신청 내역 1줄 prepend
      try {
        const today = new Date().toISOString().slice(0, 10);
        const activityNote = `[${today}] 캠페인 신청 — ${campaign.name}`;
        await upsertLeadContact(
          {
            name: payload.name,
            phone: payload.phone,
            email: payload.email ?? '',
            orgName: payload.school_name ?? '',
          },
          {
            country: isEN ? 'intl' : isJP ? 'jp' : 'kr',
            leadSource: campaign.name,  // 캠페인명을 lead_source로
            activityNote,
          },
        );
      } catch (e) {
        console.warn('[CampaignForm] contacts upsert 실패', e);
      }

      // 텔레그램 알림
      notifyCampaignLead({
        campaignName: campaign.name,
        schoolName: payload.school_name,
        name: payload.name,
        phone: payload.phone,
        position: payload.position,
        source: payload.source === '기타' ? `기타 — ${payload.source_etc ?? ''}` : payload.source,
        isExistingCustomer: isExisting,
      });

      // 캠페인 쿠폰 자동 발급 (설정된 경우만)
      if (campaign.coupon_settings?.enabled && insertedLead.id) {
        try {
          const issued = await issueCampaignCoupon({
            campaign,
            lead: {
              id: insertedLead.id,
              phone_normalized: phoneNorm,
              name: payload.name,
              phone: payload.phone,
            },
          });
          if (issued) {
            setIssuedCouponCode(issued.code);
          }
        } catch (e) {
          console.warn('[CampaignForm] 쿠폰 발급 실패', e);
          // 리드 등록 자체는 성공 처리
        }
      }

      // 체험 이용권 자동 발급 (설정 + auto_issue 활성)
      if (campaign.trial_license_settings?.enabled && campaign.trial_license_settings.auto_issue && insertedLead.id) {
        try {
          const result = await issueTrialLicense({
            campaign,
            lead: {
              id: insertedLead.id,
              name: payload.name,
              phone: payload.phone,
              phone_normalized: phoneNorm,
              email: payload.email,
              school_name: payload.school_name,
            },
            locale: lang,
          });
          if (result?.code) {
            setIssuedTrialCode(result.code);
            setTrialOutcome(result.outcome);
            setPriorCampaignName(result.priorCampaignName ?? null);
            setPriorIssuedAt(result.priorIssuedAt ?? null);
          }
        } catch (e) {
          console.warn('[CampaignForm] 체험 이용권 발급 실패', e);
        }
      }

      setSubmitted(true);
    } catch {
      alert(t('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', '送信中にエラーが発生しました。しばらくしてから再度お試しください。', 'An error occurred during submission. Please try again later.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더링 ─────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">{t('캠페인을 찾을 수 없습니다', 'キャンペーンが見つかりません', 'Campaign not found')}</h1>
          <p className="text-sm text-muted-foreground">{t('주소가 올바른지 확인해주세요.', 'URL をご確認ください。', 'Please check that the URL is correct.')}</p>
        </div>
      </div>
    );
  }

  if (campaign.status === 'ended') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          {campaign.image_url && <img src={campaign.image_url} alt="" className="max-w-[200px] mx-auto mb-4 rounded" />}
          <h1 className="text-xl font-semibold mb-2">⏰ {t('종료된 캠페인입니다', '終了したキャンペーンです', 'This campaign has ended')}</h1>
          <p className="text-sm text-muted-foreground mb-1">
            {isEN
              ? `This campaign ended ${campaign.end_date ? `on ${campaign.end_date}` : 'already'}.`
              : isJP
                ? `このキャンペーンは ${campaign.end_date || '既に'} 終了しました。`
                : `이 캠페인은 ${campaign.end_date || '이미'} 종료되었습니다.`}
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            {t('다른 캠페인에 관심이 있으시면 문의 바랍니다.', '他のキャンペーンにご関心がございましたら、お問い合わせください。', 'If you are interested in our other campaigns, please get in touch.')}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    const contactEmail = isIntl ? 'contact@tebahsoft.com' : 'sales@tebahsoft.com';
    const sameCodeNote = t('알림톡으로 동일한 코드가 발송됩니다.', '同じコードがメールでも送信されます。', 'The same code has also been sent to your email.');
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('신청이 완료되었습니다', 'ご登録ありがとうございました', 'Thank you for registering')}</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {t(
              '입력하신 연락처로 이용권이 발송될 예정입니다.',
              'ご入力いただいたメールアドレスにトライアルコードをお送りいたします。',
              'Your trial code will be sent to the email address you provided.',
            )}
            <br />{t('잠시만 기다려주세요!', '少々お待ちください。', 'Please wait a moment!')}
          </p>
          {issuedTrialCode && trialOutcome === 'new' && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg px-4 py-3 mb-3 text-left">
              <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">🎫 {t('체험 이용권이 발급되었습니다', 'トライアルコードを発行しました', 'Your trial code has been issued')}</p>
              <p className="font-mono font-bold text-base text-blue-900 dark:text-blue-100">{issuedTrialCode}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{sameCodeNote}</p>
            </div>
          )}
          {issuedTrialCode && trialOutcome === 'resent' && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg px-4 py-3 mb-3 text-left">
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium mb-1">
                🔁 {t('이전에 발급된 체험권을 재발송했습니다', '以前発行されたトライアルコードを再送いたしました', 'We have re-sent your previously issued trial code')}
              </p>
              <p className="font-mono font-bold text-base text-amber-900 dark:text-amber-100">{issuedTrialCode}</p>
              <p className="text-[11px] text-amber-700 mt-1">
                {priorCampaignName
                  ? t(`이전 캠페인: ${priorCampaignName}`, `以前のキャンペーン: ${priorCampaignName}`, `Previous campaign: ${priorCampaignName}`)
                  : null}
                {priorIssuedAt && <> · {priorIssuedAt.slice(0, 10)}</>}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t(
                  '이미 발급받으신 체험권이 있어 재발송됩니다. 동일 번호로 추가 체험권 발급은 불가능합니다.',
                  '既に発行済みのトライアルコードを再送いたします。同一番号で追加発行はできません。',
                  'You already have a trial code, so it has been re-sent. Additional trial codes cannot be issued for the same contact.',
                )}
              </p>
            </div>
          )}
          {issuedTrialCode && (trialOutcome === 'blocked_used' || trialOutcome === 'blocked_expired') && (
            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 rounded-lg px-4 py-3 mb-3 text-left">
              <p className="text-xs text-rose-700 dark:text-rose-300 font-medium mb-1">
                ⚠ {trialOutcome === 'blocked_used'
                  ? t('이미 체험권을 사용 중이십니다', '既にトライアルをご利用中です', 'You are already using a trial')
                  : t('이미 체험권 만기가 지났습니다', '以前のトライアルは既に期間満了しています', 'Your previous trial has already expired')}
              </p>
              <p className="text-[11px] text-rose-700">
                {priorCampaignName
                  ? t(`이전 발급: ${priorCampaignName}`, `以前の発行: ${priorCampaignName}`, `Previously issued: ${priorCampaignName}`)
                  : null}
                {priorIssuedAt && <> · {priorIssuedAt.slice(0, 10)}</>}
              </p>
              <p className="text-[10px] text-muted-foreground mt-2">
                {t(
                  '체험권은 1인 1회 발급을 원칙으로 합니다. 추가 이용을 원하시면 정식 구매 또는 영업팀에 문의해 주세요.',
                  'トライアルはお一人様 1 回限りとなります。継続利用をご希望の場合は、正式購入または営業担当までお問い合わせください。',
                  'Trials are limited to one per person. For continued use, please purchase a license or contact our sales team.',
                )}
              </p>
            </div>
          )}
          {issuedCouponCode && (
            <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 rounded-lg px-4 py-3 mb-4 text-left">
              <p className="text-xs text-teal-700 dark:text-teal-300 font-medium mb-1">🎁 {t('할인 쿠폰이 발급되었습니다', 'クーポンを発行しました', 'Your discount coupon has been issued')}</p>
              <p className="font-mono font-bold text-base text-teal-900 dark:text-teal-100">{issuedCouponCode}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{sameCodeNote}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('문의', 'お問い合わせ', 'Contact')}: {contactEmail}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        {/* 상단 이미지 — 가장자리 여백 확보 */}
        {campaign.image_url && (
          <div className="bg-muted/10 px-6 pt-6 pb-2">
            <img src={campaign.image_url} alt={campaign.name} className="w-full h-auto rounded-md" />
          </div>
        )}

        {/* 타이틀 + 설명 */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <h1 className="text-xl font-semibold">{campaign.title || campaign.name}</h1>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{campaign.description}</p>
          )}
        </div>

        {/* 폼 */}
        <div className="px-6 py-5 space-y-4">
          {/* 학교/기관명 (옵션) — 해외 캠페인에서는 항상 free_text (NEIS는 한국 전용) */}
          {formCfg.school.enabled && (
            <div ref={schoolRef} className="relative space-y-1.5">
              <Label className="text-xs">{schoolLabel} <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  value={schoolQuery}
                  onChange={e => (isIntl || formCfg.school.mode === 'free_text')
                    ? (setSchoolQuery(e.target.value), setSchoolInfo(null))
                    : handleSchoolSearch(e.target.value)}
                  onFocus={() => {
                    if (!isIntl && formCfg.school.mode !== 'free_text' && schoolResults.length > 0) setShowSchoolDropdown(true);
                  }}
                  placeholder={(isIntl || formCfg.school.mode === 'free_text')
                    ? t(
                        `${schoolLabel}을 입력하세요`,
                        `${schoolLabel}を入力してください`,
                        `Enter your ${schoolLabel}`,
                      )
                    : `${schoolLabel}을 입력하세요 (2자 이상)`}
                  className="h-10 text-sm pr-9"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {!isIntl && formCfg.school.mode !== 'free_text' && (
                    schoolSearching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
              {!isIntl && formCfg.school.mode !== 'free_text' && showSchoolDropdown && schoolResults.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {schoolResults.map((s, i) => (
                    <button key={i} type="button" onClick={() => selectSchool(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.kind} · {s.eduOffice}</div>
                    </button>
                  ))}
                </div>
              )}
              {schoolInfo && (
                <p className="text-xs text-teal-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {schoolInfo.name} ({schoolInfo.kind})
                </p>
              )}
              {!isIntl && formCfg.school.mode === 'mixed' && schoolQuery && !schoolInfo && (
                <p className="text-[10px] text-muted-foreground">
                  검색 결과에 없으면 입력한 그대로 저장됩니다 (대학교/기관 등).
                </p>
              )}
            </div>
          )}

          {/* 직책/전공 (옵션) */}
          {formCfg.role.enabled && (
            <div className="space-y-1.5">
              <Label className="text-xs">{roleLabel} <span className="text-destructive">*</span></Label>
              <Input value={position} onChange={e => setPosition(e.target.value)}
                placeholder={t('예: 담임, 상담교사, 컴퓨터교육과', '例: 担任、教務主任、ICT 担当', 'e.g. Teacher, Counselor, IT Coordinator')} className="h-10 text-sm" />
            </div>
          )}

          {/* 성함 (필수) */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('성함', 'お名前', 'Name')} <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder={t('홍길동', '山田 太郎', 'John Smith')} className="h-10 text-sm" />
          </div>

          {/* 연락처 (필수) */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('연락처', '電話番号', 'Phone')} <span className="text-destructive">*</span>
              <span className="text-muted-foreground ml-1">{t('(알림톡 발송)', '(ご連絡用)', '(for contact)')}</span>
            </Label>
            <Input value={phone}
              onChange={e => setPhone(isIntl ? e.target.value : formatPhone(e.target.value))}
              placeholder={t('010-0000-0000', '090-1234-5678', '+1 555 123 4567')} type="tel" className="h-10 text-sm" />
          </div>

          {/* 이메일 (필수) */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('이메일', 'メールアドレス', 'Email')} <span className="text-destructive">*</span></Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com" type="email" className="h-10 text-sm" />
          </div>

          {/* 활용 방안 (옵션, 서술형) */}
          {formCfg.usage_plan.enabled && (
            <div className="space-y-1.5">
              <Label className="text-xs">{usagePlanLabel}</Label>
              <textarea
                value={usagePlan}
                onChange={e => setUsagePlan(e.target.value)}
                placeholder={t('간단히 입력해주세요', '簡単にご記入ください', 'Please write a brief note')}
                rows={3}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2"
              />
            </div>
          )}

          {/* 자유 질문 (옵션, 1-3개) */}
          {formCfg.custom_questions.map((q, i) => (
            <div key={i} className="space-y-1.5">
              <Label className="text-xs">{q.label}</Label>
              {q.type === 'textarea' ? (
                <textarea
                  value={customAnswers[i] ?? ''}
                  onChange={e => setCustomAnswers(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                  rows={3}
                  className="w-full text-sm rounded-md border border-input bg-background px-3 py-2"
                />
              ) : (
                <Input
                  value={customAnswers[i] ?? ''}
                  onChange={e => setCustomAnswers(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                  className="h-10 text-sm"
                />
              )}
            </div>
          ))}

          {/* 소개받으신 경로 (옵션) — 해외 캠페인은 비활성 (form_settings.source.enabled=false) */}
          {formCfg.source.enabled && !isIntl && (
            <div className="space-y-1.5">
              <Label className="text-xs">소개받으신 경로 <span className="text-destructive">*</span></Label>
              <div className="space-y-2">
                {SOURCE_OPTIONS.map(opt => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="source" value={opt} checked={source === opt}
                      onChange={() => setSource(opt)} className="accent-primary" />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
              {source === '기타' && (
                <Input value={sourceEtc} onChange={e => setSourceEtc(e.target.value)}
                  placeholder="경로를 직접 입력해주세요" className="h-9 text-sm mt-2" />
              )}
            </div>
          )}

          {/* 마케팅 동의 */}
          <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border">
            <input type="checkbox" checked={marketingConsent}
              onChange={e => setMarketingConsent(e.target.checked)}
              className="mt-0.5 accent-primary" />
            <span className="text-xs text-muted-foreground">
              {t(
                '마케팅 정보 수신에 동의합니다. 신제품·이벤트·할인 안내 메시지를 받아보실 수 있습니다. (선택)',
                'マーケティング情報の受信に同意します。新製品・イベント・割引のご案内メッセージをお送りすることがございます。(任意)',
                'I agree to receive marketing information. You may receive messages about new products, events, and discounts. (optional)',
              )}
            </span>
          </label>

          {/* 제출 */}
          <Button className="w-full h-11" disabled={submitting} onClick={handleSubmit}>
            {submitting
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('제출 중...', '送信中...', 'Submitting...')}</>
              : t('신청하기', '送信', 'Submit')}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            {t(
              '입력하신 정보는 체험권 발송과 안내 목적으로만 사용됩니다.',
              'ご入力いただいた情報は、トライアルコードの発行とご案内の目的にのみ使用いたします。',
              'The information you provide is used only to send your trial code and related guidance.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
