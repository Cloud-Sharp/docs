# CloudSharp FluentValidation 가이드

> FluentValidation을 사용한 입력 검증의 위치, 작성 방식, 응답 변환, 테스트 규칙을 정의한다.

---

## 1. 목적과 범위

이 문서는 CloudSharp 백엔드에서 FluentValidation을 사용할 때 따르는 규칙을 정의한다.

**핵심 원칙:**

FluentValidation은 입력을 걸러내고, FluentResults는 비즈니스 실패를 표현한다.

---

## 2. 역할 분리

### 2.1 FluentValidation vs FluentResults vs 도메인 코드

| 관심사 | 담당 도구 | 예시 |
|--------|-----------|------|
| 필수값, 길이, 형식, 범위 | FluentValidation | 이메일 형식, 파일 크기 양수, Space 이름 길이 |
| 도메인 상태, 권한, 존재 여부 | FluentResults | Space 없음, 권한 없음, quota 초과 |
| 엔티티 불변식 | 도메인 코드 + FluentResults | `FolderPath.Create`, `UploadSession.Finalize` |
| HTTP 응답 변환 | API mapper | `ValidationProblem`, `ProblemDetails` |

### 2.2 계층별 사용 범위

| 계층 | FluentValidation 역할 | 비고 |
|------|------------------------|------|
| `CloudSharp.Api/Endpoints` | HTTP request DTO 검증 | body, query, path 조합의 입력 모양 검증 |
| `CloudSharp.Core/UseCases` | command/query 사전 조건 검증 | API, MCP Console, worker가 공유하는 입력 규칙 |
| `CloudSharp.Core/Domain` | 사용하지 않는다 | 도메인 불변식은 엔티티, 값 객체, 정책이 직접 보장한다 |
| `CloudSharp.Infrastructure` | 거의 사용하지 않는다 | 외부 adapter 설정 검증 정도만 선택적으로 허용한다 |
| `tests/*` | validator 단위 테스트 | `FluentValidation.TestHelper`를 사용한다 |

### 2.3 흐름 예시: 업로드 초기화

```text
HTTP Request
    ↓
FluentValidation
    - FileName 필수
    - SizeBytes > 0
    - ContentType 길이 제한
    ↓
UseCase
    ↓
FluentResults
    - Space 없음
    - 업로드 권한 없음
    - Space quota 초과
```

---

## 3. 패키지 배치

### 3.1 프로젝트별 패키지

```bash
dotnet add src/CloudSharp.Api package FluentValidation
dotnet add src/CloudSharp.Api package FluentValidation.DependencyInjectionExtensions
dotnet add src/CloudSharp.Core package FluentValidation
dotnet add tests/CloudSharp.Core.Tests package FluentValidation
```

| 프로젝트 | 패키지 | 목적 |
|----------|--------|------|
| `CloudSharp.Api` | `FluentValidation` | request DTO validator 작성 |
| `CloudSharp.Api` | `FluentValidation.DependencyInjectionExtensions` | validator assembly scan 등록 |
| `CloudSharp.Core` | `FluentValidation` | command/query validator 작성 |
| `CloudSharp.Core.Tests` | `FluentValidation` | validator test helper 사용 |
| `CloudSharp.Api.IntegrationTests` | 선택 | API validation 응답 검증 |

### 3.2 사용하지 않는 패키지

`FluentValidation.AspNetCore` 기반 자동 MVC validation은 사용하지 않는다. Minimal API 기반 수동 validation을 기본으로 한다.

---

## 4. 폴더 구조

### 4.1 API 계층

```text
CloudSharp.Api/
├── Endpoints/
│   ├── Auth/
│   │   ├── LoginRequest.cs
│   │   └── LoginRequestValidator.cs
│   ├── Spaces/
│   │   ├── CreateSpaceRequest.cs
│   │   └── CreateSpaceRequestValidator.cs
│   └── Uploads/
│       ├── InitializeUploadRequest.cs
│       └── InitializeUploadRequestValidator.cs
└── Endpoints/
    └── ValidationResultMapper.cs
```

