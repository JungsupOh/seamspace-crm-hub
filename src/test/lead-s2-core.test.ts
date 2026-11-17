// LEAD-S2 순수 로직 — 수신 거부 · 억제 규칙 · 문구 점검 · 초안 상태
//
// 지켜야 하는 약속
//   ① 거부한 사람에게는 **절대** 보내지 않는다(억제 규칙 한 곳에서 판정).
//   ② 공개 함수는 **없는 토큰과 같은 응답**을 준다(열거 방지), 리드 정보를 담지 않는다.
//   ③ 거부 문구가 빠진 초안은 **승인할 수 없다**(법적 요건).
//   ④ 위험 표현은 **막지 않고 알려만** 준다(조언용).
//   ⑤ 보낸 초안은 되돌릴 수 없다. 승인된 초안은 본문을 고칠 수 없다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DRAFT_STATUSES, DRAFT_STATUS_LABEL, LIST_UNSUBSCRIBE_POST, MAIL_LANGS, RISKY_PHRASES,
  SUPPRESSION_LABEL, UNSUBSCRIBE_BASE, buildCancel, buildDraft, canEditBody, canTransition,
  checkApproval, checkSuppression, findRiskyPhrases, hasUnsubscribeLine, listUnsubscribeHeader,
  localTimeAt, offsetLabel, scheduleFromLocal, sentActivitySummary, suggestStageAfterSend,
  suppressionText, timezoneOffsetFor, unsubscribeLine, unsubscribeUrl,
} from '../lib/outreach';
import {
  GENERIC_ERROR, GENERIC_OK, unsubscribeActivity, unsubscribePatch, validateToken,
} from '../../supabase/functions/lead-unsubscribe/logic.ts';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const TOK = '11111111-2222-3333-4444-555555555555';

