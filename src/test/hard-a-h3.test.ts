// HARD-A H-3 — send-email-authed 와 이메일 호출 전환
//
// 순수 테스트. 운영 DB·실제 발송 없음.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  authVerdict, roleVerdict, validateBody, buildForwardBody,
  ALLOWED_ROLES, ALLOWED_FIELDS,
  MAX_ATTACHMENTS, MAX_RECIPIENTS, MAX_CC, MAX_TOTAL_BYTES,
} from '../../supabase/functions/send-email-authed/logic';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const MAIL = { to: 'a@b.com', subject: '제목', html: '<p>본문</p>' };

// ────────────────────────────────────────────────────────────
describe('H-3 인증 판정 (admin-issue-coupon 과 같은 규칙)', () => {
  it('Bearer 가 없으면 401', () => {
    for (const h of [null, undefined, '', 'Basic xxx', 'bearer x']) {
      const v = authVerdict(h);
      expect(v.ok, String(h)).toBe(false);
      if (v.ok === false) expect(v.status).toBe(401);
    }
  });
  it('빈 토큰도 401', () => {
    const v = authVerdict('Bearer    ');
    expect(v.ok).toBe(false);
  });
  it('토큰이 있으면 통과하고 Bearer 를 떼어 준다', () => {
    const v = authVerdict('Bearer abc.def.ghi');
    expect(v).toEqual({ ok: true, jwt: 'abc.def.ghi' });
  });
});

describe('H-3 역할 판정', () => {
  it('허용 역할은 admin, sub_admin, partner_admin 셋뿐이다', () => {
    expect([...ALLOWED_ROLES]).toEqual(['admin', 'sub_admin', 'partner_admin']);
  });
  for (const r of ['admin', 'sub_admin', 'partner_admin']) {
    it(`${r} 는 통과`, () => expect(roleVerdict(r).ok).toBe(true));
  }
  // 근거: partner-issue-license:69-70, AuthContext:237, PartnerPortal:837·867·1162
  for (const r of ['partner_member', 'partner_viewer', 'guest', '', null, undefined, 'ADMIN']) {
    it(`${String(r)} 는 403`, () => {
      const v = roleVerdict(r as string);
      expect(v.ok).toBe(false);
      if (v.ok === false) { expect(v.status).toBe(403); expect(v.error).toBe('Not allowed'); }
    });
  }
  it('user_metadata 를 보지 않는다 (프로필 role 만 받는다)', () => {
    const SRC = code(read('supabase/functions/send-email-authed/index.ts'));
    expect(SRC).not.toContain('user_metadata');
    expect(SRC).toContain("roleVerdict(profile?.role)");
  });
});