### 4.2 Core 계층

```text
CloudSharp.Core/
├── Common/
│   └── Validation/
│       └── FluentValidationResultMapper.cs
└── UseCases/
    ├── Spaces/
    │   ├── CreateSpaceCommand.cs
    │   ├── CreateSpaceCommandValidator.cs
    │   └── CreateSpaceUseCase.cs
    └── Uploads/
        ├── InitializeUploadCommand.cs
        ├── InitializeUploadCommandValidator.cs
        └── InitializeUploadUseCase.cs
```

### 4.3 배치 기준

| Validator 위치 | 사용 조건 |
|----------------|-----------|
| `Api/Endpoints/{Feature}/` | HTTP 요청 모양에만 종속된 검증 |
| `Core/UseCases/{Feature}/` | API 외 MCP Console, background job에서도 재사용해야 하는 검증 |
| `Core/Domain/` | 두지 않는다 |

---

## 5. Validator 작성 규칙

### 5.1 기본 구조

validator는 `AbstractValidator<T>`를 상속하고 생성자에서 `RuleFor`로 규칙을 작성한다.

```csharp
using FluentValidation;

namespace CloudSharp.Api.Endpoints.Spaces;

public sealed record CreateSpaceRequest(
    string Name,
    long? StorageAllowedBytes);

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

### 5.2 필수 규칙

| 규칙 | 이유 |
|------|------|
| `WithErrorCode(...)`를 모든 규칙 체인에 붙인다 | API 응답, 로그, 프론트엔드 처리 표준화 |
| 메시지는 사용자에게 보여도 되는 수준으로 작성한다 | 내부 예외, 스택 정보 노출 방지 |
| validator 클래스는 `sealed`로 선언한다 | 상속 의도가 없는 경우 명시 |

### 5.3 금지 규칙

| 금지 사항 | 이유 |
|-----------|------|
| DB 조회가 필요한 권한, 상태, quota 검증을 validator에 넣지 않는다 | UseCase가 판단한다 |
| 도메인 상태 전이 판단을 validator에 넣지 않는다 | 도메인 모델이 보장한다 |
| request DTO validator와 command validator에 같은 규칙을 중복 작성하지 않는다 | 중복이면 command validator로 내린다 |

### 5.4 Validator가 하지 않는 일 예시

업로드 초기화 command validator 기준:

| 하지 않는 일 | 이유 |
|--------------|------|
| Space 존재 여부 조회 | UseCase가 repository로 판단한다 |
| 권한 확인 | `SpaceMember`/role 정책으로 판단한다 |
| quota 계산 | `Quotas` 도메인 정책으로 판단한다 |
| 파일명 중복 확인 | reservation/usecase 흐름에서 판단한다 |

---

## 6. DI 등록

### 6.1 등록 방식

`FluentValidation.DependencyInjectionExtensions`의 assembly scan을 사용한다.

```csharp
using CloudSharp.Api.Endpoints.Spaces;
using CloudSharp.Core.UseCases.Uploads;
using FluentValidation;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

// Api 프로젝트의 validator 등록
builder.Services.AddValidatorsFromAssemblyContaining<CreateSpaceRequestValidator>();

// Core 프로젝트의 validator 등록
builder.Services.AddValidatorsFromAssemblyContaining<InitializeUploadCommandValidator>();

var app = builder.Build();
```

### 6.2 Lifetime 규칙

| Lifetime | 사용 여부 | 이유 |
|----------|-----------|------|
| `Transient` | 기본 권장 | scoped dependency 혼입 위험이 낮다 |
| `Scoped` | 허용 | request 단위 dependency가 필요할 때 사용한다 |
| `Singleton` | 사용하지 않는다 | scoped/transient dependency를 주입하면 문제가 생긴다 |

---

## 7. Minimal API에서 수동 검증

### 7.1 기본 패턴

endpoint 안에서 `IValidator<T>`를 DI로 받아 `ValidateAsync`를 직접 호출한다.

```csharp
using FluentValidation;

