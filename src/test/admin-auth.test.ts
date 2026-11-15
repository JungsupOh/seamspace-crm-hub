/**
 * admin-auth — 호출자 역할 판정(폴백 제거) · 부여 가능 역할 · 프로필 UPDATE 구성.
 *
 * **왜 중요한가.** admin-auth 는 **계정을 만들고 역할을 주는** 함수다.
 * 여기가 뚫리면 공격자가 스스로 admin 계정을 찍어 영구 장악할 수 있다(021-6c §3-1).
 * admin-issue-coupon(쿠폰 1장)보다 위험도가 높다.
 *
 * 운영 DB·실제 함수 호출 없이 순수 함수로만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  resolveCallerRole,
  callerVerdict,
  validateAssignRole,
  buildProfileUpdate,
  ADMIN_ROLES,
  ASSIGNABLE_ROLES,
} from '../../supabase/functions/admin-auth/logic';

const ROOT = resolve(__dirname, '../..');
const INDEX_TS = readFileSync(resolve(ROOT, 'supabase/functions/admin-auth/index.ts'), 'utf8');
const LOGIC_TS = readFileSync(resolve(ROOT, 'supabase/functions/admin-auth/logic.ts'), 'utf8');
const USERS_TSX = readFileSync(resolve(ROOT, 'src/pages/Users.tsx'), 'utf8');
const PARTNERS_TSX = readFileSync(resolve(ROOT, 'src/pages/Partners.tsx'), 'utf8');
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20261115000000_harden_handle_new_user.sql'), 'utf8',
);

describe('① 호출자 역할 — user_metadata 폴백 제거', () => {
  it('🔴 프로필 없음 + user_metadata.role=admin → 거절', () => {
    const role = resolveCallerRole(null, { role: 'admin' });
    expect(role).toBe('');
    const v = callerVerdict(role);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.error).toBe('Admin access required');
    }
  });

  it('🔴 프로필 없음 + user_metadata.role=sub_admin → 거절', () => {
    expect(callerVerdict(resolveCallerRole(undefined, { role: 'sub_admin' })).ok).toBe(false);
  });

  it('🔴 프로필 role=null + 메타 admin → 거절', () => {
    expect(resolveCallerRole({ role: null }, { role: 'admin' })).toBe('');
    expect(callerVerdict(resolveCallerRole({ role: null }, { role: 'admin' })).ok).toBe(false);
  });

  it('프로필이 admin 이면 메타가 guest 여도 통과', () => {
    expect(callerVerdict(resolveCallerRole({ role: 'admin' }, { role: 'guest' })).ok).toBe(true);
  });

  it('admin / sub_admin 만 통과, 파트너·guest 는 거절', () => {
    expect(callerVerdict('admin').ok).toBe(true);
    expect(callerVerdict('sub_admin').ok).toBe(true);
    for (const r of ['guest', 'partner_admin', 'partner_member', 'partner_viewer', '', null, undefined]) {
      expect(callerVerdict(r as string).ok, String(r)).toBe(false);
    }
    expect([...ADMIN_ROLES]).toEqual(['admin', 'sub_admin']);
  });

  it('핸들러에 폴백 문자열이 없다', () => {
    expect(INDEX_TS).not.toContain("profile?.role ?? caller.user_metadata?.role");
    expect(INDEX_TS).toContain('resolveCallerRole(profile, caller.user_metadata)');
  });

  it('logic.ts 가 메타데이터 값을 읽지 않는다', () => {
    expect(LOGIC_TS).toContain("return profile?.role ?? '';");
    expect(LOGIC_TS).not.toContain('_userMetadata?.role');
  });

  it('프로필 조회 실패를 fail-closed 로 다룬다', () => {
    expect(INDEX_TS).toContain('error: profileErr');
    expect(INDEX_TS).toContain('user_profiles 조회 실패');
  });
});

describe('② 부여 가능 role 허용 목록', () => {
  it('목록이 실제 호출부에서 쓰는 값과 일치한다', () => {
    // Users.tsx:576-578 의 선택지
    for (const r of ['admin', 'sub_admin', 'guest']) {
      expect(USERS_TSX).toContain(`<SelectItem value="${r}">`);
      expect([...ASSIGNABLE_ROLES]).toContain(r);
    }
    // Partners.tsx:444 의 타입
    expect(PARTNERS_TSX).toContain("'partner_admin' | 'partner_member' | 'partner_viewer'");
    for (const r of ['partner_admin', 'partner_member', 'partner_viewer']) {
      expect([...ASSIGNABLE_ROLES]).toContain(r);
    }
    expect(ASSIGNABLE_ROLES).toHaveLength(6);
  });

  it('6개 값이 DB CHECK 제약과 같다', () => {
    const sql = readFileSync(resolve(ROOT, 'supabase/add_user_roles.sql'), 'utf8');
    for (const r of ASSIGNABLE_ROLES) expect(sql).toContain(`'${r}'`);
  });

  it('허용된 role 은 통과', () => {
    for (const r of ASSIGNABLE_ROLES) {
      const v = validateAssignRole(r);
      expect(v.ok, r).toBe(true);
      if (v.ok) expect(v.role).toBe(r);
    }
  });

  it('🔴 모르는 role 은 400 으로 거절', () => {
    for (const r of ['superuser', 'ADMIN', 'owner', 'partner', 'root', 'admin ']) {
      const v = validateAssignRole(r.trim() === 'admin' ? r : r);
      if (r === 'admin ') { expect(v.ok).toBe(true); continue; }  // 공백은 trim
      expect(v.ok, r).toBe(false);
      if (!v.ok) expect(v.status).toBe(400);
    }
  });

  it("role 을 안 주면 'guest' 로 떨어진다 (트리거 기본값과 일치)", () => {
    for (const v of [undefined, null, '']) {
      const r = validateAssignRole(v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.role).toBe('guest');
    }
    expect(MIGRATION).toContain("'guest',");
  });

  it('문자열이 아니면 400', () => {
    for (const v of [123, true, {}, ['admin']]) {
      expect(validateAssignRole(v).ok, String(v)).toBe(false);
    }
  });
});

describe('③ 생성 직후 프로필 UPDATE 구성', () => {
  const PID = '5a3d8d29-db96-4d6b-82a0-b0f3753f3568';

  it('직원 계정 — role 만 (Users.tsx 경로)', () => {
    expect(buildProfileUpdate({ role: 'sub_admin', name: '홍길동' }))
      .toEqual({ role: 'sub_admin', name: '홍길동' });
  });

  it('파트너 계정 — role + partner_id (Partners.tsx 경로)', () => {
    expect(buildProfileUpdate({ role: 'partner_member', partnerId: PID, name: '김파트너' }))
      .toEqual({ role: 'partner_member', partner_id: PID, name: '김파트너' });
  });

  it('partner_id 가 UUID 가 아니면 넣지 않는다', () => {
    for (const bad of ['not-a-uuid', '', '   ', 123, null, undefined]) {
      const out = buildProfileUpdate({ role: 'partner_member', partnerId: bad });
      expect('partner_id' in out, String(bad)).toBe(false);
    }
  });

  it('name 이 비면 넣지 않는다 — 트리거가 넣은 값을 지우지 않는다', () => {
    for (const n of ['', '   ', null, undefined, 42]) {
      expect('name' in buildProfileUpdate({ role: 'guest', name: n })).toBe(false);
    }
  });

  it('role 은 항상 들어간다', () => {
    expect(buildProfileUpdate({ role: 'admin' })).toEqual({ role: 'admin' });
  });
});

describe('④ 핸들러 구조', () => {
  it('역할 검증을 계정 생성 **전에** 한다 (찌꺼기 방지)', () => {
    const v = INDEX_TS.indexOf('validateAssignRole(meta.role)');
    const c = INDEX_TS.indexOf('auth.admin.createUser');
    expect(v).toBeGreaterThan(-1);
    expect(v).toBeLessThan(c);
  });

  it('createUser 직후 user_profiles 를 UPDATE 한다', () => {
    const c = INDEX_TS.indexOf('auth.admin.createUser');
    const u = INDEX_TS.indexOf('buildProfileUpdate({');
    expect(u).toBeGreaterThan(c);
    expect(INDEX_TS).toContain(".eq('id', newUserId)");
  });

  it('UPDATE 실패 시 500 과 roleAssigned:false 로 알린다 (C-4)', () => {
    expect(INDEX_TS).toContain('roleAssigned: false');
    expect(INDEX_TS).toContain('권한 없음(guest) 상태입니다');
    // 계정을 지우지 않는다 — 선택 근거는 021-6d C-4
    const blk = INDEX_TS.slice(INDEX_TS.indexOf('if (profErr)'), INDEX_TS.indexOf('return jsonResponse({ user: data.user, roleAssigned: true })'));
    expect(blk).not.toContain('deleteUser');
  });

  it('성공 시 roleAssigned:true 를 함께 준다', () => {
    expect(INDEX_TS).toContain('roleAssigned: true');
  });
});

describe('⑤ 마이그레이션 파일', () => {
  it('미적용·같은 배포 경고가 첫 줄에 있다', () => {
    expect(MIGRATION.split('\n')[0]).toContain('미적용');
    expect(MIGRATION.split('\n')[0]).toContain('admin-auth');
    expect(MIGRATION.split('\n')[0]).toContain('James');
  });

  /** 주석(--)을 걷어낸 실행 SQL 만. 주석에는 '무엇이 문제였나' 설명이 들어 있다. */
  const sqlOnly = (src: string) =>
    src.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  it('role 을 메타데이터에서 읽지 않는다 (실행 SQL 기준)', () => {
    const sql = sqlOnly(MIGRATION);
    expect(sql).not.toContain("raw_user_meta_data->>'role'");
    expect(sql).not.toContain("raw_user_meta_data->>'partner_id'");
    expect(sql).toContain("NEW.raw_user_meta_data->>'name'");  // 이름은 그대로
    expect(sql).toContain("'guest'");
  });

  it('ON CONFLICT 에서 role·partner_id 를 덮지 않는다', () => {
    const sql = sqlOnly(MIGRATION);
    const oc = sql.slice(sql.indexOf('ON CONFLICT'));
    expect(oc).toContain('name = COALESCE');
    expect(oc).not.toContain('role = COALESCE');
    expect(oc).not.toContain('partner_id = COALESCE');
  });

  it('롤백 파일이 백업 정의를 되돌린다', () => {
    const rb = readFileSync(
      resolve(ROOT, '../audit/rollback_handle_new_user_20261115.sql'), 'utf8');
    expect(rb).toContain("COALESCE(NEW.raw_user_meta_data->>'role', 'guest')");
    expect(rb).toContain('role = COALESCE(EXCLUDED.role, user_profiles.role)');
    expect(rb.split('\n')[0]).toContain('롤백 전용');
  });
});
