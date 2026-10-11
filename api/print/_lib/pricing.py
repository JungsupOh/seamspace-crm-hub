"""
일기 제본 가격 계산과 분권(分冊) 계획.

제작은 스위트북 Book Print API 의 PHOTOBOOK_A5_SC 판형으로 나간다.
내지 캔버스가 154×216mm 로 우리 렌더러(render.PAGE_SIZE)와 정확히 같아서
내지는 그대로 올릴 수 있고, 제약만 판형을 따라간다.

  페이지 범위   50 ~ 200       (pageMin / pageMax)
  페이지 단위   2의 배수       (pageIncrement)

판형 제약은 SPEC_* 상수로 모아 뒀다. 판형을 바꾸면 여기만 고치면 되지만,
가격표(BANDS)는 원가가 달라지므로 반드시 같이 재검토해야 한다.

가격표는 /shop 의 diary 상품(supabase/add_diary_print_product.sql)과 같은 값이다.
한쪽만 고치면 견적과 결제 금액이 어긋나므로 둘을 함께 고쳐야 한다.

페이지 수는 '실제로 렌더되는 일기 수'에서 출발한다. 일기 1개 = 정확히 1페이지이고,
render.is_renderable() 이 같은 판정을 쓴다 — 견적 100p / 인쇄 98p 가 되지 않도록.
거기에 판형 제약(짝수·최소 50p)을 맞추려고 빈 페이지를 채운 값이 '인쇄 페이지 수'이며,
가격은 인쇄 페이지 수로 매긴다.

이 계산은 여기에만 둔다. 화면 쪽에 같은 로직을 한 벌 더 두면 언젠가 어긋나고,
어긋나면 견적한 금액과 실제 인쇄물이 달라진다.
그래서 화면은 분책 경계를 바꿀 때마다 /api/print/quote 를 호출한다.
"""

import math

# ── 판형 제약 (스위트북 PHOTOBOOK_A5_SC) ────────────
SPEC_UID = "PHOTOBOOK_A5_SC"
SPEC_PAGE_MIN = 50       # 이보다 적으면 빈 페이지로 채워서 제작
SPEC_PAGE_MAX = 200      # 초과분은 분권 대상
SPEC_PAGE_INCREMENT = 2  # 페이지 수는 2의 배수여야 한다

# 판매 최소 편수. 판형 최소(50p)보다 낮게 잡고 모자란 만큼 빈 페이지로 채운다.
# 36~49편도 50p 가격을 그대로 내므로 손해는 없고, 기존 안내("최소 36p")를 유지할 수 있다.
MIN_DIARIES = 36

# (최소페이지, 최대페이지, 가격) — 인쇄 페이지 수 기준
BANDS = (
    (50, 100, 27000),
    (101, 150, 32000),
    (151, 200, 37000),
)

# 자동 분권 방식. 화면에서 고객이 고른다.
#   cheapest — 총 제작비가 가장 싼 월 경계 (기본값)
#   balanced — 권 두께를 고르게 (가격이 구간제라 더 비쌀 수 있다)
MODES = ("cheapest", "balanced")
DEFAULT_MODE = "cheapest"

# 주문당 1회. 스위트북 배송비가 박스당 3,000원이고 A5 는 150권/박스라
# 분권해도 한 박스에 들어간다 — 권수가 늘어도 배송비는 한 번만 받는다.
SHIPPING_FEE = 3000


def printed_pages(diaries):
    """
    일기 수 → 실제 인쇄 페이지 수.

    판형이 2의 배수만 받고 최소 50p 라서, 모자라는 만큼 빈 페이지가 들어간다.
    가격도 이 값으로 매긴다 — 인쇄소에 내는 돈이 이 값으로 정해지기 때문이다.
    """
    if diaries <= 0:
        return 0
    pages = max(diaries, SPEC_PAGE_MIN)
    if pages % SPEC_PAGE_INCREMENT:
        pages += SPEC_PAGE_INCREMENT - (pages % SPEC_PAGE_INCREMENT)
    return pages


def price_for(pages):
    """인쇄 페이지 수에 해당하는 권당 가격. 구간 밖이면 None."""
    for low, high, price in BANDS:
        if low <= pages <= high:
            return price
    return None


def _groups_within(counts, cap):
    """월별 개수를 앞에서부터 cap 이하로 묶는다. 반환: [(시작index, 끝index), ...]"""
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


