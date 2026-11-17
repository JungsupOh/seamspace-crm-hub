// LEAD-S2 화면 — 보안 정적 검사와 요구사항 반영
//
// 지켜야 하는 약속
//   ① **CRM 은 메일을 보내지 않는다** — 메일 전송 코드가 없다.
//   ② 공개 수신 거부 화면은 **버튼을 눌러야** 처리한다(로봇 자동 거부 방지).
//   ③ 공개 경로는 서버 함수 경유(DB 직접 접근 금지).
//   ④ 초안은 지울 수 없다. 승인 뒤 본문 수정 불가.
//   ⑤ 억제 규칙에 걸리면 승인 버튼이 눌리지 않는다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const NEW_FILES = [
  'src/lib/outreach.ts',
  'src/lib/public/unsubscribe.ts',
  'src/pages/Unsubscribe.tsx',
  'src/pages/Outreach.tsx',
  'src/components/leads/OutreachPanel.tsx',
];

describe('CRM 은 메일을 보내지 않는다', () => {
  it('새 코드에 메일 전송 호출이 없다', () => {
    for (const f of NEW_FILES) {
      const c = code(read(f));
      expect(c, f).not.toMatch(/send-email|sendQuoteEmail|resend|smtp|nodemailer/i);
    }
  });

  it('아웃리치 패널이 그 사실을 화면에 적는다', () => {
    const p = read('src/components/leads/OutreachPanel.tsx');
    expect(p).toContain('보내지 않습니다');
    expect(p).toContain('발송 완료로 표시');
  });

  it('큐 화면도 같은 안내를 한다', () => {
    expect(read('src/pages/Outreach.tsx')).toContain('보내지 않습니다');
  });

  it('API 에도 메일 전송이 없다 (상태만 바꾼다)', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    const at = api.indexOf('export async function markDraftSent');
    const body = api.slice(at, at + 2200);
    expect(body).not.toMatch(/send-email|functions\/v1/);
    expect(body).toContain('lead_activities');
  });
});

describe('공개 수신 거부', () => {
  const page = read('src/pages/Unsubscribe.tsx');

  it('**버튼을 눌러야 처리한다** (로봇이 자동 거부하지 않게)', () => {
    // 화면이 열리는 것만으로 부르면 안 된다 — useEffect 안에서 부르지 않는다
    expect(page).toMatch(/onClick=\{go\}/);
    const effects = page.match(/useEffect\([\s\S]*?\)\s*;/g) ?? [];
    for (const e of effects) expect(e).not.toContain('requestUnsubscribe');
  });

  it('로그인이 필요 없다', () => {
    const app = read('src/App.tsx');
    const at = app.indexOf('path="/unsubscribe/:token"');
    expect(at).toBeGreaterThan(-1);
    const seg = app.slice(at, at + 160);
    expect(seg).not.toContain('RequireAuth');
    expect(seg).toContain('<Unsubscribe />');
  });

  it('영어 기본 + ?lang= 우선 + 브라우저 언어 보조', () => {
    expect(page).toContain("params.get('lang')");
    expect(page).toContain('navigator.language');
    expect(page).toMatch(/startsWith\('ko'\) \? 'ko' : 'en'/);
  });

  it('성공·실패 문구가 영어·한국어 둘 다 있다', () => {
    expect(page).toContain('You have been unsubscribed');
    expect(page).toContain('수신 거부가 처리되었습니다');
  });

  it('없는 토큰과 유효한 토큰을 화면이 구분하지 않는다 (열거 방지)', () => {
    expect(page).toContain('열거 방지');
  });

  it('공개 경로가 DB 를 직접 만지지 않는다 (서버 함수 경유)', () => {
    for (const f of ['src/pages/Unsubscribe.tsx', 'src/lib/public/unsubscribe.ts']) {
      expect(code(read(f)), f).not.toContain('rest/v1');
      expect(code(read(f)), f).not.toMatch(/\bfetch\(/);
    }
    expect(read('src/lib/public/unsubscribe.ts')).toContain('callPublicFn');
  });
});

describe('보안 — 관리자 코드는 로그인 토큰만', () => {
  it('아웃리치 화면이 DB 를 직접 부르지 않는다', () => {
    for (const f of ['src/pages/Outreach.tsx', 'src/components/leads/OutreachPanel.tsx',
                     'src/lib/outreach.ts']) {
      expect(code(read(f)), f).not.toContain('rest/v1');
      expect(code(read(f)), f).not.toMatch(/\bfetch\(/);
    }
  });

  it('leadsApi 는 authedFetch 만 쓴다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    expect(api).not.toMatch(/(?<!authed)\bfetch\(/);
    expect(api).not.toMatch(/Authorization/);
  });

  it('초안 조회에 select=* 를 쓰지 않는다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    const at = api.indexOf('rest/v1/lead_outreach_drafts?');
    expect(api.slice(at, at + 200)).not.toContain('select=*');
  });
});

