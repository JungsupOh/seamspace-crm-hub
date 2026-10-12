"""
POST /api/print/order
  {action: 'estimate'|'place', bookUids[], shipping{}, paymentKey?, orderId?, amount?}

PDF 생성 단계(generate)에서 권마다 스위트북 책을 FINALIZED 까지 만들어 두었다.
여기서는 그 책들로 금액을 확인하고, 결제 승인 후 실제 주문을 넣는다.

  action=estimate  충전금 차감 예정액 조회. 결제창을 띄우기 전에 보여준다
  action=place     ① 토스 결제 승인 → ② 스위트북 주문 생성

결제 승인은 Supabase Edge Function(confirm-toss)에 맡긴다. TOSS_SECRET_KEY 가 거기에만
있고 되읽을 수 없어서인데, 결제 시크릿을 Vercel 에 한 벌 더 두지 않는 쪽이 낫기도 하다.

**순서가 중요하다.** 결제를 먼저 승인하고 주문을 넣는다. 반대로 하면 주문은 들어갔는데
결제가 실패해 책만 제작되는 일이 생긴다. 반대 방향의 사고(결제는 됐는데 주문 실패)는
환불로 되돌릴 수 있지만, 이미 인쇄된 책은 되돌릴 수 없다.

주문이 실패하면 결제건을 그대로 두고 에러를 돌려준다 — 여기서 자동 취소하지 않는다.
자동 취소가 또 실패하면 상태를 알 수 없게 되므로, 사람이 보고 판단하는 편이 낫다.
응답에 paymentKey 를 실어 보내 수동 처리가 가능하게 한다.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import sweetbook
from _lib.http import read_json, send_json


def _supabase():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.")
    return url.rstrip("/"), key


def _toss_confirm(payment_key, order_id, amount):
    """confirm-toss Edge Function 으로 승인한다. 서비스롤 키로 호출한다."""
    base, key = _supabase()
    res = requests.post(
        f"{base}/functions/v1/confirm-toss",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        data=json.dumps({"paymentKey": payment_key, "orderId": order_id, "amount": amount}),
        timeout=40,
    )
    try:
        data = res.json()
    except ValueError:
        raise RuntimeError(f"결제 승인 응답을 읽지 못했습니다 (HTTP {res.status_code})")
    if not res.ok or not data.get("ok"):
        raise RuntimeError(data.get("error") or f"결제 승인 실패 (HTTP {res.status_code})")
    return data


def _require_shipping(shipping):
    missing = [
        label
        for key, label in (
            ("recipientName", "받는 분"),
            ("recipientPhone", "연락처"),
            ("postalCode", "우편번호"),
            ("address1", "주소"),
        )
        if not (shipping.get(key) or "").strip()
    ]
    return missing


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            action = (body.get("action") or "estimate").strip()
            book_uids = [b for b in (body.get("bookUids") or []) if b]
            if not book_uids:
                return send_json(self, {"error": "주문할 책이 없습니다. PDF 를 먼저 만들어 주세요."}, 400)

            if action == "estimate":
                data = sweetbook.estimate(book_uids)
                data["env"] = "live" if sweetbook.is_live() else "sandbox"
                return send_json(self, data)

            if action != "place":
                return send_json(self, {"error": f"알 수 없는 action: {action}"}, 400)

            shipping = body.get("shipping") or {}
            missing = _require_shipping(shipping)
            if missing:
                return send_json(self, {"error": f"{', '.join(missing)}을(를) 입력해 주세요."}, 400)

            payment_key = body.get("paymentKey")
            order_id = body.get("orderId")
            amount = body.get("amount")
            if not (payment_key and order_id and amount):
                return send_json(self, {"error": "결제 정보가 없습니다."}, 400)

            # ① 결제 승인 — 실패하면 주문을 넣지 않는다
            try:
                payment = _toss_confirm(payment_key, order_id, int(amount))
            except Exception as e:  # noqa: BLE001
                return send_json(self, {"error": f"결제 승인 실패: {e}"}, 402)

            # ② 스위트북 주문 — 실패해도 결제는 그대로 둔다(수동 처리)
            try:
                order = sweetbook.create_order(
                    book_uids, shipping, external_ref=order_id, idempotency_key=order_id,
                )
            except sweetbook.SweetbookError as e:
                return send_json(
                    self,
                    {
                        "error": f"결제는 승인됐지만 제작 주문이 실패했습니다 — {e}",
                        "paymentKey": payment_key,
                        "orderId": order_id,
                        "needsManualAction": True,
                    },
                    e.status if e.status >= 400 else 502,
                )

            return send_json(
                self,
                {
                    "ok": True,
                    "env": "live" if sweetbook.is_live() else "sandbox",
                    "order": order,
                    "payment": {
                        "orderId": order_id,
                        "method": payment.get("method"),
                        "approvedAt": payment.get("approvedAt"),
                        "receiptUrl": payment.get("receiptUrl"),
                        "totalAmount": payment.get("totalAmount"),
                    },
                },
            )
        except sweetbook.SweetbookError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"주문 처리 중 오류: {e}"}, 500)
