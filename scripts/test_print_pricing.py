"""
일기 제본 가격·분권 로직 검증.

  python3 scripts/test_print_pricing.py

인쇄물이라 "돌아간다"로는 부족하다. 특히 아래 두 가지는 틀리면 바로 돈 문제가 된다.
  - 권당 페이지 수가 판형 범위(50~200)와 짝수 규칙을 벗어나면 스위트북이 업로드를 거부한다
  - 가격 구간이 인쇄 페이지 수와 어긋나면 견적 금액과 청구 금액이 달라진다

그래서 손으로 고른 케이스 외에 월 구성을 무작위로 많이 돌려 불변식을 확인한다.

월별 페이지 수에 상한을 두지 않는다 — 하루에 두 편 이상 쓸 수 있으므로 한 달이
31편을 넘을 수 있고, 한 달이 혼자 200p 를 넘는 경우까지 돌려 본다.
"""

import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

from _lib import pricing  # noqa: E402

FAIL = []


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


def invariants(plan, label):
    """모든 계획이 지켜야 하는 것 — 판형 제약과 금액 일관성."""
    if not plan["printable"]:
        return
    for v in plan["volumes"]:
        p = v["pages"]
        check(
            pricing.SPEC_PAGE_MIN <= p <= pricing.SPEC_PAGE_MAX,
            f"[{label}] {v['volume']}권 {p}p — 판형 범위 밖",
        )
        check(p % pricing.SPEC_PAGE_INCREMENT == 0, f"[{label}] {v['volume']}권 {p}p — 짝수 아님")
        check(p >= v["diaries"], f"[{label}] {v['volume']}권 인쇄 {p}p < 일기 {v['diaries']}편")
        check(v["blanks"] == p - v["diaries"], f"[{label}] {v['volume']}권 blanks 불일치")
        check(v["price"] == pricing.price_for(p), f"[{label}] {v['volume']}권 가격이 구간과 불일치")
    check(
        plan["productTotal"] == sum(v["price"] for v in plan["volumes"]),
        f"[{label}] 상품합계 불일치",
    )
    check(
        plan["grandTotal"] == plan["productTotal"] + pricing.SHIPPING_FEE,
        f"[{label}] 총액 = 상품합계 + 배송비 아님",
    )
    check(
        plan["totalDiaries"] == sum(v["diaries"] for v in plan["volumes"]),
        f"[{label}] 일기 합계 불일치",
    )


# ── 1. printed_pages — 짝수·최소 50p 패딩 ──────────
for diaries, expect in [
    (36, 50), (49, 50), (50, 50), (51, 52), (99, 100),
    (100, 100), (101, 102), (199, 200), (200, 200),
]:
    got = pricing.printed_pages(diaries)
    check(got == expect, f"printed_pages({diaries}) = {got}, 기대 {expect}")

# ── 2. 가격 구간 ───────────────────────────────────
for pages, expect in [
    (50, 27000), (100, 27000), (102, 32000), (150, 32000),
    (152, 37000), (200, 37000), (48, None), (202, None),
]:
    got = pricing.price_for(pages)
    check(got == expect, f"price_for({pages}) = {got}, 기대 {expect}")

# ── 3. 최소 편수 미만 ──────────────────────────────
plan = pricing.plan_volumes(months(20, 15))
check(not plan["printable"], "35편인데 인쇄 가능으로 나옴")
check("36편" in (plan.get("reason") or ""), "최소 편수 안내가 없음")

# ── 4. 36~49편 — 단권 + 빈 페이지 패딩 ─────────────
plan = pricing.plan_volumes(months(20, 20))  # 40편
invariants(plan, "40편")
check(plan["printable"], "40편이 인쇄 불가로 나옴")
check(len(plan["volumes"]) == 1, "40편이 1권이 아님")
check(plan["volumes"][0]["pages"] == 50, "40편 → 50p 패딩 안 됨")
check(plan["volumes"][0]["blanks"] == 10, "40편 빈 페이지 10장이 아님")
check(plan["grandTotal"] == 27000 + 3000, "40편 총액이 30,000원이 아님")

# ── 5. 홀수 편수 — 1장 패딩 ────────────────────────
plan = pricing.plan_volumes(months(31, 30, 30, 30))  # 121편
invariants(plan, "121편")
check(plan["volumes"][0]["pages"] == 122, "121편 → 122p 가 아님")
check(plan["grandTotal"] == 32000 + 3000, "121편 총액이 35,000원이 아님")

