"""
Supabase Storage 업로드.

PDF 를 응답 본문에 직접 실으면 Vercel 서버리스의 4.5MB 상한에 걸린다.
실측상 300페이지 책이 글자 다양성에 따라 2.8MB 안팎이고 JSON base64 로 싸면
3.7MB 라 여유가 없다. 그래서 CRM 이 이미 쓰는 방식(견적 PDF -> 버킷 -> URL)을 따른다.

버킷은 비공개다. 일기 본문이 들어 있으므로 shop_* 테이블의 개방형 RLS 를
따라가면 안 되고, 매번 짧은 유효기간의 signed URL 을 발급한다.
"""

import os

import requests

BUCKET = "diary_prints"
SIGNED_URL_TTL = 60 * 30  # 30분


def _config():
    # 이 프로젝트는 서버용 키도 VITE_ 접두사로 들어 있다. Vercel 은 두 이름 모두
    # 함수에 넘겨주므로 우선 접두사 없는 쪽을 보고, 없으면 기존 이름으로 떨어진다.
    #
    # 주의: VITE_ 접두사가 붙은 변수는 클라이언트 코드에서 참조하는 순간
    # Vite 가 번들에 그대로 박아 브라우저로 나간다. 서비스롤 키를 화면 쪽 코드에서는
    # 절대 참조하지 말 것(현재는 참조가 없어 번들에 들어가지 않는 것을 확인했다).
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다."
        )
    return url.rstrip("/"), key


def upload_pdf(path_in_bucket, data):
    """PDF 바이트를 올리고 signed URL 을 돌려준다."""
    base, key = _config()
    headers = {"Authorization": f"Bearer {key}", "apikey": key}

    res = requests.post(
        f"{base}/storage/v1/object/{BUCKET}/{path_in_bucket}",
        headers={**headers, "Content-Type": "application/pdf", "x-upsert": "true"},
        data=data,
        timeout=120,
    )
    if res.status_code not in (200, 201):
        raise RuntimeError(f"업로드 실패 (HTTP {res.status_code}): {res.text[:200]}")

    res = requests.post(
        f"{base}/storage/v1/object/sign/{BUCKET}/{path_in_bucket}",
        headers={**headers, "Content-Type": "application/json"},
        json={"expiresIn": SIGNED_URL_TTL},
        timeout=30,
    )
    if res.status_code != 200:
        raise RuntimeError(f"다운로드 링크 발급 실패 (HTTP {res.status_code}): {res.text[:200]}")

    return f"{base}/storage/v1{res.json()['signedURL']}"
