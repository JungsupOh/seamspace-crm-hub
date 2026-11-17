// LEAD-UI2 화면 — R2 행사 필터 · R5 분할 화면 · R7 CC · 보안
//
// 지켜야 하는 약속
//   ① 새 코드도 authedFetch 만 쓴다(공개 키로 rest/v1 직접 호출 금지).
//   ② 활동 기록을 지우는 길이 없다(원장).
//   ③ "오늘 할 팔로업"·"7일 넘게"는 보관본을 반드시 뺀다.
//   ④ CC 는 기본이 없음이고, 넣을 때 경고 문구를 보여 준다.
//   ⑤ 기존 화면(공개 폼·캠페인·국내 흐름)을 건드리지 않았다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const NEW_FILES = [
  'src/lib/countries.ts', 'src/lib/leadOrg.ts', 'src/lib/leadEdit.ts',
  'src/components/leads/CountrySelect.tsx', 'src/components/leads/OrgMatesPanel.tsx',
  'src/components/leads/LeadDetail.tsx', 'src/pages/Leads.tsx',
];

describe('보안 — 로그인 토큰만', () => {
  it('DB 호출은 leadsApi.ts 에서만 한다', () => {
    for (const f of NEW_FILES) expect(code(read(f)), f).not.toContain('rest/v1');
  });

  it('leadsApi.ts 는 authedFetch 만 쓴다', () => {
    const api = code(read('src/lib/leadsApi.ts'));
    expect(api).toContain('authedFetch');
    expect(api).not.toMatch(/(?<!authed)\bfetch\(/);
    expect(api).not.toMatch(/Authorization/);
  });

  it('화면이 직접 fetch 하지 않는다', () => {
    for (const f of NEW_FILES) {
      if (f.endsWith('.ts') && !f.includes('components')) continue;
      expect(code(read(f)), f).not.toMatch(/\bfetch\(/);
    }
  });
});

describe('활동 기록은 원장 — 지우는 길이 없다', () => {
  const api = code(read('src/lib/leadsApi.ts'));

  it('lead_activities 를 지우는 코드가 없다', () => {
    expect(api).not.toMatch(/lead_activities[^\n]*method: 'DELETE'/);
  });

  it('DELETE 는 가져오기 취소와 CC 해제 두 곳뿐이다', () => {
    const dels = api.match(/method: 'DELETE'/g) ?? [];
    expect(dels.length).toBe(2);
    expect(api).toContain('import_batch_id=eq.');
    expect(api).toContain('lead_cc_links?lead_id=eq.');
  });

  it('화면에 리드 하드 삭제가 없다 (요구 R8)', () => {
    for (const f of NEW_FILES) {
      expect(code(read(f)), f).not.toMatch(/deleteLead|리드 삭제/);
    }
  });

  it('대신 보관이 있다', () => {
    expect(api).toContain('setArchived');
    expect(read('src/components/leads/LeadDetail.tsx')).toContain('보관');
  });
});

describe('R1 · 수정 저장과 변경 기록', () => {
  const api = code(read('src/lib/leadsApi.ts'));

  it('리드를 먼저 저장하고 기록을 나중에 남긴다', () => {
    const fn = api.slice(api.indexOf('export async function saveLeadEdit'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body.indexOf('patchLead')).toBeLessThan(body.indexOf('logSystemActivity'));
  });

  it('actor 를 채운다 (전에는 비어 있었다)', () => {
    expect(api).toContain('actor: actor.name?.trim() || null');
    expect(api).toContain('actor_user_id: actor.userId');
  });

  it('화면이 로그인 사용자를 actor 로 넘긴다', () => {
    const page = read('src/pages/Leads.tsx');
    expect(page).toContain('useAuth()');
    expect(page).toContain('userId: currentUser?.id');
    const detail = read('src/components/leads/LeadDetail.tsx');
    expect(detail).toContain('actorUserId: actor.userId');
  });

  it('바뀐 것이 없으면 저장하지 않는다', () => {
    expect(api).toContain('if (Object.keys(patch).length === 0)');
  });

  it('같은 이메일 경고는 저장을 막지 않는다', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    expect(d).toContain('저장은 막지 않습니다');
    // 저장 버튼 비활성 조건에 **중복 여부가 들어가면 안 된다**(막지 않는다는 뜻).
    // LEAD-S4 에서 보조 태그가 더해져 조건이 `(!dirty && !tagsDirty)` 로 바뀌었다 —
    // 조건 모양을 못 박지 않고 "중복이 조건에 없다"를 본다.
    const m = d.match(/disabled=\{[^}]*save\.isPending[^}]*\}/);
    expect(m, '저장 버튼의 disabled 조건을 찾지 못했다').not.toBeNull();
    expect(m![0]).not.toMatch(/emailDups|dup/i);
  });
});

