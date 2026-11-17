// LEAD-S4 순수 로직 — 리드 유형(CRM-015) · 행사별 깔때기(CRM-018)
//
// 지켜야 하는 약속
//   ① 유형별로 다른 것은 **단계 목록과 기본 다음 행동뿐**(브리프 H항).
//   ② `customer` 단계는 **기존 10단계 그대로** — 운영 데이터가 그 값이다.
//   ③ 깔때기의 분모·분자가 한 곳에서만 정해진다. 분모 0 은 '—' 다(0% 가 아니다).
//   ④ 끝난 리드가 깔때기 중간 칸에 남아 전환율을 깎지 않는다.
//   ⑤ 보관된 리드는 깔때기에서 빠진다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  LEAD_TYPES, LEAD_TYPE_HINT, LEAD_TYPE_LABEL, PARTNER_CONVERSION_HINT, TAG_SUGGESTIONS,
  TYPE_CLOSED_STAGES, TYPE_DEFAULT_NEXT_ACTION, TYPE_STAGES, defaultNextAction,
  isReadyForPartnerConversion, isStageForeign, leadTagsOf, leadTypeLabel, stagesFor,
  toLeadType, toggleTag,
} from '../lib/leadType';
import {
  CONVERSION_STEPS, FUNNEL_BASIS, eventNameOf, funnelFor, funnelsByEvent, isUntouched,
  mostCommonType, pct, reachedIndex,
} from '../lib/leadFunnel';
import { FOLLOWUP_STAGES } from '../lib/leadFollowup';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const T = '2026-11-17';

// ══════════════════════ 리드 유형 ══════════════════════
describe('리드 유형 — 브리프 H항', () => {
  it('일곱 가지다', () => {
    expect([...LEAD_TYPES]).toEqual([
      'customer', 'sales', 'research', 'tech', 'investor', 'government', 'media']);
  });

  it('이름과 설명이 모두 있다', () => {
    for (const t of LEAD_TYPES) {
      expect(LEAD_TYPE_LABEL[t], t).toBeTruthy();
      expect(LEAD_TYPE_HINT[t], t).toBeTruthy();
    }
  });

  it('모르는 값은 null 이다 (임의로 끼워 맞추지 않는다)', () => {
    for (const v of ['partner', '', null, 123, 'CUSTOMER']) {
      expect(toLeadType(v), String(v)).toBeNull();
    }
    expect(toLeadType('customer')).toBe('customer');
  });

  it('표시 — 없으면 미분류', () => {
    expect(leadTypeLabel('sales')).toBe('세일즈 파트너');
    expect(leadTypeLabel(null)).toBe('미분류');
    expect(leadTypeLabel(null, '—')).toBe('—');
  });
});

