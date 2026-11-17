// 021-8e — Storage 업로드가 **로그인 토큰으로** 가는가 (M031)
//
// 운영 `storage.objects` 를 읽어 보니 (제시카, 2026-11-17)
//   · `deal-files`(공개 버킷): SELECT·INSERT·UPDATE·**DELETE** 가 전부 role `public`
//     + `allow anon upload`. → **anon 키만 있으면 누구나 영업 자료를 덮어쓰고 지운다.**
//   · `campaign-images`: INSERT·UPDATE·DELETE 가 role `public`.
// anon 키는 **공개 화면 자바스크립트에 들어 있다.**
//
// 정책은 제시카가 적용한다(초안은 `audit/h8_drafts/`). 여기서는 **코드 쪽**을 지킨다:
// 로그인한 사람이 올리는 파일은 **로그인 토큰**으로 가야 한다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

/** 로그인 **후**에만 쓰는 업로드 — 토큰으로 가야 한다 */
const LOGGED_IN = [
  { file: 'src/pages/Partners.tsx',   bucket: 'partner-files',    who: '관리자' },
  { file: 'src/lib/storage.ts',       bucket: 'deal-files',       who: '관리자' },
  { file: 'src/pages/Campaigns.tsx',  bucket: 'campaign-images',  who: '관리자' },
] as const;

/** 로그인 **전** 공개 화면이 쓰는 업로드 — 바꾸면 깨진다 */
const PUBLIC_UPLOAD = [
  { file: 'src/lib/luckySeven.ts',      bucket: 'lucky_seven_school_id_files' },
  { file: 'src/lib/luckySevenEmail.ts', bucket: 'lucky_seven_quote_pdfs' },
] as const;

/** 그 파일의 Storage 업로드 호출 덩어리를 꺼낸다 */
function uploadCalls(src: string): string[] {
  const out: string[] = [];
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    // ⚠️ **그 줄 자체가 fetch 호출**이어야 한다. 처음에는 `storage/v1` 이
    //    들어간 줄을 다 봤는데, 공개 URL 을 **문자열로 만드는 줄**까지 잡혀서
    //    (바로 아래 DB insert 의 `method: 'POST'` 를 보고) 헛돌았다.
    if (!/storage\/v1\/object\//.test(l)) return;
    // 호출이 **줄바꿈으로 나뉘어** 있을 수 있다 — 앞 줄도 함께 본다
    const head = `${lines[i - 1] ?? ''}\n${l}`;
    if (!/\b(authedFetch|fetch)\(/.test(head)) return;
    const win = lines.slice(i, i + 10).join('\n');
    if (!/method:\s*'(POST|PUT|DELETE)'/.test(win)) return;
    out.push(lines.slice(Math.max(0, i - 1), i + 10).join('\n'));
  });
  return out;
}

describe('로그인 후 업로드는 **로그인 토큰**으로', () => {
  for (const { file, bucket, who } of LOGGED_IN) {
    describe(`${file} (${bucket}, ${who})`, () => {
      const src = read(file);
      const calls = uploadCalls(src);

      it('업로드 호출을 찾았다 (시험이 헛돌지 않게)', () => {
        expect(calls.length, `${file} 에서 업로드 호출을 못 찾았다`).toBeGreaterThan(0);
      });

      it('**`authedFetch` 로 부른다**', () => {
        for (const c of calls) {
          expect(c, `맨 fetch 로 올린다:\n${c}`).toContain('authedFetch(');
        }
      });

      it('**Authorization 에 공개 키를 넣지 않는다**', () => {
        for (const c of calls) {
          expect(c, `공개 키를 Authorization 에 넣는다:\n${c}`)
            .not.toMatch(/Authorization[^\n]*(SUPABASE_KEY|ANON)/);
        }
      });

      it('`apikey` 는 그대로 둔다 (이건 정상이다)', () => {
        for (const c of calls) expect(c).toContain('apikey: SUPABASE_KEY');
      });

      it('**경로 규칙과 `x-upsert` 가 그대로다** (동작 불변)', () => {
        for (const c of calls) expect(c).toContain("'x-upsert': 'true'");
      });
    });
  }
});

