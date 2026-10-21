#!/usr/bin/env python3
"""
일기 전체 조회(fetch_all) 검증.

**이 테스트가 생긴 이유.** 범위 조회가 한 달치 이하로 오면 2019년부터 월별로
다시 훑는데, 이걸 순차로 돌면 94개월 × 0.8초 ≈ 75초라 Vercel 60초 제한에 걸린다.
일기가 없거나 한 달치뿐인 계정은 **무조건** 이 경로로 오기 때문에, 신규 사용자가
첫 화면에서 바로 FUNCTION_INVOCATION_TIMEOUT 을 본다. 실제로 그렇게 터졌다.

네트워크를 타지 않는다 — _post_diary 를 가짜로 바꿔 호출 패턴만 본다.
다만 날짜 파싱이 렌더러를 거쳐서 **reportlab 이 필요하다**:

    pip install -r requirements.txt
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

from _lib import mdiary  # noqa: E402

FAILS = []


def check(label, cond, extra=""):
    if cond:
        print(f"  ok   {label}{(' — ' + extra) if extra else ''}")
    else:
        print(f"  FAIL {label}{(' — ' + extra) if extra else ''}")
        FAILS.append(label)


def entry(i, ym):
    return {"id": i, "username": "u", "name": "김", "traffic": "GREEN",
            "date": f"{ym}-{(i % 28) + 1:02d}T09:00:00.000Z"}


# ── 1. 범위 조회가 두 달 이상이면 월별 조회를 하지 않는다 ──
calls = []
def range_ok(token, payload):
    calls.append(payload)
    return [entry(1, "2026-05"), entry(2, "2026-06")]
mdiary._post_diary = range_ok
out = mdiary.fetch_all("t", "u")
check("범위 조회로 끝난다", len(calls) == 1, f"{len(calls)}회 호출")
check("결과 그대로", len(out) == 2)

# ── 2. 한 달치/빈 결과면 월별로 훑되, 동시에 던져 제한 안에 끝낸다 ──
DELAY = 0.05        # 실제 0.8초를 줄여 흉내 (비율만 보면 된다)
calls = []
lock = threading.Lock()
def sparse(token, payload):
    with lock:
        calls.append(payload)
    time.sleep(DELAY)
    if "from_date" in payload:
        return []
    if (payload["year"], payload["month"]) == (2026, 6):
        return [entry(i, "2026-06") for i in range(5)]
    return []
mdiary._post_diary = sparse

t0 = time.time()
out = mdiary.fetch_all("t", "u")
elapsed = time.time() - t0
months = len(calls) - 1
serial = months * DELAY
check("월별 전체를 훑는다", months > 80, f"{months}개월")
check("동시 실행으로 빨라진다", elapsed < serial / 3,
      f"{elapsed:.2f}초 (순차 추정 {serial:.2f}초)")
check("결과 수집", len(out) == 5)
check("날짜 오름차순", all(out[i]["date"] <= out[i + 1]["date"] for i in range(len(out) - 1)))

# 실제 지연(0.8초)로 환산했을 때 Vercel 60초 안에 드는지
projected = elapsed / DELAY * 0.8
check("실제 지연 환산 시 60초 이내", projected < 50, f"약 {projected:.0f}초")

# ── 3. 한 달이라도 실패하면 조용히 넘어가지 않는다 ──
# 건너뛰면 편수가 모자란 채로 견적이 나가고 실제 인쇄물과 어긋난다.
def flaky(token, payload):
    if "from_date" in payload:
        return []
    if payload["month"] == 7:
        raise mdiary.MDiaryError("일시적 오류")
    return []
mdiary._post_diary = flaky
try:
    mdiary.fetch_all("t", "u")
    check("실패를 올린다", False, "조용히 통과해 버렸다")
except mdiary.MDiaryError:
    check("실패를 올린다", True)

print()
if FAILS:
    print(f"✗ {len(FAILS)}건 실패: {', '.join(FAILS)}")
    sys.exit(1)
print("✓ 전부 통과")
