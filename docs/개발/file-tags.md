# File Tags 설계

## 1. 목적

파일 태그는 Space 내부에서 파일을 분류하고, 폴더 탐색 화면과 검색 결과에서 빠르게 식별할 수 있게 하는 메타데이터다.

태그는 전역 리소스가 아니라 Space에 종속된다. 파일에 태그를 붙이려면 해당 Space의 태그 목록에 먼저 태그가 생성되어 있어야 한다.

## 2. 핵심 정책

| 항목 | 정책 |
|---|---|
| 소유 범위 | 태그는 `space_id`에 귀속된다. 다른 Space의 태그를 재사용할 수 없다. |
| 식별자 | `tags.id`, `file_tags.id`는 `BIGINT`/C# `long`을 사용한다. |
| 태그 생성 | Space 태그 목록에 먼저 생성된 태그만 파일에 부착할 수 있다. |
| 다중 태그 | 하나의 파일은 여러 태그를 가질 수 있다. |
| 중복 부착 | 동일 파일에 동일 태그를 중복 부착할 수 없다. |
| 태그명 중복 | 같은 Space 안에서 활성 태그명은 중복될 수 없다. |
| 태그명 길이 | 태그명은 정규화 후 1자 이상 30자 이하만 허용한다. |
| 색상 | 태그 색상은 필수 입력이며 `#RRGGBB` 형식의 hex color로 저장한다. 예: `#4A90E2` |
| 정렬 | 태그 목록과 파일별 태그 요약은 `name asc`, 동일하면 `id asc`로 정렬한다. |
| 폴더 탐색 | 폴더 children 응답의 파일 항목에 태그 요약 목록을 포함한다. |
| 검색 | Space 검색 API에서 태그 ID 기반 필터를 지원한다. |

## 3. 권한 정책

| 동작 | 최소 Role | 설명 |
|---|---|---|
| 태그 목록 조회 | `VIEWER` | Space 접근 권한이 있으면 태그 목록을 볼 수 있다. |
| 태그 생성/수정/삭제 | `ADMIN` | Space 공용 분류 체계 변경이므로 관리자 이상으로 제한한다. |
| 파일에 태그 부착/제거 | `MEMBER` | 파일 메타데이터 수정 권한과 같은 수준으로 본다. |
| 태그 검색 | `VIEWER` | 파일 조회 권한이 있는 사용자는 태그로 검색할 수 있다. |

`OWNER`는 모든 동작을 수행할 수 있다. `VIEWER`는 태그와 태그가 붙은 파일을 조회할 수 있지만 태그를 만들거나 파일 태그를 변경할 수 없다.

## 4. 데이터 모델

### 4.1 `tags`

Space별 태그 사전 테이블이다.

| 컬럼 | 타입 | Null | 설명 |
|---|---|---:|---|
| `id` | BIGINT | N | PK, identity |
| `space_id` | BIGINT | N | FK `spaces.id` |
| `name` | VARCHAR(30) | N | 사용자에게 표시할 태그명 |
| `normalized_name` | VARCHAR(30) | N | 중복 검사용 정규화 태그명 |
| `color` | CHAR(7) | N | `#RRGGBB` |
| `created_by_user_id` | BIGINT | N | FK `users.id` |
| `created_at` | TIMESTAMPTZ | N | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | N | 수정 시각 |
| `deleted_at` | TIMESTAMPTZ | Y | 소프트 삭제 시각 |

Indexes and constraints:

| 종류 | 이름 | 조건/컬럼 |
|---|---|---|
| UNIQUE | `ux_tags_space_normalized_name_active` | `(space_id, normalized_name)` where `deleted_at IS NULL` |
| INDEX | `idx_tags_space_id` | `space_id` |
| CHECK | `chk_tags_name_not_blank` | `BTRIM(name) <> ''` |
| CHECK | `chk_tags_name_length` | `CHAR_LENGTH(name) <= 30` |
| CHECK | `chk_tags_color_hex` | `color ~ '^#[0-9A-Fa-f]{6}$'` |

정규화 규칙:

- 앞뒤 공백을 제거한다.
- 연속 공백은 단일 공백으로 정리한다.
- 대소문자를 구분하지 않도록 lower-case 기준으로 비교한다.
- 정규화 후 1자 이상 30자 이하만 허용한다.
- 저장 응답의 `name`은 사용자가 입력한 표시명을 유지한다.

### 4.2 `file_tags`

파일과 태그의 다대다 매핑 테이블이다.

