# Frontend SSE Integration Guide

이 문서는 프론트엔드에서 `GET /api/v1/events/stream` SSE를 안정적으로 연결하고, 이벤트를 화면 상태에 반영하기 위한 구현 가이드다.

## 1. 핵심 요약

| 항목 | 값 |
|------|-----|
| Endpoint | `GET /api/v1/events/stream` |
| 인증 | `Authorization: Bearer {session token}` |
| 응답 | `text/event-stream` |
| 연결 방식 | native `EventSource` 대신 `@microsoft/fetch-event-source` 사용 |
| keep-alive | 30초마다 `:keepalive` comment frame |
| delivery | best-effort. 누락 가능하므로 필요 시 화면 단위 refetch |
| 현재 제약 | 단일 API 인스턴스 메모리 fan-out. 다중 인스턴스 fan-out은 추후 Redis 계층 필요 |

Native `EventSource`는 브라우저 API에서 임의 `Authorization` header를 넣을 수 없다. 현재 백엔드는 Bearer header 인증 SSE endpoint이므로 프론트는 `@microsoft/fetch-event-source`를 사용한다. 이 라이브러리는 `fetch` 기반이라 Authorization header, AbortController, 재시도 제어를 자연스럽게 처리할 수 있다.

설치:

```bash
pnpm --filter frontend add @microsoft/fetch-event-source
```

## 2. 연결 시점과 종료 시점

연결 시작:

- 로그인 상태가 확인된 뒤 시작한다.
- 앱 전체에서 연결은 1개만 유지하는 것을 기본으로 한다.

연결 종료:

- 로그아웃 시 `AbortController.abort()`로 연결을 종료한다.
- 토큰 만료 또는 `401` 응답 시 로컬 토큰을 제거하고 로그인 화면으로 보낸다.
- 브라우저 탭 unload 시 별도 처리 없이 fetch abort 또는 브라우저 종료에 맡겨도 된다.

재연결:

- 네트워크 오류, 서버 재시작, stream 종료 시 지수 backoff로 재연결한다.
- 401은 재연결하지 않는다.
- SSE는 best-effort라 재연결 사이에 누락된 이벤트가 있을 수 있다. 재연결 후 현재 Space 또는 대시보드 데이터를 refetch하는 것이 안전하다.

## 3. TypeScript 타입

프론트에서 먼저 공통 envelope와 payload union을 정의한다.

```ts
export type RealtimeEventType =
  | 'SpaceCreated'
  | 'SpaceUpdated'
  | 'SpaceQuotaChanged'
  | 'SpaceDeleted'
  | 'MemberAdded'
  | 'MemberRemoved'
  | 'MemberRoleChanged'
  | 'SpaceInviteCreated'
  | 'SpaceInviteRevoked'
  | 'SpaceInviteAccepted'
  | 'FileUploaded'
  | 'UploadFinalizeFailed'
  | 'FileRenamed'
  | 'FileMoved'
  | 'FileDeleted'
  | 'FolderCreated'
  | 'FolderRenamed'
  | 'FolderMoved'
  | 'FolderDeleted'
  | 'ShareLinkCreated'
  | 'ShareLinkUpdated'
  | 'ShareLinkRevoked';

export interface RealtimeEventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: RealtimeEventType;
  eventVersion: number;
  occurredAt: string;
  spaceId: number | null;
  actorUserId: number | null;
  aggregateType: string | null;
  aggregateId: number | null;
  payload: TPayload;
}
```

자주 쓰는 payload 타입은 아래부터 시작한다.

```ts
export interface RealtimeFileEventPayload {
  fileItemId: number;
  spaceId: number;
  folderId: number;
  createdByUserId: number;
  displayName: string;
  storageProvider: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string | null;
  checksumSha256: string | null;
  fileStatus: string;
  previewStatus: string;
  scanStatus: string;
  updatedAt: string;
}

export interface RealtimeFolderEventPayload {
  folderId: number;
  spaceId: number;
  parentFolderId: number | null;
  createdByUserId: number;
  name: string;
  fullPath: string | null;
  updatedAt: string;
}

export interface RealtimeUploadFinalizeFailedPayload {
  uploadSessionId: number;
  spaceId: number;
  requesterUserId: number;
  targetFolderId: number;
  originalName: string;
  expectedSize: number;
  tusUploadId: string | null;
  errorCode: string;
  errorMessage: string;
  releasedReservedStorage: boolean;
  failedAt: string;
}
```

전체 payload schema는 [[sse-realtime-fanout]]를 기준으로 추가한다.

## 4. SSE client 예시

`apiFetch`는 JSON 응답 전용이고 timeout 기본값이 3초라 SSE에 사용하지 않는다. 별도 클라이언트를 만든다.

