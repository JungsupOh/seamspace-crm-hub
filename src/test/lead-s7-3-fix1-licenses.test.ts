// LEAD-S7-3 fix1 — 파트너가 발급 원장을 고치지 못하게 막기
//
// 지켜야 하는 약속
//   ① 파트너는 **읽기 + 두 칸(email_sent · partner_deal_buyer_id)** 만.
//   ② 허용 **목록** 방식 — 새 칸이 생기면 기본이 "막힘".
//   ③ 아무도 지우지 못한다(원장). 회수는 revoked_at 표시다.
//   ④ **포털의 정당한 쓰기를 깨면 안 된다** — 쓰는 칸이 늘면 이 시험이 실패한다.
//   ⑤ service_role(엣지 함수)과 admin 은 통과해야 한다. 막히면 발급이 깨진다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const M   = read('supabase/migrations/20261201000200_lead_s7_3_fix1_licenses_write_guard.sql');
const DRY = read('../audit/dryrun_lead_s7_3_fix1_licenses.sql');
const RB  = read('../audit/rollback_lead_s7_3_fix1_licenses.sql');
const LIB = read('src/lib/partner-licenses.ts');

/** 파트너가 고칠 수 있는 칸 — 이 목록이 마이그레이션·포털·시험 세 곳에서 같아야 한다. */
const ALLOWED = ['email_sent', 'partner_deal_buyer_id'] as const;

