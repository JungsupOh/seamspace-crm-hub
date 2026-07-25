# 심스페이스 CRM — 쿠폰 무효화(revoke) API 요청

> mDiary 백엔드 API 추가 요청
> 작성: 2026-07-20 · **스펙 확정: 2026-07-25 (백엔드팀 회신)** · 담당 연락처: info@tebahsoft.com
>
> ✅ 아래 스펙은 백엔드팀과 합의 완료된 내용입니다.
> 조회 시 상태 확인을 위해 `coupon_info` API도 함께 제공됩니다 (§9 참조).

## 1. 목적

해외 파트너가 CRM에서 이용권 쿠폰을 직접 발급하는 기능이 오픈되었습니다.
아래 두 상황에서 이미 발급된 쿠폰을 정지시킬 수단이 필요합니다.

1. **파트너와 고객 간 계약이 결렬**되어, 이미 전달한 쿠폰을 회수해야 하는 경우
2. **실수로 발급된 쿠폰**(오발급·중복발급)을 취소하는 경우

현재 제공되는 API는 `coupon_create` 뿐이라 회수 수단이 없습니다.
CRM에서는 무효 표시만 할 수 있고, 고객은 그 코드를 그대로 등록할 수 있는 상태입니다.

관리자 화면에서 수동으로 처리하는 것과 동일한 동작을 API로 제공해 주시면 됩니다.

> `is_used = true` 로 변경하고, `used_group` 은 비워 둠

## 2. Endpoint

```
POST /mDiary_app/coupon_revoke/
Content-Type: application/x-www-form-urlencoded
```

## 3. 인증

기존 `coupon_create` 와 동일합니다.
`/mDiary_app/login/` 으로 발급받은 `ss_access_token` 을 Bearer 로 사용합니다.

```
Authorization: Bearer {ss_access_token}
```

## 4. 요청 파라미터

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `coupon_code` | O | 무효화할 쿠폰 코드 |
| `reason` | X | 무효화 사유 (감사 로그용, 최대 200자) |

## 5. 쿠폰 상태 정의

응답의 `status` 는 아래 3가지 중 하나만 사용해 주세요.

| status | 의미 | 판별 조건 |
|---|---|---|
| `available` | 미사용 | `is_used = false` |
| `in_use` | 사용 중 | `is_used = true` AND `used_group` 있음 |
| `revoked` | 무효화됨 | `is_used = true` AND `used_group` 없음 |

## 6. 상황별 동작 — 아래 4가지로 한정

### 6.1 미사용 쿠폰 (`available`)

`is_used = true` 로 변경하고 `used_group` 은 비워 둡니다.
이후 해당 코드로는 등록이 불가해야 합니다.

```
HTTP 200
{ "success": true, "coupon_code": "ABC12345", "status": "revoked" }
```

### 6.2 이미 사용 중인 쿠폰 (`in_use`)

변경하지 않고 거절합니다.

> 이미 서비스를 이용 중인 학교의 계정이 깨질 수 있어,
> 무효화가 아니라 별도 협의가 필요한 건입니다.

```
HTTP 409
{
  "success": false,
  "coupon_code": "ABC12345",
  "status": "in_use",
  "error": "already_used",
  "used_group": "2026 통합교육지원실",
  "message": "이미 사용된 쿠폰입니다"
}
```

### 6.3 이미 무효화된 쿠폰 (`revoked`)

아무것도 변경하지 않고 **성공으로 응답**합니다.
네트워크 오류 등으로 같은 요청이 재시도될 수 있어, 반복 호출이 안전해야 합니다.

```
HTTP 200
{ "success": true, "coupon_code": "ABC12345", "status": "revoked", "already_revoked": true }
```

### 6.4 존재하지 않는 코드

```
HTTP 404
{
  "success": false,
  "coupon_code": "ABC12345",
  "status": null,
  "error": "not_found",
  "message": "존재하지 않는 쿠폰입니다"
}
```

## 7. 그 외 요구사항

- 쿠폰 행을 **물리 삭제하지 말아 주세요.** 발급 이력 추적이 필요합니다.
- 무효화된 코드로 사용자가 등록을 시도하면
  "사용할 수 없는 코드"라는 취지의 오류가 노출되어야 합니다.
- **성공·실패와 무관하게 응답에 `status` 를 항상 포함**해 주세요.
  거절당한 경우에도 CRM이 현재 상태를 알 수 있어야 원장을 정확히 동기화합니다.

## 8. 쿠폰 조회 API — `coupon_info` (백엔드팀 제공 확정)

무효 상태를 CRM이 직접 유추하지 않도록, 조회 응답에 `status` 필드가 포함됩니다.

```
GET(또는 POST) /mDiary_app/coupon_info/
```

응답:

```json
{
  "message": "success",
  "data": {
    "user_limit": 60,
    "duration": 1,
    "descript": "test coupon 발행2",
    "is_used": true,
    "status": "revoked"
  },
  "server_status": "normal"
}
```

- `status`: `available` | `in_use` | `revoked` (§5 정의와 동일)
- CRM은 이 `status` 를 그대로 읽어 원장과 동기화합니다.
  (`is_used` + `used_group` 조합으로 유추할 필요 없음)

## 9. CRM 연동 계획

API가 준비되면 CRM 발급 원장(`partner_licenses`)의 무효화 처리에서
`coupon_revoke` 를 호출하고, 응답의 `status` 를 그대로 기록합니다.
상태 재확인이 필요할 때는 `coupon_info` 의 `status` 를 사용합니다.

---

## 부록 — CRM 측 현재 구현 (참고용, 전달 불필요)

- 발급: `supabase/functions/partner-issue-license/index.ts` → `coupon_create` 호출
- 원장: `partner_licenses` 테이블
  - `status`: `issued` | `revoked`
  - `revoked_at` / `revoked_by` / `revoke_reason`
- 무효화: `src/lib/partner-licenses.ts` 의 `revokeLicense()`
  - 현재는 CRM 원장에만 표시. **실제 코드 차단은 이 API 연동 후 적용.**
  - 연동 시 이 함수에 엔드포인트 호출 한 단계만 추가하면 됩니다.
- 상태 조회: `supabase/functions/get-coupon-status/index.ts`
  - 현재는 `mDiary_app_coupon` 에서 `is_used`, `used_group_id` 를 직접 읽어 유추.
  - 확정된 `coupon_info` API가 `status` 를 직접 주므로, 연동 시 이 값을 사용하도록
    전환하면 유추 로직을 제거할 수 있습니다.
