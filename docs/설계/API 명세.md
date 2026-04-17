# CloudSharp API 명세

이 문서는 [기능 요구사항](기능요구사항.md), [ERD 설계서](db/ERD%20설계서.md), [업로드 파이프라인](pipeline/업로드%20파이프라인.md), [다운로드 파이프라인](pipeline/다운로드%20파이프라인.md), 전략 문서를 바탕으로 정리한 MVP 기준 API 계약 초안이다.

ReDoc 렌더 버전은 [API(초안)](api-redoc.md)에서 확인한다.

## 1. 문서 기준

| 항목 | 값 |
|---|---|
| 내부 인증 API base path | `/api/v1` |
| 외부 공개 API base path | `/public/v1` |
| 인증 방식 | `Authorization: Bearer {JWT}` |
| 기본 데이터 형식 | `application/json` |
| 파일 다운로드 응답 | `application/octet-stream` 또는 서버 판별 MIME |
| API 리소스 ID | 외부 API에서는 모두 **opaque string** 으로 취급 |
| 시간 표기 | UTC 기준 ISO 8601 문자열 |
| 업로드 전송 프로토콜 | tus 1.0.0 |

## 2. 공통 계약

### 2.1 인증과 권한

| Role | Space 조회 | 업로드 | 파일/폴더 수정 | 공유 링크 생성 | 멤버 초대/변경 | Quota 변경 | Space 삭제 |
|---|---|---|---|---|---|---|---|
| `OWNER` | O | O | O | O | O | O | O |
| `ADMIN` | O | O | O | O | O | X | X |
| `MEMBER` | O | O | O | O | X | X | X |
| `VIEWER` | O | X | X | X | X | X | X |

- 내부 API는 명시되지 않은 경우 모두 JWT 인증이 필요하다.
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
- 미리보기는 `GET /api/v1/spaces/{spaceId}/files/{fileId}/preview` 한 경로로 통합하고, 형식별 결과는 `kind` 필드로 구분한다.

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

## 3. 기능 요구사항 추적표

| SFR | 반영 위치 |
|---|---|
| `SFR-001` | `POST /api/v1/auth/register` |
| `SFR-002` | `POST /api/v1/auth/login` |
| `SFR-003` | `POST /api/v1/auth/logout` |
| `SFR-004` | 내부 인증 API 공통 계약 |
| `SFR-005` | `GET /api/v1/me` |
| `SFR-006~010` | `GET/POST/PATCH/DELETE /api/v1/spaces*` |
| `SFR-011~015` | Space 초대/멤버 API |
| `SFR-016~017` | `GET/PATCH /api/v1/spaces/{spaceId}/quota` |
| `SFR-018~022` | 폴더 목록/생성/수정/삭제 API |
| `SFR-023` | `POST /api/v1/upload-sessions` |
| `SFR-024` | tus 업로드 흐름 + `GET /api/v1/upload-sessions/{uploadSessionId}` |
| `SFR-025` | 업로드 상태 조회 응답의 `fileItem`, `postProcessing` 필드 |
| `SFR-026` | `POST /api/v1/spaces/{spaceId}/files/{fileId}/download-sessions` + 공개 stream API |
| `SFR-027~029` | `PATCH/DELETE /api/v1/spaces/{spaceId}/files/{fileId}` |
| `SFR-030` | 폴더 목록/검색 API의 `sortBy`, `sortDir` |
| `SFR-031` | `GET /api/v1/spaces/{spaceId}/search` |
| `SFR-032~034` | `POST/PATCH/DELETE /api/v1/share-links*` |
| `SFR-035` | `POST /public/v1/share-links/{shareToken}/verify` |
| `SFR-036` | `POST /public/v1/share-links/{shareToken}/browse`, `.../download-sessions` |
| `SFR-037~040` | `GET /api/v1/spaces/{spaceId}/files/{fileId}/preview` |
| `SFR-041~042` | Space quota 조회 + 업로드 세션 생성 전 사전 검증 |
| `SFR-043` | `GET /api/v1/admin/spaces/usage` |
| `SFR-044~045` | `FileItem.metadata`, `previewStatus`, `scanStatus`, `tags` |
| `SFR-046` | 업로드 완료 이벤트 계약 |
| `SFR-047` | MCP/AI 확장 예정 계약 |
| `SFR-048` | 감사 로그 정책 섹션 |

## 4. 도메인별 API

### 4.1 인증 및 사용자

| Method | Path | 설명 | 관련 SFR |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | 계정 생성 | `SFR-001` |
| `POST` | `/api/v1/auth/login` | JWT 발급 | `SFR-002` |
| `POST` | `/api/v1/auth/logout` | 현재 토큰 무효화 | `SFR-003` |
| `GET` | `/api/v1/me` | 내 프로필 조회 | `SFR-005` |

**요청/응답 핵심 필드**

