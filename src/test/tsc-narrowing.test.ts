// 타입 오류가 **다시 늘지 않게** (M022)
//
// 36건이 전부 같은 원인이었다: **`strictNullChecks: false` 는 참·거짓으로 유니온을
// 좁히지 못한다.** `if (!v.ok)` 가 좁히지 않으니 `v.error` 가 "없는 칸"이 된다.
// `v.ok === false` 로 적으면 좁혀진다 — **런타임은 똑같다.**
//
// ⚠️ 진짜 보증은 `npx tsc --noEmit -p tsconfig.app.json` 이 **0** 이라는 것이고,
//    그건 CI 에서 해야 합니다(결과 문서에 적었습니다). 여기서는 **이번에 고친
//    자리가 되돌아가지 않는지**만 싸게 봅니다 — `fetch` 의 `Response.ok` 와
//    판별 유니온을 글자로는 가를 수 없어서, 글 검사를 전체로 돌리면 틀립니다
//    (한 번 그렇게 했다가 멀쩡한 줄 수십 개를 잡았다).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

/** 이번 정리에서 고친 파일 */
const TOUCHED = [
  'src/test/admin-auth.test.ts',
  'src/test/admin-issue-coupon.test.ts',
  'src/test/hard-a-h1.test.ts',
  'src/test/hard-a-h3.test.ts',
  'src/test/hard-b2b.test.ts',
  'src/test/hard-b2c.test.ts',
  'src/test/lead-s1-core.test.ts',
  'src/test/campaign-submit-lead.test.ts',
  'supabase/functions/admin-auth/logic.ts',
] as const;

/** 판별 유니온을 담는 변수 이름(그 파일들에서 실제로 쓰는 것). `res`·`r` 은 fetch 다. */
const VERDICT_VARS = ['v', 'rv', 'parsed', 'd', 'verdict'];

describe('고친 자리가 되돌아가지 않았다', () => {
  it('파일을 실제로 읽었다', () => {
    for (const f of TOUCHED) expect(read(f).length, f).toBeGreaterThan(100);
  });

  it('**판별 변수에 `if (!x.ok)` 가 없다**', () => {
    const bad: string[] = [];
    for (const f of TOUCHED) {
      read(f).split('\n').forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
        for (const v of VERDICT_VARS) {
          if (new RegExp(`\\(!${v}\\.(ok|allow)\\)`).test(l)) {
            bad.push(`${f}:${i + 1}  ${l.trim()}`);
          }
        }
      });
    }
    expect(bad, `\`=== false\` 로 바꾸세요:\n${bad.join('\n')}`).toEqual([]);
  });

  it('`=== false` 로 좁힌 자리가 남아 있다', () => {
    const withNarrowing = TOUCHED.filter(f => /\.(ok|allow) === false\)/.test(read(f)));
    expect(withNarrowing.length).toBeGreaterThanOrEqual(6);
  });

  it('운영 코드(admin-auth/logic.ts)도 고쳤다', () => {
    const logic = read('supabase/functions/admin-auth/logic.ts');
    expect(logic).toContain('.ok === false)');
    expect(logic).not.toMatch(/\(!\w+\.ok\)/);
  });
});

describe('좁히기를 **우회하지 않았다**', () => {
  it('`@ts-ignore`·`@ts-expect-error` 를 넣지 않았다', () => {
    for (const f of TOUCHED) {
      expect(read(f), f).not.toContain('@ts-ignore');
      expect(read(f), f).not.toContain('@ts-expect-error');
    }
  });

  it('`as any` 를 넣지 않았다', () => {
    for (const f of TOUCHED) expect(read(f), f).not.toMatch(/\bas any\b/);
  });

  it('**`!` 단언을 오히려 없앴다**', () => {
    // `validateInput(ok).value!` — 같은 함수를 두 번 불러 좁히기가 끊기니
    // `!` 로 때우고 있었다. 한 번만 부르도록 바꾸면서 단언이 사라졌다.
    const h1 = read('src/test/hard-a-h1.test.ts');
    expect(h1).not.toContain('validateInput(ok).value!');
    expect(h1).toContain('const parsed = validateInput(ok);');
  });

  it('판별 칸 자체를 바꾸지 않았다 (유니온 정의는 그대로)', () => {
    const logic = read('supabase/functions/admin-auth/logic.ts');
    expect(logic).toContain('| { ok: true; role: string }');
    expect(logic).toContain("| { ok: false; status: 403; error: string }");
  });
});