// ────────────────────────────────────────────────────────────
describe('H-3 본문 검증', () => {
  it('필수값 규칙이 원본 send-email 과 같다', () => {
    for (const body of [{}, { to: 'a@b.com' }, { to: 'a@b.com', subject: 's' },
                        { subject: 's', html: 'h' }, { to: '', subject: 's', html: 'h' }]) {
      const v = validateBody(body);
      expect(v.ok, JSON.stringify(body)).toBe(false);
      if (v.ok === false) { expect(v.status).toBe(400); expect(v.error).toBe('필수 파라미터 누락'); }
    }
  });

  it('최소 본문은 통과한다', () => {
    const v = validateBody(MAIL);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual(MAIL);
  });

  it('허용 필드는 send-email 이 읽는 7개뿐이다', () => {
    expect([...ALLOWED_FIELDS]).toEqual(['to', 'subject', 'html', 'text', 'reply_to', 'cc', 'attachments']);
  });

  it('모르는 필드는 거절한다 (send-email 로 흘려보내지 않는다)', () => {
    const v = validateBody({ ...MAIL, from: 'evil@x.com' });
    expect(v.ok).toBe(false);
    if (v.ok === false) { expect(v.status).toBe(400); expect(v.error).toContain('from'); }
  });

  it('수신자 배열도 받고 상한을 지킨다', () => {
    expect(validateBody({ ...MAIL, to: ['a@b.com', 'c@d.com'] }).ok).toBe(true);
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@b.com`);
    const v = validateBody({ ...MAIL, to: many });
    expect(v.ok).toBe(false);
  });

  it('수신자 이메일 형식을 본다', () => {
    expect(validateBody({ ...MAIL, to: 'not-an-email' }).ok).toBe(false);
  });

  it('reply_to 형식을 본다', () => {
    expect(validateBody({ ...MAIL, reply_to: 'sales@tebahsoft.com' }).ok).toBe(true);
    expect(validateBody({ ...MAIL, reply_to: 'nope' }).ok).toBe(false);
  });

  describe('cc — 기본 참조 정책을 건드리지 않는다 (CRM-002 cc_sales 토글)', () => {
    it('cc 키가 없으면 결과에도 없다 → send-email 이 RESEND_DEFAULT_CC 를 넣는다', () => {
      const v = validateBody(MAIL);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect('cc' in v.value).toBe(false);
        expect('cc' in buildForwardBody(v.value)).toBe(false);
      }
    });

    for (const blocker of [null, '']) {
      it(`cc=${JSON.stringify(blocker)} 는 그대로 전달한다 → 기본 참조가 꺼진다`, () => {
        const v = validateBody({ ...MAIL, cc: blocker });
        expect(v.ok).toBe(true);
        if (v.ok) {
          expect(v.value.cc).toBe(blocker);
          expect(buildForwardBody(v.value).cc).toBe(blocker);
        }
      });
    }

    it('cc 주소는 값을 바꾸지 않고 넘긴다', () => {
      const v = validateBody({ ...MAIL, cc: 'sales@tebahsoft.com' });
      expect(v.ok).toBe(true);
      if (v.ok) expect(buildForwardBody(v.value).cc).toBe('sales@tebahsoft.com');
    });

    it('cc 배열도 그대로, 상한은 지킨다', () => {
      expect(validateBody({ ...MAIL, cc: ['a@b.com', 'c@d.com'] }).ok).toBe(true);
      const many = Array.from({ length: MAX_CC + 1 }, (_, i) => `u${i}@b.com`);
      expect(validateBody({ ...MAIL, cc: many }).ok).toBe(false);
    });

    it('cc 가 잘못된 형식이면 거절', () => {
      expect(validateBody({ ...MAIL, cc: 'nope' }).ok).toBe(false);
      expect(validateBody({ ...MAIL, cc: 123 }).ok).toBe(false);
    });
  });

  describe('첨부 — CRM-022 실측 용량이 통과해야 한다', () => {
    const att = (n: number, bytes: number) =>
      Array.from({ length: n }, (_, i) => ({ filename: `f${i}.pdf`, content: 'A'.repeat(bytes) }));

    it('영어 7개 약 2.82MB(base64 약 3.87MB) 통과', () => {
      // 실제 base64 크기에 맞춘 근삿값으로 전체 상한을 넘지 않는지 본다
      const v = validateBody({ ...MAIL, attachments: att(7, Math.floor(3.87 * 1024 * 1024 / 7)) });
      expect(v.ok).toBe(true);
    });

    it('일본어 7개 약 4.60MB(base64 약 6.3MB) 통과', () => {
      const v = validateBody({ ...MAIL, attachments: att(7, Math.floor(6.3 * 1024 * 1024 / 7)) });
      expect(v.ok).toBe(true);
    });

    it('한국어 6개 약 4.58MB(base64 약 6.25MB) 통과', () => {
      const v = validateBody({ ...MAIL, attachments: att(6, Math.floor(6.25 * 1024 * 1024 / 6)) });
      expect(v.ok).toBe(true);
    });

    it('전체 상한을 넘기면 413', () => {
      const v = validateBody({ ...MAIL, attachments: att(2, Math.floor(MAX_TOTAL_BYTES * 0.6)) });
      expect(v.ok).toBe(false);
      if (v.ok === false) expect(v.status).toBe(413);
    });

    it(`첨부 개수 상한 ${MAX_ATTACHMENTS}`, () => {
      expect(validateBody({ ...MAIL, attachments: att(MAX_ATTACHMENTS, 10) }).ok).toBe(true);
      expect(validateBody({ ...MAIL, attachments: att(MAX_ATTACHMENTS + 1, 10) }).ok).toBe(false);
    });

    it('파일명·내용이 비면 거절', () => {
      expect(validateBody({ ...MAIL, attachments: [{ filename: '', content: 'x' }] }).ok).toBe(false);
      expect(validateBody({ ...MAIL, attachments: [{ filename: 'a.pdf', content: '' }] }).ok).toBe(false);
      expect(validateBody({ ...MAIL, attachments: ['nope'] }).ok).toBe(false);
    });

    it('첨부를 값 그대로 넘긴다', () => {
      const a = [{ filename: 'q.pdf', content: 'QkFTRTY0' }];
      const v = validateBody({ ...MAIL, attachments: a });
      expect(v.ok).toBe(true);
      if (v.ok) expect(buildForwardBody(v.value).attachments).toEqual(a);
    });
  });

  it('buildForwardBody 는 값을 하나도 바꾸지 않는다', () => {
    const full = { ...MAIL, text: 'plain', reply_to: 'sales@tebahsoft.com',
                   cc: 'x@y.com', attachments: [{ filename: 'a.pdf', content: 'AA' }] };
    const v = validateBody(full);
    expect(v.ok).toBe(true);
    if (v.ok) expect(buildForwardBody(v.value)).toEqual(full);
  });
});

// ────────────────────────────────────────────────────────────
describe('H-3 서버 함수 구조', () => {
  const IDX = code(read('supabase/functions/send-email-authed/index.ts'));

  it('검증 순서: JWT → 역할 → 본문 → 전달', () => {
    const i = (s: string) => { const n = IDX.indexOf(s); expect(n, s).toBeGreaterThan(-1); return n; };
    expect(i('authVerdict(')).toBeLessThan(i('roleVerdict('));
    expect(i('roleVerdict(')).toBeLessThan(i('validateBody('));
    expect(i('validateBody(')).toBeLessThan(i('functions/v1/send-email'));
  });

  it('내부 호출 헤더(internalHeaders)를 붙인다 (021-3)', () => {
    expect(IDX).toContain('internalHeaders()');
    expect(IDX).toContain("from '../_shared/internal.ts'");
  });

  it('JWT 검증에 anon 클라이언트를 쓴다 (service_role 로 하면 아무 토큰이나 통과)', () => {
    expect(IDX).toContain('createClient(SUPABASE_URL, ANON_KEY');
    expect(IDX).toContain('anon.auth.getUser(auth.jwt)');
  });

  it('Edge→Edge 호출은 ANON_KEY 를 Bearer 로 쓴다 (SERVICE_ROLE 은 401)', () => {
    const fwd = IDX.slice(IDX.indexOf('functions/v1/send-email'));
    expect(fwd).toContain('Bearer ${ANON_KEY}');
    expect(fwd).not.toContain('SERVICE_ROLE_KEY}`');
  });

  it('send-email 의 cc 정책 코드를 복제하지 않는다 (그 함수에 맡긴다)', () => {
    expect(IDX).not.toContain('RESEND_DEFAULT_CC');
  });
});