describe('유형별 단계 목록', () => {
  it('**고객 단계는 기존 10단계 그대로다** (운영 데이터가 그 값이다)', () => {
    expect(TYPE_STAGES.customer).toEqual([...FOLLOWUP_STAGES]);
  });

  it('브리프 H항의 세일즈 파트너 순서다', () => {
    expect(TYPE_STAGES.sales.slice(0, 7)).toEqual([
      '발굴', '탐색 대화', '조건 협의', '계약서 검토', '계약', '온보딩', '첫 판매']);
  });

  it('연구·기술 파트너 순서다', () => {
    expect(TYPE_STAGES.research.slice(0, 6)).toEqual([
      '접촉', '관심 확인', '협력 범위', 'MOU·협약', '연구 진행', '성과']);
    expect(TYPE_STAGES.tech.slice(0, 5)).toEqual([
      '접촉', '연동 요구 확인', '기술 검토', '연동 일정', '완료']);
  });

  it('투자·정부·미디어는 **최소 단계**다 (브리프: 단순 접촉 목록)', () => {
    for (const t of ['investor', 'government', 'media'] as const) {
      expect(TYPE_STAGES[t], t).toEqual(['접촉', '논의 중', '종료']);
    }
  });

  it('모든 유형에 종료가 있다 (끝낼 길이 없으면 목록이 쌓인다)', () => {
    for (const t of LEAD_TYPES) expect(TYPE_STAGES[t], t).toContain('종료');
  });

  it('유형이 없으면 고객 목록을 쓴다', () => {
    expect(stagesFor(null)).toEqual(TYPE_STAGES.customer);
    expect(stagesFor('sales')).toEqual(TYPE_STAGES.sales);
  });

  it('끝난 단계 목록이 각 유형의 단계 안에 있다', () => {
    for (const t of LEAD_TYPES) {
      for (const s of TYPE_CLOSED_STAGES[t]) {
        expect(TYPE_STAGES[t], `${t}:${s}`).toContain(s);
      }
    }
  });

  it('유형별 기본 다음 행동이 있다 — **제안일 뿐이다**', () => {
    for (const t of LEAD_TYPES) expect(TYPE_DEFAULT_NEXT_ACTION[t], t).toBeTruthy();
    expect(defaultNextAction('sales')).toBe('지역·조건 확인 대화 요청');
    expect(defaultNextAction(null)).toBeNull();
  });

  it('유형을 바꿔 단계가 안 맞으면 **알려만** 준다 (값을 지우지 않는다)', () => {
    expect(isStageForeign('research', '협상')).toBe(true);      // 고객 단계
    expect(isStageForeign('research', '연구 진행')).toBe(false);
    expect(isStageForeign('customer', '협상')).toBe(false);
    expect(isStageForeign('sales', '')).toBe(false);            // 빈 값은 문제 아님
    expect(isStageForeign('sales', null)).toBe(false);
  });
});

describe('보조 태그', () => {
  it('문자열 배열만 받아들이고 중복을 없앤다', () => {
    expect(leadTagsOf(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(leadTagsOf(['a', 1, null, '', '  b  '])).toEqual(['a', 'b']);
    expect(leadTagsOf('a')).toEqual([]);
    expect(leadTagsOf(null)).toEqual([]);
  });

  it('토글', () => {
    expect(toggleTag([], '고객')).toEqual(['고객']);
    expect(toggleTag(['고객'], '고객')).toEqual([]);
    expect(toggleTag(['고객'], '  ')).toEqual(['고객']);
  });

  it('후보에 유형과 겹치는 것이 있다 (한 사람이 고객이면서 연구 파트너)', () => {
    expect(TAG_SUGGESTIONS).toContain('고객');
    expect(TAG_SUGGESTIONS).toContain('연구 파트너');
  });
});

describe('파트너 전환 — 알려만 준다', () => {
  it('세일즈 파트너가 계약 단계면 알린다', () => {
    for (const s of ['계약', '온보딩', '첫 판매', '정기 관리']) {
      expect(isReadyForPartnerConversion({ lead_type: 'sales', followup_stage: s }), s).toBe(true);
    }
  });

  it('그 전 단계나 다른 유형이면 알리지 않는다', () => {
    expect(isReadyForPartnerConversion({ lead_type: 'sales', followup_stage: '탐색 대화' })).toBe(false);
    expect(isReadyForPartnerConversion({ lead_type: 'customer', followup_stage: '성사' })).toBe(false);
    expect(isReadyForPartnerConversion({})).toBe(false);
  });

  it('**전환 기능은 이 단계에서 만들지 않는다**고 밝힌다', () => {
    expect(PARTNER_CONVERSION_HINT).toContain('파트너 정산 단위에서 만듭니다');
  });
});

// ══════════════════════ 깔때기 ══════════════════════
const L = (id: string, o: Record<string, unknown> = {}) => ({
  id, event_name: 'EDUtech', created_at: '2026-11-05T00:00:00Z',
  email_normalized: `${id}@x.sg`, email_status: 'unverified', email_quality: 4, ...o,
});

describe('깔때기 — 단계 순서와 기준', () => {
  it('전환 단계가 요구대로다', () => {
    expect([...CONVERSION_STEPS]).toEqual([
      '1차 연락함', '응답 받음', '미팅·데모', '체험 중', '협상', '성사']);
  });

  it('숫자의 뜻이 한 곳에 적혀 있다 (분모·분자)', () => {
    expect(FUNNEL_BASIS).toContain('분모');
    expect(FUNNEL_BASIS).toContain('보관된 리드 제외');
    expect(FUNNEL_BASIS).toContain('메일 발송 가능');
  });

  it('분모가 0 이면 "—" 다 (0% 가 아니다)', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0)).toBe('0%');
    expect(pct(0.5)).toBe('50%');
    expect(pct(1)).toBe('100%');
  });
});

