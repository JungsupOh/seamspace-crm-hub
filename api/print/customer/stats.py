"""
POST /api/print/customer/stats  {session, mode?}
  -> {username, name, total, renderable, monthly[], monthlyPublic[], secret{}, quote, vendor}

**조회 대상은 세션에 서명된 본인뿐이다.** 본문에 username 을 넣어도 무시한다.
이게 공개 사이트에서 남의 일기를 못 보게 막는 지점이다.

업체는 스위트북으로 고정한다 — 고객용은 스위트북 전용이다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import diarystats, mdiary, pricing, session
from _lib.http import read_json, send_json

VENDOR = "sweetbook"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            sess = session.read_session(body.get("session"))

            data = diarystats.build(
                sess["token"], sess["username"],
                mode=body.get("mode"), vendor=VENDOR,
                with_diagnostics=False,          # 고객에게 보여줄 내부 진단이 아니다
                allow_padding=bool(body.get("allowPadding")),
                # 0편도 '내 글 확인' 단계에서 보여준다. 로그인은 됐는데 화면이
                # 로그인 폼에 머물면 사용자는 무엇이 잘못됐는지 알 수 없다.
                allow_empty=True,
                display_name=sess["name"],
            )
            # 업체 목록 전체는 고객에게 의미가 없다. 쓰는 것 하나만 내려보낸다.
            data.pop("vendors", None)
            data["vendor"] = pricing.vendor_info(VENDOR)
            return send_json(self, data)
        except session.SessionError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"조회 중 오류: {e}"}, 500)
