"""
주문 공통 — 관리자용(order.py)과 고객용(customer/order.py)이 공유한다.

토스 승인, 주문번호 발급, print_orders 저장, 배송지 검증.
**결제 승인 → 스위트북 주문 순서**는 두 경로 모두에서 지켜야 한다
(인쇄된 책은 되돌릴 수 없고, 결제는 환불로 되돌릴 수 있다).
"""

import json
import os
import random
import string
from datetime import datetime, timedelta, timezone

import requests


def supabase():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.")
    return url.rstrip("/"), key


def toss_confirm(payment_key, order_id, amount):
    """confirm-toss Edge Function 으로 승인한다. 서비스롤 키로 호출한다."""
    base, key = supabase()
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


KST = timezone(timedelta(hours=9))


def new_order_ref():
    """우리 주문번호. 고객에게 읽히는 값이라 타임스탬프 대신 날짜+난수로 만든다."""
    day = datetime.now(KST).strftime("%y%m%d")
    tail = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"MD{day}-{tail}"


def save_order(order_ref, order, shipping, ctx, live):
    """
    주문 내역을 print_orders 에 남긴다. 실패해도 예외를 올리지 않는다 —
    호출부에서 주문 성공 응답을 막으면 안 되기 때문이다.
    """
    base, key = supabase()
    volumes = ctx.get("volumes") or []
    row = {
        "order_ref": order_ref,
        "vendor": ctx.get("vendor") or "sweetbook",
        "vendor_env": "live" if live else "sandbox",
        "vendor_order_uid": (order or {}).get("orderUid"),
        "diary_username": ctx.get("username") or "",
        "diary_name": ctx.get("name"),
        "recipient_name": shipping.get("recipientName", ""),
        "recipient_phone": shipping.get("recipientPhone", ""),
        "postal_code": shipping.get("postalCode"),
        "address1": shipping.get("address1"),
        "address2": shipping.get("address2") or None,
        "shipping_memo": shipping.get("memo") or None,
        "volumes": volumes,
        "include_secret": bool(ctx.get("includeSecret", True)),
        "book_uids": ctx.get("bookUids") or [],
        "product_amount": int(ctx.get("productAmount") or 0),
        "shipping_fee": int(ctx.get("shippingFee") or 0),
        "total_amount": int(ctx.get("totalAmount") or 0),
        "vendor_cost": (order or {}).get("totalAmount"),
        "status": (order or {}).get("orderStatus") or "ORDERED",
        "ordered_at": datetime.now(timezone.utc).isoformat(),
    }
    res = requests.post(
        f"{base}/rest/v1/print_orders",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        data=json.dumps(row),
        timeout=20,
    )
    if not res.ok:
        raise RuntimeError(f"HTTP {res.status_code}: {res.text[:300]}")


def require_shipping(shipping):
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
