// LEAD-S1 순수 로직 — 관심 신호 · 조사 메모 · 접근 전략 · n차 접촉 · 쓸 수 있는 사실
//
// 지켜야 하는 약속
//   ① 차수(n차)는 **보낸 접촉만** 센다. 시스템 변경 기록(`[변경]`)을 세면 안 된다.
//   ② 현재 전략은 **가장 큰 version** 이다(날짜가 아니다).
//   ③ 새 판은 이전 판을 미리 채우지만 **근거(rationale)는 비운다**.
//   ④ 메일에 쓸 사실은 **확정만**. 미정을 고르면 조용히 버리지 않고 알려 준다.
//   ⑤ 이력성 표는 지우지 않는다(취소 사유 필수).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  FACT_STATUSES, FACT_STATUS_LABEL, OUTCOMES, OUTCOME_LABEL, PENDING_PLACEHOLDER,
  SIGNAL_LABEL, SIGNAL_SOURCES, SIGNAL_TYPES, attemptNumbers, buildResearch, buildSignal,
  buildStrategy, buildVoid, currentStrategy, draftNextVersion, factIdsOf, factStatusLogLine,
  isConfirmed, isOutreach, isVoided, nextAttemptNo, nextVersion, pendingRevision, safeUrl,
  suggestsRevision, validateFactSelection, type OutreachFact, type Strategy,
} from '../lib/leadStrategy';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

// ══════════════════════ 관심 신호 ══════════════════════
describe('관심 신호', () => {
  it('요구한 10가지다', () => {
    expect([...SIGNAL_TYPES]).toEqual([
      'board_game', 'pricing', 'lms', 'special_ed', 'language',
      'pilot', 'partnership', 'trial', 'demo', 'other',
    ]);
    expect(SIGNAL_LABEL.board_game).toBe('보드게임');
    expect([...SIGNAL_SOURCES]).toEqual(['field', 'badge', 'trial', 'email', 'research', 'other']);
  });

  it('유형만으로도 저장된다 (부스에서는 한 손으로 적는다)', () => {
    const v = buildSignal({ leadId: 'L1', signalType: 'pricing' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.signal_type).toBe('pricing');
      expect(v.row.note).toBeNull();
      expect(v.row.source).toBe('field');
    }
  });

  it("'기타'는 메모가 없으면 뜻이 없어 요구한다", () => {
    expect(buildSignal({ leadId: 'L1', signalType: 'other' }).ok).toBe(false);
    expect(buildSignal({ leadId: 'L1', signalType: 'other', note: 'AI 윤리 질문' }).ok).toBe(true);
  });

  it.each([
    ['리드 없음', { leadId: '', signalType: 'pricing' as const }],
    ['모르는 유형', { leadId: 'L1', signalType: 'budget' as never }],
  ])('잘못된 입력을 막는다 — %s', (_n, input) => {
    expect(buildSignal(input).ok).toBe(false);
  });

  it('모르는 출처는 현장으로 본다 (버리지 않는다)', () => {
    const v = buildSignal({ leadId: 'L1', signalType: 'lms', source: 'telepathy' as never });
    expect(v.ok && v.row.source).toBe('field');
  });

  it('관찰일을 주면 그대로, 안 주면 DB 기본값(오늘)에 맡긴다', () => {
    const a = buildSignal({ leadId: 'L1', signalType: 'lms', observedAt: '2026-11-05' });
    expect(a.ok && a.row.observed_at).toBe('2026-11-05');
    const b = buildSignal({ leadId: 'L1', signalType: 'lms' });
    expect(b.ok && 'observed_at' in b.row).toBe(false);
  });
});

// ══════════════════════ 조사 메모 ══════════════════════
describe('조사 메모', () => {
  it('제목만 있으면 저장된다', () => {
    const v = buildResearch({ leadId: 'L1', title: 'NIE 소속 확인' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.title).toBe('NIE 소속 확인');
  });

  it('제목이 없으면 막는다', () => {
    expect(buildResearch({ leadId: 'L1', title: '   ' }).ok).toBe(false);
  });

  it('링크는 http(s) 만 받는다', () => {
    expect(safeUrl('https://x.test/a')).toBe('https://x.test/a');
    expect(safeUrl('http://x.test')).toBe('http://x.test');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'x.test', '']) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  it('나쁜 링크를 적으면 조용히 버리지 않고 알려 준다', () => {
    const v = buildResearch({ leadId: 'L1', title: 't', sourceUrl: 'javascript:alert(1)' });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.error).toContain('http');
  });

  it('링크를 안 적으면 통과한다', () => {
    expect(buildResearch({ leadId: 'L1', title: 't', sourceUrl: '  ' }).ok).toBe(true);
  });
});