namespace CloudSharp.Api.Endpoints.Spaces;

public static class SpaceEndpoints
{
    public static IEndpointRouteBuilder MapSpaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/spaces");
        group.MapPost("/", CreateSpace);
        return app;
    }

    private static async Task<IResult> CreateSpace(
        CreateSpaceRequest request,
        IValidator<CreateSpaceRequest> validator,
        CreateSpaceUseCase useCase,
        CancellationToken cancellationToken)
    {
        var validationResult = await validator.ValidateAsync(request, cancellationToken);

        if (!validationResult.IsValid)
            return validationResult.ToValidationProblem();

        var command = new CreateSpaceCommand(
            request.Name,
            request.StorageAllowedBytes);

        var result = await useCase.Handle(command, cancellationToken);

        return result.ToHttpResult(Results.Ok);
    }
}
```

### 7.2 수동 validation을 사용하는 이유

| 이유 | 설명 |
|------|------|
| Minimal API와 맞는다 | endpoint 흐름에서 validation 위치가 보인다 |
| async rule을 지원한다 | `MustAsync`, `CustomAsync`를 안전하게 호출한다 |
| FluentResults 연결이 쉽다 | validation 실패와 usecase 실패를 같은 응답 정책으로 정리한다 |
| 디버깅이 쉽다 | 어떤 validator가 언제 실행되는지 명확하다 |

---

## 8. 응답 변환

### 8.1 ValidationResult → HTTP 응답

API 계층에 공통 mapper를 둔다.

```csharp
using FluentValidation.Results;

namespace CloudSharp.Api.Endpoints;

public static class ValidationResultMapper
{
    public static IResult ToValidationProblem(this ValidationResult result)
    {
        return Results.ValidationProblem(
            errors: result.ToDictionary(),
            statusCode: StatusCodes.Status400BadRequest,
            title: "입력값 검증에 실패했습니다.",
            extensions: new Dictionary<string, object?>
            {
                ["errorCodes"] = result.Errors
                    .GroupBy(error => error.PropertyName)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(error => error.ErrorCode).ToArray())
            });
    }
}
```

응답 형식:

```json
{
  "title": "입력값 검증에 실패했습니다.",
  "status": 400,
  "errors": {
    "Name": [
      "'Name' must not be empty."
    ]
  },
  "errorCodes": {
    "Name": [
      "SPACE_NAME_INVALID"
    ]
  }
}
```

### 8.2 ValidationResult → FluentResults

Core 계층에 변환 mapper를 둔다.

```csharp
using FluentResults;
using FluentValidation.Results;

namespace CloudSharp.Core.Common.Validation;

public static class FluentValidationResultMapper
{
    public static Result ToResult(this ValidationResult validationResult)
    {
        if (validationResult.IsValid)
            return Result.Ok();

        var errors = validationResult.Errors.Select(failure =>
            new Error(failure.ErrorMessage)
                .WithMetadata("ErrorCode", failure.ErrorCode)
                .WithMetadata("PropertyName", failure.PropertyName)
                .WithMetadata("AttemptedValue", failure.AttemptedValue));

        return Result.Fail(errors);
    }
}
```

### 8.3 UseCase 내부 변환 패턴

```csharp
public sealed class InitializeUploadUseCase
{
    private readonly IValidator<InitializeUploadCommand> _validator;

    public InitializeUploadUseCase(IValidator<InitializeUploadCommand> validator)
    {
        _validator = validator;
    }

