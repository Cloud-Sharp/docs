# SSE Realtime Fan-out 전략

## 1. 목적

Outbox에 기록된 도메인 이벤트를 인증된 브라우저 클라이언트에게 Server-Sent Events(SSE)로 실시간 전달한다. 서버 연결 저장소는 단일 API 인스턴스 메모리만 사용하며, Redis Pub/Sub나 다중 인스턴스 fan-out은 MVP 이후 확장 범위로 남긴다.

## 2. 가정

- 클라이언트 탭당 1개 SSE 연결을 전제한다.
- SSE 전달은 best-effort live update다. 연결이 없거나 channel overflow가 나면 DB outbox 재전송 보장을 추가하지 않는다.
- 서버 메모리 저장소는 단일 API 인스턴스 기준이다. 여러 API 인스턴스 fan-out은 이후 Redis Pub/Sub/Streams로 확장한다.
- 프론트엔드 코드는 이 문서 범위에 포함하지 않는다. EventSource는 Authorization header를 보낼 수 없으므로 현재 백엔드 계약은 header 인증 SSE endpoint이며, 프론트 연동은 `@microsoft/fetch-event-source`를 기준으로 한다.

## 3. 구성 요소

| 구성 요소 | 위치 | 책임 |
|-----------|------|------|
| `ISseConnectionStore` | `CloudSharp.Api.Realtime` | 인메모리 connection 추상화 |
| `SseConnectionStore` | `CloudSharp.Api.Realtime` | `connectionId`, `userId`, bounded channel, `connectedAt` 기준 연결 관리. userId 기준 전송, broadcast 제공 |
| `SseConnection` | `CloudSharp.Api.Realtime` | 단일 연결 record: `Guid ConnectionId`, `long UserId`, `Channel<string>`, `DateTimeOffset ConnectedAt` |
| `RealtimeFanoutOutboxEventDispatcher` | `CloudSharp.Api.Realtime` | `IOutboxEventDispatcher` 구현. `Target = RealtimeFanout`. outbox envelope를 SSE 메시지 JSON으로 변환 후 connection store에 전달 |
| `EventsEndpoints` | `CloudSharp.Api.Endpoints.Events` | `GET /api/v1/events/stream` endpoint. 인증 필요, `text/event-stream`, `no-cache`, keep-alive ping |

## 4. 연결 저장소

### 4.1 등록과 제거

```csharp
var connection = connectionStore.Register(userId);
connectionStore.Remove(connection.ConnectionId);
```

### 4.2 전송 메서드

| 메서드 | 설명 |
|--------|------|
| `SendToUser(long userId, string message)` | 해당 user의 모든 연결에 메시지를 쓴다. channel이 가득 차면 `DropWrite`로 drop한다. |
| `SendToUsers(IEnumerable<long> userIds, string message)` | userId 목록 각각에게 `SendToUser`를 호출한다. 중복 userId는 한 번만 전송한다. |
| `Broadcast(string message)` | 현재 인스턴스의 모든 연결에 메시지를 쓴다. |

### 4.3 Channel 설정

- `BoundedChannelOptions` 기본 용량: 128
- `FullMode = BoundedChannelFullMode.DropWrite`
- overflow 시 메시지를 버리고 계속 진행한다

## 5. SSE Endpoint

### 5.1 요청

```http
GET /api/v1/events/stream
Authorization: Bearer <session token>
Accept: text/event-stream
```

### 5.2 응답 헤더

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

인증이 없거나 세션 토큰이 유효하지 않으면 `401 Unauthorized`를 반환한다.

### 5.3 연결 생명주기

1. `RequireAuthorization()` filter를 통과한 사용자의 `userId`로 `connectionStore.Register(userId)`를 호출한다.
2. `Content-Type: text/event-stream` 및 캐시 방지 헤더를 설정한다.
3. `Response.StartAsync`로 헤더를 즉시 전송한다.
4. 단일 writer loop에서 channel message와 keep-alive timer tick을 함께 대기한다.
5. 읽은 메시지를 SSE wire format으로 변환해 response body에 기록한다.
6. 이벤트가 없으면 30초 간격으로 keep-alive comment frame을 전송한다.
7. `RequestAborted` 또는 클라이언트 disconnect 시 `finally`에서 `connectionStore.Remove(connectionId)`를 호출한다.

응답 body에 쓰는 경로는 반드시 하나여야 한다. keep-alive와 이벤트 전송이 서로 다른 task에서 같은 `Response.Body`에 동시에 write하면 SSE frame interleaving이 발생할 수 있으므로, 현재 구현은 `PeriodicTimer`와 channel read를 하나의 loop에서 처리한다.

