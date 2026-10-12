"""
비밀글 판별 검증.

  python3 scripts/test_print_secret.py

틀리면 사고의 방향이 비대칭이다.
  - 비밀글을 실수로 넣으면 → 인쇄·배송 후 되돌릴 수 없다
  - 공개글을 실수로 빼면   → 페이지 한 장이 빠진다
그래서 애매한 경우(필드 없음)는 전부 '빼는' 쪽이어야 한다. 그걸 확인한다.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "print"))

from _lib import secret  # noqa: E402

FAIL = []


def check(cond, msg):
    if not cond:
        FAIL.append(msg)


def with_field(value):
    """MDIARY_SECRET_FIELD 를 바꿔 끼운다."""
    if value is None:
        os.environ.pop("MDIARY_SECRET_FIELD", None)
    else:
        os.environ["MDIARY_SECRET_FIELD"] = value


# ── 1. 기본 필드는 isSecret ────────────────────────
with_field(None)
check(secret.detectable(), "기본 상태에서 판별 불가로 나옴")
check(secret.field_name() == "isSecret", f"기본 필드명 {secret.field_name()}")

# ── 2. 값 해석 ─────────────────────────────────────
for value, expect in [
    (True, True), (False, False),
    (1, True), (0, False),
    ("true", True), ("false", False),
    ("Y", True), ("N", False),
    ("1", True), ("0", False),
    ("", False), ("none", False), ("null", False),
    (None, False),
]:
    got = secret.secret_flag({"isSecret": value})
    check(got is expect, f"isSecret={value!r} → {got}, 기대 {expect}")

# ── 3. 필드가 없으면 '판별 불가'(None) — False 가 아니다 ──
check(secret.secret_flag({"id": 1}) is None, "필드 없는데 None 이 아님")
check(secret.secret_flag({}) is None, "빈 dict 가 None 이 아님")
check(secret.secret_flag("not a dict") is None, "dict 아닌 입력이 None 이 아님")

# ── 4. fail-closed — 판별 불가는 제외 대상 ─────────
check(secret.should_hide({"isSecret": True}) is True, "비밀글을 안 뺌")
check(secret.should_hide({"isSecret": False}) is False, "공개글을 뺌")
check(secret.should_hide({"id": 1}) is True, "판별 불가를 안 뺌 — fail-closed 위반")

# is_secret 은 '확실한 비밀글'만. 집계가 부풀면 안 된다.
check(secret.is_secret({"id": 1}) is False, "판별 불가가 비밀글로 집계됨")

# ── 5. 집계 ────────────────────────────────────────
entries = [
    {"id": 1, "isSecret": True},
    {"id": 2, "isSecret": False},
    {"id": 3, "isSecret": True},
    {"id": 4},                      # 판별 불가
    {"id": 5, "isSecret": "Y"},
]
s, u = secret.count_secret(entries)
check((s, u) == (3, 1), f"집계 {(s, u)}, 기대 (3, 1)")
hidden = [e for e in entries if secret.should_hide(e)]
check(len(hidden) == 4, f"제외 대상 {len(hidden)}건, 기대 4건 (비밀 3 + 판별불가 1)")

# ── 6. 반대 극성 (!is_open) ────────────────────────
with_field("!is_open")
check(secret.field_name() == "!is_open", f"극성 표기 {secret.field_name()}")
check(secret.secret_flag({"is_open": False}) is True, "is_open=False 가 비밀글이 아님")
check(secret.secret_flag({"is_open": True}) is False, "is_open=True 가 비밀글로 나옴")
check(secret.secret_flag({"isSecret": True}) is None, "다른 필드를 보고 있음")

# ── 7. 판별 비활성 ─────────────────────────────────
with_field("")
check(not secret.detectable(), "빈 값인데 판별 가능으로 나옴")
check(secret.field_name() is None, "비활성인데 필드명이 나옴")
check(secret.secret_flag({"isSecret": True}) is None, "비활성인데 판별함")
# 비활성이면 전부 '판별 불가' = 제외 대상. generate 가 409 로 막는 이유다.
check(secret.should_hide({"isSecret": False}) is True, "비활성인데 공개글로 통과시킴")

# ── 8. 진단 — 본문은 절대 싣지 않는다 ──────────────
with_field(None)
sample = [
    {"id": 1, "date": "2026-01-01", "content": "비밀 일기 본문", "isSecret": True, "weather": "맑음"},
    {"id": 2, "mood_level": 3, "content": "또 다른 본문"},
]
fields = secret.observed_fields(sample)
check(fields == ["mood_level", "weather"], f"진단 필드 {fields}")
check(all(isinstance(f, str) for f in fields), "진단 결과에 값이 섞임")
blob = repr(fields)
check("본문" not in blob, "진단 결과에 일기 본문이 들어감")
check("isSecret" not in fields, "이미 아는 필드가 진단에 섞임")

with_field(None)

# ── 결과 ───────────────────────────────────────────
if FAIL:
    print(f"✗ {len(FAIL)}건 실패\n")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)

print("✓ 전부 통과")
print(f"  판별 필드   {secret.field_name()}  (값이 참이면 비밀글)")
print("  판별 불가   제외 대상으로 분류 (fail-closed)")
