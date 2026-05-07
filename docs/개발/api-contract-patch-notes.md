# OpenAPI Patch Notes

> 실제 `CloudSharp.Api` endpoint 매핑과 OpenAPI/API 계약의 차이를 맞춘 변경 이력을 기록한다.


## 2026-05-07 - API 계약/구현 상태 정합화

### Added

- `GET /api/v1/me` 를 현재 표준 내 프로필 조회 API로 문서화했다.
- `docs/.llm/design/openapi.yaml` 의 모든 operation에 `x-implementation-status` 를 추가했다.
- 구현 상태 값은 `implemented`, `internal-implemented`, `planned`, `deprecated-implemented` 네 가지로 고정했다.
- `Search`, `Preview`, `Uploads` tag를 OpenAPI tag 목록과 tag group에 추가했다.

### Changed

- 실제 백엔드에 매핑된 Space 수정/삭제, quota 조회/변경, 멤버 목록 조회, 검색, 파일 메타데이터 수정/삭제, 다운로드 세션 발급, 미리보기, 공개 다운로드 스트림 API를 `구현됨`으로 갱신했다.
- `GET /api/v1/spaces/{spaceSlug}/search` 계약을 실제 구현 기준으로 맞췄다. `q`는 필수이며, `type = all | file | folder`, `sortBy = name | size | updatedAt | updated_at`, `sortDir = asc | desc` 를 사용한다.
- `DownloadSessionResponse`, `PreviewResponse`, `SearchResponse`, `FileResource`, `SpaceQuotaResponse`, `SpaceMemberResponse` 스키마를 현재 API DTO에 맞춰 정리했다.
- `DELETE /api/v1/spaces/{spaceSlug}` 성공 응답을 실제 구현과 맞춰 `200 OK` + `SpaceDetail` 로 갱신했다.
- 내부 업로드 API tag를 실제 endpoint tag인 `Uploads` 로 맞췄고, 내부 구현 상태는 `internal-implemented` 로 표시했다.

### Deprecated

- `POST /api/v1/me` 는 하위 호환용 legacy endpoint로 남기고, OpenAPI에 `deprecated: true` 및 `x-implementation-status: deprecated-implemented` 를 표시했다.
- 신규 클라이언트는 `GET /api/v1/me` 를 사용한다.

### Still Planned

- Space invite 생성/수락, 멤버 Role 변경/제거 API는 아직 예정 상태다.
- ShareLink 내부/공개 API와 관리자 Space 사용량 조회 API는 계약 초안만 유지한다.

## 2026-05-07 - OpenAPI 구현 기준 1차 보정

### Summary

- OpenAPI 문서를 실제 `CloudSharp.Api` 구현 상태에 맞춰 보정했다.
- Paths는 `27개 -> 31개`, Schemas는 `46개 -> 60개`로 증가했다.
- 주요 변경은 upload session 경로의 Space 스코프화, internal upload/tusd hook 계약 추가, `/api/v1/me` 메서드 보정이다.
- diff 규모는 약 `476 insertions`, `75 deletions`.

### Breaking Changes

- 1차 보정에서는 `GET /api/v1/me`가 실제 구현 기준에 맞춰 `POST /api/v1/me`로 변경됐다. 이후 API 계약/구현 상태 정합화에서 `GET /api/v1/me`가 표준 API로 다시 문서화됐고, `POST /api/v1/me`는 legacy endpoint로 표시됐다.
- 기존 upload session 경로가 제거되고 Space-scoped 경로로 대체됐다.
  - Removed: `POST /api/v1/upload-sessions`
  - Removed: `GET /api/v1/upload-sessions/{uploadSessionId}`
  - Added: `POST /api/v1/spaces/{spaceSlug}/upload-sessions`
  - Added: `GET /api/v1/spaces/{spaceSlug}/upload-sessions/{token}`
- `UploadSession` schema가 제거되고 `CreateUploadSessionResponse`로 대체됐다.
- `CreateUploadSessionRequest`에서 `spaceId` body 필드가 제거됐다. Space 범위는 URL의 `{spaceSlug}`로 결정한다.
- `targetFolderId`가 `string`에서 `integer(int64)`로 변경됐다.
- `spaceSlug` 설명/예시가 UUID 전제에서 일반 slug 문자열로 변경됐다.

### Added

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

### Changed

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

### Preserved As Draft

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
