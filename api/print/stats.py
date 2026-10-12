"""
POST /api/print/stats  {token, username, mode?, vendor?}
  -> {total, renderable, skipped[], firstDate, lastDate, monthly[], monthlyPublic[], secret{}, quote}

일기를 전부 받아 월별로 집계하고 견적을 낸다.
페이지 수는 render.is_renderable() 로 세므로 실제 인쇄물과 어긋나지 않는다.

월별 집계를 두 벌 내려준다 — 전체(monthly)와 비밀글 제외(monthlyPublic).
비밀글 포함 여부를 화면에서 토글할 때 일기를 다시 조회하지 않아도 되게 하기 위해서다.
(/quote 는 월별 집계만 받는 순수 계산이라 둘 중 하나를 골라 보내면 된다)
"""

import os
import sys
from collections import Counter
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import mdiary, pricing, secret
from _lib.http import read_json, send_json
from _lib.render import is_renderable, parse_api_date


def _monthly(entries):
    counter = Counter(parse_api_date(e["date"]).strftime("%Y-%m") for e in entries)
    return [{"ym": ym, "count": counter[ym]} for ym in sorted(counter)]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            token = body.get("token")
            username = (body.get("username") or "").strip()
            if not token:
                return send_json(self, {"error": "로그인이 필요합니다."}, 401)
            if not username:
                return send_json(self, {"error": "조회할 사용자 아이디를 입력해 주세요."}, 400)

            entries = mdiary.fetch_all(token, username)
            if not entries:
                return send_json(
                    self,
                    {
                        "error": f"'{username}' 사용자의 일기를 찾지 못했습니다. "
                        "아이디를 확인해 주세요."
                    },
                    404,
                )

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
            mode = body.get("mode") or pricing.DEFAULT_MODE
            vendor = body.get("vendor") or pricing.DEFAULT_VENDOR
            monthly = _monthly(renderable)

            return send_json(
                self,
                {
                    "username": username,
                    "total": len(entries),
                    "renderable": len(renderable),
                    "skipped": skipped[:50],
                    "skippedCount": len(skipped),
                    "firstDate": dates[0].strftime("%Y-%m-%d") if dates else None,
                    "lastDate": dates[-1].strftime("%Y-%m-%d") if dates else None,
                    "monthly": monthly,
                    "monthlyPublic": _monthly(public) if detectable else None,
                    "secret": {
                        # 판별 가능한지. False 면 화면이 '비밀글 제외' 선택지를 막아야 한다.
                        "detectable": detectable,
                        "field": secret.field_name(),
                        "count": secret_count,
                        "unknown": unknown_count,
                        # 필드명을 알아내기 위한 진단. 값은 싣지 않는다(일기 본문 유출 방지).
                        "observedFields": secret.observed_fields(entries),
                    },
                    "vendors": pricing.vendor_list(),
                    "quote": pricing.plan_volumes(monthly, mode, vendor),
                },
            )
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"조회 중 오류: {e}"}, 500)