describe('취소(void) — 지우지 않는다', () => {
  it('사유가 필수다', () => {
    expect(buildVoid('').ok).toBe(false);
    expect(buildVoid('   ').ok).toBe(false);
    expect(buildVoid(null).ok).toBe(false);
  });

  it('사유를 적으면 취소 표시를 만든다', () => {
    const v = buildVoid('잘못 적었음', '2026-11-17T00:00:00Z');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.patch).toEqual({
      voided_at: '2026-11-17T00:00:00Z', void_reason: '잘못 적었음',
    });
  });

  it('취소 여부 판정', () => {
    expect(isVoided({ voided_at: '2026-11-17T00:00:00Z' })).toBe(true);
    expect(isVoided({})).toBe(false);
  });
});

// ══════════════════════ 쓸 수 있는 사실 ══════════════════════
describe('쓸 수 있는 사실', () => {
  const F = (id: string, status: string, label = id): OutreachFact =>
    ({ id, fact_key: id, label_ko: label, status });
  const facts = [F('a', 'confirmed', '보드게임'), F('b', 'pending', '구독 가격'), F('c', 'retired', '옛 사실')];

  it('상태 세 가지', () => {
    expect([...FACT_STATUSES]).toEqual(['confirmed', 'pending', 'retired']);
    expect(FACT_STATUS_LABEL.confirmed).toBe('확정');
    expect(FACT_STATUS_LABEL.pending).toBe('미정');
  });

  it('확정만 쓸 수 있다', () => {
    const r = validateFactSelection(['a', 'b', 'c'], facts);
    expect(r.usable).toEqual(['a']);
    expect(r.rejected.map(x => x.id)).toEqual(['b', 'c']);
  });

  it('미정을 고르면 **조용히 버리지 않고** 무엇이 왜 빠졌는지 알려 준다', () => {
    const r = validateFactSelection(['b'], facts);
    expect(r.rejected[0].label).toBe('구독 가격');
    expect(r.rejected[0].reason).toContain(PENDING_PLACEHOLDER);
  });

  it('없는 사실도 알려 준다', () => {
    const r = validateFactSelection(['zzz'], facts);
    expect(r.rejected[0].reason).toContain('찾을 수 없');
  });

  it('확정 판정', () => {
    expect(isConfirmed({ status: 'confirmed' })).toBe(true);
    expect(isConfirmed({ status: 'pending' })).toBe(false);
  });

  it('상태 변경 로그 문장', () => {
    expect(factStatusLogLine('pending', 'confirmed')).toBe('미정 → 확정');
    expect(factStatusLogLine('pending', 'confirmed', '가격 확정됨')).toBe('미정 → 확정 · 가격 확정됨');
    expect(factStatusLogLine(null, 'pending')).toBe('(없음) → 미정');
  });

  it('결과 종류', () => {
    expect([...OUTCOMES]).toEqual([
      'no_reply', 'replied', 'bounced', 'meeting', 'trial_started', 'declined', 'other']);
    expect(OUTCOME_LABEL.replied).toBe('답장 받음');
  });
});

