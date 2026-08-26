"""
일기 본문·토닥토닥에 들어있는 이모지를 PDF 에 제대로 찍는다.

왜 컬러가 아닌가
────────────────
reportlab 은 컬러 이모지 폰트를 못 쓴다. TTF 파서가 일반 외곽선(glyf)만 읽는데
컬러 이모지는 비트맵(CBDT)이나 COLR 레이어로 들어있기 때문이다. 그래서 이모지
폰트를 등록해 봐야 빈 글리프나 네모박스가 나온다. 원본 reportsD.py 에도
NotoColorEmoji 가 등록만 되고 쓰이지 않은 채 남아 있었다.

컬러를 넣으려면 이모지를 PNG 로 그려 Paragraph 의 인라인 <img> 로 끼우는 방법뿐인데,
이건 wordWrap='CJK' 와 같이 못 쓴다. reportlab 의 CJK 줄바꿈 코드가 조각마다
ord() 를 호출하는데 이미지 조각에는 글자가 없어서 그대로 죽는다
(paragraph.py cjkFragSplit). 한글은 CJK 줄바꿈이 없으면 프레임 밖으로 넘치므로
그쪽을 포기할 수 없다.

그래서 흑백 외곽선 이모지 폰트(Noto Emoji, OFL)를 쓴다. 이모지가 '글자'로
취급되니 줄바꿈과 충돌하지 않고, 벡터라 인쇄 해상도에서도 깨지지 않으며,
859KB 로 가볍다.

폰트에 없는 이모지는 지운다. 남겨 두면 본문 폰트에서 네모박스가 되기 때문이다.
"""

import os
import re

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_NAME = "NotoEmoji"
_FONT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "assets", "fonts", "NotoEmoji.ttf"
)

# 조합용 문자들. 그대로 두면 피부톤은 사각형으로, ZWJ·이형자선택자는 네모박스로 나온다.
# 이모지 결합(👨‍👩‍👧, 국기)은 폰트 합자가 필요한데 reportlab 이 GSUB 합자를 적용하지
# 않으므로, 애초에 떼어내고 낱개로 그린다.
_COMBINING = re.compile(
    "[\U0001F3FB-\U0001F3FF]"      # 피부톤
    "|[\U0001F1E6-\U0001F1FF]"     # 국기용 지역표시 문자
    "|[\U000E0020-\U000E007F]"     # 태그 문자
    "|[‍︎️⃣]"  # ZWJ, 이형자선택자, 키캡
)

# 이모지가 있을 만한 구간. 여기 걸린 글자만 폰트 수록 여부를 확인한다.
# 범위가 넓어도 폰트에 없으면 걸러지므로 한글이 잘못 잡히지 않는다.
_CANDIDATE = re.compile(
    "[©®‼⁉™ℹ]"
    "|[←-⇿]"
    "|[⌀-⏿]"
    "|[①-⓿]"
    "|[■-➿]"
    "|[⤴⤵]"
    "|[⬀-⯿]"
    "|[〰〽㊗㊙]"
    "|[\U0001F000-\U0001FAFF]"
)

# 이모지를 글자 크기 그대로 두면 한글보다 커 보이고 윗줄과 부딪힌다.
# Noto Emoji 글리프가 em 사각형을 꽉 채우는 반면 한글은 여백이 있기 때문이다.
EMOJI_SCALE = 0.85

_registered = False
_supported = None  # 코드포인트 -> 글리프. 폰트가 실제로 가진 것만 들어있다.


def ensure_font():
    """이모지 폰트를 한 번만 등록한다."""
    global _registered, _supported
    if not _registered:
        pdfmetrics.registerFont(TTFont(FONT_NAME, _FONT_PATH))
        # reportlab 이 파싱해 둔 cmap 을 그대로 쓴다. 별도 폰트 라이브러리가 필요 없다.
        _supported = pdfmetrics.getFont(FONT_NAME).face.charToGlyph
        _registered = True
    return FONT_NAME


def _escape(text):
    """
    Paragraph 는 미니 HTML 을 해석하므로 사용자 텍스트를 그대로 넣으면 안 된다.
    일기에 < 나 & 가 있으면 태그로 오인돼 글자가 사라지거나 예외가 난다.
    """
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def to_markup(text, font_size):
    """
    사용자 텍스트를 Paragraph 용 마크업으로 바꾼다.
    이모지는 이모지 폰트로 조금 작게 감싸고, 나머지는 이스케이프한 글자 그대로 둔다.
    연속된 이모지는 한 번만 감싼다.

    글자 크기를 줄여 가며 다시 배치할 때는 그 크기로 다시 불러야 한다.
    """
    if not text:
        return ""

    ensure_font()
    emoji_size = round(font_size * EMOJI_SCALE, 2)
    text = _COMBINING.sub("", text)

    out = []
    plain = []
    emo = []

    def flush_plain():
        if plain:
            out.append(_escape("".join(plain)))
            plain.clear()

    def flush_emo():
        if emo:
            out.append(
                f'<font name="{FONT_NAME}" size="{emoji_size}">{"".join(emo)}</font>'
            )
            emo.clear()

    for ch in text:
        if _CANDIDATE.match(ch):
            if ord(ch) in _supported:
                flush_plain()
                emo.append(ch)
            # 폰트에 없는 이모지 — 네모박스가 되므로 버린다
            continue
        flush_emo()
        plain.append(ch)

    flush_emo()
    flush_plain()
    return "".join(out)
