"""
일기 제본 가격·분권 로직 검증.

  python3 scripts/test_print_pricing.py

인쇄물이라 "돌아간다"로는 부족하다. 특히 아래 두 가지는 틀리면 바로 돈 문제가 된다.
  - 권당 페이지 수가 업체의 페이지 규칙을 벗어나면 제작이 거부된다
  - 가격 구간이 인쇄 페이지 수와 어긋나면 견적 금액과 청구 금액이 달라진다

업체(뚝딱샵 / 스위트북)마다 페이지 규칙과 단가가 다르므로 불변식은 **두 업체 모두**
돌린다. 월별 페이지 수에 상한을 두지 않는다 — 하루에 두 편 이상 쓸 수 있으므로 한 달이
31편을 넘을 수 있고, 한 달이 혼자 상한을 넘는 경우까지 돌려 본다.
"""

import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

from _lib import pricing  # noqa: E402

FAIL = []
VENDORS = list(pricing.VENDORS)


def check(cond, msg):
    if not cond:
        FAIL.append(msg)


def months(*counts, start_year=2026, start_month=1):
    """[28, 31, ...] → [{'ym': '2026-01', 'count': 28}, ...]"""
    out = []
    y, m = start_year, start_month
    for c in counts:
        out.append({"ym": f"{y:04d}-{m:02d}", "count": c})
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def invariants(plan, label, vendor):
    """모든 계획이 지켜야 하는 것 — 업체 규칙과 금액 일관성."""
    v = pricing.VENDORS[vendor]
    check(plan["vendor"]["vendor"] == vendor, f"[{label}] 응답의 업체가 {plan['vendor']['vendor']}")
    if not plan["printable"]:
        return
    for x in plan["volumes"]:
        p = x["pages"]
        check(v["page_min"] <= p <= v["page_max"], f"[{label}] {x['volume']}권 {p}p — 범위 밖")
        check(p % v["page_increment"] == 0, f"[{label}] {x['volume']}권 {p}p — 증가단위 위반")
        front = v.get("front_pages", 0)
        check(p >= x["diaries"] + front,
              f"[{label}] {x['volume']}권 인쇄 {p}p < 일기 {x['diaries']}편 + 간지 {front}장")
        check(x["blanks"] == p - x["diaries"] - front,
              f"[{label}] {x['volume']}권 blanks 불일치 (간지 제외분)")
        check(
            x["price"] == pricing.price_for(p, vendor, first=(x["volume"] == 1)),
            f"[{label}] {x['volume']}권 가격이 가격표와 불일치",
        )
    check(
        plan["productTotal"] == sum(x["price"] for x in plan["volumes"]),
        f"[{label}] 상품합계 불일치",
    )
    check(
        plan["grandTotal"] == plan["productTotal"] + v["shipping_fee"],
        f"[{label}] 총액 = 상품합계 + 배송비 아님",
    )
    check(
        plan["totalDiaries"] == sum(x["diaries"] for x in plan["volumes"]),
        f"[{label}] 일기 합계 불일치",
    )


# ── 1. 업체 프로파일 ───────────────────────────────
check(pricing.DEFAULT_VENDOR == "ddukddak", f"기본 업체가 {pricing.DEFAULT_VENDOR}")
check(set(VENDORS) == {"ddukddak", "sweetbook"}, f"업체 목록 {VENDORS}")
check(pricing.resolve_vendor("없는업체") == "ddukddak", "모르는 업체가 기본값으로 안 떨어짐")
check(pricing.shipping_fee("ddukddak") == 3500, "뚝딱샵 배송비")
check(pricing.shipping_fee("sweetbook") == 3000, "스위트북 배송비")
check(pricing.vendor_info("sweetbook")["spec"] == "PHOTOBOOK_A5_SC", "스위트북 판형 코드")
check(pricing.vendor_info("ddukddak")["spec"] is None, "뚝딱샵에 판형 코드가 붙음")
check(len(pricing.vendor_list()) == 2, "업체 목록 길이")