// ══════════════════════ 접근 전략 ══════════════════════
describe('현재 전략 = 가장 큰 version', () => {
  const S = (v: number, extra: Partial<Strategy> = {}): Strategy =>
    ({ id: `s${v}`, lead_id: 'L1', version: v, ...extra });

  it('버전이 가장 큰 것을 고른다', () => {
    expect(currentStrategy([S(1), S(3), S(2)])?.version).toBe(3);
  });

  it('**날짜로 고르지 않는다** (같은 날 두 판을 쓰면 순서가 흔들린다)', () => {
    const list = [
      S(1, { created_at: '2026-11-17T10:00:00Z' }),
      S(2, { created_at: '2026-11-17T09:00:00Z' }),   // 더 먼저 만들어졌지만 2판
    ];
    expect(currentStrategy(list)?.version).toBe(2);
  });

  it('없으면 null, 다음 버전은 1', () => {
    expect(currentStrategy([])).toBeNull();
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([S(1), S(2)])).toBe(3);
  });

  it('fact_ids 는 문자열 배열만 받아들인다 (jsonb 라 무엇이든 올 수 있다)', () => {
    expect(factIdsOf(['a', 'b'])).toEqual(['a', 'b']);
    expect(factIdsOf(['a', 1, null, '', 'b'])).toEqual(['a', 'b']);
    expect(factIdsOf('a')).toEqual([]);
    expect(factIdsOf(null)).toEqual([]);
  });
});

describe('새 판 초안', () => {
  const cur: Strategy = {
    id: 's1', lead_id: 'L1', version: 1,
    goal: '데모 약속', angle: 'LMS 연동 관심', key_points: 'a\nb',
    fact_ids: ['f1'], avoid_text: '가격 약속 금지',
    next_contact_plan: '메일 · 3일 뒤', rationale: '처음이라 가볍게',
  };

  it('이전 판 내용을 미리 채운다', () => {
    const d = draftNextVersion([cur]);
    expect(d.version).toBe(2);
    expect(d.goal).toBe('데모 약속');
    expect(d.angle).toBe('LMS 연동 관심');
    expect(d.keyPoints).toBe('a\nb');
    expect(d.factIds).toEqual(['f1']);
    expect(d.avoidText).toBe('가격 약속 금지');
    expect(d.nextContactPlan).toBe('메일 · 3일 뒤');
  });

  it('**근거만 비운다** (이전 근거를 남기면 "무엇을 왜 바꿨나"가 거짓이 된다)', () => {
    expect(draftNextVersion([cur]).rationale).toBe('');
  });

  it('근거가 된 접촉을 이어 붙인다', () => {
    expect(draftNextVersion([cur], 'act-9').basedOnActivityId).toBe('act-9');
  });

  it('첫 판은 빈 초안 v1 이다', () => {
    const d = draftNextVersion([]);
    expect(d.version).toBe(1);
    expect(d.goal).toBe('');
  });
});

describe('전략 저장', () => {
  const facts: OutreachFact[] = [
    { id: 'f1', fact_key: 'a', label_ko: '보드게임', status: 'confirmed' },
    { id: 'f2', fact_key: 'b', label_ko: '구독 가격', status: 'pending' },
  ];
  const base = {
    version: 1, goal: '데모 약속', angle: '', keyPoints: '', factIds: [] as string[],
    avoidText: '', nextContactPlan: '', rationale: '', basedOnActivityId: null,
  };

  it('목표만 있으면 1판이 저장된다', () => {
    const v = buildStrategy('L1', base, facts);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.version).toBe(1);
      expect(v.row.fact_ids).toEqual([]);
      expect(v.row.angle).toBeNull();
    }
  });

  it('목표가 없으면 막는다', () => {
    expect(buildStrategy('L1', { ...base, goal: '  ' }, facts).ok).toBe(false);
  });

  it('**2판 이상은 근거를 요구한다** (왜 바꿨는지가 이력의 핵심)', () => {
    expect(buildStrategy('L1', { ...base, version: 2 }, facts).ok).toBe(false);
    expect(buildStrategy('L1', { ...base, version: 2, rationale: '답장 내용 반영' }, facts).ok).toBe(true);
  });

  it('미정 사실을 고르면 막는다', () => {
    const v = buildStrategy('L1', { ...base, factIds: ['f2'] }, facts);
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.error).toContain('구독 가격');
  });

  it('확정 사실만 저장된다', () => {
    const v = buildStrategy('L1', { ...base, factIds: ['f1'] }, facts);
    expect(v.ok && v.row.fact_ids).toEqual(['f1']);
  });

  it('리드가 없으면 막는다', () => {
    expect(buildStrategy('', base, facts).ok).toBe(false);
  });
});

