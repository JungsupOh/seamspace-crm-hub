"""
POST /api/print/generate  {token, username, from, to, includeSecret?}
  -> {name, url, pages, bytes, skipped}

한 번에 한 권씩 만든다. 여러 권이면 화면이 이 엔드포인트를 순서대로 호출한다 —
요청 하나가 길어져 타임아웃에 걸리는 걸 피하고, 진행 상황도 보여줄 수 있다.
"""

import io
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import mdiary, secret, storage
from _lib.http import read_json, send_json
from _lib.render import is_renderable, parse_api_date, render_volume


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            token = body.get("token")
            username = (body.get("username") or "").strip()
            ym_from = (body.get("from") or "").strip()
            ym_to = (body.get("to") or "").strip()
            # 기본은 포함. 사용자가 끄면 비밀글을 빼고 만든다.
            include_secret = body.get("includeSecret", True) is not False

            if not token:
                return send_json(self, {"error": "로그인이 필요합니다."}, 401)
            if not (username and ym_from and ym_to):
                return send_json(self, {"error": "사용자와 인쇄 구간이 필요합니다."}, 400)
            # 제외를 요청했는데 비밀글을 가려낼 수 없으면 여기서 멈춘다.
            # 그냥 만들면 '제외'를 고른 사용자의 비밀글이 그대로 인쇄되고,
            # 배송까지 끝나면 되돌릴 방법이 없다.
            if not include_secret and not secret.detectable():
                return send_json(
                    self,
                    {
                        "error": "비밀글을 가려낼 수 없어 제외하고 만들 수 없습니다. "
                        "MDIARY_SECRET_FIELD 환경변수를 설정해 주세요."
                    },
                    409,
                )

            entries = mdiary.fetch_all(token, username)
            selected = [
                e
                for e in entries
                if is_renderable(e, include_secret)
                and ym_from <= parse_api_date(e["date"]).strftime("%Y-%m") <= ym_to
            ]
            if not selected:
                return send_json(
                    self, {"error": "선택한 구간에 인쇄할 일기가 없습니다."}, 400
                )

            buf = io.BytesIO()
            result = render_volume(selected, buf, include_secret)
            data = buf.getvalue()

            stamp = datetime.now().strftime("%Y%m%d%H%M%S")
            name = f"{ym_from}_{ym_to}_{username}.pdf"
            url = storage.upload_pdf(f"{username}/{stamp}_{name}", data)

            return send_json(
                self,
                {
                    "name": name,
                    "url": url,
                    "pages": result["pages"],
                    "bytes": len(data),
                    "skipped": result["skipped"],
                },
            )
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"PDF 생성 중 오류: {e}"}, 500)
