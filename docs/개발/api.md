# CloudSharp API 명세

이 문서는 [기능 요구사항](../설계/기능요구사항.md), [ERD 설계서](../설계/db/ERD%20설계서.md), [업로드 파이프라인](../설계/pipeline/업로드%20파이프라인.md), [다운로드 파이프라인](../설계/pipeline/다운로드%20파이프라인.md), 전략 문서를 바탕으로 정리한 구현 기준 API 계약이다.

ReDoc 렌더 버전은 [API(구현 기준)](api-redoc.md)에서 확인한다.

## 1. 문서 기준

| 항목 | 값 |
|---|---|
| 내부 인증 API base path | `/api/v1` |
| 외부 공개 API base path | `/public/v1` |
| 인증 방식 | `Authorization: Bearer {opaque_session_token}` |
| 기본 데이터 형식 | `application/json` |
| 파일 다운로드 응답 | `application/octet-stream` 또는 서버 판별 MIME |
| 실시간 이벤트 응답 | `text/event-stream` |
| API 리소스 ID | 응답의 `id`, `fileId` 등은 외부 계약 기준 문자열로 취급 |
| Space URL 식별자 | `/api/v1/spaces/{spaceSlug}` 의 `spaceSlug` |
| 시간 표기 | UTC 기준 ISO 8601 문자열 |
| 업로드 전송 프로토콜 | tus 1.0.0 |

### 1.1 구현 상태 기준

이 문서는 실제 백엔드 구현과 MVP 미구현 계약을 함께 추적한다. `구현됨`은 `CloudSharp.Api`에 현재 매핑된 엔드포인트이고, `내부 구현됨`은 서비스 내부 또는 tusd hook 전용 엔드포인트이며, `미구현`은 계약 초안만 남아 있는 API다.

| 상태 | 의미 |
|---|---|
| `구현됨` | 현재 API 앱에서 외부 클라이언트가 호출할 수 있도록 매핑됨 |
| `내부 구현됨` | 내부 인증 정책 또는 tusd hook 전용으로 매핑됨 |
| `deprecated 구현됨` | 하위 호환을 위해 매핑되어 있으나 신규 클라이언트 사용은 권장하지 않음 |
| `미구현` | 계약 초안은 남아 있으나 아직 `CloudSharp.Api` 엔드포인트가 없음 |

## 2. 공통 계약

### 2.1 인증과 권한

| Role | Space 조회 | 업로드 | 파일/폴더 수정 | 공유 링크 생성 | 초대 링크/멤버 변경 | Quota 변경 | Space 삭제 |
|---|---|---|---|---|---|---|---|
| `OWNER` | O | O | O | O | O | O | O |
| `ADMIN` | O | O | O | O | O | X | X |
| `MEMBER` | O | O | O | O | X | X | X |
| `VIEWER` | O | X | X | X | X | X | X |

- 내부 API는 명시되지 않은 경우 모두 opaque session Bearer 인증이 필요하다.
- 사용자 세션 토큰은 Redis에 저장된 `UserSession`을 기준으로 검증하며, Space 권한은 요청마다 최신 `SpaceMember`/`Role`을 조회해 판단한다.
- 외부 공유 API는 `shareToken`과 필요한 경우 비밀번호로 접근한다.
- 외부 공개 경로에서는 권한 없음과 리소스 없음, 비활성화, 격리 상태를 가능한 한 `404 Not Found`로 마스킹한다.

### 2.2 응답 형식

- 성공 응답은 리소스 중심 JSON을 사용한다. 공통 `data` envelope 는 두지 않는다.
- 실패 응답은 아래 형식을 사용한다.

```json
{
  "requestId": "req_01JXYZ...",
  "error": {
    "code": "FILE_NAME_CONFLICT",
    "message": "같은 이름의 파일이 이미 존재합니다.",
    "details": [
      {
        "field": "displayName",
        "reason": "conflict"
      }
    ]
  }
}
```

### 2.3 공통 쿼리 규칙

| 항목 | 기본값 | 설명 |
|---|---|---|
| `page` | `1` | 1-base 페이지 번호 |
| `pageSize` | `50` | 최대 `100` |
| `sortBy` | `updatedAt` | 엔드포인트별 지원값만 허용 |
| `sortDir` | `desc` | `asc`, `desc` |
| `q` | 없음 | 검색어 |

### 2.4 업로드/다운로드 정책

- 업로드 시작 전에는 `used + reserved + expectedSize <= allowed` 공식을 기준으로 quota를 검사한다.
- 업로드 세션 생성 이후 바이너리 전송은 tus 서버가 담당하고, 애플리케이션 API는 세션 생성과 상태 조회만 담당한다.
- finalize 는 자동 처리이며, 별도 사용자 호출 finalize API는 두지 않는다.
- 다운로드 세션은 발급 시점 권한 기준으로 최대 5분 동안 유효하며, 발급 후 즉시 revoke는 지원하지 않는다.
- 미리보기는 `GET /api/v1/spaces/{spaceSlug}/files/{fileId}/preview` 한 경로로 통합하고, 형식별 결과는 `kind` 필드로 구분한다.

### 2.5 대표 비즈니스 에러 코드

