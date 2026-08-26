"""
마음일기 인쇄용 PDF 렌더러 (154 x 216 mm).

mDiary_report/reportsD.py 를 서버리스에서 호출 가능한 형태로 옮긴 것이다.
좌표·색상·폰트 크기는 인쇄 템플릿에 맞춰 손으로 맞춰진 값이라 원본 그대로 둔다.
바꾼 것은 실행 구조뿐이며, 바꾼 이유는 다음과 같다:

  1) 한 캔버스에 이어 그린다.
     원본은 일기 1개마다 캔버스를 새로 만들어 temp/ 에 저장하고 PyPDF2 로 합쳤다.
     그러면 배경 PNG(50KB)가 페이지마다 새로 임베드되어 300페이지짜리가 15MB를 넘는다.
     한 캔버스에서 showPage() 로 넘기면 reportlab 이 같은 파일명 이미지를 한 번만
     저장하므로, 배경 3종 + 삽화 + 에모티콘이 페이지 수와 무관하게 한 벌만 들어간다.
     덤으로 temp/·diary/ 디렉토리와 PyPDF2 의존이 통째로 없어지고,
     "연간 합본이 월별 파일로 흩어지던" 원본 버그(reportsD.py:569-570)도 사라진다.

  2) 에셋 경로를 __file__ 기준으로 해석한다. 원본은 전부 상대 경로라
     CWD 가 repo 루트일 때만 동작했다. 서버리스에서는 CWD 가 다르다.

  3) 글자 축소 루프에 하한을 뒀다. 원본은 하한이 없는데 leading 은 고정이라,
     아주 긴 일기에서 fontSize 만 줄다가 높이가 더 안 줄면 무한 루프였다.
     로컬에선 그냥 멈추지만 서버리스에선 타임아웃까지 과금된다.

  4) 사용자 텍스트를 이스케이프한다. Paragraph 는 미니 HTML 을 파싱하므로
     일기 본문에 < 나 & 가 있으면 깨지거나 예외가 났다.

  5) 삽화 교대 상태를 전역이 아니라 인자로 주고받는다. 전역이면 동시 요청끼리 섞인다.
"""

import os
import re
from datetime import datetime

from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame, KeepInFrame, Paragraph

from .emoji import to_markup
from .emotions import EMOTION_ICONS

# ─── 에셋 ──────────────────────────────────────────────────────────────────
_ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def asset(rel_path):
    """'emoticons/1-1.png' 같은 원본 표기를 실제 파일 경로로 바꾼다."""
    return os.path.join(_ASSETS, rel_path)


# 원본이 등록하던 5개 중 NotoColorEmoji 는 setFont/fontName 어디에서도 쓰이지 않아 뺐다.
# (23MB짜리라 번들에서 빼면 배포 용량이 41MB → 18.6MB 로 줄어든다)
_FONTS = {
    "MaruBuri-Bold": "fonts/MaruBuri-Bold.ttf",
    "Freesentation-4Regular": "fonts/Freesentation-4Regular.ttf",
    "Geurimilgi": "fonts/Geurimilgi.ttf",
    "EduSeaum": "fonts/EduSeaum.ttf",
}

_fonts_ready = False


def ensure_fonts():
    """폰트를 한 번만 등록한다. 원본은 import 시점에 등록해서 CWD 에 묶여 있었다."""
    global _fonts_ready
    if _fonts_ready:
        return
    for name, rel in _FONTS.items():
        pdfmetrics.registerFont(TTFont(name, asset(rel)))
    _fonts_ready = True


# ─── 페이지 규격 ────────────────────────────────────────────────────────────
PAGE_SIZE = (154 * mm, 216 * mm)

# 신호등별 배경·글자색·표기. 원본 292-309줄.
TRAFFIC = {
    "GREEN": {"bg": "bgImage/bgDayGoodAll.png", "color": "#648A61", "label": "초록불"},
    "YELLOW": {"bg": "bgImage/bgDaySosoAll.png", "color": "#7A6A56", "label": "노란불"},
    "RED": {"bg": "bgImage/bgDayBadAll.png", "color": "#E89996", "label": "빨간불"},
}

