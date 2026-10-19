#!/usr/bin/env python3
"""
고객 세션·주문 티켓 서명 검증.

외부 라이브러리 없이 돈다. api/print/_lib/session.py 만 import 한다.

여기서 막아야 하는 것:
  - 서명 위조 (본문만 바꿔치기)
  - username 치환 — 남의 일기를 뽑는 유일한 경로다
  - 만료 토큰 재사용
  - 세션 토큰과 주문 티켓 바꿔치기
  - 키 미설정 상태에서 조용히 통과
"""

import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

os.environ["PRINT_SESSION_SECRET"] = "test-secret-for-unit-test"
from _lib import session  # noqa: E402

FAILS = []


def check(label, cond):
    if cond:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        FAILS.append(label)


def rejects(label, fn, expect_status=None):
    try:
        fn()
    except session.SessionError as e:
        if expect_status is not None and e.status != expect_status:
            print(f"  FAIL {label} — status {e.status} (기대 {expect_status})")
            FAILS.append(label)
        else:
            print(f"  ok   {label} — 거부: {e}")
        return
    except Exception as e:  # noqa: BLE001
        print(f"  FAIL {label} — SessionError 가 아닌 {type(e).__name__}: {e}")
        FAILS.append(label)
        return
    print(f"  FAIL {label} — 통과해 버렸다")
    FAILS.append(label)


def tamper(token, **changes):
    """서명은 그대로 두고 본문만 바꾼다 — 위조 시도."""
    body, _, sig = token.rpartition(".")
    pad = "=" * (-len(body) % 4)
    data = json.loads(base64.urlsafe_b64decode(body + pad))
    data.update(changes)
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode() + "." + sig


print("세션")
s = session.make_session("md5401", "김민준", "jwt-abc")
got = session.read_session(s)
check("왕복", got == {"username": "md5401", "name": "김민준", "token": "jwt-abc"})
rejects("username 치환", lambda: session.read_session(tamper(s, u="victim")))
rejects("토큰 치환", lambda: session.read_session(tamper(s, t="stolen")))
rejects("서명 조작", lambda: session.read_session(s[:-3] + "AAA"))
rejects("빈 토큰", lambda: session.read_session(""))
rejects("형식 오류", lambda: session.read_session("not-a-token"))
rejects("None", lambda: session.read_session(None))

expired = session._encode({"k": "s", "u": "md5401", "n": "", "t": "x"}, -10)
rejects("만료", lambda: session.read_session(expired))

print("\n주문 티켓")
t = session.make_ticket("md5401", ["bk_1", "bk_2"], 61300, [{"volume": 1}])
tk = session.read_ticket(t, "md5401")
check("왕복", tk["bookUids"] == ["bk_1", "bk_2"] and tk["amount"] == 61300)
rejects("다른 계정이 사용", lambda: session.read_ticket(t, "other"), expect_status=403)
rejects("금액 조작", lambda: session.read_ticket(tamper(t, a=1000), "md5401"))
rejects("bookUid 추가", lambda: session.read_ticket(tamper(t, b=["bk_victim"]), "md5401"))
rejects("빈 bookUids", lambda: session.read_ticket(
    session.make_ticket("md5401", [], 0, []), "md5401"), expect_status=400)

print("\n종류 바꿔치기")
rejects("세션을 티켓 자리에", lambda: session.read_ticket(s, "md5401"))
rejects("티켓을 세션 자리에", lambda: session.read_session(t))

print("\n키 미설정")
saved = os.environ.pop("PRINT_SESSION_SECRET")
rejects("키 없으면 발급 거부", lambda: session.make_session("a", "b", "c"), expect_status=503)
rejects("키 없으면 검증 거부", lambda: session.read_session(s), expect_status=503)
os.environ["PRINT_SESSION_SECRET"] = saved

print("\n다른 키로 서명된 토큰")
os.environ["PRINT_SESSION_SECRET"] = "a-different-secret"
rejects("키가 바뀌면 거부", lambda: session.read_session(s))
os.environ["PRINT_SESSION_SECRET"] = saved

print()
if FAILS:
    print(f"✗ {len(FAILS)}건 실패: {', '.join(FAILS)}")
    sys.exit(1)
print("✓ 전부 통과")
