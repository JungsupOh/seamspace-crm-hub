"""
마음일기(diaryapi.seamspace.me) API 클라이언트.

reportsD.py 는 하드코딩된 Bearer 토큰을 썼는데(이미 만료됐다), 여기서는
관리자가 입력한 계정으로 매번 로그인해 토큰을 받는다. 토큰도 비밀번호도 저장하지 않는다.
"""

import os
import re
import calendar
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests

BASE_URL = os.environ.get("MDIARY_BASE_URL", "https://diaryapi.seamspace.me").rstrip("/")
TIMEOUT = 30
# 월별 조회를 동시에 던질 개수 (fetch_all 주석 참고)
MONTH_FETCH_WORKERS = 8


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

    return _session_from(res, fallback_username=username)


def _access_token(res):
    """
    로그인 응답에서 액세스 토큰을 꺼낸다.

    토큰은 보통 set-cookie 의 ss_access_token 으로 온다. requests 가 쿠키를
    못 읽는 경우가 있어 헤더 원문도 본다. 예전 형식(본문에 token)도 받아 둔다.
    아이디 로그인과 구글 로그인이 같은 방식이라 공유한다.
    """
    token = res.cookies.get("ss_access_token")
    if not token:
        m = re.search(r"ss_access_token=([^;]+)", res.headers.get("set-cookie", ""))
        if m:
            token = m.group(1)
    if not token:
        try:
            token = (res.json() or {}).get("token") or (res.json() or {}).get("access_token")
        except ValueError:
            token = None
    return token


def _session_from(res, fallback_username=""):
    token = _access_token(res)
    data = {}
    try:
        data = res.json() or {}
    except ValueError:
        pass

    if not token:
        cookies = ", ".join(res.cookies.keys()) or "없음"
        keys = ", ".join(data.keys()) if data else "(JSON 아님)"
        raise MDiaryError(
            f"로그인은 됐지만 액세스 토큰을 받지 못했습니다. "
            f"쿠키=[{cookies}] 본문키=[{keys}]",
            status=401,
        )

    return {
        "token": token,
        "username": data.get("username") or fallback_username,
        "name": data.get("name") or "",
    }


