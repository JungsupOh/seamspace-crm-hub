"""
일기 제본 가격 계산과 분권(分冊) 계획.

제작 업체를 고를 수 있다. 업체마다 **페이지 규칙과 단가가 다르므로** 둘을 한 덩어리로
묶어 VENDORS 에 둔다. 한쪽만 바꾸면 견적과 실제 청구가 어긋난다.

  ddukddak   뚝딱샵 — 현재 쓰는 곳. A5 148×210, 36~300p, 단가 5구간, 배송비 3,500원
  sweetbook  스위트북 Book Print API — A5 소프트커버(PHOTOBOOK_A5_SC) 148×210,
             50~200p·2의 배수, 단가 3구간, 배송비 3,000원

지금은 두 업체의 재단 크기가 같아(A5) 렌더러 좌표계(154×216mm = A5+도련 3mm)를
그대로 쓴다. 판형이 다른 업체를 붙이면 trim 두 줄만 고치면 되고, 렌더러가 **균일
배율**로 맞춘다(render.render_volume 주석 참고 — 비율이 깨지지 않는다).

스위트북 내지 PDF 캔버스가 154×216mm 로 render.PAGE_SIZE 와 정확히 같아서 내지는
재조판 없이 그대로 올릴 수 있다. 페이지 규칙과 단가만 다르다.

페이지 수는 '실제로 렌더되는 일기 수'에서 출발한다. 일기 1개 = 정확히 1페이지이고,
render.is_renderable() 이 같은 판정을 쓴다 — 견적 100p / 인쇄 98p 가 되지 않도록.
업체의 페이지 규칙(최소 페이지·증가 단위)을 맞추려고 빈 페이지를 채운 값이
'인쇄 페이지 수'이며 가격은 이 값으로 매긴다. generate 도 같은 값까지 빈 페이지를
채워 만들어야 견적과 실물이 맞는다.

뚝딱샵 가격표는 /shop 의 diary 상품(supabase/add_diary_print_product.sql)과 같은 값이다.
한쪽만 고치면 견적과 결제 금액이 어긋나므로 둘을 함께 고쳐야 한다.

이 계산은 여기에만 둔다. 화면 쪽에 같은 로직을 한 벌 더 두면 언젠가 어긋나고,
어긋나면 26,000원으로 견적한 책이 160페이지로 인쇄되는 돈 문제가 된다.
그래서 화면은 업체·분권 방식·분책 경계가 바뀔 때마다 /api/print/quote 를 호출한다.
"""

import math

