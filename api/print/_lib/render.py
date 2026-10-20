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

from . import secret
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

# 배경 아트의 아래쪽 단색. 판형이 달라 남는 자리를 이 색으로 채운다.
# 세 배경(bgDayGoodAll/SosoAll/BadAll) 모두 맨 아래가 이 색이다.
PAGE_FILL = (251 / 255, 250 / 255, 246 / 255)

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


def is_renderable(diary, include_secret=True):
    """
    이 일기가 실제로 한 페이지를 만들어내는지.

    traffic 이 셋 중 하나가 아니면 원본은 조용히 return 해서 페이지가 안 생겼다.
    그대로 두면 '100페이지로 견적 → 98페이지로 인쇄' 가 되므로,
    견적(stats)과 렌더가 반드시 이 같은 함수로 페이지 수를 센다.

    include_secret=False 면 비밀글을 뺀다. 판별이 안 되는 상태(secret.detectable()
    가 False)에서 이 값을 넘기면 안 된다 — 호출자가 먼저 막아야 한다.
    여기서 조용히 통과시키면 '제외'를 고른 사용자의 비밀글이 그대로 인쇄된다.
    """
    if diary.get("traffic") not in TRAFFIC:
        return False
    try:
        parse_api_date(diary.get("date"))
    except ValueError:
        return False
    if not include_secret and secret.should_hide(diary):
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


# ── 간지 ────────────────────────────────────────────
# 책 맨 앞에 **한 장** 넣는다. 종이 한 장은 앞뒤 두 면이므로 PDF 로는 2페이지다
# (FLYLEAF_PAGES). 일기가 바로 시작되면 표지를 넘기자마자 본문이라 책 같지 않고,
# 제본 특성상 첫 장은 풀칠 쪽이라 글이 안쪽으로 말려 들어간다.
#
# 그림은 앞면 오른쪽 아래에만 넣는다. 뒷면은 비워 둔다 — 넘기면 바로 일기가 시작된다.
# 시작하는 장이라 코가 오른쪽 위를 향하게 기울여 '출발하는' 방향으로 둔다.
#
# 리플릿의 로켓을 오려 붙이지 않고 **단순한 도형으로 다시 그린다.** 오려 온 그림은
# 그라데이션과 결이 그대로 따라와 간지에는 과했고, 원본이 벡터라 깔끔히 떼어낼 수도
# 없었다. 여기서는 몸통·코·날개·창·불꽃 다섯 덩어리면 충분하다.
FLYLEAF_PAGES = 2              # 종이 1장 = 앞뒤 2면. pricing.front_pages 와 같아야 한다
# 로켓 크기. 단위계의 '높이 1' 에 해당하는 길이다 — 날개와 기울기가 더해져
# 실제 그려지는 크기는 이보다 크다(현재 비율에서 약 39×41mm).
FLYLEAF_SIZE_MM = 40.0
FLYLEAF_RIGHT_MM = 34.0        # 페이지 오른쪽 끝에서 로켓 중심까지
FLYLEAF_BOTTOM_MM = 40.0       # 페이지 아래 끝에서 로켓 중심까지
FLYLEAF_ANGLE = -38            # 음수면 시계방향. 코가 오른쪽 위를 향한다

# 로켓 색 — 본문 종이 위에서 튀지 않게 낮춘 톤
ROCKET_BODY = (0.957, 0.953, 0.973)
ROCKET_SHADE = (0.878, 0.867, 0.914)    # 몸통 오른쪽 그늘. 평면이 아니라 원통으로 보이게
ROCKET_ACCENT = (0.541, 0.506, 0.690)
ROCKET_DEEP = (0.361, 0.329, 0.514)
ROCKET_GLASS = (0.714, 0.800, 0.902)
ROCKET_FLAME = (0.973, 0.788, 0.600)
ROCKET_FLAME_IN = (0.996, 0.902, 0.761)

# 몸통 비율. WIDE 를 키우거나 TALL 을 줄이면 통통해진다.
# **도형에만 걸고 창에는 안 건다** — 같이 걸면 창이 타원이 된다.
ROCKET_WIDE = 1.25
ROCKET_TALL = 0.88


def _rocket_right_edge(p):
    """코끝 → 오른쪽 어깨 → 허리 → 바닥 모서리. 몸통·그늘이 같은 선을 쓰게 모아 둔다."""
    p.curveTo(0.085, 0.930, 0.150, 0.800, 0.172, 0.640)
    p.curveTo(0.190, 0.500, 0.188, 0.330, 0.166, 0.185)