```ts
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

type RealtimeHandler = (event: RealtimeEventEnvelope) => void;
type RealtimeStatusHandler = (status: 'connecting' | 'open' | 'closed' | 'error') => void;

interface RealtimeClientOptions {
  onEvent: RealtimeHandler;
  onStatus?: RealtimeStatusHandler;
  onReconnect?: () => void;
  signal?: AbortSignal;
}

class FatalRealtimeError extends Error {}
class RetriableRealtimeError extends Error {}

export async function connectRealtimeStream(options: RealtimeClientOptions): Promise<void> {
  if (!token) {
    options.onStatus?.('closed');
    return;
  }

  options.onStatus?.('connecting');

  let retryAttempt = 0;

  await fetchEventSource(`${BASE_URL}/api/v1/events/stream`, {
    method: 'GET',
    headers: {
      Accept: EventStreamContentType,
      Authorization: `Bearer ${token}`,
    },
    signal: options.signal,
    openWhenHidden: true,
    async onopen(response) {
      if (response.status === 401) {
        window.location.href = '/login';
        throw new FatalRealtimeError('SSE authentication failed.');
      }

      if (!response.ok) {
        throw new RetriableRealtimeError(`SSE connection failed: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes(EventStreamContentType)) {
        throw new RetriableRealtimeError(`Unexpected SSE content type: ${contentType}`);
      }

      if (retryAttempt > 0) {
        options.onReconnect?.();
      }

      retryAttempt = 0;
      options.onStatus?.('open');
    },
    onmessage(message) {
      if (!message.data) return;

      const event = JSON.parse(message.data) as RealtimeEventEnvelope;
      options.onEvent(event);
    },
    onclose() {
      options.onStatus?.('closed');
      throw new RetriableRealtimeError('SSE connection closed.');
    },
    onerror(error) {
      if (options.signal?.aborted) {
        return;
      }

      if (error instanceof FatalRealtimeError) {
        throw error;
      }

      options.onStatus?.('error');

      const retryDelayMs = Math.min(30_000, 1000 * 2 ** retryAttempt);
      retryAttempt += 1;
      return retryDelayMs;
    },
  });
}
```

`fetch-event-source`가 SSE parser를 담당하므로 직접 `ReadableStream`을 파싱하지 않는다. 서버의 `:keepalive` comment frame은 업무 이벤트가 아니며 `onmessage`로 처리되지 않는다.

## 5. React hook 예시

```tsx
import { useEffect, useState } from 'react';

export function useRealtimeEvents(enabled: boolean) {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed');

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let stopped = false;

    async function run() {
      try {
        await connectRealtimeStream({
          signal: controller.signal,
          onStatus: setStatus,
          onEvent: handleRealtimeEvent,
          onReconnect: refetchVisibleData,
        });
      } catch {
        if (!controller.signal.aborted && !stopped) {
          setStatus('error');
        }
      }
    }

    void run();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled]);

  return status;
}
```

`enabled`는 `useAuthStore((s) => s.isAuthenticated)` 기준으로 넘기면 된다.

## 6. 이벤트별 UI 처리 기준

SSE 이벤트는 “정확한 단일 row patch”보다 “현재 화면 무효화 + 필요한 API refetch”를 기본으로 잡는 것이 안전하다. 이벤트가 best-effort이고 일부 payload가 UI 목록 DTO와 완전히 같지 않을 수 있기 때문이다.

| eventType | 권장 프론트 처리 |
|-----------|------------------|
| `SpaceCreated` | Space 목록 refetch |
| `SpaceUpdated` | Space 목록/현재 Space 상세/quota header refetch |
| `SpaceQuotaChanged` | 현재 Space quota refetch, dashboard storage card 갱신 |
| `SpaceDeleted` | Space 목록 refetch. 현재 보고 있는 Space면 목록 또는 홈으로 이동 |
| `MemberAdded` | 멤버 목록 refetch |
| `MemberRemoved` | 멤버 목록 refetch. 제거된 user가 현재 사용자면 해당 Space 접근 종료 처리 |
| `MemberRoleChanged` | 멤버 목록 refetch. 현재 사용자 Role이면 권한/라우팅 재평가 |
| `SpaceInviteCreated` | 초대 목록 refetch |
| `SpaceInviteRevoked` | 초대 목록 refetch |
| `SpaceInviteAccepted` | 멤버 목록 및 초대 목록 refetch |
| `FileUploaded` | 현재 Space의 폴더 목록 refetch. 현재 folderId와 payload.folderId가 같으면 목록 갱신 우선 |
| `UploadFinalizeFailed` | 업로드 알림 표시, 업로드 세션 상태 refetch, quota refetch |
| `FileRenamed` | 현재 폴더 목록 refetch. 파일 상세/preview cache 무효화 |
| `FileMoved` | 이전/현재 폴더 목록 refetch가 필요할 수 있으므로 현재 Space 파일 목록 refetch |
| `FileDeleted` | 현재 폴더 목록 refetch, trash 목록 refetch |
| `FolderCreated` | 현재 폴더 목록 refetch |
| `FolderRenamed` | 현재 폴더 목록 및 breadcrumb/tree refetch |
| `FolderMoved` | 현재 폴더 목록 및 tree refetch |
| `FolderDeleted` | 현재 폴더 목록 및 tree refetch |
| `ShareLinkCreated` | 공유 링크 목록/recent links refetch |
| `ShareLinkUpdated` | 공유 링크 목록/recent links refetch |
| `ShareLinkRevoked` | 공유 링크 목록/recent links refetch |

## 7. 이벤트 핸들러 예시

```ts
function handleRealtimeEvent(event: RealtimeEventEnvelope) {
  switch (event.eventType) {
    case 'FileUploaded':
    case 'FileRenamed':
    case 'FileMoved':
    case 'FileDeleted':
    case 'FolderCreated':
    case 'FolderRenamed':
    case 'FolderMoved':
    case 'FolderDeleted':
      invalidateFolderView(event.spaceId);
      break;

    case 'SpaceQuotaChanged':
      invalidateSpaceQuota(event.spaceId);
      break;

    case 'UploadFinalizeFailed': {
      const payload = event.payload as RealtimeUploadFinalizeFailedPayload;
      showUploadError(payload.originalName, payload.errorMessage);
      invalidateSpaceQuota(payload.spaceId);
      break;
    }

    case 'MemberRemoved': {
      const payload = event.payload as { userId: number; spaceId: number };
      invalidateMembers(payload.spaceId);
      if (isCurrentUser(payload.userId)) {
        leaveCurrentSpace(payload.spaceId);
      }
      break;
    }

    case 'SpaceDeleted':
      invalidateSpaces();
      if (isCurrentSpace(event.spaceId)) {
        redirectToSpaces();
      }
      break;

    default:
      invalidateSpaceScopedData(event.spaceId);
      break;
  }
}
```

현재 앱이 React Query를 쓰지 않고 Zustand 중심이면, invalidate 함수는 각 store의 reload action을 호출하거나 화면 컴포넌트에 “refresh token”을 올리는 방식으로 구현한다.

## 8. 중복 이벤트와 순서

프론트는 아래를 가정하면 안 된다.

- 이벤트가 반드시 한 번만 온다.
- 이벤트가 모든 탭에 반드시 도착한다.
- 이벤트 순서가 항상 사용자의 기대와 같다.
- 재연결 중 이벤트가 보존된다.

권장 처리:

- `eventId`를 최근 N개 저장해 같은 연결에서 중복 처리를 피한다.
- 이벤트 하나로 복잡한 상태를 직접 조립하지 말고 API refetch로 최종 상태를 맞춘다.
- optimistic UI가 이미 반영한 변경과 SSE가 다시 들어올 수 있으므로 idempotent하게 처리한다.

간단한 중복 방지:

```ts
const seenEventIds = new Set<string>();