# ── 제작 업체 프로파일 ──────────────────────────────
# bands: (최소페이지, 최대페이지, 권당 가격) — 인쇄 페이지 수 기준
VENDORS = {
    "ddukddak": {
        "label": "뚝딱샵",
        "spec": None,                # 별도 판형 코드 없음
        # AI 출판 > 셀프디자인(productId=13889)에 A5 가 있다. 소프트/하드커버 둘 다.
        # 선택 가능한 판형: A5 148×210 / 신국판 152×225 / 크라운판 176×248 /
        #                   B5 188×257 / A4 210×297
        # (학급문집 쪽 셀프디자인(7836)에는 사이즈 선택에서 A5 가 빠져 있다 — 상품이 다르다)
        #
        # A5 로 두면 스위트북과 재단 크기가 같아 렌더러 좌표계(154×216)를 그대로 쓴다.
        # 판형을 바꾸려면 이 두 줄만 고치면 되고, render 가 균일 배율로 맞춘다.
        "trim": (148.0, 210.0),
        "trim_label": "A5 148×210",
        "page_min": 36,              # 이보다 적으면 제작 불가
        "page_max": 300,             # 초과는 분권 대상
        "page_increment": 1,         # 페이지 수 제약 없음
        "min_diaries": 36,           # 판매 최소 편수
        "pricing": "bands",
        "bands": (
            (36, 100, 26000),
            (101, 150, 29000),
            (151, 200, 32000),
            (201, 250, 35000),
            (251, 300, 38000),
        ),
        # 주문당 1회. 제작 상품이라 권수가 늘어도 실비가 줄지 않는다.
        "shipping_fee": 3500,
    },
    "sweetbook": {
        "label": "스위트북",
        "spec": "PHOTOBOOK_A5_SC",   # A5 소프트커버
        "trim": (148.0, 210.0),
        "trim_label": "A5 148×210",
        "page_min": 50,              # 이보다 적으면 빈 페이지로 채워서 제작
        "page_max": 200,
        "page_increment": 2,         # 페이지 수는 2의 배수여야 한다
        # 판형 최소와 같게 둔다. 36편으로 받으면 빈 페이지가 14장이나 들어간 책이
        # 나오는데, 50p 값을 다 내고 절반 가까이 백지인 책을 받게 된다.
        "min_diaries": 50,
        # 원가가 페이지당 100원 선형이라 가격도 선형으로 간다. 구간제는 구간 안에서
        # 마진이 반토막 나고(50p 51% / 200p 20%), 한 장 차이로 5,000원이 뛰는 걸
        # 고객에게 설명할 수 없다.
        #
        # 공급가(VAT 제외)를 천 단위로 맞추고 화면에는 VAT 포함가를 보여준다.
        # 스위트북 원가가 마침 10페이지당 정확히 1,000원(공급가)이라 떨어진다.
        # 추가 페이지는 원가 그대로 받고 마진은 기본료에만 넣는다.
        #
        # 2권째부터 기본료를 낮춘다 — 분권은 고객이 원해서 하는 게 아니라 판형 상한
        # 때문에 강제되는 것이라, 1권째와 같은 마진을 또 받으면 부담이 급등한다.
        "pricing": "blocks",
        "base_supply": 20000,          # 1권째 (50p 포함). 원가 11,900 + 마진 8,100
        "extra_base_supply": 13000,    # 2권째~.  원가 11,900 + 마진 1,100
        "block_pages": 10,
        "block_supply": 1000,          # 10p당 — 스위트북 원가와 동일
        # 스위트북 배송비는 박스당 3,000원이고 A5 는 150권/박스라 분권해도 한 박스다.
        "shipping_fee": 3000,
    },
}

DEFAULT_VENDOR = "ddukddak"

# 자동 분권 방식. 화면에서 고객이 고른다.
#   cheapest — 총 제작비가 가장 싼 월 경계 (기본값)
#   balanced — 권 두께를 고르게 (가격이 구간제라 더 비쌀 수 있다)
VAT_NUM, VAT_DEN = 11, 10      # 부가세 10%. 정수로 계산한다 —
                               # 20000 * 1.1 은 22000.000000000004 가 되어 절삭 사고가 난다

MODES = ("cheapest", "balanced")
DEFAULT_MODE = "cheapest"


def resolve_vendor(name):
    """업체 키를 정규화한다. 모르는 값이면 기본 업체."""
    return name if name in VENDORS else DEFAULT_VENDOR


def vendor_info(name=None):
    """화면에 뿌릴 업체 정보 (가격표 포함)."""
    key = resolve_vendor(name)
    v = VENDORS[key]
    out = {
        "vendor": key,
        "label": v["label"],
        "spec": v["spec"],
        "pageMin": v["page_min"],
        "pageMax": v["page_max"],
        "pageIncrement": v["page_increment"],
        "minDiaries": v["min_diaries"],
        "shippingFee": v["shipping_fee"],
        "trimWidthMm": v["trim"][0],
        "trimHeightMm": v["trim"][1],
        "trimLabel": v["trim_label"],
        "pricing": v["pricing"],
    }
    if v["pricing"] == "bands":
        out["bands"] = [{"from": lo, "to": hi, "price": pr} for lo, hi, pr in v["bands"]]
    else:
        out["basePrice"] = _vat(v["base_supply"])
        out["extraBasePrice"] = _vat(v["extra_base_supply"])
        out["blockPages"] = v["block_pages"]
        out["blockPrice"] = _vat(v["block_supply"])
    return out


