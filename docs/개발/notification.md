# Notification 영속 Inbox 전략

## 1. 목적

Notification은 사용자가 놓친 이벤트를 나중에 다시 확인할 수 있는 영속 inbox다. Outbox와 SSE는 실시간 전달을 담당하고, Notification은 DB에 남는 알림 목록과 읽음 위치를 담당한다.

MVP 설계는 알림 발생 시 수신자별 row를 복제하지 않는다. `notifications` row 1건이 개인 또는 Space 범위를 나타내고, 조회 시점에 현재 사용자가 볼 수 있는 알림만 필터링한다. 읽음 상태는 사용자별 마지막 읽은 `notification.id` 커서로 저장한다.

Notification 생성은 업무 UseCase에서 직접 수행하지 않고, Outbox processing의 `NotificationProjection` dispatcher가 outbox event를 영속 알림으로 projection한다.

---

## 2. 설계 원칙

| 원칙 | 설명 |
|------|------|
| 영속 inbox | SSE 연결이 없었거나 브라우저가 닫혀 있어도 나중에 알림 목록을 조회할 수 있어야 한다 |
| 이벤트 1건 저장 | Space 알림은 멤버별 복제 없이 `space_id`를 가진 row 1건으로 저장한다 |
| 조회 시점 권한 | Space 알림 노출 여부는 현재 active membership 기준으로 판단한다 |
| 커서 기반 읽음 | 개별 read receipt 대신 사용자별 마지막 읽은 notification id를 저장한다 |
| Outbox projection | 업무 UseCase는 outbox event만 기록하고, Notification dispatcher가 알림을 생성한다 |
| Idempotent 생성 | 같은 outbox event가 retry되어도 notification row는 한 번만 생성되어야 한다 |

---

## 3. 데이터 모델

### 3.1 `notifications`

알림 본문과 수신 범위를 저장한다.

| 컬럼 | 타입 | Null | 설명 |
|------|------|------|------|
| `id` | BIGINT | NOT NULL | PK, 정렬과 cursor 기준 |
| `notification_id` | UUID | NOT NULL | 외부 노출용 안정 식별자, UNIQUE |
| `type` | VARCHAR(100) | NOT NULL | 알림 타입. 예: `FileUploaded`, `SpaceInviteAccepted` |
| `title` | VARCHAR(200) | NOT NULL | 알림 제목 |
| `message` | TEXT | NOT NULL | 알림 메시지 |
| `payload` | JSONB | NOT NULL | 타입별 상세 데이터. 기본값 `{}` |
| `recipient_user_id` | BIGINT | NULL | 개인 알림 대상 user |
| `space_id` | BIGINT | NULL | Space 알림 대상 Space |
| `actor_user_id` | BIGINT | NULL | 알림을 유발한 사용자 |
| `aggregate_type` | VARCHAR(100) | NULL | 변경된 aggregate 종류 |
| `aggregate_id` | BIGINT | NULL | 변경된 aggregate id |
| `outbox_event_id` | BIGINT | NULL | 원인이 된 outbox event id. dispatcher 생성 알림은 필수 |
| `occurred_at` | TIMESTAMPTZ | NOT NULL | 업무 이벤트 발생 시각 |
| `created_at` | TIMESTAMPTZ | NOT NULL | 알림 row 생성 시각 |
| `expires_at` | TIMESTAMPTZ | NULL | 알림 만료 시각. NULL이면 만료 없음 |

대상 규칙:

- `space_id IS NOT NULL`이면 Space active members에게 보이는 알림이다.
- `space_id IS NULL`이면 `recipient_user_id` 개인에게만 보이는 알림이다.
- `recipient_user_id`와 `space_id`는 둘 중 정확히 하나만 가져야 한다.
- Space 알림은 발생 시점 멤버 목록을 복제하지 않는다.

권장 제약:

| 제약 | 내용 |
|------|------|
| PK | `id` |
| UNIQUE | `notification_id` |
| FK | `recipient_user_id -> users.id` (`ON DELETE CASCADE`) |
| FK | `space_id -> spaces.id` (`ON DELETE CASCADE`) |
| FK | `actor_user_id -> users.id` (`ON DELETE SET NULL`) |
| FK | `outbox_event_id -> outbox_events.id` (`ON DELETE RESTRICT`) |
| CHECK | `(recipient_user_id IS NOT NULL AND space_id IS NULL) OR (recipient_user_id IS NULL AND space_id IS NOT NULL)` |