describe('공개 화면 업로드는 **건드리지 않았다**', () => {
  for (const { file, bucket } of PUBLIC_UPLOAD) {
    it(`${file} (${bucket}) — 맨 fetch 그대로`, () => {
      const calls = uploadCalls(read(file));
      expect(calls.length, `${file} 에서 업로드 호출을 못 찾았다`).toBeGreaterThan(0);
      for (const c of calls) {
        // 로그인하지 않은 사람이 쓰는 길이라 토큰이 **없다**
        expect(c, `공개 업로드를 authedFetch 로 바꾸면 깨진다:\n${c}`)
          .not.toContain('authedFetch(');
      }
    });
  }
});

describe('경로 규칙이 바뀌지 않았다', () => {
  it('파트너 파일: `<partnerId>/<종류>-<시각>.<확장자>`', () => {
    expect(read('src/pages/Partners.tsx'))
      .toContain('const path = `${partnerId}/${fileType}-${ts}.${ext}`;');
  });

  it('딜 파일: `deals/<dealId>/<시각>-<이름>.<확장자>`', () => {
    expect(read('src/lib/storage.ts'))
      .toContain('const path = `deals/${dealId}/${ts}-${safe}.${ext}`;');
  });

  it('캠페인 이미지: `<시각>-<uuid>.<확장자>`', () => {
    expect(read('src/pages/Campaigns.tsx'))
      .toContain('const path = `${ts}-${crypto.randomUUID()}.${ext}`;');
  });

  it('공개 URL 을 만드는 방식도 그대로', () => {
    expect(read('src/pages/Partners.tsx'))
      .toContain('storage/v1/object/public/${BUCKET}/${path}');
    expect(read('src/lib/storage.ts'))
      .toContain('storage/v1/object/public/${BUCKET}/${path}');
  });
});

describe('실패 메시지가 그대로다', () => {
  it('파트너 파일', () => {
    expect(read('src/pages/Partners.tsx')).toContain('`업로드 실패: ${uploadRes.status}`');
  });
  it('딜 파일', () => {
    expect(read('src/lib/storage.ts')).toContain('`업로드 실패: ${res.status}`');
  });
  it('캠페인 이미지', () => {
    expect(read('src/pages/Campaigns.tsx')).toContain('`이미지 업로드 실패 (${r.status})`');
  });
});

describe('정책 초안', () => {
  const DIR = '../audit/h8_drafts';
  const ls = () => fs.readdirSync(path.resolve(process.cwd(), DIR));

  it('초안이 **마이그레이션 폴더에 없다**', () => {
    const migs = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'));
    expect(migs.filter(f => /storage|h8|8e/i.test(f))).toEqual([]);
  });

  it('원문이 저장돼 있다 (롤백의 선행 조건)', () => {
    expect(ls()).toContain('h8_before_policies.txt');
    const txt = read(`${DIR}/h8_before_policies.txt`);
    expect(txt).toContain('deal-files public access');
    expect(txt).toContain('allow anon upload');
  });

  it('초안·드라이런·롤백이 있다', () => {
    const f = ls();
    expect(f.some(x => /deal_files/.test(x)), 'deal-files 초안').toBe(true);
    expect(f.some(x => /campaign_images/.test(x)), 'campaign-images 초안').toBe(true);
    expect(f).toContain('h8_dryrun.sql');
    expect(f).toContain('h8_rollback.sql');
  });

  it('**SELECT 를 건드리지 않는다** (이미 나간 공개 링크가 있다)', () => {
    for (const f of ls().filter(x => x.endsWith('.draft'))) {
      const txt = read(`${DIR}/${f}`);
      const live = txt.split('\n').filter(l => !l.trim().startsWith('--'));
      expect(live.join('\n'), `${f} 가 SELECT 정책을 지운다`)
        .not.toMatch(/drop policy[^;]*(public access 1teod06_0|campaign_images_select|campaign_images_public_read)/);
    }
  });

  it('**공개 화면이 쓰는 버킷을 건드리지 않는다**', () => {
    for (const f of ls().filter(x => x.endsWith('.draft'))) {
      const txt = read(`${DIR}/${f}`);
      const live = txt.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
      expect(live, `${f} 가 럭키세븐 버킷을 건드린다`)
        .not.toMatch(/lucky_seven_(quote_pdfs|school_id_files)/);
    }
  });
});