    public async Task<Result<InitializeUploadResponse>> Handle(
        InitializeUploadCommand command,
        CancellationToken cancellationToken)
    {
        var validationResult = await _validator.ValidateAsync(command, cancellationToken);
        if (!validationResult.IsValid)
            return validationResult.ToResult().ToResult<InitializeUploadResponse>();

        return await Execute(command, cancellationToken);
    }
}
```

반환형 변환 helper:

```csharp
public static Result<T> ToResult<T>(this Result result)
{
    return result.IsSuccess
        ? Result.Ok<T>(default!)
        : Result.Fail<T>(result.Errors);
}
```

`default!` 성공값이 의미 없는 상황에서만 이 helper를 사용한다. validation 성공 후 실제 값을 만드는 흐름에서는 사용하지 않는다.

---

## 9. Command Validator 작성 예시

API 외 MCP Console에서도 호출되는 command는 `Core/UseCases/{Feature}/`에 validator를 둔다.

```csharp
using FluentValidation;

namespace CloudSharp.Core.UseCases.Uploads;

public sealed record InitializeUploadCommand(
    Guid SpaceId,
    Guid TargetFolderId,
    Guid RequesterUserId,
    string FileName,
    long SizeBytes,
    string ContentType);

public sealed class InitializeUploadCommandValidator
    : AbstractValidator<InitializeUploadCommand>
{
    public InitializeUploadCommandValidator()
    {
        RuleFor(x => x.SpaceId)
            .NotEmpty()
            .WithErrorCode("SPACE_ID_REQUIRED");

        RuleFor(x => x.TargetFolderId)
            .NotEmpty()
            .WithErrorCode("TARGET_FOLDER_ID_REQUIRED");

        RuleFor(x => x.RequesterUserId)
            .NotEmpty()
            .WithErrorCode("REQUESTER_USER_ID_REQUIRED");

        RuleFor(x => x.FileName)
            .NotEmpty()
            .MaximumLength(255)
            .WithErrorCode("UPLOAD_FILE_NAME_INVALID");

        RuleFor(x => x.SizeBytes)
            .GreaterThan(0)
            .LessThanOrEqualTo(10L * 1024 * 1024 * 1024)
            .WithErrorCode("UPLOAD_SIZE_INVALID");

        RuleFor(x => x.ContentType)
            .NotEmpty()
            .MaximumLength(255)
            .WithErrorCode("UPLOAD_CONTENT_TYPE_INVALID");
    }
}
```

---

## 10. 비동기 검증 규칙

### 10.1 사용 조건

async rule(`MustAsync`, `CustomAsync`, `WhenAsync`)은 제한적으로 사용한다. async rule이 포함된 validator는 반드시 `ValidateAsync`로 호출한다.

### 10.2 허용 예시

```csharp
RuleFor(x => x.Email)
    .MustAsync(async (email, cancellationToken) =>
        !await userRepository.ExistsByEmailAsync(email, cancellationToken))
    .WithMessage("이미 사용 중인 이메일입니다.")
    .WithErrorCode("USER_DUPLICATE_EMAIL");
```

### 10.3 위치 판단 기준

| 판단 기준 | 권장 위치 |
|-----------|-----------|
| 단순 입력 형식 | validator |
| 중복 여부가 API/MCP 공통 사전 조건 | command validator 허용 |
| 권한, 상태, quota처럼 유스케이스 흐름 일부 | UseCase + FluentResults |

---

## 11. 컬렉션과 중첩 객체 검증

bulk 작업이나 목록 입력에는 `RuleForEach`와 `SetValidator`를 사용한다.

```csharp
public sealed record InviteMembersRequest(
    IReadOnlyList<InviteMemberRequestItem> Members);

public sealed record InviteMemberRequestItem(
    string Email,
    string Role);

public sealed class InviteMembersRequestValidator
    : AbstractValidator<InviteMembersRequest>
{
    public InviteMembersRequestValidator()
    {
        RuleFor(x => x.Members)
            .NotEmpty()
            .Must(x => x.Count <= 50)
            .WithErrorCode("INVITE_MEMBER_COUNT_INVALID");

        RuleForEach(x => x.Members)
            .SetValidator(new InviteMemberRequestItemValidator());
    }
}

