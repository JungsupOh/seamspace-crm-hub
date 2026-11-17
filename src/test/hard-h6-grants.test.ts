// H-6 — 쓰지 않는 권한 거두기
//
//   ① 열두 표 전부에서 TRUNCATE·REFERENCES·TRIGGER 를 거둔다
//   ② 삭제 불가 원장에서는 DELETE 도 — **`lead_cc_links` 만 빼고**
//   ③ SELECT·INSERT·UPDATE 는 **건드리지 않는다**
//   ④ `lead_cc_links` 를 뺀 근거가 코드에 있다(앱이 실제로 DELETE 한다)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlOf = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const MIG = read('supabase/migrations/20261207000000_hard_h6_revoke_unused_grants.sql');
const DRY = read('../audit/dryrun_hard_h6_grants.sql');
const RB  = read('../audit/rollback_hard_h6_grants.sql');
const CODE = sqlOf(MIG);

/** M014 가 지정한 열두 표 */
const TABLES = [
  'partner_contracts', 'partner_purchases', 'partner_requests', 'partner_licenses',
  'lead_activities', 'lead_strategies', 'lead_signals', 'lead_outreach_drafts',
  'lead_research_notes', 'lead_cc_links', 'outreach_facts', 'outreach_fact_log',
] as const;

/** DELETE 를 거두는 표 — `lead_cc_links` 는 **빠진다** */
const DELETE_REVOKED = TABLES.filter(t => t !== 'lead_cc_links');

describe('① TRUNCATE·REFERENCES·TRIGGER 를 열두 표 전부에서', () => {
  it('열두 표가 다 있다', () => {
    for (const t of TABLES) {
      expect(CODE, t).toMatch(
        new RegExp(`revoke truncate, references, trigger on public\\.${t}\\s+from authenticated;`));
    }
  });

  it('빠진 표가 없다 (열두 줄)', () => {
    const lines = CODE.match(/revoke truncate, references, trigger on public\.\w+/g) ?? [];
    expect(lines.length).toBe(12);
    expect(new Set(lines).size).toBe(12);
  });

  it('**TRUNCATE 가 RLS 를 지나간다**고 적어 두었다 — 그래서 권한으로 막는다', () => {
    expect(MIG).toContain('**TRUNCATE 는 RLS 를 지나가지 않는다.**');
  });
});

describe('② DELETE — **`lead_cc_links` 만 남긴다**', () => {
  it('열한 표에서 거둔다', () => {
    for (const t of DELETE_REVOKED) {
      expect(CODE, t).toMatch(new RegExp(`revoke delete on public\\.${t}\\s+from authenticated;`));
    }
    expect(DELETE_REVOKED.length).toBe(11);
  });

  it('**`lead_cc_links` 의 DELETE 는 거두지 않는다**', () => {
    expect(CODE).not.toMatch(/revoke delete on public\.lead_cc_links/);
  });

  it('거두는 줄이 정확히 열하나', () => {
    const lines = CODE.match(/revoke delete on public\.\w+/g) ?? [];
    expect(lines.length).toBe(11);
    expect(lines.some(l => l.includes('lead_cc_links'))).toBe(false);
  });

  it('왜 뺐는지 적어 두었다', () => {
    expect(MIG).toContain('src/lib/leadsApi.ts:385');
    expect(MIG).toContain('CC 해제가 깨진다');
  });
});

describe('③ SELECT·INSERT·UPDATE 는 **건드리지 않는다**', () => {
  it('그 셋을 거두는 줄이 없다', () => {
    expect(CODE).not.toMatch(/revoke[^;]*\bselect\b/i);
    expect(CODE).not.toMatch(/revoke[^;]*\binsert\b/i);
    expect(CODE).not.toMatch(/revoke[^;]*\bupdate\b/i);
  });

  it('`revoke all` 을 쓰지 않는다 — 쓰면 읽기까지 날아간다', () => {
    expect(CODE).not.toMatch(/revoke all/i);
  });

  it('정책을 건드리지 않는다', () => {
    expect(CODE).not.toMatch(/create policy|alter policy|drop policy/i);
  });

  it('표를 만들거나 고치지 않는다', () => {
    // `revoke truncate` 는 권한을 거두는 것이지 표를 비우는 명령이 아니다 — 낱말만 보면 걸린다
    expect(CODE).not.toMatch(/create table|alter table|drop table|delete from/i);
    expect(CODE).not.toMatch(/^\s*truncate\s/im);
  });

  it('`grant` 가 하나도 없다 — 이번에는 **거두기만** 한다', () => {
    expect(CODE).not.toMatch(/\bgrant\b/i);
  });
});

