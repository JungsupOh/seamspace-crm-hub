// LEAD-S7-7b — 파트너 포털 "내 리드" 화면
//
//   ① **`campaign_leads` 를 직접 부르는 코드가 없다**
//   ② 화면이 그릴 수 있는 칸이 7a 허용 목록을 넘지 않는다
//   ③ 역할별 표시 규칙
//   ④ 번역 빠짐 없음
//   ⑤ 관리자 쪽 보호 기간 계산이 **서버와 같다**

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  canSubmit, emptyLeadForm, formProblem, hasContact, hasDetailFields,
  leadSummary, protectionTone, type LeadFormInput, type PortalLead,
} from '../lib/partnerPortalLeads';
import { CONTACT_OWNER_MSG, LEAD_MSG } from '../lib/partnerPortalMsg';
import {
  PROTECTION_DAYS, contactOwnerLabel, isPartnerLead, partnerLeadTone,
  protectionAnchor, protectionDaysLeft, protectionEndsAt, protectionLabel,
  partnerNameOf,
} from '../lib/leadPartner';
import { LEAD_PUBLIC_FIELDS } from '../../supabase/functions/partner-lead/logic';
import * as srv from '../../supabase/functions/partner-lead/logic';
import type { Msg } from '../lib/partner-i18n';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
/** 주석을 뺀 **코드만** 본다 — 설명에 쓴 이름이 시험을 깨뜨리면 안 된다 */
const codeOnly = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const API = codeOnly(read('src/lib/partnerPortalLeads.ts'));
const UI  = codeOnly(read('src/components/partner-portal/PortalLeads.tsx'));
const PORTAL = read('src/pages/PartnerPortal.tsx');
const LEADS_PAGE = read('src/pages/Leads.tsx');

const NOW = new Date('2026-11-18T00:00:00Z');