def _balanced_groups(counts):
    """
    권 두께를 고르게 나눈다. 권수는 '최소 권수'로 고정하고 그 안에서 고르게 편다.

      1) 최소 권수 k — 한 권 200p 제약을 지키는 가장 적은 권수 (greedy)
      2) 상한 M — k권을 유지하면서 가능한 가장 작은 '가장 두꺼운 권' (이분 탐색)
      3) 두께 M 이하 · k권 조건에서 **가장 얇은 권을 최대화** (DP)

    3단계가 없으면 이름값을 못 한다. 2단계까지만 하면 두꺼운 쪽만 눌리고 얇은 권이
    쪼그라들어, 최저가 분할보다 편차가 더 커지는 경우가 실제로 나온다.
    권수를 k로 고정하지 않으면 더 잘게 쪼개서 편차 0을 만들어 버린다 — 230편을
    50p × 10권(273,000원)으로 내놓는 식이라 의미가 없다.

    최저가 분할보다 비쌀 수 있다 — 가격이 구간제라 두께를 맞추려다 구간 경계를
    넘기면 권당 5,000원이 더 든다. 어느 쪽이 얼마인지는 화면에서 같이 보여준다.
    """
    if not counts:
        return []
    n = len(counts)
    total = sum(counts)
    if max(counts) > SPEC_PAGE_MAX:
        return None                     # 한 달이 혼자 200p 초과 — 월 경계로 못 나눔

    k = len(_groups_within(counts, SPEC_PAGE_MAX))   # 최소 권수 (greedy 가 최적)

    # 2) k권을 유지하는 최소 상한 M
    lo, hi, M = max(counts), total, total
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(_groups_within(counts, mid)) <= k:
            M, hi = mid, mid - 1
        else:
            lo = mid + 1

    # 3) dp[i][g] = months[0..i-1] 를 g권으로 덮을 때 '가장 얇은 권'의 최댓값
    NEG = -1
    dp = [[NEG] * (k + 1) for _ in range(n + 1)]
    prev = [[None] * (k + 1) for _ in range(n + 1)]
    dp[0][0] = float("inf")
    for i in range(1, n + 1):
        for g in range(1, k + 1):
            run = 0
            for j in range(i - 1, -1, -1):
                run += counts[j]
                if run > M:
                    break
                if dp[j][g - 1] == NEG:
                    continue
                cand = min(dp[j][g - 1], run)
                if cand > dp[i][g]:
                    dp[i][g], prev[i][g] = cand, j
    if dp[n][k] == NEG:
        return None

    groups = []
    i, g = n, k
    while i > 0:
        j = prev[i][g]
        groups.append((j, i - 1))
        i, g = j, g - 1
    groups.reverse()
    return groups


def _cheapest_groups(counts):
    """
    월 경계를 넘지 않는 연속 묶음으로 나누되 **총 제작비가 가장 싼** 조합을 찾는다(DP).

    균등 분할이 아니라 최저가 분할이어야 하는 이유: 가격이 구간제라 권당 페이지가
    구간 경계를 한 장만 넘어도 5,000원이 뛴다. 230편(23편 × 10개월)을 균등하게
    115/115 로 자르면 짝수 보정까지 더해 116p + 116p = 64,000원이지만,
    92/138 로 자르면 27,000 + 32,000 = 59,000원이다.

    제약: 한 권은 200p(SPEC_PAGE_MAX)를 넘을 수 없다. 50p 미만은 빈 페이지로
    채워 제작 자체는 가능하므로 금지하지 않고, 비용에 그대로 반영되게 둔다
    (빈 페이지도 돈을 내므로 DP 가 알아서 피한다).

    월별 페이지 수에 상한은 없다 — 하루에 두 편 이상 쓸 수 있다. 그래서 한 달이
    혼자 200p 를 넘으면 월 경계만으로는 어떤 조합도 만들 수 없고, 이 함수는
    None 을 돌려준다(호출자가 그 달을 짚어 안내한다).

    동점이면 권수가 적은 쪽, 그다음 가장 두꺼운 권이 얇은 쪽을 고른다.
    반환: [(시작index, 끝index), ...] 또는 구성 불가 시 None
    """
    n = len(counts)
    # dp[i] = (총비용, 권수, 가장두꺼운권, 직전경계) — months[0..i-1] 까지 덮는 최선
    dp = [None] * (n + 1)
    dp[0] = (0, 0, 0, None)
    for i in range(1, n + 1):
        best = None
        run = 0
        for j in range(i - 1, -1, -1):
            run += counts[j]
            if run > SPEC_PAGE_MAX:
                break                      # 더 왼쪽으로 가면 더 두꺼워질 뿐
            if dp[j] is None:
                continue
            pages = printed_pages(run)
            price = price_for(pages)
            if price is None:
                continue
            cand = (dp[j][0] + price, dp[j][1] + 1, max(dp[j][2], pages), j)
            if best is None or cand[:3] < best[:3]:
                best = cand
        dp[i] = best

    if dp[n] is None:
        return None

    groups = []
    i = n
    while i > 0:
        j = dp[i][3]
        groups.append((j, i - 1))
        i = j
    groups.reverse()
    return groups


