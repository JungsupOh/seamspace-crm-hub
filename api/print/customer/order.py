"""
POST /api/print/customer/order  {session, bookTicket, shipping, paymentKey?, orderId?, amount?}
  -> {ok, orderRef, volumes[], totalAmount}

고객 주문. 관리자용 order.py 와 다른 점:

  · 주문할 책을 **bookTicket** 으로만 받는다. bookUid 를 그대로 받으면 번호를 아는
    사람이 남의 책을 주문할 수 있다. 티켓에는 발급받은 계정·책 목록·금액이 묶여 있다.
  · **결제 금액을 티켓의 값으로 확정한다.** 화면이 보낸 amount 는 대조만 한다.
  · 응답에 스위트북 충전금·원가가 들어가지 않는다. 고객이 볼 값이 아니다.

**순서가 중요하다.** 결제를 먼저 승인하고 주문을 넣는다. 반대로 하면 주문은 들어갔는데
결제가 실패해 책만 제작되는 일이 생긴다. 반대 방향(결제는 됐는데 주문 실패)은 환불로
되돌릴 수 있지만, 이미 인쇄된 책은 되돌릴 수 없다.

**Sandbox 에서는 결제를 받지 않는다.** 책이 실제로 만들어지지 않는데 돈만 진짜로
빠져나가는 조합이 제일 나쁘다. 운영 토스 키가 꽂힌 채 Sandbox 를 돌리다 실결제가
일어난 적이 있어 서버에서 막는다 — 화면 조건만으로는 부족하다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import ordering, session, sweetbook
from _lib.http import read_json, send_json

VENDOR = "sweetbook"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            sess = session.read_session(body.get("session"))
            username = sess["username"]
            ticket = session.read_ticket(body.get("bookTicket"), username)

            shipping = body.get("shipping") or {}
            missing = ordering.require_shipping(shipping)
            if missing:
                return send_json(self, {"error": f"{', '.join(missing)}을(를) 입력해 주세요."}, 400)

            amount = ticket["amount"]
            payment_key = body.get("paymentKey")
            order_id = body.get("orderId")
            live = sweetbook.is_live()

            if payment_key and not live:
                return send_json(
                    self, {"error": "테스트(Sandbox) 환경에서는 결제를 받지 않습니다."}, 400
                )

            # 화면이 보낸 금액이 티켓과 다르면 멈춘다. 결제창을 띄운 뒤 금액이 바뀌었거나
            # 누군가 손을 댄 경우다 — 어느 쪽이든 그대로 진행하면 안 된다.
            sent = body.get("amount")
            if sent is not None and int(sent) != amount:
                return send_json(
                    self,
                    {"error": "주문 금액이 달라졌습니다. 처음부터 다시 진행해 주세요."},
                    409,
                )

            # ① 결제 승인
            payment = None
            if payment_key:
                if not order_id:
                    return send_json(self, {"error": "결제 정보가 부족합니다."}, 400)
                try:
                    payment = ordering.toss_confirm(payment_key, order_id, amount)
                except Exception as e:  # noqa: BLE001
                    print(f"[customer/order] 결제 승인 실패: {e}", file=sys.stderr)
                    return send_json(self, {"error": "결제 승인에 실패했습니다."}, 402)
            else:
                order_id = order_id or ordering.new_order_ref()

            # ② 스위트북 주문 — 실패해도 결제는 그대로 둔다(사람이 처리)
            try:
                order = sweetbook.create_order(
                    ticket["bookUids"], shipping,
                    external_ref=order_id, idempotency_key=order_id,
                )
            except sweetbook.SweetbookError as e:
                print(f"[customer/order] 스위트북 주문 실패 ref={order_id}: {e}", file=sys.stderr)
                return send_json(
                    self,
                    {
                        "error": "결제는 완료되었지만 제작 접수가 지연되고 있습니다. "
                                 "담당자가 확인 후 연락드립니다.",
                        "orderRef": order_id,
                        "needsManualAction": True,
                    },
                    502,
                )

            # ③ 주문 저장 — 웹훅이 이 행을 찾아 알림톡을 보낸다.
            #    저장에 실패해도 주문은 성립했으므로 성공으로 응답한다.
            ctx = {
                "username": username,
                "name": sess["name"],
                "vendor": VENDOR,
                "includeSecret": body.get("includeSecret", True) is not False,
                "volumes": ticket["volumes"],
                "bookUids": ticket["bookUids"],
                "productAmount": amount - _shipping_fee(),
                "shippingFee": _shipping_fee(),
                "totalAmount": amount,
            }
            saved = True
            try:
                ordering.save_order(order_id, order, shipping, ctx, live)
            except Exception as e:  # noqa: BLE001
                saved = False
                print(f"[customer/order] print_orders 저장 실패 ref={order_id}: {e}", file=sys.stderr)

            return send_json(self, {
                "ok": True,
                "orderRef": order_id,
                "volumes": ticket["volumes"],
                "totalAmount": amount,
                "saved": saved,
                "paid": payment is not None,
                "receiptUrl": (payment or {}).get("receiptUrl"),
            })
        except session.SessionError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except sweetbook.SweetbookError as e:
            print(f"[customer/order] 오류: {e}", file=sys.stderr)
            return send_json(self, {"error": "주문 처리 중 오류가 발생했습니다."}, 502)
        except Exception as e:  # noqa: BLE001
            print(f"[customer/order] 오류: {e}", file=sys.stderr)
            return send_json(self, {"error": "주문 처리 중 오류가 발생했습니다."}, 500)


def _shipping_fee():
    from _lib import pricing

    return pricing.VENDORS[VENDOR]["shipping_fee"]