// ══════════════════════ 수신 거부 링크 ══════════════════════
describe('수신 거부 링크', () => {
  it('기준 주소가 한 곳에만 있다', () => {
    expect(UNSUBSCRIBE_BASE).toMatch(/^https:\/\//);
    expect(UNSUBSCRIBE_BASE).toContain('/unsubscribe');
  });

  it('uuid 토큰으로 링크를 만든다', () => {
    expect(unsubscribeUrl(TOK)).toBe(`${UNSUBSCRIBE_BASE}/${TOK}`);
  });

  it('**uuid 가 아니면 링크를 만들지 않는다** (아무 문자열이나 링크가 되면 안 된다)', () => {
    for (const bad of ['', '  ', 'abc', '1234', null, 123, `${TOK}extra`, 'javascript:alert(1)']) {
      expect(unsubscribeUrl(bad), String(bad)).toBeNull();
    }
  });

  it('영어·한국어 문구', () => {
    expect(unsubscribeLine(TOK, 'en')).toBe(
      `If you would rather not hear from us, unsubscribe here: ${UNSUBSCRIBE_BASE}/${TOK}`);
    expect(unsubscribeLine(TOK, 'ko')).toContain('수신을 거부하실 수 있습니다');
    expect(unsubscribeLine(TOK, 'ko')).toContain(TOK);
  });

  it('토큰이 없으면 문구도 만들지 않는다', () => {
    expect(unsubscribeLine('bad', 'en')).toBeNull();
  });

  it('본문에 링크가 있는지 본다', () => {
    const body = `Hello\n\n${unsubscribeLine(TOK, 'en')}`;
    expect(hasUnsubscribeLine(body, TOK)).toBe(true);
    expect(hasUnsubscribeLine('Hello', TOK)).toBe(false);
    expect(hasUnsubscribeLine(body, 'other-token')).toBe(false);
  });

  it('List-Unsubscribe 헤더 값 — 만들어 두지만 지금은 쓰지 않는다', () => {
    expect(listUnsubscribeHeader(TOK)).toBe(`<${UNSUBSCRIBE_BASE}/${TOK}>`);
    expect(listUnsubscribeHeader('bad')).toBeNull();
    expect(LIST_UNSUBSCRIBE_POST).toBe('List-Unsubscribe=One-Click');
  });

  it('지금은 쓰지 않는다는 것을 코드가 밝힌다', () => {
    expect(read('src/lib/outreach.ts')).toContain('지금은 쓰지 않는다');
  });

  it('언어는 둘뿐이다', () => {
    expect([...MAIL_LANGS]).toEqual(['en', 'ko']);
  });
});

// ══════════════════════ 억제 규칙 ══════════════════════
describe('억제 규칙 — 보내면 안 되는 대상', () => {
  const ok = { email_normalized: 'a@x.sg', email_status: 'unverified', email_quality: 4,
               marketing_consent: true };

  it('정상이면 막지 않는다', () => {
    const r = checkSuppression(ok);
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('**수신 거부한 사람은 막는다**', () => {
    const r = checkSuppression({ ...ok, unsubscribed_at: '2026-11-17T00:00:00Z' });
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain('unsubscribed');
  });

  it.each([
    ['hold', 'hold'], ['invalid', 'invalid'], ['bounced', 'bounced'],
  ] as const)('이메일 상태 %s 면 막는다', (status, reason) => {
    const r = checkSuppression({ ...ok, email_status: status });
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain(reason);
  });

  it('주소가 없으면 막는다', () => {
    expect(checkSuppression({ ...ok, email_normalized: '' }).reasons).toContain('no-email');
  });

  it('신뢰도 ≤2 는 **경고만** (막지 않는다)', () => {
    const r = checkSuppression({ ...ok, email_quality: 2 });
    expect(r.blocked).toBe(false);
    expect(r.warnings.join(' ')).toContain('신뢰도');
  });

  it('신뢰도를 매긴 적 없으면 경고한다 (0 점으로 보지 않는다)', () => {
    const r = checkSuppression({ ...ok, email_quality: null });
    expect(r.blocked).toBe(false);
    expect(r.warnings.join(' ')).toContain('매긴 적이 없습니다');
  });

  it('**수신 동의 false 는 막는 조건이 아니다** (가져온 리드는 전부 false)', () => {
    const r = checkSuppression({ ...ok, marketing_consent: false });
    expect(r.blocked).toBe(false);
    expect(r.warnings.join(' ')).toContain('콜드 아웃리치');
  });

  it('여러 이유가 겹치면 모두 돌려준다', () => {
    const r = checkSuppression({ unsubscribed_at: 'x', email_status: 'hold', email_normalized: '' });
    expect(r.reasons.sort()).toEqual(['hold', 'no-email', 'unsubscribed']);
    expect(suppressionText(r)).toContain(SUPPRESSION_LABEL.unsubscribed);
  });
});

// ══════════════════════ 문구 점검 ══════════════════════
describe('문구 점검 — 막지 않고 알려만 준다', () => {
  it('보장·연동·금액·시점 약속을 잡는다', () => {
    expect(findRiskyPhrases('We guarantee results').map(h => h.label)).toContain('guarantee');
    expect(findRiskyPhrases('It integrates with Canvas').map(h => h.label)).toContain('integrates with');
    expect(findRiskyPhrases('about USD 25 per set').map(h => h.label)).toContain('금액');
    expect(findRiskyPhrases('will be available by Q2').map(h => h.label)).toContain('시점 약속');
  });

  // ⚠️ JS 의 `\b` 는 `[A-Za-z0-9_]` 기준이라 **한글 앞뒤에서는 경계가 생기지 않는다.**
  //    처음에 `/\b정식\s?지원\b/` 로 썼더니 한 번도 걸리지 않았다(이 테스트가 잡았다).
  it('한글 위험 표현도 잡는다 — \\b 를 쓰면 조용히 안 걸린다', () => {
    expect(findRiskyPhrases('인도네시아어 정식 지원').map(h => h.label)).toContain('정식 지원');
    expect(findRiskyPhrases('공식지원 예정입니다').map(h => h.label)).toContain('정식 지원');
    expect(findRiskyPhrases('1세트 25000원입니다').map(h => h.label)).toContain('금액');
    expect(findRiskyPhrases('무료로 드립니다').map(h => h.label)).toContain('무료');
  });

  it('왜 위험한지 알려 준다', () => {
    const h = findRiskyPhrases('It integrates with Google Classroom')[0];
    expect(h.why).toContain('준비 중');
  });

  it('찾은 자리를 짧게 보여 준다', () => {
    const h = findRiskyPhrases('Hello there, we guarantee it works well')[0];
    expect(h.excerpt).toContain('guarantee');
    expect(h.excerpt.length).toBeLessThan(80);
  });

  it('깨끗한 문구는 잡지 않는다', () => {
    expect(findRiskyPhrases('We are preparing an EdLink integration.')).toEqual([]);
    expect(findRiskyPhrases('')).toEqual([]);
    expect(findRiskyPhrases(null)).toEqual([]);
  });

  it('목록이 상수다 (코드에 흩어져 있지 않다)', () => {
    expect(RISKY_PHRASES.length).toBeGreaterThanOrEqual(6);
    for (const p of RISKY_PHRASES) {
      expect(p.label).toBeTruthy();
      expect(p.why).toBeTruthy();
    }
  });
});

// ══════════════════════ 초안 상태 ══════════════════════
describe('초안 상태 흐름', () => {
  it('다섯 가지다', () => {
    expect([...DRAFT_STATUSES]).toEqual(['draft', 'approved', 'scheduled', 'sent', 'cancelled']);
    expect(DRAFT_STATUS_LABEL.sent).toBe('발송됨');
  });

  it('초안 → 승인 → 예약 → 발송', () => {
    expect(canTransition('draft', 'approved')).toBe(true);
    expect(canTransition('approved', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'sent')).toBe(true);
    expect(canTransition('approved', 'sent')).toBe(true);   // 예약 없이 바로 보낼 수도 있다
  });

  it('**보낸 것은 되돌릴 수 없다**', () => {
    for (const to of DRAFT_STATUSES) expect(canTransition('sent', to), to).toBe(false);
  });

  it('취소된 것도 되돌릴 수 없다', () => {
    for (const to of DRAFT_STATUSES) expect(canTransition('cancelled', to), to).toBe(false);
  });

  it('뒤로 가는 길이 없다', () => {
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('scheduled', 'approved')).toBe(false);
  });

  it('어느 상태에서든 취소는 된다 (보냄·취소 제외)', () => {
    for (const from of ['draft', 'approved', 'scheduled'] as const) {
      expect(canTransition(from, 'cancelled'), from).toBe(true);
    }
  });

  it('**승인된 뒤에는 본문을 못 고친다**', () => {
    expect(canEditBody('draft')).toBe(true);
    for (const s of ['approved', 'scheduled', 'sent', 'cancelled']) {
      expect(canEditBody(s), s).toBe(false);
    }
  });
});

describe('초안 만들기', () => {
  const base = { leadId: 'L1', language: 'en' as const, subject: 'Hello', body: 'Body' };

  it('제목·본문이 있으면 만든다', () => {
    const v = buildDraft(base);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.row.status).toBe('draft');
      expect(v.row.fact_ids).toEqual([]);
    }
  });

  it.each([
    ['리드 없음', { ...base, leadId: '' }],
    ['제목 없음', { ...base, subject: '  ' }],
    ['본문 없음', { ...base, body: '' }],
    ['모르는 언어', { ...base, language: 'jp' as never }],
  ])('잘못된 입력을 막는다 — %s', (_n, input) => {
    expect(buildDraft(input).ok).toBe(false);
  });
});