| 컬럼 | 타입 | Null | 설명 |
|---|---|---:|---|
| `id` | BIGINT | N | PK, identity |
| `space_id` | BIGINT | N | 조회 최적화 및 Space 일관성 검증용 |
| `file_item_id` | BIGINT | N | FK `file_items.id` |
| `tag_id` | BIGINT | N | FK `tags.id` |
| `created_by_user_id` | BIGINT | N | FK `users.id` |
| `created_at` | TIMESTAMPTZ | N | 부착 시각 |
| `deleted_at` | TIMESTAMPTZ | Y | 제거 시각 |

Indexes and constraints:

| 종류 | 이름 | 조건/컬럼 |
|---|---|---|
| UNIQUE | `ux_file_tags_active` | `(file_item_id, tag_id)` where `deleted_at IS NULL` |
| INDEX | `idx_file_tags_space_tag_file` | `(space_id, tag_id, file_item_id)` where `deleted_at IS NULL` |
| INDEX | `idx_file_tags_file` | `(file_item_id)` where `deleted_at IS NULL` |

DB 또는 UseCase에서 반드시 보장할 조건:

- `file_tags.space_id`는 대상 파일의 `file_items.space_id`와 같아야 한다.
- `file_tags.space_id`는 대상 태그의 `tags.space_id`와 같아야 한다.
- 삭제된 파일 또는 삭제된 태그에는 새 매핑을 만들 수 없다.

PostgreSQL에서 강하게 보장하려면 `tags(id, space_id)`와 `file_items(id, space_id)`에 alternate key를 두고 `file_tags(tag_id, space_id)`, `file_tags(file_item_id, space_id)` 복합 FK를 사용한다.

## 5. API 설계

### 5.1 Space 태그 관리

Base path:

```text
/api/v1/spaces/{spaceSlug}/tags
```

