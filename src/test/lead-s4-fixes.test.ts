// LEAD-S4 §4·§5 후속 보완 6개 — 제시카 운영 확인에서 나온 것들
//
//   §4 (S1 후속)
//     (a) 결과·알게 된 점을 **받은 기록(답장)**에서도 적을 수 있게 + 그것도 전략 수정 안내
//     (b) caveat 의 `**` 가 글자로 보임 → 굵게 렌더링(저장값은 건드리지 않는다)
//     (c) 신호 칩을 눌러도 '추가'를 눌러야 저장되는데 저장된 줄 알기 쉬움
//   §5 (S2 후속)
//     (d) "거부 문구 다시 넣기" 가 본문 맨 앞에 줄바꿈 없이 들어감 → **끝**에, 중복 금지
//     (e) 영어 초안에 미정 사실을 넣으면 **한글 라벨이 섞임** → 언어에 맞는 문장만
//     (f) 문구 점검 대상은 **수신자에게 나갈 글만**

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendUnsubscribeLine, findRiskyPhrases, hasUnsubscribeLine, outgoingText,
  pendingFactPhrase, unsubscribeLine,
} from '../lib/outreach';
import { pendingRevision, suggestsRevision } from '../lib/leadStrategy';
import { stripEmphasis } from '../components/leads/Emphasis';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const TOK = '11111111-2222-3333-4444-555555555555';