# ── 6. 200편 경계 — 아직 1권 ───────────────────────
plan = pricing.plan_volumes(months(*([25] * 8)))  # 200편
invariants(plan, "200편")
check(len(plan["volumes"]) == 1, "200편이 1권이 아님")
check(plan["grandTotal"] == 37000 + 3000, "200편 총액이 40,000원이 아님")

# ── 7. 201편 — 2권으로, 작은 쪽도 50p 이상 ─────────
plan = pricing.plan_volumes(months(*([25] * 8), 1))  # 201편
invariants(plan, "201편")
check(len(plan["volumes"]) == 2, f"201편이 2권이 아님 ({len(plan['volumes'])}권)")

# ── 8. 앞에서부터 채우면 깨지는 케이스 ─────────────
# 230편을 앞에서부터 200/30 으로 자르면 2권째가 빈 페이지 20장을 떠안는다.
plan = pricing.plan_volumes(months(*([23] * 10)))  # 230편
invariants(plan, "230편")
check(len(plan["volumes"]) == 2, "230편이 2권이 아님")
smallest = min(v["diaries"] for v in plan["volumes"])
check(smallest >= 50, f"230편 분권에서 가장 얇은 권이 {smallest}편 (50편 미만)")
check(all(v["blanks"] == 0 for v in plan["volumes"]), "230편 분권에 빈 페이지가 생김")

# ── 9. 수동 분책 경계 ──────────────────────────────
ms = months(*([30] * 10))  # 300편, 10개월
plan = pricing.plan_with_splits(ms, ["2026-05"])  # 5월에서 끊기 → 150 / 150
invariants(plan, "수동분책")
check(len(plan["volumes"]) == 2, "수동 분책이 2권이 아님")
check([v["diaries"] for v in plan["volumes"]] == [150, 150], "수동 분책 150/150 이 아님")
check(plan["grandTotal"] == 32000 * 2 + 3000, "수동 분책 총액이 67,000원이 아님")

# 경계를 잘못 잡아 200p 를 넘기면 인쇄 불가로 잡혀야 한다
bad = pricing.plan_with_splits(ms, ["2026-08"])  # 240 / 60 → 1권이 범위 밖
check(not bad["printable"], "240편짜리 권이 인쇄 가능으로 나옴")

# ── 10. 무작위 월 구성으로 불변식 확인 ─────────────
random.seed(20261011)
for trial in range(3000):
    n_months = random.randint(1, 36)
    # 하루 2편 이상을 반영해 월별 상한을 두지 않는다 (가끔 한 달이 200p 를 넘도록)
    hot = random.random() < 0.08
    counts = [random.randint(0, 260 if hot else 70) for _ in range(n_months)]
    if sum(counts) < pricing.MIN_DIARIES:
        continue
    plan = pricing.plan_volumes(months(*counts))
    invariants(plan, f"random#{trial}")
    # 한 달이 혼자 200p 를 넘으면 월 경계로 나눌 수 없어야 하고, 그 달을 짚어 줘야 한다
    over = [m for m in months(*counts) if m["count"] > pricing.SPEC_PAGE_MAX]
    if over:
        check(not plan["printable"], f"random#{trial} counts={counts} — 분권 불가인데 가능으로 나옴")
        check(
            over[0]["ym"] in (plan.get("reason") or ""),
            f"random#{trial} — 초과한 달({over[0]['ym']})을 안내문에서 짚지 않음",
        )

# ── 11. 최저가 분할이 실제로 최적인지 — 완전탐색과 대조 ──
def brute_force(counts):
    """모든 연속 분할을 다 해보고 최소 제작비를 구한다 (작은 케이스 전용)."""
    n = len(counts)
    best = [None]

    def rec(i, acc):
        if best[0] is not None and acc >= best[0]:
            return
        if i == n:
            best[0] = acc
            return
        run = 0
        for j in range(i, n):
            run += counts[j]
            if run > pricing.SPEC_PAGE_MAX:
                break
            pr = pricing.price_for(pricing.printed_pages(run))
            if pr is None:
                continue
            rec(j + 1, acc + pr)

    rec(0, 0)
    return best[0]


