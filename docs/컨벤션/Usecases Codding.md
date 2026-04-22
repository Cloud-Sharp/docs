# UseCase 작성 규칙

---

## 1. 인터페이스 우선 원칙

- UseCase는 **인터페이스를 먼저 정의**하고, 구현 클래스는 그 계약을 만족하도록 작성한다.
- 상위 계층(컨트롤러 등)은 **구현이 아니라 인터페이스에 의존**한다.
- 서비스 등록도 인터페이스 기준으로 한다.

```csharp
// ✓ 인터페이스에 의존
private readonly IAuthUseCases _authUseCases;

// ✗ 구현 클래스에 직접 의존
private readonly AuthUseCases _authUseCases;
```

---

## 2. 작성 순서

```
1. 인터페이스 정의       →  IAuthUseCases
2. Command / Result 정의 →  LoginCommand, LoginResult
3. 구현 클래스 작성       →  AuthUseCases : IAuthUseCases
4. DI 등록               →  AddScoped<IAuthUseCases, AuthUseCases>()
```

인터페이스를 먼저 작성한다는 건 **"이 기능이 외부에 어떤 형태로 제공되는가"를 먼저 확정**한다는 뜻이다. 구현 세부사항은 그 다음이다.

---

## 3. 인터페이스를 두는 기준

| 인터페이스 권장 | concrete class로 충분 |
|---|---|
| UseCases (`IAuthUseCases`, `IProjectUseCases`) | 내부 전용 헬퍼, 포맷터 |
| Repository (`IUserRepository`) | 단순 값 변환기 |
| 외부 포트 (`ITokenProvider`, `IStorageClient`) | 교체·테스트 대체 필요 없는 유틸 |

> 모든 클래스에 기계적으로 `I`를 붙이지 않는다. **계층 경계·교체 가능성·테스트 대체가 필요한 곳**에만 둔다.

### 판단 기준

- **계층 경계를 넘는가?** → 인터페이스
- **테스트에서 대체가 필요한가?** → 인터페이스
- **구현이 바뀔 가능성이 있는가?** → 인터페이스
- **위 셋 다 아닌가?** → concrete class로 충분

---

## 4. 인터페이스 작성 규칙

### 4.1 네이밍

```
I{도메인}UseCases
```

```csharp
public interface IProjectUseCases { }
public interface IAuthUseCases { }
public interface ISpaceUseCases { }
```

`IProjectApplicationService`, `IProjectService` 같은 형태는 사용하지 않는다.

### 4.2 메서드 시그니처

```csharp
public interface IProjectUseCases
{
    // 값이 있는 반환
    Task<Result<GetProjectResult>> GetProjectAsync(Guid projectId, CancellationToken ct);
    Task<Result<CreateProjectResult>> CreateProjectAsync(CreateProjectCommand command, CancellationToken ct);

    // 값이 없는 반환
    Task<Result> DeleteProjectAsync(Guid projectId, CancellationToken ct);
}
```

- 모든 메서드는 `Task<Result<T>>` 또는 `Task<Result>`를 반환한다.
- `CancellationToken`은 항상 마지막 파라미터로 받는다.
- 메서드 이름은 유즈케이스 의미가 드러나게 한다.

### 4.3 인터페이스에 포함하지 않는 것

```csharp
// ✗ HTTP 타입
Task<IActionResult> CreateProjectAsync(...);

// ✗ API Response DTO
Task<Result<CreateProjectResponse>> CreateProjectAsync(...);

// ✗ 도메인 엔티티 직접 반환
Task<Result<Project>> CreateProjectAsync(...);
```

---

## 5. 구현 클래스 작성 규칙

### 5.1 네이밍

```
{도메인}UseCases
```

```csharp
public sealed class ProjectUseCases : IProjectUseCases { }
public sealed class AuthUseCases : IAuthUseCases { }
```

### 5.2 클래스 규칙

- `sealed`로 선언한다.
- 생성자에서 필요한 의존성을 주입받는다.
- 의존성은 전부 인터페이스로 받는다.

```csharp
public sealed class AuthUseCases : IAuthUseCases
{
    private readonly IUserRepository _userRepository;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenProvider _tokenProvider;

    public AuthUseCases(
        IUserRepository userRepository,
        IPasswordHasher passwordHasher,
        ITokenProvider tokenProvider)
    {
        _userRepository = userRepository;
        _passwordHasher = passwordHasher;
        _tokenProvider = tokenProvider;
    }

    public async Task<Result<LoginResult>> LoginAsync(
        LoginCommand command,
        CancellationToken ct)
    {
        var user = await _userRepository.FindByEmailAsync(command.Email, ct);

        if (user is null)
            return Result.Fail("AUTH_INVALID_CREDENTIALS");

        if (!_passwordHasher.Verify(command.Password, user.PasswordHash))
            return Result.Fail("AUTH_INVALID_CREDENTIALS");

        var accessToken = _tokenProvider.CreateAccessToken(user);

        return Result.Ok(new LoginResult(user.Id, accessToken));
    }
}
```