// ══════════════════ (a) 받은 기록의 결과 ══════════════════
describe('(a) 받은 기록에서도 결과를 적는다', () => {
  const A = (id: string, o: Record<string, unknown> = {}) =>
    ({ id, direction: 'out', summary: '메일 보냄', occurred_at: '2026-11-15T00:00:00Z', ...o });

  it('**받은 기록의 결과도** 전략 수정 안내를 띄운다', () => {
    const got = A('in1', { direction: 'in', summary: '답장 받음', outcome: 'replied' });
    expect(pendingRevision([got], [])?.id).toBe('in1');
  });

  it('보낸 기록의 결과도 그대로 띄운다 (전과 같다)', () => {
    expect(pendingRevision([A('o1', { outcome: 'meeting' })], [])?.id).toBe('o1');
  });

  it('시스템 기록은 여전히 세지 않는다', () => {
    const sys = A('s1', { summary: '[변경] 국가: (비어 있음) → SG', outcome: 'replied' });
    expect(pendingRevision([sys], [])).toBeNull();
    const arch = A('s2', { summary: '[보관] 보관함: 시험', outcome: 'replied' });
    expect(pendingRevision([arch], [])).toBeNull();
  });

  it('취소된 기록은 세지 않는다', () => {
    const v = A('v1', { direction: 'in', outcome: 'replied', voided_at: 'x' });
    expect(pendingRevision([v], [])).toBeNull();
  });

  it('고칠 만한 결과가 아니면 묻지 않는다', () => {
    expect(pendingRevision([A('n', { direction: 'in', outcome: 'no_reply' })], [])).toBeNull();
    expect(suggestsRevision('no_reply')).toBe(false);
  });

  it('**차수는 여전히 보낸 기록만** 센다 (요구가 명시한 규칙 유지)', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    expect(d).toContain("attemptNo: log.direction === 'out' ? nextAttemptNo");
    expect(d).toContain('받은 기록은 접촉 차수에 세지 않습니다');
  });

  it('결과·알게 된 점 칸이 방향과 무관하게 보인다', () => {
    const d = read('src/components/leads/LeadDetail.tsx');
    // 전에는 `{log.direction === 'out' && (` 로 감싸 받은 기록에서 안 보였다
    expect(d).not.toMatch(/\{log\.direction === 'out' && \(\s*\n\s*<div className="flex gap-2">\s*\n\s*<div className="w-\[150px\]">\s*\n\s*<Label className="text-xs">결과/);
    expect(d).toContain('>결과<');
  });
});

// ══════════════════ (b) caveat 의 ** ══════════════════
describe('(b) 주의 문구의 ** 를 글자로 보이지 않게', () => {
  it('별표를 떼어 평문으로 만든다 (title 속성처럼 HTML 을 못 쓰는 자리용)', () => {
    expect(stripEmphasis('가격은 확정이지만 **재고와 배송은 미정**이다'))
      .toBe('가격은 확정이지만 재고와 배송은 미정이다');
  });

  it('별표가 없으면 그대로', () => {
    expect(stripEmphasis('그냥 문구')).toBe('그냥 문구');
    expect(stripEmphasis(null)).toBe('');
  });

  it('짝이 안 맞는 별표는 남긴다 (함부로 지우지 않는다)', () => {
    expect(stripEmphasis('**열렸는데 안 닫힘')).toBe('**열렸는데 안 닫힘');
  });

  it('**저장값은 건드리지 않는다** — 보여 줄 때만 바꾼다', () => {
    const f = read('src/pages/LeadFacts.tsx');
    // 저장 경로에는 별표 제거가 없다
    const at = f.indexOf("caveat: f.caveat.trim() || null");
    expect(at).toBeGreaterThan(-1);
    expect(f.slice(at, at + 80)).not.toContain('stripEmphasis');
    expect(f.slice(at, at + 80)).not.toContain('Emphasis');
  });

  it('사실 보드와 전략 툴팁이 굵게 렌더링한다', () => {
    expect(read('src/pages/LeadFacts.tsx')).toContain('<Emphasis text={fact.caveat} />');
    expect(read('src/components/leads/StrategyPanel.tsx')).toContain('<Emphasis text={f.caveat} />');
  });

  it('HTML 을 못 쓰는 title 속성에서는 별표를 뗀다', () => {
    expect(read('src/components/leads/OutreachPanel.tsx')).toContain('stripEmphasis(f.caveat)');
  });

  it('마크다운 렌더러를 쓰지 않는다 (입력이 화면을 바꾸면 안 된다)', () => {
    const e = read('src/components/leads/Emphasis.tsx');
    expect(e).not.toMatch(/dangerouslySetInnerHTML|marked|remark|react-markdown/);
    expect(e).toContain('입력이 화면을 바꿀 수 있다');
  });
});

// ══════════════════ (c) 신호 칩 ══════════════════
describe('(c) 칩을 눌러도 저장이 아니라는 것을 분명히', () => {
  const p = read('src/components/leads/SignalsPanel.tsx');

  it('고른 칩이 눈에 띄게 다르다 (체크 + 채운 배경)', () => {
    expect(p).toContain('aria-pressed={type === t}');
    expect(p).toContain('<Check className="h-3 w-3" />');
    expect(p).toContain('bg-primary text-primary-foreground');
  });

  it('"아직 저장되지 않았습니다" 를 글자로 알려 준다', () => {
    expect(p).toContain('아직 저장되지 않았습니다');
  });

  it('버튼에 고른 유형 이름이 들어간다', () => {
    expect(p).toContain('${SIGNAL_LABEL[type]} 추가');
  });

  it('**칩을 누를 때 저장하지 않는다** (고른 안을 코드로 고정)', () => {
    // 칩의 onClick 은 setType 만 한다
    const at = p.indexOf('SIGNAL_TYPES.map');
    const seg = p.slice(at, at + 600);
    expect(seg).toContain('onClick={() => setType(t)}');
    expect(seg).not.toContain('add.mutate');
  });
});

// ══════════════════ (d) 거부 문구 자리 ══════════════════
describe('(d) 거부 문구는 본문 끝에 — 중복 금지', () => {
  const line = unsubscribeLine(TOK, 'en')!;

  it('본문 **끝**에 빈 줄 한 줄 띄워 붙인다', () => {
    expect(appendUnsubscribeLine('Hello', TOK, 'en')).toBe(`Hello\n\n${line}`);
  });

  it('빈 본문이면 문구만 (앞에 빈 줄을 만들지 않는다)', () => {
    expect(appendUnsubscribeLine('', TOK, 'en')).toBe(line);
    expect(appendUnsubscribeLine('   \n\n ', TOK, 'en')).toBe(line);
  });

  it('끝의 공백·줄바꿈을 정리하고 붙인다', () => {
    expect(appendUnsubscribeLine('Hello\n\n\n  ', TOK, 'en')).toBe(`Hello\n\n${line}`);
  });

  it('**이미 들어 있으면 넣지 않는다** (중복 방지)', () => {
    const once = appendUnsubscribeLine('Hello', TOK, 'en');
    expect(appendUnsubscribeLine(once, TOK, 'en')).toBe(once);
    // 세 번 불러도 한 번만 들어 있다
    const thrice = appendUnsubscribeLine(appendUnsubscribeLine(once, TOK, 'en'), TOK, 'en');
    expect(thrice.split(TOK)).toHaveLength(2);
  });

  it('**맨 앞에 넣지 않는다** (전에 그랬다)', () => {
    const out = appendUnsubscribeLine('Hello', TOK, 'en');
    expect(out.startsWith('Hello')).toBe(true);
    expect(out.startsWith(line)).toBe(false);
  });

  it('토큰이 없으면 본문을 건드리지 않는다', () => {
    expect(appendUnsubscribeLine('Hello', 'bad-token', 'en')).toBe('Hello');
    expect(appendUnsubscribeLine('Hello', null, 'en')).toBe('Hello');
  });

  it('한국어 문구도 같은 규칙', () => {
    const ko = unsubscribeLine(TOK, 'ko')!;
    expect(appendUnsubscribeLine('안녕하세요', TOK, 'ko')).toBe(`안녕하세요\n\n${ko}`);
  });

  it('붙인 뒤에는 검사를 통과한다', () => {
    expect(hasUnsubscribeLine(appendUnsubscribeLine('Hi', TOK, 'en'), TOK)).toBe(true);
  });

  it('화면이 "다시 넣기"와 기본 본문에 **같은 함수**를 쓴다', () => {
    const o = read('src/components/leads/OutreachPanel.tsx');
    expect((o.match(/appendUnsubscribeLine\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 커서 위치에 넣는 옛 방식이 남아 있지 않다
    expect(o).not.toContain('insertAtCursor(`\\n\\n${unsubLine}`)');
  });
});

// ══════════════════ (e) 미정 사실 문구 ══════════════════
describe('(e) 미정 사실은 언어에 맞는 문장만', () => {
  it('영어 초안에는 **영어만** (한글 라벨이 섞이지 않는다)', () => {
    const en = pendingFactPhrase('en');
    expect(en).toBe('We will confirm and get back to you on this.');
    expect(en).not.toMatch(/[가-힣]/);
  });

  it('한국어 초안에는 한국어', () => {
    expect(pendingFactPhrase('ko')).toBe('확인 후 안내드리겠습니다.');
  });

  it('라벨을 괄호로 넣지 않는다 (전에 `(구독 가격 (해외): …)` 로 들어갔다)', () => {
    for (const l of ['en', 'ko'] as const) {
      expect(pendingFactPhrase(l)).not.toContain('(');
      expect(pendingFactPhrase(l)).not.toContain(':');
    }
  });

  it('화면이 라벨을 본문에 넣지 않고 안내로만 알린다', () => {
    const o = read('src/components/leads/OutreachPanel.tsx');
    const at = o.indexOf('const insertPending');
    const seg = o.slice(at, at + 420);
    expect(seg).toContain('insertAtCursor(pendingFactPhrase(lang))');
    expect(seg).toContain('toast.info');          // 라벨은 토스트로만
    expect(seg).not.toContain('${f.label_ko}:');  // 본문에 라벨을 넣지 않는다
  });
});

// ══════════════════ (f) 점검 대상 ══════════════════
describe('(f) 문구 점검은 수신자에게 나갈 글만', () => {
  it('제목과 본문만 본다', () => {
    expect(outgoingText('Hi', 'Body')).toBe('Hi\nBody');
    expect(outgoingText(null, null)).toBe('\n');
  });

  it('(e) 를 고치니 한글 라벨 때문에 걸리는 일이 사라졌다', () => {
    // 전: `(구독 가격 (해외): we will confirm…)` → 괄호 안 한글이 본문에 들어갔다
    const before = '(구독 가격 (해외): we will confirm and get back to you)';
    const after = pendingFactPhrase('en');
    // 두 경우 모두 위험 표현은 아니지만, after 에는 한글이 아예 없다
    expect(before).toMatch(/[가-힣]/);
    expect(after).not.toMatch(/[가-힣]/);
    expect(findRiskyPhrases(after)).toEqual([]);
  });

  it('미정 사실 문구 자체가 위험 표현으로 걸리지 않는다', () => {
    for (const l of ['en', 'ko'] as const) {
      expect(findRiskyPhrases(pendingFactPhrase(l)), l).toEqual([]);
    }
  });

  it('화면과 승인 검사가 **같은 함수**로 점검 대상을 만든다', () => {
    expect(read('src/components/leads/OutreachPanel.tsx'))
      .toContain('findRiskyPhrases(outgoingText(subject, body))');
    expect(read('src/lib/outreach.ts'))
      .toContain('findRiskyPhrases(outgoingText(a.subject, a.body))');
  });

  it('화면의 안내 문구를 점검 대상에 섞지 않는다', () => {
    const o = read('src/components/leads/OutreachPanel.tsx');
    // 점검에 넘기는 것은 subject·body 뿐이다
    expect(o).not.toMatch(/findRiskyPhrases\([^)]*label/);
  });
});
