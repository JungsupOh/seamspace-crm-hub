// LEAD-S7-7a — 파트너 직접 리드 등록
//
// **이 단계에서 제일 무서운 것은 우리 내부 칸이 파트너에게 나가는 것이다.**
// 그래서 시험의 절반이 "무엇이 나가지 **않는가**" 다.
//
//   ① 허용 목록에 내부 칸이 하나도 없다 (46칸 중 12칸만)
//   ② 응답을 직렬화해도 내부 칸이 없다
//   ③ `partner_viewer` 는 사람 이름·연락처도 못 본다
//   ④ 본문의 partner_id 를 믿지 않는다
//   ⑤ 중복 안내에 **상대를 식별할 말이 없다**
//   ⑥ 보호 기간은 저장하지 않고 계산한다

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  LEAD_FORBIDDEN_FIELDS, LEAD_PUBLIC_FIELDS, LIMITS, PROTECTION_DAYS,
  RATE_LIMIT_PER_MINUTE, alertText, canCreateLead, canSeeDetail, canUseLeads,
  denialMessage, duplicateMessage, findDuplicates, isProtected, listFieldsFor,
  normalizeEmail, normalizeOrg, overRateLimit, pickForRole, pickPublic,
  pickLocale, protectionAnchor, protectionDaysLeft, protectionEndsAt,
  resolvePartnerId, selectClause, toLeadRow, validateLead,
  type Caller, type ExistingLead,
} from '../../supabase/functions/partner-lead/logic';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlOf = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const MIG = read('supabase/migrations/20261205000000_lead_s7_7a_partner_leads.sql');
const DRY = read('../audit/dryrun_lead_s7_7a_partner_leads.sql');
const FN  = read('supabase/functions/partner-lead/index.ts');

const NOW = new Date('2026-11-18T00:00:00Z');
const PA: Caller = { id: 'u-a', role: 'partner_admin', partnerId: 'p1' };
const PM: Caller = { id: 'u-m', role: 'partner_member', partnerId: 'p1' };
const PV: Caller = { id: 'u-v', role: 'partner_viewer', partnerId: 'p1' };
const OUR: Caller = { id: 'u-ops', role: 'admin', partnerId: null };

/** 운영 `campaign_leads` 의 **모든** 칸 (2026-11-18 읽기 전용 조회) */
const ALL_COLUMNS = [
  'id', 'campaign_id', 'school_name', 'school_code', 'school_kind', 'position',
  'name', 'phone', 'phone_normalized', 'email', 'source', 'source_etc',
  'marketing_consent', 'status', 'is_existing_customer', 'converted_contact_id',
  'sent_at', 'created_at', 'ls_group_id', 'ls_payment_group_id', 'ls_role',
  'ls_member_index', 'custom_fields', 'market', 'email_normalized', 'country',
  'segment', 'probability', 'event_name', 'source_type', 'email_quality',
  'email_status', 'notes', 'followup_stage', 'last_contact_at', 'next_action',
  'next_action_due', 'owner', 'close_reason', 'import_batch_id', 'archived_at',
  'segment_detail', 'unsubscribe_token', 'unsubscribed_at', 'lead_type', 'lead_tags',
  // S7-7a 가 더하는 칸
  'partner_id', 'partner_claimed_at', 'contact_owner', 'consent_by', 'consent_at',
];

