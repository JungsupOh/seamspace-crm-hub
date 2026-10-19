"""
POST /api/print/customer/generate
  {session, volumes:[{from,to,volume}], includeSecret?, amount}
  -> {books:[{volume,from,to,pages}], bookTicket, totalPages}

권을 **한 번에 하나씩** 만드는 관리자용과 달리, 고객용은 권 목록을 통째로 받아
순서대로 만든다. 고객 화면은 진행률만 보면 되고 PDF 파일을 손에 쥘 필요가 없다.

**PDF 다운로드 URL 을 내려주지 않는다.** 고객은 책을 받아 보는 사람이지
인쇄 원고를 가져갈 사람이 아니다. Storage 에는 그대로 올라간다(제작·CS 용).

마지막에 bookTicket 을 발급한다. 이게 없으면 bookUid 를 아는 사람이
남의 책을 주문할 수 있다. 결제 금액도 티켓에 묶어 클라이언트가 못 깎게 한다.

60초 제한 때문에 한 요청에서 만들 수 있는 권수를 제한한다. 본인 주문은
200p × 여러 권이 되는 경우가 드물어 실제로는 거의 1~2권이다.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import bookbuild, mdiary, pricing, session, sweetbook
from _lib.http import read_json, send_json

VENDOR = "sweetbook"
# 한 요청에서 만들 권수 상한. 권당 렌더+업로드가 10~20초라 60초 안에 들어가야 한다.
MAX_VOLUMES = 3


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            sess = session.read_session(body.get("session"))
            username, display_name = sess["username"], sess["name"]

            volumes = body.get("volumes") or []
            if not volumes:
                return send_json(self, {"error": "인쇄 구간을 선택해 주세요."}, 400)
            if len(volumes) > MAX_VOLUMES:
                return send_json(
                    self,
                    {"error": f"한 번에 {MAX_VOLUMES}권까지 만들 수 있습니다. "
                              "구간을 줄여 주세요."},
                    400,
                )
            include_secret = body.get("includeSecret", True) is not False

            made, total_pages = [], 0
            for idx, v in enumerate(volumes, start=1):
                ym_from = (v.get("from") or "").strip()
                ym_to = (v.get("to") or "").strip()
                if not (ym_from and ym_to):
                    return send_json(self, {"error": "인쇄 구간이 올바르지 않습니다."}, 400)

                out = bookbuild.build_volume(
                    sess["token"], username, ym_from, ym_to,
                    include_secret=include_secret,
                    vendor=VENDOR,
                    volume=idx, volume_count=len(volumes),
                    display_name=display_name,
                )
                book = out.get("book") or {}
                if not book.get("bookUid"):
                    return send_json(
                        self, {"error": "제작 준비에 실패했습니다. 잠시 후 다시 시도해 주세요."}, 502
                    )
                total_pages += out["pages"]
                made.append({
                    "volume": idx, "from": ym_from, "to": ym_to,
                    "pages": out["pages"], "blanks": out.get("blanks", 0),
                    "bookUid": book["bookUid"],
                })

            # 금액은 서버가 다시 계산한다 — 화면이 보낸 값을 믿지 않는다.
            price = _price(made)
            ticket = session.make_ticket(
                username,
                [m["bookUid"] for m in made],
                price["totalAmount"],
                [{k: m[k] for k in ("volume", "from", "to", "pages")} for m in made],
            )

            return send_json(self, {
                # bookUid 는 화면에서 쓸 일이 없다. 티켓 안에만 둔다.
                "books": [{k: m[k] for k in ("volume", "from", "to", "pages", "blanks")}
                          for m in made],
                "totalPages": total_pages,
                "bookTicket": ticket,
                # Sandbox 에서는 서버가 결제를 거부한다. 화면이 결제창을 띄우기 전에
                # 알 수 있어야 테스트가 막히지 않는다.
                "paymentEnabled": sweetbook.is_live(),
                **price,
            })
        except session.SessionError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except bookbuild.BuildError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except sweetbook.SweetbookError as e:
            # 스위트북 쪽 실패는 고객에게 원인을 그대로 보여줘도 도움이 안 된다.
            print(f"[customer/generate] 스위트북 실패: {e}", file=sys.stderr)
            return send_json(
                self, {"error": "제작 준비에 실패했습니다. 잠시 후 다시 시도해 주세요."}, 502
            )
        except Exception as e:  # noqa: BLE001
            print(f"[customer/generate] 오류: {e}", file=sys.stderr)
            return send_json(self, {"error": "책 만들기 중 오류가 발생했습니다."}, 500)


def _price(made):
    """실제로 만들어진 페이지 수로 판매가를 다시 계산한다."""
    items, product = [], 0
    for m in made:
        p = pricing.price_for(m["pages"], VENDOR, first=(m["volume"] == 1))
        items.append({"volume": m["volume"], "pages": m["pages"], "price": p})
        product += p or 0
    shipping = pricing.VENDORS[VENDOR]["shipping_fee"]
    return {
        "items": items,
        "productAmount": product,
        "shippingFee": shipping,
        "totalAmount": product + shipping,
    }
