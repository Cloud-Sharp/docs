# 구현 상태 트래커

> LLM이 개발 진행에 따라 업데이트한다. 상태: `[ ]` 미착수 / `[~]` 진행 중 / `[x]` 완료

---

## Infrastructure

| 항목 | 상태 | 비고 |
|------|------|------|
| Docker Compose 기본 구성 | [x] | postgres, redis, tusd |
| Health check 엔드포인트 | [x] | `/api/v1/health` |
| EF Core DbContext 설정 | [x] | `CloudSharpDbContext` 및 엔티티 configuration 적용 |
| InitialCreate Migration | [x] | 기본 DB 스키마 생성 |
| UserName 컬럼 Migration | [x] | `users.user_name` nullable `VARCHAR(100)` 컬럼 추가 |
| Folder uniqueness Migration | [x] | 폴더 중복 제약 추가 |
| StorageProvider Migration | [x] | `file_items.storage_provider` 추가 |
| FileReservation 예약 상태 Migration | [x] | `file_reservations.is_reserved` 추가 |
| SpaceInvite 링크 초대 Migration | [x] | SpaceInvite를 링크 초대 구조로 전환 |
| FilePurgeRequest Migration | [x] | 영구 삭제 요청 추적 테이블 추가 |

---

## 인증 (Auth)

| 항목 | 상태 | 비고 |
|------|------|------|
| 회원가입 | [x] | `POST /api/v1/auth/register` |
| 로그인 / 세션 토큰 발급 | [x] | `POST /api/v1/auth/login` |
| 세션 만료 처리 | [x] | Redis TTL 기반 opaque session token |
| 세션 연장 | [ ] | 별도 refresh/extend API 없음 |
| 로그아웃 | [x] | `POST /api/v1/auth/logout` |
| 내 프로필 조회 | [x] | `GET /api/v1/me`, legacy `POST /api/v1/me` |

---

## 관리자 (Admin)

| 항목 | 상태 | 비고 |
|------|------|------|
| 전역 관리자 권한 모델 | [x] | `RequireAdminAccess()` + `AdminSessionOnly` policy |
| 사용자 목록 조회 | [x] | `GET /api/v1/admin/users` |
| 사용자 상세 조회 | [x] | `GET /api/v1/admin/users/{userId}` |
| 사용자 상태 관리 | [x] | `PATCH /api/v1/admin/users/{userId}/status` |
| 전체 Space 목록 조회 | [x] | `GET /api/v1/admin/spaces` |
| Space별 사용량 조회 | [x] | `GET /api/v1/admin/spaces/{spaceId}/usage` |
| 운영자용 Space 상태/Quota 관리 | [x] | `PATCH /api/v1/admin/spaces/{spaceId}/status`, `PATCH /api/v1/admin/spaces/{spaceId}/quota` |

---

## MCP 권한 토큰

| 항목 | 상태 | 비고 |
|------|------|------|
| MCP 토큰 권한 모델 설계 | [~] | 현재는 사용자 소유 token 단위, 세부 scope/허용 Space 정책은 확장 여지 |
| MCP 토큰 발급 | [x] | `POST /api/v1/mcp-tokens`, raw token은 발급 시 1회만 반환 |
| MCP 토큰 목록/상세 조회 | [~] | `GET /api/v1/mcp-tokens` 목록 구현, 단건 상세 API 없음 |
| MCP 토큰 폐기 | [x] | `DELETE /api/v1/mcp-tokens/{tokenId}` |
| MCP 토큰 인증 핸들러 | [x] | `McpTokenAuthenticationHandler` |
| MCP 토큰 기반 권한 검사 | [~] | MCP token 인증은 존재, 세부 scope + Space policy 조합은 확장 필요 |
| MCP 관리 UI | [~] | 프론트 mock 화면 존재, backend API 연동 없음 |

---

## Space

