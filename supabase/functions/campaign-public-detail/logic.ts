// campaign-public-detail 의 순수 로직 — 입력 검증과 열 목록.

const MAX_SLUG = 120;

/** 공개 폼(/c/:slug)이 **실제로 쓰는** 열만.
 *
 *  뺀 것과 이유:
 *    budget, actual_cost            — 내부 집행 비용. 공개 폼에 내려갈 이유가 없다
 *    coupon_settings                — 이 캠페인이 **무엇을 얼마나 주는지**. 서버가 DB 에서
 *    trial_license_settings           다시 읽으므로(campaign-submit-lead 3단계) 브라우저에 줄 필요가 없다
 *    type, created_at, slug, start_date — 화면이 쓰지 않는다
 */
export const CAMPAIGN_COLS = [
  'id', 'name', 'title', 'description', 'image_url', 'status', 'end_date', 'form_settings',
] as const;

export type Verdict =
  | { ok: true; slug: string }
  | { ok: false; status: 400; error: string };

export function validateInput(raw: unknown): Verdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => k !== 'slug');
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const slug = typeof b.slug === 'string' ? b.slug.trim() : '';
  // 슬러그는 주소에 들어가는 값이라 글자 범위를 좁게 본다.
  if (!slug || slug.length > MAX_SLUG || !/^[A-Za-z0-9가-힣_-]+$/.test(slug)) {
    return { ok: false, status: 400, error: '캠페인을 찾을 수 없습니다.' };
  }
  return { ok: true, slug };
}
