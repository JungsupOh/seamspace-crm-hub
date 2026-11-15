// 021-8b-4 — 화면별 정적 검사: 관리자 화면이 rest/v1 을 공개 키로 부르지 않는지
//
// 검사 방법
//   파일 소스를 읽어 `rest/v1/...` 를 부르는 fetch 가 남아 있는지, 그리고
//   Authorization 에 공개 키(SUPABASE_KEY)를 넣는 자리가 남아 있는지를 본다.
//   `functions/v1/...`(엣지 함수) 와 `storage/v1/...`(Storage) 호출은 이 단위의
//   범위가 아니므로 **허용 예외**로 따로 명시한다(021-8a / 021-8e 담당).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf-8');

/** 주석을 걷어낸 실제 코드. 경고 주석이 검사에 걸리지 않게 한다. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}

/** `Authorization: ... SUPABASE_KEY ...` 가 남은 줄 번호. */
function anonAuthLines(src: string): number[] {
  return src.split('\n').flatMap((l, i) =>
    !l.trim().startsWith('//') && /Authorization/.test(l) && /SUPABASE_KEY|ANON_KEY/.test(l)
      ? [i + 1]
      : [],
  );
}

/** 아직 평범한 fetch 로 나가는 rest/v1 호출이 있는지 (같은 줄 또는 바로 다음 줄들). */
function plainRestFetches(src: string): number[] {
  const lines = src.split('\n');
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (!/\bawait fetch\(|\bfetch\(/.test(l)) return;
    if (l.trim().startsWith('//')) return;
    const win = lines.slice(i, i + 4).join('\n');
    if (/rest\/v1\//.test(win)) out.push(i + 1);
  });
  return out;
}

interface ScreenCase {
  file: string;
  /** 공개 키 Authorization 이 남아도 되는 줄의 이유 (엣지 함수·Storage 등). */
  allowedAnonAuth: Array<{ why: string }>;
  /** 평범한 fetch 로 남아도 되는 rest/v1 호출의 이유. */
  allowedPlainRest: Array<{ why: string }>;
}

const SCREENS: ScreenCase[] = [
  {
    file: 'pages/AdminBackfillQuotePdfs.tsx',
    allowedAnonAuth: [],
    allowedPlainRest: [],
  },
];

describe('021-8b-4 — 관리자 화면 rest/v1 호출은 로그인 토큰으로 나간다', () => {
  for (const sc of SCREENS) {
    describe(sc.file, () => {
      const src = read(sc.file);

      it('공개 키를 Authorization 에 넣는 자리가 허용 예외 수만큼만 남아 있다', () => {
        const lines = anonAuthLines(src);
        expect(lines, `남은 줄: ${lines.join(', ')}`).toHaveLength(sc.allowedAnonAuth.length);
      });

      it('rest/v1 호출은 허용 예외를 빼고 전부 authedFetch 로 나간다', () => {
        const lines = plainRestFetches(src);
        expect(lines, `평범한 fetch 로 남은 rest/v1 줄: ${lines.join(', ')}`)
          .toHaveLength(sc.allowedPlainRest.length);
      });

      it('authedFetch 를 import 한다', () => {
        expect(code(src)).toContain("from '@/lib/authedFetch'");
      });

      it('apikey 헤더에는 공개 키를 그대로 둔다 (정상)', () => {
        expect(code(src)).toMatch(/apikey:\s*SUPABASE_KEY/);
      });
    });
  }
});