describe('R2 · 행사 필터', () => {
  const page = read('src/pages/Leads.tsx');

  it('선택지를 event_name 과 캠페인 이름에서 함께 만든다', () => {
    expect(page).toContain('eventOptions');
    const at = page.indexOf('const eventOptions');
    const seg = page.slice(at, at + 500);
    expect(seg).toContain('l.event_name');
    expect(seg).toContain('campaignName.get');
  });

  it('거르는 쪽도 같은 규칙(eventOf)을 쓴다', () => {
    expect(page).toContain('if (fEvent !== ALL && eventOf(l) !== fEvent) return false;');
  });

  it('원인을 코드에 적어 뒀다 (270건 전부 행사명이 비어 있었다)', () => {
    expect(page).toContain('270건 전부 비어 있다');
  });
});

describe('R4 · 가져오기 보류 사유', () => {
  it('보류일 때만 "발송 보류 사유" 를 붙인다', () => {
    const imp = code(read('src/lib/intlLeadImport.ts'));
    expect(imp).toContain("status === 'hold' ? `발송 보류 사유: ${caution}`");
  });

  it('행사명을 비워 두고는 가져올 수 없다 (R2 근본 원인)', () => {
    expect(read('src/pages/Leads.tsx')).toContain('!eventName.trim()');
    expect(read('src/pages/Leads.tsx')).toContain('행사명 (필수)');
  });

  it('이미 가져온 건을 위한 소급 SQL 제안이 있고, 마이그레이션이 아니다', () => {
    const f = '../audit/proposal_lead_ui2_backfill.sql';
    expect(fs.existsSync(path.resolve(process.cwd(), f))).toBe(true);
    const sql = read(f);
    expect(sql).toContain('미적용');
    // 실행문이 전부 주석이어야 한다 — 실수로 돌려도 데이터가 안 바뀐다
    const live = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(live).not.toMatch(/\bupdate\b/i);
  });
});

describe('R4 · 발송 보류 필터', () => {
  const page = read('src/pages/Leads.tsx');

  it('"발송 가능만" 과 "발송 보류만" 이 있다', () => {
    expect(page).toContain("['mailable', '발송 가능만']");
    expect(page).toContain("['hold', '발송 보류만']");
  });

  it('발송 가능 판정은 공용 함수를 쓴다 (화면마다 다르면 안 된다)', () => {
    expect(page).toContain('isMailable(l)');
  });
});

