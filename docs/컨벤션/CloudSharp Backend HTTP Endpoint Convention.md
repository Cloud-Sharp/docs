# CloudSharp Backend HTTP Endpoint Convention

> **투표 결과:** 1안 - Minimal APIs + Feature별 Endpoints 구조로 확정  
> **적용 범위:** `CloudSharp.Api` 프로젝트 내 모든 HTTP 진입점  
> **최종 수정:** 2026-04-23

---

## 1. 핵심 결정

CloudSharp의 HTTP 진입점은 Controller를 사용하지 않고 **Minimal APIs + Feature별 Endpoint 확장 메서드**로 통일한다.

| 항목 | 결정 |
|------|------|
| HTTP 스타일 | Minimal APIs |
| 파일 배치 | `CloudSharp.Api/Endpoints/{Feature}/` |
| Handler 반환형 | `IResult` 또는 `Task<IResult>` |
| UseCase 의존 | `I{Domain}UseCases` Feature 단위 인터페이스 |
| 입력 검증 | Handler 내부에서 `IValidator<T>.ValidateAsync` 수동 호출 |
| 실패 변환 | `FluentResults` 결과를 `ResultHttpMapper`로 HTTP 응답 변환 |
| 인증 | Opaque Session Token 기반 `RequireAuthorization()` |
| Space 인가 | Endpoint Filter + UseCase 내부 권한 검증 |

---

## 2. 디렉토리 구조

```text
CloudSharp.Api/
├── Endpoints/
│   ├── Auth/
│   │   ├── AuthEndpoints.cs
│   │   ├── Requests/
│   │   ├── Responses/
│   │   └── Validators/
│   ├── Spaces/
│   │   ├── SpaceEndpoints.cs
│   │   ├── SpaceMemberEndpoints.cs
│   │   ├── Filters/
│   │   ├── Requests/
│   │   ├── Responses/
│   │   └── Validators/
│   ├── Files/
│   │   ├── FileEndpoints.cs
│   │   ├── Requests/
│   │   ├── Responses/
│   │   └── Validators/
│   └── _Common/
│       ├── ResultHttpMapper.cs
│       ├── ValidationResultMapper.cs
│       ├── HttpContextExtensions.cs
│       └── EndpointRegistrationExtensions.cs
├── Auth/
├── OpenApi/
├── Middlewares/
├── BackgroundServices/
├── Program.cs
└── DependencyInjection.cs
```

| 규칙 | 설명 |
|------|------|
| Feature 단위 폴더 | `Auth`, `Spaces`, `Files`처럼 도메인 Feature별로 분리한다 |
| 하위 구조 고정 | 각 Feature 폴더는 `Requests/`, `Responses/`, `Validators/`, 필요 시 `Filters/`를 둔다 |
| `_Common/` | Feature에 속하지 않는 endpoint 공통 mapper, 확장 메서드, registration helper를 둔다 |
| 파일 네이밍 | `{Feature}Endpoints.cs` 형식을 따른다 |

---

## 3. Endpoint 등록 패턴

모든 Endpoint 클래스는 `static class`이며, `IEndpointRouteBuilder` 확장 메서드로 작성한다.

```csharp
namespace CloudSharp.Api.Endpoints.Spaces;

public static class SpaceEndpoints
{
    public static RouteGroupBuilder MapSpaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/spaces")
            .WithTags("Spaces")
            .RequireAuthorization();

        group.MapPost("/", CreateSpace)
            .WithName("CreateSpace")
            .WithSummary("새 Space를 생성합니다.")
            .Produces<SpaceResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status401Unauthorized);

        group.MapGet("/{spaceId:guid}", GetSpace)
            .WithName("GetSpace")
            .WithSummary("Space 상세 정보를 조회합니다.")
            .AddEndpointFilter<SpacePermissionFilter>()
            .Produces<SpaceResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound);

        return group;
    }
}
```

`Program.cs`에는 Feature별 등록만 남긴다.

```csharp
app.MapAuthEndpoints();
app.MapSpaceEndpoints();
app.MapSpaceMemberEndpoints();
app.MapFileEndpoints();
```

> `Program.cs`에 서비스 API를 `MapGet`, `MapPost`로 직접 작성하지 않는다. Health check처럼 앱 부트스트랩 성격의 엔드포인트만 예외로 둘 수 있다.

### Route Group 규칙

| 항목 | 규칙 | 예시 |
|------|------|------|
| Base path | `/api/v1/{feature}` | `/api/v1/spaces` |
| 공개 API | `/public/v1/{feature}` | `/public/v1/share-links/{shareToken}/browse` |
| 하위 리소스 | 별도 Endpoints 클래스로 분리 | `SpaceMemberEndpoints` |
| Route constraint | 가능한 한 명시 | `{spaceId:guid}` |
| Tag | Feature 복수형 | `Spaces`, `Files` |

---

## 4. Handler 메서드 패턴