def vendor_list():
    return [vendor_info(k) for k in VENDORS]


def trim_size(vendor=DEFAULT_VENDOR):
    """업체의 재단 크기 (mm). 내지·표지 캔버스는 여기에 도련 3mm 를 더한다."""
    return VENDORS[resolve_vendor(vendor)]["trim"]


BLEED_MM = 3.0


def page_size(vendor=DEFAULT_VENDOR):
    """도련 포함 인쇄 캔버스 크기 (mm). 뚝딱샵 가이드도 좌우상하 각 3mm 를 요구한다."""
    w, h = trim_size(vendor)
    return w + BLEED_MM * 2, h + BLEED_MM * 2


def printed_pages(diaries, vendor=DEFAULT_VENDOR):
    """
    일기 수 → 실제 인쇄 페이지 수.

    업체의 페이지 규칙(최소 페이지·증가 단위)에 모자라는 만큼 빈 페이지가 들어간다.
    가격도 이 값으로 매긴다 — 인쇄소에 내는 돈이 이 값으로 정해지기 때문이다.
    """
    v = VENDORS[resolve_vendor(vendor)]
    if diaries <= 0:
        return 0
    pages = max(diaries, v["page_min"])
    inc = v["page_increment"]
    if inc > 1 and pages % inc:
        pages += inc - (pages % inc)
    return pages


def _vat(supply):
    """공급가 → VAT 포함가. 정수 연산."""
    return supply * VAT_NUM // VAT_DEN


def price_for(pages, vendor=DEFAULT_VENDOR, first=True):
    """
    인쇄 페이지 수에 해당하는 권당 가격(VAT 포함). 범위 밖이면 None.

    first=False 는 분권의 2권째 이후다 — 기본료가 낮다.
    """
    v = VENDORS[resolve_vendor(vendor)]
    if v["pricing"] == "bands":
        for low, high, price in v["bands"]:
            if low <= pages <= high:
                return price
        return None

    if not (v["page_min"] <= pages <= v["page_max"]):
        return None
    base = v["base_supply"] if first else v["extra_base_supply"]
    blocks = math.ceil((pages - v["page_min"]) / v["block_pages"])
    return _vat(base + blocks * v["block_supply"])


def shipping_fee(vendor=DEFAULT_VENDOR):
    return VENDORS[resolve_vendor(vendor)]["shipping_fee"]


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


def _balanced_groups(counts, vendor):
    """
    권 두께를 고르게 나눈다. 권수는 '최소 권수'로 고정하고 그 안에서 고르게 편다.

      1) 최소 권수 k — 한 권 page_max 제약을 지키는 가장 적은 권수 (greedy)
      2) 상한 M — k권을 유지하면서 가능한 가장 작은 '가장 두꺼운 권' (이분 탐색)
      3) 두께 M 이하 · k권 조건에서 **가장 얇은 권을 최대화** (DP)

    3단계가 없으면 이름값을 못 한다. 2단계까지만 하면 두꺼운 쪽만 눌리고 얇은 권이
    쪼그라들어, 최저가 분할보다 편차가 더 커지는 경우가 실제로 나온다.
    권수를 k로 고정하지 않으면 더 잘게 쪼개서 편차 0을 만들어 버린다.

    최저가 분할보다 비쌀 수 있다 — 가격이 구간제라서 두께를 맞추려다 구간 경계를
    넘기면 권당 수천 원이 더 든다. 어느 쪽이 얼마인지는 화면에서 같이 보여준다.
    """
    page_max = VENDORS[resolve_vendor(vendor)]["page_max"]
    if not counts:
        return []
    n = len(counts)
    total = sum(counts)
    if max(counts) > page_max:
        return None                     # 한 달이 혼자 상한 초과 — 월 경계로 못 나눔

    k = len(_groups_within(counts, page_max))   # 최소 권수 (greedy 가 최적)

    lo, hi, M = max(counts), total, total
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(_groups_within(counts, mid)) <= k:
            M, hi = mid, mid - 1
        else:
            lo = mid + 1

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