describe('승인 검사', () => {
  const lead = {
    email_normalized: 'a@x.sg', email_status: 'unverified', email_quality: 4,
    marketing_consent: true, unsubscribe_token: TOK,
  };
  const body = `Hello\n\n${unsubscribeLine(TOK, 'en')}`;

  it('정상이면 승인할 수 있다', () => {
    const r = checkApproval({ lead, subject: 'Hi', body });
    expect(r.canApprove).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('**억제 규칙에 걸리면 승인할 수 없다**', () => {
    const r = checkApproval({ lead: { ...lead, unsubscribed_at: 'x' }, subject: 'Hi', body });
    expect(r.canApprove).toBe(false);
    expect(r.blockers.join(' ')).toContain('수신 거부함');
  });

  it('**거부 문구가 빠지면 승인할 수 없다** (법적 요건)', () => {
    const r = checkApproval({ lead, subject: 'Hi', body: 'Hello only' });
    expect(r.canApprove).toBe(false);
    expect(r.blockers.join(' ')).toContain('수신 거부 문구');
  });

  it('제목·본문이 비면 막는다', () => {
    expect(checkApproval({ lead, subject: '', body }).canApprove).toBe(false);
    expect(checkApproval({ lead, subject: 'Hi', body: '' }).canApprove).toBe(false);
  });

  it('위험 표현은 **경고만** 한다 (승인은 된다)', () => {
    const r = checkApproval({ lead, subject: 'We guarantee', body });
    expect(r.canApprove).toBe(true);
    expect(r.warnings.join(' ')).toContain('guarantee');
  });

  it('신뢰도 낮음도 경고만', () => {
    const r = checkApproval({ lead: { ...lead, email_quality: 1 }, subject: 'Hi', body });
    expect(r.canApprove).toBe(true);
  });
});

describe('취소·발송 기록', () => {
  it('취소는 사유가 필수다', () => {
    expect(buildCancel('').ok).toBe(false);
    expect(buildCancel('  ').ok).toBe(false);
    const v = buildCancel('방향이 바뀌었음');
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.patch.status).toBe('cancelled');
      expect(v.patch.cancelled_reason).toBe('방향이 바뀌었음');
    }
  });

  it('발송 기록 요약에 제목이 들어간다', () => {
    expect(sentActivitySummary('Intro to Seamspace')).toBe('메일 보냄 — Intro to Seamspace');
    expect(sentActivitySummary('')).toBe('메일 보냄');
  });

  it('단계는 **제안만** 한다 (자동 변경 금지)', () => {
    expect(suggestStageAfterSend('신규')).toBe('1차 연락함');
    expect(suggestStageAfterSend('연락 대기')).toBe('1차 연락함');
    expect(suggestStageAfterSend(null)).toBe('1차 연락함');
    // 이미 진행된 단계는 건드리지 않는다
    expect(suggestStageAfterSend('협상')).toBeNull();
    expect(suggestStageAfterSend('체험 중')).toBeNull();
  });
});