### 5.4 Keep-alive frame

이벤트가 없는 연결은 30초마다 SSE comment frame을 받는다.

```text
:keepalive

```

클라이언트는 comment frame을 업무 이벤트로 처리하지 않는다.

### 5.5 SSE wire format

메시지 JSON의 `eventType` 필드를 SSE `event` 이름으로 사용한다.

```text
event: FileUploaded
data: {"eventId":"...","eventType":"FileUploaded",...}

```

SSE `data`는 항상 JSON object 한 개다. 클라이언트는 `event` 이름으로 분기할 수 있고, 동일한 값이 `data.eventType`에도 들어간다.

## 6. 이벤트 라우팅 정책

`RealtimeFanoutOutboxEventDispatcher.DispatchAsync`는 outbox envelope를 다음 정책으로 routing한다.

### 6.1 개인 이벤트

`UploadFinalizeFailed`는 payload의 `requesterUserId`에게만 전송한다.

```json
{"requesterUserId": 10}
```

### 6.2 스페이스 이벤트

`spaceId`가 있는 이벤트는 `ISpaceMemberUseCases.FindMembersAsync(spaceId)`로 active member(`SpaceMemberStatus.Active`)의 `userId` 목록을 구해 전송한다.

대상 이벤트:

- `SpaceCreated`, `SpaceUpdated`, `SpaceQuotaChanged`, `SpaceDeleted`
- `MemberAdded`, `MemberRoleChanged`
- `SpaceInviteCreated`, `SpaceInviteRevoked`, `SpaceInviteAccepted`
- `FileUploaded`, `FileRenamed`, `FileMoved`, `FileDeleted`
- `FolderCreated`, `FolderRenamed`, `FolderMoved`, `FolderDeleted`
- `ShareLinkCreated`, `ShareLinkUpdated`, `ShareLinkRevoked`

`SpaceDeleted`는 이미 삭제된 Space의 멤버를 조회해야 하므로 `allowDeletedSpace = true`로 멤버 목록을 조회한다. 다른 space 이벤트는 삭제된 Space를 허용하지 않는다.

### 6.3 멤버 제거 이벤트

`MemberRemoved`는 active member 목록에 제거된 `payload.userId`를 추가해 전송한다. 제거된 사용자는 더 이상 active member가 아니지만, 자신의 UI 갱신을 위해 이벤트를 받아야 한다.

### 6.4 전체 broadcast

`connectionStore.Broadcast`는 store에 제공하되, 현재 outbox event type에는 기본 매핑하지 않는다. 필요 시 registry 또는 custom dispatcher에서 직접 사용할 수 있다.

### 6.5 전달 불가 이벤트

라우팅 정책에 맞지 않는 이벤트(예: `spaceId`도 없고 `UploadFinalizeFailed`도 아닌 unknown event)는 `Result.Fail`을 반환하고, error code는 `OUTBOX_REALTIME_EVENT_NOT_ROUTABLE`이다. 이 경우 outbox processing use case가 `FAILED` 상태로 기록한다.

## 7. Event Envelope

SSE `data`는 다음 JSON envelope 형식을 따른다.

```json
{
  "eventId": "1a8593de-c0e0-4fa4-9e86-c0e4e209a0d2",
  "eventType": "FileUploaded",
  "eventVersion": 1,
  "occurredAt": "2026-05-13T03:15:00Z",
  "spaceId": 10,
  "actorUserId": 7,
  "aggregateType": "FileItem",
  "aggregateId": 55,
  "payload": {}
}
```

- `payload` 원문은 deserialize하지 않고 `JsonDocument`로 감싸 `JsonNode`로 삽입한다.
- `payload` 필드는 outbox payload record가 `JsonSerializerOptions.Web`으로 저장된 camelCase JSON이다.
- `eventId`는 UUID 문자열이다.
- `eventVersion`은 현재 `1`이다.
- `aggregateType`은 `Space`, `SpaceMember`, `SpaceInvite`, `FileItem`, `Folder`, `ShareLink`, `UploadSession` 중 하나다.
- `aggregateId`는 aggregate DB id다.
- `spaceId`는 Space 범위가 없는 이벤트에서는 `null`일 수 있다. 현재 realtime fan-out 대상 이벤트는 `UploadFinalizeFailed`를 제외하고 Space 범위를 가진다.
- `actorUserId`는 사용자 행위로 발생한 이벤트의 행위자다. 시스템 또는 내부 hook 처리 이벤트에서는 `null`일 수 있다.

