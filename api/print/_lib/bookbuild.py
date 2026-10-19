"""
한 권 만들기 — 관리자용(/api/print/generate)과 고객용(customer/generate)이 공유한다.

원래 generate.py 안에 있던 것을 꺼냈다. **대상 username 을 누가 정하느냐**와
**결과를 누구에게 보여주느냐**만 다르고, 만드는 과정은 같다.
"""

import io
from datetime import datetime

from . import cover, mdiary, pricing, secret, storage, sweetbook
from .render import is_renderable, parse_api_date, render_volume


class BuildError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def ym_label(ym):
    """'2026-03' -> '2026년 3월' — 표지 표기용."""
    year, month = ym.split("-")
    return f"{year}년 {int(month)}월"


def make_cover(vendor, spec, pages, display_name, ym_from, ym_to, volume, volume_count):
    """
    표지 PDF 를 만들어 (바이트, 메타) 로 돌려준다.

    스위트북은 치수를 calculated-size 로 받아 펼침면 한 장을 만든다 — 책등 너비가
    페이지 수마다 달라 직접 계산하면 틀리기 쉽다.
    뚝딱샵은 표지를 웹 에디터에서 조립하므로 책등 너비를 우리가 알 수 없다. 그래서
    앞표지·뒤표지를 각각 한 장씩(단면) 만들어 둔다 — 에디터에 그대로 올릴 수 있다.
    """
    buf = io.BytesIO()
    if spec:
        size = sweetbook.calculated_size(spec, pages)
        info = cover.render_cover(
            buf, size, display_name,
            ym_label(ym_from), ym_label(ym_to), volume, volume_count,
        )
        return buf.getvalue(), {
            "layout": "spread",
            "widthMm": info["widthMm"],
            "heightMm": info["heightMm"],
            "spineWidthMm": info["spineWidthMm"],
            "spineText": info["spineText"],
        }

    info = cover.render_single_pages(
        buf, display_name, ym_label(ym_from), ym_label(ym_to),
        trim=pricing.trim_size(vendor),
    )
    return buf.getvalue(), {
        "layout": "pages",
        "widthMm": info["widthMm"],
        "heightMm": info["heightMm"],
        "spineWidthMm": None,
        "spineText": None,
    }


def make_book(spec, contents_pdf, cover_pdf, pages, username, display_name,
              ym_from, ym_to, stamp):
    """
    스위트북에 책 하나를 올려 FINALIZED 까지 만든다.

    멱등 키에 stamp 를 넣는다. 같은 구간을 다시 만들면 새 책이 되는 게 맞다 —
    표지 이름이나 비밀글 포함 여부가 달라졌을 수 있기 때문이다.
    """
    ref = f"PRINT-{username}-{ym_from}-{ym_to}-{stamp}"
    title = f"{display_name} {ym_label(ym_from)}~{ym_label(ym_to)}"
    book = sweetbook.create_book(spec, title, pages, ref, idempotency_key=ref)
    uid = book["bookUid"]

    sweetbook.upload_pdf(uid, "cover", cover_pdf)
    sweetbook.upload_pdf(uid, "contents", contents_pdf)
    sweetbook.finalize(uid)

    return {
        "bookUid": uid,
        "spec": spec,
        "env": "live" if sweetbook.is_live() else "sandbox",
        "title": title,
        "externalRef": ref,
    }


def select_entries(entries, ym_from, ym_to, include_secret):
    """인쇄 구간에 들어가고 실제로 그릴 수 있는 글만 고른다."""
    return [
        e
        for e in entries
        if is_renderable(e, include_secret)
        and ym_from <= parse_api_date(e["date"]).strftime("%Y-%m") <= ym_to
    ]


def guard_secret(include_secret):
    """
    제외를 요청했는데 비밀글을 가려낼 수 없으면 만들지 않는다.

    그냥 만들면 '제외'를 고른 사용자의 비밀글이 그대로 인쇄되고,
    배송까지 끝나면 되돌릴 방법이 없다.
    """
    if not include_secret and not secret.detectable():
        raise BuildError(
            "비밀글을 가려낼 수 없어 제외하고 만들 수 없습니다. "
            "MDIARY_SECRET_FIELD 환경변수를 설정해 주세요.",
            status=409,
        )


def build_volume(token, username, ym_from, ym_to, *, include_secret=True,
                 vendor=None, volume=1, volume_count=1, display_name=None,
                 make_sweetbook_book=True):
    """
    한 권을 만들어 내지·표지 PDF 를 Storage 에 올리고, 스위트북이면 책까지 등록한다.

    make_sweetbook_book=False 면 PDF 만 만들고 스위트북에는 올리지 않는다.
    """
    vendor = pricing.resolve_vendor(vendor)
    display_name = (display_name or "").strip() or username
    guard_secret(include_secret)

    entries = mdiary.fetch_all(token, username)
    selected = select_entries(entries, ym_from, ym_to, include_secret)
    if not selected:
        raise BuildError("선택한 구간에 인쇄할 일기가 없습니다.")

    # 업체의 페이지 규칙(최소 페이지·짝수)에 맞춰 빈 페이지를 채운다.
    # 견적이 매긴 인쇄 페이지 수와 실제 PDF 가 달라지면 업로드가 거부되거나
    # 견적 금액과 실물이 어긋난다.
    pad_to = pricing.printed_pages(len(selected), vendor)
    buf = io.BytesIO()
    result = render_volume(selected, buf, include_secret, pad_to, pricing.page_size(vendor))
    data = buf.getvalue()

    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    name = f"{ym_from}_{ym_to}_{username}_inner.pdf"
    out = {
        "name": name,
        "url": storage.upload_pdf(f"{username}/{stamp}_{name}", data),
        "vendor": vendor,
        "pages": result["pages"],
        "blanks": result.get("blanks", 0),
        "bytes": len(data),
        "skipped": result["skipped"],
    }

    # 표지 — 업체와 무관하게 항상 만들어 내려준다.
    spec = pricing.VENDORS[vendor]["spec"]
    cover_pdf, cover_info = make_cover(
        vendor, spec, result["pages"], display_name, ym_from, ym_to, volume, volume_count,
    )
    # 파일명은 전부 영문으로 둔다. Supabase Storage 는 객체 키에 한글을 받지 않고
    # (InvalidKey) 키가 URL 경로로도 들어가므로, 이름과 키를 같게 유지하는 쪽이 낫다.
    cover_name = f"{ym_from}_{ym_to}_{username}_cover.pdf"
    out["cover"] = {
        "name": cover_name,
        "url": storage.upload_pdf(f"{username}/{stamp}_{cover_name}", cover_pdf),
        "bytes": len(cover_pdf),
        **cover_info,
    }

    # 스위트북이면 이 자리에서 책까지 만들어 둔다 — 업로드 → 최종화.
    # 주문 단계에서 몰아 하면 권수만큼 렌더·업로드가 한 요청에 쌓여 60초 상한에
    # 걸린다. 권당 한 번씩 나눠 두면 진행 상황도 보여줄 수 있다.
    if spec and make_sweetbook_book:
        out["book"] = make_book(
            spec, data, cover_pdf, result["pages"], username, display_name,
            ym_from, ym_to, stamp,
        )
    return out