| 객체 | 필드 |
|---|---|
| `RegisterRequest` | `email`, `username?`, `displayName?`, `password` |
| `LoginRequest` | `loginId`, `password` |
| `AuthResponse` | `accessToken`, `tokenType`, `expiresInSeconds`, `user` |
| `UserProfile` | `id`, `email`, `username?`, `displayName`, `systemRole`, `createdAt` |

### 4.2 Space 및 quota

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `GET` | `/api/v1/spaces` | 내가 속한 Space 목록 조회 | `VIEWER` | `SFR-006` |
| `POST` | `/api/v1/spaces` | Space 생성 | 로그인 사용자 | `SFR-007` |
| `GET` | `/api/v1/spaces/{spaceId}` | Space 상세 조회 | `VIEWER` | `SFR-008` |
| `PATCH` | `/api/v1/spaces/{spaceId}` | 이름/설명 변경 | `ADMIN` | `SFR-009` |
| `DELETE` | `/api/v1/spaces/{spaceId}` | 소프트 삭제 또는 비활성화 | `OWNER` | `SFR-010` |
| `GET` | `/api/v1/spaces/{spaceId}/quota` | quota 조회 | `ADMIN` | `SFR-016`, `SFR-041` |
| `PATCH` | `/api/v1/spaces/{spaceId}/quota` | quota 변경 | `OWNER` | `SFR-017` |

**계약 요약**

- `storageAllowedBytes = null` 이면 무제한 Space 이다.
- `GET /quota` 응답에는 `storageUsedBytes`, `storageReservedBytes`, `availableBytes`, `usageRate`를 포함한다.
- `PATCH /quota`는 현재 `used + reserved` 보다 작은 값으로 낮출 수 없다.

### 4.3 Space 멤버 및 초대

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `POST` | `/api/v1/spaces/{spaceId}/invites` | Space 초대 생성 | `ADMIN` | `SFR-011` |
| `POST` | `/api/v1/invites/accept` | 초대 수락 | 로그인 사용자 | `SFR-012` |
| `GET` | `/api/v1/spaces/{spaceId}/members` | 멤버 목록 조회 | `ADMIN` | `SFR-013` |
| `PATCH` | `/api/v1/spaces/{spaceId}/members/{memberId}` | 멤버 Role 변경 | `ADMIN` | `SFR-014` |
| `DELETE` | `/api/v1/spaces/{spaceId}/members/{memberId}` | 멤버 제거 | `ADMIN` | `SFR-015` |

**계약 요약**

- 초대 생성 시 `inviteeUserId` 또는 `inviteeEmail` 중 하나는 필수다.
- 초대 수락 시 `inviteId` 또는 `inviteToken` 중 정확히 하나를 제공한다.
- `OWNER` 제거, `OWNER`를 `OWNER` 외 Role로 강등, 자기 자신을 마지막 `OWNER`에서 제거하는 동작은 금지한다.