### 5.3 구현 클래스의 책임

**한다:**
- 비즈니스 흐름 조합
- 저장소 호출
- 권한/상태/정책 검사
- `Result<T>` 반환

**하지 않는다:**
- HTTP 상태 코드 결정
- API Response DTO 생성
- `IActionResult` 반환
- 로깅/트레이싱 직접 처리 (데코레이터로 분리 권장)

---

## 6. DI 등록 규칙

### 6.1 기본 등록

```csharp
builder.Services.AddScoped<IAuthUseCases, AuthUseCases>();
builder.Services.AddScoped<IProjectUseCases, ProjectUseCases>();
builder.Services.AddScoped<ISpaceUseCases, SpaceUseCases>();
```

### 6.2 관련 의존성도 인터페이스 기준으로 등록

```csharp
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IPasswordHasher, PasswordHasher>();
builder.Services.AddScoped<ITokenProvider, JwtTokenProvider>();
```

### 6.3 구현 교체 시

소비자 코드 수정 없이 등록만 바꾸면 된다.

```csharp
// 기본
builder.Services.AddScoped<ITokenProvider, JwtTokenProvider>();

// 교체
builder.Services.AddScoped<ITokenProvider, OpaqueTokenProvider>();
```

---

## 7. 소비자(컨트롤러) 작성 규칙

```csharp
[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly IAuthUseCases _authUseCases;

    public AuthController(IAuthUseCases authUseCases)
    {
        _authUseCases = authUseCases;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(
        [FromBody] LoginRequest request,
        CancellationToken ct)
    {
        var command = new LoginCommand(request.Email, request.Password);
        var result = await _authUseCases.LoginAsync(command, ct);

        if (result.IsFailed)
            return Unauthorized(new { message = "Login failed." });

        var value = result.Value;
        var response = new LoginResponse(value.UserId, value.AccessToken);

        return Ok(response);
    }
}
```

- 컨트롤러는 `IAuthUseCases`만 알고, 구현 클래스는 모른다.
- `Result`를 받아서 HTTP 응답으로 변환하는 것은 컨트롤러의 책임이다.
- Request → Command 변환, Result → Response 변환 모두 컨트롤러에서 처리한다.

---

## 8. 테스트에서의 활용

인터페이스 기반이면 테스트에서 가짜 구현을 쉽게 넣을 수 있다.

```csharp
// NSubstitute 예시
var authUseCases = Substitute.For<IAuthUseCases>();

authUseCases
    .LoginAsync(Arg.Any<LoginCommand>(), Arg.Any<CancellationToken>())
    .Returns(Result.Ok(new LoginResult(Guid.NewGuid(), "fake-token")));

var controller = new AuthController(authUseCases);
```

구현 클래스에 직접 의존하면:
- 내부 의존성(`IUserRepository`, `ITokenProvider` 등)을 전부 준비해야 한다.
- 진짜 DB/외부 서비스까지 끌려올 수 있다.
- 테스트 범위가 불필요하게 넓어진다.

---

## 9. 안티패턴

### 9.1 구현 클래스에 직접 의존

```csharp
// ✗
public AuthController(AuthUseCases authUseCases) { }
```

### 9.2 모든 클래스에 기계적으로 인터페이스 생성

```csharp
// ✗ 교체·테스트 대체 필요 없는 내부 헬퍼에까지
public interface IDateFormatter { }
public class DateFormatter : IDateFormatter { }
```

### 9.3 인터페이스 없이 concrete class를 직접 DI 등록

```csharp
// ✗ UseCases를 concrete로 등록
builder.Services.AddScoped<AuthUseCases>();
```

### 9.4 하나의 UseCases 인터페이스에 관계없는 기능 혼합

```csharp
// ✗ 인증과 프로젝트가 하나에 섞임
public interface IAppUseCases
{
    Task<Result<LoginResult>> LoginAsync(...);
    Task<Result<CreateProjectResult>> CreateProjectAsync(...);
}
```

---

## 10. 이유 요약

| 목적 | 설명 |
|---|---|
| **의존성 역전** | 상위 계층이 구현이 아니라 계약에 의존 |
| **테스트 용이** | mock / fake 주입이 쉬움 |
| **구현 교체** | 등록만 바꾸면 소비자 코드 수정 없음 |
| **경계 명확화** | Application 계층의 공개 계약이 인터페이스로 드러남 |
| **결합도 최소화** | 컨트롤러가 구현 세부사항을 전혀 모름 |

---

## 한 줄 기준

> **UseCase는 인터페이스를 먼저 정의하고, 모든 소비자는 구현이 아니라 인터페이스에 의존한다. 인터페이스는 계층 경계·교체 가능성·테스트 대체가 필요한 곳에만 둔다.**