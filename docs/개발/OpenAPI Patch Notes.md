# OpenAPI Patch Notes

비교 기준:
- 초안: `C:/Users/son/Documents/free/docs/docs/설계/api/openapi.yaml`
- 갱신본: `docs/.llm/design/openapi.yaml`

## Summary

- OpenAPI 문서를 실제 `CloudSharp.Api` 구현 상태에 맞춰 보정했다.
- Paths는 `27개 -> 31개`, Schemas는 `46개 -> 60개`로 증가했다.
- 주요 변경은 upload session 경로의 Space 스코프화, internal upload/tusd hook 계약 추가, `/api/v1/me` 메서드 보정이다.
- diff 규모는 약 `476 insertions`, `75 deletions`.

## Breaking Changes

- `GET /api/v1/me`가 실제 구현 기준에 맞춰 `POST /api/v1/me`로 변경됐다.
- 기존 upload session 경로가 제거되고 Space-scoped 경로로 대체됐다.
  - Removed: `POST /api/v1/upload-sessions`
  - Removed: `GET /api/v1/upload-sessions/{uploadSessionId}`
  - Added: `POST /api/v1/spaces/{spaceSlug}/upload-sessions`
  - Added: `GET /api/v1/spaces/{spaceSlug}/upload-sessions/{token}`
- `UploadSession` schema가 제거되고 `CreateUploadSessionResponse`로 대체됐다.
- `CreateUploadSessionRequest`에서 `spaceId` body 필드가 제거됐다. Space 범위는 URL의 `{spaceSlug}`로 결정한다.
- `targetFolderId`가 `string`에서 `integer(int64)`로 변경됐다.
- `spaceSlug` 설명/예시가 UUID 전제에서 일반 slug 문자열로 변경됐다.

## Added

- Health check endpoint 추가:
  - `GET /api/v1/health`
- Internal upload endpoints 추가:
  - `POST /api/internal/uploads/uploading`
  - `POST /api/internal/uploads/finalize`
- tusd hook endpoint 추가:
  - `POST /internal/tusd/hooks`
- Internal upload 인증 scheme 추가:
  - `internalUploadToken`
  - Header: `X-CloudSharp-Internal-Token`
- Tags 추가:
  - `Health`
  - `UploadSessions`
  - `Internal Uploads`
  - `TusdHooks`
- Schemas 추가:
  - `CreateUploadSessionResponse`
  - `FileReservationItemResponse`
  - `MarkUploadSessionUploadingRequest`
  - `CompleteUploadRequest`
  - `CompleteUploadResult`
  - `TusdHookRequest`
  - `TusdHookEvent`
  - `TusdUpload`
  - `TusdStorage`
  - `TusdHttpRequest`
  - `TusdHookResponse`
  - `TusdHttpResponse`
  - `TusdChangeFileInfo`
  - `ResponseTusdStorage`

## Changed

- `RegisterRequest`가 실제 API DTO에 맞게 갱신됐다.
  - `username`, `displayName`이 required로 변경
  - `username maxLength: 20`
  - `displayName maxLength: 100`
  - `password maxLength: 128`
- `LoginRequest.loginId`에 `format: email`이 추가됐다.
- `SpaceSummary`가 실제 응답 DTO에 맞게 조정됐다.
  - `description` 제거
  - `slug`, `ownerUserId` 추가 및 required 처리
- `SpaceListResponse`의 `pageSize` 기본값을 실제 구현 기준인 `20`으로 반영하기 위해 `spacePageSize` parameter를 추가했다.
- Folder children 정렬 쿼리가 구현 enum 바인딩에 맞게 변경됐다.
  - `sortBy`: `name|size|updatedAt` -> `Name|Size|UpdatedAt`
  - `sortDir` -> `sortDirection`
  - `sortDirection`: `Asc|Desc`
- Upload session 응답이 파일 예약 정보를 포함하도록 변경됐다.
  - `fileReservationItem.status`
  - `spaceId`
  - `targetFolderId`
  - `reservedName`
  - `reservedBytes`
  - `isReserved`
  - `fileItemId`
  - `expiresAt`

## Preserved As Draft

아래 MVP 예정 API들은 초안 계약으로 유지됐다.

- Space 수정/삭제
- Quota 조회/변경
- Invites/Members
- Search
- Files metadata/delete
- Downloads/Preview
- Share Links
- Public Share APIs
- Admin usage API
