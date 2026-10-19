"""
POST /api/print/customer/preview  {session, from, to, includeSecret?}
  -> {cover, pages:[...], shownPages, truncated:true}

표지(앞면만)와 내지 앞 2페이지를 PNG(data URL)로 돌려준다. 온라인 서점 미리보기처럼
앞부분만 맛보기로 보여주고 나머지는 보여주지 않는다.

**전권을 렌더하지 않는다.** 앞 몇 편만 그려서 2페이지를 뽑는다 —
200페이지짜리를 다 그리면 60초 제한에 걸리고, 어차피 2장만 쓴다.

**Storage 에 올리지 않는다.** 미리보기는 남길 이유가 없다.
"""

import base64
import io
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import bookbuild, cover, mdiary, pricing, session, sweetbook
from _lib.http import read_json, send_json
from _lib.render import render_volume

VENDOR = "sweetbook"
SHOW_PAGES = 2          # 내지에서 보여줄 페이지 수
# 2페이지를 채우려고 그릴 글 수. 한 편이 2페이지로 넘어갈 수 있어 넉넉히 잡는다.
DRAW_ENTRIES = 4
# 72dpi 기준 배율. A5(420pt) × 1.6 ≈ 672px — 글자가 읽히면서 응답이 무겁지 않은 선.
SCALE = 1.6


def _png(pil_image):
    buf = io.BytesIO()
    pil_image.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


class RasterUnavailable(Exception):
    pass


def _render_pdf(pdf_bytes, limit=None, crop_mm=None):
    """PDF 바이트를 PNG data URL 목록으로. crop_mm=(x,y,w,h) 면 그 영역만 자른다."""
    try:
        import pypdfium2 as pdfium
    except ImportError as e:
        # 설치 실패를 '미리보기를 만들지 못했습니다' 로 뭉뚱그리면 원인을 못 찾는다.
        raise RasterUnavailable(f"pypdfium2 를 불러오지 못했습니다: {e}")

    out = []
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        count = len(doc) if limit is None else min(limit, len(doc))
        for i in range(count):
            img = doc[i].render(scale=SCALE).to_pil()
            if crop_mm:
                # mm → px. 렌더 배율과 PDF 좌표(1pt = 1/72in, 1mm = 72/25.4 pt)에서 환산.
                k = SCALE * 72.0 / 25.4
                x, y, w, h = crop_mm
                page_h_mm = img.height / k
                # PIL 은 좌상단 기준, PDF 는 좌하단 기준이라 y 를 뒤집는다
                top = (page_h_mm - y - h) * k
                img = img.crop((round(x * k), round(top), round((x + w) * k), round(top + h * k)))
            out.append(_png(img))
    finally:
        doc.close()
    return out


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json(self)
            sess = session.read_session(body.get("session"))
            username, display_name = sess["username"], sess["name"] or sess["username"]

            ym_from = (body.get("from") or "").strip()
            ym_to = (body.get("to") or "").strip()
            if not (ym_from and ym_to):
                return send_json(self, {"error": "인쇄 구간을 선택해 주세요."}, 400)
            include_secret = body.get("includeSecret", True) is not False
            bookbuild.guard_secret(include_secret)

            entries = mdiary.fetch_all(sess["token"], username)
            selected = bookbuild.select_entries(entries, ym_from, ym_to, include_secret)
            if not selected:
                return send_json(self, {"error": "선택한 구간에 인쇄할 일기가 없습니다."}, 400)

            # ── 내지 앞 2페이지 ──
            buf = io.BytesIO()
            render_volume(
                selected[:DRAW_ENTRIES], buf, include_secret,
                0,                       # 미리보기는 빈 페이지로 채우지 않는다
                pricing.page_size(VENDOR),
            )
            pages = _render_pdf(buf.getvalue(), limit=SHOW_PAGES)

            # ── 표지 앞면 ──
            # 책등 두께가 페이지 수에 따라 달라지므로 실제 인쇄 페이지 수로 치수를 받는다.
            total_pages = pricing.printed_pages(len(selected), VENDOR)
            spec = pricing.VENDORS[VENDOR]["spec"]
            size = sweetbook.calculated_size(spec, total_pages)
            cbuf = io.BytesIO()
            cover.render_cover(
                cbuf, size, display_name,
                bookbuild.ym_label(ym_from), bookbuild.ym_label(ym_to),
                int(body.get("volume") or 1), int(body.get("volumeCount") or 1),
            )
            cover_png = _render_pdf(cbuf.getvalue(), limit=1, crop_mm=cover.front_rect(size))

            return send_json(self, {
                "cover": cover_png[0] if cover_png else None,
                "pages": pages,
                "shownPages": len(pages),
                "totalPages": total_pages,
                # 화면이 "3페이지부터 생략" 안내를 띄우는 근거
                "truncated": total_pages > len(pages),
            })
        except RasterUnavailable as e:
            print(f"[customer/preview] 래스터화 불가: {e}", file=sys.stderr)
            return send_json(
                self,
                {"error": "미리보기 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
                 "code": "RASTER_UNAVAILABLE"},
                503,
            )
        except session.SessionError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except bookbuild.BuildError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except mdiary.MDiaryError as e:
            return send_json(self, {"error": str(e)}, e.status)
        except sweetbook.SweetbookError as e:
            print(f"[customer/preview] 스위트북 치수 조회 실패: {e}", file=sys.stderr)
            return send_json(self, {"error": "미리보기를 만들지 못했습니다."}, 502)
        except Exception as e:  # noqa: BLE001
            print(f"[customer/preview] 오류: {e}", file=sys.stderr)
            return send_json(self, {"error": "미리보기를 만들지 못했습니다."}, 500)
