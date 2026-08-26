"""
마음일기(diaryapi.seamspace.me) API 클라이언트.

reportsD.py 는 하드코딩된 Bearer 토큰을 썼는데(이미 만료됐다), 여기서는
관리자가 입력한 계정으로 매번 로그인해 토큰을 받는다. 토큰도 비밀번호도 저장하지 않는다.
"""

import os
import re
import calendar
from datetime import datetime

import requests

BASE_URL = os.environ.get("MDIARY_BASE_URL", "https://diaryapi.seamspace.me").rstrip("/")
TIMEOUT = 30


class MDiaryError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def login(username, password):
    """
    계정으로 로그인해 액세스 토큰(JWT)을 받는다.

    주의: 토큰은 응답 본문이 아니라 set-cookie 의 ss_access_token 으로 온다.
    운영 서버의 로그인 응답 본문에는 token 필드가 아예 없다
    (Postman 문서에는 "token": "aaaaa" 로 적혀 있지만 현재 서버와 다르다).
    실제 응답 본문 키: detail, username, name, role, current_group,
    is_apply_coupon, server_status.

    CRM 의 create-coupon Edge Function 도 같은 방식으로 쿠키에서 꺼내 쓴다.
    """
    try:
        res = requests.post(
            f"{BASE_URL}/mDiary_app/login/",
            data={"username": username, "password": password},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise MDiaryError(f"일기 서버에 연결하지 못했습니다: {e}")

    if res.status_code != 200:
        # 어디서 막혔는지 알 수 있게 상태코드와 응답 앞부분을 같이 보여준다.
        # (아이디/비번 오류인지, 서버가 막은 건지, WAF 인지 구분이 안 되면 디버깅이 불가능하다)
        detail = (res.text or "").strip().replace("\n", " ")[:120]
        raise MDiaryError(
            f"로그인 거부됨 (HTTP {res.status_code}) — {detail or '응답 본문 없음'}",
            status=401,
        )

    token = res.cookies.get("ss_access_token")
    if not token:
        m = re.search(r"ss_access_token=([^;]+)", res.headers.get("set-cookie", ""))
        if m:
            token = m.group(1)
    if not token:
        # 예전 형식(본문에 token) 서버를 만나면 이쪽으로 떨어진다.
        try:
            token = (res.json() or {}).get("token")
        except ValueError:
            token = None
    if not token:
        cookies = ", ".join(res.cookies.keys()) or "없음"
        try:
            keys = ", ".join((res.json() or {}).keys())
        except ValueError:
            keys = "(JSON 아님)"
        raise MDiaryError(
            f"로그인은 됐지만 액세스 토큰을 받지 못했습니다. "
            f"쿠키=[{cookies}] 본문키=[{keys}]",
            status=401,
        )

    data = {}
    try:
        data = res.json() or {}
    except ValueError:
        pass

    return {
        "token": token,
        "username": data.get("username") or username,
        "name": data.get("name") or "",
    }


def is_admin(username):
    """
    관리자 허용목록 확인.

    /mDiary_app/diary/ 는 대상 사용자를 JWT 주체가 아니라 요청 본문의 username 으로
    정한다. 즉 일반 일기 사용자 토큰으로도 남의 일기를 읽을 수 있는지가 서버에서
    막히는지 확인되지 않았다. 그래서 이 페이지는 서버에서 한 번 더 거른다.
    PRINT_ADMIN_USERNAMES 를 설정하지 않으면 아무도 통과하지 못한다(열어두는 것보다 안전).

    로그인 응답의 role 필드는 쓸 수 없다. 실제로 관리 작업에 쓰는 james3 계정도
    role 이 'user' 로 내려온다 — 관리자 여부를 구분해 주지 않는다.
    """
    allow = os.environ.get("PRINT_ADMIN_USERNAMES", "")
    allowed = {u.strip() for u in allow.split(",") if u.strip()}
    if not allowed:
        # 설정 누락과 실제 거부를 구분해야 한다. 둘 다 "관리자 아님"으로 뭉뚱그리면
        # 환경변수를 안 넣은 건지 계정이 빠진 건지 알 수가 없다.
        raise MDiaryError(
            "PRINT_ADMIN_USERNAMES 환경변수가 설정되지 않아 아무도 로그인할 수 없습니다.",
            status=503,
        )
    return username in allowed


def _post_diary(token, payload):
    try:
        res = requests.post(
            f"{BASE_URL}/mDiary_app/diary/",
            headers={"Authorization": f"Bearer {token}"},
            data=payload,
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise MDiaryError(f"일기 조회에 실패했습니다: {e}")

    if res.status_code == 401:
        raise MDiaryError("세션이 만료되었습니다. 다시 로그인해 주세요.", status=401)
    if res.status_code != 200:
        raise MDiaryError(f"일기 조회 실패 (HTTP {res.status_code})")

    data = res.json()
    # option_group/check_emotion 을 보내면 3원소 배열로 오지만 여기서는 안 보낸다.
    # 그래도 방어적으로 diary_list 래핑을 풀어 준다.
    if isinstance(data, dict):
        return data.get("diary_list") or data.get("data") or []
    if isinstance(data, list) and data and isinstance(data[0], dict) and "diary_list" in data[0]:
        return data[0]["diary_list"]
    return data if isinstance(data, list) else []


def _entry_date(entry):
    from .render import parse_api_date

    try:
        return parse_api_date(entry.get("date"))
    except ValueError:
        return None


def fetch_all(token, username, start_year=None, end_year=None):
    """
    사용자의 일기를 전부 가져온다.

    먼저 from_date/to_date 로 한 번에 받아 보고, 결과가 두 달 이상에 걸쳐 있으면
    그대로 쓴다. 한 달치만 오거나 비어 있으면 서버가 그 필터를 우리 기대와 다르게
    해석했다고 보고 year+month 월별 루프로 떨어진다 — reportsD.py 가 쓰던 검증된
    경로다. 한 달만 쓴 사용자는 불필요하게 루프를 한 번 더 도는데, 결과는 같고
    느려질 뿐이라 안전한 쪽으로 둔다.
    """
    today = datetime.now()
    start_year = start_year or 2019  # 서비스 개시 이전. 넉넉히 잡는다.
    end_year = end_year or today.year

    entries = _post_diary(
        token,
        {
            "username": username,
            "from_date": f"{start_year}-01-01T00:00:00.000Z",
            "to_date": f"{end_year}-12-31T23:59:59.000Z",
        },
    )
    if _spans_multiple_months(entries):
        return _dedupe(entries)

    collected = list(entries or [])
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            if year == today.year and month > today.month:
                break
            got = _post_diary(token, {"username": username, "year": year, "month": month})
            if got:
                collected.extend(got)
    return _dedupe(collected)


def _spans_multiple_months(entries):
    """받아온 일기가 두 달 이상에 걸쳐 있는지 — 범위 조회가 먹었는지 판별용."""
    months = set()
    for e in entries or []:
        d = _entry_date(e)
        if d:
            months.add((d.year, d.month))
            if len(months) > 1:
                return True
    return False


def _dedupe(entries):
    """id 기준 중복 제거 후 날짜 오름차순 정렬."""
    seen = {}
    for e in entries:
        if not isinstance(e, dict):
            continue
        key = e.get("id", id(e))
        seen[key] = e
    out = [e for e in seen.values() if _entry_date(e)]
    out.sort(key=lambda e: _entry_date(e))
    return out


def month_range(ym):
    """'2026-03' -> (date시작, date끝) 문자열."""
    year, month = (int(x) for x in ym.split("-"))
    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"