# ── 2. printed_pages — 맨 앞 간지 1장(2면) + 뒤쪽 패딩 ─────────────────
# 간지는 종이 한 장이라 2페이지다. 일기보다 먼저 인쇄되고 가격에도 포함된다.
for vendor in VENDORS:
    check(pricing.front_pages(vendor) == 2, f"[{vendor}] 간지가 2페이지가 아님")
    check(pricing.natural_min(vendor)
          == pricing.VENDORS[vendor]["page_min"] - 2, f"[{vendor}] 자연 최소 편수")

for diaries, dd, sb in [
    (34, 36, 50), (40, 42, 50), (47, 49, 50), (48, 50, 50),
    (49, 51, 52), (100, 102, 102), (101, 103, 104), (198, 200, 200), (298, 300, None),
]:
    got_dd = pricing.printed_pages(diaries, "ddukddak")
    check(got_dd == dd, f"뚝딱샵 printed_pages({diaries}) = {got_dd}, 기대 {dd}")
    if sb is not None:
        got_sb = pricing.printed_pages(diaries, "sweetbook")
        check(got_sb == sb, f"스위트북 printed_pages({diaries}) = {got_sb}, 기대 {sb}")

# 뚝딱샵은 증가 단위가 1이라 최소 위로는 간지 2면만 더해진다
for d in (34, 77, 123, 199, 251, 298):
    check(pricing.printed_pages(d, "ddukddak") == d + 2, f"뚝딱샵 {d}편 → {d+2}p 가 아님")

# pad=False 면 최소에 못 미쳐도 채우지 않는다
check(pricing.printed_pages(30, "sweetbook", pad=False) == 32, "pad=False 인데 채움")
check(pricing.pad_pages(30, "sweetbook") == 18, "30편에 덧댈 백지가 18p 가 아님")
check(pricing.pad_pages(48, "sweetbook") == 0, "48편에 백지가 필요하다고 나옴")

# 권당 편수 상한 — page_max 에서 간지 2면이 자리를 먹는다
check(pricing.max_diaries("ddukddak") == 298, "뚝딱샵 편수 상한")
check(pricing.max_diaries("sweetbook") == 198, "스위트북 편수 상한")
for vendor in VENDORS:
    cap = pricing.max_diaries(vendor)
    check(pricing.printed_pages(cap, vendor) <= pricing.VENDORS[vendor]["page_max"],
          f"[{vendor}] 편수 상한만큼 담으면 페이지 상한을 넘음")

# ── 3. 가격 구간 ───────────────────────────────────
for pages, expect in [(36, 26000), (100, 26000), (101, 29000), (150, 29000),
                      (151, 32000), (200, 32000), (250, 35000), (300, 38000),
                      (35, None), (301, None)]:
    got = pricing.price_for(pages, "ddukddak")
    check(got == expect, f"뚝딱샵 price_for({pages}) = {got}, 기대 {expect}")
# 스위트북 — 기본료 + 10p 블록. 1권째와 2권째 기본료가 다르다.
for pages, first, extra in [(50, 22000, 14300), (60, 23100, 15400), (100, 27500, 19800),
                            (150, 33000, 25300), (200, 38500, 30800)]:
    g1 = pricing.price_for(pages, "sweetbook", True)
    g2 = pricing.price_for(pages, "sweetbook", False)
    check(g1 == first, f"스위트북 1권째 price_for({pages}) = {g1}, 기대 {first}")
    check(g2 == extra, f"스위트북 2권째 price_for({pages}) = {g2}, 기대 {extra}")
for pages in (48, 202, 0):
    for f in (True, False):
        check(pricing.price_for(pages, "sweetbook", f) is None,
              f"스위트북 범위 밖 {pages}p 가 None 이 아님")

# 10p 단위로 올림한다 — 51~60p 는 전부 60p 값
for p in range(52, 61, 2):
    check(pricing.price_for(p, "sweetbook", True) == 23100, f"{p}p 가 23,100 이 아님")
check(pricing.price_for(50, "sweetbook", True) == 22000, "50p 만 22,000 이어야 한다")

# 공급가가 전 구간 천 단위인지 — 부동소수 아닌 정수로 검사
for p in range(50, 201, 2):
    for f, base in ((True, 20000), (False, 13000)):
        import math as _m
        supply = base + _m.ceil((p - 50) / 10) * 1000
        check(supply % 1000 == 0, f"{p}p(first={f}) 공급가 {supply} 가 천 단위 아님")
        check(pricing.price_for(p, "sweetbook", f) == supply * 11 // 10,
              f"{p}p(first={f}) VAT 계산 불일치")