def draw_rocket(c, cx, cy, h, angle=FLYLEAF_ANGLE):
    """
    (cx, cy) 를 중심으로 높이 h 의 로켓을 그린다.

    좌표는 '높이 1' 단위계로 두고 마지막에 scale 한다 — 크기를 바꿔도 비율이 안 깨진다.
    몸통은 직선이 아니라 허리가 살짝 부푼 물방울형이다. 곧은 통으로 두면 크레용처럼 보인다.
    """
    c.saveState()
    c.translate(cx, cy)
    c.rotate(angle)
    c.scale(h, h)
    # 단위계의 세로 범위는 불꽃 -0.185 ~ 코끝 1.0 이다. 그 한가운데를 (cx, cy) 에 둔다 —
    # 호출부가 '중심'으로 위치를 잡을 수 있어야 여백 계산이 단순해진다.
    c.translate(0, -0.41 * ROCKET_TALL)

    c.saveState()
    c.scale(ROCKET_WIDE, ROCKET_TALL)   # 창은 이 바깥에서 그려 정원을 유지한다

    # ── 불꽃 (맨 뒤) ──
    p = c.beginPath()
    p.moveTo(-0.098, 0.040)
    p.curveTo(-0.105, -0.055, -0.060, -0.135, 0.0, -0.185)
    p.curveTo(0.060, -0.135, 0.105, -0.055, 0.098, 0.040)
    p.close()
    c.setFillColorRGB(*ROCKET_FLAME)
    c.drawPath(p, stroke=0, fill=1)
    p = c.beginPath()
    p.moveTo(-0.048, 0.035)
    p.curveTo(-0.052, -0.030, -0.028, -0.072, 0.0, -0.100)
    p.curveTo(0.028, -0.072, 0.052, -0.030, 0.048, 0.035)
    p.close()
    c.setFillColorRGB(*ROCKET_FLAME_IN)
    c.drawPath(p, stroke=0, fill=1)

    # ── 날개 ──
    c.setFillColorRGB(*ROCKET_ACCENT)
    for sx in (-1, 1):
        p = c.beginPath()
        p.moveTo(sx * 0.158, 0.300)
        p.curveTo(sx * 0.250, 0.215, sx * 0.350, 0.090, sx * 0.392, -0.040)
        p.curveTo(sx * 0.300, -0.015, sx * 0.215, 0.030, sx * 0.150, 0.095)
        p.close()
        c.drawPath(p, stroke=0, fill=1)

    # ── 몸통 ──
    p = c.beginPath()
    p.moveTo(0.0, 1.0)
    _rocket_right_edge(p)
    p.curveTo(0.150, 0.130, 0.090, 0.095, 0.0, 0.092)
    p.curveTo(-0.090, 0.095, -0.150, 0.130, -0.166, 0.185)
    p.curveTo(-0.188, 0.330, -0.190, 0.500, -0.172, 0.640)
    p.curveTo(-0.150, 0.800, -0.085, 0.930, 0.0, 1.0)
    p.close()
    c.setFillColorRGB(*ROCKET_BODY)
    c.drawPath(p, stroke=0, fill=1)

    p = c.beginPath()
    p.moveTo(0.0, 1.0)
    _rocket_right_edge(p)
    p.curveTo(0.150, 0.130, 0.090, 0.095, 0.0, 0.092)
    p.curveTo(0.055, 0.260, 0.070, 0.600, 0.0, 1.0)
    p.close()
    c.setFillColorRGB(*ROCKET_SHADE)
    c.drawPath(p, stroke=0, fill=1)

    # ── 코 ──
    p = c.beginPath()
    p.moveTo(0.0, 1.0)
    p.curveTo(0.085, 0.930, 0.150, 0.800, 0.172, 0.640)
    p.curveTo(0.090, 0.690, -0.090, 0.690, -0.172, 0.640)
    p.curveTo(-0.150, 0.800, -0.085, 0.930, 0.0, 1.0)
    p.close()
    c.setFillColorRGB(*ROCKET_ACCENT)
    c.drawPath(p, stroke=0, fill=1)

    # ── 노즐 — 몸통 '아래'에 붙는다. 안쪽에 그리면 입처럼 보인다 ──
    p = c.beginPath()
    p.moveTo(-0.100, 0.108)
    p.lineTo(-0.128, 0.030)
    p.curveTo(-0.065, 0.008, 0.065, 0.008, 0.128, 0.030)
    p.lineTo(0.100, 0.108)
    p.curveTo(0.050, 0.092, -0.050, 0.092, -0.100, 0.108)
    p.close()
    c.setFillColorRGB(*ROCKET_ACCENT)
    c.drawPath(p, stroke=0, fill=1)

    c.restoreState()               # 가로 배율 해제 — 창은 정원이어야 한다

    # ── 창 ──
    r = 0.112 * ROCKET_WIDE        # 넓어진 몸통에 맞춰 창도 같이 키운다
    cy_w = 0.480 * ROCKET_TALL     # 몸통이 짧아진 만큼 창도 따라 내려온다
    c.setFillColorRGB(*ROCKET_ACCENT)
    c.circle(0.0, cy_w, r, stroke=0, fill=1)
    c.setFillColorRGB(*ROCKET_GLASS)
    c.circle(0.0, cy_w, r * 0.70, stroke=0, fill=1)
    c.setFillColorRGB(*ROCKET_DEEP)
    c.circle(-r * 0.25, cy_w + 0.028 * ROCKET_TALL, r * 0.20, stroke=0, fill=1)

    c.restoreState()


