// LEAD-S7-5 — 파트너 계정 초대·비활성화·감사 로그
//
// 지켜야 하는 약속
//   ① `partner_id` 는 **호출자 프로필에서 서버가 정한다**(파트너 관리자는 본문 무시).
//   ② 파트너 관리자가 줄 수 있는 역할은 **member·viewer 뿐**.
//   ③ 자기 자신·**마지막 관리자**는 비활성화하지 못한다.
//   ④ 남의 파트너 계정은 **있는지 없는지도** 알려 주지 않는다.
//   ⑤ 감사 기록은 **아무도 고치거나 지울 수 없고**, 이메일은 **마스킹**한다.
//   ⑥ **임시 비밀번호를 응답·로그에 담지 않는다.**
//   ⑦ 기존 `admin-auth` 를 건드리지 않는다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  ACTIONS, PARTNER_ASSIGNABLE, alreadyInState, auditEntry, canActOnTarget,
  canUseAccounts, denialMessage, isOurAdmin, maskEmail, pickLocale,
  resolvePartnerId, toAction, validateEmail, validateRole,
  type Caller, type TargetProfile,
} from '../../supabase/functions/partner-accounts/logic';
import {
  ROLE_OPTIONS, activeAdminCount, cannotDeactivate, type PartnerAccount,
} from '../lib/partnerAccounts';
import { ACCOUNT_MSG, AUDIT_ACTION_MSG, ROLE_MSG, STATUS_MSG } from '../lib/partnerPortalMsg';
import type { Msg } from '../lib/partner-i18n';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const MIG = read('supabase/migrations/20261203000000_lead_s7_5_partner_audit_log.sql');
const DRY = read('../audit/dryrun_lead_s7_5_audit.sql');
const FN  = read('supabase/functions/partner-accounts/index.ts');

const PA: Caller = { role: 'partner_admin', partnerId: 'p1', id: 'u-admin' };
const OUR: Caller = { role: 'admin', partnerId: null, id: 'u-ops' };
const PM: Caller = { role: 'partner_member', partnerId: 'p1', id: 'u-mem' };

const T = (o: Partial<TargetProfile> = {}): TargetProfile => ({
  id: 'u-t', role: 'partner_member', partner_id: 'p1', status: 'active', ...o,
});

// ══════════════════════ 누가 쓸 수 있나 ══════════════════════
describe('계정 관리 권한', () => {
  it('파트너 관리자와 우리만', () => {
    expect(canUseAccounts('partner_admin')).toBe(true);
    expect(canUseAccounts('admin')).toBe(true);
    expect(canUseAccounts('sub_admin')).toBe(true);
    expect(canUseAccounts('partner_member')).toBe(false);
    expect(canUseAccounts('partner_viewer')).toBe(false);
    expect(canUseAccounts('guest')).toBe(false);
    expect(canUseAccounts('')).toBe(false);
  });

  it('동작 네 가지', () => {
    expect([...ACTIONS]).toEqual(['invite', 'deactivate', 'reactivate', 'changeRole']);
    expect(toAction('invite')).toBe('invite');
    expect(toAction('deleteUser')).toBeNull();
  });
});

// ══════════════════════ partner_id 강제 ══════════════════════
describe('**partner_id 는 서버가 정한다**', () => {
  it('파트너 관리자는 본문을 **무시한다**', () => {
    expect(resolvePartnerId(PA, 'someone-else')).toBe('p1');
    expect(resolvePartnerId(PA, null)).toBe('p1');
  });

  it('우리(admin)만 본문으로 고를 수 있다', () => {
    expect(resolvePartnerId(OUR, 'p-target')).toBe('p-target');
    expect(resolvePartnerId(OUR, null)).toBeNull();
  });

  it('함수가 호출자 프로필에서 읽는다', () => {
    expect(FN).toContain('resolvePartnerId(caller, body.partnerId)');
    expect(FN).toContain("from('user_profiles')");
    expect(FN).toMatch(/partnerId: \(profile\?\.partner_id as string \| null\) \?\? null/);
  });
});

