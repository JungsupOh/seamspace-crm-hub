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
  /** rest/v1 을 직접 부르지 않는 파일(엣지 함수만 쓰는 화면)은 import·apikey 검사를 건너뛴다. */
  noRestOfItsOwn?: boolean;
}

const SCREENS: ScreenCase[] = [
  {
    file: 'pages/AdminBackfillQuotePdfs.tsx',
    allowedAnonAuth: [],
    allowedPlainRest: [],
  },
  {
    file: 'pages/Index.tsx',
    allowedAnonAuth: [],
    allowedPlainRest: [],
  },
  {
    file: 'pages/Licenses.tsx',
    // 엣지 함수 호출 4건은 이 단위 범위가 아니다(021-8a).
    // create-coupon 직접 호출은 HARD-A H-2 에서 admin-issue-coupon 경유로 바뀌었고
    // (사본을 lib/coupons.ts 로 합쳤다), 나머지 엣지 함수 3개는 021-8a 담당이다.
    allowedAnonAuth: [
      { why: 'functions/v1/send-coupon' },
      { why: 'functions/v1/sync-new-coupons' },
      { why: 'functions/v1/get-coupon-status' },
    ],
    allowedPlainRest: [],
  },
  {
    file: 'pages/Contacts.tsx',
    allowedAnonAuth: [],
    allowedPlainRest: [],
  },
  {
    file: 'pages/Partners.tsx',
    allowedAnonAuth: [
      { why: ':157 Storage 업로드(partner-files 버킷) — 021-8e 담당' },
      { why: ':227 functions/v1/ocr-partner-doc — 021-8a 담당' },
    ],
    // :425 admin-auth 는 이미 session.access_token 을 쓴다(021-8b-1).
    allowedPlainRest: [],
  },
  {
    file: 'pages/Deals.tsx',
    allowedAnonAuth: [],
    // :1432, :1530, :2641 은 Storage 공개 URL 을 그냥 내려받는 fetch 로
    // rest/v1 호출이 아니고 Authorization 도 없다 → 전환 대상이 아니다.
    allowedPlainRest: [],
  },
  {
    file: 'pages/ShopOrders.tsx',
    allowedAnonAuth: [
      { why: ':318 functions/v1/send-shop-alimtok — 021-8a 담당' },
    ],
    allowedPlainRest: [],
  },
  {
    file: 'pages/Campaigns.tsx',
    allowedAnonAuth: [
      { why: ':1124 Storage 업로드(campaign-images 버킷) — 021-8e 담당' },
      { why: ':1218 functions/v1/get-coupon-status — 021-8a 담당' },
    ],
    allowedPlainRest: [],
  },
  {
    file: 'lib/apk.ts',
    // 공개 /apk/info 가 쓰는 조회 3개는 로그인하지 않은 방문자용이라 공개 키를 유지한다.
    allowedAnonAuth: [{ why: ':14 PUBLIC_HEADERS — 공개 /apk/info 전용 (021-8d 담당)' }],
    // HARD-B2a 에서 findSubscriberByEmail 이 관리자용(토큰)으로 바뀌었다.
    // 공개 /apk/info 는 lib/public/apkPublic.ts 의 사본을 쓴다 → 허용 예외 3 → 2.
    allowedPlainRest: [
      { why: 'findSubscriberByToken — 호출자 0(죽은 코드), 공개 토큰 조회용' },
      { why: 'listDownloadsByEmail — 공개 ApkInfo.tsx 가 씀 (021-8d)' },
    ],
  },
  {
    file: 'pages/Apk.tsx',
    // 이 화면 자체는 rest/v1 을 직접 부르지 않는다. DB 접근은 전부 lib/apk.ts 경유.
    allowedAnonAuth: [
      { why: ':83 functions/v1/apk-broadcast — 021-8a 담당' },
      { why: ':695 functions/v1/apk-subscribe — 021-8a 담당' },
    ],
    allowedPlainRest: [],
    noRestOfItsOwn: true,
  },
  {
    file: 'lib/alimtalk.ts',
    // :15 FN_HEADERS 는 엣지 함수 send-alimtalk 호출용이라 공개 키를 그대로 둔다.
    allowedAnonAuth: [{ why: ':15 FN_HEADERS — functions/v1/send-alimtalk (021-8a 담당)' }],
    allowedPlainRest: [],
  },
  {
    file: 'lib/partner-expiry.ts',
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

      it.skipIf(sc.noRestOfItsOwn)('authedFetch 를 import 한다', () => {
        expect(code(src)).toMatch(/from '(@\/lib|\.)\/authedFetch'/);
      });

      it.skipIf(sc.noRestOfItsOwn)('apikey 헤더에는 공개 키를 그대로 둔다 (정상)', () => {
        expect(code(src)).toMatch(/apikey:\s*SUPABASE_KEY/);
      });
    });
  }
});