describe('④ `lead_cc_links` 를 뺀 근거가 **코드에 있다**', () => {
  it('앱이 실제로 DELETE 한다', () => {
    const api = read('src/lib/leadsApi.ts');
    const fn = api.slice(api.indexOf('export async function setCcLink'),
                         api.indexOf('export async function setCcLink') + 1200);
    expect(fn).toContain('lead_cc_links');
    expect(fn).toContain("method: 'DELETE'");
  });

  it('다른 열한 표는 앱이 DELETE 하지 않는다', () => {
    const roots = ['src', 'supabase/functions'];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.resolve(process.cwd(), d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) { if (!p.includes('/test')) walk(p); }
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);

    for (const t of DELETE_REVOKED) {
      for (const f of files) {
        const txt = read(f);
        if (!txt.includes(t)) continue;
        const lines = txt.split('\n');
        lines.forEach((l, i) => {
          if (!l.includes(t)) return;
          const win = lines.slice(i, i + 14).join('\n');
          const del = /method:\s*['"]DELETE['"]/.test(win) || /\.delete\(\)/.test(win);
          expect(del, `${t} 를 ${f}:${i + 1} 에서 DELETE 한다 — 거두면 깨진다`).toBe(false);
        });
      }
    }
  });

  it('표에 왜 남겼는지 주석을 달았다', () => {
    expect(CODE).toMatch(/comment on table public\.lead_cc_links/);
    expect(MIG).toContain('원장으로 바꾸려면 화면을 먼저 고쳐라');
  });
});

describe('드라이런', () => {
  it('psql 전용 없이 한 파일', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sqlOf(DRY)).toMatch(/^\s*begin;/m);
    expect(sqlOf(DRY).trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('**실제 역할 전환**으로 본다', () => {
    expect(DRY).toContain('set local role authenticated');
    expect(DRY).toContain('request.jwt.claims');
  });

  it('**TRUNCATE 를 실제로 시도한다** — 권한으로만 막히는 명령이다', () => {
    expect(DRY).toContain("truncate table public.lead_activities");
    expect(DRY).toContain("truncate table public.partner_contracts");
    expect(DRY).toContain('원장이 통째로 사라진다');
  });

  it('**CC 걸기·해제가 살아 있는지** 본다 (여기서 깨지면 화면이 깨진다)', () => {
    expect(DRY).toContain('⑤ CC 걸기 (INSERT)');
    expect(DRY).toContain('⑤ CC 해제 (DELETE)');
    expect(DRY).toContain('CC 해제가 깨진다');
  });

  it('남긴 권한으로 앱 경로가 되는지도 본다', () => {
    expect(DRY).toContain('④ 활동 기록 남기기 (INSERT)');
    expect(DRY).toContain('④ 활동 기록 고치기 (UPDATE)');
    expect(DRY).toContain('관리자 화면이 깨진다');
  });

  it('판정을 세어 준다', () => {
    expect(DRY).toContain('③ DELETE 판정');
    expect(DRY).toContain('lead_cc_links 만 남음 ✅');
    expect(DRY).toContain('③ SELECT·INSERT·UPDATE 보존');
  });

  it('**시험 행을 직접 심는다** — 비어서 건너뛰지 않게 (M017 교훈)', () => {
    expect(DRY).toContain('insert into public.campaign_leads');
    expect(DRY).toContain('rollback 으로 사라진다');
  });

  it('**새 칸을 사전 집계에서 읽지 않는다** (M015 교훈)', () => {
    const before = DRY.slice(DRY.indexOf('create temp table _before'),
                             DRY.indexOf('① 거두기 전'));
    // 이번 마이그레이션은 칸을 더하지 않으므로 새 칸 자체가 없다
    expect(before).not.toMatch(/partner_id|onboarding|contact_owner/);
  });

  it('마이그레이션 본문이 들어 있다', () => {
    expect(DRY).toContain('revoke truncate, references, trigger on public.partner_contracts');
    expect(DRY).toContain('revoke delete on public.outreach_fact_log');
    expect(DRY).not.toMatch(/revoke delete on public\.lead_cc_links/);
  });
});

describe('롤백', () => {
  it('되살리는 줄이 전부 주석', () => {
    const live = sqlOf(RB).split('\n').filter(l => /\bgrant\b/i.test(l));
    expect(live).toEqual([]);
  });

  it('**TRUNCATE 가 다시 열린다**고 경고한다', () => {
    expect(RB).toContain('TRUNCATE 는 RLS 를 지나가지 않아');
  });

  it('지금 권한을 먼저 보여 준다', () => {
    expect(RB).toContain('relacl');
    expect(RB).toContain('지금권한');
  });
});

describe('범위', () => {
  it('`campaign_leads` 를 **고치지 않는다** (M014: 발견으로만 적어라)', () => {
    expect(CODE).not.toContain('campaign_leads');
  });

  it('열두 표 말고 다른 표를 건드리지 않는다', () => {
    const touched = [...CODE.matchAll(/on public\.(\w+)/g)].map(m => m[1]);
    for (const t of new Set(touched)) {
      expect((TABLES as readonly string[]).includes(t), `${t} 는 지정 밖이다`).toBe(true);
    }
  });
});
