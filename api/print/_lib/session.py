"""
고객용 서명 토큰.

**왜 필요한가.** 관리자용 엔드포인트(stats/generate)는 요청 본문의 username 으로
조회 대상을 정한다. mDiary 서버가 일반 계정의 교차 조회를 막아 주긴 하지만,
**슈퍼유저 토큰은 뚫려 있다**(개발팀 확인 2026-10). 공개 사이트에서 "토큰과 아이디를
본문으로 받는" 구조를 그대로 열면, 어쩌다 슈퍼유저 계정이 들어왔을 때 아무 학생의
일기나 뽑아볼 수 있다.

그래서 고객 흐름은 로그인 시점에 username 을 **서명해서 묶어** 두고, 이후 요청에서는
본문의 username 을 아예 보지 않는다. 클라이언트가 바꿀 수 없는 값만 쓴다.

형식:  base64url(json(payload)) + "." + base64url(hmac_sha256(key, 앞부분))

JWT 를 쓰지 않은 이유 — 라이브러리 없이 표준 라이브러리만으로 끝나고,
우리가 발급하고 우리가 읽는 용도라 알고리즘 협상(alg 혼동 공격)이 필요 없다.
alg 를 아예 두지 않으므로 그 사고 자체가 성립하지 않는다.
"""

import base64
import hashlib
import hmac
import json
import os
import time

# 고객 세션 수명. 짧으면 일기가 많은 사용자가 PDF 만드는 중에 끊기고,
# 길면 탈취됐을 때 오래 산다. 주문 한 건을 끝내기에 넉넉한 선으로 2시간.
SESSION_TTL = 2 * 60 * 60
# 책 주문 티켓. 책을 만든 직후 바로 결제하므로 더 짧아도 되지만,
# 배송지 입력·결제창에서 머무는 시간을 감안한다.
TICKET_TTL = 60 * 60


class SessionError(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status


def _key():
    secret = (os.environ.get("PRINT_SESSION_SECRET") or "").strip()
    if not secret:
        # 기본값을 만들어 주면 안 된다. 키가 없는데 조용히 동작하면
        # 서명이 아무 의미가 없어지고, 그 사실을 아무도 모른다.
        raise SessionError(
            "PRINT_SESSION_SECRET 환경변수가 없어 고객 로그인을 처리할 수 없습니다.",
            status=503,
        )
    return secret.encode()


def _b64e(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64d(text):
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(body):
    return _b64e(hmac.new(_key(), body.encode(), hashlib.sha256).digest())


def _encode(payload, ttl):
    data = dict(payload)
    data["exp"] = int(time.time()) + ttl
    body = _b64e(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())
    return f"{body}.{_sign(body)}"


def _decode(token, kind):
    if not token or not isinstance(token, str) or "." not in token:
        raise SessionError("로그인이 필요합니다.")
    body, _, sig = token.rpartition(".")
    # compare_digest — 앞자리부터 틀린 서명이 더 빨리 거부되면 서명을 한 글자씩
    # 맞춰 볼 수 있다. 길이가 달라도 같은 시간이 걸리게 둔다.
    if not hmac.compare_digest(_sign(body), sig):
        raise SessionError("로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.")
    try:
        data = json.loads(_b64d(body))
    except (ValueError, TypeError):
        raise SessionError("로그인 정보를 읽지 못했습니다. 다시 로그인해 주세요.")
    if data.get("k") != kind:
        # 세션 토큰을 주문 티켓 자리에 넣는 식의 바꿔치기를 막는다
        raise SessionError("로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.")
    if int(data.get("exp") or 0) < time.time():
        raise SessionError("로그인이 만료되었습니다. 다시 로그인해 주세요.")
    return data


# ── 로그인 세션 ──────────────────────────────────────
def make_session(username, name, mdiary_token):
    return _encode({"k": "s", "u": username, "n": name or "", "t": mdiary_token}, SESSION_TTL)


def read_session(token):
    d = _decode(token, "s")
    username = (d.get("u") or "").strip()
    mdiary_token = d.get("t")
    if not username or not mdiary_token:
        raise SessionError("로그인 정보가 비어 있습니다. 다시 로그인해 주세요.")
    return {"username": username, "name": d.get("n") or "", "token": mdiary_token}


# ── 주문 티켓 ────────────────────────────────────────
def make_ticket(username, book_uids, amount, volumes):
    """
    만들어 둔 책을 주문할 수 있는 권한.

    bookUid 만으로 주문을 받으면, 남이 준비한 책 번호를 알아낸 사람이 그걸로
    주문을 넣을 수 있다. 금액도 함께 묶어 두어야 클라이언트가 결제액을 깎지 못한다.
    """
    return _encode(
        {"k": "b", "u": username, "b": list(book_uids), "a": int(amount), "v": volumes},
        TICKET_TTL,
    )


def read_ticket(token, username):
    d = _decode(token, "b")
    if (d.get("u") or "") != username:
        raise SessionError("다른 계정에서 만든 주문입니다. 처음부터 다시 진행해 주세요.", status=403)
    uids = [u for u in (d.get("b") or []) if u]
    if not uids:
        raise SessionError("주문할 책이 없습니다. PDF 를 먼저 만들어 주세요.", status=400)
    return {"bookUids": uids, "amount": int(d.get("a") or 0), "volumes": d.get("v") or []}
