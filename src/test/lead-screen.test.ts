// 리드 관리 화면 — 보안 규칙과 화면 연결 (LEAD-3·4·5·6)
//
// 지켜야 하는 약속
//   ① 새 코드는 **로그인 토큰**(authedFetch)만 쓴다. 공개 키로 rest/v1 을 직접 부르지 않는다.
//   ② 활동 기록을 지우는 UI 가 없다(원장).
//   ③ 기존 국내 화면·공개 폼을 건드리지 않았다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const NEW_FILES = [
  'src/lib/leadMarket.ts', 'src/lib/leadRegion.ts', 'src/lib/leadFollowup.ts',
  'src/lib/intlLeadImport.ts', 'src/lib/leadsApi.ts', 'src/pages/Leads.tsx',
];

describe('보안 — 새 코드는 로그인 토큰만 쓴다', () => {
  it('DB 호출은 leadsApi.ts 한 곳에서만 한다', () => {
    for (const f of NEW_FILES) {
      if (f === 'src/lib/leadsApi.ts') continue;
      expect(code(read(f)), f).not.toContain('rest/v1');
    }
  });

  it('leadsApi.ts 는 authedFetch 만 쓴다 (공개 키를 Authorization 에 넣지 않는다)', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    expect(api).toContain('authedFetch');
    expect(api).not.toMatch(/\bfetch\(/);          // 맨 fetch 금지
    expect(api).not.toMatch(/Authorization/);      // 토큰은 authedFetch 가 붙인다
  });

  it('apikey 에 공개 키를 쓰는 것은 정상이다 (Authorization 자리만 아니면 된다)', () => {
    expect(code(read('src/lib/leadsApi.ts'))).toContain('apikey: SUPABASE_KEY');
  });

  it('화면은 leadsApi 를 거친다 (직접 fetch 하지 않는다)', () => {
    const page = code(read('src/pages/Leads.tsx'));
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).toContain("from '@/lib/leadsApi'");
  });

  it('select=* 를 쓰지 않는다 (쓰지 않는 열까지 내려받지 않게)', () => {
    expect(code(read('src/lib/leadsApi.ts'))).not.toContain('select=*');
  });
});

describe('활동 기록은 원장 — 지우는 UI 가 없다', () => {
  it('화면에 활동 기록 삭제가 없다', () => {
    const page = code(read('src/pages/Leads.tsx'));
    expect(page).not.toMatch(/deleteActivity|removeActivity/);
  });

  it('API 에 활동 기록 삭제 함수가 없다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    expect(api).not.toMatch(/lead_activities[^\n]*method:\s*'DELETE'/);
    // DELETE 는 두 곳뿐이다: 가져오기 취소(묶음)와 CC 해제(LEAD-UI2 R7).
    // 둘 다 원장이 아니다 — CC 변경 이력은 활동 기록에 따로 남는다.
    const dels = api.match(/method: 'DELETE'/g) ?? [];
    expect(dels.length).toBe(2);
    expect(api).toContain('import_batch_id=eq.');
    expect(api).toContain('lead_cc_links?lead_id=eq.');
  });

  // LEAD-UI2 R5 에서 빠른 기록·타임라인이 상세 컴포넌트로 옮겨졌다.
  // 목적(화면 어딘가에 반드시 있어야 한다)은 그대로 두고 찾는 곳만 넓혔다.
  const screenText = () =>
    read('src/pages/Leads.tsx') + read('src/components/leads/LeadDetail.tsx');

  it('화면이 "지워지지 않습니다"를 알려 준다', () => {
    expect(screenText()).toContain('지워지지 않습니다');
  });
});