random.seed(777)
checked = 0
for trial in range(400):
    counts = [random.randint(1, 80) for _ in range(random.randint(2, 14))]
    if sum(counts) < pricing.MIN_DIARIES:
        continue
    plan = pricing.plan_volumes(months(*counts))
    bf = brute_force(counts)
    checked += 1
    if bf is None:
        check(not plan["printable"], f"완전탐색은 불가인데 계획은 가능 counts={counts}")
    else:
        check(plan["printable"], f"완전탐색은 가능인데 계획은 불가 counts={counts}")
        check(
            plan["productTotal"] == bf,
            f"최적 아님 counts={counts} — DP {plan['productTotal']:,} vs 완전탐색 {bf:,}",
        )

# 230편(23×10) — 균등 115/115(64,000)이 아니라 92/138(59,000)을 골라야 한다
plan = pricing.plan_volumes(months(*([23] * 10)))
check(plan["productTotal"] == 59000, f"230편 상품가 {plan['productTotal']:,} (기대 59,000)")
check(
    sorted(v["diaries"] for v in plan["volumes"]) == [92, 138],
    f"230편 분권 {[v['diaries'] for v in plan['volumes']]} (기대 92/138)",
)

# ── 12. 월 단위 분할 실제 사례 ─────────────────────
# 7개월 × 30편 = 210p. 6+1(180/30 → 37,000+27,000=64,000) 보다
# 4+3(120/90 → 32,000+27,000=59,000) 이 싸다.
plan = pricing.plan_volumes(months(*([30] * 7)))
invariants(plan, "7개월 210편")
check(plan["productTotal"] == 59000, f"210편 상품가 {plan['productTotal']:,} (기대 59,000)")
check(
    [v["diaries"] for v in plan["volumes"]] in ([120, 90], [90, 120]),
    f"210편 분권 {[v['diaries'] for v in plan['volumes']]} (기대 120/90)",
)
check(
    [len(v["months"]) for v in plan["volumes"]] in ([4, 3], [3, 4]),
    f"210편 월 구성 {[len(v['months']) for v in plan['volumes']]} (기대 4+3)",
)

# 5개월 × 45편 = 225p → 3+2 (135/90)
plan = pricing.plan_volumes(months(*([45] * 5)))
invariants(plan, "5개월 225편")
check(
    [len(v["months"]) for v in plan["volumes"]] in ([3, 2], [2, 3]),
    f"225편 월 구성 {[len(v['months']) for v in plan['volumes']]} (기대 3+2)",
)

# ── 13. 하루 2편 이상 — 한 달이 200p 를 넘는 경우 ──
plan = pricing.plan_volumes(months(60, 240, 40))
check(not plan["printable"], "한 달 240편인데 인쇄 가능으로 나옴")
check("2026-02" in (plan.get("reason") or ""), f"초과한 달을 안내 안 함: {plan.get('reason')}")

# 한 달이 200p 이하면 하루 2편 이상이어도 정상 처리
plan = pricing.plan_volumes(months(180, 150, 90))  # 420p, 3개월
invariants(plan, "하루 2편 420p")
check(plan["printable"], "420편 3개월이 인쇄 불가로 나옴")
check(len(plan["volumes"]) == 3, f"420편이 3권이 아님 ({len(plan['volumes'])}권)")

# ── 14. 분권 방식 선택 (최저가 / 균등) ─────────────
ms230 = months(*([23] * 10))  # 230편

cheap = pricing.plan_volumes(ms230, "cheapest")
bal = pricing.plan_volumes(ms230, "balanced")
invariants(cheap, "cheapest")
invariants(bal, "balanced")

check(cheap["mode"] == "cheapest", "mode 가 cheapest 가 아님")
check(bal["mode"] == "balanced", "mode 가 balanced 가 아님")
check([v["pages"] for v in cheap["volumes"]] == [138, 92], f"최저가 {[v['pages'] for v in cheap['volumes']]}")
check([v["pages"] for v in bal["volumes"]] == [116, 116], f"균등 {[v['pages'] for v in bal['volumes']]}")
check(cheap["grandTotal"] == 62000, f"최저가 총액 {cheap['grandTotal']:,}")
check(bal["grandTotal"] == 67000, f"균등 총액 {bal['grandTotal']:,}")

