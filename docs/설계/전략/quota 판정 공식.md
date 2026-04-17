업로드 시작 가능 여부는 아래 공식으로 판정한다.

used + reserved + expected_size ≤ allowed

여기서:

- `used` = `storage_used_bytes`
- `reserved` = `storage_reserved_bytes`
- `expected_size` = 이번 업로드가 점유하려는 파일 크기
- `allowed` = `storage_allowed_bytes`

즉, 이미 확정된 사용량과 현재 예약된 용량, 그리고 새 업로드가 추가로 점유할 예상 용량의 합이 Space 허용 용량 이하일 때만 업로드를 시작할 수 있다.

가용 용량은 다음과 같이 계산한다.

available = allowed - used - reserved

따라서 업로드 시작 허용 조건은 `expected_size ≤ available`와 동일한 의미를 가진다.

### 2. 무제한 Space 처리 규칙

`storage_allowed_bytes = NULL`인 Space는 **무제한 Space**로 간주한다.  
무제한 Space의 경우 quota 초과 판정은 수행하지 않으며, 업로드 시작 시 용량 부족으로 거절하지 않는다.

다만 무제한 Space라 하더라도 다음 값들은 계속 관리한다.

- `storage_used_bytes`
- `storage_reserved_bytes`

이는 실제 사용량 모니터링, 통계, 관리자 정책 변경, 향후 제한 전환 시 정합성 유지를 위해 필요하다. 즉, `allowed = NULL`은 quota 검사를 생략한다는 의미이지, 사용량 집계를 생략한다는 의미는 아니다.

### 3. 동일 Space 다중 세션 동시 업로드 경쟁 방지

동일 Space의 여러 멤버가 여러 탭 또는 여러 클라이언트에서 동시에 업로드를 시작할 수 있으므로, quota 판정과 예약 증가 처리는 반드시 **단일 트랜잭션 내 원자적 작업**으로 수행해야 한다.

처리 원칙은 다음과 같다.

1. Space 행을 조회한다.
2. 현재 `storage_used_bytes`, `storage_reserved_bytes`, `storage_allowed_bytes`를 기준으로 업로드 가능 여부를 판정한다.
3. 가능할 경우 `storage_reserved_bytes`를 즉시 증가시킨다.
4. 동시에 해당 업로드 세션에 대응하는 `FileReservation`을 생성한다.

이 과정은 분리하면 안 되며, 판정 후 별도 업데이트 방식으로 느슨하게 처리하면 동시 요청이 모두 통과하는 경쟁 조건이 발생할 수 있다.

즉, 동일 Space에 대한 다중 업로드 경쟁은 **“quota 판정 + reserved 증가”를 한 트랜잭션으로 묶는 방식**으로 방지한다.

### 4. finalize 직전 quota 재검사 규칙

업로드 시작 시 quota 검사를 통과했더라도, finalize 직전에는 반드시 quota를 다시 검토한다.  
이는 아래 상황에 대응하기 위함이다.

- 예약 상태 불일치
- 운영자 정책 변경
- 데이터 보정 중 집계 값 변경
- 비정상 세션 정리 지연

다만 정상 경로라면 이미 `expected_size`만큼 `reserved`를 선점했으므로, finalize 직전 재검사는 일반적으로 성공해야 한다.  
재검사의 목적은 새로운 quota 경쟁을 다시 허용하는 것이 아니라, **집계 불일치나 비정상 상태를 감지하는 안전장치**에 가깝다.

재검사 실패 시 서버는 finalize를 중단하고 업로드 세션을 실패 처리해야 하며, 사용자에게는 아래와 같은 에러 규칙을 제공한다.

- 에러 코드: `QUOTA_EXCEEDED_FINALIZE`
- 사용자 메시지: `업로드 확정 중 저장 공간이 부족해 파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요.`

운영 로그에는 내부 원인과 함께 보다 상세한 메시지를 남긴다. 예를 들면:

- `reserved mismatch`
- `quota invariant violated before finalize`
- `allowed bytes reduced during upload`

### 5. 예약 → 확정 전환의 원자성 보장

파일 업로드가 최종 성공하면, 예약 용량은 실제 사용량으로 전환되어야 한다.  
즉, `storage_reserved_bytes`는 감소하고 `storage_used_bytes`는 증가해야 한다.

이 전환은 반드시 **같은 DB 트랜잭션 안에서 원자적으로 수행**해야 한다.  
중간에 하나만 반영되면 quota 집계가 깨지므로, 아래 작업들은 하나의 확정 단위로 묶는다.

1. `FileItem` 생성
2. `Space.storage_used_bytes += final_size`
3. `Space.storage_reserved_bytes -= reserved_size`
4. `FileReservation -> CONSUMED`
5. `UploadSession -> COMPLETED`

실패 시에는 이들 중 일부만 반영된 상태가 남아서는 안 되며, 트랜잭션 전체가 롤백되어야 한다.

반대로 업로드 실패, 취소, 만료의 경우에는 실제 사용량 증가 없이 예약만 해제해야 하므로, 아래처럼 처리한다.

- `Space.storage_reserved_bytes -= reserved_size`
- `FileReservation -> FAILED | CANCELLED | EXPIRED`
- `UploadSession -> FAILED | ABORTED | EXPIRED`

즉, **성공 시에는 reserved → used 전환**, **실패/취소/만료 시에는 reserved 해제만 수행**하는 것이 quota 처리의 기본 원칙이다.

### 6. quota 처리 불변조건

quota 집계는 항상 아래 불변조건을 만족해야 한다.

storage_used_bytes >= 0  
storage_reserved_bytes >= 0  
storage_allowed_bytes IS NULL OR storage_used_bytes + storage_reserved_bytes <= storage_allowed_bytes + 허용 오차 0

정상 경로에서는 항상 다음이 유지되어야 한다.

used = 확정 파일 총합  
reserved = 활성 예약 총합

따라서 운영 배치나 정합성 점검 작업을 통해 `Space` 집계 캐시와 실제 `FileItem`, `FileReservation` 합계를 주기적으로 대조할 수 있어야 한다.
