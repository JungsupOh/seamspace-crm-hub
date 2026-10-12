"""
비밀글 판별.

마음일기 개발팀 확인(2026-10): `POST /mDiary_app/diary/` 는 **본인 일기를 가져오는
학생용 API** 라서 비밀글도 그대로 내려온다. 남의 username 으로 호출하면 권한 에러다.
(그룹용 gmember_diary_list 는 비밀글·익명공유 글의 내용을 비우고 준다 — 그쪽을 쓰면
내용 없는 페이지가 책에 섞이고 페이지 수·가격까지 어긋나므로 제본에는 쓸 수 없다.)

그래서 "비밀글을 책에 넣을지"는 사용자가 출력할 때 고르는 옵션이다.

판별 필드는 `isSecret` 이다 (개발팀 확인 2026-10, diary·gmember_diary_list 공통).
값이 참이면 비밀글.

필드가 아예 없는 일기는 '판별 불가'로 두고, 제외를 고른 경우 **같이 뺀다**(fail-closed).
비밀글을 실수로 넣는 쪽은 인쇄·배송이 끝나면 되돌릴 수 없고, 공개글을 실수로 빼는 쪽은
페이지가 한 장 빠지는 데 그친다. 양쪽 비용이 다르므로 안전한 쪽으로 기운다.
판별 불가 건수는 따로 세어 화면에 보여준다.

서버 응답이 바뀌면 환경변수로 덮을 수 있다.

    MDIARY_SECRET_FIELD=is_secret     값이 참이면 비밀글
    MDIARY_SECRET_FIELD=!is_open      값이 거짓이면 비밀글 (반대 극성)
    MDIARY_SECRET_FIELD=              (빈 값) 판별 비활성 — 제외 옵션이 막힌다

극성을 '!' 로 명시하게 한 이유도 같다. is_open / is_secret 은 이름만 보고 뒤집어
해석하기 쉬운데, 뒤집히면 공개글만 인쇄되는 정반대 사고가 난다.
"""

import os

# 렌더러가 실제로 쓰는 필드. 진단에서 '그 외 어떤 필드가 오는지' 추릴 때 기준이 된다.
KNOWN_FIELDS = frozenset(
    {
        "id", "date", "topic", "content", "emotions", "emotions_score",
        "mbti", "traffic", "SeamTalk", "isSecret", "username", "name",
    }
)

_FALSY_STRINGS = {"", "0", "n", "no", "false", "f", "none", "null"}


DEFAULT_FIELD = "isSecret"


def _spec():
    raw = os.environ.get("MDIARY_SECRET_FIELD")
    raw = DEFAULT_FIELD if raw is None else raw.strip()
    if not raw:
        return None, False
    if raw.startswith("!"):
        return raw[1:].strip(), True   # 값이 거짓이면 비밀글
    return raw, False


def detectable():
    """비밀글을 판별할 수 있는 상태인지 (= 필드명이 설정돼 있는지)."""
    field, _ = _spec()
    return bool(field)


def field_name():
    field, inverted = _spec()
    if not field:
        return None
    return f"!{field}" if inverted else field


def _truthy(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in _FALSY_STRINGS
    return bool(value)


def secret_flag(diary):
    """
    True=비밀글 / False=공개글 / None=판별 불가.

    None 은 '공개글'이 아니다. 섞어서 다루면 제외가 조용히 실패한다.
    """
    field, inverted = _spec()
    if not field or not isinstance(diary, dict) or field not in diary:
        return None
    value = _truthy(diary[field])
    return (not value) if inverted else value


def is_secret(diary):
    """확실히 비밀글인 것만 True. 집계용."""
    return secret_flag(diary) is True


def should_hide(diary):
    """
    '비밀글 제외'를 골랐을 때 뺄 대상인지.

    판별 불가(필드 없음)도 뺀다. 넣었다가 틀리면 되돌릴 수 없지만,
    뺐다가 틀리면 페이지 한 장이 빠지는 데 그친다.
    """
    return secret_flag(diary) is not False


def count_secret(entries):
    """(비밀글 수, 판별불가 수)."""
    secret = unknown = 0
    for e in entries or []:
        flag = secret_flag(e)
        if flag is True:
            secret += 1
        elif flag is None:
            unknown += 1
    return secret, unknown


def observed_fields(entries, limit=40):
    """
    응답에 실제로 들어 있는, 렌더러가 안 쓰는 필드 목록.

    비밀글 필드명을 알아내려고 둔 진단용이다. 실계정으로 한 번 조회하면
    화면에 후보가 그대로 떠서 MDIARY_SECRET_FIELD 에 넣을 이름을 바로 알 수 있다.
    값은 싣지 않는다 — 일기 본문이 로그·화면에 새어 나가면 안 된다.
    """
    seen = set()
    for e in entries or []:
        if isinstance(e, dict):
            seen.update(k for k in e.keys() if k not in KNOWN_FIELDS)
    return sorted(seen)[:limit]
