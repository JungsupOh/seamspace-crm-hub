"""
POST /api/print/login  {username, password} -> {token, name, username}

관리자 계정만 통과시킨다. mDiary 의 일기 조회 API 는 대상 사용자를 요청 본문의
username 으로 정하므로, 여기서 막지 않으면 아무 일기 사용자나 남의 일기를 열어볼 수 있다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import mdiary
from _lib.http import read_json, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            username = (body.get("username") or "").strip()
            password = body.get("password") or ""
            if not username or not password:
                return send_json(self, {"error": "아이디와 비밀번호를 입력해 주세요."}, 400)

            session = mdiary.login(username, password)

            if not mdiary.is_admin(session["username"]):
                return send_json(
                    self,
                    {"error": "이 페이지는 관리자만 사용할 수 있습니다."},
                    403,
                )

            return send_json(
                self,
                {
                    "token": session["token"],
                    "username": session["username"],
                    "name": session["name"],
                },
            )
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"로그인 처리 중 오류: {e}"}, 500)