// ══════════════════════ 줄 수 있는 역할 ══════════════════════
describe('**파트너 관리자는 member·viewer 만** 줄 수 있다', () => {
  it('허용 목록이 둘뿐', () => {
    expect([...PARTNER_ASSIGNABLE]).toEqual(['partner_member', 'partner_viewer']);
    expect(ROLE_OPTIONS).toEqual(['partner_member', 'partner_viewer']);
  });

  it('**partner_admin 부여는 거부**', () => {
    expect(validateRole(PA, 'partner_admin')).toMatchObject({ ok: false, error: 'BAD_ROLE' });
  });

  it('우리 역할(admin)도 거부', () => {
    for (const r of ['admin', 'sub_admin', 'guest', '', null, 7]) {
      expect(validateRole(PA, r), String(r)).toMatchObject({ ok: false });
    }
  });

  it('member·viewer 는 통과', () => {
    expect(validateRole(PA, 'partner_member')).toMatchObject({ ok: true });
    expect(validateRole(PA, 'partner_viewer')).toMatchObject({ ok: true });
  });

  it('우리(admin)는 partner_admin 까지 줄 수 있다', () => {
    expect(validateRole(OUR, 'partner_admin')).toMatchObject({ ok: true });
    // 그래도 우리 역할은 이 함수로 못 준다 — admin-auth 가 할 일이다
    expect(validateRole(OUR, 'admin')).toMatchObject({ ok: false });
  });

  it('isOurAdmin', () => {
    expect(isOurAdmin('admin')).toBe(true);
    expect(isOurAdmin('partner_admin')).toBe(false);
  });
});

// ══════════════════════ 대상 판정 ══════════════════════
describe('대상에게 손댈 수 있는가', () => {
  it('**다른 파트너면 있는지 없는지도 알려 주지 않는다**', () => {
    const r = canActOnTarget(PA, 'p1', T({ partner_id: 'p2' }), 'deactivate', 2);
    expect(r).toMatchObject({ ok: false, error: 'TARGET_OTHER_PARTNER' });
    // 없는 대상도 **같은 코드**다 — 떠보기를 막는다
    expect(canActOnTarget(PA, 'p1', null, 'deactivate', 2))
      .toMatchObject({ ok: false, error: 'TARGET_OTHER_PARTNER' });
  });

  it('**파트너 계정이 아니면 건드릴 수 없다** (우리 직원)', () => {
    expect(canActOnTarget(PA, 'p1', T({ role: 'sub_admin' }), 'deactivate', 2))
      .toMatchObject({ ok: false, error: 'TARGET_NOT_PARTNER' });
  });

  it('**자기 자신은 비활성화 못 한다**', () => {
    expect(canActOnTarget(PA, 'p1', T({ id: 'u-admin', role: 'partner_admin' }), 'deactivate', 2))
      .toMatchObject({ ok: false, error: 'SELF_DEACTIVATE' });
  });

  it('**마지막 관리자는 비활성화도 역할 변경도 못 한다**', () => {
    const last = T({ id: 'u-other', role: 'partner_admin' });
    expect(canActOnTarget(PA, 'p1', last, 'deactivate', 1))
      .toMatchObject({ ok: false, error: 'LAST_ADMIN' });
    expect(canActOnTarget(OUR, 'p1', last, 'changeRole', 1))
      .toMatchObject({ ok: false, error: 'LAST_ADMIN' });
  });

  it('관리자가 둘이면 한 명은 내릴 수 있다 (우리만)', () => {
    const other = T({ id: 'u-other', role: 'partner_admin' });
    expect(canActOnTarget(OUR, 'p1', other, 'deactivate', 2)).toMatchObject({ ok: true });
    // 파트너 관리자는 다른 **관리자**의 역할을 못 바꾼다
    expect(canActOnTarget(PA, 'p1', other, 'changeRole', 2))
      .toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
  });

  it('평범한 운영자는 비활성화할 수 있다', () => {
    expect(canActOnTarget(PA, 'p1', T(), 'deactivate', 1)).toMatchObject({ ok: true });
  });

  it('이미 그 상태면 아무 일도 하지 않는다', () => {
    expect(alreadyInState(T({ status: 'inactive' }), 'deactivate')).toBe(true);
    expect(alreadyInState(T({ status: 'active' }), 'reactivate')).toBe(true);
    expect(alreadyInState(T({ status: 'active' }), 'deactivate')).toBe(false);
  });
});

describe('화면도 같은 규칙으로 미리 막는다', () => {
  const A = (o: Partial<PartnerAccount> = {}): PartnerAccount => ({
    id: 'a1', name: null, role: 'partner_member', status: 'active', created_at: null, ...o,
  });

  it('활성 관리자 수', () => {
    expect(activeAdminCount([
      A({ id: 'x', role: 'partner_admin' }),
      A({ id: 'y', role: 'partner_admin', status: 'inactive' }),
      A({ id: 'z' }),
    ])).toBe(1);
  });

  it('자기 자신·마지막 관리자를 막는다', () => {
    const me = A({ id: 'me', role: 'partner_admin' });
    const all = [me, A({ id: 'other' })];
    expect(cannotDeactivate(me, 'me', all)).toBe('self');
    expect(cannotDeactivate(A({ id: 'x', role: 'partner_admin' }), 'me',
      [A({ id: 'x', role: 'partner_admin' })])).toBe('last_admin');
    expect(cannotDeactivate(A({ id: 'other' }), 'me', all)).toBeNull();
  });
});