| 코드 | 설명 |
|---|---|
| `AUTH_REQUIRED` | 인증 토큰 누락 또는 만료 |
| `INVALID_CREDENTIALS` | 로그인 실패 |
| `SPACE_ACCESS_DENIED` | Space 접근 권한 없음 |
| `FILE_NAME_CONFLICT` | 동일 폴더 내 파일명 충돌 |
| `FOLDER_NAME_CONFLICT` | 동일 부모 폴더 내 폴더명 충돌 |
| `QUOTA_EXCEEDED` | 업로드 시작 전 quota 초과 |
| `QUOTA_EXCEEDED_FINALIZE` | finalize 직전 quota 재검사 실패 |
| `UPLOAD_SESSION_EXPIRED` | 업로드 세션 만료 |
| `DOWNLOAD_NOT_AVAILABLE` | 삭제, 손상, 격리 등으로 다운로드 불가 |
| `SHARE_LINK_EXPIRED` | 공유 링크 만료 |
| `SHARE_LINK_PASSWORD_REQUIRED` | 비밀번호가 필요한 공유 링크 |
| `SHARE_LINK_PASSWORD_INVALID` | 공유 링크 비밀번호 불일치 |
| `UNSUPPORTED_PREVIEW_TYPE` | 미리보기 미지원 형식 |
| `TAG_NOT_FOUND` | 태그가 없거나 현재 Space에서 접근할 수 없음 |
| `TAG_NAME_CONFLICT` | 같은 Space에 동일한 활성 태그명이 있음 |
| `TAG_INVALID_COLOR` | 태그 색상이 `#RRGGBB` 형식이 아님 |
| `FILE_TAG_SPACE_MISMATCH` | 파일과 태그가 같은 Space에 속하지 않음 |
| `NOTIFICATION_NOT_FOUND` | 알림 또는 읽음 처리 대상 알림을 찾을 수 없음 |
| `NOTIFICATION_INVALID_TARGET` | 알림 대상 범위가 유효하지 않음 |
| `NOTIFICATION_INVALID_LAST_READ_NOTIFICATION_ID` | 마지막 읽은 알림 ID가 유효하지 않음 |
| `NOTIFICATION_SAVE_CONFLICT` | 알림 저장 중 중복 또는 동시성 충돌 |
| `MCP_TOKEN_NOT_FOUND` | MCP token을 찾을 수 없거나 현재 사용자가 소유하지 않음 |
| `MCP_TOKEN_INVALID_NAME` | MCP token 이름이 비어 있거나 길이 제한을 초과함 |
| `MCP_TOKEN_INVALID_EXPIRATION` | MCP token 만료 기간이 허용 범위를 벗어남 |

## 3. 기능 요구사항 추적표

