# UseCase 반환 규칙

---

## 구조

- UseCase는 **개별 클래스가 아니라** 기능별 `I*UseCases` 인터페이스에 메서드로 모은다.
- 각 메서드는 **`Result<TResult>` 또는 `Result`** 를 반환한다.
- 도메인 엔티티, API Response DTO, `IActionResult`는 반환하지 않는다.

---

## 네이밍

| 구분 | 형식 | 예시 |
|------|------|------|
| 인터페이스 | `I{도메인}UseCases` | `IProjectUseCases`, `IAuthUseCases` |
| 입력 모델 | `{동작}{도메인}Command` | `CreateProjectCommand` |
| 출력 모델 | `{동작}{도메인}Result` | `CreateProjectResult`, `GetProjectResult` |
| API 요청 | `{동작}{도메인}Request` | `CreateProjectRequest` |
| API 응답 | `{동작}{도메인}Response` | `CreateProjectResponse` |

---

## 반환 패턴

```csharp
// 값이 있는 경우
Task<Result<GetProjectResult>> GetProjectAsync(Guid projectId, CancellationToken ct);
Task<Result<CreateProjectResult>> CreateProjectAsync(CreateProjectCommand command, CancellationToken ct);

// 값이 없는 경우
Task<Result> DeleteProjectAsync(Guid projectId, CancellationToken ct);
```

---

## 실패 처리

| 상황 | 처리 |
|------|------|
| 비즈니스 실패 (not found, 권한 없음, 중복 등) | `Result.Fail(...)` |
| 시스템 장애 (DB 연결, 코드 버그 등) | Exception |

---

## 계층 책임

```
Application  →  Result<TResult> 반환 (HTTP 모름)
API          →  Result 확인 → HTTP 응답 + Response DTO 생성
```

---

## 안티패턴

```csharp
// ✗ API DTO 반환
Task<Result<CreateProjectResponse>> CreateProjectAsync(...);

// ✗ 도메인 엔티티 반환
Task<Result<Project>> CreateProjectAsync(...);

// ✗ HTTP 타입 반환
Task<IActionResult> CreateProjectAsync(...);
```

---

## 한 줄 기준

> **`I*UseCases` 인터페이스에 메서드로 모으고, HTTP를 모른 채 `Result<TResult>` 만 반환한다.**