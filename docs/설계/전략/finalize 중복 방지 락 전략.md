# CAS 기반 Finalize 설계안 정리

## 1. 설계 목적

> **핵심 목표**: 업로드 완료 후 저장 확정(finalize)을 **단 한 번만, 중복 없이** 수행하고,
> 장애 발생 시에도 **복구 가능한 상태 기반 처리**를 보장한다.

| 설계 원칙 | 설명 |
|-----------|------|
| **CAS 기반 점유** | `UploadSession.status`의 원자적 상태 전이로 finalize 소유권 확보 |
| **트랜잭션 경계 분리** | 파일 I/O는 트랜잭션 밖, 메타데이터 반영만 짧은 트랜잭션 |
| **외부 락 미사용** | 분산 락·장시간 DB 락 없이 상태 머신만으로 동시성 제어 |
| **자동 복구** | Recovery Worker가 중간 상태에 머문 세션을 자동 보정 |

---

## 2. 엔티티 관계 및 상태 머신

### 2.1 엔티티 관계도

```mermaid
erDiagram
    UploadSession ||--|| FileReservation : "1:1 예약"
    UploadSession ||--o| FileItem : "완료 시 생성"
    UploadSession {
        bigint id PK
        varchar status
        bigint owner_user_id FK
        bigint target_folder_id FK
        varchar original_filename
        bigint expected_size_bytes
        bigint received_size_bytes
        varchar temp_storage_key
        varchar storage_key
        varchar checksum_sha256
        varchar tus_upload_id
        timestamp finalizing_started_at
        timestamp finalized_at
        int finalize_attempts
        varchar last_error_code
        text last_error_message
        timestamp created_at
        timestamp updated_at
    }
    FileReservation {
        bigint id PK
        bigint upload_session_id FK
        varchar status
        bigint folder_id FK
        varchar display_name
        bigint reserved_bytes
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }
    FileItem {
        bigint id PK
        bigint upload_session_id UK
        bigint owner_user_id FK
        bigint folder_id FK
        varchar display_name
        varchar mime_type
        bigint size_bytes
        varchar checksum_sha256
        varchar storage_key
        timestamp created_at
        timestamp updated_at
    }
    Users {
        bigint id PK
        bigint storage_used_bytes
        bigint storage_reserved_bytes
        timestamp updated_at
    }
    Users ||--o{ UploadSession : "소유"
    Users ||--o{ FileItem : "소유"
```

### 2.2 UploadSession 상태 머신

```mermaid
stateDiagram-v2
    [*] --> UPLOADING : 세션 생성 & tus 전송 시작

    UPLOADING --> FINALIZING : CAS 점유 성공<br/>(단 하나의 프로세스만)
    UPLOADING --> FAILED : 전송 중 오류

    FINALIZING --> COMPLETED : 검증 + 이동 + DB 확정 성공
    FINALIZING --> FAILED : 검증 실패 / 이동 실패 / DB 실패

    note right of FINALIZING
        Recovery Worker 감시 대상
        10분 이상 체류 시 재평가
    end note

    COMPLETED --> [*]
    FAILED --> [*]
```

### 2.3 FileReservation 상태 머신

```mermaid
stateDiagram-v2
    [*] --> RESERVED : 업로드 세션 생성 시 자원 선점

    RESERVED --> ACTIVE : tus 전송 진행 중
    ACTIVE --> CONSUMED : finalize DB 확정 트랜잭션
    ACTIVE --> FAILED : finalize 실패 시
    RESERVED --> FAILED : 전송 실패 / 만료

    CONSUMED --> [*]
    FAILED --> [*]
```

---

## 3. Finalize 전체 처리 흐름

