// LEAD-S7-6 — 해외 파트너 등록 마법사 (순수 로직)
//
// 브리프 K항: 튀르키예가 **중간에 멈춘** 이유는 한 번에 다 입력해야 하는 구조였다.
// 그래서 지켜야 하는 것:
//   ① 단계 이름·순서는 **브리프 그대로** 여섯 개
//   ② **아무 때나 저장**되고 어디까지 했는지 보인다
//   ③ **완료 전에는 발급 권한이 켜지지 않는다**
//   ④ 기존 15곳은 그대로다(onboarding_status NULL = 완료로 본다)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  STEPS, STEP_DEFS, canFinish, emptyDraft, isDraftPartner, isStepDone,
  onboardingBadge, partnerToDraft, progressOf, stepProblems, toPartnerPayload,
  type OnboardingDraft,
} from '../lib/partnerOnboarding';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const MIG = read('supabase/migrations/20261204000000_lead_s7_6_partner_onboarding.sql');
const DRY = read('../audit/dryrun_lead_s7_6_onboarding.sql');

const T = '2026-11-18';

/** 다 채운 초안 */
function full(over: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    ...emptyDraft(T),
    name: 'Eduvision', country: 'TR', locale: 'en', currency: 'USD',
    startsOn: '2026-01-01', endsOn: '2026-12-31',
    settlementMethod: 'wholesale', seats: '100', months: '12', unitPrice: '12',
    adminAcknowledged: true,
    ...over,
  };
}