def google_login(id_token, origin=None):
    """
    구글 계정으로 로그인한다 — /mDiary_app/google_sso_login/.

    화면에서 Google Sign-In 으로 받은 id_token 을 넘기면 mDiary 가 검증하고
    일반 로그인과 같은 액세스 토큰을 내준다.

    **가입이 안 된 구글 계정은 needs_register 로 돌아온다.** 여기서 대신
    가입시키지 않는다 — 약관 동의와 그룹 설정이 앱 쪽 흐름에 묶여 있고,
    출력 주문 화면이 회원가입을 대신할 자리가 아니다.
    """
    if not id_token:
        raise MDiaryError("구글 로그인 정보가 비어 있습니다.", status=400)
    body = {"id_token": id_token}
    if origin:
        body["origin"] = origin          # 'app' | 'group'. 교사 웹도 있을 때만 보낸다
    try:
        res = requests.post(
            f"{BASE_URL}/mDiary_app/google_sso_login/",
            json=body,
            # 교사 웹(group.seamspace.me)이 보내는 헤더와 맞춘다. 서버가 이 값으로
            # 분기할 수 있어, 동작이 확인된 클라이언트와 같은 모양으로 부른다.
            headers={"X-Client-Type": "mobile"},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise MDiaryError(f"일기 서버에 연결하지 못했습니다: {e}")

    data = {}
    try:
        data = res.json() or {}
    except ValueError:
        pass

    if data.get("needs_register"):
        raise MDiaryError(
            "마음일기에 가입되지 않은 구글 계정입니다. 앱에서 먼저 가입해 주세요.",
            status=403,
        )
    if res.status_code != 200:
        detail = (res.text or "").strip().replace("\n", " ")[:120]
        raise MDiaryError(
            f"구글 로그인 거부됨 (HTTP {res.status_code}) — {detail or '응답 본문 없음'}",
            status=401,
        )
    return _session_from(res)


def is_admin(username):
    """
    관리자 허용목록 확인.

    /mDiary_app/diary/ 는 일반 사용자 토큰이면 본인 일기만 돌려준다 — a 로 로그인해
    b 를 조회하면 권한 에러다. 그런데 **슈퍼유저 계정은 뚫려 있어** 요청 본문의
    username 으로 남의 일기가 그대로 조회된다 (개발팀 확인 2026-10).

    ⚠️ 즉 슈퍼유저 토큰 하나면 아무 학생의 일기든 전부 읽힌다. 이 허용목록이
    그 앞을 막는 유일한 문이다. PRINT_ADMIN_USERNAMES 를 설정하지 않으면 아무도
    통과하지 못한다(열어두는 것보다 안전) — 이 기본값을 바꾸지 말 것.

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


def diary_count(token, username):
    """
    사용자가 쓴 일기 수 — /mDiary_app/user_diary_count/. 한 번이면 끝난다.

    fetch_all 이 '다 받았는지' 판단하는 데 쓴다. 이게 없으면 범위 조회 결과가
    한 달치일 때 다 받은 건지 서버가 필터를 무시한 건지 구분할 수 없어,
    2019년부터 월별로 94번을 훑는 수밖에 없었다.

    실패하면 None. 이 값이 없다고 조회를 막으면 안 된다 — 보조 수단일 뿐이다.
    """
    try:
        res = requests.post(
            f"{BASE_URL}/mDiary_app/user_diary_count/",
            headers={"Authorization": f"Bearer {token}"},
            data={"username": username},
            timeout=TIMEOUT,
        )
        if res.status_code != 200:
            return None
        body = res.json()
    except (requests.RequestException, ValueError):
        return None

    # 응답이 {diary_count:..} 로 오기도, {data:{diary_count:..}} 로 오기도 한다
    for node in (body, body.get("data") if isinstance(body, dict) else None):
        if isinstance(node, dict) and node.get("diary_count") is not None:
            try:
                return int(node["diary_count"])
            except (TypeError, ValueError):
                return None
    return None


def fetch_all(token, username, start_year=None, end_year=None):
    """
    사용자의 일기를 전부 가져온다.

    먼저 from_date/to_date 로 한 번에 받아 보고, 결과가 두 달 이상에 걸쳐 있으면
    그대로 쓴다. 한 달치만 오거나 비어 있으면 서버가 그 필터를 우리 기대와 다르게
    해석했다고 보고 year+month 월별 조회로 떨어진다 — reportsD.py 가 쓰던 검증된
    경로다.

    **월별 조회는 동시에 던진다.** 순차로 돌면 2019년부터 94개월치라 한 번에
    75초가 넘어 Vercel 60초 제한에 걸린다. 일기가 없거나 한 달치뿐인 계정은
    무조건 이 경로로 오기 때문에, 신규 사용자가 첫 화면에서 바로 타임아웃을 본다.
    """
    today = datetime.now()
    start_year = start_year or 2019  # 서비스 개시 이전. 넉넉히 잡는다.
    end_year = end_year or today.year

    # 편수를 먼저 물어본다. 0편이면 여기서 끝 — 신규 사용자가 94번 조회를
    # 기다릴 이유가 없다.
    total = diary_count(token, username)
    if total == 0:
        return []

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

    # 한 달치뿐이어도 편수가 맞으면 다 받은 것이다. 월별 조회를 건너뛴다.
    got = _dedupe(entries)
    if total is not None and len(got) >= total:
        return got

    months = [
        (year, month)
        for year in range(start_year, end_year + 1)
        for month in range(1, 13)
        if not (year == today.year and month > today.month)
    ]

    collected = list(entries or [])
    # 여기까지 왔다는 건 편수를 못 믿는다는 뜻이다. 전 구간을 훑는다.
    # 동시에 몇 개까지 던질지. 늘리면 빨라지지만 일기 서버에 부담이 간다.
    # 8 이면 94개월이 12번에 끝난다.
    with ThreadPoolExecutor(max_workers=MONTH_FETCH_WORKERS) as pool:
        futures = [
            pool.submit(_post_diary, token, {"username": username, "year": y, "month": m})
            for y, m in months
        ]
        for f in futures:
            # 한 달이라도 실패하면 올린다. 조용히 건너뛰면 편수가 모자란 채로
            # 견적이 나가고, 실제 인쇄물과 페이지 수가 어긋난다.
            got = f.result()
            if got:
                collected.extend(got)
    return _dedupe(collected)   # 순서가 섞여도 여기서 날짜 오름차순으로 정렬된다


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


def display_name(entries, fallback=""):
    """
    일기 응답에서 작성자 실제 이름을 꺼낸다.

    diary API 응답의 각 항목에 username 과 name 이 함께 들어 있다(Postman 컬렉션 확인).
    별도 조회 API 가 필요 없다 — user_info 는 토큰 주체 본인 정보만 주므로 쓸 수 없다.

    표지에 들어갈 값이라 비어 있으면 아이디로 떨어뜨린다. 여러 값이 섞여 있으면
    가장 많이 나온 이름을 쓴다(한 사용자의 일기만 받으므로 사실상 하나다).
    """
    counts = {}
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        nm = (e.get("name") or "").strip()
        if nm:
            counts[nm] = counts.get(nm, 0) + 1
    if not counts:
        return fallback
    return max(counts, key=counts.get)


def month_range(ym):
    """'2026-03' -> (date시작, date끝) 문자열."""
    year, month = (int(x) for x in ym.split("-"))
    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"