// ══════════════════════ n차 접촉 ══════════════════════
describe('n차 접촉 — 보낸 접촉만 센다', () => {
  const A = (id: string, o: Partial<Record<string, unknown>> = {}) =>
    ({ id, direction: 'out', summary: '메일 보냄', occurred_at: `2026-11-${id.padStart(2, '0')}T00:00:00Z`, ...o });

  it('**시스템 변경 기록은 세지 않는다** (국가 한 번 고친 것이 2차가 되면 안 된다)', () => {
    expect(isOutreach(A('01', { summary: '[변경] 국가: (비어 있음) → SG' }))).toBe(false);
    expect(isOutreach(A('02', { summary: '[보관] 보관함: 시험 리드' }))).toBe(false);
    expect(isOutreach(A('03'))).toBe(true);
  });

  it('받은 기록은 세지 않는다', () => {
    expect(isOutreach(A('04', { direction: 'in', summary: '답장 받음' }))).toBe(false);
  });

  it('취소된 기록은 세지 않는다', () => {
    expect(isOutreach(A('05', { voided_at: '2026-11-17T00:00:00Z' }))).toBe(false);
  });

  it('다음 차수', () => {
    expect(nextAttemptNo([])).toBe(1);
    expect(nextAttemptNo([A('01'), A('02')])).toBe(3);
    expect(nextAttemptNo([
      A('01'),
      A('02', { summary: '[변경] 이름: A → B' }),
      A('03', { direction: 'in' }),
    ])).toBe(2);
  });

  it('타임라인 차수는 **시간순으로 다시 매긴다** (구멍이 생기지 않게)', () => {
    const m = attemptNumbers([
      A('05'),
      A('01'),
      A('03', { voided_at: 'x' }),   // 취소 — 빠진다
      A('09'),
    ]);
    expect(m.get('01')).toBe(1);
    expect(m.get('05')).toBe(2);
    expect(m.get('09')).toBe(3);
    expect(m.has('03')).toBe(false);
  });
});