def _cheapest_groups(counts, vendor):
    """
    월 경계를 넘지 않는 연속 묶음으로 나누되 **총 제작비가 가장 싼** 조합을 찾는다(DP).

    균등 분할이 아니라 최저가 분할이어야 하는 이유: 가격이 구간제라 권당 페이지가
    구간 경계를 한 장만 넘어도 가격이 뛴다. 스위트북 기준 230편(23편 × 10개월)을
    균등하게 115/115 로 자르면 짝수 보정까지 더해 116p + 116p = 64,000원이지만,
    92/138 로 자르면 27,000 + 32,000 = 59,000원이다.

    제약: 한 권은 page_max 를 넘을 수 없다. 최소 페이지 미만은 빈 페이지로 채워
    제작 자체는 가능하므로 금지하지 않고, 비용에 그대로 반영되게 둔다
    (빈 페이지도 돈을 내므로 DP 가 알아서 피한다).

    월별 페이지 수에 상한은 없다 — 하루에 두 편 이상 쓸 수 있다. 그래서 한 달이
    혼자 page_max 를 넘으면 월 경계만으로는 어떤 조합도 만들 수 없고, 이 함수는
    None 을 돌려준다(호출자가 그 달을 짚어 안내한다).

    동점이면 권수가 적은 쪽, 그다음 가장 두꺼운 권이 얇은 쪽을 고른다.

    가격 모델이 '1권째만 기본료가 비싼' 구조일 때도 이 DP 를 그대로 쓴다.
    전부 2권째 가격(first=False)으로 비교하면 되는데, 어떤 해를 고르든 첫 권 하나에만
    같은 차액이 더해지므로 **총액 순위가 바뀌지 않기 때문**이다. 실제 금액은
    _build() 가 첫 권만 first=True 로 다시 매긴다.
    """
    page_max = VENDORS[resolve_vendor(vendor)]["page_max"]
    n = len(counts)
    dp = [None] * (n + 1)
    dp[0] = (0, 0, 0, None)
    for i in range(1, n + 1):
        best = None
        run = 0
        for j in range(i - 1, -1, -1):
            run += counts[j]
            if run > page_max:
                break
            if dp[j] is None:
                continue
            pages = printed_pages(run, vendor)
            price = price_for(pages, vendor, first=False)
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


def _build(months, groups, vendor):
    """(시작,끝) 인덱스 묶음을 권 목록 + 견적으로 만든다."""
    v = VENDORS[resolve_vendor(vendor)]
    warnings = []
    volumes = []
    multi = len(groups) > 1
    for idx, (start, end) in enumerate(groups, start=1):
        span = months[start : end + 1]
        diaries = sum(m["count"] for m in span)
        pages = printed_pages(diaries, vendor)
        # 1권째만 기본료를 제값으로 받는다(blocks 모델). bands 모델은 first 를 무시한다.
        price = price_for(pages, vendor, first=(idx == 1))
        blanks = pages - diaries

        if price is None:
            warnings.append(
                f"{idx}권이 {pages}p 입니다. 한 권은 {v['page_min']}~{v['page_max']}p 여야 합니다."
            )
        elif multi and diaries < v["page_min"]:
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

    product_total = sum(x["price"] for x in volumes if x["price"] is not None)
    printable = bool(volumes) and all(x["price"] is not None for x in volumes)
    ship = v["shipping_fee"]

    return {
        "printable": printable,
        "totalDiaries": sum(x["diaries"] for x in volumes),
        "totalPages": sum(x["pages"] for x in volumes),
        "volumes": volumes,
        "productTotal": product_total,
        "shippingFee": ship,
        "grandTotal": product_total + ship,
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


def _plan(months, counts, total, mode, vendor):
    v = VENDORS[resolve_vendor(vendor)]
    groups = (
        _cheapest_groups(counts, vendor) if mode == "cheapest" else _balanced_groups(counts, vendor)
    )
    if groups is None:
        # 월 경계로는 나눌 수 없다 = 어떤 달 하나가 혼자 상한을 넘는다.
        # (하루에 두 편 이상 쓰면 실제로 생긴다)
        over = [m for m in months if printed_pages(m["count"], vendor) > v["page_max"]]
        if over:
            names = ", ".join(f"{m['ym']}({m['count']}편)" for m in over[:3])
            more = f" 외 {len(over) - 3}개월" if len(over) > 3 else ""
            return _not_printable(
                total,
                f"{names}{more} 은 한 달만으로 {v['page_max']}p 를 넘습니다. "
                f"월 경계로는 나눌 수 없으니 그 달을 빼고 인쇄하거나 따로 문의해 주세요.",
            )
        return _not_printable(
            total,
            f"월 단위로 나눠도 한 권이 {v['page_max']}p 를 넘습니다. 인쇄 구간을 좁혀 주세요.",
        )
    return _build(months, groups, vendor)


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
        "pages": [x["pages"] for x in plan["volumes"]],
    }


