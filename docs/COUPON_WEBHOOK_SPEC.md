# 심스페이스 CRM — 쿠폰 상태 변경 Webhook 명세

> mDiary 운영DB → CRM 실시간 동기화 연동 요청
> 작성: 2026-05-20 · 담당 연락처: info@tebahsoft.com

## 1. 배경

현재 CRM 은 mDiary 운영DB(`mDiary_app_coupon`) 의 쿠폰 사용 상태를
**매일 18시 polling** 으로 동기화하고 있습니다. 두 가지 한계:

- 동기화 사이 최대 24시간 stale → 영업/지원팀 follow-up 지연
- 매번 N+1 JOIN 쿼리 (`mDiary_app_group`, `auth_group`, `customuser`) — DB 부하

mDiary 백엔드에서 **쿠폰 상태가 변할 때 webhook 1발**만 보내주시면
양쪽 모두 단순화됩니다.

## 2. Endpoint

```
POST https://awosikecivzhwisqzlds.supabase.co/functions/v1/coupon-webhook
```

## 3. 인증

```
Header:  X-Webhook-Secret: {SECRET}
```

`{SECRET}` 값은 **이 문서와 별도 채널로 전달**합니다 (보안상 git/로그/이메일 본문 노출 금지).
필요 시 info@tebahsoft.com 으로 회신 주세요.

Secret 불일치 시 401 반환.

## 4. 트리거 이벤트 (3가지)

| event | 발화 조건 |
|---|---|
| `coupon.activated` | `is_used` 가 0 → 1 로 변경된 직후 |
| `coupon.expired` | `service_expire_at` 도래 시 (스케줄러 또는 트리거) |
| `coupon.deleted` | 쿠폰 hard delete 시 (선택 — 단순 비활성화면 생략 가능) |

## 5. 요청 Body

### 5-1. `coupon.activated` (필수 — 가장 중요)

```json
{
  "event": "coupon.activated",
  "coupon_code": "XB9H25",
  "is_used": true,
  "used_group_id": 12345,
  "service_expire_at": "2027-01-21",
  "group_name": "지행초등학교",
  "edu_office_name": "경기도교육청",
  "member_count": 15,
  "timestamp": "2026-05-20T10:00:00+09:00"
}
```

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `event` | string | ✅ | 고정값 `"coupon.activated"` |
| `coupon_code` | string | ✅ | 매칭 키 (mDiary `coupon_code` 그대로) |
| `is_used` | boolean | ✅ | activated 면 항상 `true` |
| `used_group_id` | int / string | 권장 | `mDiary_app_coupon.used_group_id` |
| `service_expire_at` | string `YYYY-MM-DD` | 권장 | 만료일 — UI 표시용 |
| `group_name` | string | 권장 | 그룹명 (`auth_group.name`) |
| `edu_office_name` | string | 권장 | 시도교육청 |
| `member_count` | int | 권장 | 활성화 시점 사용자수 |
| `timestamp` | string ISO 8601 | 선택 | 디버깅용 |

### 5-2. `coupon.expired`

```json
{ "event": "coupon.expired", "coupon_code": "XB9H25" }
```

`service_expire_at` 도 함께 보내주시면 좋지만 필수 아님.

### 5-3. `coupon.deleted` (선택)

```json
{ "event": "coupon.deleted", "coupon_code": "XB9H25" }
```

mDiary 가 쿠폰을 실제 삭제하지 않고 비활성화만 한다면 이 이벤트는 구현 생략 가능.

## 6. 응답

| HTTP | 의미 | 재시도 |
|---|---|---|
| `200` | 정상 처리 완료 (CRM 동기화 + 텔레그램 알림 발화) | 불필요 |
| `400` | payload 형식 오류 (`event` / `coupon_code` 누락 등) | 불필요 (수정 필요) |
| `401` | `X-Webhook-Secret` 불일치 | 불필요 (secret 확인 필요) |
| `5xx` | CRM 측 일시적 오류 (DB 일시 장애 등) | **권장**: 백오프 1분/5분/30분, 최대 3회 |

### 응답 Body 예시

```json
{
  "ok": true,
  "event": "coupon.activated",
  "coupon_code": "XB9H25",
  "applied": {
    "status": "사용중",
    "deal": true,
    "campaign": true,
    "mdiary": "updated"
  }
}
```

## 7. 멱등성 (Idempotency)

CRM 은 `coupon_code` 기준 **UPSERT** 처리합니다.
같은 이벤트가 N 번 들어와도 부작용 없으므로 **재시도 안심하고 가능**합니다.

## 8. CRM 측 처리 흐름 (참고)

webhook 수신 시 CRM 은 다음 작업을 수행:
1. `X-Webhook-Secret` 검증
2. payload 형식 검증
3. `deal_licenses` / `campaign_licenses` / `mdiary_coupons` 3 테이블 동기화 (UPSERT)
4. **텔레그램 알림 발화** — 영업/지원팀 채널에 즉시 통보 (사용 시작 / 만료 / 삭제)

→ webhook 1발이 영업팀까지 도달하는 알림 체계의 트리거가 됩니다.

## 9. 테스트 방법

연동 전 CRM 동작 확인용 curl:

```bash
curl https://awosikecivzhwisqzlds.supabase.co/functions/v1/coupon-webhook \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: {SECRET}" \
  -d '{
    "event": "coupon.activated",
    "coupon_code": "TEST_CODE_001",
    "is_used": true,
    "service_expire_at": "2027-12-31",
    "group_name": "테스트학교",
    "edu_office_name": "테스트교육청",
    "member_count": 1
  }'
```

응답에 `"ok": true` 가 오면 성공. 실제 코드(예: 운영 쿠폰)로 테스트하실 때는 사전에 알려 주세요 (텔레그램 알림이 영업팀 채널로 갑니다).

## 10. 발화 예상 빈도

- 일일 쿠폰 발급: 약 10~50건
- 일일 activated 전환: 약 5~30건
- expired/deleted: 1~5건
- → **하루 평균 10~30 webhook**. peak 시간대(아침/저녁) 분당 5건 미만으로 예상.

## 11. FAQ

**Q. admin 정보(`admin_name`, `admin_phone`, `admin_last_login`)는 빠졌네요?**
A. 의도적으로 제외했습니다. admin 은 학교 측에서 매일 변할 수 있고, 쿠폰 activated 시점에 별도 JOIN 쿼리가 필요해서 백엔드 부담을 줄이려 합니다. 필요해지면 Phase 2 로 별도 `school.admin_changed` 이벤트 또는 별도 API endpoint 로 분리하시는 게 좋아 보입니다.

**Q. 동일 쿠폰이 짧은 시간에 여러 번 activated 될 수도 있나요?**
A. 거의 없겠지만 멱등성 확보돼 있어 안전합니다. CRM 텔레그램 알림이 중복으로 갈 수는 있으나, 운영상 큰 문제 없는 수준입니다.

**Q. CRM 응답이 5xx 일 때 백엔드가 어디까지 책임지나요?**
A. 5xx 의 경우 백엔드에서 1분/5분/30분 백오프로 3회 재시도 후 포기 권장. 실패한 이벤트는 mDiary 측 로그/큐에 보관해 주시면 CRM 복구 후 수동 재발 협의 가능합니다.

**Q. SSL/TLS 검증을 우회해도 되나요?**
A. 안 됩니다. Supabase Edge Function 의 TLS 인증서는 정상이므로 일반 HTTPS 클라이언트로 호출 가능.

---

질문/회신: **info@tebahsoft.com** 또는 직접 연락.