// ────────────────────────────────────────────────────────────
describe('H-3 브라우저 전환', () => {
  const EMAIL = read('src/lib/email.ts');
  const C = code(EMAIL);

  it('기본 경로가 authed 다', () => {
    expect(C).toContain("const transport = options?.transport ?? 'authed'");
    expect(C).toContain('functions/v1/send-email-authed');
    expect(C).toContain('authedFetch(');
  });

  it('세션 유무로 자동 판단하지 않는다 (조용한 폴백 금지)', () => {
    expect(C).not.toContain('getSession');
    expect(C).not.toMatch(/session\s*\?\s*'authed'/);
  });

  it('공개 경로는 transport 를 명시해야만 쓸 수 있다', () => {
    // sendQuoteEmail 만 'public' 기본값 — 공개 /order 가 부르기 때문
    expect(C).toContain("transport: params.transport ?? 'public'");
    const publics = [...C.matchAll(/transport:\s*(?:params\.transport\s*\?\?\s*)?'public'/g)];
    expect(publics).toHaveLength(1);
  });

  it('관리자 견적 메일 3곳은 authed 를 명시한다', () => {
    const DEALS = code(read('src/pages/Deals.tsx'));
    const authed = [...DEALS.matchAll(/transport: 'authed'/g)];
    expect(authed).toHaveLength(3);
  });

  it('럭키세븐 견적 메일이 send-email-authed 로 간다', () => {
    const LSE = code(read('src/lib/luckySevenEmail.ts'));
    expect(LSE).toContain('functions/v1/send-email-authed');
    expect(LSE).toContain('authedFetch(');
    // 남은 공개 키 Authorization 은 Storage 업로드용 HEADERS_FILE 하나뿐이다 (021-8e 담당).
    const anonAuth = [...LSE.matchAll(/Authorization:\s*`Bearer \$\{SUPABASE_KEY\}`/g)];
    expect(anonAuth).toHaveLength(1);
    expect(LSE).toContain('HEADERS_FILE');
  });

  it('럭키세븐 결제묶음 갱신도 로그인 토큰으로 간다', () => {
    const LSE = code(read('src/lib/luckySevenEmail.ts'));
    const lines = LSE.split('\n');
    const plain: number[] = [];
    lines.forEach((l, i) => {
      if (!/\bfetch\(/.test(l) || l.includes('authedFetch')) return;
      if (/rest\/v1\//.test(lines.slice(i, i + 6).join('\n'))) plain.push(i + 1);
    });
    expect(plain, `평범한 fetch 로 남은 rest/v1: ${plain.join(', ')}`).toHaveLength(0);
  });

  it('cc 처리 코드는 그대로다 (DEFAULT_CC 폴백 보존)', () => {
    expect(C).toContain("const cc = options?.cc === undefined ? DEFAULT_CC : options.cc;");
    expect(C).toContain('if (cc) body.cc = cc;');
  });

  it('남은 send-email 직접 호출은 2곳뿐이고 둘 다 설명된다', () => {
    // email.ts 의 public 분기 1곳 + 공개 /order(OrderTest.tsx, HARD-B) 1곳
    const hits: string[] = [];
    for (const f of ['src/lib/email.ts', 'src/pages/OrderTest.tsx', 'src/lib/luckySevenEmail.ts',
                     'src/pages/Deals.tsx', 'src/pages/Users.tsx', 'src/pages/Partners.tsx',
                     'src/pages/Campaigns.tsx', 'src/lib/partner-licenses.ts']) {
      const src = code(read(f));
      const n = [...src.matchAll(/functions\/v1\/send-email[`'"]/g)].length;
      if (n > 0) hits.push(`${f}:${n}`);
    }
    expect(hits).toEqual(['src/lib/email.ts:1', 'src/pages/OrderTest.tsx:1']);
  });
});
