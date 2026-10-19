"""
POST /api/print/generate
  {token, username, from, to, includeSecret?, vendor?, volume?, volumeCount?, name?}
  -> {name, url, pages, bytes, cover{}, book?, skipped}

관리자용. 본문(내지)과 표지를 각각 PDF 로 만들어 둘 다 내려준다. 업체마다 올리는
방식이 달라서(스위트북은 API 업로드, 뚝딱샵은 웹 에디터에 직접 올림) 파일로 받을 수
있어야 한다.

한 번에 한 권씩 만든다. 여러 권이면 화면이 이 엔드포인트를 순서대로 호출한다 —
요청 하나가 길어져 타임아웃에 걸리는 걸 피하고, 진행 상황도 보여줄 수 있다.

만드는 과정은 _lib/bookbuild.py 에 있다. 고객용(customer/generate)과 같은 코드를 쓴다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import bookbuild, mdiary, sweetbook
from _lib.http import read_json, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            token = body.get("token")
            username = (body.get("username") or "").strip()
            ym_from = (body.get("from") or "").strip()
            ym_to = (body.get("to") or "").strip()

            if not token:
                return send_json(self, {"error": "로그인이 필요합니다."}, 401)
            if not (username and ym_from and ym_to):
                return send_json(self, {"error": "사용자와 인쇄 구간이 필요합니다."}, 400)

            out = bookbuild.build_volume(
                token, username, ym_from, ym_to,
                # 기본은 포함. 사용자가 끄면 비밀글을 빼고 만든다.
                include_secret=body.get("includeSecret", True) is not False,
                vendor=body.get("vendor"),
                volume=int(body.get("volume") or 1),
                volume_count=int(body.get("volumeCount") or 1),
                display_name=body.get("name"),
            )
            return send_json(self, out)
        except bookbuild.BuildError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except sweetbook.SweetbookError as e:
            # PDF 는 이미 만들어졌다. 스위트북 쪽만 실패했음을 구분해서 알려준다.
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"PDF 생성 중 오류: {e}"}, 500)
