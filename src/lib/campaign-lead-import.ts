// 오프라인 리드 명단(전시회 부스 스캔 등) 엑셀 파싱.
// Campaigns.tsx에서 분리한 이유: 순수 함수라 단위 테스트가 가능하고,
// 날짜·전화번호 처리 규칙이 틀리면 성과 측정이 통째로 어긋나기 때문.

import * as XLSX from 'xlsx';
import { normalizePhone } from './phone';

// 엑셀 셀의 날짜/시간을 ISO로. XLSX는 날짜를 serial number로 주기도 한다.
export function excelDateToISO(v: unknown): string | null {
  if (v == null || v === '') return null;

  // 엑셀에 적힌 시각에는 시간대가 없다. 국내 전시회 부스 단말이 찍은 값이므로
  // 한국시간(UTC+9)으로 해석해야 한다. UTC로 그대로 읽으면 9시간이 밀려
  // 방문 날짜가 하루 어긋나고 '리드 이후 발생한 딜' 판정도 흔들린다.
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const fromKstWallClock = (y: number, mo: number, d: number, h: number, mi: number, sec: number) =>
    new Date(Date.UTC(y, mo - 1, d, h, mi, sec) - KST_OFFSET_MS).toISOString();

  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return fromKstWallClock(d.y, d.m, d.d, d.H ?? 0, d.M ?? 0, Math.floor(d.S ?? 0));
  }
  const raw = String(v).trim();
  if (!raw) return null;
  // "2026-08-12 오전 11:30:30" / "2026-08-12 오후 1:05:00" 형태 처리
  const m = raw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, ampm, hh, mi, ss] = m;
    let hour = hh ? Number(hh) : 0;
    if (ampm === '오후' && hour < 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    return fromKstWallClock(Number(y), Number(mo), Number(d), hour, Number(mi ?? 0), Number(ss ?? 0));
  }
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface ParsedLeadRow {
  name: string;
  phone: string;
  phone_normalized: string;
  school_name?: string;
  position?: string;
  email?: string;
  visited_at: string | null;               // 방문시간 → campaign_leads.created_at
  custom_fields: Record<string, string>;   // 장비번호/유선전화/주소 등 원본 보관
}

export interface LeadParseResult {
  rows: ParsedLeadRow[];                   // 등록 가능한 행 (파일 내 핸드폰 중복 제거 완료)
  total: number;                           // 파일 전체 행 수
  noPhone: string[];                       // 핸드폰이 없어 제외된 행의 이름
  dupInFile: string[];                     // 파일 안에서 핸드폰이 겹쳐 제외된 행의 이름
}

// 부스 스캔 명단 엑셀 파싱.
// 헤더 고정: 장비번호 / 방문시간 / 이름 / 소속 / 직위 / 주소 / 우편번호 / 전화번호 / 핸드폰 / 이메일 / 홈페이지
export function parseLeadExcel(file: File): Promise<LeadParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        const rows: ParsedLeadRow[] = [];
        const noPhone: string[] = [];
        const dupInFile: string[] = [];
        const seen = new Set<string>();
        const txt = (v: unknown) => String(v ?? '').trim();

        for (const r of raw) {
          const name  = txt(r['이름']);
          const phone = txt(r['핸드폰']);
          const norm  = normalizePhone(phone);
          if (!norm) { noPhone.push(name || '(이름없음)'); continue; }
          if (seen.has(norm)) { dupInFile.push(name || '(이름없음)'); continue; }
          seen.add(norm);

          // 주소 칸에 '기타'만 적힌 더미값은 버린다 (부스 단말 기본값)
          const addr = txt(r['주소']);
          const custom: Record<string, string> = {};
          const put = (k: string, v: string) => { if (v) custom[k] = v; };
          put('장비번호', txt(r['장비번호']));
          put('유선전화', txt(r['전화번호']));
          put('주소',     addr === '기타' ? '' : addr);
          put('우편번호', txt(r['우편번호']));
          put('홈페이지', txt(r['홈페이지']));

          rows.push({
            name:             name || '(이름없음)',
            phone,
            phone_normalized: norm,
            school_name:      txt(r['소속']) || undefined,
            position:         txt(r['직위']) || undefined,
            email:            txt(r['이메일']) || undefined,
            visited_at:       excelDateToISO(r['방문시간']),
            custom_fields:    custom,
          });
        }
        resolve({ rows, total: raw.length, noPhone, dupInFile });
      } catch {
        reject(new Error('엑셀 파싱 실패 — 헤더가 이름/핸드폰을 포함하는지 확인하세요'));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsArrayBuffer(file);
  });
}