// ══════════════════ ① 허용 목록 ══════════════════
describe('**허용 목록** — 모르는 칸은 안 나간다', () => {
  it('허용 칸은 12개뿐', () => {
    expect(LEAD_PUBLIC_FIELDS.length).toBe(12);
    expect(new Set(LEAD_PUBLIC_FIELDS).size).toBe(12);
  });

  it('**허용 칸과 금지 칸이 겹치지 않는다**', () => {
    const pub = new Set<string>(LEAD_PUBLIC_FIELDS);
    for (const f of LEAD_FORBIDDEN_FIELDS) {
      expect(pub.has(f), `${f} 가 허용 목록에 있다`).toBe(false);
    }
  });

  it('**운영의 모든 칸이 허용·금지 중 하나로 분류돼 있다** (빠진 칸 = 샐 수 있는 칸)', () => {
    const known = new Set<string>([...LEAD_PUBLIC_FIELDS, ...LEAD_FORBIDDEN_FIELDS]);
    const unclassified = ALL_COLUMNS.filter(c => !known.has(c));
    expect(unclassified, `분류되지 않은 칸: ${unclassified.join(', ')}`).toEqual(['event_name']);
    // event_name 은 캠페인 이름이라 파트너 리드에는 늘 NULL 이다 — 그래도 허용하지 않았다
    expect(new Set<string>(LEAD_PUBLIC_FIELDS).has('event_name')).toBe(false);
  });

  it('**내부 칸은 하나도 허용되지 않았다**', () => {
    const pub = new Set<string>(LEAD_PUBLIC_FIELDS);
    for (const f of ['notes', 'segment', 'segment_detail', 'probability', 'owner',
                     'close_reason', 'next_action', 'followup_stage', 'email_quality',
                     'is_existing_customer', 'converted_contact_id', 'unsubscribe_token',
                     'custom_fields', 'import_batch_id', 'partner_id', 'consent_by']) {
      expect(pub.has(f), f).toBe(false);
    }
  });

  it('select= 문자열이 허용 칸 그대로', () => {
    expect(selectClause().split(',')).toEqual([...LEAD_PUBLIC_FIELDS]);
    expect(selectClause()).not.toMatch(/\*/);
  });

  it('**DB 가 더 줘도 걸러진다** (두 겹째 그물)', () => {
    const row: Record<string, unknown> = { id: 'l1', school_name: 'S' };
    for (const f of LEAD_FORBIDDEN_FIELDS) row[f] = '내부값';
    const out = pickPublic(row);
    expect(JSON.stringify(out)).not.toContain('내부값');
    for (const f of LEAD_FORBIDDEN_FIELDS) expect(f in out, f).toBe(false);
  });

  it('**응답을 직렬화해도 내부 칸 이름이 없다**', () => {
    const row: Record<string, unknown> = {};
    for (const c of ALL_COLUMNS) row[c] = `값-${c}`;
    const body = JSON.stringify({ ok: true, lead: pickForRole(row, 'partner_admin') });
    for (const f of LEAD_FORBIDDEN_FIELDS) {
      expect(body, f).not.toContain(`"${f}"`);
      expect(body, f).not.toContain(`값-${f}`);
    }
  });
});

// ══════════════════ ③ 역할 ══════════════════
describe('역할', () => {
  it('누가 쓸 수 있나', () => {
    for (const r of ['partner_admin', 'partner_member', 'partner_viewer', 'admin', 'sub_admin']) {
      expect(canUseLeads(r), r).toBe(true);
    }
    for (const r of ['guest', '', 'anon']) expect(canUseLeads(r), r).toBe(false);
  });

  it('**보기 전용은 등록도 상세도 못 한다**', () => {
    expect(canCreateLead('partner_viewer')).toBe(false);
    expect(canSeeDetail('partner_viewer')).toBe(false);
    expect(canCreateLead('partner_member')).toBe(true);
    expect(canSeeDetail('partner_member')).toBe(true);
  });

  it('**보기 전용은 목록에서도 사람 이름·연락처를 못 본다**', () => {
    const f = listFieldsFor('partner_viewer');
    for (const forbidden of ['name', 'email', 'phone', 'position', 'contact_owner']) {
      expect(f.includes(forbidden as never), forbidden).toBe(false);
    }
    expect([...f]).toEqual(['id', 'school_name', 'country',
                            'partner_claimed_at', 'last_contact_at']);
  });

  it('viewer 에게 준 행에 연락처가 남지 않는다', () => {
    const row = { id: 'l1', school_name: 'S', name: '홍길동',
                  email: 'a@b.com', phone: '010', country: 'TR' };
    const out = pickForRole(row, 'partner_viewer');
    const s = JSON.stringify(out);
    expect(s).not.toContain('홍길동');
    expect(s).not.toContain('a@b.com');
    expect(s).not.toContain('010');
    expect(out.school_name).toBe('S');
  });

  it('함수가 viewer 상세를 거절한다', () => {
    expect(FN).toContain("if (!canSeeDetail(caller.role)) return deny('VIEWER_NO_DETAIL')");
  });
});

