"""
POST /api/print/stats  {token, username}
  -> {total, renderable, skipped[], firstDate, lastDate, monthly[], quote}

일기를 전부 받아 월별로 집계하고 견적을 낸다.
페이지 수는 render.is_renderable() 로 세므로 실제 인쇄물과 어긋나지 않는다.
"""

import os
import sys
from collections import Counter
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import mdiary, pricing
from _lib.http import read_json, send_json
from _lib.render import is_renderable, parse_api_date


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

            counter = Counter(parse_api_date(e["date"]).strftime("%Y-%m") for e in renderable)
            monthly = [{"ym": ym, "count": counter[ym]} for ym in sorted(counter)]

            dates = sorted(parse_api_date(e["date"]) for e in renderable)

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
                    "quote": pricing.plan_volumes(monthly),
                },
            )
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"조회 중 오류: {e}"}, 500)
