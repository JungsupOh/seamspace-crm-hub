"""
일기 제본 가격 계산과 분권(分冊) 계획.

가격표는 /shop 의 diary 상품(supabase/add_diary_print_product.sql)과 같은 값이다.
한쪽만 고치면 견적과 결제 금액이 어긋나므로 둘을 함께 고쳐야 한다.

페이지 수는 '실제로 렌더되는 일기 수'다. 일기 1개 = 정확히 1페이지이고,
render.is_renderable() 이 같은 판정을 쓴다 — 견적 100p / 인쇄 98p 가 되지 않도록.

이 계산은 여기에만 둔다. 화면 쪽에 같은 로직을 한 벌 더 두면 언젠가 어긋나고,
어긋나면 26,000원으로 견적한 책이 160페이지로 인쇄되는 돈 문제가 된다.
그래서 화면은 분책 경계를 바꿀 때마다 /api/print/quote 를 호출한다.
"""

import math

# (최소페이지, 최대페이지, 가격)
BANDS = (
    (36, 100, 26000),
    (101, 150, 29000),
    (151, 200, 32000),
    (201, 250, 35000),
    (251, 300, 38000),
)

SHIPPING_FEE = 3500  # 주문당 1회. 제작 상품이라 권수가 늘어도 실비가 줄지 않는다.
MIN_PAGES = BANDS[0][0]   # 36. 미만은 인쇄 불가
MAX_PAGES = BANDS[-1][1]  # 300. 초과는 분권 대상


def price_for(pages):
    """페이지 수에 해당하는 권당 가격. 구간 밖이면 None."""
    for low, high, price in BANDS:
        if low <= pages <= high:
            return price
    return None


def _groups_within(counts, cap):
    """
    월별 개수를 앞에서부터 cap 이하로 묶는다(월 경계를 넘지 않는 연속 묶음).
    반환: [(시작index, 끝index), ...]
    """
    groups = []
    start = 0
    running = 0
    for i, n in enumerate(counts):
        if running + n > cap and running > 0:
            groups.append((start, i - 1))
            start, running = i, n
        else:
            running += n
    if counts:
        groups.append((start, len(counts) - 1))
    return groups


def _split_balanced(counts, n_volumes):
    """
    연속 구간 n개로 나누되 '가장 두꺼운 권'을 최소화한다(이분 탐색).

    균등하게 갈라야 하는 이유: 340페이지를 앞에서부터 채우면 300/40 이 되어
    2권째가 최소 36페이지를 못 넘겨 인쇄 불가가 된다. 균등 분할이면 170/170 이다.
    """
    if not counts:
        return []
    total = sum(counts)
    lo = max(max(counts), math.ceil(total / n_volumes))
    hi = total
    best = _groups_within(counts, hi)
    while lo <= hi:
        mid = (lo + hi) // 2
        groups = _groups_within(counts, mid)
        if len(groups) <= n_volumes:
            best = groups
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def _build(months, groups):
    """(시작,끝) 인덱스 묶음을 권 목록 + 견적으로 만든다."""
    warnings = []
    volumes = []
    for idx, (start, end) in enumerate(groups, start=1):
        span = months[start : end + 1]
        pages = sum(m["count"] for m in span)
        price = price_for(pages)
        if price is None:
            if pages < MIN_PAGES:
                warnings.append(f"{idx}권이 {pages}p 입니다. 최소 {MIN_PAGES}p 이상이어야 합니다.")
            else:
                warnings.append(f"{idx}권이 {pages}p 입니다. 한 권은 최대 {MAX_PAGES}p 입니다.")
        volumes.append(
            {
                "volume": idx,
                "from": span[0]["ym"],
                "to": span[-1]["ym"],
                "months": [m["ym"] for m in span],
                "pages": pages,
                "price": price,
            }
        )

    product_total = sum(v["price"] for v in volumes if v["price"] is not None)
    printable = bool(volumes) and all(v["price"] is not None for v in volumes)

    return {
        "printable": printable,
        "totalPages": sum(v["pages"] for v in volumes),
        "volumes": volumes,
        "productTotal": product_total,
        "shippingFee": SHIPPING_FEE,
        "grandTotal": product_total + SHIPPING_FEE,
        "warnings": warnings,
    }


def _not_printable(total, reason):
    return {
        "printable": False,
        "reason": reason,
        "totalPages": total,
        "volumes": [],
        "productTotal": 0,
        "shippingFee": 0,
        "grandTotal": 0,
        "warnings": [],
    }


def plan_volumes(months):
    """
    월별 집계로 분권 계획과 견적을 자동으로 만든다.

    months: [{'ym': '2026-01', 'count': 28}, ...] — 인쇄할 구간, 날짜 오름차순.
    """
    months = [m for m in months if m.get("count", 0) > 0]
    counts = [m["count"] for m in months]
    total = sum(counts)

    if total < MIN_PAGES:
        return _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {MIN_PAGES}편부터 인쇄할 수 있습니다."
        )

    n_volumes = math.ceil(total / MAX_PAGES)
    groups = _split_balanced(counts, n_volumes)

    # 한 달은 많아야 31편이라 월 단위로 끊어도 300 이하 구성이 항상 가능하다.
    # 그래도 방어적으로 한 번 더 늘려 본다.
    while groups and n_volumes < len(counts):
        if max(sum(counts[s : e + 1]) for s, e in groups) <= MAX_PAGES:
            break
        n_volumes += 1
        groups = _split_balanced(counts, n_volumes)

    return _build(months, groups)


def plan_with_splits(months, split_ends):
    """
    사용자가 분책 경계를 직접 정했을 때의 계획.

    split_ends: 각 권의 '마지막 달' 목록(예: ['2026-06', '2026-12']).
                마지막 권의 끝은 구간의 끝으로 자동 처리한다.
    """
    months = [m for m in months if m.get("count", 0) > 0]
    total = sum(m["count"] for m in months)
    if not months:
        return _not_printable(0, "인쇄할 일기가 없습니다.")
    if total < MIN_PAGES:
        return _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {MIN_PAGES}편부터 인쇄할 수 있습니다."
        )

    ends = set(split_ends or [])
    groups = []
    start = 0
    for i, m in enumerate(months):
        if m["ym"] in ends and i < len(months) - 1:
            groups.append((start, i))
            start = i + 1
    groups.append((start, len(months) - 1))

    return _build(months, groups)
