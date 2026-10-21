"""
POST /api/print/customer/google_login  {idToken} -> {session, username, name}

구글 계정으로 가입한 사용자용. 화면에서 Google Sign-In 으로 받은 id_token 을
mDiary(/mDiary_app/google_sso_login/)가 검증하고, 성공하면 아이디 로그인과
같은 액세스 토큰을 내준다. 그 뒤는 customer/login 과 완전히 같다 —
username 을 서명해 묶은 세션을 돌려주고, 이후 요청에서는 본문의 아이디를 보지 않는다.

**id_token 검증은 우리가 하지 않는다.** mDiary 가 구글에 대조하고 자기 사용자와
연결까지 한다. 우리가 따로 검증해 봐야 '이 구글 계정이 어느 마음일기 사용자인지'는
알 수 없다.
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
            id_token = (body.get("idToken") or "").strip()
            if not id_token:
                return send_json(self, {"error": "구글 로그인 정보가 없습니다."}, 400)

            info = mdiary.google_login(id_token)
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
            print(f"[customer/google_login] 오류: {e}", file=sys.stderr)
            return send_json(self, {"error": "구글 로그인 처리 중 오류가 발생했습니다."}, 500)
