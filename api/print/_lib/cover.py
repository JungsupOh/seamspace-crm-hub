"""
표지 PDF 렌더러 — HELLO MY SPACE (A5).

스위트북은 표지를 **펼침면 한 장**으로 받는다. 왼쪽부터 뒤표지 · 책등 · 앞표지가
한 페이지에 나란히 들어가고, 책등 너비가 페이지 수에 따라 달라지므로 캔버스 크기도
권마다 다르다. 치수는 추측하지 않고 `GET /book-specs/{uid}/calculated-size?pages=N`
응답을 그대로 쓴다 — 문서가 "응답값대로 만들면 검증 통과를 보장한다" 고 명시한다.

    전체 너비 = 도련 + 뒤표지(148) + 책등 + 앞표지(148) + 도련
    전체 높이 = 도련 + 210 + 도련

에셋(assets/cover/)은 **재단 크기 148×210mm** 그대로다. 도련이 없으므로 배경색을
캔버스 전체에 먼저 칠하고 그 위에 재단 위치에 얹는다. 배경이 단색이라 이음새가 없다.

가변 영역은 앞표지 3곳 — 이름 / 인쇄구간 시작월 / 종료월.
좌표는 디자인 원본(1.png 실제 예시)에서 픽셀로 재서 mm 로 옮긴 값이다.
템플릿(front.png)은 그 세 자리를 지운 것이고, 여기서 글자만 다시 얹는다.

**뒤표지 왼쪽 아래 35×15mm 는 비어 있어야 한다.** 제작 바코드가 흰 바탕으로 강제
인쇄되어 그 자리를 덮는다(끌 수 없다). back.png 는 로고를 저작권 위로 옮겨
이 영역을 비워 둔 상태이며, 그걸 깨지 않도록 여기서도 아무것도 그리지 않는다.
"""

import os

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .render import asset, ensure_fonts

# ── 디자인 상수 (재단 148×210mm 기준, 좌표는 왼쪽 위에서) ──
TRIM_W = 148.0
TRIM_H = 210.0
BG = colors.Color(69 / 255, 62 / 255, 118 / 255)   # #453E76

FRONT_IMG = "cover/front.png"
BACK_IMG = "cover/back.png"

# 이름 — 가로 중앙, 글자 아랫선(baseline)이 상단에서 132.3mm
NAME_CX = 74.0
NAME_BASELINE = 132.3
NAME_H_MM = 5.8          # 예시의 글자 높이. 이 높이가 나오도록 글자 크기를 잡는다
NAME_MAX_W = 96.0        # 앨범아트 폭 안쪽. 넘치면 줄인다

# 인쇄구간 — 슬라이더 양 끝에 맞춰 좌/우 정렬
DATE_BASELINE = 151.9
DATE_LEFT_X = 37.0
DATE_RIGHT_X = 111.0
DATE_H_MM = 3.0

# 한글 글자 높이 / em 비율. 폰트마다 다르지만 본 폰트에서 실측한 근사값이다.
HANGUL_RATIO = 0.72

FONT = "Freesentation-4Regular"

# 제작 바코드가 덮는 영역 (뒤표지 왼쪽 아래, 재단선 기준)
BARCODE_W = 35.0
BARCODE_H = 15.0

# 책등에 글자를 넣을 수 있는 최소 두께. 이보다 얇으면 제본 오차로 글자가
# 앞/뒤표지로 넘어간다. 50p(3.7mm)도 들어가도록 낮게 잡되, 양옆 0.8mm 는 남긴다.
SPINE_MIN_MM = 3.4
SPINE_SIDE_MARGIN = 0.8
SPINE_MAX_PT = 11.0
SPINE_MIN_PT = 5.5


def _pt_for_height(height_mm):
    """원하는 한글 글자 높이(mm)를 내는 폰트 크기(pt)."""
    return height_mm / HANGUL_RATIO * mm


def _fit(text, size_pt, max_w_mm, min_pt=7.0):
    """max_w 를 넘지 않을 때까지 글자 크기를 줄인다."""
    while size_pt > min_pt and stringWidth(text, FONT, size_pt) > max_w_mm * mm:
        size_pt -= 0.5
    return size_pt


