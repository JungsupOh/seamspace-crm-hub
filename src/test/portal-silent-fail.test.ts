// 포털의 **조용한 실패**를 알려 준다 (M032)
//
// 무엇이 문제였나
//   발급·재발송·회수 뒤에 이용권 목록을 다시 읽는데, 그 호출이 전부
//   `.catch(() => {})` 로 **실패를 삼켰다.** 그래서
//   **발급은 됐는데 목록이 안 바뀌고** → 파트너가 "안 됐나 보다" 하고
//   **두 번 발급**할 수 있었다. 두 번 발급은 쿠폰이 두 장 나가는 일이다.
//
// ⚠️ 문구가 "발급이 실패했다"로 읽히면 **더 확실하게 두 번 누른다.**
//    정확한 말은 **"했던 일은 됐을 수 있다. 새로고침해서 보고 나서 다시 하라"** 다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { REFRESH_FAIL_MSG } from '../lib/partnerPortalMsg';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const SRC = read('src/pages/PartnerPortal.tsx');
/** 주석을 뺀 코드만 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('**실패를 삼키는 곳이 없다**', () => {
  it('`.catch(() => {})` 가 하나도 없다', () => {
    const bad: string[] = [];
    CODE.split('\n').forEach((l, i) => {
      if (/\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(l)) bad.push(`${i + 1}: ${l.trim()}`);
    });
    expect(bad, `조용히 삼키는 곳:\n${bad.join('\n')}`).toEqual([]);
  });

  it('목록 새로고침이 **한 함수**를 지난다 (문구가 흩어지지 않게)', () => {
    expect(CODE).toContain('const refreshLicenses = (pid?: string | null) =>');
    // 직접 부르는 곳은 **첫 로드 하나뿐**이고, 그것도 조용하지 않다(아래 시험)
    const direct = CODE.match(/getPartnerLicenses\(/g) ?? [];
    expect(direct.length, '직접 호출이 둘 이상이다').toBe(2);   // 헬퍼 안 1 + 첫 로드 1
  });

  it('**첫 로드도 조용하지 않다** — 빈 목록은 거짓말이다', () => {
    // 실패인데 빈 목록을 보여 주면 "발급한 게 없네" 로 읽혀서 또 발급하게 된다.
    expect(CODE).toContain('.catch(() => { setLicenses([]); toast.warning(t(REFRESH_FAIL_MSG)); })');
    expect(CODE).not.toContain('.catch(() => setLicenses([]))');
  });

  it('그 함수가 **여러 곳**에서 쓰인다', () => {
    const n = (CODE.match(/refreshLicenses\(/g) ?? []).length;
    expect(n, '한 군데서만 쓰면 묶은 의미가 없다').toBeGreaterThanOrEqual(5);
  });

  it('실패하면 **알려 준다**', () => {
    const fn = CODE.slice(CODE.indexOf('const refreshLicenses'),
                          CODE.indexOf('const refreshLicenses') + 400);
    expect(fn).toContain('.catch(() => toast.warning(t(REFRESH_FAIL_MSG)))');
  });

  it('**성공하면 아무 말도 하지 않는다**', () => {
    const fn = CODE.slice(CODE.indexOf('const refreshLicenses'),
                          CODE.indexOf('const refreshLicenses') + 400);
    // then 에는 setLicenses 뿐 — 성공 토스트를 넣으면 시끄럽다
    expect(fn).toContain('.then(setLicenses)');
    expect(fn).not.toMatch(/\.then\([^)]*toast/);
  });

  it('구매자 갱신도 알려 준다', () => {
    expect(CODE).toContain('await updateDealBuyer(bId, patch).catch(() => { touched = false; });');
    expect(CODE).toContain('if (!touched || !refreshed) toast.warning(t(REFRESH_FAIL_MSG));');
  });
});

describe('문구 — **발급이 실패했다는 뜻이 아니다**', () => {
  it('세 언어가 다 있다', () => {
    for (const l of ['ko', 'ja', 'en'] as const) {
      expect(REFRESH_FAIL_MSG[l], l).toBeTruthy();
      if (l !== 'ko') expect(REFRESH_FAIL_MSG[l], l).not.toMatch(/[가-힣]/);
    }
  });

  it('**"됐을 수 있다"** 를 말한다', () => {
    expect(REFRESH_FAIL_MSG.ko).toContain('완료됐을 수 있');
    expect(REFRESH_FAIL_MSG.en).toContain('may have completed');
    expect(REFRESH_FAIL_MSG.ja).toContain('完了している可能性');
  });

  it('**"새로고침해서 확인한 뒤"** 를 말한다', () => {
    expect(REFRESH_FAIL_MSG.ko).toContain('새로고침해서 확인한 뒤');
    expect(REFRESH_FAIL_MSG.en).toContain('refresh to check before trying again');
  });

  it('**"실패했다"로 읽히지 않는다**', () => {
    // "발급 실패"·"처리 실패" 같은 말이 들어가면 두 번 누르게 된다
    expect(REFRESH_FAIL_MSG.ko).not.toMatch(/발급(이|에)?\s*실패|처리(가|에)?\s*실패/);
    expect(REFRESH_FAIL_MSG.en).not.toMatch(/\bfailed to (issue|revoke|resend)\b/i);
  });

  it('문구가 **한 곳에만** 있다', () => {
    // 화면에 같은 말을 또 적어 두지 않았다
    expect(CODE).not.toContain('목록을 새로 불러오지 못했습니다');
    expect((CODE.match(/REFRESH_FAIL_MSG/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('성공 경로는 그대로다', () => {
  it('발급·재발송·회수·만료의 성공 토스트가 살아 있다', () => {
    for (const probe of ['이용권 발급 완료', '재발송 완료', '회수되었습니다',
                         '그룹을 만료시켰습니다', '구매자에 연결했습니다']) {
      expect(SRC, probe).toContain(probe);
    }
  });

  it('`toast.warning` 은 **새로고침 실패에만** 쓴다', () => {
    const warns = CODE.match(/toast\.warning\([^;]*\)/g) ?? [];
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns) expect(w, w).toContain('REFRESH_FAIL_MSG');
  });
});