```csharp
private static async Task<IResult> CreateSpace(
    CreateSpaceRequest request,
    IValidator<CreateSpaceRequest> validator,
    ISpaceUseCases spaceUseCases,
    HttpContext httpContext,
    CancellationToken cancellationToken)
{
    var validationResult = await validator.ValidateAsync(request, cancellationToken);
    if (!validationResult.IsValid)
    {
        return validationResult.ToValidationProblem();
    }

    var requesterUserId = httpContext.User.GetUserId();
    var command = new CreateSpaceCommand
    {
        RequesterUserId = requesterUserId,
        Name = request.Name,
        StorageAllowedBytes = request.StorageAllowedBytes
    };

    var result = await spaceUseCases.CreateAsync(command, cancellationToken);

    return result.ToHttpResult(value =>
        Results.Created(
            $"/api/v1/spaces/{value.SpaceId}",
            value.ToResponse()));
}
```

| 단계 | 필수 여부 | 설명 |
|------|-----------|------|
| 1. Validation | Body 또는 복잡한 query가 있을 때 필수 | `IValidator<T>.ValidateAsync`를 수동 호출 |
| 2. 입력 변환 | 필수 | Request, route, query, 인증 사용자 정보를 Command/Query로 변환 |
| 3. UseCase 실행 | 필수 | 하나의 handler는 하나의 `I{Domain}UseCases` 메서드만 호출 |
| 4. Result 매핑 | 필수 | 성공은 response DTO로, 실패는 `ResultHttpMapper`로 변환 |

Handler 파라미터는 HTTP 입력, validator, UseCase 인터페이스, 인증 컨텍스트, `CancellationToken` 순서로 둔다. `CancellationToken`은 마지막 파라미터로 둔다.

Handler에서 Repository, DbContext, Storage adapter를 직접 호출하지 않는다.

---

## 5. Request / Response DTO

```csharp
namespace CloudSharp.Api.Endpoints.Spaces.Requests;

public sealed record CreateSpaceRequest(
    string Name,
    long? StorageAllowedBytes);
```

Request DTO 규칙:

- `sealed record`로 선언한다.
- 네이밍은 `{Action}{Feature}Request`를 따른다.
- Feature의 `Requests/` 폴더에 둔다.
- Domain entity, EF entity, Core command/query를 Request로 직접 사용하지 않는다.

```csharp
namespace CloudSharp.Api.Endpoints.Spaces.Responses;

public sealed record SpaceResponse(
    Guid Id,
    string Name,
    long? StorageAllowedBytes,
    DateTimeOffset CreatedAtUtc);
```

Response DTO는 API 외부 계약이다. Core Result 모델이나 도메인 객체를 그대로 노출하지 않는다.

```csharp
namespace CloudSharp.Api.Endpoints.Spaces.Responses;

public static class SpaceResponseMapper
{
    public static SpaceResponse ToResponse(this CreateSpaceResult result)
    {
        return new SpaceResponse(
            Id: result.SpaceId,
            Name: result.Name,
            StorageAllowedBytes: result.StorageAllowedBytes,
            CreatedAtUtc: result.CreatedAtUtc);
    }
}
```

API Response 변환은 `Responses/` 아래 mapper에 둔다. 변환 입력은 기본적으로 Core UseCase Result 모델이다.

---

## 6. Validation

Request validator는 HTTP 입력 모양만 검증한다.

```csharp
namespace CloudSharp.Api.Endpoints.Spaces.Validators;

public sealed class CreateSpaceRequestValidator : AbstractValidator<CreateSpaceRequest>
{
    public CreateSpaceRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(80)
            .WithErrorCode("SPACE_NAME_INVALID");

        RuleFor(x => x.StorageAllowedBytes)
            .GreaterThan(0)
            .When(x => x.StorageAllowedBytes is not null)
            .WithErrorCode("SPACE_QUOTA_INVALID");
    }
}
```

| 규칙 | 설명 |
|------|------|
| 호출 위치 | Handler의 첫 단계 |
| 호출 방식 | `IValidator<T>.ValidateAsync(..., cancellationToken)` |
| 실패 응답 | `_Common/ValidationResultMapper.ToValidationProblem()` |
| HTTP status | request validation 실패는 `400 Bad Request` |
| 자동 validation | MVC `[ApiController]` 자동 validation은 사용하지 않는다 |
| 등록 | `AddValidatorsFromAssemblyContaining<Program>()` 또는 endpoint assembly scan |

Endpoint Filter로 validation을 자동화하지 않는다. MVP에서는 handler 흐름에 검증 위치가 보이게 둔다.

---

## 7. Result -> HTTP 매핑

CloudSharp Core는 `FluentResults.Result<T>` 또는 `Result`만 반환한다. API는 이를 외부 계약으로 노출하지 않고 `_Common/ResultHttpMapper`로 HTTP 응답에 매핑한다.

```csharp
return result.ToHttpResult(value => Results.Ok(value.ToResponse()));
```

규칙:

- UseCase 실패에 대해 handler가 직접 `Results.NotFound()`, `Results.Conflict()` 등을 조립하지 않는다.
- 실패 status는 `CloudSharpError.StatusCodeMetadataKey` 또는 공통 error code mapping을 따른다.
- `Result<T>`의 성공 값은 API Response DTO로 변환한다.
- 처리되지 않은 시스템 예외는 `ExceptionHandlingMiddleware`에서 500으로 처리한다.

