// S4 후속 보완 — 수신 거부 문구의 자리와 언어
//
// S4 가 (d)(e)(f) 를 처리했고, 운영에서 남은 구멍 둘을 고친다.
//   ① **언어를 바꾸면 그 줄도 바뀐다** — 전에는 한글 문구가 영어 메일에 남았다
//   ② 새 초안에 **쓸 자리를 먼저** 비워 둔다

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  UNSUBSCRIBE_BASE, appendUnsubscribeLine, hasUnsubscribeLine, newDraftBody,
  replaceUnsubscribeLine, unsubscribeLine, unsubscribeUrl,
} from '../lib/outreach';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const PANEL = read('src/components/leads/OutreachPanel.tsx');

const TOK = '11111111-2222-3333-4444-555555555555';
const URL = `${UNSUBSCRIBE_BASE}/${TOK}`;
const KO = unsubscribeLine(TOK, 'ko')!;
const EN = unsubscribeLine(TOK, 'en')!;

// ══════════════════ ① 언어 ══════════════════
describe('**언어를 바꾸면 거부 문구도 바뀐다**', () => {
  it('한국어 → 영어', () => {
    const before = appendUnsubscribeLine('안녕하세요.', TOK, 'ko');
    expect(before).toContain('수신을 거부');

    const after = replaceUnsubscribeLine(before, TOK, 'en');
    expect(after).not.toContain('수신을 거부');
    expect(after).toContain('unsubscribe here');
    expect(after).toContain('안녕하세요.');      // 사람이 쓴 글은 그대로
  });

  it('영어 → 한국어', () => {
    const before = appendUnsubscribeLine('Hello.', TOK, 'en');
    const after = replaceUnsubscribeLine(before, TOK, 'ko');
    expect(after).toContain('수신을 거부');
    expect(after).not.toContain('unsubscribe here');
    expect(after).toContain('Hello.');
  });

  it('**왜 이게 필요했나** — `append` 는 링크로만 보니 못 바꾼다', () => {
    const ko = appendUnsubscribeLine('Hello.', TOK, 'ko');
    // 전에 쓰던 길: 링크가 같아서 "이미 있다"로 보고 한글이 남았다
    expect(appendUnsubscribeLine(ko, TOK, 'en')).toContain('수신을 거부');
    // 고친 길
    expect(replaceUnsubscribeLine(ko, TOK, 'en')).not.toContain('수신을 거부');
  });

  it('**자리를 지킨다** — 끝에 있던 줄은 끝에 남는다', () => {
    const before = `첫 줄\n둘째 줄\n\n${KO}`;
    const after = replaceUnsubscribeLine(before, TOK, 'en');
    expect(after.split('\n').at(-1)).toBe(EN);
    expect(after.split('\n').slice(0, 2)).toEqual(['첫 줄', '둘째 줄']);
  });

  it('가운데 있어도 그 자리에서 바꾼다 (사람이 옮겨 놓았을 수 있다)', () => {
    const before = `위\n${KO}\n아래`;
    expect(replaceUnsubscribeLine(before, TOK, 'en')).toBe(`위\n${EN}\n아래`);
  });

  it('**두 줄이 있으면 하나로 줄인다**', () => {
    const before = `글\n${KO}\n중간\n${EN}`;
    const after = replaceUnsubscribeLine(before, TOK, 'en');
    expect((after.match(new RegExp(URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length)
      .toBe(1);
    expect(after).toContain('글');
    expect(after).toContain('중간');
  });

  it('없으면 끝에 붙인다', () => {
    expect(replaceUnsubscribeLine('글만 있다', TOK, 'en')).toBe(`글만 있다\n\n${EN}`);
    expect(hasUnsubscribeLine(replaceUnsubscribeLine('글', TOK, 'ko'), TOK)).toBe(true);
  });

  it('토큰이 없으면 아무것도 하지 않는다 (링크를 지어내지 않는다)', () => {
    expect(replaceUnsubscribeLine('글', null, 'en')).toBe('글');
    expect(replaceUnsubscribeLine('글', 'not-a-uuid', 'en')).toBe('글');
    expect(unsubscribeUrl('not-a-uuid')).toBeNull();
  });

  it('본문이 문자열이 아니어도 터지지 않는다', () => {
    expect(replaceUnsubscribeLine(null, TOK, 'en')).toBe(EN);
    expect(replaceUnsubscribeLine(7, TOK, 'ko')).toBe(KO);
  });
});

// ══════════════════ ② 새 초안 ══════════════════
describe('새 초안 — **쓸 자리를 먼저** 준다', () => {
  it('거부 문구 위에 빈 줄이 있다', () => {
    const b = newDraftBody(TOK, 'en');
    expect(b.startsWith('\n\n')).toBe(true);
    expect(b.trimStart()).toBe(EN);
  });

  it('언어를 따른다', () => {
    expect(newDraftBody(TOK, 'ko').trimStart()).toBe(KO);
  });

  it('토큰이 없으면 빈 본문', () => {
    expect(newDraftBody(null, 'en')).toBe('');
    expect(newDraftBody('nope', 'ko')).toBe('');
  });

  it('**거부 문구는 여전히 맨 끝**', () => {
    const b = newDraftBody(TOK, 'en');
    expect(b.split('\n').at(-1)).toBe(EN);
  });

  it('여기에 글을 쓴 뒤 "다시 넣기"를 눌러도 두 번 들어가지 않는다', () => {
    const typed = `Hello,\n\nWe would like to…${newDraftBody(TOK, 'en')}`;
    const again = appendUnsubscribeLine(typed, TOK, 'en');
    expect((again.match(/unsubscribe here/g) ?? []).length).toBe(1);
  });
});

// ══════════════════ 화면 연결 ══════════════════
describe('화면', () => {
  it('언어가 바뀌면 줄을 갈아 끼운다', () => {
    expect(PANEL).toContain('replaceUnsubscribeLine(b, lead.unsubscribe_token, lang)');
  });

  it('새 초안에는 쓸 자리를 준다', () => {
    expect(PANEL).toContain('newDraftBody(lead.unsubscribe_token, lang)');
    expect(PANEL).toContain("if (!b.trim() && !existing)");
  });

  it('**"다시 넣기"는 여전히 끝에 붙인다** (커서 자리가 아니라)', () => {
    expect(PANEL).toContain('appendUnsubscribeLine(b, lead.unsubscribe_token, lang)');
    // 거부 문구를 커서에 넣는 길이 없다
    expect(PANEL).not.toMatch(/insertAtCursor\(\s*unsubLine/);
  });

  it('S4 가 한 (e)(f) 가 그대로다', () => {
    // (e) 미정 사실은 **언어에 맞는 문구만**
    expect(PANEL).toContain('insertAtCursor(pendingFactPhrase(lang))');
    expect(PANEL).not.toMatch(/insertAtCursor\(`\(\$\{f\.label_ko\}/);
    // (f) 점검 대상은 수신자에게 나갈 글만
    expect(PANEL).toContain('findRiskyPhrases(outgoingText(subject, body))');
  });
});

describe('범위', () => {
  it('마이그레이션을 더하지 않았다', () => {
    const newer = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
      .filter(f => /^\d{14}_/.test(f) && f.slice(0, 14) > '20261206000000');
    expect(newer).toEqual([]);
  });

  it('억제 규칙을 건드리지 않았다', () => {
    const src = read('src/lib/outreach.ts');
    expect(src).toContain('export function checkSuppression');
    // 거부한 사람에게 보내는 길이 생기지 않았다
    expect(src).not.toMatch(/unsubscribed_at[^\n]*(ignore|skip|false)/i);
  });
});
