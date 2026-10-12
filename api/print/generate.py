"""
POST /api/print/generate
  {token, username, from, to, includeSecret?, vendor?, volume?, volumeCount?, name?}

본문(내지)과 표지를 각각 PDF 로 만들어 둘 다 내려준다. 업체마다 올리는 방식이 달라서
(스위트북은 API 업로드, 뚝딱샵은 웹 에디터에 직접 올림) 파일로 받을 수 있어야 한다.
  -> {name, url, pages, bytes, skipped}

한 번에 한 권씩 만든다. 여러 권이면 화면이 이 엔드포인트를 순서대로 호출한다 —
요청 하나가 길어져 타임아웃에 걸리는 걸 피하고, 진행 상황도 보여줄 수 있다.
"""

import io
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib import cover, mdiary, pricing, secret, storage, sweetbook
from _lib.http import read_json, send_json
from _lib.render import is_renderable, parse_api_date, render_volume


def _ym_label(ym):
    """'2026-03' -> '2026년 3월' — 표지 표기용."""
    year, month = ym.split("-")
    return f"{year}년 {int(month)}월"


def _make_cover(vendor, spec, pages, display_name, ym_from, ym_to, volume, volume_count):
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
            _ym_label(ym_from), _ym_label(ym_to), volume, volume_count,
        )
        return buf.getvalue(), {
            "layout": "spread",
            "widthMm": info["widthMm"],
            "heightMm": info["heightMm"],
            "spineWidthMm": info["spineWidthMm"],
            "spineText": info["spineText"],
        }

    info = cover.render_single_pages(
        buf, display_name, _ym_label(ym_from), _ym_label(ym_to),
        trim=pricing.trim_size(vendor),
    )
    return buf.getvalue(), {
        "layout": "pages",
        "widthMm": info["widthMm"],
        "heightMm": info["heightMm"],
        "spineWidthMm": None,
        "spineText": None,
    }


def _make_book(spec, contents_pdf, cover_pdf, pages, username, display_name,
               ym_from, ym_to, stamp):
    """
    스위트북에 책 하나를 올려 FINALIZED 까지 만든다.

    표지 치수는 calculated-size 응답을 그대로 쓴다. 직접 계산하면 책등 너비 규칙이
    판형마다 달라 틀리기 쉽고, 틀리면 업로드가 거부되거나 잘못된 크기로 인쇄된다.

    멱등 키에 stamp 를 넣는다. 같은 구간을 다시 만들면 새 책이 되는 게 맞다 —
    표지 이름이나 비밀글 포함 여부가 달라졌을 수 있기 때문이다.
    """
    ref = f"PRINT-{username}-{ym_from}-{ym_to}-{stamp}"
    title = f"{display_name} {_ym_label(ym_from)}~{_ym_label(ym_to)}"
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


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            token = body.get("token")
            username = (body.get("username") or "").strip()
            ym_from = (body.get("from") or "").strip()
            ym_to = (body.get("to") or "").strip()
            # 기본은 포함. 사용자가 끄면 비밀글을 빼고 만든다.
            include_secret = body.get("includeSecret", True) is not False
            vendor = pricing.resolve_vendor(body.get("vendor"))
            volume = int(body.get("volume") or 1)
            volume_count = int(body.get("volumeCount") or 1)
            display_name = (body.get("name") or "").strip() or username

            if not token:
                return send_json(self, {"error": "로그인이 필요합니다."}, 401)
            if not (username and ym_from and ym_to):
                return send_json(self, {"error": "사용자와 인쇄 구간이 필요합니다."}, 400)
            # 제외를 요청했는데 비밀글을 가려낼 수 없으면 여기서 멈춘다.
            # 그냥 만들면 '제외'를 고른 사용자의 비밀글이 그대로 인쇄되고,
            # 배송까지 끝나면 되돌릴 방법이 없다.
            if not include_secret and not secret.detectable():
                return send_json(
                    self,
                    {
                        "error": "비밀글을 가려낼 수 없어 제외하고 만들 수 없습니다. "
                        "MDIARY_SECRET_FIELD 환경변수를 설정해 주세요."
                    },
                    409,
                )

            entries = mdiary.fetch_all(token, username)
            selected = [
                e
                for e in entries
                if is_renderable(e, include_secret)
                and ym_from <= parse_api_date(e["date"]).strftime("%Y-%m") <= ym_to
            ]
            if not selected:
                return send_json(
                    self, {"error": "선택한 구간에 인쇄할 일기가 없습니다."}, 400
                )

            # 업체의 페이지 규칙(최소 페이지·짝수)에 맞춰 빈 페이지를 채운다.
            # 견적이 매긴 인쇄 페이지 수와 실제 PDF 가 달라지면 업로드가 거부되거나
            # 견적 금액과 실물이 어긋난다.
            pad_to = pricing.printed_pages(len(selected), vendor)
            buf = io.BytesIO()
            result = render_volume(
                selected, buf, include_secret, pad_to, pricing.page_size(vendor),
            )
            data = buf.getvalue()

            stamp = datetime.now().strftime("%Y%m%d%H%M%S")
            name = f"{ym_from}_{ym_to}_{username}.pdf"
            url = storage.upload_pdf(f"{username}/{stamp}_{name}", data)

            out = {
                "name": name,
                "url": url,
                "vendor": vendor,
                "pages": result["pages"],
                "blanks": result.get("blanks", 0),
                "bytes": len(data),
                "skipped": result["skipped"],
            }

            # 표지 — 업체와 무관하게 항상 만들어 내려준다.
            # 스위트북은 API 로 올리지만 뚝딱샵은 사람이 웹 에디터에 올려야 해서
            # 파일을 손에 쥘 수 있어야 한다.
            spec = pricing.VENDORS[vendor]["spec"]
            cover_pdf, cover_info = _make_cover(
                vendor, spec, result["pages"], display_name,
                ym_from, ym_to, volume, volume_count,
            )
            cover_name = f"{ym_from}_{ym_to}_{username}_표지.pdf"
            out["cover"] = {
                "name": cover_name,
                "url": storage.upload_pdf(f"{username}/{stamp}_{cover_name}", cover_pdf),
                "bytes": len(cover_pdf),
                **cover_info,
            }

            # 스위트북이면 이 자리에서 책까지 만들어 둔다 — 업로드 → 최종화.
            # 주문 단계에서 몰아 하면 권수만큼 렌더·업로드가 한 요청에 쌓여 60초 상한에
            # 걸린다. 권당 한 번씩 나눠 두면 진행 상황도 보여줄 수 있다.
            if spec:
                out["book"] = _make_book(
                    spec, data, cover_pdf, result["pages"], username, display_name,
                    ym_from, ym_to, stamp,
                )

            return send_json(self, out)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except sweetbook.SweetbookError as e:
            # PDF 는 이미 만들어졌다. 스위트북 쪽만 실패했음을 구분해서 알려준다.
            return send_json(self, {"error": str(e)}, e.status)
        except Exception as e:  # noqa: BLE001
            return send_json(self, {"error": f"PDF 생성 중 오류: {e}"}, 500)
