# Storage Quota 관리 정책

> 파일 업로드 시 Space 단위 저장 용량을 제어하기 위한 quota 판정, 예약, 확정, 해제, 정합성 유지 규칙을 정의한다.

---

## 1. 용어 정의

| 용어 | 필드 / 산출식 | 설명 |
|---|---|---|
| **used** | `storage_used_bytes` | 업로드가 완료·확정된 파일의 누적 크기 |
| **reserved** | `storage_reserved_bytes` | 현재 진행 중인 업로드가 선점한 예상 크기의 합 |
| **allowed** | `storage_allowed_bytes` | Space에 부여된 최대 허용 용량 (`NULL`이면 무제한) |
| **expected_size** | 요청 시 전달 | 이번 업로드가 점유하려는 파일 크기 |
| **available** | `allowed − used − reserved` | 현재 시점에서 추가 업로드에 사용할 수 있는 잔여 용량 |

---

## 2. 업로드 시작 허용 판정

### 2.1 판정 공식

```
used + reserved + expected_size  ≤  allowed
```

이를 정리하면 다음과 동일하다.

```
expected_size  ≤  available
          (= allowed − used − reserved)
```

이미 확정된 사용량(`used`), 현재 예약된 용량(`reserved`), 새 업로드 예상 크기(`expected_size`)의 합이 Space 허용 용량(`allowed`) 이하일 때만 업로드를 시작할 수 있다.

### 2.2 무제한 Space

| 조건 | 처리 |
|---|---|
| `storage_allowed_bytes = NULL` | **무제한 Space**로 간주한다. quota 초과 판정을 수행하지 않으며, 용량 부족으로 업로드를 거절하지 않는다. |

무제한 Space라 하더라도 아래 값은 **계속 갱신·관리**한다.

- `storage_used_bytes`
- `storage_reserved_bytes`

이는 다음 목적을 위해 필요하다.

- 실제 사용량 모니터링 및 통계
- 관리자 정책 변경 (무제한 → 제한 전환)
- 향후 제한 적용 시 정합성 유지

> `allowed = NULL`은 **quota 검사를 생략**한다는 의미이지, **사용량 집계를 생략**한다는 의미가 아니다.

---

## 3. 동시 업로드 경쟁 방지

동일 Space의 여러 멤버가 여러 탭·클라이언트에서 동시에 업로드를 시작할 수 있다. quota 판정과 예약 증가가 분리되면 **모든 요청이 동시에 통과하는 경쟁 조건**이 발생할 수 있으므로, 반드시 **단일 트랜잭션 내 원자적 작업**으로 처리해야 한다.

### 3.1 처리 순서 (하나의 트랜잭션)

```
BEGIN TX
  ① Space 행 조회 (FOR UPDATE 등 잠금 획득)
  ② used, reserved, allowed 기준으로 업로드 가능 여부 판정
  ③ 가능 → storage_reserved_bytes += expected_size
  ④ FileReservation 레코드 생성
COMMIT
```

> ①–④는 **분리하면 안 된다.** 판정 후 별도 업데이트를 느슨하게 수행하면 동시 요청이 모두 통과하는 경쟁 조건이 발생한다.

---

## 4. Finalize 직전 Quota 재검사

### 4.1 재검사 목적

업로드 시작 시 quota를 통과했더라도, **finalize 직전에 반드시 quota를 다시 검토**한다. 이는 아래 상황에 대응하기 위함이다.

| 상황 | 예시 |
|---|---|
| 예약 상태 불일치 | 비정상 세션 정리 지연으로 reserved가 이미 차감됨 |
| 운영자 정책 변경 | 업로드 도중 `storage_allowed_bytes`가 축소됨 |
| 데이터 보정 | 관리자 배치가 집계 값을 재계산함 |

### 4.2 정상 경로에서의 기대 동작

정상 경로라면 이미 `expected_size`만큼 `reserved`를 선점했으므로 **재검사는 일반적으로 성공**해야 한다. 재검사의 목적은 새로운 quota 경쟁을 다시 허용하는 것이 아니라, **집계 불일치나 비정상 상태를 감지하는 안전장치**이다.

### 4.3 재검사 실패 시 처리