public sealed class InviteMemberRequestItemValidator
    : AbstractValidator<InviteMemberRequestItem>
{
    public InviteMemberRequestItemValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .WithErrorCode("INVITE_EMAIL_INVALID");

        RuleFor(x => x.Role)
            .NotEmpty()
            .Must(role => role is "Owner" or "Admin" or "Member" or "Viewer")
            .WithErrorCode("INVITE_ROLE_INVALID");
    }
}
```

---

## 12. RuleSet 사용 기준

RuleSet은 같은 DTO/command를 상황별로 다르게 검증해야 할 때만 사용한다.

```csharp
public sealed class UpdateSpaceRequestValidator
    : AbstractValidator<UpdateSpaceRequest>
{
    public UpdateSpaceRequestValidator()
    {
        RuleSet("Rename", () =>
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .MaximumLength(80)
                .WithErrorCode("SPACE_NAME_INVALID");
        });

        RuleSet("Quota", () =>
        {
            RuleFor(x => x.StorageAllowedBytes)
                .GreaterThan(0)
                .WithErrorCode("SPACE_QUOTA_INVALID");
        });
    }
}
```

RuleSet 남용을 피한다. command를 분리하는 편이 더 명확한 경우가 많다.

```text
RenameSpaceCommand      ← 별도 validator
ChangeSpaceQuotaCommand ← 별도 validator
```

---

## 13. 에러 코드 체계

### 13.1 네이밍 규칙

FluentResults의 `ErrorCode`와 같은 네이밍 규칙을 사용한다.

| 규칙 | 예시 |
|------|------|
| 도메인 prefix를 사용한다 | `UPLOAD_`, `SPACE_`, `SHARE_LINK_` |
| 입력 검증은 `_INVALID`, `_REQUIRED`를 사용한다 | `SPACE_NAME_INVALID`, `SPACE_ID_REQUIRED` |
| 비즈니스 실패는 FluentResults 쪽 코드를 사용한다 | `SPACE_NOT_FOUND`, `UPLOAD_QUOTA_EXCEEDED` |

### 13.2 영역별 예시

| 영역 | 예시 |
|------|------|
| Auth | `AUTH_EMAIL_REQUIRED`, `AUTH_PASSWORD_INVALID` |
| Spaces | `SPACE_NAME_INVALID`, `SPACE_QUOTA_INVALID` |
| Members | `INVITE_EMAIL_INVALID`, `INVITE_ROLE_INVALID` |
| Folders | `FOLDER_NAME_INVALID`, `FOLDER_PARENT_ID_REQUIRED` |
| Files | `FILE_NAME_INVALID`, `FILE_TARGET_FOLDER_REQUIRED` |
| Uploads | `UPLOAD_FILE_NAME_INVALID`, `UPLOAD_SIZE_INVALID` |
| Downloads | `DOWNLOAD_SESSION_ID_REQUIRED` |
| ShareLinks | `SHARE_LINK_PASSWORD_INVALID`, `SHARE_LINK_EXPIRY_INVALID` |

---

## 14. 테스트 규칙

### 14.1 테스트 위치

```text
tests/
├── CloudSharp.Core.Tests/
│   └── UseCases/
│       └── Uploads/
│           └── InitializeUploadCommandValidatorTests.cs
└── CloudSharp.Api.IntegrationTests/
    └── Endpoints/
        └── Spaces/
            └── CreateSpaceEndpointTests.cs
```

### 14.2 Validator 단위 테스트

`FluentValidation.TestHelper`의 `TestValidate`와 `ShouldHaveValidationErrorFor`를 사용한다.

```csharp
using CloudSharp.Core.UseCases.Uploads;
using FluentValidation.TestHelper;

namespace CloudSharp.Core.Tests.UseCases.Uploads;