describe('깔때기 — 어디까지 갔는가', () => {
  it('단계가 깔때기 칸 번호가 된다', () => {
    expect(reachedIndex(L('a', { followup_stage: '1차 연락함' }))).toBe(0);
    expect(reachedIndex(L('a', { followup_stage: '미팅·데모' }))).toBe(2);
  });

  it('**성사는 마지막 칸까지 간 것으로 센다**', () => {
    expect(reachedIndex(L('a', { followup_stage: '성사' }))).toBe(CONVERSION_STEPS.length - 1);
  });

  it('**보류·종료는 깔때기 밖이다** (중간 칸에 남아 전환율을 깎으면 안 된다)', () => {
    expect(reachedIndex(L('a', { followup_stage: '보류' }))).toBe(-1);
    expect(reachedIndex(L('a', { followup_stage: '종료' }))).toBe(-1);
  });

  // `reachedIndex` 의 `isClosedStage` 가드는 **지금은 중복**이다 —
  // '보류'·'종료' 가 CONVERSION_STEPS 에 없어서 어차피 -1 이 된다.
  // 그래서 가드를 지우는 변이는 잡히지 않는다(정직 기록: 결과 문서 §변이 시험).
  // 실효가 있는 것은 **표를 지키는 것**이다 — 잃은 단계가 깔때기 칸에 들어오면
  // 종료된 리드가 전환율에 섞인다.
  it('깔때기 칸에 "잃은" 단계가 섞이지 않는다 (표를 고정한다)', () => {
    for (const s of ['보류', '종료']) {
      expect(CONVERSION_STEPS, s).not.toContain(s);
    }
    // 유형별 "끝난 단계" 중 깔때기에 들어가도 되는 것은 '성사' 뿐이다
    for (const t of LEAD_TYPES) {
      for (const s of TYPE_CLOSED_STAGES[t]) {
        if (s === '성사') continue;
        expect(CONVERSION_STEPS, `${t}:${s}`).not.toContain(s);
      }
    }
  });

  it('아직 연락 안 한 사람은 깔때기 밖이다', () => {
    for (const s of ['신규', '연락 대기', undefined, '']) {
      expect(reachedIndex(L('a', { followup_stage: s })), String(s)).toBe(-1);
      expect(isUntouched(L('a', { followup_stage: s })), String(s)).toBe(true);
    }
    expect(isUntouched(L('a', { followup_stage: '1차 연락함' }))).toBe(false);
  });
});

