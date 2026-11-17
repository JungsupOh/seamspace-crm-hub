// LEAD-S1 화면 — 보안 정적 검사와 요구사항 반영 (S1-3)
//
// 지켜야 하는 약속
//   ① 새 코드는 authedFetch 만 쓴다(공개 키로 rest/v1 직접 호출 금지).
//   ② **새 표에 "삭제" 호출이 없다**(원장). 되돌리기는 취소 표시뿐.
//   ③ 전략은 쌓기만 한다 — 화면에도 수정·삭제 길이 없다.
//   ④ 미정 사실은 고를 수 없고 "확인 후 안내"로만 안내한다.
//   ⑤ 전략을 자동으로 바꾸지 않는다(묻기만).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const NEW_FILES = [
  'src/lib/leadStrategy.ts',
  'src/components/leads/SignalsPanel.tsx',
  'src/components/leads/ResearchPanel.tsx',
  'src/components/leads/StrategyPanel.tsx',
  'src/pages/LeadFacts.tsx',
];
const NEW_TABLES = ['lead_signals', 'lead_research_notes', 'lead_strategies',
                    'outreach_facts', 'outreach_fact_log'];

describe('보안 — 로그인 토큰만', () => {
  it('DB 호출은 leadsApi.ts 에서만 한다', () => {
    for (const f of NEW_FILES) expect(code(read(f)), f).not.toContain('rest/v1');
  });

  it('새 화면이 직접 fetch 하지 않는다', () => {
    for (const f of NEW_FILES) expect(code(read(f)), f).not.toMatch(/\bfetch\(/);
  });

  it('leadsApi 는 authedFetch 만 쓴다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    expect(api).not.toMatch(/(?<!authed)\bfetch\(/);
    expect(api).not.toMatch(/Authorization/);
  });

  it('새 표를 읽을 때 select=* 를 쓰지 않는다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    for (const t of NEW_TABLES) {
      const at = api.indexOf(`rest/v1/${t}?`);
      if (at < 0) continue;
      expect(api.slice(at, at + 300), t).not.toContain('select=*');
    }
  });
});

describe('새 표는 원장 — "삭제" 호출이 없다', () => {
  const api = code(read('src/lib/leadsApi.ts'));

  it('다섯 표 어디에도 DELETE 를 보내지 않는다', () => {
    for (const t of NEW_TABLES) {
      // `rest/v1/<표>` 가 나오는 자리마다 그 요청이 DELETE 가 아닌지 본다
      const re = new RegExp(`rest/v1/${t}[\\s\\S]{0,400}?method: '(\\w+)'`, 'g');
      for (const m of api.matchAll(re)) {
        expect(m[1], `${t} → ${m[1]}`).not.toBe('DELETE');
      }
    }
  });

  it('DELETE 는 전과 같이 두 곳뿐이다 (가져오기 취소 · CC 해제)', () => {
    const dels = api.match(/method: 'DELETE'/g) ?? [];
    expect(dels.length).toBe(2);
    expect(api).toContain('import_batch_id=eq.');
    expect(api).toContain('lead_cc_links?lead_id=eq.');
  });

  it('되돌리기는 취소 표시(voided_at)뿐이다', () => {
    expect(api).toContain('voidRow');
    expect(api).toContain('voidSignal');
    expect(api).toContain('voidResearchNote');
  });

  it('화면이 "지워지지 않습니다"를 알려 준다', () => {
    expect(read('src/components/leads/SignalsPanel.tsx')).toContain('지워지지 않습니다');
    expect(read('src/components/leads/ResearchPanel.tsx')).toContain('지워지지 않습니다');
    expect(read('src/pages/LeadFacts.tsx')).toContain('지워지지 않습니다');
  });

  it('취소에는 사유를 묻는다', () => {
    for (const f of ['SignalsPanel', 'ResearchPanel']) {
      expect(read(`src/components/leads/${f}.tsx`), f).toContain('취소 사유');
    }
  });
});

