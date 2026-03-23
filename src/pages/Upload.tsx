import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';
import { Upload as UploadIcon, FileSpreadsheet, ArrowRight, ChevronDown, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

// ── Airtable 테이블 & 필드 정의 ───────────────────
const AIRTABLE_TABLES: Record<string, { label: string; fields: string[] }> = {
  '01_Contacts': {
    label: '연락처 (01_Contacts)',
    fields: ['Name','Email','Phone','phone_normalized','Country','Contact_Type','Role','Lead_Source',
             'Lead_Stage','MQL_Score','MQL_Grade','Champion_Score','Org_Name','Notes','data_source_date',
             'Next_Followup_Date','Preferred_Channel','Preferred_Language','UTM_Source','UTM_Medium','UTM_Campaign'],
  },
  '02_Organizations': {
    label: '기관 (02_Organizations)',
    fields: ['Org_Name','Country','Type','Student_Count','Active_License','Health_Score',
             'Renewal_Date','Contract_Date','NPS_Latest','Website','Address','Notes'],
  },
  '03_Deals': {
    label: '딜 (03_Deals)',
    fields: ['Deal_Name','Deal_Stage','Deal_Type','List_Price','First_Offer_Price',
             'Final_Contract_Value','Discount_Rate','Currency','Contract_Date',
             'Renewal_Date','Expected_Close_Date','Lost_Competitor','Notes'],
  },
  '05_Trial_PQL': {
    label: 'Trial PQL (05_Trial_PQL)',
    fields: ['Coupon_Code','Issued_Date','Expiration_Date','Trial_Activated',
             'Lessons_Created','Students_Invited','Core_Features_Used','Login_Count','Trial_Result','Notes'],
  },
};

const TOKEN   = import.meta.env.VITE_AIRTABLE_TOKEN || '';
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || '';

// ── 유틸 ──────────────────────────────────────────
function autoMatch(fileCol: string, airtableFields: string[]): string {
  const col = fileCol.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const scores: Record<string, number> = {};

  const keywords: Record<string, string[]> = {
    Name:             ['name','성함','이름','담당자'],
    Email:            ['email','이메일','메일'],
    Phone:            ['phone','핸드폰','연락처','전화'],
    Org_Name:         ['org','school','학교','기관','소속'],
    Deal_Name:        ['deal','거래'],
    Contract_Date:    ['계약일','contract'],
    Renewal_Date:     ['갱신','renewal','만료'],
    Notes:            ['note','비고','메모','특이사항'],
    Country:          ['country','국가'],
    Address:          ['address','주소'],
    Student_Count:    ['student','학생','인원'],
    Final_Contract_Value: ['결제','금액','price','amount'],
    data_source_date: ['timestamp','등록일','날짜','date'],
    Lead_Source:      ['source','출처','채널'],
  };

  for (const field of airtableFields) {
    scores[field] = 0;
    const synonyms = keywords[field] || [];
    for (const syn of synonyms) {
      if (col.includes(syn)) scores[field] += 10;
    }
    if (col.includes(field.toLowerCase())) scores[field] += 5;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : '';
}

function excelDateToISO(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  if (typeof val === 'string' && val.match(/\d{4}/)) return val.slice(0, 10);
  return null;
}

// 전화번호 정규화 → 010-XXXX-XXXX (한국) or 원본 유지 (외국)
// 반환: { display: string, country: string | null }
function normalizePhone(raw: unknown): { display: string; country: string | null } {
  if (!raw) return { display: '', country: null };
  const s = String(raw).trim();
  const digits = s.replace(/[^0-9]/g, '');

  // +82 또는 0082 → 한국
  if (s.startsWith('+82') || s.startsWith('0082')) {
    const local = digits.startsWith('82') ? digits.slice(2) : digits.slice(4);
    const d = '0' + local; // 010xxxxxxxx
    const formatted = d.length === 11
      ? `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
      : d.length === 10
        ? `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`
        : d;
    return { display: formatted, country: 'Korea' };
  }

  // 010/011/016/017/018/019 으로 시작 → 한국
  if (/^0(10|11|16|17|18|19)/.test(digits)) {
    const formatted = digits.length === 11
      ? `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`
      : digits.length === 10
        ? `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`
        : digits;
    return { display: formatted, country: 'Korea' };
  }

  // +로 시작하는 외국 번호 → 원본 유지, 국가 미지정
  if (s.startsWith('+')) return { display: s, country: null };

  // 그 외 → 원본 유지
  return { display: s, country: null };
}

// 이름 컬럼에서 소속 + 이름 분리
// 예) "현암중 강선희" → { name: "강선희", org: "현암중" }
//     "이아진, 전곡중학교" → { name: "이아진", org: "전곡중학교" }
const ORG_KEYWORDS = /초등학교|중학교|고등학교|초|중|고|학교|대학교|대학|교육청|교육원|연구원|연구소|센터|학원|재단|기관|유치원|어린이집/;

function splitNameAndOrg(raw: string): { name: string; org: string | null } {
  const s = raw.trim();
  if (!s) return { name: s, org: null };

  // 쉼표 구분: "이아진, 전곡중학교" or "인천청라고,조수진"
  if (s.includes(',')) {
    const parts = s.split(/,\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const [a, b] = parts;
      if (ORG_KEYWORDS.test(a) && !ORG_KEYWORDS.test(b)) return { name: b, org: a };
      if (ORG_KEYWORDS.test(b) && !ORG_KEYWORDS.test(a)) return { name: a, org: b };
      // 기본: 두번째가 이름
      return { name: b, org: a };
    }
  }

  // 공백 구분: "현암중 강선희", "서울행림초등학교 김민수"
  if (s.includes(' ')) {
    const lastSpace = s.lastIndexOf(' ');
    const possibleOrg  = s.slice(0, lastSpace).trim();
    const possibleName = s.slice(lastSpace + 1).trim();
    // 이름은 보통 2~4글자, 기관 키워드 없음
    if (possibleName.length >= 2 && possibleName.length <= 5 && !ORG_KEYWORDS.test(possibleName)) {
      return { name: possibleName, org: possibleOrg };
    }
  }

  return { name: s, org: null };
}

// 중복 레코드 합치기 — dedup key: phone_normalized (없으면 Name 폴백)
// Notes는 날짜순 누적, 나머지 필드는 첫 번째 값 우선 (빈 값은 후속 레코드로 채움)
function deduplicateRecords(records: Record<string, unknown>[]): {
  merged: Record<string, unknown>[];
  duplicatesRemoved: number;
} {
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const rec of records) {
    const phone = String(rec['phone_normalized'] || '').trim();
    const name  = String(rec['Name'] || '').trim().toLowerCase();
    // phone이 있으면 phone, 없으면 name(동명이인 위험 있음)
    const key = phone || name;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  const merged: Record<string, unknown>[] = [];
  let duplicatesRemoved = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    duplicatesRemoved += group.length - 1;

    // 날짜순 정렬
    const sorted = [...group].sort((a, b) => {
      const da = String(a['data_source_date'] || '');
      const db = String(b['data_source_date'] || '');
      return da.localeCompare(db);
    });

    // 기본값: 첫 번째 레코드
    const base: Record<string, unknown> = { ...sorted[0] };

    // 빈 필드는 후속 레코드로 채움
    for (let i = 1; i < sorted.length; i++) {
      for (const [k, v] of Object.entries(sorted[i])) {
        if (k === 'Notes') continue;
        if (!base[k] && v !== undefined && v !== '') base[k] = v;
      }
    }

    // Notes 날짜순 누적 (중복 줄 제거)
    const allNotes = sorted
      .map(r => String(r['Notes'] || '').trim())
      .filter(Boolean);

    // 중복 줄 제거 후 합치기
    const seen = new Set<string>();
    const noteLines: string[] = [];
    for (const note of allNotes) {
      for (const line of note.split('\n')) {
        const l = line.trim();
        if (l && !seen.has(l)) { seen.add(l); noteLines.push(l); }
      }
    }
    if (noteLines.length) base['Notes'] = noteLines.join('\n');

    // data_source_date: 가장 최근 날짜
    const dates = sorted.map(r => String(r['data_source_date'] || '')).filter(Boolean);
    if (dates.length) base['data_source_date'] = dates[dates.length - 1];

    merged.push(base);
  }

  return { merged, duplicatesRemoved };
}

// 날짜 활동 이력 형식으로 Notes 변환
function formatNoteWithDate(note: unknown, date?: string): string {
  if (!note && !date) return '';
  const d = date || new Date().toISOString().split('T')[0];
  const text = String(note || '').trim();
  if (!text) return '';
  return `[${d}] ${text}`;
}

async function uploadBatch(
  tableName: string,
  records: Record<string, unknown>[],
  onError?: (msg: string) => void,
) {
  const results = { success: 0, failed: 0 };
  let firstError = '';
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10).map(fields => ({ fields }));
    try {
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch }),
      });
      if (res.ok) {
        const data = await res.json();
        results.success += data.records.length;
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.error?.message || errData?.error?.type || `HTTP ${res.status}`;
        if (!firstError) firstError = msg;
        results.failed += batch.length;
      }
      await new Promise(r => setTimeout(r, 250)); // rate limit
    } catch (e) {
      results.failed += batch.length;
    }
  }
  if (firstError && onError) onError(firstError);
  return results;
}

// Notes 문자열 두 개 합치기 (날짜순, 중복 제거)
function mergeNoteStrings(a: string, b: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of [...a.split('\n'), ...b.split('\n')]) {
    const l = line.trim();
    if (l && !seen.has(l)) { seen.add(l); lines.push(l); }
  }
  return lines
    .sort((x, y) => {
      const dx = x.match(/^\[(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? '';
      const dy = y.match(/^\[(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? '';
      return dx.localeCompare(dy);
    })
    .join('\n');
}

// Airtable 기존 연락처 phone_normalized 인덱스 조회
async function fetchPhoneIndex(): Promise<Map<string, { id: string; notes: string }>> {
  const index = new Map<string, { id: string; notes: string }>();
  let offset: string | undefined;
  try {
    do {
      const params = new URLSearchParams({ pageSize: '100' });
      params.append('fields[]', 'phone_normalized');
      params.append('fields[]', 'Notes');
      if (offset) params.set('offset', offset);
      const res = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('01_Contacts')}?${params}`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      const data = await res.json();
      for (const rec of data.records ?? []) {
        const phone = String(rec.fields?.phone_normalized || '').trim();
        if (phone) index.set(phone, { id: rec.id, notes: String(rec.fields?.Notes || '') });
      }
      offset = data.offset;
    } while (offset);
  } catch { /* 실패 시 전체 신규 생성으로 fallback */ }
  return index;
}

// Airtable 배치 수정 (PATCH, 최대 10개씩)
async function batchUpdate(records: { id: string; fields: Record<string, unknown> }[]) {
  const results = { success: 0, failed: 0 };
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    try {
      const res = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('01_Contacts')}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: batch }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        results.success += data.records.length;
      } else {
        results.failed += batch.length;
      }
      await new Promise(r => setTimeout(r, 250));
    } catch {
      results.failed += batch.length;
    }
  }
  return results;
}