# 반 페이지 레이아웃일 때 넣는 삽화. 신호등마다 두 장을 번갈아 쓴다.
# (이미지, x보정, y보정, 폭배수, 높이) — 원본 504-521줄의 값을 그대로 옮겼다.
ILLUSTRATIONS = {
    "YELLOW": [
        ("bgImage/seamsInDiary.png", 0, 0, 60 * 2.7, 40.846 * 2.7),
        ("bgImage/seamWithDissert.png", 0, 0, 60 * 2.7, 39.714 * 2.7),
    ],
    "GREEN": [
        ("bgImage/seamsInLibrary.png", 0, 0, 60 * 2.7, 38.884 * 2.7),
        ("bgImage/seamInSofa.png", 0, 0, 60 * 2.7, 36.892 * 2.7),
    ],
    "RED": [
        ("bgImage/seamInGarden.png", 12, -3, 60 * 2.7, 35.807 * 2.7),
        ("bgImage/seamsInBusStop.png", -23, -8, 70 * 2.7, 37.718 * 2.7),
    ],
}

# 줄간격. 원본은 글자 크기가 줄어도 leading 을 12pt 로 고정해 뒀는데, 그러면
# 축소 루프가 높이를 거의 못 줄인다(leading 이 높이를 지배한다). 그래서 애초에
# 줄간격을 빡빡하게 잡을 수밖에 없었다. 글자 크기에 비례시키면 넉넉하게 주면서도
# 넘칠 때 확실히 줄어든다.
LEADING = {
    "topic": 1.25,   # 원본 12/11 = 1.09
    "body":  1.45,   # 원본 12/10 = 1.20
    "talk":  1.35,   # 원본 11/11 = 1.00 — 가장 빡빡했다
}

# 글자 축소가 멈추는 하한. 여기 도달하면 더 줄이지 않고 프레임이 넘치는 만큼 잘라낸다
# (Frame.addFromList 는 안 들어가는 flowable 을 버린다 — 원본과 같은 동작).
MIN_FONT_SIZE = 6.0

_WEEKDAYS_KOR = ["월", "화", "수", "목", "금", "토", "일"]


def hex_to_rgb(hex_code):
    """'#a691c4' → (0.65, 0.57, 0.77)"""
    hex_code = hex_code.lstrip("#")
    if len(hex_code) != 6:
        raise ValueError("hex 코드 형식이 올바르지 않습니다 (예: '#a691c4')")
    return (
        int(hex_code[0:2], 16) / 255.0,
        int(hex_code[2:4], 16) / 255.0,
        int(hex_code[4:6], 16) / 255.0,
    )


def parse_api_date(value):
    """
    일기의 date 값을 파싱한다. 운영 API 는 형식이 섞여 나온다:
      '2024-02-01T05:01:50Z', '2024-02-01T05:01:50.123Z', '2024-11-22 17:55:17'

    반환은 항상 tz 없는(naive) datetime 이다. 원본이 strptime('...Z') 로 파싱해
    UTC 표기를 그대로 벽시계로 취급했고, 지금까지 인쇄된 책이 전부 그 기준이라
    같은 동작을 유지한다. 여기서 KST 로 변환하면 자정 근처 일기의 날짜가
    하루씩 밀려 기존 결과물과 달라진다.
    """
    s = (value or "").strip()
    if s.endswith("Z"):
        s = s[:-1]
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    # 마지막 수단: '+09:00' 같은 오프셋이 붙은 경우
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None)
    except ValueError:
        raise ValueError(f"날짜 형식을 알 수 없습니다: {value!r}")


def is_renderable(diary):
    """
    이 일기가 실제로 한 페이지를 만들어내는지.

    traffic 이 셋 중 하나가 아니면 원본은 조용히 return 해서 페이지가 안 생겼다.
    그대로 두면 '100페이지로 견적 → 98페이지로 인쇄' 가 되므로,
    견적(stats)과 렌더가 반드시 이 같은 함수로 페이지 수를 센다.
    """
    if diary.get("traffic") not in TRAFFIC:
        return False
    try:
        parse_api_date(diary.get("date"))
    except ValueError:
        return False
    return True


# Frame 의 기본 안쪽 여백. 실제로 글이 들어갈 수 있는 크기는 프레임에서 이만큼 작다.
FRAME_PADDING = 6


def avail(frame_w, frame_h):
    """프레임에서 여백을 뺀, 글이 실제로 놓일 수 있는 크기."""
    return frame_w - 2 * FRAME_PADDING, frame_h - 2 * FRAME_PADDING


