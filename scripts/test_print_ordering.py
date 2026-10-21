#!/usr/bin/env python3
"""
주문 저장 시 숫자 변환 검증.

**이 테스트가 생긴 이유.** 스위트북은 금액을 소수로 돌려준다(23027.0).
print_orders 의 금액 칸은 integer 라 그대로 넣으면 PostgREST 가
`invalid input syntax for type integer` (22P02) 로 거부한다.

그런데 save_order 의 실패는 삼켜진다 — 주문은 이미 스위트북에 들어갔으므로
저장이 실패했다고 주문을 되돌릴 수는 없기 때문이다. 그래서 겉으로는 주문이
성공하고 기록만 조용히 빠지고, 나중에 웹훅이 와도 "누구 주문인지" 몰라
알림톡이 안 나간다. 실제로 그렇게 한 건을 놓쳤다.

외부 라이브러리 없이 돈다.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

from _lib.ordering import _as_int, new_order_ref, require_shipping  # noqa: E402

FAILS = []


def check(label, got, want):
    if got == want:
        print(f"  ok   {label}  ({got!r})")
    else:
        print(f"  FAIL {label}  {got!r} (기대 {want!r})")
        FAILS.append(label)


print("금액 → 정수")
# 스위트북이 실제로 주는 모양
check("소수 금액", _as_int(23027.0), 23027)
check("정수 금액", _as_int(23027), 23027)
check("문자열 소수", _as_int("23027.0"), 23027)
check("반올림", _as_int(23027.6), 23028)
check("0", _as_int(0, 0), 0)

# 값이 없을 때 — vendor_cost 는 비워도 되고(None), 판매가는 0 이어야 한다
check("None → 기본값 없음", _as_int(None), None)
check("None → 기본값 0", _as_int(None, 0), 0)
check("빈 문자열", _as_int("", 0), 0)
check("숫자가 아님", _as_int("abc"), None)
check("리스트", _as_int([1]), None)

print("\n주문번호")
ref = new_order_ref()
check("형식 MD{YYMMDD}-{4자리}", len(ref) == 13 and ref.startswith("MD") and ref[8] == "-", True)
check("매번 다르다", len({new_order_ref() for _ in range(200)}) > 150, True)

print("\n배송지 필수값")
check("전부 비면 4개 다 걸린다", len(require_shipping({})), 4)
check("공백만 넣어도 걸린다", len(require_shipping(
    {"recipientName": " ", "recipientPhone": " ", "postalCode": " ", "address1": " "})), 4)
check("다 채우면 통과", require_shipping(
    {"recipientName": "홍길동", "recipientPhone": "010-0000-0000",
     "postalCode": "34141", "address1": "대전시 유성구"}), [])

print()
if FAILS:
    print(f"✗ {len(FAILS)}건 실패: {', '.join(FAILS)}")
    sys.exit(1)
print("✓ 전부 통과")
