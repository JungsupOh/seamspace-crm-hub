"""
POST /api/print/customer/login  {username, password} -> {session, username, name}

고객용 로그인. **허용목록 검사를 하지 않는다** — 누구나 자기 일기를 출력할 수 있어야 한다.
대신 로그인 시점의 username 을 서명해 묶어서(session.make_session) 돌려준다.
이후 고객용 엔드포인트는 요청 본문의 username 을 보지 않고 이 세션에서만 꺼낸다.

mDiary 액세스 토큰은 세션 안에 들어가고 브라우저에는 따로 내려보내지 않는다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import mdiary, session
from _lib.http import read_json, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            username = (body.get("username") or "").strip()
            password = body.get("password") or ""
            if not username or not password:
                return send_json(self, {"error": "아이디와 비밀번호를 입력해 주세요."}, 400)

            info = mdiary.login(username, password)
            token = session.make_session(info["username"], info["name"], info["token"])
            return send_json(
                self,
                {"session": token, "username": info["username"], "name": info["name"]},
            )
        except session.SessionError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"로그인 처리 중 오류: {e}"}, 500)
