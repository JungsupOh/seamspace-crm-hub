// HARD-A H-4 — 파트너 포털 로그인 토큰 전환 + 파트너별 접근 정책
//
// 순수 테스트(소스·SQL 정적 검사). 운영 DB 접근·SQL 실행 없음.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

/** 평범한 fetch 로 남은 rest/v1 호출 줄 번호 */
function plainRest(src: string): number[] {
  const lines = src.split('\n');
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (!/\bfetch\(/.test(l) || l.includes('authedFetch') || l.trim().startsWith('//')) return;
    const win = lines.slice(i, i + 10).join('\n');
    if (/rest\/v1\//.test(win) && !/functions\/v1\//.test(win)) out.push(i + 1);
    // URL 을 const 로 뺀 패턴
    else if (/\b(BASE_URL|BUYERS_URL)\b/.test(win)) out.push(i + 1);
  });
  return out;
}

/** 공개 키를 Authorization 에 넣은 줄 (같은 줄의 apikey 는 정상이므로 제외) */
function anonAuth(src: string): number[] {
  return src.split('\n').flatMap((l, i) => {
    if (l.trim().startsWith('//')) return [];
    const m = l.match(/Authorization:\s*`Bearer \$\{(\w+)\}`/);
    return m && /SUPABASE_KEY|ANON_KEY/.test(m[1]) ? [i + 1] : [];
  });
}

// ────────────────────────────────────────────────────────────
describe('H-4 파트너 포털이 로그인 토큰으로 요청한다', () => {
  const FILES = {
    'src/pages/PartnerPortal.tsx': { plain: 0, anon: 0 },
    'src/lib/partner-deals.ts': { plain: 0, anon: 0 },
    // partner-licenses.ts 에 남는 공개 키 1곳 = functions/v1/get-coupon-status (021-8a 담당)
    'src/lib/partner-licenses.ts': { plain: 0, anon: 1 },
    'src/lib/partner-expiry.ts': { plain: 0, anon: 0 },
  } as const;

  for (const [f, exp] of Object.entries(FILES)) {
    describe(f, () => {
      const SRC = read(f);

      it(`rest/v1 호출이 전부 authedFetch 다`, () => {
        const left = plainRest(SRC);
        expect(left, `평범한 fetch 로 남은 줄: ${left.join(', ')}`).toHaveLength(exp.plain);
      });

      it(`공개 키 Authorization 이 허용 예외 수(${exp.anon})만큼만 남았다`, () => {
        const left = anonAuth(SRC);
        expect(left, `남은 줄: ${left.join(', ')}`).toHaveLength(exp.anon);
      });

      it('authedFetch 를 import 한다', () => {
        // 상대경로('./authedFetch')와 별칭('@/lib/authedFetch') 둘 다 허용
        expect(code(SRC)).toMatch(/from '(?:@\/lib|\.)\/authedFetch'/);
      });

      it('apikey 에는 공개 키를 그대로 둔다 (정상)', () => {
        expect(code(SRC)).toMatch(/apikey:\s*SUPABASE_KEY/);
      });
    });
  }

  it('partner-licenses 의 남은 공개 키는 get-coupon-status 다', () => {
    const SRC = read('src/lib/partner-licenses.ts');
    const line = anonAuth(SRC)[0];
    const around = SRC.split('\n').slice(line - 6, line + 1).join('\n');
    expect(around).toContain('functions/v1/get-coupon-status');
  });

  it('이용권 발급·무효화는 이미 세션 토큰을 쓴다 (전환 대상 아님)', () => {
    const SRC = code(read('src/lib/partner-licenses.ts'));
    expect(SRC).toContain('functions/v1/partner-issue-license');
    expect(SRC).toContain('functions/v1/partner-revoke-license');
    expect(SRC).toContain('Bearer ${token}');
    expect(SRC).toContain('supabase.auth.getSession()');
  });

  it('포털 화면 문구·권한 게이트는 그대로다', () => {
    const SRC = read('src/pages/PartnerPortal.tsx');
    // 역할 기반 게이트가 살아 있어야 한다 (canManageLicenses = partner_admin)
    expect(SRC).toContain('canManageLicenses');
    expect(SRC).toContain('canEditPartnerDeals');
    expect(SRC).toContain('canIssueLicenses');
  });
});