```mermaid
flowchart TD
    A[tus 업로드 완료 감지] --> B{CAS 점유 시도<br/>UPLOADING → FINALIZING}

    B -->|affected_rows = 1<br/>점유 성공| C[대상 정보 조회<br/>Session + Reservation]
    B -->|affected_rows = 0<br/>점유 실패| Z1[이미 다른 프로세스가 처리 중<br/>현재 프로세스 종료]

    C --> D[임시 파일 최종 검증]

    D -->|검증 통과| E[최종 저장 경로 결정<br/>& 파일 이동]
    D -->|검증 실패| F1[실패 처리]

    E -->|이동 성공| G[DB 확정 트랜잭션]
    E -->|이동 실패| F2[실패 처리]

    G -->|커밋 성공| H[✅ COMPLETED]
    G -->|커밋 실패| F3[실패 처리]

    F1 --> F[FAILED 상태 기록<br/>임시 파일 정리]
    F2 --> F
    F3 --> F

    style B fill:#fff3cd,stroke:#ffc107
    style G fill:#d4edda,stroke:#28a745
    style H fill:#28a745,color:#fff
    style F fill:#f8d7da,stroke:#dc3545
    style Z1 fill:#e2e3e5,stroke:#6c757d
```

---

## 4. 시퀀스 다이어그램

### 4.1 정상 처리 흐름

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant DB as Database
    participant FS as File Storage

    C->>S: tus PATCH (마지막 청크)
    S-->>C: 204 전송 완료

    Note over S: finalize 시작

    S->>DB: CAS UPDATE status<br/>UPLOADING → FINALIZING
    DB-->>S: affected_rows = 1 (점유 성공)

    S->>DB: Session + Reservation 조회
    DB-->>S: 세션 정보 반환

    Note over S: 트랜잭션 밖 처리

    S->>FS: 임시 파일 검증<br/>(크기, 해시, MIME, 정책)
    FS-->>S: 검증 통과

    S->>FS: 임시 파일 → 최종 경로 이동
    FS-->>S: 이동 성공

    Note over S,DB: 짧은 DB 트랜잭션

    S->>DB: BEGIN
    S->>DB: INSERT FileItem
    S->>DB: UPDATE Users (사용량 반영)
    S->>DB: UPDATE FileReservation → CONSUMED
    S->>DB: UPDATE UploadSession → COMPLETED
    S->>DB: COMMIT
    DB-->>S: 커밋 성공

    C->>S: GET /uploads/{sessionId}
    S-->>C: status=COMPLETED, fileItemId, metadata
```

### 4.2 중복 요청 차단 흐름

```mermaid
sequenceDiagram
    participant W1 as Worker A
    participant W2 as Worker B
    participant DB as Database

    Note over W1,W2: 동시에 finalize 시도

    W1->>DB: CAS UPDATE<br/>UPLOADING → FINALIZING
    W2->>DB: CAS UPDATE<br/>UPLOADING → FINALIZING

    DB-->>W1: affected_rows = 1 ✅
    DB-->>W2: affected_rows = 0 ❌

    Note over W1: finalize 수행 진행
    Note over W2: 즉시 종료 (중복 방지)

    W1->>DB: DB 확정 트랜잭션
    DB-->>W1: COMPLETED
```

---

## 5. 단계별 상세

### 5.1 CAS 점유 (Step 1)

```sql
UPDATE upload_session
SET    status               = 'FINALIZING',
       finalizing_started_at = now(),
       finalize_attempts     = finalize_attempts + 1,
       updated_at            = now()
WHERE  id     = :session_id
  AND  status = 'UPLOADING';
-- affected_rows = 1 → 점유 성공
-- affected_rows = 0 → 점유 실패 (이미 처리 중)
```

### 5.2 임시 파일 최종 검증 (Step 2)

| 검증 항목 | 설명 | 실패 코드 |
|-----------|------|-----------|
| 파일 존재 여부 | 임시 경로에 파일이 실제로 있는지 | `FILE_NOT_FOUND` |
| 크기 일치 | `received_size == expected_size` | `SIZE_MISMATCH` |
| 체크섬 | SHA-256 해시 비교 | `CHECKSUM_MISMATCH` |
| MIME 판별 | 서버 기준 magic bytes 검사 | `MIME_BLOCKED` |
| Quota 최종 확인 | 사용량 + 파일 크기 ≤ 한도 | `QUOTA_EXCEEDED` |
| 위험 파일 정책 | 확장자·내용 기반 차단 규칙 | `POLICY_VIOLATION` |

### 5.3 파일 이동 (Step 3) — 트랜잭션 밖

```mermaid
flowchart LR
    A[임시 저장소<br/>temp_storage_key] -->|동일 FS: rename| B[최종 저장소<br/>storage_key]
    A -->|다른 저장소: copy + verify| B
    B --> C[원본 임시 파일 삭제]
