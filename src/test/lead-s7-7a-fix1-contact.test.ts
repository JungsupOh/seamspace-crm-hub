// LEAD-S7-7a fix1 — 접촉 기록(contact) 동작
//
// 보호 기간을 늘리는 동작이다. 즉 **돈에 닿는다.** 그래서:
//   ① 서버 시각만 쓴다 — 본문의 날짜를 쳐다보지 않는다
//   ② 갱신하는 칸은 `last_contact_at` **하나뿐**
//   ③ 자기 파트너가 등록한 리드만 — 남의 것·우리 것은 **없는 것과 같은 답**
//   ④ `partner_viewer` 거부
//   ⑤ 분당 횟수 제한

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  CONTACT_UPDATE_FIELDS, LEAD_PUBLIC_FIELDS, canRecordContact, contactUpdate,
  denialMessage, protectionDaysLeft,
} from '../../supabase/functions/partner-lead/logic';
import { LEAD_MSG } from '../lib/partnerPortalMsg';
import type { Msg } from '../lib/partner-i18n';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const FN  = read('supabase/functions/partner-lead/index.ts');
const API = read('src/lib/partnerPortalLeads.ts');
const UI  = read('src/components/partner-portal/PortalLeads.tsx');

/** 함수에서 contact 동작 덩어리만 — 다른 동작의 코드가 섞이지 않게 */
const BLOCK = FN.slice(FN.indexOf("if (action === 'contact')"),
                       FN.indexOf('// ── 6) 등록 ──'));

/**
 * **갱신 사슬만** 따로 본다.
 *
 * 처음에는 덩어리 전체에서 `.eq('partner_id', …)` 를 찾았는데, 바로 위
 * 횟수 제한 쿼리에도 같은 줄이 있어서 **갱신에서 빼도 시험이 통과했다.**
 * 변이 시험이 그걸 잡았다 — 좁혀서 본다.
 */
const UPDATE_CHAIN = BLOCK.slice(BLOCK.indexOf('.update(contactUpdate'),
                                 BLOCK.indexOf('.maybeSingle();',
                                               BLOCK.indexOf('.update(contactUpdate')));

describe('누가 기록할 수 있나', () => {
  it('등록할 수 있는 사람이 기록도 한다', () => {
    expect(canRecordContact('partner_admin')).toBe(true);
    expect(canRecordContact('partner_member')).toBe(true);
    expect(canRecordContact('admin')).toBe(true);
  });

  it('**보기 전용은 못 한다**', () => {
    expect(canRecordContact('partner_viewer')).toBe(false);
    expect(canRecordContact('guest')).toBe(false);
    expect(canRecordContact('')).toBe(false);
  });

  it('함수가 맨 앞에서 본다', () => {
    expect(BLOCK).toContain("if (!canRecordContact(caller.role)) return deny('NOT_ALLOWED')");
  });
});