| SFR | 반영 위치 |
|---|---|
| `SFR-001` | `POST /api/v1/auth/register` |
| `SFR-002` | `POST /api/v1/auth/login` |
| `SFR-003` | `POST /api/v1/auth/logout` |
| `SFR-004` | 내부 인증 API 공통 계약 |
| `SFR-005` | `POST /api/v1/me` |
| `SFR-006~010` | `GET/POST/PATCH/DELETE /api/v1/spaces*` |
| `SFR-011~015` | Space 링크 초대/멤버 API |
| `SFR-016~017` | `GET/PATCH /api/v1/spaces/{spaceSlug}/quota` |
| `SFR-018~022` | 폴더 목록/생성/수정/삭제 API |
| `SFR-023` | `POST /api/v1/spaces/{spaceSlug}/upload-sessions` |
| `SFR-024` | tus 업로드 흐름 + `GET /api/v1/spaces/{spaceSlug}/upload-sessions/{token}` |
| `SFR-025` | 업로드 상태 조회 응답의 `fileItemId` 및 후처리 확장 필드 |
| `SFR-026` | `POST /api/v1/spaces/{spaceSlug}/files/{fileId}/download-sessions` + 공개 stream API |
| `SFR-027~029` | `PATCH/DELETE /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| `SFR-030` | 폴더 목록/검색 API의 `sortBy`, `sortDir` |
| `SFR-031` | `GET /api/v1/spaces/{spaceSlug}/search` |
| `SFR-032~034` | `POST/PATCH/DELETE /api/v1/share-links*` |
| `SFR-035` | `POST /public/v1/share-links/{shareToken}/verify` |
| `SFR-036` | `POST /public/v1/share-links/{shareToken}/browse`, `.../download-sessions` |
| `SFR-037~040` | `GET /api/v1/spaces/{spaceSlug}/files/{fileId}/preview` |
| `SFR-041~042` | Space quota 조회 + 업로드 세션 생성 전 사전 검증 |
| `SFR-043` | `GET /api/v1/admin/spaces`, `GET /api/v1/admin/spaces/{spaceId}/usage` |
| `SFR-044~045` | `FileItem.metadata`, `previewStatus`, `scanStatus`, `tags`, [파일 태그 설계](strategies/file-tags.md) |
| `SFR-049~051` | `GET/POST/DELETE /api/v1/spaces/{spaceSlug}/trash/files*` |
| `SFR-046` | `FileUploaded` SSE 이벤트 및 내부 finalize 이벤트 기록 |
| `SFR-047` | MCP/AI 확장 미구현 계약 |
| `SFR-048` | 감사 로그 정책 섹션 |

## 4. 도메인별 API

### 4.1 인증 및 사용자

| Method | Path | 설명 | 관련 SFR | 구현 상태 |
|---|---|---|---|---|
| `GET` | `/api/v1/health` | Docker/API health check | - | `구현됨` |
| `POST` | `/api/v1/auth/register` | 계정 생성 및 세션 토큰 발급 | `SFR-001` | `구현됨` |
| `POST` | `/api/v1/auth/login` | 사용자 세션 토큰 발급 | `SFR-002` | `구현됨` |
| `POST` | `/api/v1/auth/logout` | 현재 토큰 무효화 | `SFR-003` | `구현됨` |
| `GET` | `/api/v1/me` | 내 프로필 조회 | `SFR-005` | `구현됨` |
| `POST` | `/api/v1/me` | 내 프로필 조회 legacy endpoint | `SFR-005` | `deprecated 구현됨` |

**요청/응답 핵심 필드**

| 객체 | 필드 |
|---|---|
| `RegisterRequest` | `email`, `username`, `displayName`, `password` 모두 필수 |
| `LoginRequest` | `loginId`, `password` |
| `AuthResponse` | `accessToken`, `tokenType`, `expiresInSeconds`, `user` |
| `UserProfile` | `id`, `email`, `username?`, `displayName`, `systemRole`, `createdAt` |

`AuthResponse.accessToken`은 권한 claim을 담은 self-contained token이 아니라 opaque session token이다. 토큰 원문은 클라이언트에 한 번만 반환하고, 서버는 Redis에 `token_hash` 기반 세션만 저장한다.
`POST /api/v1/me` 는 하위 호환을 위해 남아 있는 legacy endpoint 이며 신규 클라이언트는 `GET /api/v1/me` 를 사용한다.

### 4.2 Space 및 quota

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/spaces` | 내가 속한 Space 목록 조회 | `VIEWER` | `SFR-006` | `구현됨` |
| `POST` | `/api/v1/spaces` | Space 생성 | 로그인 사용자 | `SFR-007` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}` | Space 상세 조회 | `VIEWER` | `SFR-008` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}` | 이름/설명 변경 | `ADMIN` | `SFR-009` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}` | 소프트 삭제 또는 비활성화 | `OWNER` | `SFR-010` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/quota` | quota 조회 | `VIEWER` | `SFR-016`, `SFR-041` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/quota` | quota 변경 | `OWNER` | `SFR-017` | `구현됨` |

**계약 요약**

- `storageAllowedBytes = null` 이면 무제한 Space 이다.
- Space 단건 및 하위 리소스 URL은 `{spaceSlug}` 를 사용한다.
- Space 응답의 `id` 는 DB `Space.id` 를 그대로 반영하는 bigint 값이다.
- 응답 payload의 `spaceId` 는 DB `Space.id` 를 그대로 반영하는 bigint 값이다.
- `slug` 필드는 URL path 접근에 사용하는 값을 반환한다.
- `GET /api/v1/spaces` 의 현재 구현 기본값은 `page = 1`, `pageSize = 20` 이다.
- `GET /quota` 응답에는 `storageUsedBytes`, `storageReservedBytes`, `availableBytes`, `usageRate`를 포함한다.
- `PATCH /quota`는 현재 `used + reserved` 보다 작은 값으로 낮출 수 없다.

### 4.3 Space 멤버 및 초대

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `POST` | `/api/v1/spaces/{spaceSlug}/invites` | Space 초대 링크 생성 | `ADMIN` | `SFR-011` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/invites` | Space 초대 링크 목록 조회 | `ADMIN` | `SFR-011` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/invites/{inviteToken}` | Space 초대 링크 폐기 | `ADMIN` | `SFR-011` | `구현됨` |
| `GET` | `/api/v1/invites/{inviteToken}` | 수락 전 초대 상세 조회 | 로그인 사용자 | `SFR-012` | `구현됨` |
| `POST` | `/api/v1/invites/accept` | 초대 수락 | 로그인 사용자 | `SFR-012` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/leave` | 현재 사용자가 Space에서 나가기 | `VIEWER` | `SFR-015` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/members` | 멤버 목록 조회 | `ADMIN` | `SFR-013` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/members/{memberId}` | 멤버 Role 변경 | `ADMIN` | `SFR-014` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/members/{memberId}` | 멤버 제거 | `ADMIN` | `SFR-015` | `구현됨` |

**계약 요약**

- 초대 생성 요청은 `expiresAt`만 선택적으로 받는다. 수락 기본 Role은 `VIEWER`로 고정한다.
- 초대 링크는 만료 전까지 여러 사용자가 재사용할 수 있다.
- 서버는 초대 토큰 원문을 저장한다. 현재 물리 컬럼명은 `token_hash`를 유지하지만 값은 원문 초대 토큰이다.
- 관리용 초대 목록 조회는 토큰 원문을 재노출하지 않고 `id`, `spaceId`, `inviterUserId`, `expiresAt`, `isExpired`, `createdAt`, `updatedAt`만 반환한다. `id`는 `integer(int64)`이다.
- 수락 전 초대 상세 조회는 `inviteToken` path parameter를 사용하며 Space 이름/slug, 만료 여부, 이미 멤버인지 여부, 수락 시 부여될 `VIEWER` Role을 반환한다.
- 초대 수락 요청은 `inviteToken`만 받는다.
- 명시적 초대 폐기는 `inviteToken` path parameter를 사용하며, 서버가 토큰 원문으로 찾은 row를 삭제한다. 삭제된 링크는 조회/수락 모두에서 존재하지 않는 초대로 취급한다.
- 멤버 나가기와 제거는 `SpaceMember.status = LEFT`, `deletedAt = now`로 처리하는 소프트 제거이다.
- `OWNER` 제거, `OWNER`를 `OWNER` 외 Role로 강등, 자기 자신을 마지막 `OWNER`에서 제거하는 동작은 금지한다.
- `OWNER`는 `/leave`로 직접 나갈 수 없고, 멤버 제거 API의 대상도 될 수 없다.

### 4.4 폴더 탐색 및 검색

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceSlug}/folders/{folderId}/children` | 자식 파일/폴더 목록 조회 | `VIEWER` | `SFR-018`, `SFR-030` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/folders` | 폴더 생성 | `MEMBER` | `SFR-019` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/folders/{folderId}` | 폴더명 변경 또는 이동 | `MEMBER` | `SFR-020`, `SFR-021` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/folders/{folderId}` | 폴더 삭제 | `MEMBER` | `SFR-022` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/search` | 파일/폴더 기본 검색 | `VIEWER` | `SFR-031` | `구현됨` |