### 7.1 Envelope 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `eventId` | `string(uuid)` | outbox 이벤트 고유 ID |
| `eventType` | `string` | SSE event 이름과 동일 |
| `eventVersion` | `number` | 이벤트 schema version. 현재 `1` |
| `occurredAt` | `string(date-time)` | 도메인 이벤트 발생 시각 |
| `spaceId` | `number?` | 이벤트가 속한 Space ID |
| `actorUserId` | `number?` | 행위자 user ID |
| `aggregateType` | `string?` | 변경된 aggregate 종류 |
| `aggregateId` | `number?` | 변경된 aggregate ID |
| `payload` | `object` | eventType별 payload |

## 8. 이벤트 카탈로그

| eventType | aggregateType | payload schema | 수신자 | 발생 조건 |
|-----------|---------------|----------------|--------|-----------|
| `SpaceCreated` | `Space` | `SpaceEventPayload` | 생성된 Space의 active member | Space 생성 완료 |
| `SpaceUpdated` | `Space` | `SpaceEventPayload` | Space active members | Space 이름/설명 변경 |
| `SpaceQuotaChanged` | `Space` | `SpaceQuotaChangedPayload` | Space active members | Space quota 변경 |
| `SpaceDeleted` | `Space` | `SpaceEventPayload` | 삭제된 Space의 active members | Space 소프트 삭제 |
| `MemberAdded` | `SpaceMember` | `MemberEventPayload` | Space active members | Space 멤버 추가 |
| `MemberRemoved` | `SpaceMember` | `MemberEventPayload` | Space active members + 제거된 user | Space 멤버 나가기 또는 제거 |
| `MemberRoleChanged` | `SpaceMember` | `MemberEventPayload` | Space active members | Space 멤버 Role 변경 |
| `SpaceInviteCreated` | `SpaceInvite` | `SpaceInviteEventPayload` | Space active members | 초대 링크 생성 |
| `SpaceInviteRevoked` | `SpaceInvite` | `SpaceInviteEventPayload` | Space active members | 초대 링크 폐기 |
| `SpaceInviteAccepted` | `SpaceInvite` | `SpaceInviteAcceptedPayload` | Space active members | 초대 링크 수락 |
| `FileUploaded` | `FileItem` | `FileEventPayload` | Space active members | 업로드 finalize 성공 및 파일 생성 |
| `UploadFinalizeFailed` | `UploadSession` | `UploadFinalizeFailedPayload` | `payload.requesterUserId`의 모든 연결 | 업로드 finalize 실패 |
| `FileRenamed` | `FileItem` | `FileEventPayload` | Space active members | 파일명 변경 |
| `FileMoved` | `FileItem` | `FileEventPayload` | Space active members | 파일 폴더 이동 |
| `FileDeleted` | `FileItem` | `FileEventPayload` | Space active members | 파일 삭제 |
| `FolderCreated` | `Folder` | `FolderEventPayload` | Space active members | 폴더 생성 |
| `FolderRenamed` | `Folder` | `FolderEventPayload` | Space active members | 폴더명 변경 |
| `FolderMoved` | `Folder` | `FolderEventPayload` | Space active members | 폴더 이동 |
| `FolderDeleted` | `Folder` | `FolderEventPayload` | Space active members | 폴더 삭제 |
| `ShareLinkCreated` | `ShareLink` | `ShareLinkEventPayload` | Space active members | 공유 링크 생성 |
| `ShareLinkUpdated` | `ShareLink` | `ShareLinkEventPayload` | Space active members | 공유 링크 옵션 변경 |
| `ShareLinkRevoked` | `ShareLink` | `ShareLinkEventPayload` | Space active members | 공유 링크 폐기 |

## 9. Payload schemas

### 9.1 SpaceEventPayload

`SpaceCreated`, `SpaceUpdated`, `SpaceDeleted`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `spaceId` | `number` | Space ID |
| `slug` | `string` | URL path용 Space slug |
| `name` | `string` | Space 이름 |
| `description` | `string?` | Space 설명 |
| `storageAllowedBytes` | `number?` | 허용 저장 용량. `null`이면 무제한 |
| `storageUsedBytes` | `number` | 사용 중인 용량 |
| `storageReservedBytes` | `number` | 예약된 용량 |
| `status` | `string` | Space 상태 |
| `ownerUserId` | `number` | 소유자 user ID |
| `updatedAt` | `string(date-time)` | 최종 변경 시각 |

### 9.2 SpaceQuotaChangedPayload