describe('R5 · 분할 화면', () => {
  const page = read('src/pages/Leads.tsx');

  it('선택한 리드를 URL 에 담는다', () => {
    expect(page).toContain('useSearchParams');
    expect(page).toContain("params.get('lead')");
    expect(page).toContain("next.set('lead', id)");
  });

  it('URL 을 바꿀 때 히스토리를 쌓지 않는다 (뒤로가기가 리드 목록을 거슬러 가면 안 된다)', () => {
    expect(page).toContain('{ replace: true }');
  });

  it('↑/↓ 로 이전·다음 리드를 본다', () => {
    expect(page).toContain("e.key !== 'ArrowUp' && e.key !== 'ArrowDown'");
  });

  it('입력 중에는 ↑/↓ 가 목록을 움직이지 않는다', () => {
    expect(page).toContain("t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'");
  });

  // UI2 fix1 — 상세가 열리면 왼쪽 칸이 좁아지는데, shadcn 기본 TabsList 는
  // `inline-flex h-10` + TabsTrigger `whitespace-nowrap` 이라 줄바꿈도 축소도
  // 하지 않는다. 그래서 탭줄이 바깥으로 흘러나와 상세 패널에 가려졌다(단계별 탭).
  it('탭줄이 좁아지면 줄바꿈된다 (상세 패널에 가리지 않게)', () => {
    const at = page.indexOf('<TabsList');
    expect(at).toBeGreaterThan(-1);
    const tag = page.slice(at, page.indexOf('>', at));
    expect(tag, '탭줄이 줄바꿈되지 않으면 좁은 폭에서 탭이 가려진다').toContain('flex-wrap');
    expect(tag, '고정 높이면 두 줄이 돼도 늘어나지 않는다').toContain('h-auto');
  });

  it('상세 패널 폭이 단계적이다 (lg 에서 왼쪽을 덜 누르게)', () => {
    expect(page).toContain('lg:w-[440px]');
    expect(page).toContain('xl:w-[560px]');
  });

  it('상세 패널이 배경과 쌓임 순서를 가진다 (무엇이 넘쳐도 아래로 깔리지 않게)', () => {
    const at = page.indexOf('lg:w-[440px]');
    const seg = page.slice(at - 120, at + 200);
    expect(seg).toContain('z-10');
    expect(seg).toContain('bg-background');
  });

  it('좁은 화면에서는 상세가 전체 폭으로 열리고 "목록으로" 가 있다', () => {
    expect(page).toContain("selected ? 'hidden lg:block' : 'block'");
    expect(page).toContain('목록으로');
  });

  it('상세에 구역이 순서대로 있다', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    // 머리말(h3) 안의 글자를 순서대로 찾는다. `>기본 정보` 처럼 꺾쇠에 붙는 경우와
    // 줄바꿈 뒤에 오는 경우가 섞여 있어, 머리말 전체를 먼저 뽑고 그 안에서 센다.
    const headings = [...d.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map(m => m[1]);
    const order = ['기본 정보', '같은 기관 사람들', '빠른 기록', '활동 기록'];
    const idx = order.map(o => headings.findIndex(h => h.includes(o)));
    expect(idx.every(i => i >= 0), `머리말 누락: ${order.filter((_, i) => idx[i] < 0)}`).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  // LEAD-S1 에서 "준비 중" 자리 3개가 **실제 기능**으로 채워졌다.
  // 목적(그 세 가지가 상세에 있다)은 그대로 두고, "준비 중" 대신 패널이 붙었는지 본다.
  it('세 자리가 실제 기능으로 채워졌다 (LEAD-S1)', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    for (const t of ['현장 기록 · 관심 신호', '조사 메모', '접근 전략']) {
      expect(d, t).toContain(t);
    }
    for (const c of ['<SignalsPanel', '<ResearchPanel', '<StrategyPanel']) {
      expect(d, c).toContain(c);
    }
    // 더 이상 "준비 중" 안내가 아니다
    expect(d).not.toContain('준비 중');
  });

  it('기존 기능이 남아 있다 (탭 4개·리드 추가·가져오기·지역 칩)', () => {
    for (const t of ['오늘 할 팔로업', '7일 넘게 접촉 없음', '전체 (가능성순)', '단계별',
                     '리드 추가', '해외 명단 가져오기', 'regionCounts']) {
      expect(page, t).toContain(t);
    }
  });
});

describe('R8 · 보관', () => {
  const page = read('src/pages/Leads.tsx');

  it('보관본은 기본으로 숨긴다', () => {
    expect(page).toContain('if (!showArchived && l.archived_at) return false;');
  });

  it('"보관된 리드 보기" 체크가 있다', () => {
    expect(page).toContain('보관된 리드 보기');
  });

  it('오늘 할 팔로업·7일 넘게는 **보기를 켜도** 보관본을 뺀다', () => {
    expect(page).toContain('excludeArchived(filtered)');
    expect(page).toContain('dueToday(activeOnly, today)');
    expect(page).toContain('staleLeads(activeOnly, 7, today)');
  });
});

describe('R7 · CC 결정', () => {
  const panel = read('src/components/leads/OrgMatesPanel.tsx');

  it('기본은 없음이다 (자동으로 CC 하지 않는다)', () => {
    expect(panel).toContain("ccNames.length > 0 ? `${ccNames.join(', ')} (${ccNames.length}명)` : '없음'");
  });

  it('안전 문구를 보여 준다', () => {
    expect(panel).toContain('서로의 이메일이 보입니다');
  });

  it('발송 보류·신뢰도 낮은 후보를 체크하면 경고한다', () => {
    expect(panel).toContain('const risky = !isMailable(lead)');
    expect(panel).toContain('닿지 않을 수 있습니다');
  });

  it('CC 변경이 활동 기록에 남는다', () => {
    expect(code(read('src/lib/leadsApi.ts'))).toContain('[변경] CC 대상:');
  });

  it('기록 문구에 그때의 CC 전체를 적는다 (한 명만 적으면 이력을 못 읽는다)', () => {
    const api = read('src/lib/leadsApi.ts');
    expect(api).toContain('names.join(\', \')');
    expect(api).toContain('현재 CC 전체 목록');
  });
});

describe('R6 · 같은 기관 패널', () => {
  const panel = read('src/components/leads/OrgMatesPanel.tsx');

  it('근거를 배지로 보여 준다', () => {
    expect(panel).toContain('MATCH_LABEL[k]');
  });

  it('추정은 추정이라고 적는다', () => {
    expect(panel).toContain("confidence === 'maybe'");
    expect(panel).toContain('추정');
  });

  it('중복 접촉 경고를 보여 준다', () => {
    expect(panel).toContain('일 전');
    expect(panel).toContain('중복으로 보내지 않도록');
  });

  it('누르면 그 리드로 간다', () => {
    expect(panel).toContain('onOpenLead(lead.id)');
  });
});

describe('R3 · 국가 선택', () => {
  const sel = read('src/components/leads/CountrySelect.tsx');

  it('한글·영문·코드로 검색한다고 안내한다', () => {
    expect(sel).toContain('싱가포르 · Singapore · SG');
  });

  it('표에 없는 값도 직접 입력으로 받는다', () => {
    expect(sel).toContain('직접 입력');
    expect(sel).toContain('미분류가 됩니다');
  });

  it('목록·상세·필터가 같은 표시 함수를 쓴다', () => {
    expect(read('src/pages/Leads.tsx')).toContain('countryLabel');
    expect(read('src/pages/Leads.tsx')).toContain('countryShort');
    expect(read('src/components/leads/LeadDetail.tsx')).toContain('countryLabel');
  });
});

describe('기존 것을 건드리지 않았다', () => {
  it('공개 폼이 그대로다', () => {
    const f = read('src/pages/CampaignForm.tsx');
    for (const n of ['leadEdit', 'leadOrg', 'countries', 'LeadDetail']) {
      expect(f, n).not.toContain(n);
    }
  });

  it('공개 폼 서버 함수가 그대로다', () => {
    const f = read('supabase/functions/campaign-submit-lead/index.ts');
    expect(f).not.toContain('archived_at');
    expect(f).not.toContain('lead_cc_links');
  });

  it('캠페인 화면이 그대로다 (리드 탭을 손대지 않았다)', () => {
    const c = read('src/pages/Campaigns.tsx');
    for (const n of ['leadEdit', 'leadOrg', 'leadsApi', 'LeadDetail']) {
      expect(c, n).not.toContain(n);
    }
  });
});