**계약 요약**

- 루트 탐색은 `folderId = root` 를 사용한다.
- 현재 구현된 목록 정렬 쿼리는 `sortBy = Name | Size | UpdatedAt`, `sortDirection = Asc | Desc` 이다.
- 현재 구현된 검색 쿼리는 `q` 필수, `type = all | file | folder`, `sortBy = name | size | updatedAt | updated_at`, `sortDir = asc | desc`, `page` 기본값 `1`, `pageSize` 기본값 `50` 및 최대 `100` 이다.
- 파일 태그 구현 후 폴더 children 응답의 파일 항목에는 `tags: TagSummary[]` 를 포함한다.
- 파일 태그 구현 후 검색 API는 `tagIds=1,2`, `tagMatch=any|all` 태그 필터를 지원한다. 태그 필터가 있으면 파일 결과만 반환한다.
- `parentFolderId` 는 요청에서 문자열로 받으며, 숫자 문자열 또는 `null` 만 유효하다.
- `PATCH /folders/{folderId}` 는 `name` 과 `parentFolderId` 를 동시에 받을 수 있다.
- 폴더 삭제 정책은 기본적으로 소프트 삭제이며, 하위 항목 존재 시 `409 Conflict` 또는 비동기 삭제 정책 중 하나로 처리한다.

### 4.5 파일 메타데이터, 업로드, 후처리

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceSlug}/files/{fileId}` | 파일 상세/메타데이터 조회 | `VIEWER` | `SFR-044`, `SFR-045` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/files/{fileId}/thumbnail` | 파일 썸네일 바이너리 조회 | `VIEWER` | `SFR-044`, `SFR-045` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/files/{fileId}` | 파일명 변경 또는 폴더 이동 | `MEMBER` | `SFR-027`, `SFR-028` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/files/{fileId}` | 파일 삭제 | `MEMBER` | `SFR-029` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/tags` | Space 태그 목록 조회 | `VIEWER` | `SFR-044`, `SFR-045` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/tags` | Space 태그 생성 | `ADMIN` | `SFR-044`, `SFR-045` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/tags/{tagId}` | Space 태그 수정 | `ADMIN` | `SFR-044`, `SFR-045` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/tags/{tagId}` | Space 태그 삭제 | `ADMIN` | `SFR-044`, `SFR-045` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일에 태그 추가 | `MEMBER` | `SFR-044`, `SFR-045` | `구현됨` |
| `PUT` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일 태그 전체 교체 | `MEMBER` | `SFR-044`, `SFR-045` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일에서 태그 제거 | `MEMBER` | `SFR-044`, `SFR-045` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/trash/files` | 휴지통 파일 목록 조회 | `MEMBER` | `SFR-049` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/trash/files/{fileId}/restore` | 휴지통 파일 복원 | `MEMBER` | `SFR-050` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/trash/files/{fileId}` | 휴지통 파일 영구삭제 | `MEMBER` | `SFR-051` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/upload-sessions` | 업로드 세션 생성 | `MEMBER` 이상 + `UploadFile` 권한 | `SFR-023`, `SFR-042` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/upload-sessions/{token}` | 업로드 세션 상태 조회 | `MEMBER` 이상 + `UploadFile` 권한 | `SFR-024`, `SFR-025` | `구현됨` |
| `POST` | `/api/internal/uploads/uploading` | tus 전송 시작/진행 상태 반영 | 내부 인증 | `SFR-024` | `내부 구현됨` |
| `POST` | `/api/internal/uploads/finalize` | 업로드 finalize 및 최종 파일 생성 | 내부 인증 | `SFR-024`, `SFR-046` | `내부 구현됨` |
| `POST` | `/internal/tusd/hooks` | tusd HTTP hook 수신 | tusd hook | `SFR-024`, `SFR-046` | `내부 구현됨` |

**업로드 흐름**

1. `POST /api/v1/spaces/{spaceSlug}/upload-sessions` 호출
2. 응답의 `token` 으로 생성된 업로드 세션을 식별한다.
3. 업로드 완료 후 서버가 자동 finalize 수행
4. `GET /api/v1/spaces/{spaceSlug}/upload-sessions/{token}` 로 `FINALIZING`, `COMPLETED`, `FAILED` 상태 확인

**업로드 세션 생성 요청**

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `targetFolderId` | `integer(int64)` | Y | 업로드 대상 폴더 ID |
| `originalName` | `string` | Y | 원본 파일명, 최대 255자 |
| `expectedSize` | `integer(int64)` | Y | 예상 파일 크기, 1 이상 |
| `clientMimeType` | `string?` | N | 클라이언트가 전달한 MIME type, 최대 255자 |
| `checksum` | `string?` | N | 클라이언트 체크섬, 최대 64자 |

`spaceId` 는 요청 body로 받지 않는다. Space 범위는 URL의 `spaceSlug` 와 인증 사용자 멤버십으로 결정한다.

**업로드 세션 생성/상태 조회 응답 핵심 필드**

| 필드 | 설명 |
|---|---|
| `token` | 업로드 세션 토큰. 생성 응답의 `Location` 헤더는 `/api/v1/spaces/{spaceSlug}/upload-sessions/{token}` |
| `status` | `CREATED`, `UPLOADING`, `FINALIZING`, `COMPLETED`, `FAILED`, `ABORTED`, `EXPIRED` |
| `requesterUserId` | 세션 생성 사용자 ID |
| `targetFolderId` | 업로드 대상 폴더 ID |
| `originalName` | 원본 파일명 |
| `expectedSize` | 예상 파일 크기 |
| `receivedSize` | 서버가 인지한 진행량 |
| `tempStorageKey` | 임시 저장 키. 생성 직후에는 `null` 일 수 있음 |
| `tusUploadId` | tus 업로드 식별자. 생성 직후에는 `null` 일 수 있음 |
| `fileItemId` | 완료 시 최종 파일 ID |
| `createdAt` / `completedAt` | 세션 생성/완료 시각 |
| `fileReservationItem` | `status`, `spaceId`, `targetFolderId`, `reservedName`, `reservedBytes`, `isReserved`, `fileItemId`, `expiresAt` |

`fileReservationItem.status` 는 `RESERVED`, `ACTIVE`, `CONSUMED`, `CANCELLED`, `EXPIRED`, `FAILED` 중 하나다.

**내부 업로드 API 요청/응답**

| API | 요청 핵심 필드 | 성공 응답 |
|---|---|---|
| `POST /api/internal/uploads/uploading` | `tusUploadId`, `receivedSizeBytes?` | `204 No Content` |
| `POST /api/internal/uploads/finalize` | `tusUploadId`, `finalSizeBytes`, `clientMimeType?`, `tempStorageKey?` | `200 OK`, `CompleteUploadResult { fileItem }` |
| `POST /internal/tusd/hooks` | tusd hook payload: `type`, `event.upload`, `event.httpRequest` | tusd hook response: `httpResponse?`, `rejectUpload?`, `rejectTermination?`, `changeFileInfo?`, `stopUpload?` |

**후처리 정책**

- `scanStatus = PENDING` 이어도 기본 다운로드는 허용한다.
  - `scanStatus = FAILED` 또는 감염 탐지 시 `fileStatus = QUARANTINED` 로 전환하고 다운로드를 차단한다.
  - `previewStatus = FAILED` 는 미리보기 실패일 뿐 다운로드 차단 사유가 아니다.

**파일 태그 정책**

- 상세 설계는 [파일 태그 설계](strategies/file-tags.md)를 기준으로 한다.
- 태그는 Space에 종속되며, 파일에 붙이기 전에 `/api/v1/spaces/{spaceSlug}/tags` 로 먼저 생성되어야 한다.
- 태그 생성 요청의 핵심 필드는 `name`, `color` 이며 둘 다 필수다. `name`은 1자 이상 30자 이하, `color`는 `#RRGGBB` 형식이다. 예: `{ "name": "프로젝트", "color": "#4A90E2" }`
- 태그와 파일-태그 매핑의 식별자는 `integer(int64)`이다.
- `GET /folders/{folderId}/children`의 파일 항목은 `tags: TagSummary[]` 배열을 포함한다.
- 파일 태그 추가/교체/제거 요청은 `fileId`와 `tagIds: long[]`를 받으며, 응답은 `fileId`, `tags`를 반환한다.
- `GET /search`의 `tagIds`, `tagMatch` 쿼리 필터는 아직 요청 모델에 없으며 전략 초안으로만 남아 있다.