| Method | Path | 설명 | 최소 Role |
|---|---|---|---|
| `GET` | `/api/v1/spaces/{spaceSlug}/tags` | Space 태그 목록 조회 | `VIEWER` |
| `POST` | `/api/v1/spaces/{spaceSlug}/tags` | Space 태그 생성 | `ADMIN` |
| `PATCH` | `/api/v1/spaces/{spaceSlug}/tags/{tagId}` | 태그명 또는 색상 변경 | `ADMIN` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/tags/{tagId}` | 태그 삭제 | `ADMIN` |

태그 생성 요청:

```json
{
  "name": "프로젝트",
  "color": "#4A90E2"
}
```

`name`과 `color`는 모두 필수다. 서버는 색상 기본값을 대신 채우지 않는다.

태그 응답:

```json
{
  "id": 1,
  "spaceId": 10,
  "name": "프로젝트",
  "color": "#4A90E2",
  "createdAt": "2026-05-15T03:00:00Z",
  "updatedAt": "2026-05-15T03:00:00Z"
}
```

목록 조회 응답:

```json
{
  "items": [
    {
      "id": 1,
      "spaceId": 10,
      "name": "프로젝트",
      "color": "#4A90E2",
      "createdAt": "2026-05-15T03:00:00Z",
      "updatedAt": "2026-05-15T03:00:00Z"
    }
  ]
}
```

목록은 `name asc`, 동일하면 `id asc` 순서로 반환한다.

삭제 정책:

- 태그 삭제는 `tags.deleted_at = now`로 소프트 삭제한다.
- 활성 `file_tags` 매핑도 함께 `deleted_at = now`로 처리한다.
- 삭제된 태그는 폴더 탐색, 검색, 태그 목록에서 노출하지 않는다.

### 5.2 파일 태그 부착/제거

Base path:

```text
/api/v1/spaces/{spaceSlug}/files/tags
```

| Method | Path | 설명 | 최소 Role |
|---|---|---|---|
| `POST` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일에 태그 추가 | `MEMBER` |
| `PUT` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일의 태그 목록 전체 교체 | `MEMBER` |
| `DELETE` | `/api/v1/spaces/{spaceSlug}/files/tags` | 파일에서 태그 제거 | `MEMBER` |

태그 추가 요청:

```json
{
  "fileId": 100,
  "tagIds": [1, 2]
}
```

전체 교체 요청:

```json
{
  "fileId": 100,
  "tagIds": [1, 3, 5]
}
```

태그 제거 요청:

```json
{
  "fileId": 100,
  "tagIds": [2]
}
```

응답은 변경 후 파일의 태그 요약 목록을 반환한다.

```json
{
  "fileId": 100,
  "tags": [
    {
      "id": 1,
      "name": "프로젝트",
      "color": "#4A90E2"
    }
  ]
}
```

처리 규칙:

- `tagIds`는 비어 있을 수 없다. 단, `PUT`은 빈 배열을 허용해 모든 태그를 제거할 수 있다.
- 존재하지 않는 태그 ID, 삭제된 태그 ID, 다른 Space의 태그 ID는 실패 처리한다.
- 존재하지 않는 파일, 삭제된 파일, 다른 Space의 파일은 실패 처리한다.
- 이미 붙어 있는 태그를 `POST`로 다시 보내면 멱등 처리한다.
- 붙어 있지 않은 태그를 `DELETE`로 보내면 멱등 처리한다.

## 6. 폴더 탐색 응답 확장

`GET /api/v1/spaces/{spaceSlug}/folders/{folderId}/children`의 파일 항목에 `tags` 필드를 추가한다.

```json
{
  "type": "file",
  "id": "100",
  "name": "기획서.pdf",
  "sizeBytes": 123456,
  "mimeType": "application/pdf",
  "updatedAt": "2026-05-15T03:00:00Z",
  "tags": [
    {
      "id": 1,
      "name": "프로젝트",
      "color": "#4A90E2"
    }
  ]
}
```

MVP에서는 파일 태그만 지원한다. 폴더 자체에 태그를 붙이는 기능은 범위 밖이다.

## 7. 태그 검색

기존 Space 검색 API에 태그 필터를 추가한다.

```text
GET /api/v1/spaces/{spaceSlug}/search?q={keyword}&tagIds=1,2&tagMatch=any
```

| Query | 필수 | 설명 |
|---|---:|---|
| `q` | N | 기존 파일/폴더명 검색어. 태그만으로 검색할 때는 생략 가능하다. |
| `tagIds` | N | 쉼표로 구분한 태그 ID 목록 |
| `tagMatch` | N | `any` 또는 `all`, 기본값 `any` |

검색 규칙:

- `tagIds`가 있으면 파일 결과만 태그 조건으로 필터링한다.
- `tagMatch=any`는 지정된 태그 중 하나 이상이 붙은 파일을 반환한다.
- `tagMatch=all`은 지정된 태그가 모두 붙은 파일만 반환한다.
- `q`와 `tagIds`가 함께 있으면 두 조건을 모두 만족하는 결과만 반환한다.
- 폴더는 태그를 갖지 않으므로 태그 필터가 있는 검색에서는 폴더 결과를 제외한다.

## 8. 에러 코드

| 코드 | HTTP | 설명 |
|---|---:|---|
| `TAG_NOT_FOUND` | 404 | 태그가 없거나 현재 Space에서 접근할 수 없음 |
| `TAG_NAME_CONFLICT` | 409 | 같은 Space에 동일한 활성 태그명이 있음 |
| `TAG_INVALID_COLOR` | 400 | 색상 값이 `#RRGGBB` 형식이 아님 |
| `TAG_INVALID_NAME` | 400 | 태그명이 비어 있거나 길이 제한을 초과함 |
| `FILE_TAG_SPACE_MISMATCH` | 400 | 파일과 태그가 같은 Space에 속하지 않음 |
| `FILE_TAG_LIMIT_EXCEEDED` | 400 | 파일당 허용 태그 개수를 초과함 |

파일당 태그 개수 제한은 MVP에서 기본 `20`개로 둔다. 제한값은 이후 Space 정책으로 확장할 수 있다.

## 9. 구현 순서

1. Core 도메인 모델과 UseCase 계약 추가: `Tags`, `FileTags`.
2. Infrastructure EF entity/configuration/migration 추가.
3. `ITagRepository` 또는 기존 파일 repository 확장으로 태그 목록/매핑 조회 구현.
4. Space 태그 관리 endpoint 추가.
5. 파일 태그 부착/제거 endpoint 추가.
6. 폴더 children, 검색 응답에 `TagSummary` 포함.
7. 태그명 중복, 색상 validation, 권한, Space mismatch 단위/통합 테스트 추가.

## 10. 결정 사항

| 항목 | 결정 |
|---|---|
| 태그 정렬 | `name asc`, 동일하면 `id asc` |
| 태그명 최대 길이 | 30자 |
| 색상 기본값 | 없음. `color`는 필수 입력 |
| 자동 태그 | SFR-045 AI/후처리 자동 태그는 별도 후속 설계에서 이 태그 사전을 재사용한다. |