describe('화면 연결', () => {
  it('/leads 라우트가 로그인 뒤에 있다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/leads"');
    const at = app.indexOf('path="/leads"');
    const seg = app.slice(at, at + 300);
    expect(seg).toContain('RequireAuth');
    expect(seg).toContain('<Leads />');
  });

  it('사이드바에 메뉴가 있고 게스트에게는 보이지 않는다', () => {
    const sb = read('src/components/AppSidebar.tsx');
    expect(sb).toContain("url: '/leads'");
    const at = sb.indexOf("url: '/leads'");
    expect(sb.slice(at, at + 120)).toContain('guestAllowed: false');
  });
});

describe('기존 것을 건드리지 않았다', () => {
  it('공개 폼(CampaignForm.tsx)이 그대로다', () => {
    const f = read('src/pages/CampaignForm.tsx');
    expect(f).not.toContain('leadMarket');
    expect(f).not.toContain('leadFollowup');
    expect(f).not.toContain('intlLeadImport');
  });

  it('공개 폼 서버 함수(campaign-submit-lead)가 그대로다', () => {
    const f = read('supabase/functions/campaign-submit-lead/index.ts');
    expect(f).not.toContain('followup_stage');
    expect(f).not.toContain('email_normalized');
  });

  it('국내 부스 스캔 가져오기가 그대로다', () => {
    expect(read('src/lib/campaign-lead-import.ts')).toContain('noPhone');
  });

  it('Campaigns.tsx 변경은 null 가드와 타입뿐이다', () => {
    const c = read('src/pages/Campaigns.tsx');
    // 새 모듈을 가져다 쓰지 않는다(리드 탭을 바꾸지 않았다)
    expect(c).not.toContain('leadFollowup');
    expect(c).not.toContain('intlLeadImport');
    expect(c).not.toContain('leadsApi');
    // 가드는 들어갔다
    expect(c).toContain("(l.phone ?? '')");
  });
});

describe('화면이 요구사항을 담았다', () => {
  const page = read('src/pages/Leads.tsx');

  it('화면 두 개가 있다 — 오늘 할 팔로업 / 7일 넘게 접촉 없음', () => {
    expect(page).toContain('오늘 할 팔로업');
    expect(page).toContain('7일 넘게 접촉 없음');
  });

  it('지남을 눈에 띄게 한다', () => {
    expect(page).toContain('일 지남');
    expect(page).toContain('text-destructive');
  });

  it('단계별 건수(깔때기)가 있다', () => {
    expect(page).toContain('stageCounts');
    expect(page).toContain('FUNNEL_STAGES');
  });

  it('필터 — 행사·국가·담당자·단계·시장·지역', () => {
    for (const l of ['행사', '국가', '담당자', '단계', '시장']) {
      expect(page, l).toContain(`label="${l}"`);
    }
    expect(page).toContain('regionCounts');
  });

  it('가능성순 정렬이 있다', () => {
    expect(page).toContain('byProbability');
    expect(page).toContain('전체 (가능성순)');
  });

  it('기록 입력이 빠르다 — 한 줄 메모 + 단계 + 다음 행동·날짜', () => {
    const t = page + read('src/components/leads/LeadDetail.tsx');
    expect(t).toContain('무엇을 했나 (한 줄)');
    expect(t).toContain('다음 행동');
    expect(t).toContain("type=\"date\"");
  });

  it("'종료'를 고르면 사유를 요구한다", () => {
    const t = page + read('src/components/leads/LeadDetail.tsx');
    expect(t).toContain('needsCloseReason');
    expect(t).toContain('종료 사유 (필수)');
  });

  it('가져오기 미리보기가 건수·중복·제외를 보여 준다', () => {
    expect(page).toContain('가져올 건수');
    expect(page).toContain('이미 등록');
    expect(page).toContain('제외');
    expect(page).toContain('가져오기 취소');
  });

  it('수신 동의와 발송 보류를 사용자에게 알린다', () => {
    expect(page).toContain('동의 없음');
    expect(page).toContain('발송 보류');
  });

  it('외부 메일 자동 발송이 없다 (명령서 금지)', () => {
    const c = code(page);
    expect(c).not.toMatch(/send-email|sendQuoteEmail|alimtalk|functions\/v1/);
  });
});