**파일 상세/썸네일 정책**

- 파일 상세 응답은 `metadataJson`, `thumbnailStatus`, `metadataStatus`, `accessStatus`를 포함한다.
- `thumbnailStatus`와 `metadataStatus`는 `PENDING`, `PROCESSING`, `DONE`, `FAILED`, `UNSUPPORTED`, `UNKNOWN` 중 하나다.
- 썸네일 조회는 `image/jpeg` 바이너리를 반환한다. 썸네일이 없거나 지원하지 않는 파일이면 `404 Not Found`로 응답한다.

### 4.6 휴지통

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceSlug}/trash/files` | 휴지통 파일 목록 조회 | `MEMBER` | `SFR-049` | `구현됨` |
| `POST` | `/api/v1/spaces/{spaceSlug}/trash/files/{fileId}/restore` | 휴지통 파일 복원 | `MEMBER` | `SFR-050` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/trash/files/{fileId}` | 휴지통 파일 영구삭제 | `MEMBER` | `SFR-051` | `구현됨` |

**휴지통 목록 응답 규칙**

| 필드 | 의미 |
|---|---|
| `items` | `Deleted` 상태의 파일 목록 |
| `page` | 페이징 정보 |
| `deletedAt` | 삭제 시각 |
| `displayName` | 삭제 당시 파일명 |
| `folderId` | 삭제 전 원래 폴더 ID |
| `sizeBytes` | 파일 크기 |

현재 구현된 목록 쿼리는 `page` 기본값 `1`, `pageSize` 기본값 `50` 및 최대 `100`, `sortBy = deletedAt | deleted_at | name | size`, `sortDir = asc | desc` 이다.

**복원 요청 규칙**

| 필드 | 의미 |
|---|---|
| `targetFolderId` | 선택 사항. 생략 시 원래 폴더로 복원 시도 |

**복원/영구삭제 동작**