```

### 5.4 DB 확정 트랜잭션 (Step 4)

```sql
BEGIN;

-- 1) FileItem 생성
INSERT INTO file_item (
    upload_session_id, owner_user_id, folder_id,
    display_name, mime_type, size_bytes,
    checksum_sha256, storage_key, created_at, updated_at
) VALUES (
    :session_id, :owner_user_id, :target_folder_id,
    :display_name, :mime_type, :size_bytes,
    :checksum_sha256, :storage_key, now(), now()
);

-- 2) 사용량 반영
UPDATE users
SET    storage_used_bytes     = storage_used_bytes + :size_bytes,
       storage_reserved_bytes = storage_reserved_bytes - :size_bytes,
       updated_at             = now()
WHERE  id = :owner_user_id;

-- 3) 예약 소비
UPDATE file_reservation
SET    status = 'CONSUMED', updated_at = now()
WHERE  id = :reservation_id AND status = 'ACTIVE';

-- 4) 세션 완료
UPDATE upload_session
SET    status          = 'COMPLETED',
       finalized_at    = now(),
       storage_key     = :storage_key,
       checksum_sha256 = :checksum_sha256,
       updated_at      = now()
WHERE  id = :session_id AND status = 'FINALIZING';

COMMIT;
```

> **`file_item.upload_session_id`에 UNIQUE 제약**을 걸어
> 동일 세션에서 FileItem이 2개 생성되는 것을 DB 레벨에서 차단한다.

---

## 6. 실패 처리

```mermaid
flowchart TD
    E[실패 발생] --> F{실패 유형}

    F -->|검증 실패| G1[SIZE_MISMATCH<br/>MIME_BLOCKED<br/>QUOTA_EXCEEDED<br/>CHECKSUM_MISMATCH]
    F -->|파일 이동 실패| G2[MOVE_FAILED]
    F -->|DB 커밋 실패| G3[DB_ERROR]
    F -->|타임아웃| G4[FINALIZE_TIMEOUT]

    G1 --> H[실패 트랜잭션]
    G2 --> H
    G3 --> H
    G4 --> H

    H --> I["BEGIN<br/>FileReservation → FAILED<br/>UploadSession → FAILED<br/>(error_code, error_message 기록)<br/>COMMIT"]
    I --> J[임시 파일 정리 시도]
    J --> K[이미 이동된 파일이 있으면 롤백 삭제]

    style E fill:#f8d7da,stroke:#dc3545
```

```sql
BEGIN;

UPDATE file_reservation
SET    status = 'FAILED', updated_at = now()
WHERE  id = :reservation_id
  AND  status IN ('ACTIVE', 'RESERVED');

UPDATE upload_session
SET    status             = 'FAILED',
       last_error_code    = :error_code,
       last_error_message = :error_message,
       updated_at         = now()
WHERE  id = :session_id AND status = 'FINALIZING';

COMMIT;
```

---

## 7. Recovery Worker

```mermaid
flowchart TD
    A[⏰ 주기적 실행<br/>e.g. 매 5분] --> B["FINALIZING 상태 &<br/>finalizing_started_at < now() - 10min<br/>세션 조회"]

    B --> C{대상 세션 존재?}
    C -->|없음| A

    C -->|있음| D{FileItem 존재?}

    D -->|YES| E["이미 완료된 상태<br/>→ COMPLETED로 보정"]
    D -->|NO| F{임시 파일 존재?}

    F -->|NO| G["복구 불가<br/>→ FAILED로 보정"]
    F -->|YES| H{재시도 횟수 < 최대?}

    H -->|YES| I["finalize 재시도<br/>(검증 → 이동 → DB 확정)"]
    H -->|NO| J["최대 재시도 초과<br/>→ FAILED + 알림"]

    style A fill:#e7f3ff,stroke:#0d6efd
    style E fill:#d4edda,stroke:#28a745
    style G fill:#f8d7da,stroke:#dc3545
    style J fill:#f8d7da,stroke:#dc3545