// ══════════════════ ④ partner_id ══════════════════
describe('**partner_id 는 서버가 정한다**', () => {
  it('파트너는 본문을 무시한다', () => {
    expect(resolvePartnerId(PA, 'p-other')).toBe('p1');
    expect(resolvePartnerId(PV, 'p-other')).toBe('p1');
    expect(resolvePartnerId(PM, null)).toBe('p1');
  });

  it('우리만 본문으로 고를 수 있다', () => {
    expect(resolvePartnerId(OUR, 'p-x')).toBe('p-x');
    expect(resolvePartnerId(OUR, null)).toBeNull();
  });

  it('함수가 모든 조회를 partner_id 로 좁힌다', () => {
    expect(FN).toContain("const partnerId = resolvePartnerId(caller, body.partnerId)");
    expect((FN.match(/\.eq\('partner_id', partnerId\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);   // list · detail · 횟수 제한
  });

  it('**남의 리드는 "없다"와 같은 답**', () => {
    expect(FN).toContain("if (!data) return deny('NOT_FOUND', 404)");
    expect(denialMessage('NOT_FOUND', 'ko')).toBe('찾을 수 없습니다.');
  });
});

// ══════════════════ ⑥ 보호 기간 ══════════════════
describe('보호 기간 — 90일, 접촉하면 연장', () => {
  const claimed = '2026-08-01T00:00:00Z';

  it('90일', () => expect(PROTECTION_DAYS).toBe(90));

  it('기준점은 **나중 쪽**(접촉이 있으면 접촉일)', () => {
    expect(protectionAnchor(claimed, null)?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(protectionAnchor(claimed, '2026-11-01T00:00:00Z')?.toISOString())
      .toBe('2026-11-01T00:00:00.000Z');
    // 접촉이 등록보다 앞서면 등록일을 쓴다
    expect(protectionAnchor(claimed, '2026-01-01T00:00:00Z')?.toISOString())
      .toBe('2026-08-01T00:00:00.000Z');
  });

  it('등록만 하고 두면 **풀린다**', () => {
    // 8/1 + 90일 = 10/30 → 11/18 에는 끝났다
    expect(isProtected(claimed, null, NOW)).toBe(false);
    expect(protectionDaysLeft(claimed, null, NOW)).toBe(0);
  });

  it('**접촉하면 지킨다**', () => {
    expect(isProtected(claimed, '2026-11-01T00:00:00Z', NOW)).toBe(true);
    expect(protectionDaysLeft(claimed, '2026-11-01T00:00:00Z', NOW)).toBe(73);
  });

  it('값이 없거나 이상하면 **보호하지 않는다**(기본은 열려 있다)', () => {
    for (const v of [null, undefined, '', '어제', 123, {}]) {
      expect(isProtected(v, null, NOW), String(v)).toBe(false);
      expect(protectionEndsAt(v, null), String(v)).toBeNull();
    }
  });

  it('경계: 끝나는 **그 순간**은 보호가 아니다', () => {
    const end = protectionEndsAt(claimed, null)!;
    expect(isProtected(claimed, null, new Date(end.getTime() - 1))).toBe(true);
    expect(isProtected(claimed, null, end)).toBe(false);
  });
});

// ══════════════════ ⑤ 중복 ══════════════════
describe('중복 — 막지 않고 알린다', () => {
  const rows: ExistingLead[] = [
    { id: 'L1', email_normalized: 'kim@school.edu', school_name: 'Hanoi Int School',
      partner_id: 'p2', partner_claimed_at: '2026-11-01T00:00:00Z' },
    { id: 'L2', email_normalized: 'lee@other.edu', school_name: 'Other',
      partner_id: null, partner_claimed_at: null },
    { id: 'L3', email_normalized: 'mine@school.edu', school_name: 'Mine',
      partner_id: 'p1', partner_claimed_at: '2026-11-10T00:00:00Z' },
  ];

  it('**절대 막지 않는다**', () => {
    const v = findDuplicates({ email: 'kim@school.edu' }, rows, 'p1', NOW);
    expect(v.blocked).toBe(false);
    // 타입에서도 false 로 못 박혀 있다
    expect(findDuplicates({ email: 'x@y.z' }, rows, 'p1', NOW).blocked).toBe(false);
  });

  it('이메일로 잡는다 (대소문자·공백 무시)', () => {
    const v = findDuplicates({ email: '  KIM@School.EDU ' }, rows, 'p1', NOW);
    expect(v.hits.map(h => h.id)).toEqual(['L1']);
    expect(v.hits[0]).toMatchObject({ reason: 'email', ours: false, sameParter: false });
    expect(v.hits[0].protectedNow).toBe(true);
  });

  it('기관명으로도 잡는다 — **놓치는 쪽이 아니라 더 잡는 쪽**', () => {
    const v = findDuplicates({ schoolName: 'The Hanoi International School' }, rows, 'p1', NOW);
    expect(v.hits.map(h => h.id)).toEqual(['L1']);
    expect(v.hits[0].reason).toBe('org');
  });

  it('우리 리드는 ours 로 표시한다 (우리가 우선)', () => {
    const v = findDuplicates({ email: 'lee@other.edu' }, rows, 'p1', NOW);
    expect(v.hits[0]).toMatchObject({ ours: true, sameParter: false });
  });

  it('내 것만 겹치면 "이미 넣으셨다"', () => {
    const v = findDuplicates({ email: 'mine@school.edu' }, rows, 'p1', NOW);
    expect(v.notice).toBe('own');
    expect(duplicateMessage('own', 'ko')).toContain('이미 등록하신');
  });

  it('남의 것이 섞이면 "확인 후 알려 드리겠다"', () => {
    expect(findDuplicates({ email: 'kim@school.edu' }, rows, 'p1', NOW).notice).toBe('other');
  });

  it('**안내에 상대를 식별할 말이 없다**', () => {
    for (const n of ['none', 'own', 'other'] as const) {
      for (const l of ['ko', 'ja', 'en']) {
        const m = duplicateMessage(n, l);
        expect(m, `${n}/${l}`).toBeTruthy();
        // 상대 파트너 이름·이메일·id 가 들어갈 자리가 없다
        expect(m).not.toMatch(/\{|\$\{|p2|L1|@/);
      }
    }
  });

  it('너무 짧은 기관명으로는 기관 매칭을 하지 않는다 (오탐 폭주 방지)', () => {
    const v = findDuplicates({ schoolName: 'A' }, rows, 'p1', NOW);
    expect(v.hits).toEqual([]);
  });

  it('겹치는 것이 없으면 조용하다', () => {
    const v = findDuplicates({ email: 'new@new.edu', schoolName: 'Brand New' },
                             rows, 'p1', NOW);
    expect(v.hits).toEqual([]);
    expect(v.notice).toBe('none');
  });

  it('기관명 다듬기 — 줄임말을 편다', () => {
    expect(normalizeOrg('The Hanoi International School')).toBe('hanoi');
    expect(normalizeOrg('Hanoi Int School')).toBe('hanoi');
    expect(normalizeOrg("St. Mary's Academy")).toBe('saint mary s');
    // 줄임말이 펴지니 둘은 같은 곳으로 본다
    expect(normalizeOrg('Saint Marys Academy')).toBe('saint marys');
    expect(normalizeOrg(null)).toBe('');
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com');
    expect(normalizeEmail(7)).toBe('');
  });
});

// ══════════════════ 알림 ══════════════════
describe('우리에게 가는 알림 — **개인정보 없이**', () => {
  it('건수·파트너 이름·국가뿐', () => {
    const t = alertText({
      partnerName: 'Eduvision', country: 'TR',
      hits: [
        { id: 'L1', reason: 'email', ours: true, sameParter: false, protectedNow: true },
        { id: 'L2', reason: 'org', ours: false, sameParter: false, protectedNow: false },
      ],
    });
    expect(t).toContain('Eduvision');
    expect(t).toContain('TR');
    expect(t).toContain('겹친 건수: 2');
    expect(t).toContain('우리 리드: 1');
    // **리드 id·이메일·이름이 없다**
    expect(t).not.toContain('L1');
    expect(t).not.toContain('@');
  });

  it('알림이 실패해도 등록은 된다', () => {
    expect(FN).toContain('.catch(() => { /* 알림 실패가 등록을 막지 않는다 */ })');
  });
});

// ══════════════════ 입력 검증 ══════════════════
describe('입력', () => {
  const base = { schoolName: 'S', email: 'a@b.com', contactOwner: 'partner' };

  it('기관·이메일은 있어야 한다', () => {
    expect(validateLead({ ...base, schoolName: '  ' }).error).toBe('SCHOOL_REQUIRED');
    expect(validateLead({ ...base, email: '' }).error).toBe('EMAIL_REQUIRED');
    expect(validateLead({ ...base, email: 'nope' }).error).toBe('BAD_EMAIL');
  });

  it('**길면 자르지 않고 거절한다**', () => {
    const long = 'x'.repeat(LIMITS.schoolName + 1);
    expect(validateLead({ ...base, schoolName: long }))
      .toMatchObject({ ok: false, error: 'TOO_LONG', field: 'schoolName' });
    expect(validateLead({ ...base, name: 'y'.repeat(LIMITS.name + 1) }).field).toBe('name');
  });

  it('국가 코드는 두 글자', () => {
    expect(validateLead({ ...base, country: 'KOR' }).error).toBe('BAD_COUNTRY');
    expect(validateLead({ ...base, country: 'tr' })).toMatchObject({ ok: true });
    expect(validateLead({ ...base, country: '' })).toMatchObject({ ok: true });
  });

  it('연락처 주체를 골라야 한다', () => {
    expect(validateLead({ schoolName: 'S', email: 'a@b.com' }).error).toBe('BAD_CONTACT_OWNER');
    expect(validateLead({ ...base, contactOwner: 'somebody' }).error).toBe('BAD_CONTACT_OWNER');
  });

  it('**최종 사용자면 동의 확인이 있어야 한다**', () => {
    expect(validateLead({ ...base, contactOwner: 'end_user' }).error).toBe('CONSENT_REQUIRED');
    expect(validateLead({ ...base, contactOwner: 'end_user', consented: 'yes' }).error)
      .toBe('CONSENT_REQUIRED');   // 문자열은 동의가 아니다
    expect(validateLead({ ...base, contactOwner: 'end_user', consented: true }))
      .toMatchObject({ ok: true });
  });

  it('파트너 대행은 동의가 필요 없다', () => {
    expect(validateLead(base)).toMatchObject({ ok: true });
  });
});

describe('저장할 행', () => {
  const input = validateLead({
    schoolName: ' Hanoi Int ', email: ' KIM@School.EDU ', name: '홍길동',
    contactOwner: 'end_user', consented: true, country: 'vn',
  }).value!;

  it('정규화해서 넣는다', () => {
    const r = toLeadRow(input, PA, 'p1', '2026-11-18T00:00:00Z');
    expect(r.email).toBe('kim@school.edu');
    expect(r.email_normalized).toBe('kim@school.edu');
    expect(r.school_name).toBe('Hanoi Int');
    expect(r.country).toBe('VN');
  });

  it('귀속 셋이 함께 들어간다 (제약이 요구한다)', () => {
    const r = toLeadRow(input, PA, 'p1', '2026-11-18T00:00:00Z');
    expect(r.partner_id).toBe('p1');
    expect(r.partner_claimed_at).toBe('2026-11-18T00:00:00Z');
    expect(r.contact_owner).toBe('end_user');
  });

  it('**누가 동의를 확인했는지** 남는다', () => {
    const r = toLeadRow(input, PA, 'p1', '2026-11-18T00:00:00Z');
    expect(r.consent_by).toBe('u-a');
    expect(r.consent_at).toBe('2026-11-18T00:00:00Z');
  });

  it('**파트너 대행이면 마케팅 발송에서 뺀다**', () => {
    const agent = validateLead({ schoolName: 'S', email: 'a@b.com',
                                 contactOwner: 'partner' }).value!;
    const r = toLeadRow(agent, PA, 'p1', '2026-11-18T00:00:00Z');
    expect(r.marketing_consent).toBe(false);
    expect(r.consent_by).toBeNull();
    expect(r.consent_at).toBeNull();
    // 최종 사용자면 켜진다
    expect(toLeadRow(input, PA, 'p1', 'x').marketing_consent).toBe(true);
  });

  it('**내부 칸을 건드리지 않는다**', () => {
    const r = toLeadRow(input, PA, 'p1', 'x');
    for (const f of ['notes', 'segment', 'probability', 'owner', 'followup_stage',
                     'next_action', 'email_quality', 'is_existing_customer']) {
      expect(f in r, f).toBe(false);
    }
  });
});

describe('분당 횟수 제한', () => {
  it('10건', () => {
    expect(RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(overRateLimit(9)).toBe(false);
    expect(overRateLimit(10)).toBe(true);
    expect(overRateLimit(0)).toBe(false);
  });
  it('함수가 센다', () => {
    expect(FN).toContain('if (overRateLimit(recent ?? 0)) return deny(\'RATE_LIMIT\', 429)');
  });
});

describe('문구 — 세 언어', () => {
  it('거절 문구가 다 있다', () => {
    for (const c of ['NOT_ALLOWED', 'VIEWER_NO_DETAIL', 'PARTNER_REQUIRED',
                     'SCHOOL_REQUIRED', 'BAD_EMAIL', 'BAD_COUNTRY', 'BAD_CONTACT_OWNER',
                     'CONSENT_REQUIRED', 'TOO_LONG', 'RATE_LIMIT', 'NOT_FOUND']) {
      for (const l of ['ko', 'ja', 'en']) {
        const m = denialMessage(c, l);
        expect(m, `${c}/${l}`).toBeTruthy();
        if (l !== 'ko') expect(m, `${c}/${l}`).not.toMatch(/[가-힣]/);
      }
    }
  });
  it('언어 고르기', () => {
    expect(pickLocale('ja')).toBe('ja');
    expect(pickLocale('vi')).toBe('en');
  });
});

// ══════════════════ 마이그레이션 ══════════════════
describe('마이그레이션 — 더하기만, 국내 흐름 불변', () => {
  it('칸 5개를 더한다', () => {
    const c = sqlOf(MIG);
    for (const col of ['partner_id uuid', 'partner_claimed_at timestamptz',
                       'contact_owner text', 'consent_by uuid', 'consent_at timestamptz']) {
      expect(c, col).toContain(`add column if not exists ${col}`);
    }
  });

  it('**last_contact_at 을 새로 만들지 않는다** (이미 있다)', () => {
    expect(sqlOf(MIG)).not.toMatch(/add column[^;]*last_contact_at/);
  });

  it('기존 데이터를 건드리지 않는다', () => {
    const c = sqlOf(MIG);
    expect(c).not.toMatch(/\bupdate\s+public\.campaign_leads/i);
    expect(c).not.toMatch(/delete from|drop table|drop column/i);
  });

  it('**정책을 바꾸지 않는다** — 파트너는 직접 못 읽는다', () => {
    const c = sqlOf(MIG);
    expect(c).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(c).not.toMatch(/\bgrant\b/i);
  });

  it('외래키는 restrict', () => {
    expect(sqlOf(MIG)).toMatch(/references public\.partners\(id\) on delete restrict/);
  });

  it('**반쪽 귀속을 막는다**', () => {
    const c = sqlOf(MIG);
    expect(c).toContain('campaign_leads_partner_claim_check');
    expect(c).toMatch(/partner_id is null and partner_claimed_at is null and contact_owner is null/);
  });

  it('**동의 없는 최종 사용자를 막는다**', () => {
    const c = sqlOf(MIG);
    expect(c).toContain('campaign_leads_consent_check');
    expect(c).toMatch(/contact_owner is distinct from 'end_user'\s*\n\s*or \(consent_by is not null and consent_at is not null\)/);
  });

  it('연락처 주체를 둘로 좁힌다', () => {
    expect(sqlOf(MIG)).toMatch(/check \(contact_owner is null or contact_owner in \('end_user', 'partner'\)\)/);
  });
});

describe('드라이런 — 실제 역할 전환', () => {
  it('psql 전용 없이 한 파일', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sqlOf(DRY).trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('두 역할로 바꿔 본다', () => {
    expect((DRY.match(/set local role authenticated/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(DRY).toContain('request.jwt.claims');
  });

  it('**직접 읽기가 막히는지**를 본다', () => {
    for (const probe of ['② 파트너: campaign_leads 전체', '② 파트너: 자기 리드 직접',
                         '② 파트너: 남의 파트너 리드', '③ 파트너: 직접 INSERT',
                         '③ 파트너: 직접 UPDATE', '④ 반쪽 귀속',
                         '④ 동의 없는 최종 사용자', '④ 파트너 없는 리드(기존 흐름)',
                         '⑤ admin: 전체 리드']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('마이그레이션 본문이 들어 있다', () => {
    expect(DRY).toContain('add column if not exists partner_claimed_at');
    expect(DRY).toContain('campaign_leads_consent_check');
  });
});

// ══════════════════ 범위 ══════════════════
describe('범위', () => {
  it('함수가 **허용 칸만** 고른다 — `select(*)` 가 없다', () => {
    expect(FN).not.toMatch(/\.select\('\*'\)|select=\*/);
    expect((FN.match(/\.select\(selectClause\(\)\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('중복 조회만 다른 칸을 읽는다 — 그 결과는 **파트너에게 안 간다**', () => {
    const dup = FN.slice(FN.indexOf('중복을 **먼저 본다**'));
    expect(dup).toContain("select('id, email_normalized, school_name, partner_id");
    // 응답에는 notice 한 글자와 안내 문구뿐
    // 등록이 성공했을 때 돌려주는 덩어리만 본다(오류 반환이 아니라)
    const ret = dup.slice(dup.indexOf('ok: true,\n        lead:'));
    expect(ret.length).toBeGreaterThan(0);
    expect(ret).toContain('notice: verdict.notice');
    expect(ret).not.toContain('verdict.hits');
    expect(ret).not.toContain('existing');
  });

  it('키·개인정보를 로그에 남기지 않는다', () => {
    for (const m of FN.match(/console\.(log|warn|error)\([^)]*\)/g) ?? []) {
      expect(m, m).not.toMatch(/email|name|phone|password|token/i);
    }
  });

  it('포털 화면(7b)을 만들지 않았다', () => {
    expect(fs.existsSync(path.resolve(process.cwd(),
      'src/components/partner-portal/PortalLeads.tsx'))).toBe(false);
  });

  it('기존 admin 화면을 건드리지 않았다', () => {
    expect(FN).not.toContain('b2b_campaign_leads_admin');
    expect(sqlOf(MIG)).not.toContain('b2b_campaign_leads_admin');
  });
});