- 복원은 `DeletedAt = null`, `FileStatus = Active` 로 되돌린다.
- `targetFolderId` 가 없으면 원래 폴더가 유효할 때 그 위치로 복원한다.
- 이름 충돌, 원래 폴더 없음, 접근 불가 상태는 실패로 처리한다.
- 영구삭제는 storage object 와 DB row 를 모두 정리한다.
- storage object 가 이미 없어도 purge 는 실패로 보지 않는다.

### 4.7 다운로드 및 미리보기

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `POST` | `/api/v1/spaces/{spaceSlug}/files/{fileId}/download-sessions` | 다운로드 세션 발급 | `VIEWER` | `SFR-026` | `구현됨` |
| `GET` | `/api/v1/spaces/{spaceSlug}/files/{fileId}/preview` | 미리보기 정보 또는 내용 조회 | `VIEWER` | `SFR-037~040` | `구현됨` |
| `GET` | `/public/v1/download-sessions/{sessionToken}/stream` | 실제 스트리밍 | 공개 | `SFR-026`, `SFR-036` | `구현됨` |

**미리보기 응답 규칙**

| `kind` | 의미 | 주요 필드 |
|---|---|---|
| `IMAGE` | 이미지 미리보기 | `previewUrl`, `contentType`, `expiresAt` |
| `TEXT` | 텍스트 직접 응답 | `textContent`, `encoding`, `truncated` |
| `PDF` | PDF 뷰어용 URL | `previewUrl`, `expiresAt` |
| `UNSUPPORTED` | 미리보기 미지원 | `canDownload = true` |

**다운로드 정책**

- 스트리밍 직전에도 경로 정규화, 파일 존재 여부, `fileStatus`, `scanStatus`, 공유 링크 상태를 다시 검증한다.
- `Range` 요청은 지원하되 single-range 만 지원한다.
- 외부 공개 다운로드는 잘못된 토큰, 권한 없음, 비활성 리소스, 격리 상태를 `404` 로 마스킹한다.

### 4.8 공유 링크

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceSlug}/share-links` | Space 공유 링크 목록 조회 | `VIEWER` | `SFR-032~034` | `구현됨` |
| `POST` | `/api/v1/share-links` | 공유 링크 생성 | `MEMBER` | `SFR-032` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}` | 링크 옵션 수정 | `MEMBER` | `SFR-033` | `구현됨` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}/status` | 링크 상태 변경 | `MEMBER` | `SFR-033`, `SFR-034` | `구현됨` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}` | 링크 폐기 | `MEMBER` | `SFR-034` | `구현됨` |
| `PATCH` | `/api/v1/share-links/{shareLinkId}` | 링크 옵션 수정 legacy 초안 | `MEMBER` | `SFR-033` | `미구현` |
| `DELETE` | `/api/v1/share-links/{shareLinkId}` | 링크 비활성화/폐기 legacy 초안 | `MEMBER` | `SFR-034` | `미구현` |
| `POST` | `/public/v1/share-links/{shareToken}/verify` | 링크 유효성 검사 | 공개 | `SFR-035` | `구현됨` |
| `POST` | `/public/v1/share-links/{shareToken}/browse` | 파일/폴더 열람 정보 조회 | 공개 | `SFR-036` | `구현됨` |
| `POST` | `/public/v1/share-links/{shareToken}/download-sessions` | 공유 링크 기반 다운로드 세션 발급 | 공개 | `SFR-036` | `구현됨` |

**계약 요약**

- 생성 API는 `/api/v1/share-links` 이며 요청 body에 `spaceId`, `targetType = FILE | FOLDER` 와 `fileId` 또는 `folderId` 중 하나를 받는다.
- 관리 API는 Space 범위 경로(`/api/v1/spaces/{spaceSlug}/share-links*`)를 사용한다.
- 목록 조회는 `active = true | false`, `sort = createdAt | created_at | expiresAt | expires_at | title`, `order = asc | desc` 만 허용한다.
- 상태 변경은 옵션 수정 API가 아니라 `PATCH /api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}/status` 를 사용하며 현재 구현 상태값은 `ACTIVE`, `DISABLED` 이다.
- 공개 API는 비밀번호 제출을 위해 모두 `POST` 를 사용한다.
- 비밀번호가 있는 링크는 `verify` 호출에 비밀번호를 보내며, 현재 응답은 `shareLink`, `canBrowse`, `canDownload`, `canPreview`, `targetName`, `targetType`를 반환한다.
- `browse` 는 파일 공유면 파일 메타데이터를, 폴더 공유면 폴더 자식 목록을 반환한다.
- `download-sessions` 는 파일 공유 또는 폴더 공유 안의 특정 파일을 대상으로 다운로드 세션을 발급한다.

### 4.9 Notification inbox

| Method | Path | 설명 | 최소 Role | 관련 SFR | 구현 상태 |
|---|---|---|---|---|---|
| `GET` | `/api/v1/notifications` | 현재 사용자가 볼 수 있는 영속 알림 목록 조회 | 로그인 사용자 | 전략 문서 기반 확장 계약 | `구현됨` |
| `GET` | `/api/v1/notifications/unread-count` | 현재 사용자의 미확인 알림 수 조회 | 로그인 사용자 | 전략 문서 기반 확장 계약 | `구현됨` |
| `POST` | `/api/v1/notifications/read-position` | 사용자별 마지막 읽은 알림 위치 갱신 | 로그인 사용자 | 전략 문서 기반 확장 계약 | `구현됨` |

**목록 조회**