권장 인덱스:

| 인덱스 | 목적 |
|--------|------|
| `idx_notifications_recipient_id_desc` on `(recipient_user_id, id DESC)` where `recipient_user_id IS NOT NULL` | 개인 알림 목록과 unread count |
| `idx_notifications_space_id_desc` on `(space_id, id DESC)` where `space_id IS NOT NULL` | Space 알림 목록과 unread count |
| `idx_notifications_type_occurred_at` on `(type, occurred_at DESC)` | 운영/디버깅 |
| `ux_notifications_outbox_event_id` on `(outbox_event_id)` where `outbox_event_id IS NOT NULL` | 같은 outbox event로 notification이 중복 생성되지 않도록 보장 |

### 3.2 `notification_read_positions`

사용자별 마지막 읽은 위치를 저장한다.

| 컬럼 | 타입 | Null | 설명 |
|------|------|------|------|
| `id` | BIGINT | NOT NULL | PK |
| `user_id` | BIGINT | NOT NULL | 읽음 위치 소유자 |
| `scope_type` | VARCHAR(30) | NOT NULL | `GLOBAL` 또는 `SPACE` |
| `space_id` | BIGINT | NULL | `SPACE` scope일 때 대상 Space |
| `last_read_notification_id` | BIGINT | NOT NULL | 마지막으로 읽은 `notifications.id` |
| `last_read_at` | TIMESTAMPTZ | NOT NULL | 클라이언트가 읽음 처리한 시각 |
| `updated_at` | TIMESTAMPTZ | NOT NULL | row 갱신 시각 |

Scope 정책:

| Scope | 의미 |
|-------|------|
| `GLOBAL` | 사용자가 볼 수 있는 전체 알림의 마지막 읽음 위치 |
| `SPACE` | 특정 Space 알림만 별도로 읽음 처리할 때 사용 |

MVP 기본값은 `GLOBAL`이다. Space별 unread badge가 필요하면 같은 테이블에 `SPACE` scope row를 추가로 사용한다.

권장 제약:

| 제약 | 내용 |
|------|------|
| PK | `id` |
| FK | `user_id -> users.id` (`ON DELETE CASCADE`) |
| FK | `space_id -> spaces.id` (`ON DELETE CASCADE`) |
| FK | `last_read_notification_id -> notifications.id` (`ON DELETE RESTRICT`) |
| UNIQUE | `user_id, scope_type` where `scope_type = 'GLOBAL'` |
| UNIQUE | `user_id, scope_type, space_id` where `scope_type = 'SPACE'` |
| CHECK | `scope_type = 'GLOBAL'`이면 `space_id IS NULL` |
| CHECK | `scope_type = 'SPACE'`이면 `space_id IS NOT NULL` |

---

## 4. 조회와 읽음 정책

### 4.1 Visible notification

사용자 `userId`가 볼 수 있는 알림은 다음 조건의 합집합이다.

```sql
recipient_user_id = userId
OR space_id IN (
  SELECT space_id
  FROM space_members
  WHERE user_id = userId
    AND status = 'Active'
)
```

`spaceId` query parameter가 있으면 visible notification 중 해당 Space 알림만 반환한다. `spaceId`가 없으면 개인 알림과 사용자가 접근 가능한 모든 Space 알림을 함께 반환한다.

멤버가 Space를 나가거나 제거되면 현재 active membership이 아니므로 해당 Space 알림은 과거 알림도 조회되지 않는다. 이 정책은 수신자 복제를 하지 않는 MVP 모델의 의도된 동작이다.

### 4.2 Cursor paging

목록 조회는 `id DESC` 기준이다.

- `cursor`가 없으면 최신 알림부터 조회한다.
- `cursor`가 있으면 `id < cursor` 조건으로 다음 페이지를 조회한다.
- 응답의 `nextCursor`는 반환된 마지막 row의 `id`다.
- `limit` 기본값은 `30`, 최대값은 `100`을 권장한다.

### 4.3 Unread 판정

