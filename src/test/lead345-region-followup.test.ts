// LEAD-3 (해외 리드 칸) · LEAD-4 (팔로업) · LEAD-5 (지역 분류)
//
// 지켜야 하는 약속
//   ① 지역은 country 에서 자동으로 나온다. 모르는 나라는 **임의로 끼워 맞추지 않고** '기타'.
//   ② 기한 판정은 **한국 시간 기준**이다 — UTC 로 하면 매일 아침 오늘 할 일이 빠진다.
//   ③ "7일 넘게 접촉 없음"은 **한 번도 연락 안 한 리드를 반드시 포함**한다(EDUtech 10건).
//   ④ 활동 기록은 지우지 않는다(원장). 단계는 적은 사람이 고를 때만 바뀐다.
//   ⑤ 새 테이블은 anon 권한이 없고 DELETE 가 막혀 있다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  COUNTRY_TO_REGION, REGIONS, REGION_LABEL, isKoreanMobile, normalizeCountry,
  regionCounts, regionOf,
} from '../lib/leadRegion';
import {
  CHANNELS, CLOSED_STAGES, FOLLOWUP_STAGES, FUNNEL_STAGES, buildActivity, daysBetween,
  dueState, dueToday, isClosedStage, kstDate, lastTouchDate, leadPatchForActivity,
  needsCloseReason, overdueDays, stageCounts, staleDays, staleLeads, suggestFirstContactDue,
  todayKst,
} from '../lib/leadFollowup';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

// ══════════════════════════ LEAD-5 지역 ══════════════════════════
describe('LEAD-5 · 지역 자동 분류', () => {
  it('지역이 9개 + 국내 + 기타 + 미분류 = 12개다', () => {
    expect(REGIONS).toHaveLength(12);
    expect(REGION_LABEL.OTHER).toBe('기타');
    expect(REGION_LABEL.UNKNOWN).toBe('미분류');
  });

  it.each([
    ['US', 'US'], ['GB', 'GB'], ['DE', 'EU'], ['FR', 'EU'], ['CH', 'EU'],
    ['AE', 'GCC'], ['SA', 'GCC'], ['IN', 'IN'],
    ['SG', 'SEA'], ['HK', 'SEA'], ['TW', 'SEA'], ['MM', 'SEA'],
    ['JP', 'JP'], ['BR', 'LATAM'],
    ['MN', 'CA'], ['UZ', 'CA'], ['UA', 'CA'],
    ['KR', 'KR'],
  ] as const)('%s → %s', (country, want) => {
    expect(regionOf({ country })).toBe(want);
  });

  it('우크라이나는 James 가 적은 대로 중앙아시아다', () => {
    expect(COUNTRY_TO_REGION.UA).toBe('CA');
  });

  it('지역 9개에 없는 나라는 기타다 (임의로 끼워 맞추지 않는다)', () => {
    for (const c of ['TR', 'AU', 'CN', 'PK', 'MX', 'ZA', 'NZ', 'EG']) {
      expect(regionOf({ country: c }), c).toBe('OTHER');
    }
  });

  it('캐나다(CA)가 중앙아시아로 들어가지 않는다', () => {
    expect(regionOf({ country: 'CA' })).toBe('OTHER');
    expect(regionOf({ country: 'Canada' })).toBe('OTHER');
  });

  // 'CA' 는 국가코드(캐나다)이면서 우리 지역코드(중앙아시아)이기도 하다.
  // 매핑표에 CA 키가 생기면 캐나다가 중앙아시아로 들어간다 — 표를 여기서 고정한다.
  // (regionOf 안의 `if (upper === 'CA')` 가드는 지금 폴스루와 중복이라 그 가드만
  //  지워도 결과가 같다. 그래서 가드가 아니라 **표**를 지키는 것이 실효가 있다.)
  it('매핑표에 CA 키가 없다 (있으면 캐나다가 중앙아시아가 된다)', () => {
    expect('CA' in COUNTRY_TO_REGION).toBe(false);
  });

  it('중앙아시아 국가들은 CA 가 아닌 자기 코드로 들어 있다', () => {
    expect(COUNTRY_TO_REGION.MN).toBe('CA');
    expect(COUNTRY_TO_REGION.UZ).toBe('CA');
  });

  it('영문·한글 국가명도 알아본다 (운영 데이터가 자유 텍스트다)', () => {
    expect(regionOf({ country: 'Korea' })).toBe('KR');
    expect(regionOf({ country: '대한민국' })).toBe('KR');
    expect(regionOf({ country: 'Singapore' })).toBe('SEA');
    expect(regionOf({ country: 'United Kingdom' })).toBe('GB');
    expect(regionOf({ country: ' usa ' })).toBe('US');
  });

  it("'intl' 은 국가가 아니므로 미분류다 (James 가 건별로 정한다)", () => {
    expect(regionOf({ country: 'intl' })).toBe('UNKNOWN');
  });

  it('country 가 비면 한국 휴대폰이면 국내, 아니면 미분류 (James 결정)', () => {
    expect(regionOf({ country: '', phone: '010-1234-5678' })).toBe('KR');
    expect(regionOf({ country: null, phone: '+82 10 1234 5678' })).toBe('KR');
    expect(regionOf({ country: '', phone: '+65 9123 4567' })).toBe('UNKNOWN');
    expect(regionOf({ country: '', phone: '' })).toBe('UNKNOWN');
    expect(regionOf({})).toBe('UNKNOWN');
  });

  it('한국 휴대폰 판정 — 국가번호 두 표기를 모두 받는다', () => {
    for (const p of [
      '01012345678', '0111234567',
      '821012345678',   // +82 10-… (국제 표준: 앞의 0 을 뗀다)
      '8201012345678',  // +82 010-… (손으로 적은 형태)
    ]) {
      expect(isKoreanMobile(p), p).toBe(true);
    }
    for (const p of ['0212345678', '6591234567', '', '010123', '8221234567']) {
      expect(isKoreanMobile(p), p).toBe(false);
    }
  });

  it('모르는 표기는 원본을 들고 간다 (버리지 않는다)', () => {
    expect(normalizeCountry('Freedonia')).toBe('Freedonia');
    expect(normalizeCountry('  ')).toBeNull();
  });

  it('지역별 건수 요약 — 표시 순서를 지키고 0건은 숨긴다', () => {
    const rows = [
      { country: 'SG' }, { country: 'SG' }, { country: 'US' },
      { country: 'Korea' }, { country: 'TR' }, { country: '' },
    ];
    expect(regionCounts(rows)).toEqual([
      { region: 'KR', label: '국내', count: 1 },
      { region: 'US', label: '미국', count: 1 },
      { region: 'SEA', label: '동남아', count: 2 },
      { region: 'OTHER', label: '기타', count: 1 },
      { region: 'UNKNOWN', label: '미분류', count: 1 },
    ]);
  });
});