// ══════════════════════ 포털이 쓰는 칸 (전수 고정) ══════════════════════
describe('포털이 `partner_licenses` 에 쓰는 칸 — **늘면 이 시험이 실패한다**', () => {
  /**
   * `rest/v1/partner_licenses` 로 가는 쓰기 호출을 전부 모은다.
   *
   * ⚠️ `\{([\s\S]*?)\}` 로 잡으면 **`headers: { … }` 에서 멈춘다**(중괄호가 중첩돼 있다).
   *    정규식으로 괄호를 세지 말고, 호출이 끝나는 `})` 까지 잘라 쓴다.
   */
  function writeBodies(src: string): string[] {
    const out: string[] = [];
    const re = /authedFetch\(`\$\{BASE_URL\}[^`]*`,/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const rest = src.slice(m.index);
      const end = rest.indexOf('})');
      const block = end === -1 ? rest.slice(0, 400) : rest.slice(0, end + 2);
      if (!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(block)) continue;
      out.push(block);
    }
    return out;
  }

  const bodies = writeBodies(LIB);

  it('쓰기는 **세 군데뿐**이다 (issueLicense · setLicenseBuyer · resendLicenseEmail)', () => {
    expect(bodies).toHaveLength(3);
  });

  it('전부 PATCH 다 — **POST·DELETE 가 없다**', () => {
    for (const b of bodies) expect(b).toMatch(/method:\s*'PATCH'/);
    expect(LIB).not.toMatch(/\$\{BASE_URL\}[^`]*`,\s*\{[\s\S]{0,120}method:\s*'(POST|DELETE|PUT)'/);
  });

  it('**허용 칸 말고는 쓰지 않는다**', () => {
    for (const b of bodies) {
      const json = b.match(/JSON\.stringify\(\{([^}]*)\}\)/);
      expect(json, b.slice(0, 80)).not.toBeNull();
      const keys = (json![1].match(/(\w+)\s*:/g) ?? []).map(k => k.replace(/\s*:$/, ''));
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        expect(ALLOWED as readonly string[], `포털이 ${k} 를 쓴다 — 트리거가 막는다`).toContain(k);
      }
    }
  });

  it('쓰는 칸을 모으면 정확히 허용 목록이다', () => {
    const used = new Set<string>();
    for (const b of bodies) {
      const json = b.match(/JSON\.stringify\(\{([^}]*)\}\)/)!;
      for (const k of json[1].match(/(\w+)\s*:/g) ?? []) used.add(k.replace(/\s*:$/, ''));
    }
    expect([...used].sort()).toEqual([...ALLOWED].sort());
  });

  it('`src` 어디에서도 `partner_licenses` 를 직접 POST·DELETE 하지 않는다', () => {
    for (const f of ['src/lib/partner-licenses.ts', 'src/lib/partnerContractsApi.ts',
                     'src/pages/PartnerPortal.tsx', 'src/pages/Partners.tsx']) {
      const s = read(f);
      const at = s.indexOf('partner_licenses');
      if (at === -1) continue;
      // 그 파일에서 partner_licenses URL 에 DELETE 를 보내는 곳이 없다
      expect(s, f).not.toMatch(/partner_licenses[^`]*`,\s*\{[\s\S]{0,120}method:\s*'DELETE'/);
    }
  });

  it('발급·회수·만료는 **엣지 함수**를 거친다 (service_role)', () => {
    for (const fn of ['partner-issue-license', 'partner-revoke-license']) {
      expect(LIB, fn).toContain(`functions/v1/${fn}`);
    }
  });
});

// ══════════════════════ 정책 ══════════════════════
describe('정책 — 넷으로 나눈다', () => {
  const ADMIN = /\(select up\.role from public\.user_profiles up where up\.id = auth\.uid\(\)\) = any \(array\['admin','sub_admin'\]\)/;
  const SCOPED = 'partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())';
  const policy = (name: string) => {
    const m = M.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
    return m ? m[0] : '';
  };

  it('**FOR ALL 정책을 만들지 않는다**', () => {
    expect(sql(M)).not.toMatch(/create policy[^;]*\bfor all\b/i);
  });

  it('옛 FOR ALL 정책을 지운다 — **새 정책을 만든 뒤에**', () => {
    const drop = M.indexOf('drop policy if exists "partner_scoped_partner_licenses"');
    expect(drop).toBeGreaterThan(-1);
    for (const n of ['partner_licenses_select', 'partner_licenses_update',
                     'partner_licenses_admin_insert', 'partner_licenses_no_delete']) {
      expect(M.indexOf(`create policy "${n}"`), n).toBeLessThan(drop);
    }
  });

  it('읽기: 자기 것 또는 admin (포털이 자기 발급을 본다)', () => {
    const p = policy('partner_licenses_select');
    expect(p).toMatch(/for select/);
    expect(p).toContain(SCOPED);
    expect(p).toMatch(ADMIN);
  });

  it('**넣기는 admin 전용** — 파트너가 가짜 소비를 만들 수 없다', () => {
    const p = policy('partner_licenses_admin_insert');
    expect(p).toMatch(/for insert/);
    expect(p).not.toContain(SCOPED);
    expect(p).toMatch(ADMIN);
  });

  it('고치기: 자기 것 또는 admin (칸 제한은 트리거가 한다)', () => {
    const p = policy('partner_licenses_update');
    expect(p).toMatch(/for update/);
    const using = (p.match(/using \(([\s\S]*?)\)\s*with check/) ?? ['', ''])[1];
    const check = (p.match(/with check \(([\s\S]*)\)\s*;/) ?? ['', ''])[1];
    for (const [n, c] of [['using', using], ['with check', check]] as const) {
      expect(c, n).toContain(SCOPED);
      expect(c, n).toMatch(ADMIN);
      expect(c.trim(), n).not.toMatch(/^true$/);
    }
  });

  it('**아무도 지우지 못한다** (원장) — anon 까지 덮는다', () => {
    const p = policy('partner_licenses_no_delete');
    expect(p).toMatch(/as restrictive for delete to public using \( false \)/);
  });

  it('권한: anon·public 회수 + authenticated 의 DELETE 회수', () => {
    const c = sql(M);
    expect(c).toContain('revoke all on public.partner_licenses from anon');
    expect(c).toContain('revoke all on public.partner_licenses from public');
    expect(c).toContain('revoke delete on public.partner_licenses from authenticated');
    expect(c).toMatch(/grant select, insert, update on public\.partner_licenses to authenticated/);
    expect(c).not.toMatch(/grant[^;]*\bdelete\b[^;]*to authenticated/i);
  });
});

// ══════════════════════ 트리거 ══════════════════════
describe('칸 보호 트리거 — **허용 목록**', () => {
  const fn = M.slice(M.indexOf('create or replace function public.partner_licenses_guard_partner_update'),
                     M.indexOf('revoke all on function'));

  it('BEFORE UPDATE 로 모든 줄에 붙는다', () => {
    expect(sql(M)).toMatch(/create trigger trg_partner_licenses_guard_update\s+before update on public\.partner_licenses\s+for each row/);
  });

  it('**허용 칸은 둘뿐**이고 jsonb 로 통째로 견준다 (칸이 늘면 자동으로 막힌다)', () => {
    expect(fn).toMatch(/to_jsonb\(new\) - 'email_sent' - 'partner_deal_buyer_id'/);
    expect(fn).toMatch(/to_jsonb\(old\) - 'email_sent' - 'partner_deal_buyer_id'/);
    expect(fn).toContain('is distinct from');
    // 거부 목록 방식(칸 이름을 하나씩 비교)이 아니다
    expect(fn).not.toMatch(/new\.seat_months|new\.status\b|new\.contract_id/);
  });

  it('허용 칸이 마이그레이션·시험에서 같다', () => {
    const inSql = (fn.match(/- '(\w+)'/g) ?? []).map(s => s.replace(/- '|'/g, ''));
    expect([...new Set(inSql)].sort()).toEqual([...ALLOWED].sort());
  });

  it('**service_role·엣지 함수·SQL 편집기는 통과한다** (막히면 발급이 깨진다)', () => {
    expect(fn).toMatch(/if current_user <> 'authenticated' then\s*\n?\s*return new;/);
    expect(fn).toMatch(/v_uid := auth\.uid\(\);[\s\S]{0,80}if v_uid is null then\s*\n?\s*return new;/);
  });

  it('admin·sub_admin 은 통과한다', () => {
    expect(fn).toMatch(/v_role = any \(array\['admin', 'sub_admin'\]\)/);
  });

  it('거절은 권한 오류(42501)로 낸다', () => {
    expect(fn).toMatch(/raise exception[\s\S]{0,160}errcode = '42501'/);
  });

  it('**security definer 인데 search_path 를 고정했다**', () => {
    expect(fn).toContain('security definer');
    expect(fn).toMatch(/set search_path = public, pg_temp/);
  });

  it('트리거 함수 실행 권한을 anon·authenticated 에서 거둔다', () => {
    const c = sql(M);
    for (const r of ['public', 'anon', 'authenticated']) {
      expect(c, r).toMatch(new RegExp(`revoke all on function public\\.partner_licenses_guard_partner_update\\(\\) from ${r}`));
    }
  });
});

// ══════════════════════ 드라이런·롤백 ══════════════════════
describe('드라이런 — 세 역할로 실제로 찔러 본다', () => {
  it('psql 전용 명령을 쓰지 않고 한 파일로 돈다', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sql(DRY)).toMatch(/^\s*begin;/m);
    expect(sql(DRY).trimEnd().endsWith('rollback;')).toBe(true);
    expect(sql(DRY)).not.toMatch(/^\s*commit\s*;/mi);
  });

  it('마이그레이션 본문이 직접 들어 있다', () => {
    expect(DRY).toContain('create policy "partner_licenses_no_delete"');
    expect(DRY).toContain('create trigger trg_partner_licenses_guard_update');
  });

  it('**막아야 하는 칸을 하나씩 찔러 본다**', () => {
    for (const probe of ['seat_months 고치기', 'status 고치기', 'contract_id 고치기',
                         'user_count·duration', 'coupon_code 고치기']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('**포털이 쓰는 두 칸이 되는지 본다** (여기가 ❌ 면 적용하면 안 된다)', () => {
    expect(DRY).toContain('email_sent 고치기');
    expect(DRY).toContain('partner_deal_buyer_id');
    expect(DRY).toContain('두 칸 같이 고치기');
    expect(DRY).toContain('포털이 깨진다');
  });

  it('INSERT·DELETE 거부와 admin·service_role 통과를 본다', () => {
    for (const probe of ['파트너: INSERT', '파트너: DELETE',
                         'admin: 아무 칸이나 UPDATE', 'service_role: 확정 UPDATE']) {
      expect(DRY, probe).toContain(probe);
    }
    expect(DRY).toContain('발급 확정이 깨진다');
  });

  it('역할을 바꿔 보고 되돌린다', () => {
    expect(DRY).toContain("set local role authenticated");
    expect(DRY).toContain("set local role service_role");
    expect((DRY.match(/reset role/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('권한과 기존 건수를 확인한다', () => {
    expect(DRY).toContain('anon 권한 (없어야)');
    expect(DRY).toContain('authenticated DELETE (없어야)');
    expect(DRY).toContain('기대 2');
  });
});

describe('롤백 — 되돌리면 구멍이 열린다고 적는다', () => {
  it('경고가 맨 위에 있다', () => {
    expect(RB).toContain('구멍이 다시 열립니다');
    expect(RB).toContain('S7-3 엣지 함수를 먼저 이전 판으로');
  });

  it('되돌리기는 전부 주석이다', () => {
    expect(sql(RB)).not.toMatch(/^\s*(drop|create) (policy|trigger|function)/mi);
    expect(RB).toContain('-- drop trigger if exists trg_partner_licenses_guard_update');
  });

  it('**anon 권한은 되살리지 말라고 적는다**', () => {
    expect(RB).toContain('anon 권한은 **되돌리지 마세요.**');
  });

  it('트리거만 끄는 길을 따로 준다 (포털이 막히는 비상시)', () => {
    expect(RB).toContain('② 트리거만 끄기');
  });
});

// ══════════════════════ 범위 ══════════════════════
describe('이번 범위 밖은 건드리지 않았다', () => {
  it('`partner_licenses` 말고 다른 표의 정책을 바꾸지 않는다', () => {
    const c = sql(M);
    for (const t of ['partner_deals', 'partner_deal_buyers', 'partner_files',
                     'partner_expiry_emails', 'mdiary_coupons', 'partner_contracts',
                     'partner_purchases']) {
      expect(c, t).not.toMatch(new RegExp(`(create|drop) policy[^;]*on public\\.${t}\\b`));
      expect(c, t).not.toMatch(new RegExp(`(grant|revoke)[^;]*on public\\.${t}\\b`));
    }
  });

  it('함수 코드를 바꾸지 않았다 (이번 단계는 DB 만)', () => {
    const fnSrc = read('supabase/functions/partner-issue-license/index.ts');
    expect(fnSrc).not.toContain('partner_licenses_guard_partner_update');
  });

  it('기존 데이터를 건드리지 않는다', () => {
    const c = sql(M);
    expect(c).not.toMatch(/\b(delete from|truncate|insert into)\b/i);
    expect(c).not.toMatch(/update public\.partner_licenses/i);
    expect(c).not.toMatch(/drop (table|column)/i);
  });
});
