// HARD-A H-1 — 럭키세븐 정리 / airtable 폴백 제거 / 결제 승인 결함
//
// 순수 테스트. 운영 DB·실제 함수 호출 없음.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateInput,
  matchVerdict,
} from '../../supabase/functions/confirm-lucky-seven-pay/logic';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
/** 주석을 걷어낸 실제 코드. 설명 주석이 검사에 걸리지 않게 한다. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ────────────────────────────────────────────────────────────
describe('H-1 (1) 럭키세븐 공개 라우트가 안내 페이지로 교체됐다', () => {
  const APP = read('src/App.tsx');
  const ROUTES = [
    '/event/lucky-seven',
    '/event/lucky-seven/pay/complete',
    '/event/lucky-seven/pay/fail',
    '/event/lucky-seven/pay/:quoteNumber',
    '/event/lucky-seven/status',
  ];

  it('5개 라우트 주소가 그대로 남아 있다 (주소는 유지)', () => {
    for (const r of ROUTES) {
      expect(APP, r).toContain(`path="${r}"`);
    }
  });

  it('5개 라우트 모두 LuckySevenClosed 를 쓴다', () => {
    for (const r of ROUTES) {
      const m = APP.match(new RegExp(`path="${r.replace(/[/:]/g, '\\$&')}" element=\\{<(\\w+)`));
      expect(m?.[1], r).toBe('LuckySevenClosed');
    }
  });

  it('공개 라우트에서 옛 럭키세븐 화면을 더 이상 쓰지 않는다', () => {
    const c = code(APP);
    for (const comp of ['LuckySevenForm', 'LuckySevenPay', 'LuckySevenPayComplete',
                        'LuckySevenPayFail', 'LuckySevenStatus']) {
      expect(c, comp).not.toContain(`<${comp} `);
      expect(c, comp).not.toContain(`<${comp}/`);
      expect(c, `${comp} import`).not.toContain(`from "./pages/${comp}"`);
    }
  });

  it('옛 화면 파일은 지우지 않았다 (감사·되돌리기용)', () => {
    for (const f of ['LuckySevenForm', 'LuckySevenPay', 'LuckySevenPayComplete',
                     'LuckySevenPayFail', 'LuckySevenStatus']) {
      expect(() => read(`src/pages/${f}.tsx`), f).not.toThrow();
    }
  });

  it('안내 페이지는 DB·스토리지·엣지 함수를 전혀 건드리지 않는다', () => {
    const SRC = read('src/pages/LuckySevenClosed.tsx');
    expect(SRC).not.toContain('rest/v1');
    expect(SRC).not.toContain('functions/v1');
    expect(SRC).not.toContain('storage/v1');
    expect(SRC).not.toContain('fetch(');
    expect(SRC).not.toContain('SUPABASE_KEY');
  });

  it('안내 페이지에 종료 안내와 기존 톤의 문의처가 있다', () => {
    const SRC = read('src/pages/LuckySevenClosed.tsx');
    expect(SRC).toContain('종료된 이벤트입니다');
    expect(SRC).toContain('sales@tebahsoft.com');   // 국내 영업 채널 (기존 페이지와 같다)
  });
});

// ────────────────────────────────────────────────────────────
describe('H-1 (2) 관리자 다이얼로그가 로그인 토큰으로 호출한다', () => {
  const SRC = read('src/components/LuckySevenGroupDialog.tsx');

  it('공개 키를 Authorization 에 넣는 자리가 없다', () => {
    const lines = SRC.split('\n').filter(l => !l.trim().startsWith('//'));
    const bad = lines.filter(l => /Authorization/.test(l) && /SUPABASE_KEY/.test(l));
    expect(bad, bad.join(' | ')).toHaveLength(0);
  });

  it('rest/v1 호출이 전부 authedFetch 다', () => {
    const lines = SRC.split('\n');
    const plain: number[] = [];
    lines.forEach((l, i) => {
      if (!/\bfetch\(/.test(l) || l.includes('authedFetch') || l.trim().startsWith('//')) return;
      if (/rest\/v1\//.test(lines.slice(i, i + 10).join('\n'))) plain.push(i + 1);
    });
    expect(plain, `평범한 fetch 로 남은 줄: ${plain.join(', ')}`).toHaveLength(0);
  });

  it('authedFetch 를 import 하고 apikey 는 공개 키를 유지한다', () => {
    expect(code(SRC)).toContain("from '@/lib/authedFetch'");
    expect(code(SRC)).toMatch(/apikey:\s*SUPABASE_KEY/);
  });
});

// ────────────────────────────────────────────────────────────
describe('H-1 (3) confirm-lucky-seven-pay — orderId ↔ 견적번호 대조', () => {
  const ok = { paymentKey: 'pk_test', orderId: 'LS-2026-0001', amount: 70000, quoteNumber: 'LS-2026-0001' };
  const row = (over: Record<string, unknown> = {}) =>
    [{ id: 'pg1', quote_number: 'LS-2026-0001', amount: 70000, status: '견적발송', ...over }];

  describe('입력 검증 (원본과 같은 규칙)', () => {
    it('네 값이 다 있으면 통과하고 숫자로 정규화한다', () => {
      const v = validateInput({ ...ok, amount: '70000' });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.value.amount).toBe(70000);
    });

    for (const [name, body] of [
      ['paymentKey 없음', { ...ok, paymentKey: '' }],
      ['orderId 없음', { ...ok, orderId: '' }],
      ['amount 0', { ...ok, amount: 0 }],
      ['quoteNumber 없음', { ...ok, quoteNumber: '' }],
      ['amount 숫자 아님', { ...ok, amount: 'abc' }],
      ['amount 음수', { ...ok, amount: -1 }],
    ] as const) {
      it(`${name} → 400 필수 파라미터 누락`, () => {
        const v = validateInput(body as Record<string, unknown>);
        expect(v.ok).toBe(false);
        if (v.ok === false) { expect(v.status).toBe(400); expect(v.error).toContain('필수 파라미터'); }
      });
    }
  });

  describe('결제묶음 대조', () => {
    it('맞는 요청은 통과한다', () => {
      // 같은 함수를 두 번 부르면 좁히기가 이어지지 않는다 — 한 번만 부르고 변수에 담는다
      const parsed = validateInput(ok);
      expect(parsed.ok).toBe(true);
      const v = matchVerdict(row(), parsed.ok === true ? parsed.value : (ok as never));
      expect(v).toEqual({ ok: true, alreadyPaid: false });
    });

    it('견적이 없으면 404 (원본과 같은 문구)', () => {
      const v = matchVerdict([], ok);
      expect(v).toEqual({ ok: false, status: 404, error: '견적서를 찾을 수 없습니다' });
    });

    it('이미 결제완료면 멱등 응답을 유지한다', () => {
      const v = matchVerdict(row({ status: '결제완료' }), ok);
      expect(v).toEqual({ ok: true, alreadyPaid: true });
    });

    it('금액이 다르면 400 (원본과 같은 문구)', () => {
      const v = matchVerdict(row({ amount: 60000 }), ok);
      expect(v).toEqual({ ok: false, status: 400, error: '결제 금액 불일치' });
    });

    // ★ 이 단위에서 고친 결함 — 021-7R §C-1
    it('금액은 같지만 orderId 가 남의 견적이면 거절한다 (고친 결함)', () => {
      const attack = { ...ok, orderId: 'LS-2026-9999' };   // 다른 묶음의 주문번호
      const v = matchVerdict(row(), attack);
      expect(v.ok).toBe(false);
      if (v.ok === false) {
        expect(v.status).toBe(400);
        expect(v.error).toContain('일치하지 않습니다');
      }
    });

    it('대조는 요청값끼리가 아니라 DB 행의 quote_number 와 한다', () => {
      // 조회가 느슨해져 다른 행이 와도 걸러야 한다.
      const v = matchVerdict(row({ quote_number: 'LS-2026-0002' }), ok);
      expect(v.ok).toBe(false);
    });

    it('행에 quote_number 가 없으면 거절한다 (빈 값으로 통과 금지)', () => {
      const v = matchVerdict(row({ quote_number: null }), ok);
      expect(v.ok).toBe(false);
    });

    it('판정 순서를 보존한다 — 이미결제가 금액·orderId 검사보다 앞', () => {
      const v = matchVerdict(row({ status: '결제완료', amount: 1, quote_number: 'OTHER' }), ok);
      expect(v).toEqual({ ok: true, alreadyPaid: true });
    });
  });

  describe('핸들러가 Toss 승인 전에 대조한다', () => {
    const IDX = read('supabase/functions/confirm-lucky-seven-pay/index.ts');
    it('matchVerdict 가 confirmTossPayment 보다 먼저 나온다', () => {
      const c = code(IDX);
      expect(c.indexOf('matchVerdict(')).toBeGreaterThan(-1);
      expect(c.indexOf('matchVerdict(')).toBeLessThan(c.indexOf('confirmTossPayment('));
    });
    it('검증을 순수 로직에 위임한다 (핸들러에 옛 인라인 검사가 없다)', () => {
      const c = code(IDX);
      expect(c).not.toContain('Number(pg.amount) !== Number(amount)');
      expect(c).toContain('validateInput(');
    });
  });
});

// ────────────────────────────────────────────────────────────
describe('H-1 (4) airtable.ts 의 공개 키 폴백이 사라졌다', () => {
  const SRC = read('src/lib/airtable.ts');
  const C = code(SRC);

  it('Authorization 에 들어가는 값은 세션 토큰뿐이다', () => {
    const bearers = [...C.matchAll(/Bearer \$\{([^}]+)\}/g)].map(m => m[1].trim());
    expect(bearers).toEqual(['session.access_token']);
  });

  // 음성 테스트 — 폴백을 되살리면 깨진다
  it('세션이 없을 때 공개 키로 대체하는 분기가 없다', () => {
    expect(C).not.toMatch(/Bearer \$\{SUPABASE_KEY\}/);
    expect(C).not.toMatch(/access_token\s*\?\?\s*SUPABASE_KEY/);
  });

  it('세션이 없으면 오류를 던진다', () => {
    expect(C).toContain('AIRTABLE_NO_SESSION_ERROR');
    expect(C).toMatch(/if \(!session\?\.access_token\) throw new Error/);
  });

  it('Range 페이지네이션을 유지하고 new Headers() 를 쓰지 않는다', () => {
    expect(C).not.toContain('new Headers(');
    expect(C).toContain("Range: `${offset}-${offset + PAGE_SIZE - 1}`");
    expect(C).toContain("'Range-Unit': 'items'");
  });

  it('공개 경로는 airtable 을 호출하는 함수를 가져가지 않는다', () => {
    // luckySeven.ts 에서 airtable 을 쓰는 함수는 createDealFromLuckySevenGroup 하나뿐이고,
    // 공개 화면(/c, /order)은 upsertLeadContact 만 가져간다.
    const LS = read('src/lib/luckySeven.ts');
    const airtableLines = LS.split('\n').filter(l => /airtable\./.test(l) && !l.trim().startsWith('//'));
    expect(airtableLines).toHaveLength(1);

    for (const f of ['src/pages/CampaignForm.tsx', 'src/pages/OrderTest.tsx']) {
      const m = read(f).match(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/luckySeven'/s);
      const names = (m?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      expect(names, f).not.toContain('createDealFromLuckySevenGroup');
    }
  });

  // HARD-B2a 에서 contacts 코어가 src/lib/public/leadContact.ts 로 옮겨졌다.
  // 검사 대상만 그 파일로 옮기고, 확인하는 사실("공개 경로가 쓰는 함수는 airtable 을
  // 거치지 않는다")은 그대로 둔다.
  it('공개 contacts 코어는 airtable 을 쓰지 않는다 (공개 경로가 쓰는 함수)', () => {
    const CORE = read('src/lib/public/leadContact.ts');
    expect(CORE).toContain('export async function upsertLeadContactCore');
    expect(CORE).not.toContain('airtable');

    // luckySeven 쪽 래퍼도 airtable 을 거치지 않는다
    const LS = read('src/lib/luckySeven.ts');
    const start = LS.indexOf('export function upsertLeadContact');
    expect(start).toBeGreaterThan(-1);
    const next = LS.indexOf('\nexport ', start + 10);
    expect(LS.slice(start, next === -1 ? undefined : next)).not.toContain('airtable.');
  });
});