```

```sql
-- Recovery 대상 조회
SELECT id, finalize_attempts
FROM   upload_session
WHERE  status = 'FINALIZING'
  AND  finalizing_started_at < now() - interval '10 minutes'
ORDER BY finalizing_started_at
LIMIT  100;
```

| 판단 조건 | 조치 |
|-----------|------|
| `FileItem` 이미 존재 | → `COMPLETED`로 보정 |
| 임시 파일도 최종 파일도 없음 | → `FAILED`로 보정 |
| 임시 파일 존재 & 재시도 가능 | → finalize 재시도 |
| 최대 재시도 초과 | → `FAILED` + 운영 알림 |

---

## 8. 클라이언트 응답 설계

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C,S: 방식 1: 상태 조회 폴링

    C->>S: GET /uploads/{sessionId}
    S-->>C: { status: "FINALIZING" }

    C->>S: GET /uploads/{sessionId}
    S-->>C: { status: "COMPLETED",<br/>fileItemId: 42,<br/>displayName: "report.pdf",<br/>sizeBytes: 1048576 }

    Note over C,S: 방식 2: SSE/WebSocket 실시간 수신

    S-->>C: event: finalize_complete<br/>{ fileItemId: 42, status: "COMPLETED" }
```

**상태 조회 응답 구조**

```json
{
  "sessionId": "abc-123",
  "status": "COMPLETED",
  "fileItem": {
    "id": 42,
    "displayName": "report.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 1048576,
    "storageKey": "files/2024/01/abc123.pdf",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "error": null,
  "postProcessing": {
    "thumbnail": "PENDING",
    "virusScan": "IN_PROGRESS"
  }
}
```

---

## 9. 설계 장점 요약

```mermaid
mindmap
  root((CAS 기반<br/>Finalize))
    단순성
      외부 분산 락 불필요
      기존 상태 머신 재활용
      추가 인프라 없음
    안전성
      원자적 CAS로 중복 실행 방지
      UNIQUE 제약으로 중복 FileItem 차단
      트랜잭션 경계 명확 분리
    복구성
      Recovery Worker 자동 보정
      finalize_attempts로 재시도 제어
      상태 기반 판단 가능
    확장성
      후처리 큐와 자연스럽게 연결
      비동기 결과 응답 구조
      파일 이동과 DB 반영 독립
```

| 항목 | 설명 |
|------|------|
| **기존 구조 정합성** | `UploadSession` 상태 머신을 그대로 실행 제어로 활용 |
| **장시간 락 회피** | 파일 이동 같은 느린 I/O 중에도 DB 락을 잡지 않음 |
| **트랜잭션 경계 분리** | 파일 I/O ↔ DB 반영의 책임 영역 명확 |
| **자동 복구** | Recovery Worker로 중간 실패 상태 자동 정리 |
| **중복 방지 이중 안전장치** | CAS 상태 전이 + DB UNIQUE 제약 |

---

## 10. 한눈에 보는 전체 파이프라인

```mermaid
flowchart LR
    subgraph 전송 단계
        A[세션 생성<br/>UPLOADING] -->|tus PATCH| B[청크 수신]
        B -->|반복| B
        B -->|전송 완료| C[finalize 트리거]
    end

    subgraph Finalize 단계
        C --> D["CAS 점유<br/>UPLOADING→FINALIZING"]
        D --> E[파일 검증<br/>트랜잭션 밖]
        E --> F[파일 이동<br/>트랜잭션 밖]
        F --> G["DB 확정 트랜잭션<br/>FileItem + 사용량 + COMPLETED"]
    end

    subgraph 후처리
        G --> H[썸네일 생성]
        G --> I[바이러스 스캔]
        G --> J[검색 인덱싱]
        G --> K[감사 로그]
    end

    subgraph 복구
        L["Recovery Worker<br/>⏰ 주기 실행"] -.->|10min 초과<br/>FINALIZING 감시| D
    end

    style D fill:#fff3cd,stroke:#ffc107
    style G fill:#d4edda,stroke:#28a745
    style L fill:#e7f3ff,stroke:#0d6efd
```