// ── 리드 프로파일 정의 ────────────────────────────
// 업로드 시 자동으로 설정되는 필드값 묶음
const LEAD_PROFILES: Record<string, {
  label: string;
  description: string;
  emoji: string;
  defaults: Record<string, string>;
}> = {
  advocate: {
    label: '연수강사 (Advocate)',
    description: '연수에서 심스페이스를 소개해주는 강사. 구매 퍼널 외부.',
    emoji: '🎤',
    defaults: { Contact_Type: 'Advocate', Role: 'Training_Instructor', Lead_Source: 'Training' },
  },
  trial_1month: {
    label: '1개월 체험권 신청자',
    description: '직접 사용 목적으로 1개월 체험권을 신청한 교사.',
    emoji: '🧪',
    defaults: { Contact_Type: 'Trial', Role: 'Teacher', Lead_Stage: '1개월체험권', Lead_Source: 'Exhibition' },
  },
  interest: {
    label: '관심표명 리드',
    description: '관심을 표명했지만 아직 체험 전인 잠재 고객.',
    emoji: '💡',
    defaults: { Contact_Type: 'Lead', Role: 'Teacher', Lead_Stage: '관심표명' },
  },
  quote: {
    label: '견적 요청',
    description: '견적을 요청한 교사 / 학교 담당자.',
    emoji: '📋',
    defaults: { Contact_Type: 'Lead', Role: 'Teacher', Lead_Stage: '견적요청' },
  },
  purchased: {
    label: '구매 고객',
    description: '이미 구매 완료한 고객.',
    emoji: '✅',
    defaults: { Contact_Type: 'Customer', Role: 'Teacher', Lead_Stage: '구매' },
  },
  renewed: {
    label: '재구매 고객',
    description: '갱신 또는 추가 구매한 고객.',
    emoji: '🔄',
    defaults: { Contact_Type: 'Customer', Role: 'Teacher', Lead_Stage: '재구매' },
  },
  partner: {
    label: '파트너 / 기관',
    description: '교육청, 리셀러, 협력 기관.',
    emoji: '🤝',
    defaults: { Contact_Type: 'Partner', Lead_Source: 'Partner' },
  },
  manual: {
    label: '직접 설정',
    description: '프로파일 없이 컬럼 매핑만 사용.',
    emoji: '⚙️',
    defaults: {},
  },
};