`GLOBAL` scope 기준 unread 조건은 다음과 같다.

```sql
visible_notification.id > last_read_notification_id
```

read position row가 없으면 `last_read_notification_id = 0`으로 간주한다. `unreadOnly=true`이면 visible notification 조회에 unread 조건을 추가한다.

`SPACE` scope를 사용할 때는 `space_id = requestedSpaceId`인 알림에 대해 해당 Space read position을 적용한다. Space별 scope가 없으면 `last_read_notification_id = 0`으로 간주한다.

### 4.4 Read position 갱신

읽음 위치 갱신은 upsert로 처리한다.

- 클라이언트는 읽음 처리할 `lastReadNotificationId`를 보낸다.
- 서버는 해당 notification이 현재 사용자에게 visible한지 확인한다.
- 기존 값보다 작은 id로 되돌리는 요청은 성공으로 처리하되 저장하지 않는다.
- `spaceId`가 없는 요청은 `GLOBAL` scope를 갱신한다.
- `spaceId`가 있는 요청은 해당 Space active member인지 확인한 뒤 `SPACE` scope를 갱신한다.

---

## 5. 백엔드 구성

| 구성 요소 | 위치 | 책임 |
|-----------|------|------|
| `Notification` | `CloudSharp.Core.Domain.Notifications` | 알림 도메인 모델과 대상 규칙 |
| `NotificationReadPosition` | `CloudSharp.Core.Domain.Notifications` | 사용자별 읽음 커서 모델 |
| `INotificationRepository` | `CloudSharp.Core.Abstractions.Persistence` | 알림 저장, visible 목록 조회, unread count, read position upsert |
| `NotificationRepository` | `CloudSharp.Infrastructure.Persistence.Repositories` | EF Core 기반 구현 |
| `INotificationUseCases` / `NotificationUseCases` | `CloudSharp.Core.UseCases.Notifications` | 알림 생성, 목록 조회, unread count, 읽음 처리 |
| `NotificationProjectionOutboxEventDispatcher` | `CloudSharp.Api.Outbox` 또는 `CloudSharp.Api.Notifications` | `IOutboxEventDispatcher` 구현. outbox envelope를 notification 생성 command로 변환 |
| `NotificationProjectionPolicy` | `CloudSharp.Core.UseCases.Notifications` | notification을 만들 outbox event type과 제목/메시지/payload 매핑 정책 |
| `NotificationsEndpoints` | `CloudSharp.Api.Endpoints.Notifications` | Minimal API endpoint |

UseCase 규칙:

- API DTO를 Core UseCase로 넘기지 않는다.
- Space 알림 조회와 읽음 처리는 Space active membership 검증을 포함한다.
- 업무 UseCase는 notification repository를 직접 호출하지 않는다.
- Notification 생성은 `NotificationProjectionOutboxEventDispatcher`가 `INotificationUseCases.CreateFromOutboxEventAsync` 같은 projection 전용 use case를 호출해 수행한다.
- 시스템 장애는 예외로 두고, 권한 없음/대상 없음/검증 실패는 `Result` 실패로 반환한다.

Outbox/SSE와의 관계:

- Outbox event는 realtime fan-out, worker dispatch, notification projection의 원천이다.
- Notification은 outbox event를 영속 inbox로 남기는 projection이다.
- `OutboxDispatchTarget.NotificationProjection`을 추가하고, 알림이 필요한 event type만 이 target에 라우팅한다.
- `NotificationProjectionOutboxEventDispatcher.Target`은 `NotificationProjection`이다.
- 같은 outbox event에서 notification을 만들 때는 `outbox_event_id`를 저장하고 unique index로 중복 생성을 막는다.
- dispatcher는 unique violation 또는 기존 row 발견을 성공으로 처리해 retry에 안전해야 한다.
- 한 outbox event가 `NotificationProjection | RealtimeFanout`을 동시에 가지면 Notification dispatcher를 먼저 실행하는 것을 권장한다. Notification 실패 후 realtime만 먼저 나가는 상황을 줄이기 위해서다.
- SSE payload는 live update이고, notification payload는 목록/상세 표시용이므로 필요한 필드만 안정적으로 저장한다.

---

## 6. API 계약