// ══════════════════ ① 서버 호출 경로 ══════════════════
describe('**서버 호출은 `partner-lead` 함수뿐**', () => {
  it('`campaign_leads` 를 직접 부르지 않는다', () => {
    for (const [name, src] of [['api', API], ['ui', UI]] as const) {
      expect(src, name).not.toContain('campaign_leads');
      expect(src, name).not.toMatch(/rest\/v1/);
    }
  });

  it('함수 주소 하나만 쓴다', () => {
    expect(API).toContain('/functions/v1/partner-lead');
    expect((API.match(/functions\/v1\//g) ?? []).length).toBe(1);
  });

  it('화면은 fetch 를 직접 하지 않는다 (api 모듈만 쓴다)', () => {
    expect(UI).not.toMatch(/\bfetch\(/);
    expect(UI).toContain("from '@/lib/partnerPortalLeads'");
  });

  it('로그인 토큰을 붙인다', () => {
    expect(API).toContain('supabase.auth.getSession()');
    expect(API).toContain('Authorization: `Bearer ${token}`');
    expect(API).toContain('apikey: SUPABASE_KEY');
    // 세션이 없으면 **조용히 넘어가지 않는다**
    expect(API).toContain("if (!token) throw new Error(");
  });
});

// ══════════════════ ② 허용 칸 ══════════════════
describe('화면이 그릴 수 있는 칸 ⊆ 7a 허용 목록', () => {
  /** `PortalLead` 가 선언한 칸 */
  const declared = (API.match(/^\s{2}(\w+)\??:/gm) ?? [])
    .map(s => s.trim().replace(/\??:$/, ''));

  it('PortalLead 에 7a 가 주지 않는 칸이 없다', () => {
    const allowed = new Set<string>([...LEAD_PUBLIC_FIELDS, 'protection_days_left']);
    const iface = API.slice(API.indexOf('export interface PortalLead'),
                            API.indexOf('export interface LeadFormInput'));
    const fields = (iface.match(/^\s{2}(\w+)\??:/gm) ?? [])
      .map(s => s.trim().replace(/\??:$/, ''));
    expect(fields.length).toBeGreaterThan(5);
    for (const f of fields) expect(allowed.has(f), `${f} 는 7a 가 주지 않는다`).toBe(true);
  });

  it('**내부 칸 이름이 화면 코드 어디에도 없다**', () => {
    for (const f of srv.LEAD_FORBIDDEN_FIELDS) {
      // partner_id·consent_* 등은 금지 목록에 있지만 **관리자 화면**은 써도 된다.
      // 여기서 보는 것은 **포털** 두 파일뿐이다.
      if (f === 'partner_id' || f === 'status' || f === 'lead_type') continue;
      // 낱말 단위로 본다 — `owner` 가 `contact_owner`(허용 칸) 안에서 잡히면 안 된다
      const re = new RegExp(`\\b${f}\\b`);
      expect(API, `api: ${f}`).not.toMatch(re);
      expect(UI, `ui: ${f}`).not.toMatch(re);
    }
  });

  it('declared 가 비지 않았다 (시험이 헛돌지 않게)', () => {
    expect(declared.length).toBeGreaterThan(5);
  });
});

// ══════════════════ ③ 역할 ══════════════════
describe('역할별 표시', () => {
  it('보기 전용은 등록 버튼 대신 안내를 본다', () => {
    expect(UI).toContain("const isViewer = role === 'partner_viewer'");
    expect(UI).toMatch(/isViewer \? \(\s*\n\s*<span[^>]*>\{T\('viewerNoAdd'\)\}/);
  });

  it('**없는 칸은 그리지 않는다** — 가리개는 서버에 있다', () => {
    expect(UI).toContain('{(lead.name || lead.email || lead.phone || lead.position) && (');
    expect(hasDetailFields({ id: 'x', school_name: 'S' })).toBe(false);
    expect(hasDetailFields({ id: 'x', name: '홍' })).toBe(true);
  });

  it('포털이 역할을 그대로 넘긴다', () => {
    expect(PORTAL).toContain('<PortalLeads');
    expect(PORTAL).toContain('role={userProfile.role}');
  });

  it('**해외 파트너에게만** 보인다 (국내 포털 불변)', () => {
    expect(PORTAL).toMatch(/\{isIntl && userProfile\?\.role && \(/);
  });
});

// ══════════════════ 폼 규칙 ══════════════════
describe('등록 폼 — 보내기 전에 화면에서도 본다', () => {
  const F = (o: Partial<LeadFormInput> = {}): LeadFormInput => ({
    ...emptyLeadForm('TR'),
    schoolName: 'Hanoi Int', email: 'a@b.com', contactOwner: 'partner', ...o,
  });

  it('기관·이메일·연락처 주체가 있어야 한다', () => {
    expect(formProblem(F({ schoolName: ' ' }))).toBe('schoolName');
    expect(formProblem(F({ email: 'nope' }))).toBe('email');
    expect(formProblem(F({ contactOwner: '' }))).toBe('contactOwner');
  });

  it('**최종 사용자면 동의 체크가 필수**', () => {
    expect(formProblem(F({ contactOwner: 'end_user' }))).toBe('consented');
    expect(formProblem(F({ contactOwner: 'end_user', consented: true }))).toBeNull();
  });

  it('파트너 대행은 동의가 필요 없다', () => {
    expect(canSubmit(F())).toBe(true);
  });

  it('국가는 두 글자', () => {
    expect(formProblem(F({ country: 'KOR' }))).toBe('country');
    expect(formProblem(F({ country: '' }))).toBeNull();
  });

  it('대행으로 바꾸면 동의 체크가 풀린다 (남아 있으면 거짓 기록이 된다)', () => {
    expect(UI).toContain("contactOwner: 'partner', consented: false");
  });

  it('기본 국가가 채워진다', () => {
    expect(emptyLeadForm('VN').country).toBe('VN');
    expect(emptyLeadForm('').contactOwner).toBe('');
    expect(emptyLeadForm('').consented).toBe(false);
  });

  it('**화면 검사는 편의일 뿐**이라고 적어 두었다', () => {
    expect(read('src/lib/partnerPortalLeads.ts'))
      .toContain('서버가 다시 판단하므로 이건 **편의**일 뿐이다');
  });
});

// ══════════════════ 보호 기간 표시 ══════════════════
describe('보호 기간 — 서버가 준 숫자를 그대로 쓴다', () => {
  it('화면이 다시 세지 않는다', () => {
    expect(UI).not.toMatch(/90|24 \* 60/);
    expect(UI).toContain('lead.protection_days_left');
  });

  it('색', () => {
    expect(protectionTone(90)).toBe('safe');
    expect(protectionTone(15)).toBe('safe');
    expect(protectionTone(14)).toBe('soon');
    expect(protectionTone(1)).toBe('soon');
    expect(protectionTone(0)).toBe('ended');
    expect(protectionTone(-5)).toBe('ended');
  });

  it('**값이 없으면 끝난 것으로 본다**(없는 보호를 있다고 하지 않는다)', () => {
    for (const v of [undefined, null, 'x', NaN, Infinity]) {
      expect(protectionTone(v), String(v)).toBe('ended');
    }
  });

  it('접촉 기록', () => {
    expect(hasContact({ id: 'x' })).toBe(false);
    expect(hasContact({ id: 'x', last_contact_at: '  ' })).toBe(false);
    expect(hasContact({ id: 'x', last_contact_at: '2026-11-01' })).toBe(true);
  });

  it('요약', () => {
    const leads: PortalLead[] = [
      { id: '1', protection_days_left: 80, last_contact_at: '2026-11-01' },
      { id: '2', protection_days_left: 5 },
      { id: '3', protection_days_left: 0 },
    ];
    expect(leadSummary(leads)).toEqual(
      { total: 3, protectedNow: 2, ending: 1, noContact: 2 });
    expect(leadSummary([])).toEqual(
      { total: 0, protectedNow: 0, ending: 0, noContact: 0 });
  });
});

// ══════════════════ ⑤ 관리자 쪽 ══════════════════
describe('관리자 리드 화면 — **서버와 같은 규칙으로 센다**', () => {
  it('90일로 같다', () => {
    expect(PROTECTION_DAYS).toBe(srv.PROTECTION_DAYS);
  });

  it('같은 입력에 같은 답을 준다', () => {
    const cases: [string | null, string | null][] = [
      ['2026-08-01T00:00:00Z', null],
      ['2026-08-01T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['2026-11-17T00:00:00Z', null],
      [null, null],
      ['쓰레기', '2026-11-10T00:00:00Z'],
    ];
    for (const [c, l] of cases) {
      expect(protectionDaysLeft(c, l, NOW), `${c}/${l}`)
        .toBe(srv.protectionDaysLeft(c, l, NOW));
      expect(protectionEndsAt(c, l)?.toISOString() ?? null, `${c}/${l}`)
        .toBe(srv.protectionEndsAt(c, l)?.toISOString() ?? null);
      expect(protectionAnchor(c, l)?.toISOString() ?? null, `${c}/${l}`)
        .toBe(srv.protectionAnchor(c, l)?.toISOString() ?? null);
    }
  });

  it('파트너 리드 판정', () => {
    expect(isPartnerLead({ partner_id: 'p1' })).toBe(true);
    expect(isPartnerLead({ partner_id: '  ' })).toBe(false);
    expect(isPartnerLead({})).toBe(false);
    expect(isPartnerLead({ partner_id: 123 })).toBe(false);
  });

  it('칩 색과 글', () => {
    const fresh = { partner_claimed_at: '2026-11-17T00:00:00Z' };
    const soon = { partner_claimed_at: '2026-08-25T00:00:00Z' };
    const over = { partner_claimed_at: '2026-01-01T00:00:00Z' };
    expect(partnerLeadTone(fresh, NOW)).toBe('protected');
    expect(partnerLeadTone(soon, NOW)).toBe('ending');
    expect(partnerLeadTone(over, NOW)).toBe('open');
    expect(protectionLabel(fresh, NOW)).toBe('보호 89일');  // 11/17 등록 → 11/18 기준
    expect(protectionLabel(over, NOW)).toBe('보호 끝');
  });

  it('연락처 주체 이름', () => {
    expect(contactOwnerLabel('end_user')).toBe('기관 담당자');
    expect(contactOwnerLabel('partner')).toBe('파트너 대행');
    expect(contactOwnerLabel('모름')).toBeNull();
    expect(contactOwnerLabel(null)).toBeNull();
  });

  it('파트너 이름 찾기', () => {
    expect(partnerNameOf({ partner_id: 'p1' }, { p1: 'Eduvision' })).toBe('Eduvision');
    expect(partnerNameOf({ partner_id: 'p9' }, { p1: 'X' })).toBeNull();
    expect(partnerNameOf({}, {})).toBeNull();
  });

  it('목록이 새 칸을 **요청한다**', () => {
    const api = read('src/lib/leadsApi.ts');
    expect(api).toContain("'partner_id', 'partner_claimed_at', 'contact_owner',");
    // 마이그레이션 순서 경고를 남겼다 (S4 교훈)
    expect(api).toContain('PostgREST 가 400 을 돌려주고');
  });

  it('리드 화면이 칩을 그린다', () => {
    expect(LEADS_PAGE).toContain('{isPartnerLead(l) && (');
    expect(LEADS_PAGE).toContain('파트너 · {protectionLabel(l, new Date())}');
  });

  it('**기존 리드 화면을 칩 하나 말고는 건드리지 않았다**', () => {
    // 파트너 관련으로 더한 것은 import 한 줄 묶음과 칩뿐
    expect((LEADS_PAGE.match(/isPartnerLead/g) ?? []).length).toBe(2);  // import + 사용
    expect(LEADS_PAGE).not.toContain('partner-lead');
  });
});

// ══════════════════ ④ 번역 ══════════════════
describe('문구 — 세 언어', () => {
  it('빠진 말이 없다', () => {
    for (const [k, m] of Object.entries(LEAD_MSG)) {
      const msg = m as Msg;
      expect(msg.ko, `${k}.ko`).toBeTruthy();
      expect(msg.ja, `${k}.ja`).toBeTruthy();
      expect(msg.en, `${k}.en`).toBeTruthy();
      expect(msg.en, `${k}.en`).not.toMatch(/[가-힣]/);
      expect(msg.ja, `${k}.ja`).not.toMatch(/[가-힣]/);
    }
  });

  it('연락처 주체 이름도 세 언어', () => {
    for (const k of ['end_user', 'partner'] as const) {
      for (const l of ['ko', 'ja', 'en'] as const) {
        expect(CONTACT_OWNER_MSG[k][l], `${k}.${l}`).toBeTruthy();
      }
    }
  });

  it('화면이 쓰는 말이 전부 정의돼 있다', () => {
    for (const k of UI.match(/T\('(\w+)'\)/g) ?? []) {
      const key = k.slice(3, -2);
      expect(key in LEAD_MSG, `LEAD_MSG.${key} 가 없다`).toBe(true);
    }
  });

  it('**동의 문구가 무엇에 동의하는지 말한다**', () => {
    expect(LEAD_MSG.consent.en).toContain('consent');
    expect(LEAD_MSG.consent.en).toContain('contact them');
    expect(LEAD_MSG.consentWhy.ko).toContain('누가 언제 확인했는지 기록');
  });

  it('**파트너 대행이면 고객용 메일을 안 보낸다**고 말한다', () => {
    expect(LEAD_MSG.agentNote.en).toContain('will not send customer mailings');
  });
});

// ══════════════════ 범위 ══════════════════
describe('범위', () => {
  it('7a 서버 로직을 고치지 않았다', () => {
    const logic = read('supabase/functions/partner-lead/logic.ts');
    const fn = read('supabase/functions/partner-lead/index.ts');
    // 7b 에서 더한 action 이 없다
    expect(fn).not.toContain("'contact'");
    expect(logic).not.toContain('recordContact');
  });

  it('접촉 기록 단추를 만들지 않았다 — 서버에 그 길이 없다', () => {
    expect(UI).not.toMatch(/action: 'contact'|recordContact/);
    // 대신 "알려 주세요" 로 적어 두었다
    expect(LEAD_MSG.contactAsk.ko).toContain('알려 주세요');
  });

  it('키·개인정보를 코드에 담지 않았다', () => {
    for (const [n, src] of [['api', API], ['ui', UI]] as const) {
      expect(src, n).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_SERVICE/);
    }
  });
});