```http
GET /api/v1/notifications?limit=20&cursor=123&unreadOnly=false
Authorization: Bearer {opaque_session_token}
```

Query parameters:

| 이름 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `limit` | `integer` | N | 현재 구현 기본 `20`, 최대 `100` |
| `cursor` | `integer(int64)` | N | 이전 페이지 마지막 `notification.id`. 없으면 최신 페이지 |
| `unreadOnly` | `boolean` | N | 기본 `false` |
| `spaceId` | `integer(int64)` | N | Space별 알림 필터 초안. 현재 API 요청 모델에는 없음, `미구현` |

Response:

```json
{
  "items": [
    {
      "id": 123,
      "notificationId": "3d50b852-5fd6-4918-8e97-423d31c10d72",
      "type": "FileUploaded",
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

**Unread count**

```http
GET /api/v1/notifications/unread-count
Authorization: Bearer {opaque_session_token}
```

현재 구현은 전체 visible unread count를 반환한다. `spaceId` 기반 count 필터는 초안만 있고 API 요청 모델에는 아직 없다.

```json
{
  "count": 12
}
```

**Read position 갱신**

```http
POST /api/v1/notifications/read-position
Authorization: Bearer {opaque_session_token}
Content-Type: application/json
```

Request:

```json
{
  "lastReadNotificationId": 123
}
```

Response:

```json
{
  "lastReadNotificationId": 123,
  "lastReadAt": "2026-05-14T03:20:00Z"
}
```

**계약 요약**

- 모든 Notification endpoint는 인증이 필요하며, 응답은 domain/EF entity가 아니라 DTO만 반환한다.
- 알림 제목과 메시지는 서버가 저장하지 않고 클라이언트가 `type`과 `payload`로 렌더링한다.
- visible notification은 개인 알림(`recipientUserId = currentUserId`)과 현재 active membership을 가진 Space 알림의 합집합이다.
- `spaceId` query parameter 기반 Space별 필터는 초안만 있고 현재 요청 모델에는 없다.
- 목록 조회는 `id DESC` 기준 cursor paging을 사용한다. `cursor`가 있으면 `id < cursor` 조건을 적용하고, `nextCursor`는 반환된 마지막 row의 `id`다.
- unread 판정은 read position row가 없을 때 `lastReadNotificationId = 0`으로 간주하고, visible notification의 `id > lastReadNotificationId`이면 unread다.
- read position은 사용자별 전체 inbox cursor 1개만 관리한다.
- read position 갱신 시 `lastReadNotificationId`가 현재 사용자에게 visible한지 확인한다. 존재하지 않거나 visible하지 않으면 `404 Not Found`다.
- 기존 값보다 작은 `lastReadNotificationId`로 되돌리는 요청은 성공으로 처리하되 저장하지 않는다.
- 현재 구현 기준 목록 조회의 실패 상태는 `400`, `401`, `500`, unread count는 `401`, `500`, read position 갱신은 `400`, `401`, `404`, `500`을 반환할 수 있다.

### 4.10 관리자, 이벤트, 확장 미구현 계약

| 항목 | 계약 | 구현 상태 |
|---|---|---|
| 관리자 API 접근 확인 | `GET /api/v1/admin` | `구현됨` |
| 관리자 사용자 목록 | `GET /api/v1/admin/users` | `구현됨` |
| 관리자 사용자 상세 | `GET /api/v1/admin/users/{userId}` | `구현됨` |
| 관리자 사용자 상태 변경 | `PATCH /api/v1/admin/users/{userId}/status` | `구현됨` |
| 관리자 Space 목록 | `GET /api/v1/admin/spaces` | `구현됨` |
| 관리자 Space 사용량 상세 | `GET /api/v1/admin/spaces/{spaceId}/usage` | `구현됨` |
| 관리자 Space quota 변경 | `PATCH /api/v1/admin/spaces/{spaceId}/quota` | `구현됨` |
| 관리자 Space 상태 변경 | `PATCH /api/v1/admin/spaces/{spaceId}/status` | `구현됨` |
| 관리자 전체 Space usage 목록 초안 | `GET /api/v1/admin/spaces/usage` | `미구현` |
| 실시간 이벤트 스트림 | `GET /api/v1/events/stream` | `구현됨` |
| SSE 이벤트 envelope | `RealtimeEventEnvelope` JSON 스키마 | `구현됨` |
| MCP token 발급 | `POST /api/v1/mcp-tokens` | `구현됨` |
| MCP token 목록 | `GET /api/v1/mcp-tokens` | `구현됨` |
| MCP token 폐기 | `DELETE /api/v1/mcp-tokens/{tokenId}` | `구현됨` |
| MCP/AI 자연어 탐색 | MVP 비보장, 추후 별도 경로로 확장 | `미구현` |
| 감사 로그 | 외부 공개 API 없음, 서버 내부 운영 계약 | `미구현` |

**MCP token 관리**

- 모든 MCP token 관리 API는 일반 사용자 인증이 필요하다.
- 발급 요청은 `name`과 선택적 `expiresInDays`를 받는다. `expiresInDays`는 현재 1~180일 범위다.
- 발급 응답의 `accessToken` 원문은 1회만 반환하며, 응답 헤더에 `Cache-Control: no-store`, `Pragma: no-cache`를 설정한다.
- 목록 응답은 `items[]`로 `id`, `name`, `status`, `createdAt`, `expiresAt`, `lastUsedAt`을 반환한다.
- 폐기 API는 현재 사용자 소유 token만 폐기할 수 있으며 성공 시 `204 No Content`다.

**관리자 조회 응답 핵심 필드**

- `spaceId`: bigint
- `name`
- `status`
- `ownerUserId`: bigint
- `memberCount`
- `storageAllowedBytes`
- `storageUsedBytes`
- `storageReservedBytes`
- `usageRate`

**실시간 이벤트 스트림**

```http
GET /api/v1/events/stream
Authorization: Bearer {opaque_session_token}
Accept: text/event-stream
```

성공 시 `200 OK`와 함께 `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`를 반환한다. 서버는 연결 직후 헤더를 즉시 전송하고, 이벤트가 없으면 30초마다 `:keepalive` comment frame을 전송한다.

SSE frame은 `event` 이름과 JSON `data`를 함께 제공한다.

```text
event: FileUploaded
data: {"eventId":"...","eventType":"FileUploaded","eventVersion":1,"occurredAt":"2026-05-13T03:15:00Z","spaceId":10,"actorUserId":7,"aggregateType":"FileItem","aggregateId":55,"payload":{}}

