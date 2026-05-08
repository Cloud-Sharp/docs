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

---

## 인증 (Auth)

| 항목 | 상태 | 비고 |
|------|------|------|
| 회원가입 | [x] | `POST /api/v1/auth/register` |
| 로그인 / 세션 토큰 발급 | [x] | `POST /api/v1/auth/login` |
| 세션 연장 / 만료 처리 | [ ] | |
| 로그아웃 | [x] | `POST /api/v1/auth/logout` |
| 내 프로필 조회 | [x] | `GET /api/v1/me`, legacy `POST /api/v1/me` |

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
| 초대 링크 생성/조회 | [ ] | 문서 계약 확정, 구현 예정 |
| 초대 링크 수락 | [ ] | 기본 Role `VIEWER`, 구현 예정 |
| 초대 링크 폐기 | [ ] | row 삭제 정책 및 API 초안 문서화 완료, 구현 예정 |
| Role 변경 | [ ] | |
| 멤버 강퇴 | [ ] | |
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
| 파일 목록 조회 | [ ] | |
| 파일 이름 변경 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일 이동 | [x] | `PATCH /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일 삭제 | [x] | `DELETE /api/v1/spaces/{spaceSlug}/files/{fileId}` |
| 파일/폴더 검색 | [x] | `GET /api/v1/spaces/{spaceSlug}/search` |
| 파일 미리보기 | [x] | `GET /api/v1/spaces/{spaceSlug}/files/{fileId}/preview` |

---

## 업로드

| 항목 | 상태 | 비고 |
|------|------|------|
| FileReservation 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/upload-sessions` |
| UploadSession 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/upload-sessions` |
| tusd 훅 연동 | [x] | `POST /internal/tusd/hooks` |
| Finalize 처리 | [x] | `POST /api/internal/uploads/finalize`, tusd `post-finish` |
| 실패 정리 배치 | [ ] | |

---

## 다운로드

| 항목 | 상태 | 비고 |
|------|------|------|
| DownloadSession 생성 | [x] | `POST /api/v1/spaces/{spaceSlug}/files/{fileId}/download-sessions` |
| 파일 스트리밍 | [x] | `GET /public/v1/download-sessions/{sessionToken}/stream` |
| 세션 revoke | [ ] | |

---

## 공유 (ShareLink)

| 항목 | 상태 | 비고 |
|------|------|------|
| ShareLink 생성 | [ ] | |
| ShareLink 조회 | [ ] | |
| ShareLink 삭제 | [ ] | |
| 링크 기반 파일 접근 | [ ] | |

---

## 후처리 (Worker)

| 항목 | 상태 | 비고 |
|------|------|------|
| Redis Pub/Sub 이벤트 발행 | [ ] | |
| ffmpeg 썸네일 생성 | [ ] | |
| AI 메타데이터 추출 | [ ] | |