모든 endpoint는 인증이 필요하다. 응답은 domain/EF entity가 아니라 DTO만 반환한다.

### 6.1 목록 조회

```http
GET /api/v1/notifications?limit=30&cursor=123&unreadOnly=false&spaceId=10
Authorization: Bearer <session token>
```

Query parameters:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `limit` | number | 아니오 | 기본 `30`, 최대 `100` |
| `cursor` | number | 아니오 | 이전 페이지 마지막 `notification.id`. 없으면 최신 페이지 |
| `unreadOnly` | boolean | 아니오 | 기본 `false` |
| `spaceId` | number | 아니오 | nullable. 없으면 전체 visible 알림, 있으면 해당 Space 알림만 조회 |

Response:

```json
{
  "items": [
    {
      "id": 123,
      "notificationId": "3d50b852-5fd6-4918-8e97-423d31c10d72",
      "type": "FileUploaded",
      "title": "새 파일이 업로드되었습니다.",
      "message": "report.pdf",
      "payload": {},
      "recipientUserId": null,
      "spaceId": 10,
      "actorUserId": 7,
      "aggregateType": "FileItem",
      "aggregateId": 55,
      "occurredAt": "2026-05-14T03:15:00Z",
      "createdAt": "2026-05-14T03:15:01Z",
      "expiresAt": null,
      "isUnread": true
    }
  ],
  "nextCursor": 123
}
```

Failure statuses:

| 상태 | 조건 |
|------|------|
| `400 Bad Request` | query validation 실패 |
| `401 Unauthorized` | 인증 없음 또는 세션 만료 |
| `403 Forbidden` | 지정한 `spaceId`에 대한 active membership 없음 |

### 6.2 Unread count

```http
GET /api/v1/notifications/unread-count?spaceId=10
Authorization: Bearer <session token>
```

`spaceId`는 nullable이다. 없으면 전체 visible unread count를 반환하고, 있으면 해당 Space unread count를 반환한다.

Response:

```json
{
  "count": 12
}
```

### 6.3 Read position 갱신

```http
POST /api/v1/notifications/read-position
Authorization: Bearer <session token>
Content-Type: application/json
```

Request:

```json
{
  "spaceId": null,
  "lastReadNotificationId": 123
}
```

`spaceId`는 nullable이다. `null`이면 `GLOBAL` scope를 갱신하고, 값이 있으면 해당 Space의 `SPACE` scope를 갱신한다.

Response:

```json
{
  "scopeType": "GLOBAL",
  "spaceId": null,
  "lastReadNotificationId": 123,
  "lastReadAt": "2026-05-14T03:20:00Z"
}
```

Failure statuses:

| 상태 | 조건 |
|------|------|
| `400 Bad Request` | body validation 실패 |
| `401 Unauthorized` | 인증 없음 또는 세션 만료 |
| `403 Forbidden` | 지정한 `spaceId`에 대한 active membership 없음 |
| `404 Not Found` | `lastReadNotificationId`가 없거나 현재 사용자에게 visible하지 않음 |

---

## 7. Projection 대상 이벤트 예시

MVP에서 모든 outbox event를 notification으로 만들 필요는 없다. `OutboxEventRouteRegistry`에서 사용자에게 inbox로 남길 가치가 있는 이벤트만 `NotificationProjection` target에 포함한다.

| outbox eventType | notification type | 대상 | 예시 메시지 |
|------------------|-------------------|------|-------------|
| `FileUploaded` | `FileUploaded` | Space | 새 파일이 업로드되었습니다 |
| `FolderCreated` | `FolderCreated` | Space | 새 폴더가 생성되었습니다 |
| `ShareLinkCreated` | `ShareLinkCreated` | Space | 공유 링크가 생성되었습니다 |
| `SpaceInviteAccepted` | `SpaceInviteAccepted` | Space | 초대 링크가 수락되었습니다 |
| `MemberAdded` | `MemberAdded` | Space | 새 멤버가 추가되었습니다 |
| `UploadFinalizeFailed` | `UploadFinalizeFailed` | 개인 | 파일 업로드를 완료하지 못했습니다 |

알림 `type`은 outbox `eventType`과 같게 둘 수 있지만 필수는 아니다. UI 표시 정책에 따라 여러 outbox event를 하나의 notification type으로 묶을 수 있다.