// ══════════════════════ 시간대 ══════════════════════
describe('받는 사람 시간대', () => {
  it.each([['SG', 480], ['KR', 540], ['GB', 0], ['US', -300], ['IN', 330], ['NP', 345]] as const)(
    '%s → %d분', (c, m) => expect(timezoneOffsetFor(c)).toBe(m));

  it('**모르는 나라는 추측하지 않는다**', () => {
    for (const c of ['ZZ', '', null, 'Freedonia']) {
      expect(timezoneOffsetFor(c), String(c)).toBeNull();
    }
  });

  it('시간대 표기', () => {
    expect(offsetLabel(480)).toBe('UTC+8');
    expect(offsetLabel(0)).toBe('UTC+0');
    expect(offsetLabel(-300)).toBe('UTC-5');
    expect(offsetLabel(330)).toBe('UTC+5:30');
  });

  it('예약 시각을 현지 시각으로 보여 준다', () => {
    // 2026-11-18 01:00Z = 싱가포르 09:00
    expect(localTimeAt('2026-11-18T01:00:00Z', 'SG')).toBe('2026-11-18 09:00 (UTC+8)');
  });

  it('나라를 모르면 현지 시각을 만들지 않는다', () => {
    expect(localTimeAt('2026-11-18T01:00:00Z', 'ZZ')).toBeNull();
    expect(localTimeAt('', 'SG')).toBeNull();
  });

  it('현지 시각 입력을 그 나라 시간대로 해석한다', () => {
    // 싱가포르 09:00 → 01:00Z
    expect(scheduleFromLocal('2026-11-18T09:00', 'SG')).toBe('2026-11-18T01:00:00.000Z');
    // 런던 09:00 → 09:00Z
    expect(scheduleFromLocal('2026-11-18T09:00', 'GB')).toBe('2026-11-18T09:00:00.000Z');
  });

  it('나라를 모르면 한국 시각으로 본다 (운영자가 한국에 있다)', () => {
    expect(scheduleFromLocal('2026-11-18T09:00', 'ZZ')).toBe('2026-11-18T00:00:00.000Z');
  });

  it('형식이 아니면 null', () => {
    expect(scheduleFromLocal('나중에', 'SG')).toBeNull();
    expect(scheduleFromLocal('', 'SG')).toBeNull();
  });
});