describe('깔때기 — 한 행사', () => {
  const rows = [
    L('1', { followup_stage: '신규' }),
    L('2', { followup_stage: '1차 연락함' }),
    L('3', { followup_stage: '응답 받음' }),
    L('4', { followup_stage: '미팅·데모' }),
    L('5', { followup_stage: '성사' }),
    L('6', { followup_stage: '종료' }),
    L('7', { followup_stage: '1차 연락함', archived_at: '2026-11-10T00:00:00Z' }),  // 보관
  ];
  const f = funnelFor('EDUtech', rows, T);

  it('**보관된 리드는 빠진다**', () => {
    expect(f.total).toBe(6);
  });

  // 처음에 성사와 종료를 `closed` 하나로 합쳐 셌다가, "끝남 2명" 이 화면에서
  // 뜻이 없다는 것을 이 테스트가 드러냈다 — 하나는 성사하고 하나는 잃은 것이다.
  it('성사와 잃은 것을 **따로** 센다', () => {
    expect(f.untouched).toBe(1);   // 신규
    expect(f.won).toBe(1);         // 성사
    expect(f.lost).toBe(1);        // 종료
  });

  it('보류도 잃은 쪽으로 센다', () => {
    const g = funnelFor('x', [
      L('1', { followup_stage: '보류' }), L('2', { followup_stage: '종료' }),
      L('3', { followup_stage: '성사' }),
    ], T);
    expect(g.lost).toBe(2);
    expect(g.won).toBe(1);
  });

  it('그 단계 이상 진행한 사람을 센다', () => {
    const by = new Map(f.steps.map(s => [s.step, s.reached]));
    expect(by.get('1차 연락함')).toBe(4);   // 2,3,4,5
    expect(by.get('응답 받음')).toBe(3);    // 3,4,5
    expect(by.get('미팅·데모')).toBe(2);    // 4,5
    expect(by.get('체험 중')).toBe(1);      // 5(성사)
    expect(by.get('성사')).toBe(1);
  });

  it('첫 칸은 전체 대비, 그 뒤는 앞 칸 대비다', () => {
    const s = new Map(f.steps.map(x => [x.step, x]));
    expect(s.get('1차 연락함')!.stepRate).toBeCloseTo(4 / 6);
    expect(s.get('응답 받음')!.stepRate).toBeCloseTo(3 / 4);
    expect(s.get('응답 받음')!.overallRate).toBeCloseTo(3 / 6);
  });

  it('앞 칸이 0 이면 비율이 "—" 다', () => {
    const only = funnelFor('x', [L('1', { followup_stage: '신규' })], T);
    expect(only.steps[0].stepRate).toBe(0);         // 전체 1명 중 0명
    expect(only.steps[1].stepRate).toBeNull();      // 앞 칸이 0 → 셀 수 없다
  });

  it('리드가 없으면 전부 "—" 다', () => {
    const empty = funnelFor('x', [], T);
    expect(empty.total).toBe(0);
    for (const s of empty.steps) {
      expect(s.stepRate).toBeNull();
      expect(s.overallRate).toBeNull();
    }
  });

  it('단계별 인원과 평균 체류일', () => {
    const st = new Map(f.stages.map(s => [s.stage, s]));
    expect(st.get('1차 연락함')!.count).toBe(1);
    // 등록 2026-11-05 → 2026-11-17 = 12일
    expect(st.get('1차 연락함')!.avgDays).toBe(12);
  });

  it('마지막 접촉이 있으면 그 날부터 센다', () => {
    const g = funnelFor('x', [
      L('1', { followup_stage: '응답 받음', last_contact_at: '2026-11-15T00:00:00Z' }),
    ], T);
    expect(g.stages[0].avgDays).toBe(2);
  });

  it('메일 발송 가능 인원을 센다 (억제 규칙과 같은 판정)', () => {
    const g = funnelFor('x', [
      L('1'),                                       // 가능
      L('2', { email_status: 'hold' }),             // 보류
      L('3', { unsubscribed_at: 'x' }),             // 거부
      L('4', { email_quality: 1 }),                 // 신뢰도 낮음
      L('5', { email_quality: null }),              // 미평가
    ], T);
    expect(g.mailable).toBe(1);
  });

  it('국가·지역·유형 분포', () => {
    const g = funnelFor('x', [
      L('1', { country: 'SG', lead_type: 'customer' }),
      L('2', { country: 'SG', lead_type: 'tech' }),
      L('3', { country: 'MY' }),
    ], T);
    expect(g.byCountry[0]).toEqual({ country: 'SG', count: 2 });
    expect(g.byRegion[0]).toEqual({ region: 'SEA', label: '동남아', count: 3 });
    const types = new Map(g.byType.map(t => [t.label, t.count]));
    expect(types.get('미분류')).toBe(1);
    expect(types.get('고객')).toBe(1);
  });

  it('국가가 비면 "(없음)" 으로 센다 (버리지 않는다)', () => {
    const g = funnelFor('x', [L('1', { country: '' })], T);
    expect(g.byCountry[0].country).toBe('(없음)');
  });
});