// ══════════════════════════ LEAD-4 팔로업 ══════════════════════════
describe('LEAD-4 · 날짜는 한국 시간 기준', () => {
  it('UTC 자정~오전 9시 사이에도 한국 날짜가 나온다 (가장 중요)', () => {
    // 2026-11-17 00:30 UTC = 한국 2026-11-17 09:30
    expect(todayKst(new Date('2026-11-17T00:30:00Z'))).toBe('2026-11-17');
    // 2026-11-16 23:30 UTC = 한국 2026-11-17 08:30 → **17일**이어야 한다
    expect(todayKst(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-17');
  });

  it('UTC 로 계산하면 틀리는 것을 고정한다', () => {
    const d = new Date('2026-11-16T23:30:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-11-16');   // UTC: 어제
    expect(todayKst(d)).toBe('2026-11-17');                    // KST: 오늘
  });

  it('일수 계산', () => {
    expect(daysBetween('2026-11-16', '2026-11-20')).toBe(4);
    expect(daysBetween('2026-11-20', '2026-11-16')).toBe(-4);
    expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0);
  });

  it('timestamptz → 한국 날짜', () => {
    expect(kstDate('2026-11-16T23:00:00Z')).toBe('2026-11-17');
    expect(kstDate(null)).toBeNull();
    expect(kstDate('not-a-date')).toBeNull();
  });
});

describe('LEAD-4 · 기한 상태', () => {
  const T = '2026-11-16';

  it.each([
    ['2026-11-10', 'overdue'], ['2026-11-15', 'overdue'],
    ['2026-11-16', 'today'],
    ['2026-11-17', 'soon'], ['2026-11-19', 'soon'],
    ['2026-11-20', 'later'],
  ] as const)('%s → %s', (due, want) => {
    expect(dueState({ next_action_due: due }, T)).toBe(want);
  });

  it('기한이 없으면 none', () => {
    expect(dueState({}, T)).toBe('none');
    expect(dueState({ next_action_due: '' }, T)).toBe('none');
  });

  it('며칠 지났는지 센다', () => {
    expect(overdueDays({ next_action_due: '2026-11-13' }, T)).toBe(3);
    expect(overdueDays({ next_action_due: '2026-11-20' }, T)).toBe(0);
  });
});

describe('LEAD-4 · ① 오늘 할 팔로업', () => {
  const T = '2026-11-16';
  const rows = [
    { id: 'a', next_action_due: '2026-11-10', probability: 2 },   // 6일 지남
    { id: 'b', next_action_due: '2026-11-16', probability: 5 },   // 오늘
    { id: 'c', next_action_due: '2026-11-14', probability: 5 },   // 2일 지남
    { id: 'd', next_action_due: '2026-11-20', probability: 5 },   // 아직
    { id: 'e', next_action_due: '2026-11-16', probability: 1 },   // 오늘(가능성 낮음)
    { id: 'f', next_action_due: '2026-11-01', followup_stage: '성사' },  // 끝남
    { id: 'g', probability: 5 },                                   // 기한 없음
  ];

  it('기한 도래·지난 것만 나온다', () => {
    expect(dueToday(rows, T).map(r => r.id)).toEqual(['a', 'c', 'b', 'e']);
  });

  it('많이 지난 것이 위로, 같으면 가능성 높은 것이 위로', () => {
    const ids = dueToday(rows, T).map(r => r.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));   // 6일 > 2일
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('e'));   // 가능성 5 > 1
  });

  it('끝난 단계(성사·보류·종료)는 빠진다', () => {
    expect(dueToday(rows, T).map(r => r.id)).not.toContain('f');
    for (const s of CLOSED_STAGES) {
      expect(dueToday([{ next_action_due: '2026-01-01', followup_stage: s }], T)).toEqual([]);
    }
  });

  it('기한 없는 리드는 이 목록이 아니다 (7일 무접촉이 잡는다)', () => {
    expect(dueToday(rows, T).map(r => r.id)).not.toContain('g');
  });
});