### 4.4 폴더 탐색 및 검색

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceId}/folders/{folderId}/children` | 자식 파일/폴더 목록 조회 | `VIEWER` | `SFR-018`, `SFR-030` |
| `POST` | `/api/v1/spaces/{spaceId}/folders` | 폴더 생성 | `MEMBER` | `SFR-019` |
| `PATCH` | `/api/v1/spaces/{spaceId}/folders/{folderId}` | 폴더명 변경 또는 이동 | `MEMBER` | `SFR-020`, `SFR-021` |
| `DELETE` | `/api/v1/spaces/{spaceId}/folders/{folderId}` | 폴더 삭제 | `MEMBER` | `SFR-022` |
| `GET` | `/api/v1/spaces/{spaceId}/search` | 파일/폴더 기본 검색 | `VIEWER` | `SFR-031` |

**계약 요약**

- 루트 탐색은 `folderId = root` 를 사용한다.
- `sortBy` 지원값은 `name`, `size`, `updatedAt` 이다.
- `PATCH /folders/{folderId}` 는 `name` 과 `parentFolderId` 를 동시에 받을 수 있다.
- 폴더 삭제 정책은 기본적으로 소프트 삭제이며, 하위 항목 존재 시 `409 Conflict` 또는 비동기 삭제 정책 중 하나로 처리한다.

### 4.5 파일 메타데이터, 업로드, 후처리

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `PATCH` | `/api/v1/spaces/{spaceId}/files/{fileId}` | 파일명 변경 또는 폴더 이동 | `MEMBER` | `SFR-027`, `SFR-028` |
| `DELETE` | `/api/v1/spaces/{spaceId}/files/{fileId}` | 파일 삭제 | `MEMBER` | `SFR-029` |
| `POST` | `/api/v1/upload-sessions` | 업로드 세션 생성 | `MEMBER` | `SFR-023`, `SFR-042` |
| `GET` | `/api/v1/upload-sessions/{uploadSessionId}` | 업로드 상태 조회 | 세션 생성자 또는 관리자 | `SFR-024`, `SFR-025` |

**업로드 흐름**

1. `POST /api/v1/upload-sessions` 호출
2. 응답의 `uploadUrl` 로 tus `PATCH/HEAD` 진행
3. 업로드 완료 후 서버가 자동 finalize 수행
4. `GET /api/v1/upload-sessions/{uploadSessionId}` 로 `FINALIZING`, `COMPLETED`, `FAILED` 상태 확인

**업로드 상태 조회 응답 핵심 필드**

| 필드 | 설명 |
|---|---|
| `status` | `CREATED`, `UPLOADING`, `FINALIZING`, `COMPLETED`, `FAILED`, `ABORTED`, `EXPIRED` |
| `uploadUrl` | tus 전송 URL |
| `receivedSize` | 서버가 인지한 진행량 |
| `fileItem` | 완료 시 최종 파일 메타데이터 |
| `postProcessing` | `scanStatus`, `previewStatus`, `tags`, `metadata` |
| `error` | 실패 시 비즈니스 에러 코드와 메시지 |

**후처리 정책**

- `scanStatus = PENDING` 이어도 기본 다운로드는 허용한다.
- `scanStatus = FAILED` 또는 감염 탐지 시 `fileStatus = QUARANTINED` 로 전환하고 다운로드를 차단한다.
- `previewStatus = FAILED` 는 미리보기 실패일 뿐 다운로드 차단 사유가 아니다.

### 4.6 다운로드 및 미리보기

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `POST` | `/api/v1/spaces/{spaceId}/files/{fileId}/download-sessions` | 다운로드 세션 발급 | `VIEWER` | `SFR-026` |
| `GET` | `/api/v1/spaces/{spaceId}/files/{fileId}/preview` | 미리보기 정보 또는 내용 조회 | `VIEWER` | `SFR-037~040` |
| `GET` | `/public/v1/download-sessions/{sessionToken}/stream` | 실제 스트리밍 | 공개 | `SFR-026`, `SFR-036` |

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

### 4.7 공유 링크

| Method | Path | 설명 | 최소 Role | 관련 SFR |
|---|---|---|---|---|
| `POST` | `/api/v1/share-links` | 공유 링크 생성 | `MEMBER` | `SFR-032` |
| `PATCH` | `/api/v1/share-links/{shareLinkId}` | 링크 옵션 수정 | `MEMBER` | `SFR-033` |
| `DELETE` | `/api/v1/share-links/{shareLinkId}` | 링크 비활성화/폐기 | `MEMBER` | `SFR-034` |
| `POST` | `/public/v1/share-links/{shareToken}/verify` | 링크 유효성 검사 | 공개 | `SFR-035` |
| `POST` | `/public/v1/share-links/{shareToken}/browse` | 파일/폴더 열람 정보 조회 | 공개 | `SFR-036` |
| `POST` | `/public/v1/share-links/{shareToken}/download-sessions` | 공유 링크 기반 다운로드 세션 발급 | 공개 | `SFR-036` |

**계약 요약**

- 내부 생성/수정 API는 `targetType = FILE | FOLDER` 와 `fileId` 또는 `folderId` 중 하나를 받는다.
- 공개 API는 비밀번호 제출을 위해 모두 `POST` 를 사용한다.
- 비밀번호가 있는 링크는 `verify` 호출에 비밀번호를 보내면 `requiresPassword = false` 상태의 메타데이터를 받는다.
- `browse` 는 파일 공유면 파일 메타데이터를, 폴더 공유면 폴더 자식 목록을 반환한다.
- `download-sessions` 는 파일 공유 또는 폴더 공유 안의 특정 파일을 대상으로 다운로드 세션을 발급한다.

### 4.8 관리자, 이벤트, 확장 예정 계약

| 항목 | 계약 |
|---|---|
| 관리자 조회 | `GET /api/v1/admin/spaces/usage` |
| 업로드 완료 이벤트 | `UploadCompletedEvent` JSON 스키마 |
| MCP/AI 자연어 탐색 | MVP 비보장, 추후 별도 경로로 확장 |
| 감사 로그 | 외부 공개 API 없음, 서버 내부 운영 계약 |

**관리자 조회 응답 핵심 필드**

- `spaceId`
- `name`
- `status`
- `ownerUserId`
- `memberCount`
- `storageAllowedBytes`
- `storageUsedBytes`
- `storageReservedBytes`
- `usageRate`

**업로드 완료 이벤트**

```json
{
  "eventId": "evt_01JXYZ...",
  "eventType": "file.upload.completed",
  "occurredAt": "2026-04-17T12:00:00Z",
  "spaceId": "spc_123",
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
- Space 초대 생성/수락
- Space Role 변경
- 공유 링크 기반 다운로드 시도/완료

## 6. OpenAPI 포함 범위

- ReDoc 문서의 OpenAPI 초안은 MVP에서 실제로 노출할 HTTP 계약만 포함한다.
- tus 전송 자체와 업로드 완료 이벤트 발행, 감사 로그 기록, MCP/AI 자연어 탐색은 부가 계약으로 문서화하고 OpenAPI path 에는 강제 포함하지 않는다.
- 자세한 request/response schema 는 `docs/설계/api/openapi.yaml` 을 기준으로 본다.