재검사 실패 시 서버는 finalize를 **중단**하고 업로드 세션을 **실패 처리**한다.

**사용자 응답**

| 항목 | 값 |
|---|---|
| 에러 코드 | `QUOTA_EXCEEDED_FINALIZE` |
| 사용자 메시지 | `업로드 확정 중 저장 공간이 부족해 파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요.` |

**운영 로그 (내부 원인 기록)**

```
reserved mismatch
quota invariant violated before finalize
allowed bytes reduced during upload
```

---

## 5. 예약 → 확정 전환 (성공 경로)

파일 업로드가 최종 성공하면, 예약 용량은 실제 사용량으로 전환된다. 이 전환은 **같은 DB 트랜잭션 안에서 원자적으로 수행**해야 하며, 중간에 하나만 반영되어서는 안 된다.

### 5.1 성공 시 — reserved → used 전환

```
BEGIN TX
  ① FileItem 생성
  ② Space.storage_used_bytes     += final_size
  ③ Space.storage_reserved_bytes -= reserved_size
  ④ FileReservation → CONSUMED
  ⑤ UploadSession   → COMPLETED
COMMIT
```

> 실패 시 트랜잭션 전체가 **롤백**되어야 한다. 일부만 반영된 상태는 허용하지 않는다.

### 5.2 실패·취소·만료 시 — reserved 해제만 수행

실제 사용량 증가 없이 예약만 해제한다.

```
BEGIN TX
  ① Space.storage_reserved_bytes -= reserved_size
  ② FileReservation → FAILED | CANCELLED | EXPIRED
  ③ UploadSession   → FAILED | ABORTED   | EXPIRED
COMMIT
```

### 5.3 요약

| 결과 | used 변화 | reserved 변화 | FileReservation 상태 | UploadSession 상태 |
|---|---|---|---|---|
| **성공** | `+= final_size` | `-= reserved_size` | `CONSUMED` | `COMPLETED` |
| **실패** | 변화 없음 | `-= reserved_size` | `FAILED` | `FAILED` |
| **취소** | 변화 없음 | `-= reserved_size` | `CANCELLED` | `ABORTED` |
| **만료** | 변화 없음 | `-= reserved_size` | `EXPIRED` | `EXPIRED` |

---

## 6. Quota 불변조건 (Invariants)

### 6.1 항상 유지해야 하는 조건

```
storage_used_bytes     ≥ 0
storage_reserved_bytes ≥ 0

storage_allowed_bytes IS NULL
  OR  storage_used_bytes + storage_reserved_bytes  ≤  storage_allowed_bytes + 0
      (허용 오차 = 0)
```

### 6.2 정상 경로에서의 정합성 관계

```
used     = Σ 확정 FileItem 크기
reserved = Σ 활성 FileReservation 크기
```

### 6.3 정합성 점검

운영 배치 또는 정합성 점검 작업을 통해, `Space` 집계 캐시(`storage_used_bytes`, `storage_reserved_bytes`)와 실제 레코드 합계(`FileItem` 총합, 활성 `FileReservation` 총합)를 **주기적으로 대조**할 수 있어야 한다.

---

## 부록: 전체 흐름 요약

```
┌─────────────────────────────────────────────────────────┐
│                    업로드 시작 요청                        │
└────────────────────────┬────────────────────────────────┘
                         ▼
              ┌─────────────────────┐
              │  allowed = NULL ?   │
              └──┬───────────────┬──┘
            Yes  │               │  No
                 │               ▼
                 │    expected_size ≤ available ?
                 │         │              │
                 │        Yes             No → 거절
                 ▼         ▼
        ┌──────────────────────────────┐
        │  TX: reserved += expected    │
        │      FileReservation 생성     │
        └──────────────┬───────────────┘
                       ▼
               [ 업로드 진행 ]
                       ▼
        ┌──────────────────────────────┐
        │  Finalize 직전 Quota 재검사   │
        └──────┬───────────────┬───────┘
             Pass            Fail → 실패 처리
               ▼                    (reserved 해제)
        ┌──────────────────────────────┐
        │  TX: FileItem 생성            │
        │      used += final_size      │
        │      reserved -= reserved    │
        │      Reservation → CONSUMED  │
        │      Session → COMPLETED     │
        └──────────────────────────────┘
```