def _fit(raw_text, style_of, frame_w, frame_h, limit, start_size):
    """
    프레임에 맞을 때까지 글자를 0.5pt 씩 줄이고, 그래도 넘치면 잘리지 않게 감싼다.

    원본과 다른 점:
      - MIN_FONT_SIZE 하한. 원본은 탈출 조건이 없어 무한 루프가 가능했다.
      - 크기마다 마크업을 다시 만든다. 이모지를 글자 크기에 맞춰 줄여야 하기 때문이다.
      - 프레임 여백을 빼고 잰다. 원본은 프레임 크기 그대로 재서, 토닥토닥은
        높이 75pt 까지 통과시키는데 실제 공간은 68pt 뿐이었다. 그 사이에 걸린 글은
        Frame.addFromList 가 조용히 버려서 문장 끝이 사라졌다.
      - 하한까지 줄여도 안 들어가면 KeepInFrame 으로 통째로 축소해 넣는다.
        원본은 이 경우에도 그냥 버렸다.

    limit 은 디자인상의 상한이다(예: 주제는 두 줄까지). 실제 공간보다 클 수는 없다.
    """
    avail_w, avail_h = avail(frame_w, frame_h)
    limit = min(limit, avail_h)

    size = start_size
    para = Paragraph(to_markup(raw_text, size), style_of(size))
    _, h = para.wrap(avail_w, avail_h)
    while h >= limit and size > MIN_FONT_SIZE:
        size -= 0.5
        para = Paragraph(to_markup(raw_text, size), style_of(size))
        _, h = para.wrap(avail_w, avail_h)

    if h >= limit:
        # 최소 크기로도 넘친다 — 통째로 축소해 프레임 안에 우겨넣는다.
        return KeepInFrame(avail_w, avail_h, [para], mode="shrink")
    return para