```

`data` envelope 공통 필드:

| 필드 | 설명 |
|---|---|
| `eventId` | outbox 이벤트 UUID |
| `eventType` | SSE event 이름과 동일한 이벤트 타입 |
| `eventVersion` | 이벤트 schema version. 현재 `1` |
| `occurredAt` | 이벤트 발생 시각 |
| `spaceId` | Space 범위 이벤트의 Space ID |
| `actorUserId` | 행위자 user ID. 내부 처리 이벤트는 `null` 가능 |
| `aggregateType` | 변경 aggregate 종류 |
| `aggregateId` | 변경 aggregate ID |
| `payload` | eventType별 payload |

현재 발행되는 SSE 이벤트:

| eventType | payload | 수신자 |
|---|---|---|
| `SpaceCreated`, `SpaceUpdated`, `SpaceDeleted` | `SpaceEventPayload` | Space active members |
| `SpaceQuotaChanged` | `SpaceQuotaChangedPayload` | Space active members |
| `MemberAdded`, `MemberRoleChanged` | `MemberEventPayload` | Space active members |
| `MemberRemoved` | `MemberEventPayload` | Space active members + 제거된 user |
| `SpaceInviteCreated`, `SpaceInviteRevoked` | `SpaceInviteEventPayload` | Space active members |
| `SpaceInviteAccepted` | `SpaceInviteAcceptedPayload` | Space active members |
| `FileUploaded`, `FileRenamed`, `FileMoved`, `FileDeleted` | `FileEventPayload` | Space active members |
| `UploadFinalizeFailed` | `UploadFinalizeFailedPayload` | 업로드 요청자 user |
| `FolderCreated`, `FolderRenamed`, `FolderMoved`, `FolderDeleted` | `FolderEventPayload` | Space active members |
| `ShareLinkCreated`, `ShareLinkUpdated`, `ShareLinkRevoked` | `ShareLinkEventPayload` | Space active members |

이벤트별 payload 필드의 상세 계약은 [SSE 실시간 이벤트 fan-out 전략](strategies/sse-realtime-fanout.md)을 기준으로 한다.

**기존 업로드 완료 이벤트 초안**

아래 `UploadCompletedEvent`는 초기 초안으로 보존한다. 현재 구현 기준 업로드 성공 실시간 알림은 `FileUploaded` SSE 이벤트이며, 상세 payload는 `FileEventPayload`를 따른다.

```json
{
  "eventId": "evt_01JXYZ...",
  "eventType": "file.upload.completed",
  "occurredAt": "2026-04-17T12:00:00Z",
  "spaceId": 123,
  "uploadSessionId": "upl_123",
  "fileItemId": "fil_123",
  "storageKey": "files/2026/04/17/abc.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 1048576
}
```

## 5. 구현 시 반드시 유지할 정책

### 5.1 파일명 충돌

- 사전 검사와 finalize 직전 모두 동일 폴더 내 활성 `FileItem` 과 활성 `FileReservation` 을 검사한다.
- 최종 충돌 정책은 자동 리네임이 아니라 **실패 반환**이다.

### 5.2 quota

- 업로드 시작 시 선점, finalize 시 재검사, 실패/취소/만료 시 예약 해제를 수행한다.
- `storageAllowedBytes = null` 인 Space 도 `used`, `reserved` 집계는 계속 유지한다.

### 5.3 다운로드 세션

- TTL 기본값은 5분이다.
- 발급 이후 권한이 바뀌어도 TTL 내 즉시 revoke 하지 않는다.
- 만료 후 재다운로드 시 권한과 파일 상태를 다시 검증한다.

### 5.4 감사 로그

서버는 최소한 아래 이벤트를 로그로 남긴다.

- 업로드 세션 생성
- 업로드 finalize 성공/실패
- 파일 삭제
- 공유 링크 생성/수정/폐기
- Space 초대 링크 생성/폐기/수락
- Space Role 변경
- 공유 링크 기반 다운로드 시도/완료

## 6. OpenAPI 포함 범위

- ReDoc 문서의 OpenAPI 초안은 MVP에서 실제로 노출할 HTTP 계약만 포함한다.
- tus 전송 자체와 감사 로그 기록, MCP/AI 자연어 탐색은 부가 계약으로 문서화하고 OpenAPI path 에는 강제 포함하지 않는다.
- SSE endpoint인 `GET /api/v1/events/stream`은 실제 HTTP 계약이므로 OpenAPI path에 포함한다.
- 자세한 request/response schema 는 `docs/개발/api/openapi.yaml` 을 기준으로 본다.