function shouldHandle(eventId: string): boolean {
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  if (seenEventIds.size > 500) {
    const [first] = seenEventIds;
    seenEventIds.delete(first);
  }
  return true;
}
```

## 9. 운영상 주의점

- `apiFetch`를 재사용하지 않는다. SSE는 장기 연결이므로 timeout과 JSON parsing이 맞지 않는다.
- 한 탭에서 여러 연결을 만들지 않는다. 앱 root 또는 auth boundary에서 한 번만 연결한다.
- 탭이 여러 개면 각 탭마다 연결이 생긴다. 서버는 같은 user의 여러 연결에 모두 전송한다.
- upload progress 자체는 SSE 이벤트가 아니다. 현재 SSE는 finalize 성공(`FileUploaded`)과 finalize 실패(`UploadFinalizeFailed`)를 전달한다.
- `UploadFinalizeFailed`는 요청자에게만 온다. 같은 Space의 다른 멤버에게는 실패 이벤트가 가지 않는다.
- `MemberRemoved`는 제거된 사용자에게도 온다. 제거된 사용자는 해당 이벤트를 받으면 현재 Space 화면에서 빠져나와야 한다.
- `SpaceDeleted`는 삭제된 Space의 active member에게 전달된다. 현재 Space 화면이면 즉시 이탈 처리한다.
- 다중 API 인스턴스 운영 전에는 SSE 연결이 붙은 인스턴스와 outbox processor가 같은 인스턴스라는 전제가 있다.

## 10. 테스트 체크리스트

- 로그인 후 SSE 연결이 `open` 상태가 된다.
- 로그아웃 시 연결이 abort되고 더 이상 재연결하지 않는다.
- 서버 재시작 또는 네트워크 오류 후 backoff 재연결이 동작한다.
- `FileUploaded` 수신 시 현재 폴더 목록이 갱신된다.
- `UploadFinalizeFailed` 수신 시 업로드 실패 알림과 quota 갱신이 일어난다.
- `MemberRemoved`에서 현재 사용자가 제거 대상이면 Space 화면을 빠져나간다.
- `SpaceDeleted`에서 현재 Space가 삭제 대상이면 Space 목록 또는 홈으로 이동한다.
- keep-alive frame은 UI 이벤트로 표시되지 않는다.
