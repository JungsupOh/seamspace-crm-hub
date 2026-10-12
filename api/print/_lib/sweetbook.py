"""
스위트북 Book Print API 클라이언트.

PDF 업로드 방식(creationType=PDF_UPLOAD)만 쓴다. 템플릿 방식은 우리 렌더러가
이미 최종 레이아웃을 만들고 있어 필요 없다.

한 권의 흐름

    create_book()      책 생성 (DRAFT)
    upload_pdf(cover)  표지 — 펼침면 1페이지
    upload_pdf(contents) 내지 — book.pageCount 와 **정확히 일치**해야 한다
    finalize()         FINALIZED. 이걸 빠뜨리면 주문이 400 으로 막힌다
    ──── 여기까지가 generate 단계 ────
    estimate()         금액 확인 (FINALIZED 상태의 bookUid 필요)
    create_order()     주문. 선불 충전금에서 즉시 차감되고 잔액이 모자라면 402

환경
    SWEETBOOK_API_KEY   필수. 없으면 아무 호출도 하지 않는다
    SWEETBOOK_ENV       'sandbox'(기본) | 'live'
                        운영 전환은 이 값 하나로 한다. 기본을 sandbox 로 둔 건
                        실수로 실제 충전금이 빠져나가는 쪽이 되돌리기 어렵기 때문이다.

멱등성: 책 생성과 주문 생성은 Idempotency-Key 를 지원한다. 네트워크 오류로 재시도할 때
책이나 주문이 두 번 만들어지면 돈이 두 번 나가므로 반드시 넣는다.
"""

import json
import os

import requests

TIMEOUT = 60
SANDBOX = "https://api-sandbox.sweetbook.com/v1"
LIVE = "https://api.sweetbook.com/v1"


class SweetbookError(Exception):
    def __init__(self, message, status=502, data=None):
        super().__init__(message)
        self.status = status
        self.data = data or {}


def is_live():
    return (os.environ.get("SWEETBOOK_ENV") or "sandbox").strip().lower() == "live"


def base_url():
    return LIVE if is_live() else SANDBOX


def _key():
    key = (os.environ.get("SWEETBOOK_API_KEY") or "").strip()
    if not key:
        raise SweetbookError(
            "SWEETBOOK_API_KEY 환경변수가 없습니다. 스위트북 주문을 보낼 수 없습니다.",
            status=503,
        )
    return key


def _headers(extra=None):
    h = {"Authorization": f"Bearer {_key()}"}
    if extra:
        h.update(extra)
    return h


def _call(method, path, **kw):
    url = f"{base_url()}{path}"
    try:
        res = requests.request(method, url, timeout=TIMEOUT, **kw)
    except requests.RequestException as e:
        raise SweetbookError(f"스위트북 연결 실패: {e}")

    try:
        data = res.json()
    except ValueError:
        raise SweetbookError(f"스위트북 응답을 읽지 못했습니다 (HTTP {res.status_code})")

    if not res.ok or data.get("success") is False:
        errs = data.get("errors") or []
        msg = data.get("message") or f"HTTP {res.status_code}"
        detail = f"{msg}: {'; '.join(str(e) for e in errs)}" if errs else msg
        raise SweetbookError(f"스위트북 요청 실패 — {detail}", status=res.status_code, data=data)
    return data.get("data")


# ── 판형 ────────────────────────────────────────────
def calculated_size(spec_uid, pages):
    """
    표지·내지 PDF 캔버스 치수. 이 응답값대로 만들면 업로드 검증이 보장된다.
    치수를 직접 계산하지 않는 이유 — 책등 너비 규칙이 판형마다 다르고,
    틀리면 업로드가 거부되거나(운 나쁘면) 잘못된 크기로 인쇄된다.
    """
    return _call("GET", f"/book-specs/{spec_uid}/calculated-size", headers=_headers(),
                 params={"pages": pages})


def book_specs():
    return _call("GET", "/book-specs", headers=_headers())


def credits():
    return _call("GET", "/credits", headers=_headers())


# ── 책 ──────────────────────────────────────────────
def create_book(spec_uid, title, page_count, external_ref=None, idempotency_key=None):
    body = {
        "title": title[:255],
        "bookSpecUid": spec_uid,
        "creationType": "PDF_UPLOAD",
        "pageCount": page_count,
    }
    if external_ref:
        body["externalRef"] = external_ref[:100]
    extra = {"Content-Type": "application/json"}
    if idempotency_key:
        extra["Idempotency-Key"] = idempotency_key
    return _call("POST", "/books", headers=_headers(extra), data=json.dumps(body))


def upload_pdf(book_uid, kind, data, replace=False):
    """
    kind: 'cover' | 'contents'

    POST 는 신규 등록 전용(이미 있으면 409), PUT 은 교체 전용(없으면 404).
    재시도 상황을 생각하면 섞어 쓰기 쉬운데, 여기서는 호출자가 명시하게 둔다.
    """
    path = f"/books/{book_uid}/pdf-{'cover' if kind == 'cover' else 'contents'}"
    method = "PUT" if replace else "POST"
    files = {"file": (f"{kind}.pdf", data, "application/pdf")}
    return _call(method, path, headers=_headers(), files=files)


def finalize(book_uid):
    """
    표지·내지를 다 올린 뒤 호출해야 FINALIZED 가 된다.
    빠뜨리면 주문이 400 ERR_FINALIZE_PREREQ_UNMET 으로 막힌다. 재호출은 멱등이다.
    """
    return _call("POST", f"/books/{book_uid}/finalization",
                 headers=_headers({"Content-Length": "0"}))


# ── 주문 ────────────────────────────────────────────
def estimate(book_uids):
    """금액 확인. FINALIZED 상태의 책만 받는다. 잔액 부족이어도 200 + creditSufficient=false."""
    body = {"items": [{"bookUid": b, "quantity": 1} for b in book_uids]}
    return _call("POST", "/orders/estimate",
                 headers=_headers({"Content-Type": "application/json"}), data=json.dumps(body))


def create_order(book_uids, shipping, external_ref=None, idempotency_key=None):
    """
    주문 생성. 충전금이 즉시 차감되고 모자라면 402 가 난다.

    shipping: {recipientName, recipientPhone, postalCode, address1, address2?, memo?}
    """
    body = {
        "items": [{"bookUid": b, "quantity": 1} for b in book_uids],
        "shipping": {
            "recipientName": shipping.get("recipientName", ""),
            "recipientPhone": shipping.get("recipientPhone", ""),
            "postalCode": shipping.get("postalCode", ""),
            "address1": shipping.get("address1", ""),
            "address2": shipping.get("address2", "") or "",
            "memo": shipping.get("memo", "") or "",
        },
    }
    if external_ref:
        body["externalRef"] = external_ref[:100]
    extra = {"Content-Type": "application/json"}
    if idempotency_key:
        extra["Idempotency-Key"] = idempotency_key
    return _call("POST", "/orders", headers=_headers(extra), data=json.dumps(body))


def get_order(order_uid):
    return _call("GET", f"/orders/{order_uid}", headers=_headers())