describe('전략 수정 유도', () => {
  const A = (id: string, outcome: string | null, day: string) =>
    ({ id, direction: 'out', summary: '메일 보냄', outcome, occurred_at: `2026-11-${day}T00:00:00Z` });

  it('전략을 고칠 만한 결과를 가린다', () => {
    for (const o of ['replied', 'meeting', 'trial_started', 'declined', 'bounced']) {
      expect(suggestsRevision(o), o).toBe(true);
    }
    for (const o of ['no_reply', 'other', null, undefined]) {
      expect(suggestsRevision(o), String(o)).toBe(false);
    }
  });

  it('결과가 적힌 최근 접촉을 돌려준다', () => {
    const r = pendingRevision([A('a', 'replied', '10'), A('b', 'meeting', '15')], []);
    expect(r?.id).toBe('b');
  });

  it('이미 그 접촉을 근거로 쓴 판이 있으면 더 묻지 않는다', () => {
    const acts = [A('a', 'replied', '10')];
    const strat: Strategy[] = [{ id: 's2', lead_id: 'L1', version: 2, based_on_activity_id: 'a' }];
    expect(pendingRevision(acts, strat)).toBeNull();
  });

  it('결과가 없거나 답 없음이면 묻지 않는다', () => {
    expect(pendingRevision([A('a', null, '10')], [])).toBeNull();
    expect(pendingRevision([A('a', 'no_reply', '10')], [])).toBeNull();
  });

  it('**자동으로 전략을 바꾸지 않는다** — 묻기만 한다(함수가 전략을 만들지 않음)', () => {
    const r = pendingRevision([A('a', 'replied', '10')], []);
    expect(r).not.toBeNull();
    // 돌려주는 것은 접촉 기록 1건뿐이다(새 전략 행이 아니다)
    expect(r && 'version' in r).toBe(false);
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 추가만, 원장 보호, 보안', () => {
  const M = (f: string) => sqlCode(read(`supabase/migrations/${f}`));
  const SR = M('20261126000000_lead_s1_signals_research.sql');
  const ST = M('20261126001000_lead_s1_strategies.sql');
  const OF = M('20261126002000_lead_s1_outreach_facts.sql');
  const SD = M('20261126003000_lead_s1_segment_detail.sql');
  const ALL = [SR, ST, OF, SD];
  const NEW_TABLES = ['lead_signals', 'lead_research_notes', 'lead_strategies',
                      'outreach_facts', 'outreach_fact_log'];

  it('기존 데이터를 바꾸거나 지우지 않는다', () => {
    for (const m of ALL) {
      expect(m).not.toMatch(/drop\s+column/i);
      expect(m).not.toMatch(/\b(delete\s+from|truncate|update\s+public\.)/i);
      expect(m).not.toMatch(/set\s+not\s+null/i);
    }
  });

  it('새 표 다섯 개에 RLS 를 켠다', () => {
    const joined = ALL.join('\n');
    for (const t of NEW_TABLES) {
      expect(joined, t).toMatch(new RegExp(`alter table public\\.${t} +enable row level security`, 'i'));
    }
  });

  it('admin 전용 정책만 두고 anon 정책이 없다', () => {
    const joined = ALL.join('\n');
    expect((joined.match(/public\.app_is_admin\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(joined).not.toMatch(/to anon/);
  });

  it('anon·public 권한을 명시적으로 회수한다', () => {
    const joined = ALL.join('\n');
    for (const t of NEW_TABLES) {
      expect(joined, t).toMatch(new RegExp(`revoke all on public\\.${t} +from anon`, 'i'));
      expect(joined, t).toMatch(new RegExp(`revoke all on public\\.${t} +from public`, 'i'));
    }
  });

  it('anon 에 GRANT 를 주지 않는다', () => {
    for (const m of ALL) {
      for (const g of m.match(/grant[^;]*;/gi) ?? []) expect(g, g).not.toMatch(/\banon\b/);
    }
  });

  it('새 표는 전부 **삭제 불가**다 (원장)', () => {
    const joined = ALL.join('\n');
    for (const t of NEW_TABLES) {
      expect(joined, t).toMatch(new RegExp(`"${t}_no_delete"[\\s\\S]{0,160}as restrictive for delete`, 'i'));
    }
    // authenticated 에 DELETE 권한을 주지 않는다
    for (const m of ALL) {
      for (const g of m.match(/grant ([^;]*) on public\.(\w+) to authenticated/gi) ?? []) {
        expect(g.toLowerCase(), g).not.toContain('delete');
        expect(g.toLowerCase(), g).not.toContain('all');
      }
    }
  });

  it('전략은 **쌓기만** 한다 — UPDATE 도 막고 권한도 주지 않는다', () => {
    expect(ST).toMatch(/"lead_strategies_no_update"[\s\S]{0,160}as restrictive for update/i);
    const g = (ST.match(/grant ([^;]*) on public\.lead_strategies to authenticated/i) ?? [])[1] ?? '';
    expect(g.toLowerCase()).not.toContain('update');
    expect(g.toLowerCase()).not.toContain('delete');
  });

  it('변경 로그도 쌓기만 한다', () => {
    expect(OF).toMatch(/"outreach_fact_log_no_update"[\s\S]{0,160}as restrictive for update/i);
  });

  it('새 외래키는 on delete restrict 다 (이력 보호)', () => {
    const joined = ALL.join('\n');
    const leadFks = joined.match(/references public\.campaign_leads\(id\)[^,\n]*/gi) ?? [];
    expect(leadFks.length).toBeGreaterThanOrEqual(3);
    for (const f of leadFks) expect(f, f).toMatch(/on delete restrict/i);
    expect(joined).toMatch(/references public\.lead_strategies\(id\) on delete restrict/i);
    expect(joined).toMatch(/references public\.outreach_facts\(id\) on delete restrict/i);
  });

  it('기존 lead_activities 의 cascade 는 건드리지 않는다', () => {
    const joined = ALL.join('\n');
    // lead_activities 를 가리키는 FK 하나만 있고, 그것은 set null 이다(이유는 주석에 적혀 있다)
    const fks = joined.match(/references public\.lead_activities\(id\)[^,\n)]*/gi) ?? [];
    expect(fks).toHaveLength(1);
    expect(fks[0]).toMatch(/on delete set null/i);
    expect(joined).not.toMatch(/alter table public\.lead_activities[\s\S]{0,200}drop constraint [^;]*lead_id/i);
  });

  it('전략 버전이 리드마다 유일하다 ("현재=최대" 가 흔들리면 안 된다)', () => {
    expect(ST).toMatch(/unique index[\s\S]{0,120}\(lead_id, version\)/i);
  });

  it('lead_activities 에 네 칸을 더한다', () => {
    for (const c of ['attempt_no', 'strategy_id', 'outcome', 'learning']) {
      expect(ST, c).toContain(`add column if not exists ${c}`);
    }
  });

  it('결과 CHECK 는 값이 있을 때만 검사한다', () => {
    expect(ST).toMatch(/outcome is null or outcome in/i);
  });

  it('segment_detail 은 CHECK 없이 더한다 (등급 표기가 행사마다 늘어난다)', () => {
    expect(SD).toContain('add column if not exists segment_detail text');
    expect(SD).not.toMatch(/segment_detail[^;]*check/i);
  });

  it('여러 번 돌려도 같은 결과다', () => {
    for (const m of ALL) {
      const adds = m.match(/add column/gi) ?? [];
      expect((m.match(/add column if not exists/gi) ?? []).length).toBe(adds.length);
      const creates = m.match(/create table/gi) ?? [];
      expect((m.match(/create table if not exists/gi) ?? []).length).toBe(creates.length);
    }
  });

  it('롤백·드라이런이 넷 다 있고 드라이런은 아무것도 남기지 않는다', () => {
    for (const u of ['signals_research', 'strategies', 'outreach_facts', 'segment_detail']) {
      expect(fs.existsSync(path.resolve(process.cwd(), `../audit/rollback_lead_s1_${u}.sql`)), u).toBe(true);
      const D = sqlCode(read(`../audit/dryrun_lead_s1_${u}.sql`));
      expect(D, u).toMatch(/^\s*begin;/m);
      expect(D.trimEnd().endsWith('rollback;'), u).toBe(true);
      expect(D, u).not.toMatch(/\bcommit\b/i);
    }
  });

  it('롤백은 원장을 함부로 지우지 않는다 (DROP TABLE 은 주석으로만)', () => {
    for (const u of ['signals_research', 'strategies', 'outreach_facts']) {
      const R = read(`../audit/rollback_lead_s1_${u}.sql`);
      expect(sqlCode(R), u).not.toMatch(/drop table/i);
      expect(R, u).toMatch(/건수를 먼저 확인/);
    }
  });
});

describe('시드 — 쓸 수 있는 사실 5건', () => {
  const S = read('../audit/seed_outreach_facts.sql');

  it('마이그레이션이 아니다', () => {
    expect(fs.existsSync(path.resolve(process.cwd(),
      'supabase/migrations/seed_outreach_facts.sql'))).toBe(false);
    expect(S).toContain('마이그레이션이 아니다');
  });

  it('요구한 5건이 있다', () => {
    for (const k of ['board_game_sale', 'lms_edlink', 'lang_id_ms_beta',
                     'pricing_subscription', 'pilot_terms']) {
      expect(S, k).toContain(`'${k}'`);
    }
  });

  it('확정 3건 · 미정 2건이다', () => {
    expect((S.match(/'confirmed'/g) ?? []).length).toBe(3);
    expect((S.match(/'pending'/g) ?? []).length).toBe(2);
  });

  it('출처가 전부 James 2026-11-17 이다', () => {
    expect((S.match(/'James 2026-11-17'/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('**확정 사실에도 주의(caveat)가 있다** — 넘지 말아야 할 선', () => {
    expect(S).toMatch(/재고와 배송은 미정/);          // 보드게임
    expect(S).toMatch(/"준비 중"과 .*까지만/);         // EdLink
    expect(S).toMatch(/반드시 "베타"라고/);            // 언어
  });

  it('미정 사실에는 영문·국문 문장을 넣지 않는다 (숫자를 쓰게 되면 안 된다)', () => {
    const pricing = S.slice(S.indexOf("'pricing_subscription'"), S.indexOf("'pilot_terms'"));
    expect(pricing).toMatch(/null,\s*\n\s*null,/);
  });

  it('여러 번 돌려도 안전하다', () => {
    expect(S).toMatch(/on conflict \(fact_key\) do nothing/i);
    expect(S).toMatch(/not exists \(select 1 from public\.outreach_fact_log/i);
  });
});
