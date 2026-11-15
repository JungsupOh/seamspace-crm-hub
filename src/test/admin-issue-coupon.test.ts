/**
 * admin-issue-coupon — 인증·역할·입력 검증.
 *
 * **이 테스트가 존재하는 이유.** 021-6 의 핵심은 "누가 쿠폰을 찍을 수 있는가" 하나다.
 * 지금은 공개된 anon 키만 있으면 누구나 create-coupon 을 부를 수 있고(009-6),
 * 이 함수가 그 앞을 막는 관문이 된다. 관문이 실제로 막는지 증명해야 한다.
 *
 * partner-issue-license 는 같은 판정이 핸들러 안에 섞여 있어 테스트할 수 없었다.
 * 여기서는 순수 함수로 떼어 **운영 DB 도 실제 함수 호출도 없이** 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  authVerdict,
  resolveRole,
  roleVerdict,
  validate,
  ALLOWED_ROLES,
  ALLOWED_FIELDS,
} from '../../supabase/functions/admin-issue-coupon/logic';

const ROOT = resolve(__dirname, '../..');
const INDEX_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/admin-issue-coupon/index.ts'), 'utf8',
);
const PARTNER_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/partner-issue-license/index.ts'), 'utf8',
);
const COUPONS_TS = readFileSync(resolve(ROOT, 'src/lib/coupons.ts'), 'utf8');

describe('① JWT 없음 → 401', () => {
  it('Authorization 헤더가 없으면 401', () => {
    expect(authVerdict(null)).toEqual({
      ok: false, status: 401, error: 'Missing authorization header',
    });
    expect(authVerdict(undefined).ok).toBe(false);
    expect(authVerdict('').ok).toBe(false);
  });

  it('Bearer 가 아니면 401', () => {
    for (const h of ['Basic abc', 'bearer abc', 'Token abc', 'abc']) {
      const v = authVerdict(h);
      expect(v.ok, h).toBe(false);
      if (!v.ok) expect(v.status).toBe(401);
    }
  });

  it('Bearer 뒤가 비어 있으면 401', () => {
    expect(authVerdict('Bearer ').ok).toBe(false);
    expect(authVerdict('Bearer    ').ok).toBe(false);
  });

  it('정상 Bearer 면 토큰을 꺼낸다', () => {
    expect(authVerdict('Bearer abc.def.ghi')).toEqual({ ok: true, jwt: 'abc.def.ghi' });
  });

  it('원본 partner-issue-license 와 같은 메시지를 쓴다', () => {
    expect(PARTNER_TS).toContain("error: 'Missing authorization header' }, 401");
    expect(PARTNER_TS).toContain("error: 'Invalid or expired token' }, 401");
    expect(INDEX_TS).toContain("'Invalid or expired token'");
  });
});

describe('② 파트너 역할 → 403', () => {
  it('파트너 세 역할 모두 거절', () => {
    for (const role of ['partner_admin', 'partner_member', 'partner_viewer']) {
      const v = roleVerdict(role);
      expect(v.ok, role).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(403);
        expect(v.error).toBe('관리자만 쿠폰을 발급할 수 있습니다');
      }
    }
  });

  it('partner_admin 도 거절한다 — partner-issue-license 와 다른 점', () => {
    // partner-issue-license 는 partner_admin 을 통과시킨다. 이 함수는 아니다.
    expect(PARTNER_TS).toContain("if (isPartner && role !== 'partner_admin')");
    expect(roleVerdict('partner_admin').ok).toBe(false);
  });

  it('guest·빈 값·모르는 역할도 403', () => {
    for (const role of ['guest', '', '   ', 'superuser', 'ADMIN', undefined, null]) {
      const v = roleVerdict(role as string);
      expect(v.ok, String(role)).toBe(false);
      if (!v.ok) expect(v.status).toBe(403);
    }
  });
});

describe('③ 관리자 역할 → 통과', () => {
  it('admin / sub_admin 만 통과', () => {
    expect(roleVerdict('admin')).toEqual({ ok: true, role: 'admin' });
    expect(roleVerdict('sub_admin')).toEqual({ ok: true, role: 'sub_admin' });
  });

  it('허용 역할 목록이 두 개뿐이다', () => {
    expect([...ALLOWED_ROLES]).toEqual(['admin', 'sub_admin']);
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(roleVerdict(' admin ').ok).toBe(true);
  });
});

describe('④ 입력 검증 — 브라우저가 보내는 3개 필드만', () => {
  const ok = { description: '테스트 쿠폰', duration: '3', user_limit: '40' };

  it('정상 입력 통과', () => {
    expect(validate(ok)).toEqual({ ok: true, value: ok });
  });

  it('브라우저 apiCreateCoupon 이 보내는 필드와 같다', () => {
    // src/lib/coupons.ts:12 — body: JSON.stringify({ description, duration, user_limit })
    expect(COUPONS_TS).toContain('JSON.stringify({ description, duration, user_limit })');
    expect([...ALLOWED_FIELDS]).toEqual(['description', 'duration', 'user_limit']);
  });

  it('모르는 필드가 있으면 거절한다', () => {
    const v = validate({ ...ok, coupon_code: 'FORCED', admin: true });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(400);
      expect(v.error).toContain('coupon_code');
      expect(v.error).toContain('admin');
    }
  });

  it('필수 값이 비면 400', () => {
    expect(validate({ ...ok, duration: '' }).ok).toBe(false);
    expect(validate({ ...ok, user_limit: '  ' }).ok).toBe(false);
    expect(validate({ duration: '3', user_limit: '40' }).ok).toBe(false);  // description 없음
  });

  it('description 은 빈 문자열도 받는다 (원본이 막지 않는다)', () => {
    expect(validate({ ...ok, description: '' }).ok).toBe(true);
  });

  it('숫자로 와도 문자열로 받아 준다 (원본 호출부가 String()으로 보냄)', () => {
    const v = validate({ description: 'x', duration: 3, user_limit: 40 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual({ description: 'x', duration: '3', user_limit: '40' });
  });

  it('본문이 객체가 아니면 400', () => {
    for (const bad of [null, undefined, 'str', 123, [], [1, 2]]) {
      expect(validate(bad).ok, String(bad)).toBe(false);
    }
  });

  it('⚠️ 값 상한은 없다 — 원본에 없으므로 추가하지 않았다', () => {
    const v = validate({ description: 'x', duration: '9999', user_limit: '1000000' });
    expect(v.ok).toBe(true);
    // 원본(coupons.ts / create-coupon)에도 상한 검사가 없음을 함께 고정한다
    expect(COUPONS_TS).not.toMatch(/user_limit\s*>\s*\d/);
    expect(COUPONS_TS).not.toMatch(/MAX_USER|MAX_DURATION/);
  });
});

describe('⑤ 구조 — partner-issue-license 복제 + 응답 호환', () => {
  it('JWT 를 anon 클라이언트로 검증한다 (service_role 로 검증하지 않는다)', () => {
    expect(INDEX_TS).toContain('createClient(SUPABASE_URL, ANON_KEY');
    expect(INDEX_TS).toContain('anon.auth.getUser(auth.jwt)');
    expect(PARTNER_TS).toContain('createClient(SUPABASE_URL, ANON_KEY');
  });

  it('역할을 DB(user_profiles)에서 다시 읽는다 — 본문을 믿지 않는다', () => {
    expect(INDEX_TS).toContain("from('user_profiles')");
    expect(INDEX_TS).toContain(".eq('id', caller.id)");
    // 021-6b: 역할은 resolveRole 이 정하고, user_metadata 폴백은 없다 (⑥ 참고)
    expect(INDEX_TS).toContain('resolveRole(profile, caller.user_metadata)');
  });

  it('create-coupon 호출에 internalHeaders 를 쓴다 (021-1)', () => {
    const i = INDEX_TS.indexOf('functions/v1/create-coupon');
    expect(i).toBeGreaterThan(-1);
    expect(INDEX_TS.slice(i, i + 400)).toContain('internalHeaders()');
  });

  it('응답이 브라우저 apiCreateCoupon 기대와 같다 — 성공 coupon_code / 실패 error', () => {
    // coupons.ts:14-16 — data.coupon_code 를 읽고, data.error 가 있으면 throw
    expect(COUPONS_TS).toContain('if (!res.ok || data.error) throw new Error');
    expect(COUPONS_TS).toContain('return data.coupon_code;');
    expect(INDEX_TS).toContain('return json({ coupon_code: couponJson.coupon_code });');
    expect(INDEX_TS).toContain("json({ error:");
  });

  it('검증 순서가 인증 → 역할 → 입력 이다 (입력 파싱 전에 막는다)', () => {
    const a = INDEX_TS.indexOf('authVerdict(');
    const r = INDEX_TS.indexOf('roleVerdict(');
    const v = INDEX_TS.indexOf('validate(raw)');
    const c = INDEX_TS.indexOf('functions/v1/create-coupon');
    expect(a).toBeLessThan(r);
    expect(r).toBeLessThan(v);
    expect(v).toBeLessThan(c);
  });

  it('user_metadata 폴백이 핸들러에 없다 (021-6b)', () => {
    expect(INDEX_TS).not.toContain("profile?.role ?? caller.user_metadata?.role");
    expect(INDEX_TS).toContain('resolveRole(profile, caller.user_metadata)');
    // 021-6e 에서 partner-issue-license 의 같은 폴백도 제거됐다.
    // (021-6b 시점에는 남아 있었고, 그때 이 줄이 그 사실을 고정하고 있었다)
    expect(PARTNER_TS).not.toContain("profile?.role ?? caller.user_metadata?.role");
  });

  it('파트너 관련 조회가 없다 — 이 함수는 파트너를 다루지 않는다', () => {
    expect(INDEX_TS).not.toContain("from('partners')");
    expect(INDEX_TS).not.toContain('partner_id');
    expect(INDEX_TS).not.toContain('can_issue_licenses');
  });
});

// ════════════════════════════════════════════════════
// 021-6b — user_metadata 폴백 제거 (권한 상승 차단)
// ════════════════════════════════════════════════════

describe('⑥ 역할은 user_profiles 만 믿는다 (user_metadata 폴백 없음)', () => {
  it('🔴 프로필 없음 + user_metadata.role=admin → 거절', () => {
    // 공격 시나리오: 가입만 한 계정이 자기 메타데이터에 role=admin 을 적는다.
    // user_metadata 는 사용자가 스스로 고칠 수 있으므로 믿으면 안 된다.
    const role = resolveRole(null, { role: 'admin' });
    expect(role).toBe('');
    const v = roleVerdict(role);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);
  });

  it('🔴 프로필 없음 + user_metadata.role=sub_admin → 거절', () => {
    expect(roleVerdict(resolveRole(undefined, { role: 'sub_admin' })).ok).toBe(false);
  });

  it('🔴 프로필의 role 이 null 인데 메타데이터가 admin → 거절', () => {
    expect(resolveRole({ role: null }, { role: 'admin' })).toBe('');
    expect(roleVerdict(resolveRole({ role: null }, { role: 'admin' })).ok).toBe(false);
  });

  it('메타데이터가 guest 라도 프로필이 admin 이면 통과 — 프로필이 유일한 근거', () => {
    expect(resolveRole({ role: 'admin' }, { role: 'guest' })).toBe('admin');
    expect(roleVerdict(resolveRole({ role: 'admin' }, { role: 'guest' })).ok).toBe(true);
  });

  it('메타데이터가 비어 있어도 프로필만으로 판정한다', () => {
    expect(resolveRole({ role: 'sub_admin' }, null)).toBe('sub_admin');
    expect(resolveRole({ role: 'sub_admin' })).toBe('sub_admin');
  });

  it('프로필이 파트너면 그대로 파트너로 판정되어 403', () => {
    expect(resolveRole({ role: 'partner_admin' }, { role: 'admin' })).toBe('partner_admin');
    expect(roleVerdict(resolveRole({ role: 'partner_admin' }, { role: 'admin' })).ok).toBe(false);
  });

  it('logic.ts 안에 user_metadata 를 읽는 코드가 없다', () => {
    const LOGIC_TS = readFileSync(
      resolve(ROOT, 'supabase/functions/admin-issue-coupon/logic.ts'), 'utf8',
    );
    // 주석에는 설명으로 등장하지만, 코드에서 값을 꺼내 쓰지는 않는다
    expect(LOGIC_TS).not.toContain('_userMetadata?.role');
    expect(LOGIC_TS).not.toContain('userMetadata.role');
    expect(LOGIC_TS).toContain("return profile?.role ?? '';");
  });

  it('프로필 조회 실패를 fail-closed 로 다룬다', () => {
    expect(INDEX_TS).toContain('error: profileErr');
    expect(INDEX_TS).toContain('user_profiles 조회 실패');
  });
});