// ══════════════════════ 이메일·기록 ══════════════════════
describe('이메일', () => {
  it('모양을 본다', () => {
    expect(validateEmail('a@b.com')).toMatchObject({ ok: true, email: 'a@b.com' });
    expect(validateEmail(' A@B.COM ')).toMatchObject({ ok: true, email: 'a@b.com' });
    for (const v of ['', 'nope', 'a@b', '@b.com', null, 7, 'a b@c.com']) {
      expect(validateEmail(v), String(v)).toMatchObject({ ok: false });
    }
  });

  it('**기록에는 마스킹해서 넣는다**', () => {
    expect(maskEmail('kim.lee@school.edu.sg')).toBe('ki***@sc***.sg');
    expect(maskEmail('a@b.com')).toBe('a***@b***.com');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('없는모양')).toBe('***');
  });

  it('**원본 이메일이 기록에 들어가지 않는다**', () => {
    const e = auditEntry({
      caller: PA, partnerId: 'p1', action: 'invite',
      targetUserId: 'u-new', email: 'kim.lee@school.edu.sg', role: 'partner_member',
    });
    const s = JSON.stringify(e);
    expect(s).not.toContain('kim.lee@school.edu.sg');
    expect(s).not.toContain('school.edu');
    expect(e.meta.email).toBe('ki***@sc***.sg');
    expect(e.actor_id).toBe('u-admin');
    expect(e.partner_id).toBe('p1');
  });

  it('역할 변경은 전·후를 남긴다', () => {
    const e = auditEntry({
      caller: PA, partnerId: 'p1', action: 'role_change',
      targetUserId: 'u-t', role: 'partner_viewer', from: 'partner_member',
    });
    expect(e.meta).toEqual({ role: 'partner_viewer', from: 'partner_member' });
  });
});

// ══════════════════════ 비밀번호 ══════════════════════
describe('**임시 비밀번호가 새어 나가지 않는다**', () => {
  it('응답에 담지 않는다', () => {
    const c = code(FN);
    // tempPassword() 의 결과를 json(...) 에 넣는 곳이 없다
    expect(c).not.toMatch(/password[^\n]*json\(/);
    expect(c).toMatch(/password: tempPassword\(\)/);
    const ret = c.slice(c.indexOf('return json({ ok: true, user_id'));
    expect(ret.slice(0, 200)).not.toContain('password');
  });

  it('로그에도 담지 않는다', () => {
    for (const m of FN.match(/console\.(log|warn|error)\([^)]*\)/g) ?? []) {
      expect(m, m).not.toMatch(/password|email|tempPassword/i);
    }
  });

  it('비밀번호는 본인이 재설정으로 정한다고 적어 두었다', () => {
    expect(FN).toContain('비밀번호 재설정');
    expect(ACCOUNT_MSG.inviteHint.en).toContain('reset link');
  });
});