def best_balanced(counts):
    """
    완전탐색으로 '균등' 의 정답을 구한다 — 최소 권수 k 로 나누되
    (가장 두꺼운 권 최소화, 그다음 가장 얇은 권 최대화).
    반환: (최대, 최소) 또는 None
    """
    n = len(counts)
    if max(counts) > pricing.SPEC_PAGE_MAX:
        return None
    # 최소 권수 (greedy)
    k, run = 1, 0
    for c in counts:
        if run + c > pricing.SPEC_PAGE_MAX:
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
            if run > pricing.SPEC_PAGE_MAX:
                break
            rec(j + 1, g + 1, max(mx, run), min(mn, run))

    rec(0, 0, 0, 10 ** 9)
    return None if best[0] is None else (best[0][0], -best[0][1])


# 균등은 (최대 최소화 → 최소 최대화) 를 정확히 달성해야 하고, 최저가보다 쌀 수 없다
random.seed(31337)
for trial in range(400):
    counts = [random.randint(1, 80) for _ in range(random.randint(2, 11))]
    if sum(counts) < pricing.MIN_DIARIES:
        continue
    ms = months(*counts)
    c = pricing.plan_volumes(ms, "cheapest")
    b = pricing.plan_volumes(ms, "balanced")
    if not (c["printable"] and b["printable"]):
        continue
    check(
        c["productTotal"] <= b["productTotal"],
        f"균등이 최저가보다 쌈 counts={counts} ({b['productTotal']:,} < {c['productTotal']:,})",
    )
    check(
        len(b["volumes"]) == len(c["volumes"]),
        f"권수가 다름 counts={counts} (균등 {len(b['volumes'])} vs 최저가 {len(c['volumes'])})",
    )
    want = best_balanced(counts)
    got = (
        max(v["diaries"] for v in b["volumes"]),
        min(v["diaries"] for v in b["volumes"]),
    )
    check(want == got, f"균등이 최적 아님 counts={counts} — {got} vs 정답 {want}")
    # 가장 두꺼운 권은 최저가 분할보다 두꺼울 수 없다 (같은 권수에서 최대를 최소화하므로)
    check(
        got[0] <= max(v["diaries"] for v in c["volumes"]),
        f"균등의 최대 권이 더 두꺼움 counts={counts}",
    )

# 두 방식 요약이 항상 함께 실려야 화면에서 한 번에 비교할 수 있다
for plan in (cheap, bal):
    check([o["mode"] for o in plan["options"]] == list(pricing.MODES), "options 에 두 방식이 다 없음")
    for o in plan["options"]:
        if o["printable"]:
            check(o["grandTotal"] == o["productTotal"] + pricing.SHIPPING_FEE, "options 총액 불일치")

# 잘못된 모드는 기본값으로
check(pricing.plan_volumes(ms230, "weird")["mode"] == pricing.DEFAULT_MODE, "잘못된 모드가 기본값으로 안 떨어짐")

# 수동 분책도 자동 두 안을 같이 내려줘야 한다 (화면에서 자동으로 되돌릴 수 있도록)
manual = pricing.plan_with_splits(months(*([30] * 10)), ["2026-04"])
invariants(manual, "manual")
check(manual["mode"] == "manual", "수동 분책 mode 가 manual 이 아님")
check(len(manual["options"]) == 2, "수동 분책에 자동 옵션이 안 실림")
check(manual["grandTotal"] == 72000, f"수동 분책 총액 {manual['grandTotal']:,} (기대 72,000)")
check(manual["options"][0]["grandTotal"] == 67000, "수동 분책의 자동 비교값이 틀림")

# ── 결과 ───────────────────────────────────────────
if FAIL:
    print(f"✗ {len(FAIL)}건 실패\n")
    for f in FAIL[:20]:
        print("  -", f)
    if len(FAIL) > 20:
        print(f"  ... 외 {len(FAIL) - 20}건")
    sys.exit(1)

print("✓ 전부 통과 (무작위 3,000케이스 포함)")
print()
print("  판형      ", pricing.SPEC_UID, f"{pricing.SPEC_PAGE_MIN}~{pricing.SPEC_PAGE_MAX}p, "
      f"{pricing.SPEC_PAGE_INCREMENT}의 배수")
print("  최소 편수 ", pricing.MIN_DIARIES, f"(→ {pricing.SPEC_PAGE_MIN}p 로 패딩)")
for lo, hi, pr in pricing.BANDS:
    print(f"  {lo:>3}~{hi:>3}p   {pr:,}원")
print(f"  배송비     {pricing.SHIPPING_FEE:,}원 (주문당 1회)")