| 항목 | 상태 | 비고 |
|------|------|------|
| Space 생성 | [x] | `POST /api/v1/spaces` |
| Space 목록 조회 | [x] | `GET /api/v1/spaces` |
| Space 상세 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}` |
| Space 수정 | [x] | `PATCH /api/v1/spaces/{spaceSlug}` |
| Space 삭제 | [x] | `DELETE /api/v1/spaces/{spaceSlug}` |
| Quota 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/quota` |
| Quota 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/quota` |

---

## 멤버십 (SpaceMember / SpaceInvite)

| 항목 | 상태 | 비고 |
|------|------|------|
| 초대 도메인 모델 | [x] | Core `SpaceInvite` aggregate 구현 |
| 초대 링크 생성/조회 | [x] | `GET/POST /api/v1/spaces/{spaceSlug}/invites` |
| 초대 링크 상세 조회 | [x] | `GET /api/v1/invites/{inviteToken}` |
| 초대 링크 수락 | [x] | `POST /api/v1/invites/accept`, 기본 Role `VIEWER` |
| 초대 링크 폐기 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/invites/{inviteToken}` |
| Role 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/members/{memberId}` |
| 멤버 강퇴 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/members/{memberId}` |
| Space 나가기 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/leave` |
| 멤버 목록 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/members` |

---

## 파일·폴더

| 항목 | 상태 | 비고 |
|------|------|------|
| 폴더 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/folders` |
| 폴더 목록 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/folders/{folderId}/children` |
| 폴더 이름 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/folders/{folderId}` |
| 폴더 이동 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/folders/{folderId}` |
| 폴더 삭제 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/folders/{folderId}` |
| 파일 목록 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/folders/{folderId}/children` 응답에 파일 포함 |
| 파일 이름 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일 이동 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일 삭제 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일 상세 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/files/{fileId}`, `metadataJson`, thumbnail/metadata status 포함 |
| 파일 썸네일 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/files/{fileId}/thumbnail`, `image/jpeg` |
| 파일/폴더 검색 | [x] | `GET /api/v1/spaces/{spaceSlug}/search` |
| 파일 미리보기 | [x] | `GET /api/v1/spaces/{spaceSlug}/files/{fileId}/preview` |
| Space 태그 CRUD | [x] | `GET/POST /api/v1/spaces/{spaceSlug}/tags`, `PATCH/DELETE /api/v1/spaces/{spaceSlug}/tags/{tagId}` |
| 파일 태그 추가/교체/제거 | [x] | `POST/PUT/DELETE /api/v1/spaces/{spaceSlug}/files/tags` |
| 휴지통 파일 목록 | [x] | `GET /api/v1/spaces/{spaceSlug}/trash/files` |
| 휴지통 파일 복원 | [x] | `POST /api/v1/spaces/{spaceSlug}/trash/files/{fileId}/restore` |
| 휴지통 파일 영구 삭제 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/trash/files/{fileId}` |

---

## 업로드

| 항목 | 상태 | 비고 |
|------|------|------|
| FileReservation 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/upload-sessions` |
| UploadSession 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/upload-sessions` |
| UploadSession 조회 | [x] | `GET /api/v1/spaces/{spaceSlug}/upload-sessions/{token}` |
| tusd 훅 연동 | [x] | `POST /internal/tusd/hooks` |
| Finalize 처리 | [x] | `POST /api/internal/uploads/finalize`, tusd `post-finish` |
| Finalize 복구 배치 | [x] | `UploadFinalizeRecoveryService` stale `FINALIZING` 세션 복구 |
| 실패 업로드 정리 배치 | [ ] | 실패/만료 세션 및 임시 파일 정리 정책 미구현 |

---

## 다운로드

| 항목 | 상태 | 비고 |
|------|------|------|
| DownloadSession 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/files/{fileId}/download-sessions` |
| 파일 스트리밍 | [x] | `GET /public/v1/download-sessions/{sessionToken}/stream` |
| 공유 링크 다운로드 세션 | [x] | `POST /public/v1/share-links/{shareToken}/download-sessions` |
| 세션 revoke | [ ] | Redis download session revoke API 없음 |