describe('**갱신하는 칸은 하나뿐**', () => {
  it('목록이 하나다', () => {
    expect(CONTACT_UPDATE_FIELDS).toEqual(['last_contact_at']);
    expect(CONTACT_UPDATE_FIELDS.length).toBe(1);
  });

  it('쓰는 행에 다른 칸이 없다', () => {
    const row = contactUpdate('2026-11-18T01:00:00.000Z');
    expect(Object.keys(row)).toEqual(['last_contact_at']);
    expect(row.last_contact_at).toBe('2026-11-18T01:00:00.000Z');
  });

  it('**보호 기간·귀속·내부 칸을 건드리지 않는다**', () => {
    const row = contactUpdate('x');
    for (const f of ['partner_claimed_at', 'partner_id', 'contact_owner', 'status',
                     'notes', 'owner', 'segment', 'probability', 'followup_stage',
                     'consent_by', 'consent_at', 'marketing_consent']) {
      expect(f in row, f).toBe(false);
    }
  });

  it('함수가 그 행만 쓴다', () => {
    expect(BLOCK).toContain('.update(contactUpdate(nowIso))');
    // update 호출이 하나뿐이고, 객체 리터럴을 직접 넘기지 않는다
    expect((BLOCK.match(/\.update\(/g) ?? []).length).toBe(1);
    expect(BLOCK).not.toMatch(/\.update\(\{/);
  });
});

describe('**서버 시각만 쓴다**', () => {
  it('함수가 자기 시각을 만든다', () => {
    expect(BLOCK).toContain('const nowIso = new Date().toISOString()');
  });

  it('**본문의 날짜를 쳐다보지 않는다**', () => {
    for (const k of ['occurredOn', 'occurred_on', 'date', 'when', 'today', 'at']) {
      expect(BLOCK, k).not.toContain(`body.${k}`);
    }
    // 본문에서 읽는 것은 id 뿐
    const reads = [...BLOCK.matchAll(/body\.(\w+)/g)].map(m => m[1]);
    expect([...new Set(reads)]).toEqual(['id']);
  });

  it('**화면도 날짜를 보내지 않는다**', () => {
    const fn = API.slice(API.indexOf('export async function recordContact'),
                         API.indexOf('export async function createLead'));
    expect(fn).toContain("call({ action: 'contact', id })");
    expect(fn).not.toMatch(/occurredOn|date|new Date/);
  });

  it('파트너가 보호 기간을 늘리지 못한다 — 왜인지 적어 두었다', () => {
    const logic = read('supabase/functions/partner-lead/logic.ts');
    expect(logic).toContain('보호 기간을 **마음대로 늘릴 수 있다**');
  });
});

describe('**자기 파트너가 등록한 리드만**', () => {
  it('**갱신 사슬에** 두 조건을 함께 건다', () => {
    expect(UPDATE_CHAIN).toContain(".eq('id', id)");
    expect(UPDATE_CHAIN).toContain(".eq('partner_id', partnerId)");
    expect(UPDATE_CHAIN.length).toBeGreaterThan(20);   // 사슬을 못 찾았는데 통과하지 않게
  });

  it('**없는 것과 같은 답** — 떠보기를 막는다', () => {
    expect(BLOCK).toContain("if (!updated) return deny('NOT_FOUND', 404)");
    // 빈 id 도 같은 답
    expect(BLOCK).toContain("if (!id) return deny('NOT_FOUND', 404)");
    for (const l of ['ko', 'ja', 'en']) {
      expect(denialMessage('NOT_FOUND', l), l).toBeTruthy();
    }
  });

  it('우리 리드(partner_id NULL)도 걸리지 않는다', () => {
    // partnerId 는 늘 문자열이므로 `.eq('partner_id', partnerId)` 가 NULL 행을 거른다
    expect(BLOCK).not.toMatch(/\.is\('partner_id'/);
    expect(BLOCK).not.toMatch(/\.or\(/);
  });

  it('본문의 partner_id 를 믿지 않는다 (공통 경로)', () => {
    expect(FN).toContain('const partnerId = resolvePartnerId(caller, body.partnerId)');
  });
});

describe('분당 횟수 제한', () => {
  it('기록도 쓰기라 센다', () => {
    expect(BLOCK).toContain("if (overRateLimit(recentC ?? 0)) return deny('RATE_LIMIT', 429)");
    expect(BLOCK).toContain("gte('last_contact_at', since60)");
  });
});

describe('응답', () => {
  it('**허용 칸만** 돌려준다', () => {
    expect(BLOCK).toContain('.select(selectClause())');
    expect(BLOCK).toContain('pickForRole(row, caller.role)');
    expect(BLOCK).not.toMatch(/\.select\('\*'\)/);
  });

  it('새 보호 기간을 함께 준다 — 화면이 다시 세지 않게', () => {
    expect(BLOCK).toContain('protection_days_left: protectionDaysLeft(');
  });

  it('기록 직후에는 90일이 된다', () => {
    const now = new Date('2026-11-18T00:00:00Z');
    expect(protectionDaysLeft('2026-01-01T00:00:00Z', now.toISOString(), now)).toBe(90);
  });
});

describe('문구', () => {
  it('기록했다는 말이 세 언어', () => {
    for (const l of ['ko', 'ja', 'en']) {
      const m = denialMessage('CONTACT_RECORDED', l);
      expect(m, l).toBeTruthy();
      if (l !== 'ko') expect(m, l).not.toMatch(/[가-힣]/);
    }
    expect(denialMessage('CONTACT_RECORDED', 'ko')).toContain('보호 기간이 오늘부터');
  });

  it('화면 문구도 세 언어', () => {
    for (const k of ['recordBtn', 'recordHint', 'contactAsk'] as const) {
      const m = LEAD_MSG[k] as Msg;
      expect(m.ko, k).toBeTruthy();
      expect(m.ja, k).toBeTruthy();
      expect(m.en, k).toBeTruthy();
      expect(m.en, k).not.toMatch(/[가-힣]/);
    }
  });

  it('**오늘 날짜로 기록된다**고 알려 준다', () => {
    expect(LEAD_MSG.recordHint.en).toContain("today's date");
    expect(LEAD_MSG.contactAsk.en).toContain('restarts from that day');
  });
});

describe('화면 연결', () => {
  it('단추가 생겼다', () => {
    expect(UI).toContain("{T('recordBtn')}");
    expect(UI).toContain('record.mutate()');
  });

  it('**보기 전용에게는 단추가 없다**', () => {
    expect(UI).toContain('canRecord={!isViewer}');
    expect(UI).toContain('{canRecord && (');
  });

  it('성공하면 목록을 다시 읽는다 (보호 기간이 바뀐다)', () => {
    expect(UI).toContain("qc.invalidateQueries({ queryKey: ['portal-leads'] })");
  });
});

describe('범위', () => {
  it('마이그레이션을 더하지 않았다 (칸이 이미 있다)', () => {
    // fix1 보다 뒤 번호의 마이그레이션이 없어야 한다 (S7-8 이 마지막)
    const newer = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
      .filter(f => /^\d{14}_/.test(f) && f.slice(0, 14) > '20261206000000');
    expect(newer).toEqual([]);
  });

  it('다른 동작을 건드리지 않았다', () => {
    for (const a of ['list', 'detail', 'create']) {
      expect(FN, a).toContain(`if (action === '${a}')`);
    }
  });

  it('허용 칸이 그대로 12개', () => {
    expect(LEAD_PUBLIC_FIELDS.length).toBe(12);
  });
});
