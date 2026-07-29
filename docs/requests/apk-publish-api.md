# 심스페이스 CRM — APK CI 푸시 API (개발팀 CI 연동용)

> CRM이 제공하는 엔드포인트 · 개발팀 CI/CD가 호출
> 작성: 2026-07-29 · 담당 연락처: info@tebahsoft.com
>
> ⚠️ 다른 문서와 방향이 반대입니다. 이건 **CRM이 만든 엔드포인트를 개발팀 CI가 호출**합니다.
> (쿠폰/그룹 API는 mDiary가 만들고 CRM이 호출)

## 1. 목적

지금까지 새 APK 빌드마다 사람이 CRM 관리자 화면에 로그인해 업로드했습니다.
CI/CD가 붙으면서 **CI가 APK를 CRM에 자동으로 밀어넣도록** 합니다.

동작 원칙(중요):
- **발송은 자동으로 하지 않습니다.** CI는 버전을 올려두기만 하고(스테이징),
  실제 구독자 이메일 발송은 관리자가 CRM에서 검토 후 '전체 발송'을 누릅니다.
- CI가 올린 버전은 **자동으로 최신(is_latest)** 으로 설정됩니다 (신규 구독자·다운로드 페이지가 즉시 받음).
- 버킷 용량 관리: **발송 시점**에 CRM이 직전 발송분 + 이번 발송분 2개만 남기고 나머지 APK 파일을 자동 삭제합니다.

## 2. 인증

모든 요청 헤더에 공유 시크릿을 넣습니다. 시크릿은 **별도 안전 채널로 전달**합니다(이 문서·git·로그 금지).

```
X-Webhook-Secret: <APK_PUSH_SECRET>
```
불일치 시 401.

## 3. 흐름 — 3단계

바이너리는 엣지 함수를 통과하지 않습니다(대용량). CI가 스토리지에 직접 업로드합니다.

### 3.1 init — 업로드 URL 발급

```
POST {SUPABASE_URL}/functions/v1/apk-publish
X-Webhook-Secret: <secret>
Content-Type: application/json

{ "action": "init", "filename": "app-release.apk" }
```
응답:
```json
{ "path": "releases/1785...-app-release.apk",
  "upload_url": "https://<project>.supabase.co/storage/v1/object/upload/sign/apk-files/releases/...?token=..." }
```

### 3.2 업로드 — APK 바이너리 PUT

`upload_url`에 파일 본문을 그대로 PUT. (서명 URL은 약 2시간 유효)

```
PUT <upload_url>
Content-Type: application/vnd.android.package-archive
<APK 바이너리>
```
예: `curl -X PUT "$UPLOAD_URL" -H "Content-Type: application/vnd.android.package-archive" --data-binary @app-release.apk`

### 3.3 commit — 버전 등록

```
POST {SUPABASE_URL}/functions/v1/apk-publish
X-Webhook-Secret: <secret>
Content-Type: application/json

{
  "action": "commit",
  "path": "releases/1785...-app-release.apk",   // init에서 받은 값
  "version_name": "1.4.0",                        // 사용자 표기 버전
  "version_code": 140,                            // Android versionCode (정수, 정렬·비교 기준)
  "sha256": "<sha256sum 결과>",                   // 무결성/멱등 키
  "file_size": 62914560,                          // bytes
  "changelog": "버그 수정 및 성능 개선",           // 릴리스 노트 (markdown 가능)
  "min_android": "7.0+",                          // 선택
  "set_latest": true                              // 선택, 기본 true
}
```
응답:
```json
{ "id": "<uuid>", "version_name": "1.4.0", "version_code": 140, "is_latest": true }
```

## 4. 응답 코드

| 코드 | 의미 |
|---|---|
| 200 | 성공. commit이면 `id` 반환. 같은 version_code+sha256 재요청은 `idempotent:true`로 기존 반환(재실행 안전) |
| 400 | 필수값 누락 / 업로드된 파일 없음(3.2 누락) |
| 401 | 시크릿 불일치 |
| 409 | 같은 `version_code`가 **다른** sha256으로 이미 등록됨 (`error_code:"version_conflict"`) |
| 500/502 | 서버/스토리지 오류 |

## 5. CI가 채워야 할 값 요약

`version_name`, `version_code`(Android build), `sha256`(`sha256sum app.apk`), `file_size`,
`changelog`(릴리스 노트), `min_android`(선택). 나머지(경로·최신설정·발송)는 CRM이 처리.

## 6. 권장 CI 스텝 (의사코드)

```bash
SHA=$(sha256sum app-release.apk | cut -d' ' -f1)
SIZE=$(stat -c%s app-release.apk)
INIT=$(curl -sX POST "$CRM/functions/v1/apk-publish" -H "X-Webhook-Secret: $SECRET" \
  -H "Content-Type: application/json" -d '{"action":"init","filename":"app-release.apk"}')
UPURL=$(echo "$INIT" | jq -r .upload_url); PATH=$(echo "$INIT" | jq -r .path)
curl -sX PUT "$UPURL" -H "Content-Type: application/vnd.android.package-archive" --data-binary @app-release.apk
curl -sX POST "$CRM/functions/v1/apk-publish" -H "X-Webhook-Secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"action\":\"commit\",\"path\":\"$PATH\",\"version_name\":\"$VNAME\",\"version_code\":$VCODE,\"sha256\":\"$SHA\",\"file_size\":$SIZE,\"changelog\":\"$NOTES\",\"min_android\":\"7.0+\"}"
```
> **릴리스 빌드에서만** 실행하세요. 매 커밋/테스트 빌드에서 돌리면 최신 버전이 계속 바뀝니다.
> (구독자 이메일이 나가는 건 아니지만, is_latest가 바뀌어 신규 구독자가 테스트 빌드를 받게 됩니다.)

---

## 부록 — CRM 측 구현 (참고용, 전달 불필요)

- 엔드포인트: `supabase/functions/apk-publish/index.ts` (verify_jwt=false, `APK_PUSH_SECRET` 상수시간 비교, fail-closed)
- 스토리지: 비공개 버킷 `apk-files`, 경로 `releases/`. init은 service-role로 `createSignedUploadUrl` 발급
- commit: 파일 존재 확인 → version_code 중복/멱등 가드 → is_latest 승격 → `apk_versions` insert(`source='ci'`, `uploaded_by=null`)
- 발송 안 함(스테이징). 관리자 화면 `/apk`에서 'CI 자동' 배지로 구분, '전체 발송' 수동
- 버킷 보존: 발송(`apk-broadcast`) 직후 `pruneApkFiles()`가 최근 발송 2개(+is_latest 안전) 외 파일 삭제
- E2E 검증 완료(2026-07-29): init·60MB PUT·commit·멱등·409 정상