def _draw_bold(c, x_pt, y_pt, text, size_pt, align="center", stroke=0.35):
    """
    디자인 원본의 이름은 굵은 서체인데 보유 폰트에 볼드가 없다.
    외곽선을 얇게 덧그려 굵기를 흉내 낸다(render mode 2 = fill + stroke).
    """
    c.setFont(FONT, size_pt)
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.white)
    c.setLineWidth(stroke)
    t = c.beginText()
    t.setTextRenderMode(2)
    if align == "center":
        x_pt -= stringWidth(text, FONT, size_pt) / 2
    elif align == "right":
        x_pt -= stringWidth(text, FONT, size_pt)
    t.setTextOrigin(x_pt, y_pt)
    t.setFont(FONT, size_pt)
    t.textOut(text)
    c.drawText(t)
    c.setLineWidth(0)


def _inner_w(total_w, spine_w, bleed=3.0):
    """전체 너비에서 내지(재단) 너비를 되짚는다. total = bleed*2 + inner*2 + spine."""
    return (total_w - spine_w - bleed * 2) / 2


def render_cover(out, size, name, ym_from, ym_to, volume=None, volume_count=1):
    """
    표지 PDF 한 장을 그려 out 에 쓴다.

    size:   calculated-size 응답 그대로
    name:   사용자 실제 이름 (앞표지 큰 글씨)
    ym_from/ym_to: '2026년 3월' 같은 표시용 문자열 (인쇄구간)
    volume/volume_count: 분권이면 책등에 '1/2' 를 덧붙인다.
            앞표지는 인쇄구간이 다르므로 그것만으로도 구분되지만,
            책장에 꽂아 두면 책등만 보이므로 거기에는 권 번호를 남긴다.
    """
    ensure_fonts()

    total_w = float(size["coverWidthMm"])
    total_h = float(size["coverHeightMm"])
    spine_w = float(size["spineWidthMm"])
    bleed = (total_h - TRIM_H) / 2
    inner_w = _inner_w(total_w, spine_w, bleed)

    back_x = bleed
    spine_x = bleed + inner_w
    front_x = spine_x + spine_w

    c = canvas.Canvas(out, pagesize=(total_w * mm, total_h * mm))

    # 배경 — 도련까지 가득. 재단이 밀려도 흰 띠가 생기지 않는다.
    c.setFillColor(BG)
    c.rect(0, 0, total_w * mm, total_h * mm, stroke=0, fill=1)

    # 뒤표지 · 앞표지 이미지를 재단 위치에 얹는다
    c.drawImage(asset(BACK_IMG), back_x * mm, bleed * mm,
                width=inner_w * mm, height=TRIM_H * mm, mask=None)
    c.drawImage(asset(FRONT_IMG), front_x * mm, bleed * mm,
                width=inner_w * mm, height=TRIM_H * mm, mask=None)

    # ── 앞표지 가변 텍스트 ──
    # y 는 '상단에서' 잰 값이므로 뒤집는다. 앞표지 왼쪽 끝이 front_x 다.
    def fx(x_mm):
        return (front_x + x_mm) * mm

    def fy(top_mm):
        return (bleed + TRIM_H - top_mm) * mm

    if name:
        size_pt = _fit(name, _pt_for_height(NAME_H_MM), NAME_MAX_W)
        _draw_bold(c, fx(NAME_CX), fy(NAME_BASELINE), name, size_pt)

    date_pt = _pt_for_height(DATE_H_MM)
    c.setFillColor(colors.white)
    if ym_from:
        c.setFont(FONT, date_pt)
        c.drawString(fx(DATE_LEFT_X), fy(DATE_BASELINE), ym_from)
    if ym_to:
        c.setFont(FONT, date_pt)
        c.drawRightString(fx(DATE_RIGHT_X), fy(DATE_BASELINE), ym_to)

    # ── 책등 ──
    spine_text = _spine_text(name, ym_from, ym_to, volume, volume_count)
    if spine_text and spine_w >= SPINE_MIN_MM:
        usable = spine_w - SPINE_SIDE_MARGIN * 2
        sp_pt = min(SPINE_MAX_PT, usable / HANGUL_RATIO * mm)
        if sp_pt >= SPINE_MIN_PT:
            sp_pt = _fit(spine_text, sp_pt, total_h - 24, min_pt=SPINE_MIN_PT)
            c.saveState()
            c.translate((spine_x + spine_w / 2) * mm, (total_h / 2) * mm)
            c.rotate(90)
            c.setFont(FONT, sp_pt)
            c.setFillColor(colors.white)
            c.drawCentredString(0, -sp_pt * 0.36, spine_text)
            c.restoreState()

    c.showPage()
    c.save()
    return {
        "widthMm": total_w,
        "heightMm": total_h,
        "spineWidthMm": spine_w,
        "spineText": spine_text if spine_w >= SPINE_MIN_MM else None,
        "barcodeArea": {"xMm": back_x, "yMm": bleed, "wMm": BARCODE_W, "hMm": BARCODE_H},
    }