// ══════════════════════ 공개 함수 로직 ══════════════════════
describe('lead-unsubscribe — 공개 함수', () => {
  it('uuid 토큰만 받는다', () => {
    expect(validateToken({ token: TOK })).toEqual({ ok: true, token: TOK });
    expect(validateToken({ token: ` ${TOK} ` })).toEqual({ ok: true, token: TOK });
  });

  it.each([
    ['빈 값', { token: '' }],
    ['uuid 아님', { token: 'abc' }],
    ['숫자', { token: 123 }],
    ['없음', {}],
    ['배열', []],
    ['null', null],
    ['허용 안 된 필드', { token: TOK, email: 'a@b.com' }],
  ])('잘못된 입력을 막는다 — %s', (_n, body) => {
    expect(validateToken(body).ok).toBe(false);
  });

  it('**실패에 사유를 담지 않는다** (없는 토큰과 같은 응답을 주려고)', () => {
    const v = validateToken({ token: 'abc' });
    expect(Object.keys(v)).toEqual(['ok']);
  });

  it('응답에 **리드 정보가 없다**', () => {
    const json = JSON.stringify({ ...GENERIC_OK, ...GENERIC_ERROR });
    for (const k of ['email', 'name', 'phone', 'id', 'lead', 'school']) {
      expect(json.toLowerCase(), k).not.toContain(`"${k}"`);
    }
  });

  it('성공 응답이 영어·한국어 문구를 담는다', () => {
    expect(GENERIC_OK.ok).toBe(true);
    expect(GENERIC_OK.message_en).toContain('unsubscribed');
    expect(GENERIC_OK.message_ko).toContain('수신 거부');
    expect(GENERIC_ERROR.ok).toBe(false);
  });

  it('활동 기록은 받은 것(in)으로 남는다 — 본인이 거부했다', () => {
    const a = unsubscribeActivity('L1', '2026-11-17T00:00:00Z');
    expect(a.direction).toBe('in');
    expect(a.channel).toBe('other');
    expect(a.summary).toBe('[수신 거부] 본인이 링크로 거부');
    expect(a.actor).toBe('시스템');
  });

  it('거부하면 **동의도 함께 끈다**', () => {
    const p = unsubscribePatch('2026-11-17T00:00:00Z');
    expect(p.unsubscribed_at).toBe('2026-11-17T00:00:00Z');
    expect(p.marketing_consent).toBe(false);
  });
});