public class InitializeUploadCommandValidatorTests
{
    private readonly InitializeUploadCommandValidator _validator = new();

    [Test]
    public void Should_Have_Error_When_FileName_Is_Empty()
    {
        var command = new InitializeUploadCommand(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "",
            1024,
            "text/plain");

        var result = _validator.TestValidate(command);

        result.ShouldHaveValidationErrorFor(x => x.FileName)
            .WithErrorCode("UPLOAD_FILE_NAME_INVALID");
    }
}
```

### 14.3 API 통합 테스트

```csharp
[Test]
public async Task CreateSpace_Should_Return400_When_Name_Is_Empty()
{
    var response = await _client.PostAsJsonAsync("/spaces", new
    {
        name = "",
        storageAllowedBytes = 1024
    });

    Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.BadRequest));
}
```

### 14.4 테스트 커버리지 기준

| 테스트 종류 | 검증 대상 |
|-------------|-----------|
| Validator 단위 테스트 | property별 validation error와 error code |
| UseCase 테스트 | validation 실패가 `Result.Fail`로 변환되는지 |
| API 통합 테스트 | 400 `ValidationProblem` 응답 형식 |

---

## 15. 도입 순서

| 단계 | 작업 | 위치 |
|------|------|------|
| 1 | API request validator 작성 | `CloudSharp.Api/Endpoints/*` |
| 2 | 공통 `ValidationResultMapper` 작성 | `CloudSharp.Api/Endpoints/` |
| 3 | UseCase command validator 도입 | `CloudSharp.Core/UseCases/*` |
| 4 | FluentResults 변환 mapper 연결 | `CloudSharp.Core/Common/Validation/` |
| 5 | TestHelper로 validator 테스트 추가 | `tests/*` |

---

## 16. 금지 사항

| 항목 | 설명 |
|------|------|
| 도메인 규칙을 validator에만 넣는다 | validator는 입력을 거르는 장치다. 도메인 불변식은 반드시 도메인 모델도 보장한다. |
| 자동 validation pipeline에 의존한다 | Minimal API와 async validation을 고려하여 `ValidateAsync`를 명시적으로 호출한다. |
| DB 조회를 validator에 과하게 넣는다 | 중복 확인 정도는 허용하지만, 권한/상태/quota는 UseCase에 둔다. |
| `WithErrorCode`를 생략한다 | error code가 없으면 프론트엔드, 로그, 테스트가 문자열 메시지에 의존하게 된다. |
| request DTO validator와 command validator에 같은 규칙을 중복 작성한다 | HTTP 모양 검증은 request validator에, 업무 공통 검증은 command validator에 둔다. |

---

## 17. 아키텍처 요약

```text
HTTP Request
    ↓
CloudSharp.Api/Endpoints
    - Request DTO binding
    - IValidator<Request>.ValidateAsync
    - ValidationProblem 변환
    ↓
Request → UseCase Command 변환
    ↓
CloudSharp.Core/UseCases
    - IValidator<Command>.ValidateAsync
    - validation 실패 → FluentResults 변환
    - 도메인/권한/quota 흐름 실행
    ↓
CloudSharp.Core/Domain
    - 불변식 보장
    - 상태 전이
    ↓
CloudSharp.Infrastructure
    - DB/Redis/Storage adapter
```

---

## 참고 자료

- [FluentValidation GitHub](https://github.com/FluentValidation/FluentValidation)
- [FluentValidation Documentation](https://docs.fluentvalidation.net/en/latest/)
- [ASP.NET Core Integration](https://docs.fluentvalidation.net/en/latest/aspnet.html)
- [Dependency Injection](https://docs.fluentvalidation.net/en/latest/di.html)
- [Asynchronous Validation](https://docs.fluentvalidation.net/en/latest/async.html)
- [Custom Error Codes](https://docs.fluentvalidation.net/en/latest/error-codes.html)
- [Test Extensions](https://docs.fluentvalidation.net/en/latest/testing.html)