// ══════════════════════ 문구 ══════════════════════
describe('문구 — 세 언어', () => {
  it('거절 문구가 다 있다', () => {
    const codes = ['NOT_ALLOWED', 'BAD_ACTION', 'BAD_EMAIL', 'BAD_ROLE', 'TARGET_REQUIRED',
      'TARGET_OTHER_PARTNER', 'TARGET_NOT_PARTNER', 'SELF_DEACTIVATE', 'LAST_ADMIN',
      'PARTNER_REQUIRED', 'ALREADY'] as const;
    for (const c of codes) {
      for (const l of ['ko', 'ja', 'en'] as const) {
        const m = denialMessage(c, l);
        expect(m, `${c}/${l}`).toBeTruthy();
        if (l !== 'ko') expect(m, `${c}/${l}`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it('화면 문구도 다 있다', () => {
    for (const [k, m] of Object.entries(ACCOUNT_MSG)) {
      expect((m as Msg).ko, `${k}.ko`).toBeTruthy();
      expect((m as Msg).ja, `${k}.ja`).toBeTruthy();
      expect((m as Msg).en, `${k}.en`).toBeTruthy();
      expect((m as Msg).en, `${k}.en`).not.toMatch(/[가-힣]/);
    }
  });

  it('역할·상태·기록 이름이 다 이어져 있다', () => {
    for (const r of ['partner_admin', 'partner_member', 'partner_viewer'] as const) {
      expect(ROLE_MSG[r], r).toBeTruthy();
    }
    for (const s of ['invited', 'active', 'inactive'] as const) {
      expect(STATUS_MSG[s], s).toBeTruthy();
    }
    for (const a of ['invite', 'invite_failed', 'deactivate', 'reactivate', 'role_change'] as const) {
      expect(AUDIT_ACTION_MSG[a], a).toBeTruthy();
    }
  });

  it('**관리자 역할은 우리가 준다**고 화면이 말한다', () => {
    expect(ACCOUNT_MSG.roleHint.en).toContain('We assign the Administrator role');
  });

  it('언어 고르기', () => {
    expect(pickLocale('ko')).toBe('ko');
    expect(pickLocale('ja')).toBe('ja');
    expect(pickLocale('tr')).toBe('en');
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('감사 표 — 읽기만, 아무도 못 고친다', () => {
  it('**INSERT 정책이 없다** (service_role 만 넣는다)', () => {
    expect(sql(MIG)).not.toMatch(/create policy[^;]*for insert/i);
    expect(sql(MIG)).not.toMatch(/grant[^;]*insert[^;]*partner_audit_log/i);
  });

  it('UPDATE·DELETE 를 restrictive 로 못 박는다', () => {
    const c = sql(MIG);
    expect(c).toMatch(/as restrictive for update to public using \( false \)/);
    expect(c).toMatch(/as restrictive for delete to public using \( false \)/);
  });

  it('**읽기는 파트너 관리자와 우리만**', () => {
    const p = (MIG.match(/create policy "partner_audit_log_select"[\s\S]*?;/) ?? [''])[0];
    expect(p).toMatch(/for select/);
    expect(p).toContain("= 'partner_admin'");
    expect(p).toMatch(/array\['admin','sub_admin'\]/);
  });

  it('권한은 SELECT 만', () => {
    const c = sql(MIG);
    expect(c).toContain('revoke all on public.partner_audit_log from anon');
    expect(c).toContain('revoke all on public.partner_audit_log from public');
    expect(c).toMatch(/grant select on public\.partner_audit_log to authenticated/);
  });

  it('동작 이름을 CHECK 로 좁힌다', () => {
    expect(sql(MIG)).toMatch(/check \(action in \('invite', 'invite_failed', 'deactivate', 'reactivate', 'role_change'\)\)/);
  });

  it('외래키는 restrict, auth.users 를 참조하지 않는다', () => {
    const c = sql(MIG);
    expect(c).toMatch(/references public\.partners\(id\) on delete restrict/);
    expect(c).not.toMatch(/references auth\.users/);
  });
});

describe('드라이런 — 실제 역할 전환', () => {
  it('psql 전용 없이 한 파일', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sql(DRY)).toMatch(/^\s*begin;/m);
    expect(sql(DRY).trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('**세 역할로 바꿔 본다** (파트너 관리자·운영자·우리 admin)', () => {
    const sw = DRY.match(/set local role authenticated/g) ?? [];
    expect(sw.length, '역할 전환이 모자란다').toBeGreaterThanOrEqual(3);
    expect((DRY.match(/reset role/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(DRY).toContain('request.jwt.claims');
  });

  it('요구한 시험이 다 있다', () => {
    for (const probe of ['파트너 관리자: 자기 회사 기록', '파트너 관리자: 남의 회사 기록',
                         '파트너 관리자: INSERT', '파트너 관리자: UPDATE', '파트너 관리자: DELETE',
                         '운영자·게스트: 기록 SELECT', 'admin: 전체 기록 SELECT', 'admin: DELETE',
                         'anon 권한 (없어야)', 'authenticated INSERT (없어야)']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('마이그레이션 본문이 들어 있다', () => {
    expect(DRY).toContain('create table if not exists public.partner_audit_log');
    expect(DRY).toContain('partner_audit_log_no_delete');
  });
});

// ══════════════════════ 범위 ══════════════════════
describe('기존 admin-auth 를 건드리지 않았다', () => {
  const AA = read('supabase/functions/admin-auth/index.ts');
  const AL = read('supabase/functions/admin-auth/logic.ts');

  it('문지기(admin·sub_admin 만)가 그대로다', () => {
    expect(AA).toContain('callerVerdict');
    expect(AL).toMatch(/export const ADMIN_ROLES = \['admin', 'sub_admin'\] as const;/);
  });

  it('새 action 을 admin-auth 에 넣지 않았다', () => {
    for (const a of ['invite', 'deactivate', 'reactivate', 'changeRole']) {
      expect(AA, a).not.toMatch(new RegExp(`case '${a}'`));
    }
  });

  it('왜 새 함수를 만들었는지 적어 두었다', () => {
    const lg = read('supabase/functions/partner-accounts/logic.ts');
    expect(lg).toContain('admin-auth');
    expect(lg).toContain('가장 위험한 자리');
  });

  it('키·개인정보를 담지 않는다', () => {
    for (const f of ['supabase/functions/partner-accounts/logic.ts', 'src/lib/partnerAccounts.ts',
                     'src/components/partner-portal/PortalAccounts.tsx']) {
      const c = code(read(f));
      expect(c, f).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_SERVICE/);
    }
  });

  it('포털 계정 목록이 **이메일을 가져오지 않는다**', () => {
    const api = code(read('src/lib/partnerAccounts.ts'));
    expect(api).toMatch(/select=id,name,role,status,created_at/);
    expect(api).not.toMatch(/select=[^`]*email/);
  });
});