---

## 공유 (ShareLink)

| 항목 | 상태 | 비고 |
|------|------|------|
| ShareLink 도메인/영속화 | [x] | Domain, Repository, EF entity/configuration 구현 |
| ShareLink 생성 | [x] | `POST /api/v1/share-links` |
| ShareLink 옵션 수정 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}` |
| ShareLink 상태 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}/status` |
| ShareLink 삭제/폐기 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/share-links/{shareLinkId}` |
| 공개 링크 검증 | [x] | `POST /public/v1/share-links/{shareToken}/verify` |
| 링크 기반 파일/폴더 탐색 | [x] | `POST /public/v1/share-links/{shareToken}/browse` |
| 링크 기반 다운로드 세션 발급 | [x] | `POST /public/v1/share-links/{shareToken}/download-sessions` |

---

## 이벤트 Outbox

| 항목 | 상태 | 비고 |
|------|------|------|
| Outbox 이벤트 모델 설계 | [x] | event type, aggregate, payload, retry metadata |
| Outbox EF 엔티티/마이그레이션 | [x] | `outbox_events` 테이블 |
| UseCase 내 명시적 outbox append | [x] | 업로드 완료, 파일 삭제, 공유/초대/권한 변경 등 |
| Outbox polling background service | [x] | dispatcher 등록 여부 기반 claim, retry, 실패 기록 |
| Outbox 처리 중복 방지 | [x] | `PROCESSING` lock + worker id 기반 상태 전이 |
| Outbox RealtimeFanout dispatcher | [x] | `RealtimeFanoutOutboxEventDispatcher`, `ISseConnectionStore` |
| Outbox 테스트 | [x] | Repository 상태 전이 + API runner routing + SSE/dispatcher 테스트 |

---

## 실시간 이벤트 (SSE / Redis Pub/Sub)

| 항목 | 상태 | 비고 |
|------|------|------|
| SSE API (인메모리 fan-out) | [x] | `GET /api/v1/events/stream`, `ISseConnectionStore`, `RealtimeFanoutOutboxEventDispatcher` |
| Space/사용자별 이벤트 권한 필터 | [x] | active member 기준 space 이벤트, `MemberRemoved`는 제거된 user 포함, `UploadFinalizeFailed`는 requester 개인 |
| Redis Pub/Sub 이벤트 발행 | [ ] | Outbox 처리 결과를 Redis로 fan-out (다중 인스턴스 확장) |
| Redis Pub/Sub 구독 서비스 | [ ] | API 인스턴스별 SSE 연결에 전달 (다중 인스턴스 확장) |
| 프론트엔드 SSE 클라이언트 | [ ] | 재연결, 상태 업데이트 반영 (별도 작업) |

---

## 후처리 (Metadata / Thumbnail / AI Worker)

| 항목 | 상태 | 비고 |
|------|------|------|
| 후처리 작업 이벤트 계약 | [ ] | File finalized 이벤트 기반 작업 분기 |
| 파일별 JSON 메타데이터 저장 필드 | [x] | `file_items.metadata_json` 도메인/EF/응답 매핑 존재 |
| 파일별 JSON 메타데이터 구조 | [ ] | AI/thumbnail 결과용 schema 확정 필요 |
| 파일 유형 판별/기본 메타데이터 추출 | [ ] | SFR-044 |
| 이미지 썸네일 생성 | [ ] | 실패해도 다운로드 차단하지 않음 |
| 비디오 썸네일 생성 | [ ] | ffmpeg 기반 |
| AI 메타데이터 추출 | [ ] | SFR-045/SFR-047 기반 자동 태그/검색 확장 |
| 후처리 상태 응답 필드 | [x] | 파일 상세 응답에 `scanStatus`, `previewStatus`, `thumbnailStatus`, `metadataStatus` 존재 |
| 후처리 실패 정책 구현 | [ ] | quarantined/downloadable 정책 연결 |