describe('LEAD-4 · ② 7일 넘게 접촉 없음', () => {
  const T = '2026-11-16';

  it('한 번도 연락 안 한 리드를 **반드시** 포함한다 (EDUtech 10건이 이 경우)', () => {
    const rows = [{ id: 'never', created_at: '2026-11-01T00:00:00Z' }];
    expect(staleLeads(rows, 7, T).map(r => r.id)).toEqual(['never']);
  });

  it('접촉일이 있으면 그 날부터 센다', () => {
    const rows = [
      { id: 'old', created_at: '2026-01-01T00:00:00Z', last_contact_at: '2026-11-01T00:00:00Z' },
      { id: 'fresh', created_at: '2026-01-01T00:00:00Z', last_contact_at: '2026-11-15T00:00:00Z' },
    ];
    expect(staleLeads(rows, 7, T).map(r => r.id)).toEqual(['old']);
  });

  it('정확히 7일이면 포함한다 (경계)', () => {
    const rows = [{ id: 'x', created_at: '2026-11-09T00:00:00Z' }];
    expect(staleLeads(rows, 7, T)).toHaveLength(1);
    const rows6 = [{ id: 'y', created_at: '2026-11-10T00:00:00Z' }];
    expect(staleLeads(rows6, 7, T)).toHaveLength(0);
  });

  it('오래 방치된 것이 위로 온다', () => {
    const rows = [
      { id: 'a', created_at: '2026-11-05T00:00:00Z' },
      { id: 'b', created_at: '2026-10-01T00:00:00Z' },
      { id: 'c', created_at: '2026-11-08T00:00:00Z' },
    ];
    expect(staleLeads(rows, 7, T).map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('끝난 단계는 빠진다', () => {
    const rows = [{ id: 'z', created_at: '2026-01-01T00:00:00Z', followup_stage: '종료' }];
    expect(staleLeads(rows, 7, T)).toEqual([]);
  });

  it('며칠째인지 센다', () => {
    expect(staleDays({ created_at: '2026-11-09T00:00:00Z' }, T)).toBe(7);
    expect(staleDays({ last_contact_at: '2026-11-14T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, T)).toBe(2);
    expect(staleDays({}, T)).toBeNull();
  });

  it('접촉일이 창(窓)보다 우선한다', () => {
    expect(lastTouchDate({ last_contact_at: '2026-11-14T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }))
      .toBe('2026-11-14');
  });
});

describe('LEAD-4 · 단계와 깔때기', () => {
  it('단계가 브리프 G항 그대로 10개다', () => {
    expect(FOLLOWUP_STAGES).toEqual([
      '신규', '연락 대기', '1차 연락함', '응답 받음', '미팅·데모',
      '체험 중', '협상', '성사', '보류', '종료',
    ]);
  });

  it('깔때기에는 결과(성사·보류·종료)가 들어가지 않는다', () => {
    for (const s of CLOSED_STAGES) expect(FUNNEL_STAGES).not.toContain(s);
    expect(FUNNEL_STAGES).toHaveLength(7);
  });

  it('끝난 단계 판정', () => {
    expect(isClosedStage('성사')).toBe(true);
    expect(isClosedStage('협상')).toBe(false);
    expect(isClosedStage(undefined)).toBe(false);
  });

  it("'종료'는 사유가 필요하다", () => {
    expect(needsCloseReason('종료')).toBe(true);
    expect(needsCloseReason('보류')).toBe(false);
  });

  it('단계별 건수 — 값이 없으면 신규로 센다', () => {
    const c = stageCounts([{}, { followup_stage: '' }, { followup_stage: '협상' }]);
    expect(c.find(x => x.stage === '신규')!.count).toBe(2);
    expect(c.find(x => x.stage === '협상')!.count).toBe(1);
    expect(c).toHaveLength(10);
  });
});

describe('LEAD-4 · 활동 기록(원장)', () => {
  const base = { leadId: 'L1', channel: 'email' as const, direction: 'out' as const, summary: '첫 메일 보냄' };

  it('요약 한 줄만 있으면 적을 수 있다 (빠르게)', () => {
    const v = buildActivity(base);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.lead_id).toBe('L1');
      expect(v.row.summary).toBe('첫 메일 보냄');
      expect(v.row.stage_after).toBeNull();
    }
  });

  it.each([
    ['리드 없음', { ...base, leadId: '' }],
    ['요약 없음', { ...base, summary: '   ' }],
    ['모르는 채널', { ...base, channel: 'sms' as never }],
    ['방향 없음', { ...base, direction: '' as never }],
  ])('잘못된 입력을 막는다 — %s', (_n, input) => {
    expect(buildActivity(input).ok).toBe(false);
  });

  it('모르는 단계는 무시한다 (DB CHECK 가 없으므로 코드가 지킨다)', () => {
    const v = buildActivity({ ...base, stageAfter: '없는단계' as never });
    expect(v.ok && v.row.stage_after).toBeNull();
  });

  it('아는 단계는 기록한다', () => {
    const v = buildActivity({ ...base, stageAfter: '1차 연락함' });
    expect(v.ok && v.row.stage_after).toBe('1차 연락함');
  });

  it('기록한 사람을 남긴다', () => {
    const v = buildActivity({ ...base, actor: ' 제시카 ', actorUserId: 'u1' });
    expect(v.ok && v.row.actor).toBe('제시카');
    expect(v.ok && v.row.actor_user_id).toBe('u1');
  });

  it('채널 6가지', () => {
    expect(CHANNELS).toEqual(['email', 'whatsapp', 'linkedin', 'phone', 'meeting', 'other']);
  });
});

describe('LEAD-4 · 활동 기록이 리드에 반영되는 것', () => {
  it('마지막 접촉일을 **반드시** 갱신한다 (안 하면 7일 목록에 계속 남는다)', () => {
    const p = leadPatchForActivity({ occurredAt: '2026-11-16T05:00:00Z' });
    expect(p.last_contact_at).toBe('2026-11-16T05:00:00Z');
  });

  it('단계는 고른 경우에만 바뀐다 (자동 상태 변경 금지)', () => {
    expect('followup_stage' in leadPatchForActivity({})).toBe(false);
    expect(leadPatchForActivity({ stageAfter: '응답 받음' }).followup_stage).toBe('응답 받음');
  });

  it("'종료'를 고르면 사유를 같이 넣는다", () => {
    const p = leadPatchForActivity({ stageAfter: '종료', closeReason: '예산 없음' });
    expect(p.close_reason).toBe('예산 없음');
  });

  it('다음 행동을 비우는 것도 뜻이 있다 (할 일이 없어졌다)', () => {
    const p = leadPatchForActivity({ nextAction: '', nextActionDue: '' });
    expect(p.next_action).toBeNull();
    expect(p.next_action_due).toBeNull();
  });

  it('다음 행동을 안 건드리면 키가 없다 (기존 값 보존)', () => {
    const p = leadPatchForActivity({});
    expect('next_action' in p).toBe(false);
    expect('next_action_due' in p).toBe(false);
  });

  it('1차 연락 권장 기한 — 가능성 4~5는 24시간, 그 외는 48시간', () => {
    expect(suggestFirstContactDue(5, '2026-11-16')).toBe('2026-11-17');
    expect(suggestFirstContactDue(4, '2026-11-16')).toBe('2026-11-17');
    expect(suggestFirstContactDue(3, '2026-11-16')).toBe('2026-11-18');
    expect(suggestFirstContactDue(null, '2026-11-16')).toBe('2026-11-18');
  });
});

// ══════════════════════════ 마이그레이션 ══════════════════════════
describe('LEAD-3 마이그레이션 — 해외 리드 칸', () => {
  const M = sqlCode(read('supabase/migrations/20261121000000_lead_intl_fields.sql'));

  it('브리프 B항이 요구한 칸이 전부 있다', () => {
    for (const c of ['country', 'segment', 'probability', 'event_name', 'source_type',
                     'email_quality', 'email_status', 'notes']) {
      expect(M, c).toContain(`add column if not exists ${c}`);
    }
  });

  it('기존 열을 지우거나 데이터를 바꾸지 않는다', () => {
    expect(M).not.toMatch(/drop\s+column/i);
    expect(M).not.toMatch(/\b(delete|truncate|update)\s+/i);
    expect(M).not.toMatch(/set\s+not\s+null/i);
  });

  it('CHECK 는 값이 있을 때만 검사한다 (기존 행을 막지 않게)', () => {
    const checks = M.match(/check \([^)]*\)/gi) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(5);
    for (const c of checks) expect(c, c).toMatch(/is null or/i);
  });

  it('가능성순 정렬·국가·행사 필터용 인덱스가 있다', () => {
    expect(M).toMatch(/idx_campaign_leads_probability/);
    expect(M).toMatch(/idx_campaign_leads_country/);
    expect(M).toMatch(/idx_campaign_leads_event/);
  });
});

describe('LEAD-4 마이그레이션 — 팔로업과 원장 보안', () => {
  const M = sqlCode(read('supabase/migrations/20261122000000_lead_followup.sql'));

  it('브리프 G항이 요구한 칸이 전부 있다', () => {
    for (const c of ['followup_stage', 'last_contact_at', 'next_action', 'next_action_due',
                     'owner', 'close_reason']) {
      expect(M, c).toContain(`add column if not exists ${c}`);
    }
  });

  it('새 테이블에 RLS 를 켠다', () => {
    expect(M).toMatch(/alter table public\.lead_activities enable row level security/i);
  });

  it('authenticated 정책만 두고 anon 정책을 만들지 않는다', () => {
    expect(M).toMatch(/to authenticated/);
    expect(M).not.toMatch(/to anon/);
    expect(M).not.toMatch(/to public\b/);
  });

  it('관리자 판정에 B1 헬퍼를 쓴다', () => {
    expect(M).toMatch(/public\.app_is_admin\(\)/);
  });

  it('anon 권한을 명시적으로 회수한다 (명령서 지시)', () => {
    expect(M).toMatch(/revoke all on public\.lead_activities from anon/i);
    expect(M).toMatch(/revoke all on public\.lead_activities from public/i);
  });

  it('anon 에 GRANT 를 주지 않는다', () => {
    const grants = M.match(/grant[^;]*;/gi) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g, g).not.toMatch(/\banon\b/);
  });

  it('원장이라 DELETE 를 막는다 (RESTRICTIVE 라 나중에 뚫리지 않는다)', () => {
    expect(M).toMatch(/as restrictive for delete/i);
    expect(M).toMatch(/using \( false \)/i);
  });

  it('authenticated 에게 DELETE 권한을 주지 않는다', () => {
    const g = (M.match(/grant ([^;]*) on public\.lead_activities to authenticated/i) ?? [])[1] ?? '';
    expect(g.toLowerCase()).not.toContain('delete');
    expect(g.toLowerCase()).not.toContain('all');
  });

  it('followup_stage 에 CHECK 를 걸지 않는다 (CRM-015 가 단계를 더한다)', () => {
    expect(M).not.toMatch(/followup_stage[^;]*check/i);
  });
});

describe('롤백·드라이런이 다 있다', () => {
  it.each(['lead3', 'lead4'])('%s', (u) => {
    const rb = `../audit/rollback_${u}.sql`;
    const dr = `../audit/dryrun_${u}.sql`;
    expect(fs.existsSync(path.resolve(process.cwd(), rb)), rb).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), dr)), dr).toBe(true);
    const D = sqlCode(read(dr));
    expect(D).toMatch(/^\s*begin;/m);
    expect(D.trimEnd().endsWith('rollback;')).toBe(true);
    expect(D).not.toMatch(/\bcommit\b/i);
  });

  it('LEAD-4 롤백은 원장을 함부로 지우지 않는다', () => {
    const R = read('../audit/rollback_lead4.sql');
    // DROP TABLE 은 주석으로만 있어야 한다
    const live = sqlCode(R);
    expect(live).not.toMatch(/drop table/i);
    expect(R).toMatch(/활동 기록이 사라진다/);
  });
});