// ══════════════════════ 단계 정의 ══════════════════════
describe('브리프 K항의 여섯 단계', () => {
  it('순서와 이름이 브리프 그대로', () => {
    expect(STEPS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(STEP_DEFS.map(s => s.key)).toEqual([
      'company', 'contract', 'quantity', 'issuing', 'account', 'review']);
  });

  it('번호가 겹치지 않고 세 언어 이름이 있다', () => {
    expect(new Set(STEP_DEFS.map(s => s.no)).size).toBe(6);
    for (const s of STEP_DEFS) {
      expect(s.ko, String(s.no)).toBeTruthy();
      expect(s.en, String(s.no)).toBeTruthy();
      expect(s.en, String(s.no)).not.toMatch(/[가-힣]/);
    }
  });
});

// ══════════════════════ 비어 있는 곳 ══════════════════════
describe('무엇이 비었는지 **단계별로** 알려 준다', () => {
  it('빈 초안은 1·2·3·5 단계가 걸린다 (4단계는 켜고 끄는 것뿐)', () => {
    const steps = new Set(stepProblems(emptyDraft(T)).map(p => p.step));
    expect([...steps].sort()).toEqual([1, 3, 5]);  // 2단계는 시작일이 오늘로 차 있다
  });

  it('**담당자 이름은 선택** — 모르는 채로 시작할 수 있다', () => {
    expect(stepProblems(full({ contactName: '' })).length).toBe(0);
  });

  it('**계약서 파일도 선택** — 아직 서명 전일 수 있다', () => {
    expect(stepProblems(full({ contractFileId: '' })).length).toBe(0);
  });

  it('회사 이름·국가·언어·통화는 있어야 한다', () => {
    for (const k of ['name', 'country', 'locale', 'currency'] as const) {
      const p = stepProblems(full({ [k]: '' } as never));
      expect(p.some(x => x.step === 1 && x.field === k), k).toBe(true);
    }
  });

  it('종료일이 시작일보다 앞서면 잡는다', () => {
    const p = stepProblems(full({ startsOn: '2026-06-01', endsOn: '2026-01-01' }));
    expect(p.some(x => x.step === 2 && x.field === 'endsOn')).toBe(true);
    // 종료일을 비우면 괜찮다 — 아직 안 정했을 수 있다
    expect(stepProblems(full({ endsOn: '' })).length).toBe(0);
  });

  it('정산 방식에 따라 묻는 것이 다르다', () => {
    expect(stepProblems(full({ settlementMethod: '' }))
      .some(p => p.field === 'settlementMethod')).toBe(true);
    // 도매형은 단가
    expect(stepProblems(full({ unitPrice: '' })).some(p => p.field === 'unitPrice')).toBe(true);
    // 수수료형은 수수료율 (단가는 안 묻는다)
    const c = full({ settlementMethod: 'commission', unitPrice: '', commissionRate: '30' });
    expect(stepProblems(c).length).toBe(0);
    expect(stepProblems({ ...c, commissionRate: '' })
      .some(p => p.field === 'commissionRate')).toBe(true);
  });

  it('인원·개월은 **함께** 적거나 **둘 다** 비운다', () => {
    expect(stepProblems(full({ seats: '', months: '' })).length).toBe(0);
    expect(stepProblems(full({ seats: '100', months: '' }))
      .some(p => p.step === 3)).toBe(true);
    expect(stepProblems(full({ seats: '', months: '12' }))
      .some(p => p.step === 3)).toBe(true);
  });

  it('인원·개월은 1 이상 정수', () => {
    for (const bad of ['0', '-5', '1.5', 'abc', ' ']) {
      expect(stepProblems(full({ seats: bad, months: '12' })).some(p => p.step === 3),
        bad).toBe(true);
    }
  });

  it('계정 안내를 읽었다는 확인을 받는다', () => {
    expect(stepProblems(full({ adminAcknowledged: false }))
      .some(p => p.step === 5)).toBe(true);
  });

  it('다 채우면 아무 문제도 없다', () => {
    expect(stepProblems(full())).toEqual([]);
    expect(canFinish(full())).toBe(true);
    expect(canFinish(emptyDraft(T))).toBe(false);
  });
});

// ══════════════════════ 진행 상태 ══════════════════════
describe('어디까지 했는지', () => {
  it('빈 초안', () => {
    const p = progressOf(emptyDraft(T));
    expect(p.total).toBe(6);
    expect(p.done).toBe(2);          // 2단계(시작일 있음)·4단계(권한)만 통과
    expect(p.firstOpen).toBe(1);     // **처음 비어 있는 곳부터 이어서 쓴다**
    expect(p.percent).toBe(33);
  });

  it('다 채우면 6/6 100%', () => {
    const p = progressOf(full());
    expect(p).toMatchObject({ done: 6, total: 6, percent: 100, firstOpen: 6 });
  });

  it('1단계만 채우면 다음 할 곳은 3단계', () => {
    const d = { ...emptyDraft(T), name: 'X', country: 'IN', locale: 'en', currency: 'USD' };
    expect(progressOf(d).firstOpen).toBe(3);
  });

  it('6단계는 **전부 끝나야** 끝난 것', () => {
    expect(isStepDone(full({ name: '' }), 6)).toBe(false);
    expect(isStepDone(full(), 6)).toBe(true);
  });
});

// ══════════════════════ 저장 모양 ══════════════════════
describe('저장', () => {
  it('**작성 중에는 발급 권한이 켜지지 않는다**', () => {
    const p = toPartnerPayload(full({ canIssueLicenses: true }), false);
    expect(p.can_issue_licenses).toBe(false);
    expect(p.onboarding_status).toBe('draft');
  });

  it('완료해야 켜진다', () => {
    expect(toPartnerPayload(full({ canIssueLicenses: true }), true))
      .toMatchObject({ can_issue_licenses: true, onboarding_status: 'done' });
    // 끈 채로 완료하면 그대로 꺼져 있다
    expect(toPartnerPayload(full({ canIssueLicenses: false }), true).can_issue_licenses)
      .toBe(false);
  });

  it('빈 칸은 빈 문자열이 아니라 NULL 로', () => {
    const p = toPartnerPayload(emptyDraft(T), false);
    expect(p.country).toBeNull();
    expect(p.contact_name).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.name).toBe('');
  });

  it('수수료율은 수수료형일 때만 넣는다', () => {
    expect(toPartnerPayload(full({ commissionRate: '30' }), true).commission_rate).toBeNull();
    expect(toPartnerPayload(
      full({ settlementMethod: 'commission', commissionRate: '30' }), true,
    ).commission_rate).toBe(30);
  });

  it('단계 표시를 함께 저장한다', () => {
    const p = toPartnerPayload(full(), true);
    expect(p.onboarding_steps).toEqual(
      { '1': true, '2': true, '3': true, '4': true, '5': true, '6': true });
  });

  it('**개인정보를 steps 에 넣지 않는다** (참·거짓뿐)', () => {
    const p = toPartnerPayload(full({ contactName: '홍길동' }), false);
    expect(Object.values(p.onboarding_steps).every(v => typeof v === 'boolean')).toBe(true);
    expect(JSON.stringify(p.onboarding_steps)).not.toContain('홍길동');
  });
});

describe('이어서 쓰기', () => {
  it('저장된 행에서 폼을 되살린다', () => {
    const row = {
      name: 'Eduvision', country: 'TR', contact_name: null, locale: 'en',
      currency: 'USD', commission_rate: null, can_issue_licenses: true, notes: '메모',
    };
    const d = partnerToDraft(row, T);
    expect(d).toMatchObject({
      name: 'Eduvision', country: 'TR', contactName: '', locale: 'en',
      currency: 'USD', canIssueLicenses: true, issuingNote: '메모',
    });
  });

  it('NULL 투성이 행도 터지지 않는다', () => {
    const d = partnerToDraft({ name: null, country: null, locale: null }, T);
    expect(d.name).toBe('');
    expect(d.locale).toBe('en');       // 기본값
    expect(d.currency).toBe('USD');
    expect(d.canIssueLicenses).toBe(false);
  });

  it('can_issue_licenses 는 **true 일 때만** 켜진 것', () => {
    for (const v of [null, undefined, 'true', 1, 'yes']) {
      expect(partnerToDraft({ can_issue_licenses: v }, T).canIssueLicenses, String(v)).toBe(false);
    }
  });
});