def _spine_text(name, ym_from, ym_to, volume, volume_count):
    """
    'HELLO MY SPACE   {이름}   {시작월} - {종료월}'

    실제 제작본이 이 순서다. 구분자는 넣지 않고 공백으로 띄운다(요청).
    분권이면 뒤에 권 번호를 붙인다 — 책장에서는 책등만 보이기 때문이다.
    """
    parts = ["HELLO MY SPACE"]
    if name:
        parts.append(name)
    if ym_from and ym_to:
        parts.append(f"{ym_from} - {ym_to}" if ym_from != ym_to else ym_from)
    text = "     ".join(parts)          # 넉넉한 공백으로 간격을 준다
    if volume and volume_count > 1:
        text += f"     ({volume}/{volume_count})"
    return text

def render_single_pages(out, name, ym_from, ym_to):
    """
    앞표지 · 뒤표지를 각각 한 장씩(단면) 담은 2페이지 PDF.

    뚝딱샵은 표지를 웹 에디터에서 조립한다. 책등 너비는 용지·페이지 수에 따라
    그쪽에서 정하므로 우리가 펼침면을 만들 수 없다. 그래서 재단 크기에 도련을 더한
    낱장 두 개로 내보낸다 — 에디터에 그대로 올릴 수 있고, 인쇄용 도련도 들어 있다.

    도련은 스위트북과 같은 3mm 다 (뚝딱샵 가이드도 좌우상하 각 3mm 를 요구한다).
    """
    ensure_fonts()
    bleed = 3.0
    w = TRIM_W + bleed * 2
    h = TRIM_H + bleed * 2

    c = canvas.Canvas(out, pagesize=(w * mm, h * mm))

    for img, is_front in ((FRONT_IMG, True), (BACK_IMG, False)):
        c.setFillColor(BG)
        c.rect(0, 0, w * mm, h * mm, stroke=0, fill=1)
        c.drawImage(asset(img), bleed * mm, bleed * mm,
                    width=TRIM_W * mm, height=TRIM_H * mm, mask=None)
        if is_front:
            def fx(x_mm):
                return (bleed + x_mm) * mm

            def fy(top_mm):
                return (bleed + TRIM_H - top_mm) * mm

            if name:
                size_pt = _fit(name, _pt_for_height(NAME_H_MM), NAME_MAX_W)
                _draw_bold(c, fx(NAME_CX), fy(NAME_BASELINE), name, size_pt)
            date_pt = _pt_for_height(DATE_H_MM)
            c.setFillColor(colors.white)
            if ym_from:
                c.setFont(FONT, date_pt)
                c.drawString(fx(DATE_LEFT_X), fy(DATE_BASELINE), ym_from)
            if ym_to:
                c.setFont(FONT, date_pt)
                c.drawRightString(fx(DATE_RIGHT_X), fy(DATE_BASELINE), ym_to)
        c.showPage()

    c.save()
    return {"widthMm": w, "heightMm": h, "pages": 2}