describe('깔때기 — 행사별 묶기', () => {
  it('행사명이 없으면 캠페인 이름을 쓴다', () => {
    const names = new Map([['c1', '2026 미래교육박람회']]);
    expect(eventNameOf({ id: '1', campaign_id: 'c1' }, names)).toBe('2026 미래교육박람회');
    expect(eventNameOf({ id: '1', event_name: 'EDUtech', campaign_id: 'c1' }, names)).toBe('EDUtech');
  });

  it('둘 다 없으면 "(행사 없음)" 이다', () => {
    expect(eventNameOf({ id: '1' })).toBe('(행사 없음)');
    expect(eventNameOf({ id: '1', campaign_id: 'zz' }, new Map())).toBe('(행사 없음)');
  });

  it('리드가 많은 행사가 먼저 온다', () => {
    const fs2 = funnelsByEvent([
      L('1', { event_name: 'A' }),
      L('2', { event_name: 'B' }), L('3', { event_name: 'B' }),
    ], T);
    expect(fs2.map(f => f.event)).toEqual(['B', 'A']);
    expect(fs2[0].total).toBe(2);
  });

  it('보관된 리드만 있는 행사도 묶음에는 나오지만 총원이 0 이다', () => {
    const fs2 = funnelsByEvent([L('1', { event_name: 'A', archived_at: 'x' })], T);
    expect(fs2).toHaveLength(1);
    expect(fs2[0].total).toBe(0);
  });
});

describe('깔때기 — 단계 표시 순서', () => {
  it('가장 흔한 유형의 단계 순서를 따른다', () => {
    const rows = [
      L('1', { lead_type: 'sales', followup_stage: '계약' }),
      L('2', { lead_type: 'sales', followup_stage: '발굴' }),
      L('3', { lead_type: 'customer', followup_stage: '신규' }),
    ];
    expect(mostCommonType(rows)).toBe('sales');
    const f = funnelFor('x', rows, T);
    const order = f.stages.map(s => s.stage);
    expect(order.indexOf('발굴')).toBeLessThan(order.indexOf('계약'));
  });

  it('유형이 없으면 고객 순서를 따른다', () => {
    expect(mostCommonType([L('1'), L('2')])).toBeNull();
  });

  it('목록에 없는 단계도 **버리지 않고** 뒤에 붙인다', () => {
    const f = funnelFor('x', [L('1', { followup_stage: '옛날단계' })], T);
    expect(f.stages.map(s => s.stage)).toContain('옛날단계');
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 추가만', () => {
  const M = sqlCode(read('supabase/migrations/20261128000000_lead_s4_lead_type.sql'));

  it('두 칸을 더한다', () => {
    expect(M).toContain('add column if not exists lead_type text');
    expect(M).toMatch(/add column if not exists lead_tags jsonb not null default '\[\]'::jsonb/);
  });

  it('기존 데이터를 바꾸지 않는다', () => {
    expect(M).not.toMatch(/drop\s+column/i);
    expect(M).not.toMatch(/\b(delete\s+from|truncate|update\s+public\.)/i);
  });

  it('유형에 CHECK 를 걸지 않는다 (James 가 쓰면서 고칠 전제)', () => {
    expect(M).not.toMatch(/lead_type[^;]*check/i);
  });

  it('여러 번 돌려도 같다', () => {
    const adds = M.match(/add column/gi) ?? [];
    expect((M.match(/add column if not exists/gi) ?? []).length).toBe(adds.length);
  });

  it('롤백·드라이런이 있고 드라이런은 아무것도 남기지 않는다', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), '../audit/rollback_lead_s4_lead_type.sql'))).toBe(true);
    const D = sqlCode(read('../audit/dryrun_lead_s4_lead_type.sql'));
    expect(D).toMatch(/^\s*begin;/m);
    expect(D.trimEnd().endsWith('rollback;')).toBe(true);
    expect(D).not.toMatch(/\bcommit\b/i);
  });

  it('롤백이 분류 결과를 함부로 지우지 않는다', () => {
    const R = read('../audit/rollback_lead_s4_lead_type.sql');
    expect(sqlCode(R)).not.toMatch(/drop column/i);
    expect(R).toMatch(/건수를 먼저 확인/);
  });

  it('S2 와 달리 테이블을 다시 쓰지 않는다는 것을 밝힌다', () => {
    expect(read('../audit/dryrun_lead_s4_lead_type.sql')).toContain('테이블을 다시 쓰지 않는다');
  });
});