// ── 메인 컴포넌트 ──────────────────────────────────
type Step = 'upload' | 'map' | 'preview' | 'done';

export default function Upload() {
  const { canEdit } = useAuth();
  const [step, setStep]           = useState<Step>('upload');
  const [fileName, setFileName]   = useState('');
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileData, setFileData]   = useState<unknown[][]>([]);
  const [targetTable, setTargetTable] = useState('01_Contacts');
  const [leadProfile, setLeadProfile] = useState('manual');
  const [mapping, setMapping]     = useState<Record<string, string>>({});
  const [splitNameOrg, setSplitNameOrg] = useState(false);
  const [mergeDuplicates, setMergeDuplicates] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult]       = useState<{ success: number; failed: number; merged?: number; updated?: number } | null>(null);

  // 파일 파싱
  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb   = XLSX.read(data, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

      if (!rows.length) return toast.error('파일이 비어있습니다.');

      const headers = (rows[0] as unknown[]).map(h => String(h || '').trim()).filter(Boolean);
      setFileHeaders(headers);
      setFileData(rows.slice(1) as unknown[][]);
      setFileName(file.name);

      // 자동 매핑
      const fields = AIRTABLE_TABLES[targetTable].fields;
      const autoMap: Record<string, string> = {};
      for (const h of headers) autoMap[h] = autoMatch(h, fields);
      setMapping(autoMap);

      setStep('map');
    };
    reader.readAsArrayBuffer(file);
  }, [targetTable]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // 업로드 실행
  const handleUpload = async () => {
    setUploading(true);
    const dateFields = new Set(['Contract_Date','Renewal_Date','Expected_Close_Date',
                                 'Issued_Date','Expiration_Date','data_source_date','Consent_Date']);
    const numberFields = new Set(['MQL_Score','Champion_Score','Student_Count',
                                   'List_Price','Final_Contract_Value','Discount_Rate',
                                   'Lessons_Created','Students_Invited','Core_Features_Used','Login_Count']);

    // 날짜 기준 컬럼 찾기 (data_source_date 매핑된 컬럼)
    const dateSourceCol = fileHeaders.find(h => mapping[h] === 'data_source_date');

    const records = fileData
      .filter(row => row && row.length > 0)
      .map(row => {
        const fields: Record<string, unknown> = {};

        // 날짜 기준값 (Notes 이력용)
        const rowDateRaw = dateSourceCol ? row[fileHeaders.indexOf(dateSourceCol)] : undefined;
        const rowDate = excelDateToISO(rowDateRaw) || new Date().toISOString().split('T')[0];

        fileHeaders.forEach((h, i) => {
          const airtableField = mapping[h];
          if (!airtableField) return;
          let val = row[i];
          if (val === null || val === undefined || val === '') return;

          // 날짜 변환
          if (dateFields.has(airtableField)) {
            val = excelDateToISO(val) || val;
          }
          // 숫자 변환
          else if (numberFields.has(airtableField)) {
            val = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9.]/g, '')) || undefined;
          }
          // 전화번호 정규화 → Phone + phone_normalized 동시 설정
          else if (airtableField === 'Phone' || airtableField === 'phone_normalized') {
            const { display, country } = normalizePhone(val);
            if (display) {
              fields['Phone'] = display;
              fields['phone_normalized'] = display;
            }
            if (country && !fields['Country']) fields['Country'] = country;
            return;
          }
          // 이름 파싱 (소속+이름 분리 옵션)
          else if (airtableField === 'Name' && splitNameOrg) {
            const { name, org } = splitNameAndOrg(String(val));
            fields['Name'] = name;
            if (org && !fields['Org_Name']) fields['Org_Name'] = org;
            return;
          }
          // Notes → 날짜 이력 형식
          else if (airtableField === 'Notes') {
            val = formatNoteWithDate(val, rowDate);
          }

          if (val !== undefined) fields[airtableField] = val;
        });

        // Country가 없고 Phone이 한국 번호면 Korea 설정
        if (!fields['Country'] && fields['Phone']) {
          const { country } = normalizePhone(fields['Phone']);
          if (country) fields['Country'] = country;
        }

        // 리드 프로파일 defaults 적용 (컬럼 매핑값이 없는 경우에만)
        const profileDefaults = LEAD_PROFILES[leadProfile]?.defaults || {};
        for (const [key, val] of Object.entries(profileDefaults)) {
          if (!fields[key]) fields[key] = val;
        }

        return fields;
      })
      .filter(r => Object.keys(r).length > 0);

    // 해당 테이블에 없는 필드 제거
    const knownFields = new Set(AIRTABLE_TABLES[targetTable]?.fields ?? []);
    let safeRecords = records.map(r =>
      Object.fromEntries(Object.entries(r).filter(([k]) => knownFields.has(k)))
    ).filter(r => Object.keys(r).length > 0);

    // 중복 합치기 (phone_normalized 기준)
    let duplicatesRemoved = 0;
    if (mergeDuplicates && targetTable === '01_Contacts') {
      const deduped = deduplicateRecords(safeRecords);
      safeRecords = deduped.merged;
      duplicatesRemoved = deduped.duplicatesRemoved;
      if (duplicatesRemoved > 0) toast.info(`중복 ${duplicatesRemoved}건 합치기 완료`);
    }

    let errorMsg = '';
    let updated = 0;
    let createRes = { success: 0, failed: 0 };

    if (mergeDuplicates && targetTable === '01_Contacts') {
      // 기존 Airtable 레코드와 phone 기준 비교 → Upsert
      toast.info('기존 연락처 조회 중...');
      const phoneIndex = await fetchPhoneIndex();

      const toCreate: Record<string, unknown>[] = [];
      const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

      for (const rec of safeRecords) {
        const phone = String(rec['phone_normalized'] || '').trim();
        if (phone && phoneIndex.has(phone)) {
          const ex = phoneIndex.get(phone)!;
          const mergedNotes = mergeNoteStrings(ex.notes, String(rec['Notes'] || ''));
          const fields = { ...rec };
          if (mergedNotes) fields['Notes'] = mergedNotes;
          toUpdate.push({ id: ex.id, fields });
        } else {
          toCreate.push(rec);
        }
      }

      updated = toUpdate.length;
      if (toUpdate.length) {
        const upRes = await batchUpdate(toUpdate);
        createRes.success += upRes.success;
        createRes.failed  += upRes.failed;
      }
      if (toCreate.length) {
        const crRes = await uploadBatch(targetTable, toCreate, msg => { errorMsg = msg; });
        createRes.success += crRes.success;
        createRes.failed  += crRes.failed;
      }
    } else {
      createRes = await uploadBatch(targetTable, safeRecords, msg => { errorMsg = msg; });
    }

    if (errorMsg) toast.error(`Airtable 오류: ${errorMsg}`);
    setResult({ ...createRes, merged: duplicatesRemoved, updated });
    setUploading(false);
    setStep('done');
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const previewRows = fileData.slice(0, 5);

  if (!canEdit) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">데이터 업로드 권한이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">데이터 업로드</h1>
        <p className="text-muted-foreground text-sm mt-1">CSV / Excel 파일을 Airtable에 업로드합니다.</p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload','map','preview','done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
              ${step === s ? 'bg-primary text-primary-foreground' :
                ['upload','map','preview','done'].indexOf(step) > i ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {i + 1}
            </div>
            <span className={step === s ? 'font-medium' : 'text-muted-foreground'}>
              {['파일 선택','컬럼 매핑','미리보기','완료'][i]}
            </span>
            {i < 3 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1: 파일 업로드 */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium mb-1 block">업로드할 Airtable 테이블</label>
            <Select value={targetTable} onValueChange={v => { setTargetTable(v); setLeadProfile('manual'); }}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AIRTABLE_TABLES).map(([key, val]) => (
                  <SelectItem key={key} value={key}>{val.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 리드 프로파일 선택 (01_Contacts일 때만) */}
          {targetTable === '01_Contacts' && (
            <div>
              <label className="text-sm font-medium mb-2 block">
                이 데이터는 어떤 리드인가요?
                <span className="text-muted-foreground font-normal ml-1">— 선택하면 Contact_Type, Role, Lead_Stage 자동 설정</span>
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(LEAD_PROFILES).map(([key, profile]) => (
                  <button
                    key={key}
                    onClick={() => setLeadProfile(key)}
                    className={`text-left rounded-lg border p-3 transition-colors hover:border-primary/50
                      ${leadProfile === key
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-card'}`}
                  >
                    <div className="text-lg mb-1">{profile.emoji}</div>
                    <div className="text-sm font-medium leading-tight">{profile.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{profile.description}</div>
                    {key !== 'manual' && Object.keys(profile.defaults).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(profile.defaults).map(([k, v]) => (
                          <span key={k} className="text-[10px] bg-secondary rounded px-1 py-0.5">{v}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">파일을 드래그하거나 클릭해서 선택</p>
            <p className="text-muted-foreground text-sm mt-1">.xlsx, .xls, .csv 지원</p>
            <input
              id="file-input" type="file" className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        </div>
      )}

      {/* STEP 2: 컬럼 매핑 */}
      {step === 'map' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{fileName}</p>
              <p className="text-sm text-muted-foreground">
                컬럼 {fileHeaders.length}개 · 데이터 {fileData.length}행 · 매핑됨 {mappedCount}개
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('upload')}>다시 선택</Button>
              <Button onClick={() => setStep('preview')} disabled={mappedCount === 0}>
                미리보기 <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 스마트 파싱 옵션 */}
          <div className="space-y-2">
            {Object.values(mapping).includes('Name') && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <input
                  id="split-name-org"
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={splitNameOrg}
                  onChange={e => setSplitNameOrg(e.target.checked)}
                />
                <label htmlFor="split-name-org" className="cursor-pointer text-sm">
                  <span className="font-medium">소속 + 이름 자동 분리</span>
                  <span className="text-muted-foreground ml-2">
                    "현암중 강선희" → Name: 강선희 / Org_Name: 현암중
                  </span>
                </label>
              </div>
            )}
            {targetTable === '01_Contacts' && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <input
                  id="merge-duplicates"
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={mergeDuplicates}
                  onChange={e => setMergeDuplicates(e.target.checked)}
                />
                <label htmlFor="merge-duplicates" className="cursor-pointer text-sm">
                  <span className="font-medium">중복 연락처 합치기</span>
                  <span className="text-muted-foreground ml-2">
                    전화번호 기준 — 같은 사람의 Notes를 날짜순으로 누적
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 gap-0 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>파일 컬럼</span>
              <span>Airtable 필드</span>
            </div>
            <div className="divide-y">
              {fileHeaders.map(header => (
                <div key={header} className="grid grid-cols-2 gap-4 px-4 py-2 items-center">
                  <span className="text-sm truncate" title={header}>{header}</span>
                  <Select
                    value={mapping[header] || '__skip__'}
                    onValueChange={val => setMapping(prev => ({ ...prev, [header]: val === '__skip__' ? '' : val }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="건너뜀" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">
                        <span className="text-muted-foreground">건너뜀</span>
                      </SelectItem>
                      {AIRTABLE_TABLES[targetTable].fields.map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: 미리보기 */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">업로드 미리보기</p>
              <p className="text-sm text-muted-foreground">
                총 {fileData.length}행 · 매핑된 컬럼 {mappedCount}개 → <strong>{targetTable}</strong>
                {splitNameOrg && <span className="ml-2 text-primary">· 소속+이름 분리 ON</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('map')}>매핑 수정</Button>
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />업로드 중...</> : <>
                  <UploadIcon className="mr-2 h-4 w-4" />{fileData.length}행 업로드
                </>}
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  {fileHeaders
                    .filter(h => mapping[h])
                    .map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                        <span className="text-muted-foreground">{h}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <Badge variant="secondary" className="text-xs">{mapping[h]}</Badge>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-accent/30">
                    {fileHeaders
                      .filter(h => mapping[h])
                      .map((h, ci) => (
                        <td key={ci} className="px-3 py-2 max-w-[160px] truncate" title={String(row[fileHeaders.indexOf(h)] ?? '')}>
                          {String(row[fileHeaders.indexOf(h)] ?? '')}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">처음 5행만 표시됩니다.</p>
        </div>
      )}

      {/* STEP 4: 완료 */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="border rounded-xl p-8 text-center space-y-4">
            {result.failed === 0 ? (
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            ) : (
              <XCircle className="h-12 w-12 text-yellow-500 mx-auto" />
            )}
            <div>
              <p className="text-xl font-semibold">업로드 완료</p>
              <p className="text-muted-foreground mt-1">
                성공 <strong className="text-green-500">{result.success}건</strong>
                {result.failed > 0 && <> · 실패 <strong className="text-red-500">{result.failed}건</strong></>}
                {(result.updated ?? 0) > 0 && (
                  <> · <strong className="text-blue-500">{result.updated}건 기존 업데이트</strong></>
                )}
                {(result.merged ?? 0) > 0 && (
                  <> · <strong className="text-yellow-600">{result.merged}건 파일 내 중복 합침</strong></>
                )}
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setStep('upload'); setResult(null); setFileName(''); }}>
                새 파일 업로드
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