describe('초안은 지울 수 없다', () => {
  const api = code(read('src/lib/leadsApi.ts'));

  it('초안에 DELETE 를 보내지 않는다', () => {
    for (const m of api.matchAll(/rest\/v1\/lead_outreach_drafts[\s\S]{0,400}?method: '(\w+)'/g)) {
      expect(m[1]).not.toBe('DELETE');
    }
  });

  it('DELETE 는 전과 같이 두 곳뿐이다', () => {
    const dels = api.match(/method: 'DELETE'/g) ?? [];
    expect(dels.length).toBe(2);
  });

  it('취소는 상태 변경이고 사유가 필수다', () => {
    expect(api).toContain('cancelDraft');
    expect(read('src/components/leads/OutreachPanel.tsx')).toContain('취소 사유');
  });

  it('화면에 초안 삭제 버튼이 없다', () => {
    for (const f of ['src/components/leads/OutreachPanel.tsx', 'src/pages/Outreach.tsx']) {
      expect(code(read(f)), f).not.toMatch(/초안 삭제|deleteDraft/);
    }
  });
});

describe('상태 흐름이 화면에 반영됐다', () => {
  const p = read('src/components/leads/OutreachPanel.tsx');

  it('억제 규칙에 걸리면 승인이 눌리지 않는다', () => {
    expect(p).toMatch(/disabled=\{!approval\.canApprove/);
  });

  it('승인 시 CC 스냅샷을 넘긴다', () => {
    expect(p).toContain('approveDraft(draft.id, ccPeople.map');
    expect(code(read('src/lib/leadsApi.ts'))).toContain('cc_snapshot: ccSnapshot');
  });

  it('승인된 초안은 "고치기" 가 보이지 않는다', () => {
    expect(p).toContain('canEditBody(status)');
    expect(p).toMatch(/\{editable && \([\s\S]{0,120}고치기/);
  });

  it('승인된 초안을 고치려 하면 API 가 막는다', () => {
    expect(p).toContain('승인된 초안은 고칠 수 없습니다');
  });

  it('발송 완료는 차수를 함께 보여 준다', () => {
    expect(p).toContain('발송 완료로 표시 ({attemptNo}차)');
  });

  it('**단계를 자동으로 바꾸지 않는다** — 묻는다', () => {
    expect(p).toContain('suggestStageAfterSend');
    expect(p).toContain('window.confirm');
    expect(p).toContain('취소하면 단계는 그대로');
  });
});

describe('초안 작성 화면', () => {
  const p = read('src/components/leads/OutreachPanel.tsx');

  // LEAD-S4(d): 자리를 정하는 규칙이 appendUnsubscribeLine 으로 옮겨졌다
  // (전에는 화면이 커서 위치에 넣어 본문 맨 앞에 들어가는 결함이 있었다).
  it('수신 거부 문구를 본문 **끝**에 미리 넣는다', () => {
    expect(p).toContain('appendUnsubscribeLine');
    expect(p).toMatch(/useEffect\([\s\S]{0,400}appendUnsubscribeLine/);
  });

  it('거부 문구를 지우면 경고하고 다시 넣을 수 있다', () => {
    expect(p).toContain('수신 거부 문구가 없습니다');
    expect(p).toContain('다시 넣기');
  });

  it('확정 사실은 문장을 **커서 위치에** 넣는다', () => {
    expect(p).toContain('insertAtCursor');
    expect(p).toContain('커서 위치에 들어갑니다');
  });

  it('미정 사실은 "확인 후 안내" 문구만 넣을 수 있다', () => {
    expect(p).toContain('insertPending');
    expect(p).toContain('PENDING_PLACEHOLDER');
  });

  it('문구 점검을 보여 주되 막지 않는다', () => {
    expect(p).toContain('findRiskyPhrases');
    expect(p).toContain('막지는 않습니다');
  });

  it('복사 버튼이 제목과 본문을 함께 복사한다', () => {
    expect(p).toContain('navigator.clipboard.writeText');
    expect(p).toContain('수신 거부 문구 포함');
  });

  it('같은 기관 중복 접촉 경고를 재사용한다', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    const at = d.indexOf('<OutreachPanel');
    const seg = d.slice(at - 600, at);
    expect(seg).toContain('recent');
    expect(seg).toContain('중복으로 보내지 않도록');
  });
});

describe('아웃리치 큐', () => {
  const p = read('src/pages/Outreach.tsx');

  it('/outreach 가 로그인 뒤에 있다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/outreach"');
    const at = app.indexOf('path="/outreach"');
    expect(app.slice(at, at + 300)).toContain('RequireAuth');
  });

  it('탭 5개(초안·승인됨·예약·발송됨·취소)', () => {
    expect(p).toContain('DRAFT_STATUSES.map');
    expect(p).toContain('DRAFT_STATUS_LABEL[s]');
  });

  it('받는 사람 시간대와 예약 시각을 보여 준다', () => {
    expect(p).toContain('localTimeAt(d.scheduled_at');
    expect(p).toContain('offsetLabel(tz)');
  });

  it('억제 규칙에 걸린 건을 표시한다', () => {
    expect(p).toContain('checkSuppression');
    expect(p).toContain('suppressionText(sup)');
  });

  it('일괄 발송·템플릿 일괄 생성을 만들지 않았다', () => {
    const c = code(p);
    expect(c).not.toMatch(/일괄|bulk|selectAll|checkbox/i);
    expect(p).toContain('이번에 만들지 않는다');
  });

  it('리드 화면에서 갈 수 있다', () => {
    expect(read('src/pages/Leads.tsx')).toContain('to="/outreach"');
  });
});

describe('기존 것을 건드리지 않았다', () => {
  it('공개 폼이 그대로다', () => {
    const f = read('src/pages/CampaignForm.tsx');
    for (const n of ['outreach', 'unsubscribe_token', 'lead_outreach_drafts']) {
      expect(f, n).not.toContain(n);
    }
  });

  it('공개 폼 서버 함수가 그대로다', () => {
    const f = read('supabase/functions/campaign-submit-lead/index.ts');
    for (const n of ['unsubscribe_token', 'lead_outreach_drafts', 'unsubscribed_at']) {
      expect(f, n).not.toContain(n);
    }
  });

  it('기존 apk 수신 거부 화면과 섞이지 않았다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/apk/unsubscribe"');
    expect(app).toContain('path="/unsubscribe/:token"');
    // 서로 다른 컴포넌트다
    expect(app).toContain('<ApkUnsubscribe />');
    expect(app).toContain('<Unsubscribe />');
  });

  it('캠페인 화면이 그대로다', () => {
    const c = read('src/pages/Campaigns.tsx');
    for (const n of ['outreach', 'OutreachPanel']) expect(c, n).not.toContain(n);
  });
});
