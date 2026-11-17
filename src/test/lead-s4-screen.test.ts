// LEAD-S4 화면 — 리드 유형 · 행사별 깔때기
//
// 지켜야 하는 약속
//   ① 새 코드는 authedFetch 만 쓴다. 깔때기는 **DB 를 더 부르지 않는다**.
//   ② 유형이 바뀌면 활동 기록에 `[변경]` 줄이 남는다.
//   ③ 유형을 바꿔 단계가 안 맞으면 **알려만** 준다(값을 지우지 않는다).
//   ④ 분모·분자의 뜻을 화면 하단에 보여 준다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TRACKED_FIELDS, displayValue } from '../lib/leadEdit';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const NEW_FILES = [
  'src/lib/leadType.ts', 'src/lib/leadFunnel.ts',
  'src/pages/LeadFunnel.tsx', 'src/components/leads/Emphasis.tsx',
];

describe('보안 — 로그인 토큰만, DB 를 더 부르지 않는다', () => {
  it('새 파일이 DB 를 직접 부르지 않는다', () => {
    for (const f of NEW_FILES) {
      expect(code(read(f)), f).not.toContain('rest/v1');
      expect(code(read(f)), f).not.toMatch(/\bfetch\(/);
    }
  });

  it('깔때기는 **이미 받아 둔 목록**을 쓴다 (리드마다 조회하지 않는다)', () => {
    const p = read('src/pages/LeadFunnel.tsx');
    // 쓰는 쿼리는 목록·캠페인 이름 둘뿐이다
    const qs = p.match(/useQuery\(\{[\s\S]{0,120}?queryFn: (\w+)/g) ?? [];
    expect(qs).toHaveLength(2);
    expect(p).toContain('queryFn: getLeads');
    expect(p).toContain('queryFn: getCampaignNames');
    expect(p).toContain('funnelsByEvent');
  });

  it('계산이 순수 함수에 있다 (화면에서 세지 않는다)', () => {
    const p = code(read('src/pages/LeadFunnel.tsx'));
    // 화면에서 단계를 직접 세는 코드가 없다
    expect(p).not.toMatch(/\.filter\([^)]*followup_stage/);
  });
});

describe('CRM-015 · 리드 유형', () => {
  const d = read('src/components/leads/LeadDetail.tsx');

  it('상세에서 유형을 고를 수 있다', () => {
    expect(d).toContain('리드 유형');
    expect(d).toContain("set('lead_type'");
    expect(d).toContain('LEAD_TYPES.map');
  });

  it('단계 목록이 **유형에 맞게** 바뀐다 (기본 정보와 빠른 기록 둘 다)', () => {
    expect(d).toContain('stagesFor(form.lead_type)');
    expect(d).toContain('stagesFor(lead.lead_type)');
    // 전처럼 고정 목록을 쓰는 곳이 남아 있으면 두 자리가 어긋난다
    expect(d).not.toMatch(/options=\{FOLLOWUP_STAGES\.map/);
  });

  it('유형이 바뀌면 활동 기록에 남는다', () => {
    expect([...TRACKED_FIELDS]).toContain('lead_type');
  });

  it('변경 기록에 **한글 이름**으로 적는다 (코드가 아니다)', () => {
    expect(displayValue('lead_type', 'sales')).toBe('세일즈 파트너');
    expect(displayValue('lead_type', null)).toBe('(비어 있음)');
  });

  it('유형별 힌트와 기본 다음 행동을 보여 준다 — **제안일 뿐**', () => {
    expect(d).toContain('LEAD_TYPE_HINT');
    expect(d).toContain('기본 다음 행동 제안');
    // 자동으로 넣지 않는다
    expect(code(d)).not.toMatch(/set\('next_action', defaultNextAction/);
  });

  it('단계가 유형과 안 맞으면 **알려만** 준다', () => {
    expect(d).toContain('isStageForeign');
    expect(d).toContain('이 유형의 단계가 아닙니다');
    expect(d).toContain('값은 그대로 둡니다');
  });

  it('보조 태그를 고를 수 있다 (한 사람이 고객이면서 연구 파트너)', () => {
    expect(d).toContain('보조 태그');
    expect(d).toContain('TAG_SUGGESTIONS.map');
    expect(d).toContain('toggleTag');
  });

  it('태그는 변경 기록 대상이 아니다 (단계 목록을 바꾸지 않는다)', () => {
    expect([...TRACKED_FIELDS]).not.toContain('lead_tags');
    expect(d).toContain('태그는 변경 기록 대상이 아니다');
  });

  it('파트너 전환은 **안내만** 한다', () => {
    expect(d).toContain('isReadyForPartnerConversion');
    expect(d).toContain('PARTNER_CONVERSION_HINT');
    expect(code(d)).not.toMatch(/convertToPartner|rest\/v1\/partners/);
  });

  it('목록에 유형이 보이고 필터가 있다', () => {
    const p = read('src/pages/Leads.tsx');
    expect(p).toContain('leadTypeLabel(l.lead_type)');
    expect(p).toContain('label="유형"');
    expect(p).toContain("if (fType === 'none' && toLeadType(l.lead_type)) return false;");
  });
});

describe('CRM-018 · 행사별 깔때기 화면', () => {
  const p = read('src/pages/LeadFunnel.tsx');

  it('/leads/funnel 이 로그인 뒤에 있다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/leads/funnel"');
    const at = app.indexOf('path="/leads/funnel"');
    expect(app.slice(at, at + 300)).toContain('RequireAuth');
    expect(app.slice(at, at + 300)).toContain('<LeadFunnel />');
  });

  it('요구한 것이 다 있다 — 단계별 인원·전환·체류일·발송 가능·국가 분포', () => {
    expect(p).toContain('단계별 인원과 평균 체류일');
    expect(p).toContain('전환');
    expect(p).toContain('메일 발송 가능');
    expect(p).toContain('국가');
    expect(p).toContain('지역');
  });

  it('**분모·분자의 뜻을 화면 하단에** 보여 준다', () => {
    expect(p).toContain('FUNNEL_BASIS');
    // import 줄이 아니라 **쓰는 자리**를 본다(lastIndexOf). 그 자리가 목록 뒤여야 하단이다.
    expect(p.lastIndexOf('FUNNEL_BASIS')).toBeGreaterThan(p.lastIndexOf('funnels.map'));
  });

  it('필터 네 가지(시장·국가·유형·담당자)', () => {
    for (const l of ['시장', '국가', '유형', '담당자']) {
      expect(p, l).toContain(`label="${l}"`);
    }
  });

  it('성사와 종료·보류를 **따로** 보여 준다', () => {
    expect(p).toContain('성사 <strong');
    expect(p).toContain('종료·보류 <strong');
  });

  it('단계 전환율과 전체 전환율을 구분해 보여 준다', () => {
    expect(p).toContain('pct(s.stepRate)');
    expect(p).toContain('pct(s.overallRate)');
    expect(p).toContain("title={i === 0 ? '전체 대비' : '앞 단계 대비'}");
  });

  it('리드 화면에서 갈 수 있다', () => {
    expect(read('src/pages/Leads.tsx')).toContain('to="/leads/funnel"');
  });
});

describe('기존 것을 건드리지 않았다', () => {
  it('공개 폼이 그대로다', () => {
    const f = read('src/pages/CampaignForm.tsx');
    for (const n of ['leadType', 'lead_type', 'leadFunnel']) expect(f, n).not.toContain(n);
  });

  it('공개 폼 서버 함수가 그대로다', () => {
    const f = read('supabase/functions/campaign-submit-lead/index.ts');
    for (const n of ['lead_type', 'lead_tags']) expect(f, n).not.toContain(n);
  });

  it('캠페인 화면이 그대로다', () => {
    const c = read('src/pages/Campaigns.tsx');
    for (const n of ['leadType', 'leadFunnel', 'LeadFunnel']) expect(c, n).not.toContain(n);
  });

  it('기존 단계 목록(FOLLOWUP_STAGES)을 바꾸지 않았다', () => {
    const f = read('src/lib/leadFollowup.ts');
    expect(f).toContain("'신규', '연락 대기', '1차 연락함', '응답 받음', '미팅·데모',");
    expect(f).toContain("'체험 중', '협상', '성사', '보류', '종료',");
  });
});
