"""
POST /api/print/quote  {monthly[], from?, to?, splits?} -> 견적

화면이 인쇄 구간이나 분책 경계를 바꿀 때마다 부르는 순수 계산 엔드포인트다.
일기를 다시 조회하지 않고 클라이언트가 이미 들고 있는 월별 집계만 받아 계산한다.

가격 로직을 화면 쪽에 복사하지 않으려고 굳이 서버를 한 번 더 타게 했다.
같은 계산이 두 벌 있으면 언젠가 어긋나고, 어긋나면 견적과 인쇄물이 달라진다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import pricing
from _lib.http import read_json, send_json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            monthly = body.get("monthly") or []
            ym_from = body.get("from")
            ym_to = body.get("to")

            selected = [
                m
                for m in monthly
                if isinstance(m, dict)
                and m.get("ym")
                and (not ym_from or m["ym"] >= ym_from)
                and (not ym_to or m["ym"] <= ym_to)
            ]

            splits = body.get("splits")
            result = (
                pricing.plan_with_splits(selected, splits)
                if splits
                else pricing.plan_volumes(selected)
            )
            return send_json(self, result)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"견적 계산 중 오류: {e}"}, 500)