describe('전략은 쌓기만 한다', () => {
  const api = code(read('src/lib/leadsApi.ts'));
  const panel = code(read('src/components/leads/StrategyPanel.tsx'));

  it('API 에 전략 수정·삭제 함수가 없다', () => {
    expect(api).not.toMatch(/lead_strategies[\s\S]{0,300}?method: 'PATCH'/);
    expect(api).not.toMatch(/lead_strategies[\s\S]{0,300}?method: 'DELETE'/);
    expect(api).toContain('addStrategy');
  });

  it('화면에 전략 수정·삭제 버튼이 없다', () => {
    expect(panel).not.toMatch(/전략 삭제|전략 수정|updateStrategy|deleteStrategy/);
  });

  it('새 버전은 이전 판을 미리 채운다', () => {
    expect(panel).toContain('draftNextVersion');
  });

  it('이전 판이 지워지지 않는다고 알려 준다', () => {
    expect(read('src/components/leads/StrategyPanel.tsx')).toContain('이전 판은 지워지지 않습니다');
  });

  it('동시에 쓰면 조용히 덮어쓰지 않고 안내한다', () => {
    expect(api).toContain('다시 불러와 주세요');
  });
});

describe('S1-2 · 쓸 수 있는 사실', () => {
  const panel = read('src/components/leads/StrategyPanel.tsx');

  it('확정만 고를 수 있다', () => {
    // 이름만 보면 filter 가 빠져도 통과한다 — 거르는 식을 본다
    expect(panel).toMatch(/confirmedFacts\s*=\s*useMemo\([\s\S]{0,120}?filter\(isConfirmed\)/);
    expect(panel).toContain('확정만 고를 수 있습니다');
  });

  it('미정은 "확인 후 안내"로만 안내한다', () => {
    expect(panel).toContain('PENDING_PLACEHOLDER');
    expect(panel).toContain('pendingFacts');
  });

  it('주의(caveat)를 툴팁으로 보여 준다 — 확정에도 넘지 말 선이 있다', () => {
    expect(panel).toContain('f.caveat');
    expect(panel).toContain('⚠️');
  });
});

describe('S1-2 · n차 접촉과 결과', () => {
  const d = read('src/components/leads/LeadDetail.tsx');

  // ⚠️ 정적 검사는 **문자열 존재**만 보므로, 이름이 import 에 남아 있으면 로직이
  //    빠져도 통과한다. 그래서 **실제 호출 표현식**을 본다(변이 시험에서 발견).
  it('차수는 시간순으로 다시 센 값을 쓴다', () => {
    expect(d).toMatch(/attemptMap\s*=\s*useMemo\(\(\)\s*=>\s*attemptNumbers\(acts/);
    expect(d).toContain('attemptMap.get(a.id)');
  });

  it('보낸 접촉에만 차수·전략을 붙인다', () => {
    expect(d).toContain("attemptNo: log.direction === 'out' ? nextAttemptNo");
    expect(d).toContain("strategyId: log.direction === 'out' ? curStrategy?.id ?? null : null");
  });

  it('빠른 기록에 결과·알게 된 점이 있다', () => {
    expect(d).toContain('>결과<');
    expect(d).toContain('알게 된 점');
  });

  it('몇 차로 기록될지 미리 알려 준다', () => {
    expect(d).toContain('차 접촉으로 기록됩니다');
  });

  it('타임라인에 결과·전략 버전·알게 된 점을 보여 준다', () => {
    expect(d).toContain('OUTCOME_LABEL[a.outcome as Outcome]');
    expect(d).toContain('전략 v{stratV}');
  });
});

describe('S1-2 · 전략 수정 유도 — 묻기만 한다', () => {
  const d = read('src/components/leads/LeadDetail.tsx');

  it('결과가 기록되면 안내를 띄운다', () => {
    expect(d).toContain('결과가 기록됐습니다');
    expect(d).toContain('전략을 고칠까요?');
    expect(d).toContain('pendingRevision');
  });

  it('**자동으로 바꾸지 않는다** — 사람이 눌러야 새 판이 시작된다', () => {
    expect(d).toContain('setReviseFrom(revisionHint.id');
    // 안내 안에서 전략을 저장하는 코드가 없다
    const at = d.indexOf('결과가 기록됐습니다');
    const seg = d.slice(at - 400, at + 800);
    expect(seg).not.toMatch(/addStrategy|buildStrategy/);
  });

  it('그 접촉을 근거로 잇는다', () => {
    expect(d).toContain('reviseFrom={reviseFrom}');
  });
});

describe('S1-2 · 목록과 필터', () => {
  const page = read('src/pages/Leads.tsx');

  it('현재 전략 vN 과 다음 접촉 계획을 작게 보여 준다', () => {
    expect(page).toContain('strategyByLead');
    expect(page).toContain('next_contact_plan');
  });

  it('리드마다 따로 부르지 않고 한 번에 읽는다', () => {
    expect(page).toContain('getStrategyHeads');
    expect(page).toContain('리드 270건에 각각 조회하면 화면이 멈춘다');
  });

  it('"전략 없음" 필터가 있고 **실제로 거른다**', () => {
    expect(page).toContain("['none', '전략 없음']");
    // 고르기만 하고 거르지 않으면 쓸모가 없다 — 거르는 줄을 본다
    expect(page).toContain("if (fStrategy === 'none' && strategyByLead.has(l.id)) return false;");
    expect(page).toContain("if (fStrategy === 'has' && !strategyByLead.has(l.id)) return false;");
  });

  it('세그먼트 상세를 목록에 보여 준다', () => {
    expect(page).toContain('l.segment_detail');
  });
});

describe('S1-4 · 세그먼트 상세', () => {
  it('상세에서 편집할 수 있다', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    expect(d).toContain('세그먼트 상세');
    expect(d).toContain("set('segment_detail'");
  });

  it('값을 코드가 채우지 않는다 (제시카가 SQL 로 채운다 — 요구 S1-4)', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    const imp = code(read('src/lib/intlLeadImport.ts'));
    // 가져오기가 segment_detail 을 쓰지 않는다
    expect(imp).not.toContain('segment_detail');
    // buildLeadRow 도 넣지 않는다
    const at = api.indexOf('export function buildLeadRow');
    expect(api.slice(at, at + 900)).not.toContain('segment_detail');
  });
});

describe('사실 보드 화면', () => {
  it('/leads/facts 라우트가 로그인 뒤에 있다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/leads/facts"');
    const at = app.indexOf('path="/leads/facts"');
    const seg = app.slice(at, at + 300);
    expect(seg).toContain('RequireAuth');
    expect(seg).toContain('<LeadFacts />');
  });

  it('리드 화면에서 갈 수 있다', () => {
    expect(read('src/pages/Leads.tsx')).toContain('to="/leads/facts"');
  });

  it('상태 변경에 이유를 묻고 로그를 보여 준다', () => {
    const f = read('src/pages/LeadFacts.tsx');
    expect(f).toContain('바꾸는 이유');
    expect(f).toContain('변경 로그');
    expect(f).toContain('factStatusLogLine');
  });

  it('주의(caveat)를 눈에 띄게 보여 준다', () => {
    const f = read('src/pages/LeadFacts.tsx');
    expect(f).toContain('fact.caveat');
    expect(f).toContain('말하면 안 되는 범위');
  });
});

describe('기존 것을 건드리지 않았다', () => {
  it('공개 폼이 그대로다', () => {
    const f = read('src/pages/CampaignForm.tsx');
    for (const n of ['leadStrategy', 'lead_signals', 'lead_strategies', 'outreach_facts']) {
      expect(f, n).not.toContain(n);
    }
  });

  it('공개 폼 서버 함수가 그대로다', () => {
    const f = read('supabase/functions/campaign-submit-lead/index.ts');
    for (const n of ['attempt_no', 'strategy_id', 'lead_signals', 'segment_detail']) {
      expect(f, n).not.toContain(n);
    }
  });

  it('캠페인 화면이 그대로다', () => {
    const c = read('src/pages/Campaigns.tsx');
    for (const n of ['leadStrategy', 'leadsApi', 'StrategyPanel']) {
      expect(c, n).not.toContain(n);
    }
  });
});