def _build(months, groups):
    """(시작,끝) 인덱스 묶음을 권 목록 + 견적으로 만든다."""
    warnings = []
    volumes = []
    multi = len(groups) > 1
    for idx, (start, end) in enumerate(groups, start=1):
        span = months[start : end + 1]
        diaries = sum(m["count"] for m in span)
        pages = printed_pages(diaries)
        price = price_for(pages)
        blanks = pages - diaries

        if price is None:
            warnings.append(
                f"{idx}권이 {pages}p 입니다. 한 권은 {SPEC_PAGE_MIN}~{SPEC_PAGE_MAX}p 여야 합니다."
            )
        elif multi and diaries < SPEC_PAGE_MIN:
            # 단권이면 빈 페이지로 채우는 게 정상이지만, 분권해서 얇은 권이 나왔다면
            # 경계를 잘못 잡은 것이다. 빈 페이지 값을 치르게 되므로 알려준다.
            warnings.append(
                f"{idx}권이 {diaries}편뿐이라 빈 페이지 {blanks}장이 들어갑니다. "
                f"분책 경계를 조정해 보세요."
            )
        elif blanks:
            warnings.append(f"{idx}권에 빈 페이지 {blanks}장이 들어갑니다 ({diaries}편 → {pages}p).")

        volumes.append(
            {
                "volume": idx,
                "from": span[0]["ym"],
                "to": span[-1]["ym"],
                "months": [m["ym"] for m in span],
                "diaries": diaries,
                "blanks": blanks,
                "pages": pages,
                "price": price,
            }
        )

    product_total = sum(v["price"] for v in volumes if v["price"] is not None)
    printable = bool(volumes) and all(v["price"] is not None for v in volumes)

    return {
        "printable": printable,
        "totalDiaries": sum(v["diaries"] for v in volumes),
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
        "totalDiaries": total,
        "totalPages": 0,
        "volumes": [],
        "productTotal": 0,
        "shippingFee": 0,
        "grandTotal": 0,
        "warnings": [],
    }


def _plan(months, counts, total, mode):
    groups = _cheapest_groups(counts) if mode == "cheapest" else _balanced_groups(counts)
    if groups is None:
        # 월 경계로는 나눌 수 없다 = 어떤 달 하나가 혼자 200p 를 넘는다.
        # (하루에 두 편 이상 쓰면 실제로 생긴다)
        over = [m for m in months if printed_pages(m["count"]) > SPEC_PAGE_MAX]
        if over:
            names = ", ".join(f"{m['ym']}({m['count']}편)" for m in over[:3])
            more = f" 외 {len(over) - 3}개월" if len(over) > 3 else ""
            return _not_printable(
                total,
                f"{names}{more} 은 한 달만으로 {SPEC_PAGE_MAX}p 를 넘습니다. "
                f"월 경계로는 나눌 수 없으니 그 달을 빼고 인쇄하거나 따로 문의해 주세요.",
            )
        return _not_printable(
            total, f"월 단위로 나눠도 한 권이 {SPEC_PAGE_MAX}p 를 넘습니다. 인쇄 구간을 좁혀 주세요."
        )
    return _build(months, groups)


def _summary(plan, mode):
    """화면에서 두 분권 방식을 나란히 비교할 때 쓰는 요약."""
    return {
        "mode": mode,
        "printable": plan["printable"],
        "reason": plan.get("reason"),
        "volumeCount": len(plan["volumes"]),
        "totalPages": plan["totalPages"],
        "productTotal": plan["productTotal"],
        "grandTotal": plan["grandTotal"],
        "pages": [v["pages"] for v in plan["volumes"]],
    }


def plan_volumes(months, mode=DEFAULT_MODE):
    """
    월별 집계로 분권 계획과 견적을 만든다.

    months: [{'ym': '2026-01', 'count': 28}, ...] — 인쇄할 구간, 날짜 오름차순.
    mode:   'cheapest'(기본) | 'balanced'

    선택한 방식의 계획을 돌려주되, 두 방식의 요약을 'options' 에 함께 싣는다.
    화면이 "균등으로 하면 +5,000원" 을 한 번의 호출로 보여줄 수 있어야 하기 때문이다.
    """
    if mode not in MODES:
        mode = DEFAULT_MODE
    months = [m for m in months if m.get("count", 0) > 0]
    counts = [m["count"] for m in months]
    total = sum(counts)

    if total < MIN_DIARIES:
        out = _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {MIN_DIARIES}편부터 인쇄할 수 있습니다."
        )
        out["mode"] = mode
        out["options"] = []
        return out

    plans = {m: _plan(months, counts, total, m) for m in MODES}
    out = dict(plans[mode])
    out["mode"] = mode
    out["options"] = [_summary(plans[m], m) for m in MODES]
    return out


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
    if total < MIN_DIARIES:
        return _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {MIN_DIARIES}편부터 인쇄할 수 있습니다."
        )

    ends = set(split_ends or [])
    groups = []
    start = 0
    for i, m in enumerate(months):
        if m["ym"] in ends and i < len(months) - 1:
            groups.append((start, i))
            start = i + 1
    groups.append((start, len(months) - 1))

    out = _build(months, groups)
    out["mode"] = "manual"
    # 수동 경계여도 자동 두 안의 금액은 같이 내려준다 — 화면에서 "자동으로 되돌리기"가
    # 가능해야 하고, 직접 지정한 경계가 자동보다 비싼지도 바로 보여야 한다.
    counts = [m["count"] for m in months]
    out["options"] = [_summary(_plan(months, counts, total, m), m) for m in MODES]
    return out
