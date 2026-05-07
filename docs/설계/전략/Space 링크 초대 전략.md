# Space 링크 초대 전략

> **문서 분류:** 멤버십 초대 정책 / 링크 토큰 관리
> **상태:** 확정

---

## 1. 개요

Space 초대는 특정 사용자나 이메일을 지정하지 않는 **링크 기반 초대**로 운영한다. 초대 링크를 받은 로그인 사용자는 유효 기간 안에 링크를 수락해 해당 Space의 `VIEWER` 멤버가 된다.

| 항목 | 정책 |
|------|------|
| 초대 대상 | 특정 사용자 지정 없음 |
| 링크 사용 | 만료 전까지 재사용 가능 |
| 수락 기본 Role | `VIEWER` 고정 |
| 토큰 저장 | 원문 저장 금지, `token_hash`만 저장 |
| 원문 토큰 노출 | 생성 응답에서 1회만 노출 |
| 폐기 방식 | `space_invites` row 삭제 |
| 만료 방식 | `expires_at` 기준 계산, `NULL`이면 만료 없음 |

---

## 2. DB 모델

`space_invites`는 링크 자체의 발급 기록만 저장한다.

| 컬럼 | 설명 |
|------|------|
| `id` | 초대 링크 식별자 |
| `space_id` | 대상 Space |
| `inviter_user_id` | 링크를 발급한 사용자 |
| `token_hash` | 초대 토큰 해시, UNIQUE |
| `expires_at` | 만료 시각, `NULL`이면 만료 없음 |
| `created_at` | 생성 일시 |
| `updated_at` | 수정 일시 |

`invitee_user_id`, `invitee_email`, `role`, `status`, `accepted_at`은 저장하지 않는다. 링크는 여러 사용자가 수락할 수 있으므로 수락 상태를 초대 row에 기록하지 않는다.

---

## 3. 토큰 정책

- 초대 토큰 원문은 충분히 긴 난수로 생성한다.
- 서버는 원문 토큰을 저장하지 않고 해시만 저장한다.
- 클라이언트가 원문 토큰을 다시 확인할 수 있는 시점은 생성 응답뿐이다.
- 관리용 목록/상세 조회는 `inviteToken`이나 `inviteUrl`을 반환하지 않는다.
- 수락 전 조회와 수락은 요청의 `inviteToken`을 해시한 뒤 `token_hash`로 조회한다.

---

## 4. API 정책

| API | 목적 | 권한 |
|-----|------|------|
| `POST /api/v1/spaces/{spaceSlug}/invites` | 초대 링크 생성 | `ADMIN` 이상 |
| `GET /api/v1/spaces/{spaceSlug}/invites` | Space 초대 링크 목록 조회 | `ADMIN` 이상 |
| `GET /api/v1/spaces/{spaceSlug}/invites/{inviteId}` | 관리용 초대 상세 조회 | `ADMIN` 이상 |
| `GET /api/v1/invites/{inviteToken}` | 수락 전 초대 상세 조회 | 로그인 사용자 |
| `POST /api/v1/invites/accept` | 초대 수락 | 로그인 사용자 |

관리용 조회 API는 초대 링크의 메타데이터만 반환한다. 토큰 기반 수락 전 조회 API는 사용자가 링크를 열었을 때 Space 이름, Space slug, 만료 여부, 이미 멤버인지 여부, 수락 시 부여될 Role을 표시하기 위한 계약이다.

---

## 5. 수락 정책

초대 수락은 다음 순서로 처리한다.

1. 요청 토큰을 해시한다.
2. `token_hash`로 초대 링크를 조회한다.
3. `expires_at`이 현재 시각 이하이면 만료로 거부한다.
4. 사용자가 이미 해당 Space 멤버이면 기존 멤버십을 반환한다.
5. 멤버가 아니면 `VIEWER` Role의 `ACTIVE` 멤버십을 생성한다.

같은 링크는 여러 사용자가 수락할 수 있다. 한 사용자가 같은 링크를 반복 수락해도 중복 멤버 row를 만들지 않는다.

---

## 6. 폐기와 감사

명시적 폐기는 `space_invites` row 삭제로 처리한다. 삭제된 링크는 토큰 조회와 수락 모두에서 존재하지 않는 초대로 처리한다.

서버는 최소한 아래 이벤트를 감사 로그 대상으로 본다.

- Space 초대 링크 생성
- Space 초대 링크 폐기
- Space 초대 링크 수락 성공
- Space 초대 링크 수락 실패