Projection 매핑 규칙:

- Space 이벤트는 outbox envelope의 `spaceId`를 `notifications.space_id`로 저장한다.
- 개인 이벤트는 payload에서 대상 user id를 뽑아 `recipient_user_id`로 저장한다. 예: `UploadFinalizeFailed.payload.requesterUserId`.
- `actor_user_id`, `aggregate_type`, `aggregate_id`, `occurred_at`은 outbox envelope 값을 그대로 복사한다.
- payload는 UI 표시와 상세 이동에 필요한 안정 필드만 저장한다.
- projection 정책에 없는 event type은 notification을 만들지 않고 dispatcher 성공으로 처리한다.

---

## 8. 테스트 기준

### 8.1 Core unit tests

- 개인 알림 생성 검증
- Space 알림 생성 검증
- `recipient_user_id`와 `space_id` 대상 규칙 검증
- outbox envelope에서 notification 생성 command로 매핑하는 projection policy 검증
- 마지막 ID 커서 기반 unread 계산 검증
- 낮은 `lastReadNotificationId`로 read position이 되돌아가지 않는지 검증

### 8.2 Infrastructure tests

- `outbox_event_id` unique index로 중복 notification 생성을 막는지 검증
- visible notification query가 개인 알림과 active member Space 알림만 반환하는지 검증
- nullable `spaceId` 필터가 없을 때 전체 visible 알림, 있을 때 해당 Space 알림만 반환하는지 검증
- `last_read_notification_id` upsert 검증
- unread count가 read position 기준으로 감소하는지 검증
- `id DESC` 정렬과 cursor paging 검증

### 8.3 API integration tests

- 인증 없으면 `401`
- 알림 목록 조회 성공
- `spaceId` 생략 조회와 지정 조회 성공
- unread count 계산
- read position 갱신 후 unread count 감소
- 다른 Space의 알림은 조회되지 않음
- 접근 권한 없는 `spaceId` 지정 시 `403`

### 8.4 Outbox dispatcher tests

- `NotificationProjectionOutboxEventDispatcher.Target`이 `NotificationProjection`인지 검증
- projection 대상 event type은 notification 생성 use case를 호출하는지 검증
- projection 대상이 아닌 event type은 no-op 성공으로 처리하는지 검증
- 같은 outbox event 재전달 시 중복 생성 없이 성공하는지 검증
- notification 생성 실패 시 outbox processing이 retry할 수 있도록 실패 `Result`를 반환하는지 검증

대표 검증 명령:

```bash
dotnet test tests/CloudSharp.Core.Tests --filter "FullyQualifiedName~Notification"
dotnet test tests/CloudSharp.Infrastructure.Tests --filter "FullyQualifiedName~Notification"
dotnet test tests/CloudSharp.Api.Tests --filter "FullyQualifiedName~NotificationProjectionOutboxEventDispatcher"
dotnet test tests/CloudSharp.Api.IntegrationTests --filter "FullyQualifiedName~NotificationsEndpoint"
dotnet build
```

---

## 9. 구현 순서

1. Core domain 모델과 repository/use case contract를 추가한다.
2. EF entity, configuration, migration을 추가한다.
3. repository visible query와 read position upsert를 구현한다.
4. use case에서 권한, paging, unread 계산, read position 갱신을 조합한다.
5. Minimal API endpoint와 validator를 추가한다.
6. `OutboxDispatchTarget.NotificationProjection`과 `NotificationProjectionOutboxEventDispatcher`를 추가한다.
7. `OutboxEventRouteRegistry`에서 notification이 필요한 event type에 `NotificationProjection` target을 추가한다.
8. dispatcher가 호출할 projection policy와 notification 생성 use case를 연결한다.
9. Core, Infrastructure, API, API integration test를 추가한다.

---

## 10. 제외 범위

- 사용자별 notification row 복제
- 알림별 개별 read receipt
- 알림 삭제/숨김 API
- push notification 또는 email 발송
- 프론트엔드 UI 구현
- 다중 API 인스턴스용 Redis 기반 notification fan-out
- 업무 UseCase에서 notification을 직접 생성하는 흐름
