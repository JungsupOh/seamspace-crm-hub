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
        check(p >= x["diaries"], f"[{label}] {x['volume']}권 인쇄 {p}p < 일기 {x['diaries']}편")
        check(x["blanks"] == p - x["diaries"], f"[{label}] {x['volume']}권 blanks 불일치")
        check(
            x["price"] == pricing.price_for(p, vendor),
            f"[{label}] {x['volume']}권 가격이 구간과 불일치",
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

# ── 2. printed_pages — 업체별 패딩 ─────────────────
for diaries, dd, sb in [
    (36, 36, 50), (49, 49, 50), (50, 50, 50), (51, 51, 52),
    (100, 100, 100), (101, 101, 102), (200, 200, 200), (300, 300, 300),
]:
    got_dd = pricing.printed_pages(diaries, "ddukddak")
    got_sb = pricing.printed_pages(diaries, "sweetbook")
    check(got_dd == dd, f"뚝딱샵 printed_pages({diaries}) = {got_dd}, 기대 {dd}")
    check(got_sb == sb, f"스위트북 printed_pages({diaries}) = {got_sb}, 기대 {sb}")

# 뚝딱샵은 패딩이 없다 — 36편 이상이면 편수 = 페이지 수
for d in (36, 77, 123, 199, 251, 300):
    check(pricing.printed_pages(d, "ddukddak") == d, f"뚝딱샵이 {d}편을 패딩함")

# ── 3. 가격 구간 ───────────────────────────────────
for pages, expect in [(36, 26000), (100, 26000), (101, 29000), (150, 29000),
                      (151, 32000), (200, 32000), (250, 35000), (300, 38000),
                      (35, None), (301, None)]:
    got = pricing.price_for(pages, "ddukddak")
    check(got == expect, f"뚝딱샵 price_for({pages}) = {got}, 기대 {expect}")
for pages, expect in [(50, 27000), (100, 27000), (102, 32000), (150, 32000),
                      (152, 37000), (200, 37000), (48, None), (202, None)]:
    got = pricing.price_for(pages, "sweetbook")
    check(got == expect, f"스위트북 price_for({pages}) = {got}, 기대 {expect}")

# ── 4. 최소 편수 미만 ──────────────────────────────
for vendor in VENDORS:
    plan = pricing.plan_volumes(months(20, 15), vendor=vendor)
    check(not plan["printable"], f"[{vendor}] 35편인데 인쇄 가능으로 나옴")
    check("36편" in (plan.get("reason") or ""), f"[{vendor}] 최소 편수 안내가 없음")

# ── 5. 뚝딱샵 — 패딩 없음, 300p 까지 단권 ──────────
plan = pricing.plan_volumes(months(20, 20), vendor="ddukddak")  # 40편
invariants(plan, "뚝딱샵 40편", "ddukddak")
check(plan["volumes"][0]["pages"] == 40, "뚝딱샵 40편이 40p 가 아님")
check(plan["volumes"][0]["blanks"] == 0, "뚝딱샵에 빈 페이지가 생김")
check(plan["grandTotal"] == 26000 + 3500, f"뚝딱샵 40편 총액 {plan['grandTotal']:,}")

plan = pricing.plan_volumes(months(*([30] * 10)), vendor="ddukddak")  # 300편
invariants(plan, "뚝딱샵 300편", "ddukddak")
check(len(plan["volumes"]) == 1, f"뚝딱샵 300편이 {len(plan['volumes'])}권")
check(plan["grandTotal"] == 38000 + 3500, f"뚝딱샵 300편 총액 {plan['grandTotal']:,}")

plan = pricing.plan_volumes(months(*([30] * 10), 1), vendor="ddukddak")  # 301편
invariants(plan, "뚝딱샵 301편", "ddukddak")
check(len(plan["volumes"]) == 2, f"뚝딱샵 301편이 {len(plan['volumes'])}권")

# ── 6. 스위트북 — 50p 패딩 / 짝수 / 200p 상한 ──────
plan = pricing.plan_volumes(months(20, 20), vendor="sweetbook")  # 40편
invariants(plan, "스위트북 40편", "sweetbook")
check(plan["volumes"][0]["pages"] == 50, "스위트북 40편 → 50p 패딩 안 됨")
check(plan["volumes"][0]["blanks"] == 10, "스위트북 40편 빈 페이지 10장이 아님")
check(plan["grandTotal"] == 27000 + 3000, f"스위트북 40편 총액 {plan['grandTotal']:,}")

plan = pricing.plan_volumes(months(31, 30, 30, 30), vendor="sweetbook")  # 121편
invariants(plan, "스위트북 121편", "sweetbook")
check(plan["volumes"][0]["pages"] == 122, "스위트북 121편 → 122p 가 아님")

plan = pricing.plan_volumes(months(*([25] * 8)), vendor="sweetbook")  # 200편
invariants(plan, "스위트북 200편", "sweetbook")
check(len(plan["volumes"]) == 1, "스위트북 200편이 1권이 아님")

plan = pricing.plan_volumes(months(*([25] * 8), 1), vendor="sweetbook")  # 201편
invariants(plan, "스위트북 201편", "sweetbook")
check(len(plan["volumes"]) == 2, f"스위트북 201편이 {len(plan['volumes'])}권")

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
check(sb["grandTotal"] == 59000 + 3000, f"스위트북 210편 총액 {sb['grandTotal']:,}")

# ── 8. 앞에서부터 채우면 깨지는 케이스 ─────────────
plan = pricing.plan_volumes(months(*([23] * 10)), vendor="sweetbook")  # 230편
invariants(plan, "스위트북 230편", "sweetbook")
check(plan["productTotal"] == 59000, f"230편 상품가 {plan['productTotal']:,} (기대 59,000)")
check(
    sorted(x["diaries"] for x in plan["volumes"]) == [92, 138],
    f"230편 분권 {[x['diaries'] for x in plan['volumes']]} (기대 92/138)",
)

# ── 9. 수동 분책 경계 ──────────────────────────────
ms = months(*([30] * 10))  # 300편
plan = pricing.plan_with_splits(ms, ["2026-05"], "sweetbook")  # 150 / 150
invariants(plan, "수동분책", "sweetbook")
check(plan["mode"] == "manual", "수동 분책 mode 가 manual 이 아님")
check([x["diaries"] for x in plan["volumes"]] == [150, 150], "수동 분책 150/150 이 아님")
check(plan["grandTotal"] == 32000 * 2 + 3000, f"수동 분책 총액 {plan['grandTotal']:,}")
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
        over = [m for m in ms if m["count"] > pricing.VENDORS[vendor]["page_max"]]
        if over:
            check(not plan["printable"], f"random#{trial}/{vendor} 분권 불가인데 가능으로 나옴")
            check(
                over[0]["ym"] in (plan.get("reason") or ""),
                f"random#{trial}/{vendor} 초과한 달을 안내문에서 짚지 않음",
            )


# ── 11. cheapest / balanced 최적성 — 완전탐색 대조 ──
def brute_force(counts, vendor):
    n = len(counts)
    cap = pricing.VENDORS[vendor]["page_max"]
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
            if run > cap:
                break
            pr = pricing.price_for(pricing.printed_pages(run, vendor), vendor)
            if pr is None:
                continue
            rec(j + 1, acc + pr)

    rec(0, 0)
    return best[0]


def best_balanced(counts, vendor):
    """완전탐색으로 '균등' 정답 — 최소 권수 k 에서 (최대 최소화, 최소 최대화)."""
    n = len(counts)
    cap = pricing.VENDORS[vendor]["page_max"]
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
check([x["pages"] for x in cheap["volumes"]] == [138, 92],
      f"최저가 {[x['pages'] for x in cheap['volumes']]}")
check([x["pages"] for x in bal["volumes"]] == [116, 116],
      f"균등 {[x['pages'] for x in bal['volumes']]}")
check(cheap["grandTotal"] == 62000 and bal["grandTotal"] == 67000, "두 방식 총액")
for plan in (cheap, bal):
    check([o["mode"] for o in plan["options"]] == list(pricing.MODES), "options 에 두 방식이 다 없음")
check(pricing.plan_volumes(ms230, "weird", "sweetbook")["mode"] == pricing.DEFAULT_MODE,
      "잘못된 모드가 기본값으로 안 떨어짐")

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
    for lo, hi, pr in v["bands"]:
        print(f"    {lo:>3}~{hi:>3}p   {pr:,}원")
    print(f"    배송비     {v['shipping_fee']:,}원")