# 마진 — 스위트북 원가(공급가 11,900 + 페이지당 100)와 대조.
# 10페이지 블록으로 올림하므로 경계(50,60,70…)에서는 정확히 8,910/1,210 이고,
# 그 사이는 못 쓴 페이지만큼(최대 8p × 110원) 더 붙는다. 손해 보는 쪽은 없어야 한다.
for p in range(50, 201, 2):
    cost = (11900 + (p - 50) * 100) * 11 // 10
    m1 = pricing.price_for(p, "sweetbook", True) - cost
    m2 = pricing.price_for(p, "sweetbook", False) - cost
    if (p - 50) % 10 == 0:
        check(m1 == 8910, f"{p}p 1권째 마진 {m1:,} (블록 경계라 8,910 이어야)")
        check(m2 == 1210, f"{p}p 2권째 마진 {m2:,} (블록 경계라 1,210 이어야)")
    else:
        check(8910 < m1 <= 8910 + 880, f"{p}p 1권째 마진 {m1:,} 가 범위 밖")
        check(1210 < m2 <= 1210 + 880, f"{p}p 2권째 마진 {m2:,} 가 범위 밖")
    check(m2 > 0, f"{p}p 2권째가 역마진 ({m2:,})")

# ── 4. 최소 편수 미만 — 백지로 채울지는 사용자가 고른다 ────────────
for vendor in VENDORS:
    least = pricing.natural_min(vendor)
    short = least - 1
    ms = months(short // 2, short - short // 2)

    plan = pricing.plan_volumes(ms, vendor=vendor)          # 기본: 채우지 않는다
    check(not plan["printable"], f"[{vendor}] {short}편인데 그냥 인쇄 가능으로 나옴")
    check(plan["needsPadding"], f"[{vendor}] needsPadding 이 안 섬")
    check(plan["padPages"] == pricing.pad_pages(short, vendor),
          f"[{vendor}] 덧댈 백지 수 불일치")
    check(plan["padSheets"] == (plan["padPages"] + 1) // 2,
          f"[{vendor}] 백지 장수(2면=1장) 환산이 틀림")

    padded = pricing.plan_volumes(ms, vendor=vendor, allow_padding=True)
    check(padded["printable"], f"[{vendor}] 채우기로 했는데도 인쇄 불가")
    invariants(padded, f"{vendor} {short}편 패딩", vendor)
    check(padded["volumes"][0]["pages"] == pricing.VENDORS[vendor]["page_min"],
          f"[{vendor}] 패딩 후 최소 페이지가 아님")
    check(padded["volumes"][0]["blanks"] == plan["padPages"],
          f"[{vendor}] 실제 백지 수가 안내와 다름")

# 일기가 아예 없으면 패딩 제안도 하지 않는다
empty = pricing.plan_volumes([], vendor="sweetbook")
check(not empty["printable"] and not empty["needsPadding"], "0편인데 패딩을 제안함")

# 자연 최소를 넘으면 패딩 질문 없이 바로 인쇄 가능
for vendor in VENDORS:
    ok = pricing.plan_volumes(months(pricing.natural_min(vendor)), vendor=vendor)
    check(ok["printable"], f"[{vendor}] 자연 최소 편수인데 인쇄 불가")
    check(not ok["needsPadding"], f"[{vendor}] 자연 최소인데 패딩을 요구함")

# ── 5. 뚝딱샵 — 백지 패딩 없음(간지 2면만), 298편까지 단권 ──────────
plan = pricing.plan_volumes(months(20, 20), vendor="ddukddak")  # 40편
invariants(plan, "뚝딱샵 40편", "ddukddak")
check(plan["volumes"][0]["pages"] == 42, "뚝딱샵 40편이 42p(간지 포함)가 아님")
check(plan["volumes"][0]["blanks"] == 0, "뚝딱샵에 백지가 생김")
check(plan["grandTotal"] == 26000 + 3500, f"뚝딱샵 40편 총액 {plan['grandTotal']:,}")

# 298편 = 300p — 간지까지 넣어 상한에 딱 맞는 최대치
plan = pricing.plan_volumes(months(*([30] * 9), 28), vendor="ddukddak")  # 298편
invariants(plan, "뚝딱샵 298편", "ddukddak")
check(len(plan["volumes"]) == 1, f"뚝딱샵 298편이 {len(plan['volumes'])}권")
check(plan["volumes"][0]["pages"] == 300, "뚝딱샵 298편이 300p 가 아님")
check(plan["grandTotal"] == 38000 + 3500, f"뚝딱샵 298편 총액 {plan['grandTotal']:,}")

plan = pricing.plan_volumes(months(*([30] * 10)), vendor="ddukddak")  # 300편 → 302p 라 분권
invariants(plan, "뚝딱샵 300편", "ddukddak")
check(len(plan["volumes"]) == 2, f"뚝딱샵 300편이 {len(plan['volumes'])}권")

# ── 6. 스위트북 — 50p 하한 / 짝수 / 200p 상한 ──────
# 간지(2면)는 항상 들어가고, blanks 는 뒤에 덧댄 '백지' 수만 센다.
plan = pricing.plan_volumes(months(20, 20), vendor="sweetbook", allow_padding=True)  # 40편
invariants(plan, "스위트북 40편", "sweetbook")
check(plan["volumes"][0]["pages"] == 50, "스위트북 40편 → 50p 패딩 안 됨")
check(plan["volumes"][0]["blanks"] == 8, f"스위트북 40편 백지 {plan['volumes'][0]['blanks']}p (8 이어야)")
check(plan["grandTotal"] == 22000 + 3000, f"스위트북 40편 총액 {plan['grandTotal']:,}")

plan = pricing.plan_volumes(months(24, 24), vendor="sweetbook")  # 48편 — 자연 최소
invariants(plan, "스위트북 48편", "sweetbook")
check(plan["volumes"][0]["pages"] == 50, "스위트북 48편 → 50p 가 아님")
check(plan["volumes"][0]["blanks"] == 0, "스위트북 48편에 백지가 들어감(간지만 있어야)")

plan = pricing.plan_volumes(months(25, 25), vendor="sweetbook")  # 50편
invariants(plan, "스위트북 50편", "sweetbook")
check(plan["volumes"][0]["pages"] == 52, "스위트북 50편 → 52p(간지2+50)가 아님")
check(plan["volumes"][0]["blanks"] == 0, "스위트북 50편에 백지가 들어감")

plan = pricing.plan_volumes(months(26, 25), vendor="sweetbook")  # 51편 — 홀수
invariants(plan, "스위트북 51편", "sweetbook")
check(plan["volumes"][0]["pages"] == 54, "스위트북 51편 → 54p(간지2+51+백지1)가 아님")
check(plan["volumes"][0]["blanks"] == 1, "스위트북 51편 백지 1p 가 아님")

plan = pricing.plan_volumes(months(31, 30, 30, 30), vendor="sweetbook")  # 121편
invariants(plan, "스위트북 121편", "sweetbook")
check(plan["volumes"][0]["pages"] == 124, "스위트북 121편 → 124p(간지 2 + 121 + 백지 1)가 아님")

# 198편 = 200p — 간지까지 넣어 상한에 딱 맞는 최대치
plan = pricing.plan_volumes(months(*([25] * 7), 23), vendor="sweetbook")  # 198편
invariants(plan, "스위트북 198편", "sweetbook")
check(len(plan["volumes"]) == 1, "스위트북 198편이 1권이 아님")
check(plan["volumes"][0]["pages"] == 200, "스위트북 198편이 200p 가 아님")

plan = pricing.plan_volumes(months(*([25] * 8)), vendor="sweetbook")  # 200편 → 202p 라 분권
invariants(plan, "스위트북 200편", "sweetbook")
check(len(plan["volumes"]) == 2, f"스위트북 200편이 {len(plan['volumes'])}권")

# ── 7. 같은 입력, 업체별로 다른 결과 ───────────────
ms = months(*([30] * 7))  # 210편
dd = pricing.plan_volumes(ms, vendor="ddukddak")
sb = pricing.plan_volumes(ms, vendor="sweetbook")
invariants(dd, "210편 뚝딱샵", "ddukddak")
invariants(sb, "210편 스위트북", "sweetbook")
check(len(dd["volumes"]) == 1, f"뚝딱샵 210편이 {len(dd['volumes'])}권 (300p 상한이라 1권)")
check(dd["grandTotal"] == 35000 + 3500, f"뚝딱샵 210편 총액 {dd['grandTotal']:,}")
check(len(sb["volumes"]) == 2, f"스위트북 210편이 {len(sb['volumes'])}권 (200p 상한이라 2권)")
check(
    [len(x["months"]) for x in sb["volumes"]] in ([4, 3], [3, 4]),
    f"스위트북 210편 월 구성 {[len(x['months']) for x in sb['volumes']]} (기대 4+3)",
)
# 권마다 간지 1장이 더 붙어 블록 경계를 넘을 수 있다 — 공식대로 다시 계산해 대조한다
_exp = sum(pricing.price_for(x["pages"], "sweetbook", first=(x["volume"] == 1))
           for x in sb["volumes"]) + 3000
check(sb["grandTotal"] == _exp, f"스위트북 210편 총액 {sb['grandTotal']:,} (기대 {_exp:,})")

# ── 8. 앞에서부터 채우면 깨지는 케이스 ─────────────
plan = pricing.plan_volumes(months(*([23] * 10)), vendor="sweetbook")  # 230편
invariants(plan, "스위트북 230편", "sweetbook")
# 선형 가격이라 구간 절벽이 없다 — 동점이면 권수 적은 쪽 → 두꺼운 권이 얇은 쪽
check(len(plan["volumes"]) == 2, f"230편이 {len(plan['volumes'])}권")
check(plan["volumes"][0]["price"] > plan["volumes"][1]["price"],
      "1권째가 2권째보다 비싸야 한다(기본료 차이)")

# ── 9. 수동 분책 경계 ──────────────────────────────
ms = months(*([30] * 10))  # 300편
plan = pricing.plan_with_splits(ms, ["2026-05"], "sweetbook")  # 150 / 150
invariants(plan, "수동분책", "sweetbook")
check(plan["mode"] == "manual", "수동 분책 mode 가 manual 이 아님")
check([x["diaries"] for x in plan["volumes"]] == [150, 150], "수동 분책 150/150 이 아님")
check([x["pages"] for x in plan["volumes"]] == [152, 152], "수동 분책 152/152p(간지 포함)가 아님")
check(plan["grandTotal"] == 34100 + 26400 + 3000, f"수동 분책 총액 {plan['grandTotal']:,}")
check(len(plan["options"]) == 2, "수동 분책에 자동 옵션이 안 실림")

bad = pricing.plan_with_splits(ms, ["2026-08"], "sweetbook")  # 240 / 60 → 범위 밖
check(not bad["printable"], "240편짜리 권이 인쇄 가능으로 나옴")
# 같은 경계라도 뚝딱샵은 300p 까지 되므로 통과한다
ok = pricing.plan_with_splits(ms, ["2026-08"], "ddukddak")
invariants(ok, "뚝딱샵 수동분책", "ddukddak")
check(ok["printable"], "뚝딱샵 240/60 이 인쇄 불가로 나옴")

# ── 10. 무작위 — 두 업체 모두 불변식 ───────────────
random.seed(20261011)
for trial in range(1500):
    n_months = random.randint(1, 36)
    hot = random.random() < 0.08   # 가끔 한 달이 상한을 넘도록
    counts = [random.randint(0, 340 if hot else 70) for _ in range(n_months)]
    ms = months(*counts)
    for vendor in VENDORS:
        if sum(counts) < pricing.VENDORS[vendor]["min_diaries"]:
            continue
        plan = pricing.plan_volumes(ms, vendor=vendor)
        invariants(plan, f"random#{trial}/{vendor}", vendor)
        over = [m for m in ms if m["count"] > pricing.max_diaries(vendor)]
        if over:
            check(not plan["printable"], f"random#{trial}/{vendor} 분권 불가인데 가능으로 나옴")
            check(
                over[0]["ym"] in (plan.get("reason") or ""),
                f"random#{trial}/{vendor} 초과한 달을 안내문에서 짚지 않음",
            )


# ── 11. cheapest / balanced 최적성 — 완전탐색 대조 ──
def brute_force(counts, vendor):
    n = len(counts)
    cap = pricing.max_diaries(vendor)      # 페이지가 아니라 편수 상한
    best = [None]

    def rec(i, acc, first):
        if best[0] is not None and acc >= best[0]:
            return
        if i == n:
            best[0] = acc
            return
        run = 0
        for j in range(i, n):
            run += counts[j]
            if run > cap:
                break
            # 1권째만 기본료가 비싼 모델이 있다 — 완전탐색도 같은 기준으로 매긴다
            pr = pricing.price_for(pricing.printed_pages(run, vendor), vendor, first=first)
            if pr is None:
                continue
            rec(j + 1, acc + pr, False)

    rec(0, 0, True)
    return best[0]


def best_balanced(counts, vendor):
    """완전탐색으로 '균등' 정답 — 최소 권수 k 에서 (최대 최소화, 최소 최대화)."""
    n = len(counts)
    cap = pricing.max_diaries(vendor)      # 페이지가 아니라 편수 상한
    if max(counts) > cap:
        return None
    k, run = 1, 0
    for c in counts:
        if run + c > cap:
            k += 1
            run = c
        else:
            run += c

    best = [None]

    def rec(i, g, mx, mn):
        if best[0] is not None and (mx, -mn) >= best[0]:
            return
        if i == n:
            if g == k:
                best[0] = (mx, -mn)
            return
        if g >= k:
            return
        run = 0
        for j in range(i, n):
            run += counts[j]
            if run > cap:
                break
            rec(j + 1, g + 1, max(mx, run), min(mn, run))

    rec(0, 0, 0, 10 ** 9)
    return None if best[0] is None else (best[0][0], -best[0][1])


random.seed(777)
for trial in range(300):
    counts = [random.randint(1, 80) for _ in range(random.randint(2, 11))]
    ms = months(*counts)
    for vendor in VENDORS:
        if sum(counts) < pricing.VENDORS[vendor]["min_diaries"]:
            continue
        c = pricing.plan_volumes(ms, "cheapest", vendor)
        b = pricing.plan_volumes(ms, "balanced", vendor)
        bf = brute_force(counts, vendor)
        if bf is None:
            check(not c["printable"], f"[{vendor}] 완전탐색 불가인데 가능 counts={counts}")
            continue
        check(c["printable"], f"[{vendor}] 완전탐색 가능인데 불가 counts={counts}")
        check(
            c["productTotal"] == bf,
            f"[{vendor}] 최저가 아님 counts={counts} — {c['productTotal']:,} vs {bf:,}",
        )
        if not b["printable"]:
            continue
        check(
            c["productTotal"] <= b["productTotal"],
            f"[{vendor}] 균등이 최저가보다 쌈 counts={counts}",
        )
        check(
            len(b["volumes"]) == len(c["volumes"]),
            f"[{vendor}] 권수가 다름 counts={counts}",
        )
        want = best_balanced(counts, vendor)
        got = (
            max(x["diaries"] for x in b["volumes"]),
            min(x["diaries"] for x in b["volumes"]),
        )
        check(want == got, f"[{vendor}] 균등이 최적 아님 counts={counts} — {got} vs 정답 {want}")

# ── 12. 분권 방식 선택 + options ───────────────────
ms230 = months(*([23] * 10))
cheap = pricing.plan_volumes(ms230, "cheapest", "sweetbook")
bal = pricing.plan_volumes(ms230, "balanced", "sweetbook")
check(cheap["mode"] == "cheapest" and bal["mode"] == "balanced", "mode 가 응답에 안 실림")
check(len(cheap["volumes"]) == 2 and len(bal["volumes"]) == 2, "230편이 2권이 아님")
check(cheap["grandTotal"] <= bal["grandTotal"], "최저가가 균등보다 비쌈")
for plan in (cheap, bal):
    check([o["mode"] for o in plan["options"]] == list(pricing.MODES), "options 에 두 방식이 다 없음")
check(pricing.plan_volumes(ms230, "weird", "sweetbook")["mode"] == pricing.DEFAULT_MODE,
      "잘못된 모드가 기본값으로 안 떨어짐")

# ── 13. 업체별 판형 ────────────────────────────────
# 두 업체 모두 A5. 뚝딱샵은 AI출판>셀프디자인(13889)에 A5 가 있다.
for v in VENDORS:
    check(pricing.trim_size(v) == (148.0, 210.0), f"[{v}] 재단 {pricing.trim_size(v)}")
    check(pricing.page_size(v) == (154.0, 216.0), f"[{v}] 캔버스 {pricing.page_size(v)}")
# 캔버스는 재단 + 도련 3mm 양쪽
for v in VENDORS:
    w, h = pricing.trim_size(v)
    check(pricing.page_size(v) == (w + 6, h + 6), f"[{v}] 도련 계산")
for v in VENDORS:
    info = pricing.vendor_info(v)
    check(info["trimWidthMm"] == pricing.trim_size(v)[0], f"[{v}] vendor_info 재단 가로 불일치")
    check(info["trimHeightMm"] == pricing.trim_size(v)[1], f"[{v}] vendor_info 재단 세로 불일치")
    check(bool(info["trimLabel"]), f"[{v}] trimLabel 비어 있음")

# ── 14. 1권으로 가능하면 절대 분권되지 않는다 ──────
# 기본료가 권마다 붙으므로 분권은 항상 더 비싸다. DP 가 이걸 알아서 피해야 한다.
# 간지 1장이 자리를 먹으므로 1권으로 담기는 최대 편수는 199편이다.
for total in range(50, pricing.max_diaries("sweetbook") + 1, 2):
    n = total // 4
    counts = [n, n, n, total - 3 * n]
    plan = pricing.plan_volumes(months(*counts), vendor="sweetbook")
    if not plan["printable"]:
        continue
    check(len(plan["volumes"]) == 1,
          f"{total}편(1권 가능)인데 {len(plan['volumes'])}권으로 쪼갬")
    for mode in pricing.MODES:
        p2 = pricing.plan_volumes(months(*counts), mode, "sweetbook")
        check(len(p2["volumes"]) == 1, f"{total}편 {mode} 가 쪼갬")

# 분권되면 1권째만 기본료가 비싸다
plan = pricing.plan_volumes(months(*([50] * 6)), vendor="sweetbook")  # 300편
invariants(plan, "스위트북 300편", "sweetbook")
check(len(plan["volumes"]) == 2, f"300편이 {len(plan['volumes'])}권")
check([x["pages"] for x in plan["volumes"]] == [152, 152], "300편이 152/152p(간지 포함)가 아님")
check([x["price"] for x in plan["volumes"]] == [34100, 26400],
      f"300편 권별 가격 {[x['price'] for x in plan['volumes']]} (기대 34,100/26,400)")
check(plan["grandTotal"] == 63500, f"300편 총액 {plan['grandTotal']:,} (기대 63,500)")

# ── 결과 ───────────────────────────────────────────
if FAIL:
    print(f"✗ {len(FAIL)}건 실패\n")
    for f in FAIL[:20]:
        print("  -", f)
    if len(FAIL) > 20:
        print(f"  ... 외 {len(FAIL) - 20}건")
    sys.exit(1)

print("✓ 전부 통과 (업체 2종 × 무작위 1,500케이스 + 완전탐색 대조)")
for key in VENDORS:
    v = pricing.VENDORS[key]
    mark = " (기본)" if key == pricing.DEFAULT_VENDOR else ""
    inc = f", {v['page_increment']}의 배수" if v["page_increment"] > 1 else ""
    print(f"\n  {v['label']}{mark}  {v['page_min']}~{v['page_max']}p{inc}")
    if v["pricing"] == "bands":
        for lo, hi, pr in v["bands"]:
            print(f"    {lo:>3}~{hi:>3}p   {pr:,}원")
    else:
        info = pricing.vendor_info(key)
        print(f"    1권째     {info['basePrice']:,}원 + {info['blockPages']}p당 "
              f"{info['blockPrice']:,}원")
        print(f"    2권째~    {info['extraBasePrice']:,}원 + 동일")
        for p in (50, 100, 150, 200):
            print(f"      {p:>3}p   {pricing.price_for(p, key, True):>7,}  "
                  f"(2권째 {pricing.price_for(p, key, False):,})")
    print(f"    배송비     {v['shipping_fee']:,}원")