// ────────────────────────────────────────────────────────────
describe('H-4 파트너별 정책 마이그레이션 (미적용)', () => {
  const MIG = read('supabase/migrations/20261116000000_partner_scoped_policies_h4.sql');

  it('첫 줄에 미적용·적용 순서를 못 박았다', () => {
    const first = MIG.split('\n')[0];
    expect(first).toContain('미적용');
    expect(first).toMatch(/먼저\S*\s*적용/);   // "**먼저** 적용" 의 강조 표시를 허용
  });

  it('추가만 한다 — drop policy 가 없다', () => {
    expect(MIG).not.toMatch(/drop\s+policy/i);
    expect(MIG).not.toMatch(/alter\s+policy/i);
    expect(MIG).not.toMatch(/drop\s+table/i);
    expect(MIG).not.toMatch(/delete\s+from/i);
    expect(MIG).not.toMatch(/update\s+public\./i);
  });

  it('포털이 쓰는 6개 테이블에 정책을 더한다', () => {
    for (const t of ['partner_deals', 'partner_deal_buyers', 'partner_licenses',
                     'partner_files', 'partner_expiry_emails', 'mdiary_coupons']) {
      expect(MIG, t).toContain(`on public.${t}`);
    }
    expect([...MIG.matchAll(/^create policy/gm)]).toHaveLength(6);
  });

  it('partners 의 올바른 패턴을 복제한다 — 자기 partner_id 또는 admin·sub_admin', () => {
    const stmts = MIG.split('create policy').slice(1);
    expect(stmts).toHaveLength(6);
    for (const s of stmts) {
      expect(s).toContain('user_profiles');
      expect(s).toContain('auth.uid()');
      expect(s).toContain("array['admin','sub_admin']");
    }
  });

  it('쓰기 정책에는 WITH CHECK 도 있다 (USING 만으로는 INSERT 가 막히지 않는다)', () => {
    const stmts = MIG.split('create policy').slice(1);
    for (const s of stmts) {
      if (/for\s+all/.test(s)) expect(s, s.slice(0, 60)).toContain('with check');
    }
  });

  it('to authenticated 로만 건다 (anon 에 새로 열지 않는다)', () => {
    const stmts = MIG.split('create policy').slice(1);
    for (const s of stmts) {
      expect(s).toContain('to authenticated');
      expect(s).not.toContain('to anon');
      expect(s).not.toContain('to public');
    }
  });

  it('mdiary_coupons 는 SELECT 만 더한다 (UPDATE 는 021-8i)', () => {
    const block = MIG.slice(MIG.indexOf('on public.mdiary_coupons') - 200);
    expect(block).toContain('for select');
    expect(block).not.toContain('for all');
  });

  it('롤백·드라이런 SQL 이 같이 있다', () => {
    const rb = read('../audit/rollback_h4_partner_scoped.sql');
    for (const t of ['partner_deals', 'partner_deal_buyers', 'partner_licenses',
                     'partner_files', 'partner_expiry_emails', 'mdiary_coupons']) {
      expect(rb, t).toContain(t);
    }
    expect([...rb.matchAll(/drop policy if exists/g)]).toHaveLength(6);

    const dr = read('../audit/dryrun_h4_partner_scoped.sql');
    expect(dr.trimStart()).not.toMatch(/^\\i/m);      // psql 메타명령 금지
    expect(dr).toContain('begin;');
    expect(dr).toContain('rollback;');
    expect([...dr.matchAll(/^create policy/gm)]).toHaveLength(6);
  });

  it('드라이런의 statement 가 마이그레이션과 같다', () => {
    const names = (s: string) => [...s.matchAll(/^create policy "([^"]+)"/gm)].map(m => m[1]).sort();
    expect(names(read('../audit/dryrun_h4_partner_scoped.sql')))
      .toEqual(names(MIG));
  });
});

// ────────────────────────────────────────────────────────────
describe('H-4 021-8b-2 광범위 정책 좁히기 (미적용)', () => {
  const NAR = read('supabase/migrations/20261116001000_narrow_8b2_policies_h4.sql');

  it('첫 줄에 미적용과 적용 시점을 적었다', () => {
    expect(NAR.split('\n')[0]).toContain('미적용');
    expect(NAR.split('\n')[0]).toContain('뒤');       // "전환이 배포되고 동작을 확인한 뒤"
  });

  it('021-8b-2 가 넣은 정책 5개를 정확히 겨냥한다', () => {
    for (const p of ['authenticated_all_deal_files', 'authenticated_insert_partners',
                     'authenticated_update_partners', 'authenticated_delete_partners',
                     'authenticated_all_partner_licenses']) {
      expect(NAR, p).toContain(`drop policy if exists "${p}"`);
    }
  });

  it('anon 정책은 건드리지 않는다 (제거는 021-8i)', () => {
    expect(NAR).not.toContain('anon_all_partners');
    expect(NAR).not.toContain('anon_all_partner_licenses');
    expect(NAR).not.toContain('allow anon all');
  });

  it('대체 정책은 admin·sub_admin 으로 좁힌다', () => {
    const stmts = NAR.split('create policy').slice(1);
    expect(stmts.length).toBeGreaterThanOrEqual(4);
    for (const s of stmts) {
      expect(s).toContain("array['admin','sub_admin']");
      expect(s).toContain('to authenticated');
    }
  });

  it('partner_licenses 는 대체 정책을 만들지 않는다 (파트너 범위 정책이 담당)', () => {
    // drop 만 하고 create 하지 않는다 — 선행 마이그레이션이 필요하다는 뜻
    const after = NAR.slice(NAR.indexOf('drop policy if exists "authenticated_all_partner_licenses"'));
    expect(after).not.toContain('create policy');
    expect(NAR).toContain('20261116000000_partner_scoped_policies_h4.sql');
  });

  it('되돌리기 SQL 이 021-8b-2 상태를 복원한다', () => {
    const rb = read('../audit/rollback_h4_narrow_8b2.sql');
    for (const p of ['authenticated_all_deal_files', 'authenticated_all_partner_licenses',
                     'authenticated_insert_partners', 'authenticated_update_partners',
                     'authenticated_delete_partners']) {
      expect(rb, p).toContain(`create policy "${p}"`);
    }
  });

  it('드라이런이 선행 조건까지 재현한다', () => {
    const dr = read('../audit/dryrun_h4_narrow_8b2.sql');
    expect(dr).toContain('begin;');
    expect(dr).toContain('rollback;');
    expect(dr).toContain('partner_scoped_partner_licenses_dryrun');
  });
});
