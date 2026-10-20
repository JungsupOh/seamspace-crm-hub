"""
일기 집계 — 관리자용(/api/print/stats)과 고객용(/api/print/customer/stats)이 공유한다.

원래 stats.py 의 do_POST 안에 다 들어 있었는데, 고객용에서 그대로 써야 해서 꺼냈다.
**조회 대상 username 을 누가 정하느냐만 다르고** 집계 로직은 같다.
"""

from collections import Counter

from . import mdiary, pricing, secret
from .render import is_renderable, parse_api_date


class NotFound(Exception):
    pass


def monthly_counts(entries):
    counter = Counter(parse_api_date(e["date"]).strftime("%Y-%m") for e in entries)
    return [{"ym": ym, "count": counter[ym]} for ym in sorted(counter)]


def build(token, username, mode=None, vendor=None, with_diagnostics=True,
          allow_padding=False):
    """
    일기를 전부 받아 월별 집계와 견적을 낸다.

    with_diagnostics=False 면 진단용 필드(skipped 목록, observedFields)를 빼고 준다.
    고객 화면에 보여줄 값이 아니고, 어떤 글이 왜 빠졌는지는 내부 정보다.
    """
    entries = mdiary.fetch_all(token, username)
    if not entries:
        raise NotFound(f"'{username}' 사용자의 일기를 찾지 못했습니다. 아이디를 확인해 주세요.")

    renderable = [e for e in entries if is_renderable(e)]
    skipped = [
        {"id": e.get("id"), "date": e.get("date"), "traffic": e.get("traffic")}
        for e in entries
        if not is_renderable(e)
    ]

    # 비밀글 — 판별 가능할 때만 제외 집계를 만든다.
    secret_count, unknown_count = secret.count_secret(renderable)
    detectable = secret.detectable()
    public = [e for e in renderable if not secret.should_hide(e)] if detectable else []

    dates = sorted(parse_api_date(e["date"]) for e in renderable)
    monthly = monthly_counts(renderable)

    out = {
        "username": username,
        # 표지에 들어갈 실제 이름. diary 응답에 username 과 함께 들어 있다.
        "name": mdiary.display_name(entries, username),
        "total": len(entries),
        "renderable": len(renderable),
        "skippedCount": len(skipped),
        "firstDate": dates[0].strftime("%Y-%m-%d") if dates else None,
        "lastDate": dates[-1].strftime("%Y-%m-%d") if dates else None,
        "monthly": monthly,
        "monthlyPublic": monthly_counts(public) if detectable else None,
        "secret": {
            # 판별 가능한지. False 면 화면이 '비밀글 제외' 선택지를 막아야 한다.
            "detectable": detectable,
            "count": secret_count,
            "unknown": unknown_count,
        },
        "vendors": pricing.vendor_list(),
        "quote": pricing.plan_volumes(
            monthly, mode or pricing.DEFAULT_MODE, vendor or pricing.DEFAULT_VENDOR,
            allow_padding,
        ),
    }
    if with_diagnostics:
        out["skipped"] = skipped[:50]
        out["secret"]["field"] = secret.field_name()
        # 필드명을 알아내기 위한 진단. 값은 싣지 않는다(일기 본문 유출 방지).
        out["secret"]["observedFields"] = secret.observed_fields(entries)
    return out
