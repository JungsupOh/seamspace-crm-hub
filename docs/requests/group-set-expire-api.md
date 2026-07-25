# 심스페이스 CRM — 그룹 만료일 변경 API 요청

> mDiary 백엔드 API 추가 요청
> 작성: 2026-07-25 · 담당 연락처: info@tebahsoft.com
>
> 관련: [쿠폰 무효화 API](./coupon-revoke-api.md)

## 1. 목적

파트너가 발급한 쿠폰을 회수해야 하는 경우가 있습니다
(계약 결렬, 오발급, 최종 결제 미완료 등).

- **미사용 쿠폰**은 `coupon_revoke` 로 회수합니다. (이미 구현 완료)
- **이미 사용된 쿠폰**은 회수가 의미 없습니다. 쿠폰을 무효화해도
  이미 그 쿠폰으로 생성된 **그룹은 계속 서비스가 이용 가능**하기 때문입니다.
  이 경우 실제로 서비스를 중단하려면 **그 그룹의 만료일(service_expire_at)을
  앞당겨 만료**시켜야 합니다.

현재 그룹 만료일을 변경하는 API가 없어, 사용 중 쿠폰은 회수할 방법이 없습니다.

그룹 ID로 만료일을 지정하는 **범용 API**를 요청합니다.
(만료 전용이 아니라, 만료일을 임의의 날짜로 설정 가능한 범용 형태)

## 2. Endpoint

```
POST /mDiary_app/group_set_expire/
Content-Type: application/x-www-form-urlencoded
```

## 3. 인증

기존 `coupon_create` / `coupon_revoke` 와 동일합니다.
`/mDiary_app/login/` 으로 발급받은 `ss_access_token` 을 Bearer 로 사용합니다.

```
Authorization: Bearer {ss_access_token}
```

## 4. 요청 파라미터

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `group_id` | O | 만료일을 변경할 그룹의 ID (= `mDiary_app_group.group_ptr_id`) |
| `service_expire_at` | O | 새 만료일 `YYYY-MM-DD`. 즉시 차단하려면 과거 날짜(예: 어제) |
| `reason` | X | 변경 사유 (감사 로그용, 최대 200자) |

> CRM은 `group_id` 를 이미 알고 있습니다.
> (쿠폰의 `used_group_id` = 그룹의 `group_ptr_id` 로 확보)

## 5. 응답 — 아래 3가지로 한정

### 5.1 성공

변경 후의 실제 만료일을 그대로 돌려주세요. CRM이 이 값으로 상태를 기록합니다.

```
HTTP 200
{
  "success": true,
  "group_id": 19485,
  "group_name": "…",
  "service_expire_at": "2026-07-24",
  "is_expired": true
}
```

- `is_expired`: `service_expire_at` 이 오늘 이전이면 `true`
  (CRM이 "만료됨/만료예정"을 구분해 표시하는 데 사용)
- 즉시 차단이 목적이면 CRM은 `service_expire_at` 에 **어제 날짜**를 보냅니다.
  오늘로 설정하면 당일 자정까지 이용 가능할 수 있어, 확실히 차단하기 위함입니다.

### 5.2 존재하지 않는 그룹

```
HTTP 404
{
  "success": false,
  "group_id": 19485,
  "error": "not_found",
  "message": "존재하지 않는 그룹입니다"
}
```

### 5.3 잘못된 날짜 형식

```
HTTP 400
{
  "success": false,
  "group_id": 19485,
  "error": "invalid_date",
  "message": "service_expire_at 형식이 올바르지 않습니다 (YYYY-MM-DD)"
}
```

## 6. 그 외 요구사항

- 그룹 행이나 소속 사용자 계정을 **삭제하지 말아 주세요.**
  만료일만 변경합니다. (만료 후에도 데이터·이력은 유지)
- 같은 요청이 재시도되어도 안전해야 합니다 (같은 날짜로 다시 호출 → 200 성공).
- 성공·실패와 무관하게 응답에 `group_id` 를 항상 포함해 주세요.

## 7. CRM 연동 계획

사용 중 쿠폰 회수 시:

1. CRM이 쿠폰의 그룹 정보(그룹명·멤버 수·관리자·현재 만료일)를 화면에 표시하고,
   운영자에게 "정말 이 그룹을 만료시키겠습니까?" 를 확인받습니다.
2. 되돌리기 어려운 동작이므로, 확인 버튼을 누르면 **최종 확인("정말로 진행합니다")을
   한 번 더** 표시합니다. (2단계 확인)
3. 최종 확인 시 `group_set_expire(group_id, 어제 날짜)` 를 호출해 즉시 차단합니다.
   (오늘이 아니라 어제로 설정 — 당일 잔여 이용을 막기 위함)
4. 응답의 `service_expire_at` / `is_expired` 를 발급 원장(`partner_licenses`)에 기록합니다.

---

## 부록 — CRM이 현재 확보 가능한 그룹 정보 (참고용, 전달 불필요)

`get-coupon-status` 가 mDiary에서 이미 아래를 조인해 가져오고 있습니다.
확인 다이얼로그에 그대로 노출할 수 있습니다.

| 정보 | 출처 |
|---|---|
| `used_group_id` (그룹 PK) | `mDiary_app_coupon.used_group_id` |
| 그룹명 | `auth_group.name` |
| 현재 만료일 | `mDiary_app_group.service_expire_at` |
| 소속(교육청) | `mDiary_app_eduoffice.name` |
| 관리자 이름 / 마지막 로그인 | `mDiary_app_customuser` (role=admin) |
| 멤버 수 | `mDiary_app_customuser` count |

실측 예시 (`PTINTY`): group_id=19485, 그룹명 `နှလုံးသား`,
멤버 3명, 관리자 `ဆရာ အောင်ကျော်`, 현재 만료일 2028-12-29.