// ══════════════════════ 기존 파트너 ══════════════════════
describe('**기존 15곳은 그대로다**', () => {
  it('NULL 은 마법사 이전에 들어온 파트너 — 완료로 본다', () => {
    expect(onboardingBadge(null)).toBe('legacy');
    expect(onboardingBadge(undefined)).toBe('legacy');
    expect(isDraftPartner(null)).toBe(false);
  });

  it('draft 만 "작성 중"', () => {
    expect(onboardingBadge('draft')).toBe('draft');
    expect(isDraftPartner('draft')).toBe(true);
    expect(onboardingBadge('done')).toBe('done');
    expect(onboardingBadge('in_progress')).toBe('legacy');  // 모르는 값
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 더하기만', () => {
  it('칸 둘을 더한다 (기본값 없음 = 테이블 재작성 없음)', () => {
    const c = sql(MIG);
    expect(c).toMatch(/add column if not exists onboarding_status text/);
    expect(c).toMatch(/add column if not exists onboarding_steps jsonb/);
    expect(c).not.toMatch(/onboarding_status text (not null|default)/i);
  });

  it('**기존 데이터를 건드리지 않는다**', () => {
    const c = sql(MIG);
    expect(c).not.toMatch(/\bupdate\s+public\.partners/i);
    expect(c).not.toMatch(/\bdelete\b/i);
    expect(c).not.toMatch(/drop column/i);
    expect(c).not.toMatch(/drop table/i);
  });

  it('CHECK 가 NULL 을 허용한다 (기존 15곳)', () => {
    const c = sql(MIG);
    expect(c).toMatch(/check \(onboarding_status is null or onboarding_status in \('draft', 'done'\)\)/);
  });

  it('중간에 멈춘 곳을 찾는 인덱스', () => {
    expect(sql(MIG)).toMatch(/create index if not exists idx_partners_onboarding[\s\S]*where onboarding_status = 'draft'/);
  });

  it('새 정책을 만들지 않는다 (partners 의 기존 정책을 그대로 쓴다)', () => {
    expect(sql(MIG)).not.toMatch(/create policy/i);
    expect(sql(MIG)).not.toMatch(/\bgrant\b/i);
  });
});

describe('드라이런 — 실제 역할 전환', () => {
  it('psql 전용 없이 한 파일', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sql(DRY)).toMatch(/^\s*begin;/m);
    expect(sql(DRY).trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('**파트너와 admin 두 역할로** 바꿔 본다', () => {
    expect((DRY.match(/set local role authenticated/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(DRY).toContain('request.jwt.claims');
  });

  it('요구한 확인이 다 있다', () => {
    for (const probe of ['① onboarding_status', '② 파트너 수',
                         '② onboarding_status 가 NULL 인 곳', '② 발급 권한 수 변화 없음',
                         '③ 모르는 등록 상태', '④ 파트너: partners UPDATE',
                         '⑤ admin: partners UPDATE']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('마이그레이션 본문이 들어 있다', () => {
    expect(DRY).toContain('add column if not exists onboarding_status text');
    expect(DRY).toContain('idx_partners_onboarding');
  });
});

// ══════════════════════ 범위 ══════════════════════
describe('범위를 넘지 않았다', () => {
  const WIZ = read('src/components/partners/PartnerOnboardingWizard.tsx');

  it('**계정을 만들지도, 메일을 보내지도 않는다**', () => {
    expect(WIZ).not.toMatch(/admin-auth|createUser|invite|sendMail|send-email/i);
    expect(WIZ).toContain('계정을 만들지 않고, 메일도 보내지 않습니다');
  });

  it('계약 폼 로직을 **재사용**한다(복제 금지)', () => {
    expect(WIZ).toContain("from '@/lib/partnerContract'");
    expect(WIZ).toContain("from '@/lib/partnerContractForm'");
    // 정산 방식 목록을 다시 적지 않았다
    expect(WIZ).not.toMatch(/'wholesale'\s*,\s*'commission'/);
  });

  it('저장은 **호출부의 기존 경로**로 넘긴다', () => {
    expect(WIZ).toMatch(/save: \(payload[\s\S]{0,120}\) => Promise/);
    expect(WIZ).not.toMatch(/fetch\(|authedFetch\(/);
  });

  it('작성 중에는 권한이 안 켜진다고 화면이 말한다', () => {
    expect(WIZ).toContain('이용권 발급 권한이 켜지지 않습니다');
  });

  it('Partners.tsx 는 **버튼·배지·마법사**만 더했다', () => {
    const P = read('src/pages/Partners.tsx');
    expect(P).toContain('해외 파트너 등록 (마법사)');
    expect(P).toContain('<OnboardingBadgeView');
    expect(P).toContain('<PartnerOnboardingWizard');
    // 기존 저장 경로를 그대로 쓴다
    expect(P).toMatch(/await updatePartner\(wizardFor\.id, payload as never\)/);
    expect(P).toMatch(/await createPartner\(payload as never\)/);
  });

  it('키·개인정보를 담지 않는다', () => {
    for (const f of ['src/lib/partnerOnboarding.ts',
                     'src/components/partners/PartnerOnboardingWizard.tsx']) {
      expect(read(f), f).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_SERVICE/);
    }
  });
});