`SpaceQuotaChanged`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `spaceId` | `number` | Space ID |
| `storageAllowedBytes` | `number?` | 변경 후 허용 저장 용량 |
| `storageUsedBytes` | `number` | 변경 시점 사용 용량 |
| `storageReservedBytes` | `number` | 변경 시점 예약 용량 |
| `availableBytes` | `number?` | 사용 가능 용량. 무제한이면 `null` |
| `usageRate` | `number` | 사용률 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

### 9.3 MemberEventPayload

`MemberAdded`, `MemberRemoved`, `MemberRoleChanged`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `memberId` | `number` | SpaceMember ID |
| `spaceId` | `number` | Space ID |
| `userId` | `number` | 대상 user ID |
| `role` | `string` | `Owner`, `Admin`, `Member`, `Viewer` 등 도메인 Role 문자열 |
| `status` | `string` | `Active`, `Left` 등 도메인 상태 문자열 |
| `joinedAt` | `string(date-time)?` | 참여 시각 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

### 9.4 SpaceInviteEventPayload

`SpaceInviteCreated`, `SpaceInviteRevoked`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `inviteId` | `number` | SpaceInvite ID |
| `spaceId` | `number` | Space ID |
| `inviterUserId` | `number` | 초대 생성자 user ID |
| `expiresAt` | `string(date-time)?` | 만료 시각 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

### 9.5 SpaceInviteAcceptedPayload

`SpaceInviteAccepted`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `inviteId` | `number` | SpaceInvite ID |
| `spaceId` | `number` | Space ID |
| `inviterUserId` | `number` | 초대 생성자 user ID |
| `acceptedUserId` | `number` | 수락한 user ID |
| `memberId` | `number` | 생성된 SpaceMember ID |
| `role` | `string` | 수락으로 부여된 Role |
| `acceptedAt` | `string(date-time)` | 수락 시각 |

### 9.6 FileEventPayload

`FileUploaded`, `FileRenamed`, `FileMoved`, `FileDeleted`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `fileItemId` | `number` | FileItem ID |
| `spaceId` | `number` | Space ID |
| `folderId` | `number` | 현재 폴더 ID |
| `createdByUserId` | `number` | 파일 생성자 user ID |
| `displayName` | `string` | 표시 파일명 |
| `storageProvider` | `string` | 저장소 provider |
| `storageKey` | `string` | 저장소 내부 key |
| `sizeBytes` | `number` | 파일 크기 |
| `mimeType` | `string?` | MIME type |
| `checksumSha256` | `string?` | SHA-256 checksum |
| `fileStatus` | `string` | 파일 상태 |
| `previewStatus` | `string` | 미리보기 상태 |
| `scanStatus` | `string` | 스캔 상태 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

### 9.7 UploadFinalizeFailedPayload

`UploadFinalizeFailed`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `uploadSessionId` | `number` | UploadSession ID |
| `spaceId` | `number` | Space ID |
| `requesterUserId` | `number` | 업로드 요청자 user ID. 이 user에게만 전송 |
| `targetFolderId` | `number` | 업로드 대상 폴더 ID |
| `originalName` | `string` | 원본 파일명 |
| `expectedSize` | `number` | 예상 파일 크기 |
| `tusUploadId` | `string?` | tus upload ID |
| `errorCode` | `string` | 실패 error code |
| `errorMessage` | `string` | 실패 메시지 |
| `releasedReservedStorage` | `boolean` | 예약 용량 해제 여부 |
| `failedAt` | `string(date-time)` | 실패 시각 |

### 9.8 FolderEventPayload

`FolderCreated`, `FolderRenamed`, `FolderMoved`, `FolderDeleted`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `folderId` | `number` | Folder ID |
| `spaceId` | `number` | Space ID |
| `parentFolderId` | `number?` | 부모 Folder ID. root면 `null` |
| `createdByUserId` | `number` | 폴더 생성자 user ID |
| `name` | `string` | 폴더명 |
| `fullPath` | `string?` | 전체 경로 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

### 9.9 ShareLinkEventPayload

`ShareLinkCreated`, `ShareLinkUpdated`, `ShareLinkRevoked`에서 사용한다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `shareLinkId` | `number` | ShareLink ID |
| `spaceId` | `number` | Space ID |
| `createdByUserId` | `number` | 공유 링크 생성자 user ID |
| `targetType` | `string` | `File` 또는 `Folder` |
| `fileItemId` | `number?` | 파일 공유 대상 ID |
| `folderId` | `number?` | 폴더 공유 대상 ID |
| `title` | `string?` | 공유 링크 제목 |
| `status` | `string` | 공유 링크 상태 |
| `hasPassword` | `boolean` | 비밀번호 설정 여부 |
| `allowDownload` | `boolean` | 다운로드 허용 여부 |
| `allowPreview` | `boolean` | 미리보기 허용 여부 |
| `expiresAt` | `string(date-time)?` | 만료 시각 |
| `maxDownloadCount` | `number?` | 최대 다운로드 횟수 |
| `downloadAttemptCount` | `number` | 다운로드 시도 횟수 |
| `downloadCompletedCount` | `number` | 다운로드 완료 횟수 |
| `revokedAt` | `string(date-time)?` | 폐기 시각 |
| `updatedAt` | `string(date-time)` | 변경 시각 |

