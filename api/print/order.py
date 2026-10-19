"""
POST /api/print/order
  {action: 'estimate'|'place', bookUids[], shipping{}, paymentKey?, orderId?, amount?}

PDF 생성 단계(generate)에서 권마다 스위트북 책을 FINALIZED 까지 만들어 두었다.
여기서는 그 책들로 금액을 확인하고, 결제 승인 후 실제 주문을 넣는다.

  action=estimate  충전금 차감 예정액 조회
  action=place     스위트북 주문 생성 (결제는 선택)

**결제는 현재 받지 않는다.** 화면에서 배송지·금액을 최종 확인하고 주문만 넣는다.
결제를 다시 붙일 때를 대비해 paymentKey 를 받으면 승인하는 경로는 남겨 두었다.

**Sandbox 에서는 결제를 받지 않는다.** 책이 실제로 만들어지지 않는데 돈만 진짜로
빠져나가는 조합이 제일 나쁘다. 운영 토스 키가 꽂힌 채 Sandbox 를 돌리다 실결제가
일어난 적이 있어 서버에서 막는다 — 화면 조건만으로는 부족하다.

결제 승인은 Supabase Edge Function(confirm-toss)에 맡긴다. TOSS_SECRET_KEY 가 거기에만
있고 되읽을 수 없어서인데, 결제 시크릿을 Vercel 에 한 벌 더 두지 않는 쪽이 낫기도 하다.

**순서가 중요하다.** 결제를 먼저 승인하고 주문을 넣는다. 반대로 하면 주문은 들어갔는데
결제가 실패해 책만 제작되는 일이 생긴다. 반대 방향의 사고(결제는 됐는데 주문 실패)는
환불로 되돌릴 수 있지만, 이미 인쇄된 책은 되돌릴 수 없다.

주문이 실패하면 결제건을 그대로 두고 에러를 돌려준다 — 여기서 자동 취소하지 않는다.
자동 취소가 또 실패하면 상태를 알 수 없게 되므로, 사람이 보고 판단하는 편이 낫다.
응답에 paymentKey 를 실어 보내 수동 처리가 가능하게 한다.

주문이 들어가면 `print_orders` 에 남긴다. 스위트북 웹훅은 orderUid 만 주므로
여기서 수령인·금액·권 구성을 저장해 두지 않으면 알림톡을 보낼 수가 없다.
**저장에 실패해도 주문은 성공으로 응답한다** — 책은 이미 제작에 들어갔고,
여기서 에러를 내면 화면이 '실패'로 보여 같은 주문을 또 넣게 된다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import ordering, sweetbook
from _lib.http import read_json, send_json


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
            missing = ordering.require_shipping(shipping)
            if missing:
                return send_json(self, {"error": f"{', '.join(missing)}을(를) 입력해 주세요."}, 400)

            payment_key = body.get("paymentKey")
            order_id = body.get("orderId")
            amount = body.get("amount")
            live = sweetbook.is_live()

            # Sandbox 는 결제를 받지 않는다. 책이 안 만들어지는데 돈만 빠지는 조합이다.
            if payment_key and not live:
                return send_json(
                    self,
                    {"error": "테스트(Sandbox) 환경에서는 결제를 받지 않습니다."},
                    400,
                )

            payment = None
            if payment_key:
                # 결제를 다시 붙였을 때의 경로. 승인 → 주문 순서를 지킨다.
                if not (order_id and amount):
                    return send_json(self, {"error": "결제 정보가 부족합니다."}, 400)
                try:
                    payment = ordering.toss_confirm(payment_key, order_id, int(amount))
                except Exception as e:  # noqa: BLE001
                    return send_json(self, {"error": f"결제 승인 실패: {e}"}, 402)
            else:
                order_id = order_id or ordering.new_order_ref()

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

            # ③ 주문 내역 저장 — 웹훅이 수령인을 되짚는 유일한 경로다.
            #    실패해도 주문은 성립했으므로 성공으로 응답하고 플래그만 내린다.
            ctx = dict(body.get("context") or {})
            ctx["bookUids"] = book_uids
            saved = True
            try:
                ordering.save_order(order_id, order, shipping, ctx, live)
            except Exception as e:  # noqa: BLE001
                saved = False
                print(f"[order] print_orders 저장 실패 ref={order_id}: {e}", file=sys.stderr)

            return send_json(
                self,
                {
                    "ok": True,
                    "env": "live" if live else "sandbox",
                    "orderRef": order_id,
                    "saved": saved,
                    "order": order,
                    "payment": {
                        "orderId": order_id,
                        "method": payment.get("method") if payment else None,
                        "approvedAt": payment.get("approvedAt") if payment else None,
                        "receiptUrl": payment.get("receiptUrl") if payment else None,
                        "totalAmount": payment.get("totalAmount") if payment else 0,
                        "skipped": payment is None,
                    },
                },
            )
        except sweetbook.SweetbookError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"주문 처리 중 오류: {e}"}, 500)