def draw_diary_page(c, diary, alt_state):
    """
    캔버스 c 의 현재 페이지에 일기 한 편을 그린다.

    페이지 넘김(showPage)과 저장(save)은 호출자가 한다 — 그래야 한 문서 안에서
    이미지가 재사용된다. alt_state 는 신호등별 삽화 교대 인덱스를 담은 dict 로,
    호출자가 들고 다니며 넘긴다(원본은 전역이라 동시 요청에서 섞였다).

    반환: 그렸으면 True, 렌더 불가라 건너뛰었으면 False.
    """
    if not is_renderable(diary):
        return False

    theme = TRAFFIC[diary["traffic"]]
    text_color = theme["color"]
    traffic_name = theme["label"]

    date_obj = parse_api_date(diary["date"])
    weekday_kor = _WEEKDAYS_KOR[date_obj.weekday()]
    day_str = date_obj.strftime("%d")
    month_str = date_obj.strftime("%Y.%m")

    width, height = PAGE_SIZE

    # ── 1. 배경 이미지 ──────────────────────────────────────────────────
    c.drawImage(asset(theme["bg"]), 0, 0, width=width, height=height)

    # ── 2. 날짜 + 요일 하이라이트 ────────────────────────────────────────
    t_color = "#7A6A56" if diary["traffic"] == "YELLOW" else "#FCFBF7"
    r, g, b = hex_to_rgb(t_color)

    c.setFont("MaruBuri-Bold", 15)
    c.setFillColorRGB(r, g, b)
    c.drawString(47, 576, f"{month_str}.{day_str}")

    c.saveState()
    c.setFillColorRGB(1, 1, 1)
    if diary["traffic"] == "YELLOW":
        c.setFillColorRGB(r, g, b)
    c.setFillAlpha(0.2)
    # 일요일(weekday()==6)만 -1 로 옮겨 월요일 왼쪽 칸에 오게 한다.
    weekday_num = date_obj.weekday()
    custom_weekday = -1 if weekday_num == 6 else weekday_num
    c.rect(304.5 + 15.7 * custom_weekday, 567.3, 15, 18.8, fill=1, stroke=0)
    c.restoreState()

    # ── 3. 감정 아이콘 ──────────────────────────────────────────────────
    x, y = 55, 495
    i_size = 32
    c.setFont("Freesentation-4Regular", 9)
    r, g, b = hex_to_rgb(text_color)
    c.setFillColorRGB(r, g, b)

    for emotion in (diary.get("emotions") or "").split(", "):
        name = emotion.strip()
        icon = EMOTION_ICONS.get(name)
        if not icon:
            continue
        c.drawImage(asset(icon), x, y, width=i_size, height=i_size, mask="auto")
        text_width = stringWidth(name, "Freesentation-4Regular", 9)
        c.drawString((x + i_size / 2) - (text_width / 2), y - 10, name)
        x += 53

    # ── 4~6. 감정점수 / 마음신호등 / LBTI ────────────────────────────────
    text_y = 490
    c.setFont("Freesentation-4Regular", 14)
    r, g, b = hex_to_rgb(text_color)
    c.setFillColorRGB(r, g, b)

    def centered(text, left):
        """left 기준 폭 45 안에서 가운데 정렬."""
        w = stringWidth(text, "Freesentation-4Regular", 14)
        c.drawString(left + (45 - w) / 2, text_y, text)

    centered(f"{diary.get('emotions_score', '')}°C", 227)
    centered(traffic_name, 289)

    mbti = diary.get("mbti") or ""
    if mbti:
        centered(mbti, 348)

    # ── 7. 일기 주제 ────────────────────────────────────────────────────
    topic = diary.get("topic") or "오늘 하루를 정리해 봐요"
    frame_w, frame_h = 299, 60
    topic_y = 407 + (6 if len(topic) > 43 else 0)

    def topic_style(size):
        return ParagraphStyle(
            name="Topic",
            fontName="Freesentation-4Regular",
            fontSize=size,
            leading=size * LEADING["topic"],
            wordWrap="CJK",
            textColor=text_color,
        )

    para = _fit(topic, topic_style, frame_w, frame_h, frame_h - 30, 11)
    Frame(76, topic_y, frame_w, frame_h, showBoundary=0).addFromList([para], c)

    # ── 8. 일기 본문 ────────────────────────────────────────────────────
    # 먼저 반 페이지에 들어가는지 보고, 들어가면 남는 자리에 삽화를 넣는다.
    body_w, body_h, body_h_short, body_y = 345, 300, 170, 118
    content = diary.get("content") or ""

    def body_style(size):
        return ParagraphStyle(
            name="Body",
            fontName="Geurimilgi",
            fontSize=size,
            leading=size * LEADING["body"],
            wordWrap="CJK",
            textColor="#2F2725",
            alignment=TA_JUSTIFY,
        )

    para = Paragraph(to_markup(content, 10), body_style(10))
    _, h = para.wrap(*avail(body_w, body_h_short))

    if h < (body_h_short - 15):
        Frame(40, body_y + body_h_short - 30, body_w, body_h_short, showBoundary=0).addFromList([para], c)

        traffic = diary["traffic"]
        idx = alt_state.get(traffic, 1)
        idx = 1 - idx
        alt_state[traffic] = idx
        # 원본은 alt 값이 1일 때 첫 번째 삽화를 썼다.
        img, dx, dy, iw, ih = ILLUSTRATIONS[traffic][0 if idx == 1 else 1]
        c.drawImage(asset(img), 250 + dx, 115 + dy, width=iw, height=ih, mask="auto")
    else:
        para = _fit(content, body_style, body_w, body_h, body_h - 15, 10)
        Frame(40, body_y, body_w, body_h, showBoundary=0).addFromList([para], c)

    # ── 9. 토닥토닥 ─────────────────────────────────────────────────────
    talk_w, talk_h = 300, 80
    talk = diary.get("SeamTalk") or ""

    def talk_style(size):
        return ParagraphStyle(
            name="Talk",
            fontName="EduSeaum",
            fontSize=size,
            leading=size * LEADING["talk"],
            wordWrap="CJK",
            textColor="#2F2725",
        )

    para = _fit(talk, talk_style, talk_w, talk_h, talk_h - 5, 11)
    Frame(90, 37, talk_w, talk_h, showBoundary=0).addFromList([para], c)

    return True


def render_volume(diaries, out):
    """
    일기 목록을 PDF 한 권으로 그려 out(파일 경로 또는 file-like)에 쓴다.

    diaries 는 날짜 오름차순으로 정렬되어 있어야 한다.
    반환: {'pages': 그린 페이지 수, 'skipped': 건너뛴 일기 목록}
    """
    ensure_fonts()

    c = canvas.Canvas(out, pagesize=PAGE_SIZE)
    alt_state = {"GREEN": 1, "YELLOW": 1, "RED": 1}
    pages = 0
    skipped = []

    for diary in diaries:
        if not is_renderable(diary):
            skipped.append(
                {
                    "id": diary.get("id"),
                    "date": diary.get("date"),
                    "reason": "traffic 값 없음/비정상"
                    if diary.get("traffic") not in TRAFFIC
                    else "날짜 형식 오류",
                }
            )
            continue
        draw_diary_page(c, diary, alt_state)
        c.showPage()  # 다음 일기는 새 페이지에. 마지막 호출까지 해야 페이지가 확정된다.
        pages += 1

    c.save()
    return {"pages": pages, "skipped": skipped}