## 10. 예시

### 10.1 FileUploaded

```text
event: FileUploaded
data: {"eventId":"1a8593de-c0e0-4fa4-9e86-c0e4e209a0d2","eventType":"FileUploaded","eventVersion":1,"occurredAt":"2026-05-13T03:15:00Z","spaceId":10,"actorUserId":7,"aggregateType":"FileItem","aggregateId":55,"payload":{"fileItemId":55,"spaceId":10,"folderId":2,"createdByUserId":7,"displayName":"report.pdf","storageProvider":"local","storageKey":"spaces/10/objects/aa/bb/report.pdf","sizeBytes":1048576,"mimeType":"application/pdf","checksumSha256":null,"fileStatus":"Active","previewStatus":"Pending","scanStatus":"Pending","updatedAt":"2026-05-13T03:15:00Z"}}

```

### 10.2 UploadFinalizeFailed

```text
event: UploadFinalizeFailed
data: {"eventId":"4ad84a9f-1790-4eb7-b6ed-916cdd776652","eventType":"UploadFinalizeFailed","eventVersion":1,"occurredAt":"2026-05-13T03:20:00Z","spaceId":10,"actorUserId":7,"aggregateType":"UploadSession","aggregateId":99,"payload":{"uploadSessionId":99,"spaceId":10,"requesterUserId":7,"targetFolderId":2,"originalName":"report.pdf","expectedSize":1048576,"tusUploadId":"abc123","errorCode":"FILE_NAME_CONFLICT","errorMessage":"File name already exists.","releasedReservedStorage":true,"failedAt":"2026-05-13T03:20:00Z"}}

```

## 11. DI 등록

```csharp
builder.Services.AddSingleton<ISseConnectionStore, SseConnectionStore>();
builder.Services.AddScoped<IOutboxEventDispatcher, RealtimeFanoutOutboxEventDispatcher>();
```

`SseConnectionStore`는 singleton이다. `RealtimeFanoutOutboxEventDispatcher`는 scoped(`ISpaceMemberUseCases`가 scoped dependency를 사용하므로)이며, `IOutboxEventDispatcher`로 등록된다. outbox processing background service는 scoped scope를 생성해 dispatcher를 resolve한다.

## 12. 확장

### 12.1 Redis Pub/Sub fan-out (미구현)

다중 API 인스턴스를 운영할 때:

1. `RealtimeFanoutOutboxEventDispatcher`는 Redis Pub/Sub에 publish한다.
2. 각 API 인스턴스는 Redis subscribe service를 띄워 메시지를 수신한다.
3. 수신한 메시지를 로컬 `ISseConnectionStore`에 전달한다.

### 12.2 Worker dispatcher (미구현)

`FileUploaded`는 현재 MVP에서 `RealtimeFanout` only로 라우팅한다. Worker dispatcher가 구현되면 `Worker | RealtimeFanout`으로 복원할 수 있다.

## 13. 테스트 기준

필수 테스트 범위:

- connection store: register/remove, user별 전송, broadcast, multi-tab 동일 user
- dispatcher: `UploadFinalizeFailed`는 requester에게만, space 이벤트는 active members에게, `MemberRemoved`는 제거된 user 포함, `SpaceDeleted`는 삭제된 Space의 멤버에게 전달, unknown event는 failed Result
- outbox processing: `FileUploaded`가 `RealtimeFanout` only일 때 realtime dispatcher만으로 claim 가능
- integration: 인증 없으면 401, 인증 있으면 200 + `text/event-stream`, disconnect 시 connection 제거

대표 검증 명령:

```bash
dotnet test tests/CloudSharp.Api.Tests --filter "FullyQualifiedName~SseConnectionStoreTests"
dotnet test tests/CloudSharp.Api.Tests --filter "FullyQualifiedName~RealtimeFanoutDispatcherTests"
dotnet test tests/CloudSharp.Core.Tests --filter "FullyQualifiedName~OutboxProcessingUseCasesTests"
dotnet test tests/CloudSharp.Api.IntegrationTests --filter "FullyQualifiedName~EventsEndpointTests"
```