def plan_volumes(months, mode=DEFAULT_MODE, vendor=DEFAULT_VENDOR):
    """
    월별 집계로 분권 계획과 견적을 만든다.

    months: [{'ym': '2026-01', 'count': 28}, ...] — 인쇄할 구간, 날짜 오름차순.
    mode:   'cheapest'(기본) | 'balanced'
    vendor: 'ddukddak'(기본) | 'sweetbook'

    선택한 방식의 계획을 돌려주되, 두 방식의 요약을 'options' 에 함께 싣는다.
    화면이 "균등으로 하면 +5,000원" 을 한 번의 호출로 보여줄 수 있어야 하기 때문이다.
    """
    if mode not in MODES:
        mode = DEFAULT_MODE
    vendor = resolve_vendor(vendor)
    v = VENDORS[vendor]

    months = [m for m in months if m.get("count", 0) > 0]
    counts = [m["count"] for m in months]
    total = sum(counts)

    if total < v["min_diaries"]:
        out = _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {v['min_diaries']}편부터 인쇄할 수 있습니다."
        )
        out["mode"] = mode
        out["options"] = []
    else:
        plans = {m: _plan(months, counts, total, m, vendor) for m in MODES}
        out = dict(plans[mode])
        out["mode"] = mode
        out["options"] = [_summary(plans[m], m) for m in MODES]

    out["vendor"] = vendor_info(vendor)
    return out


def plan_with_splits(months, split_ends, vendor=DEFAULT_VENDOR):
    """
    사용자가 분책 경계를 직접 정했을 때의 계획.

    split_ends: 각 권의 '마지막 달' 목록(예: ['2026-06', '2026-12']).
                마지막 권의 끝은 구간의 끝으로 자동 처리한다.
    """
    vendor = resolve_vendor(vendor)
    v = VENDORS[vendor]
    months = [m for m in months if m.get("count", 0) > 0]
    total = sum(m["count"] for m in months)

    if not months:
        out = _not_printable(0, "인쇄할 일기가 없습니다.")
    elif total < v["min_diaries"]:
        out = _not_printable(
            total, f"일기가 {total}편뿐입니다. 최소 {v['min_diaries']}편부터 인쇄할 수 있습니다."
        )
    else:
        ends = set(split_ends or [])
        groups = []
        start = 0
        for i, m in enumerate(months):
            if m["ym"] in ends and i < len(months) - 1:
                groups.append((start, i))
                start = i + 1
        groups.append((start, len(months) - 1))
        out = _build(months, groups, vendor)

    out["mode"] = "manual"
    # 수동 경계여도 자동 두 안의 금액은 같이 내려준다 — 화면에서 "자동으로 되돌리기"가
    # 가능해야 하고, 직접 지정한 경계가 자동보다 비싼지도 바로 보여야 한다.
    if months and total >= v["min_diaries"]:
        counts = [m["count"] for m in months]
        out["options"] = [_summary(_plan(months, counts, total, m, vendor), m) for m in MODES]
    else:
        out["options"] = []
    out["vendor"] = vendor_info(vendor)
    return out