def _blank_page(c, size):
    """종이색으로만 채운 면. 흰 종이가 아니라 본문과 같은 색이어야 이질감이 없다."""
    c.setFillColorRGB(*PAGE_FILL)
    c.rect(0, 0, size[0], size[1], stroke=0, fill=1)


def draw_flyleaf(c, size):
    """맨 앞 간지 한 장(2면). 앞면 오른쪽 아래에 로켓, 뒷면은 비운다."""
    _blank_page(c, size)
    draw_rocket(
        c,
        size[0] - FLYLEAF_RIGHT_MM * mm,
        FLYLEAF_BOTTOM_MM * mm,
        FLYLEAF_SIZE_MM * mm,
    )
    c.showPage()
    _blank_page(c, size)      # 간지 뒷면


def render_volume(diaries, out, include_secret=True, pad_to=0, page=None, front=True):
    """
    일기 목록을 PDF 한 권으로 그려 out(파일 경로 또는 file-like)에 쓴다.

    diaries 는 날짜 오름차순으로 정렬되어 있어야 한다.
    **맨 앞에 간지 한 장이 먼저 들어간다**(front=False 로 끌 수 있다).
    pricing.printed_pages() 도 이 한 장을 세므로 둘이 어긋나면 안 된다.

    pad_to 를 주면 그 페이지 수가 될 때까지 뒤에 빈 페이지를 채운다. 업체가 요구하는
    최소 페이지·짝수 규칙을 맞추기 위한 것이고, 견적이 매긴 인쇄 페이지 수와 실제 PDF
    페이지 수가 달라지면 업로드가 거부되거나 견적과 실물이 어긋나므로 반드시 맞춘다.

    page=(가로mm, 세로mm) 로 다른 판형에 맞출 수 있다. 이 모듈의 모든 좌표는
    154×216mm(A5+도련) 기준으로 짜여 있고 배경 이미지도 그 비율(1820×2552px)이다.

    **가로/세로를 따로 늘리지 않는다.** 그러면 원형 아이콘이 타원이 되고 글자가
    길어진다(신국판은 세로가 4.2% 더 늘어난다). 대신 **한 배율로만 키우고**,
    남는 자리는 배경 아래쪽 색으로 채운다.

      배율 s  = 가로를 꽉 채우는 값. 그래도 세로가 넘치면 세로 기준으로 떨어진다
      가로    남으면 좌우 균등하게 둔다
      세로    남는 만큼 **아래**로 몬다 — 상단 색 띠가 재단선까지 닿아야 하기 때문

    배경 아트의 아래쪽이 평평한 크림색(#FBFAF6)으로 끝나서 이어 칠해도 이음새가 없다.
    세 배경(Good/Soso/Bad) 모두 맨 아래 80px 이상이 단색인 것을 확인했다.

    판형을 상시로 쓸 거면 배경 아트를 그 비율로 새로 받는 게 맞다. 그러면 s 가 정확히
    맞아떨어져 남는 자리 자체가 없어진다.

    반환: {'pages': 전체 페이지 수, 'blanks': 채운 빈 페이지 수, 'skipped': 건너뛴 일기}
    """
    ensure_fonts()

    size = PAGE_SIZE if not page else (page[0] * mm, page[1] * mm)
    c = canvas.Canvas(out, pagesize=size)

    scale = size[0] / PAGE_SIZE[0]
    if PAGE_SIZE[1] * scale > size[1]:
        scale = size[1] / PAGE_SIZE[1]
    off_x = (size[0] - PAGE_SIZE[0] * scale) / 2
    off_y = size[1] - PAGE_SIZE[1] * scale     # 남는 세로는 아래로
    fitted = scale != 1 or off_x or off_y
    alt_state = {"GREEN": 1, "YELLOW": 1, "RED": 1}
    pages = 0
    skipped = []

    if front:
        draw_flyleaf(c, size)
        c.showPage()
        pages += FLYLEAF_PAGES

    for diary in diaries:
        if not is_renderable(diary, include_secret):
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
        if fitted:
            # 남는 자리를 배경 아래쪽 색으로 먼저 채운다 (재단 오차로 흰 띠가 생기지 않게)
            c.setFillColorRGB(*PAGE_FILL)
            c.rect(0, 0, size[0], size[1], stroke=0, fill=1)
            c.saveState()
            c.translate(off_x, off_y)
            c.scale(scale, scale)
        draw_diary_page(c, diary, alt_state)
        if fitted:
            c.restoreState()
        c.showPage()  # 다음 일기는 새 페이지에. 마지막 호출까지 해야 페이지가 확정된다.
        pages += 1

    blanks = 0
    while pages < pad_to:
        _blank_page(c, size)   # 본문과 같은 종이색. 비워 두면 흰 면이 되어 튄다
        c.showPage()
        pages += 1
        blanks += 1

    c.save()
    return {"pages": pages, "blanks": blanks, "skipped": skipped}
