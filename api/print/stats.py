"""
POST /api/print/stats  {token, username, mode?, vendor?}
  -> {total, renderable, skipped[], firstDate, lastDate, monthly[], monthlyPublic[], secret{}, quote}

관리자용. 조회 대상 username 을 요청 본문으로 받는다 — login.py 가 관리자만
통과시키므로 성립한다. 고객용은 /api/print/customer/stats 로 따로 있다
(거기서는 로그인한 본인만 조회할 수 있다).

집계 로직은 _lib/diarystats.py 에 있다. 고객용과 같은 코드를 쓴다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import diarystats, mdiary
from _lib.http import read_json, send_json


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

            data = diarystats.build(token, username, body.get("mode"), body.get("vendor"))
            return send_json(self, data)
        except diarystats.NotFound as e:
            return send_json(self, {"error": str(e)}, 404)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"조회 중 오류: {e}"}, 500)