describe('공개 함수 — 응답이 갈리지 않는다', () => {
  const idx = read('supabase/functions/lead-unsubscribe/index.ts');

  it('없는 토큰도 GENERIC_OK 를 준다', () => {
    expect(idx).toMatch(/if \(!lead\) return json\(\{ \.\.\.GENERIC_OK \}\)/);
  });

  it('이미 거부한 토큰도 성공이다 (멱등)', () => {
    expect(idx).toMatch(/if \(lead\.unsubscribed_at\) return json\(\{ \.\.\.GENERIC_OK \}\)/);
  });

  it('토큰이 이상하면 DB 를 부르지 않는다', () => {
    const at = idx.indexOf('if (!v.ok)');
    expect(at).toBeGreaterThan(-1);
    expect(idx.slice(0, at)).not.toContain('rest/v1');
  });

  it('리드의 이름·이메일을 읽지 않는다', () => {
    const sel = idx.match(/select=([^`&]*)/)?.[1] ?? '';
    expect(sel).toBe('id,unsubscribed_at');
  });

  it('로그에 토큰·개인정보를 적지 않는다', () => {
    for (const l of idx.split('\n').filter(x => x.includes('console.'))) {
      expect(l).not.toMatch(/v\.token|lead\.id|email/);
    }
  });

  it('service_role 로 돈다 (공개 경로가 DB 를 직접 만지지 않는다)', () => {
    expect(idx).toContain('headers: DB');
    expect(idx).not.toContain('ANON');
  });

  it('활동 기록이 실패해도 거부는 성공으로 답한다', () => {
    const at = idx.indexOf('lead_activities');
    const seg = idx.slice(at - 200, at + 500);
    expect(seg).toContain('catch');
    expect(seg).toContain('거부는 처리됨');
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션', () => {
  const U = sqlCode(read('supabase/migrations/20261127000000_lead_s2_unsubscribe.sql'));
  const D = sqlCode(read('supabase/migrations/20261127001000_lead_s2_outreach_drafts.sql'));

  it('토큰은 NOT NULL + 기본값 + UNIQUE 다', () => {
    expect(U).toMatch(/unsubscribe_token uuid not null default gen_random_uuid\(\)/i);
    expect(U).toMatch(/unique index[\s\S]{0,120}\(unsubscribe_token\)/i);
  });

  it('**테이블을 다시 쓰는 비용을 문서에 적었다**', () => {
    const raw = read('supabase/migrations/20261127000000_lead_s2_unsubscribe.sql');
    expect(raw).toMatch(/rewrite|다시 쓴다/);
    expect(raw).toContain('270행');
    expect(raw).toMatch(/ACCESS EXCLUSIVE|락/);
  });

  it('기존 데이터를 바꾸지 않는다', () => {
    for (const m of [U, D]) {
      expect(m).not.toMatch(/drop\s+column/i);
      expect(m).not.toMatch(/\b(delete\s+from|truncate|update\s+public\.)/i);
    }
  });

  it('초안 표에 RLS·admin 전용·anon REVOKE 가 있다', () => {
    expect(D).toMatch(/enable row level security/i);
    expect(D).toMatch(/public\.app_is_admin\(\)/);
    expect(D).not.toMatch(/to anon/);
    expect(D).toMatch(/revoke all on public\.lead_outreach_drafts from anon/i);
    expect(D).toMatch(/revoke all on public\.lead_outreach_drafts from public/i);
  });

  it('anon 에 GRANT 를 주지 않는다', () => {
    for (const g of D.match(/grant[^;]*;/gi) ?? []) expect(g, g).not.toMatch(/\banon\b/);
  });

  it('초안은 삭제 불가다 (취소도 기록이다)', () => {
    expect(D).toMatch(/as restrictive for delete/i);
    const g = (D.match(/grant ([^;]*) on public\.lead_outreach_drafts to authenticated/i) ?? [])[1] ?? '';
    expect(g.toLowerCase()).not.toContain('delete');
    expect(g.toLowerCase()).not.toContain('all');
  });

  it('취소에는 사유가 필요하다 (DB 도 같은 규칙)', () => {
    expect(D).toMatch(/status <> 'cancelled' or coalesce\(trim\(cancelled_reason\), ''\) <> ''/i);
  });

  it('새 FK 는 on delete restrict 다 (sent_activity_id 만 예외)', () => {
    expect(D).toMatch(/references public\.campaign_leads\(id\) on delete restrict/i);
    expect(D).toMatch(/references public\.lead_strategies\(id\) on delete restrict/i);
    // lead_activities 는 리드 삭제 시 cascade 로 사라지는 기존 표라 restrict 를 걸 수 없다
    expect(D).toMatch(/references public\.lead_activities\(id\) on delete set null/i);
  });

  it('CC 스냅샷을 박아 둔다는 근거가 적혀 있다', () => {
    const raw = read('supabase/migrations/20261127001000_lead_s2_outreach_drafts.sql');
    expect(raw).toContain('승인 시점의');
  });

  it('여러 번 돌려도 같은 결과다', () => {
    for (const m of [U, D]) {
      const adds = m.match(/add column/gi) ?? [];
      expect((m.match(/add column if not exists/gi) ?? []).length).toBe(adds.length);
      const creates = m.match(/create table/gi) ?? [];
      expect((m.match(/create table if not exists/gi) ?? []).length).toBe(creates.length);
    }
  });

  it('롤백·드라이런이 있고 드라이런은 아무것도 남기지 않는다', () => {
    for (const u of ['unsubscribe', 'outreach_drafts']) {
      expect(fs.existsSync(path.resolve(process.cwd(), `../audit/rollback_lead_s2_${u}.sql`)), u).toBe(true);
      const Dr = sqlCode(read(`../audit/dryrun_lead_s2_${u}.sql`));
      expect(Dr, u).toMatch(/^\s*begin;/m);
      expect(Dr.trimEnd().endsWith('rollback;'), u).toBe(true);
      expect(Dr, u).not.toMatch(/\bcommit\b/i);
    }
  });

  it('롤백이 거부 기록을 함부로 지우지 않는다', () => {
    const R = read('../audit/rollback_lead_s2_unsubscribe.sql');
    expect(sqlCode(R)).not.toMatch(/drop column/i);
    expect(R).toMatch(/거부한 사람의 기록이 사라진다/);
    expect(R).toMatch(/이미 나간 메일의 거부 링크가 전부 죽는다/);
  });
});