---

## 8. Endpoint Filter

Endpoint Filter는 HTTP 진입 전후의 얇은 정책에만 사용한다.

| 허용 | 금지 |
|------|------|
| Space 접근 가능 여부 검증 | Request DTO validation |
| rate limit 같은 전처리 | UseCase 실행 |
| 공통 로깅, correlation 보강 | Response DTO 변환 |

Space 권한 필터는 repository를 직접 흩뿌리지 말고 `ISpacePermissionService`, `ISpaceRoleResolver` 같은 권한 전용 추상화를 사용한다.

```csharp
var memberGroup = app.MapGroup("/api/v1/spaces/{spaceId:guid}/members")
    .WithTags("SpaceMembers")
    .RequireAuthorization()
    .AddEndpointFilter<SpacePermissionFilter>();
```

HTTP 계층은 "이 사용자가 이 Space 리소스에 접근 가능한가?"까지만 판단한다. "이 작업을 수행할 수 있는 역할인가?"는 UseCase와 도메인 정책에서 다시 판단한다.

---

## 9. OpenAPI 메타데이터

모든 endpoint는 OpenAPI metadata를 명시한다.

```csharp
group.MapPost("/", CreateSpace)
    .WithName("CreateSpace")
    .WithSummary("새 Space를 생성합니다.")
    .Produces<SpaceResponse>(StatusCodes.Status201Created)
    .ProducesValidationProblem()
    .Produces(StatusCodes.Status401Unauthorized);
```

| 메타데이터 | 규칙 |
|------------|------|
| `WithName` | `{Action}{Feature}` PascalCase |
| `WithTags` | Feature 복수형 |
| `WithSummary` | 한국어 동사형 문장 |
| `Produces<T>` | 성공 응답은 반드시 명시 |
| `ProducesValidationProblem` | request validation이 있으면 명시 |
| `Produces(...)` | 인증, 인가, not found, conflict 등 대표 실패 status 명시 |

OpenAPI security scheme의 bearer format은 `JWT`가 아니라 `opaque`로 표기한다.

---

## 10. 인증 / 인가

```csharp
var group = app.MapGroup("/api/v1/spaces")
    .WithTags("Spaces")
    .RequireAuthorization();
```

CloudSharp 내부 API는 opaque session token을 사용한다. handler에서 사용자 ID가 필요하면 `HttpContext.User` 또는 `ICurrentUser`에서 추출하고, body의 `userId`는 신뢰하지 않는다.

```csharp
var requesterUserId = httpContext.User.GetUserId();
```

인가 계층:

```text
RequireAuthorization()
    -> Opaque session token 인증
Endpoint Filter
    -> Space 리소스 접근 가능 여부
UseCase / Domain Policy
    -> 작업별 Role, 상태, quota, 소유권 검증
```

---

## 11. 금지 사항

| # | 금지 사항 | 이유 |
|---|----------|------|
| 1 | `ControllerBase`, `[ApiController]` 사용 | Minimal API로 통일 |
| 2 | `IActionResult`, `ActionResult<T>` 반환 | HTTP handler는 `IResult`만 사용 |
| 3 | Handler에서 Repository, DbContext, Storage 직접 호출 | UseCase 경계를 유지 |
| 4 | Handler에서 여러 UseCase 메서드 호출 | 하나의 HTTP 행위는 하나의 유스케이스 흐름으로 표현 |
| 5 | 서비스 API를 `Program.cs`에 인라인 등록 | Feature별 `Map*Endpoints()`로 등록 |
| 6 | Request/Response에 Domain/EF entity 직접 노출 | API DTO 경계 유지 |
| 7 | UseCase 실패를 handler에서 직접 status별 분기 | `ResultHttpMapper`로 통일 |
| 8 | Endpoint Filter에서 UseCase 실행 | Filter는 인가/전처리만 담당 |
| 9 | `HttpContext.RequestServices.GetService<T>()` | 파라미터 주입 또는 생성자 주입 사용 |
| 10 | `Task.Result`, `.Wait()` 사용 | 항상 async/await 사용 |

---

## 12. 새 Feature 추가 절차

1. `Endpoints/{Feature}/` 폴더를 만든다.
2. `Requests/`에 Request DTO를 작성한다.
3. `Validators/`에 FluentValidation validator를 작성한다.
4. `Responses/`에 Response DTO와 `ToResponse()` mapper를 작성한다.
5. `{Feature}Endpoints.cs`에 `Map{Feature}Endpoints()`를 작성한다.
6. 필요한 경우 `Filters/`에 endpoint filter를 작성한다.
7. `Program.cs` 또는 `EndpointRegistrationExtensions`에서 `app.Map{Feature}Endpoints()`를 호출한다.
8. Core usecase 테스트와 API 통합 테스트를 작성한다.

---

## 13. 전체 흐름

```text
HTTP Request
    -> ASP.NET Authentication
    -> Endpoint Filter
    -> Handler
        1. Request validation
        2. Request/path/query/user -> Command/Query
        3. I{Domain}UseCases method 실행
        4. Result -> IResult mapping
    -> HTTP Response
```
