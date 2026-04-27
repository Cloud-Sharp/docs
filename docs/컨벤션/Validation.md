# CloudSharp Validation 가이드

> API 계층은 DataAnnotations와 `.NET 10` Minimal API built-in validation을 사용하고, Core 유스케이스 계층은 FluentValidation을 사용한다. 비즈니스 실패는 FluentResults로 표현한다.

---

## 1. 목적과 범위

이 문서는 CloudSharp 백엔드의 입력 검증 규칙을 정의한다.

핵심은 다음 세 가지다.

1. HTTP 요청 모양 검증은 API Request DTO의 어노테이션으로 처리한다.
2. API 외 진입점에서도 재사용되는 유스케이스 입력 검증은 Core의 FluentValidation으로 처리한다.
3. 권한, 존재 여부, quota, 상태 전이 같은 비즈니스 판단은 UseCase와 Domain이 처리한다.

---

## 2. 핵심 원칙

| 관심사 | 담당 위치 | 담당 도구 |
|--------|-----------|-----------|
| 필수값, 길이, 형식, 범위 같은 HTTP 입력 모양 | `CloudSharp.Api` | DataAnnotations |
| API 외 MCP/worker에서도 재사용되는 유스케이스 공통 입력 조건 | `CloudSharp.Core/UseCases` | FluentValidation |
| 권한, 존재 여부, quota, 상태 전이 | UseCase / Domain | FluentResults + 도메인 코드 |
| HTTP 400 응답 생성 | ASP.NET Core Minimal API runtime | built-in validation |
| 비즈니스 실패의 HTTP 변환 | API mapper | `ResultHttpMapper` |

`required`는 생성 시 누락 방지용이지 validation 대체 수단이 아니다.

---

## 3. 계층별 역할

```text
HTTP Request
    ↓
CloudSharp.Api
    - Request DTO binding
    - DataAnnotations validation
    - 인증 정보 추출
    - Request DTO -> Command / Query 변환
    ↓
CloudSharp.Core
    - Command / Query FluentValidation
    - UseCase 실행
    - Domain / Port 호출
    ↓
CloudSharp.Domain
    - 불변식 보장
    - 상태 전이
```

| 계층 | 검증 규칙 |
|------|-----------|
| `CloudSharp.Api/Endpoints` | Request DTO 속성/파라미터에 어노테이션을 붙인다 |
| `CloudSharp.Core/UseCases` | Command / Query validator를 둔다 |
| `CloudSharp.Core/Domain` | validator를 두지 않고 엔티티/값 객체/정책이 직접 보장한다 |
| `CloudSharp.Infrastructure` | 외부 설정 검증 정도만 제한적으로 허용한다 |

---

## 4. API Request 검증

### 4.1 `.NET 10` Minimal API 규칙

`.NET 10`부터 Minimal API는 DataAnnotations 기반 built-in validation을 지원한다. `AddValidation()`을 등록하면 query, header, request body에 선언된 어노테이션을 runtime이 자동 검증하고, 실패 시 `400 Bad Request`와 `ValidationProblem` 응답을 반환한다.

`.NET 10`에서는 통합 validation API가 `Microsoft.Extensions.Validation` 패키지로 분리되었으므로 API 프로젝트에 해당 패키지를 추가하고 `builder.Services.AddValidation()`을 호출한다.

```xml
<PackageReference Include="Microsoft.Extensions.Validation" Version="10.0.0" />
```

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddValidation();

var app = builder.Build();
```

### 4.2 Request DTO 작성 예시

```csharp
using System.ComponentModel.DataAnnotations;

namespace CloudSharp.Api.Endpoints.Spaces.Requests;

public sealed record CreateSpaceRequest
{
    [Required(AllowEmptyStrings = false)]
    [StringLength(80)]
    public string Name { get; init; } = string.Empty;

    [Range(1, long.MaxValue)]
    public long? StorageAllowedBytes { get; init; }
}
```

Handler에서는 request validator를 주입하지 않는다.

```csharp
private static async Task<IResult> CreateSpace(
    CreateSpaceRequest request,
    ISpaceUseCases spaceUseCases,
    HttpContext httpContext,
    CancellationToken cancellationToken)
{
    var requesterUserId = httpContext.User.GetUserId();

    var command = new CreateSpaceCommand
    {
        RequesterUserId = requesterUserId,
        Name = request.Name,
        StorageAllowedBytes = request.StorageAllowedBytes
    };

    var result = await spaceUseCases.CreateAsync(command, cancellationToken);

    return result.ToHttpResult(value =>
        Results.Created($"/api/v1/spaces/{value.SpaceId}", value.ToResponse()));
}
```

### 4.3 API 계층 규칙

| 규칙 | 설명 |
|------|------|
| 정의 위치 | `Requests/` DTO의 속성/파라미터 어노테이션 |
| 활성화 | `builder.Services.AddValidation()` |
| 실패 응답 | runtime 기본 `ValidationProblem` |
| HTTP status | request validation 실패는 `400 Bad Request` |
| 복합 규칙 | API 전용이면 `IValidatableObject` 또는 커스텀 `ValidationAttribute` 사용 |
| 커스텀 응답 | `IProblemDetailsService`로 조정 |

### 4.4 API 계층에서 하지 않는 것

| 금지 | 이유 |
|------|------|
| API request용 `IValidator<T>` 작성 | HTTP 입력 검증 규칙을 분산시키지 않기 위해 |
| handler에서 `ValidateAsync` 수동 호출 | `.NET 10` Minimal API built-in validation과 중복 |
| 권한, quota, 존재 여부를 어노테이션으로 처리 | 비즈니스 판단은 UseCase/Domain 책임 |
| request DTO 어노테이션과 command validator에 같은 규칙을 무의미하게 중복 | 중복 유지비가 커진다 |

---

## 5. Core Command / Query 검증

API 외 MCP Console, background worker, batch에서도 재사용되는 입력 계약은 Core에서 FluentValidation으로 검증한다.

```csharp
using FluentValidation;

namespace CloudSharp.Core.UseCases.Uploads;

public sealed class InitializeUploadCommandValidator
    : AbstractValidator<InitializeUploadCommand>
{
    public InitializeUploadCommandValidator()
    {
        RuleFor(x => x.RequesterUserId)
            .NotEmpty()
            .WithErrorCode("REQUESTER_USER_ID_REQUIRED");

        RuleFor(x => x.SpaceId)
            .NotEmpty()
            .WithErrorCode("SPACE_ID_REQUIRED");

        RuleFor(x => x.TargetFolderId)
            .NotEmpty()
            .WithErrorCode("TARGET_FOLDER_ID_REQUIRED");

        RuleFor(x => x.FileName)
            .NotEmpty()
            .MaximumLength(255)
            .WithErrorCode("UPLOAD_FILE_NAME_INVALID");

        RuleFor(x => x.SizeBytes)
            .GreaterThan(0)
            .WithErrorCode("UPLOAD_SIZE_INVALID");
    }
}
```

| 위치 | 검증 대상 | 예시 |
|------|-----------|------|
| API request 어노테이션 | HTTP 입력 모양 | body 필수값, query 범위, header 형식 |
| Core command/query validator | 공통 입력 조건 | ID 필수, 파일 크기 양수, 이름 길이 |
| UseCase 본문 | 비즈니스 판단 | 권한, 존재 여부, quota, 상태 |
| Domain | 불변식 | 값 객체 생성, 상태 전이 가능 여부 |

### 5.1 Validator에 넣지 않는 것

| 금지 판단 | 담당 위치 |
|-----------|-----------|
| Space가 실제 존재하는가 | UseCase |
| 사용자가 Space에 접근 가능한가 | UseCase / Domain policy |
| quota가 충분한가 | UseCase / Domain policy |
| 파일명이 중복되는가 | UseCase |
| 업로드 세션 상태가 finalize 가능한가 | Domain entity |

### 5.2 비동기 규칙

`MustAsync`, `CustomAsync`, `WhenAsync`는 API/MCP/worker 공통 사전 조건일 때만 제한적으로 허용한다. 권한, quota, 상태 흐름을 async rule에 밀어 넣지 않는다.

---

## 6. 실패 처리

### 6.1 API request validation 실패

API request validation 실패는 ASP.NET Core runtime이 자동으로 `400 Bad Request`와 `ValidationProblem`을 반환한다.

응답 형식을 더 조정해야 하면 `IProblemDetailsService`를 등록한다.

### 6.2 Core validator 실패

Core validator 실패는 `FluentValidation.Results.ValidationResult`를 `FluentResults.Result`로 변환해 UseCase 결과로 올린다.

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
                .WithMetadata("PropertyName", failure.PropertyName));

        return Result.Fail(errors);
    }
}
```

UseCase 예시:

```csharp
public sealed class UploadUseCases
{
    private readonly IValidator<InitializeUploadCommand> _validator;

    public UploadUseCases(IValidator<InitializeUploadCommand> validator)
    {
        _validator = validator;
    }

    public async Task<Result<InitializeUploadResult>> InitializeAsync(
        InitializeUploadCommand command,
        CancellationToken cancellationToken)
    {
        var validationResult = await _validator.ValidateAsync(command, cancellationToken);
        if (!validationResult.IsValid)
            return validationResult.ToResult().ToResult<InitializeUploadResult>();

        // 권한, quota, 상태 전이는 여기서 판단한다.
        throw new NotImplementedException();
    }
}
```

`Result -> Result<T>` 승격 helper는 `CloudSharp.Core.Common.Validation` 같은 공통 위치에 둔다.

---

## 7. 폴더와 패키지

### 7.1 폴더 구조

```text
CloudSharp.Api/
└── Endpoints/
    ├── Spaces/
    │   ├── SpaceEndpoints.cs
    │   ├── Requests/
    │   │   └── CreateSpaceRequest.cs
    │   └── Responses/
    │       └── SpaceResponse.cs
    └── _Common/
        └── ResultHttpMapper.cs

CloudSharp.Core/
└── UseCases/
    ├── Spaces/
    │   ├── CreateSpaceCommand.cs
    │   ├── CreateSpaceCommandValidator.cs
    │   └── SpaceUseCases.cs
    └── Common/
        └── Validation/
            └── FluentValidationResultMapper.cs
```

### 7.2 패키지 기준

| 프로젝트 | 패키지 | 목적 |
|----------|--------|------|
| `CloudSharp.Api` | `Microsoft.Extensions.Validation` | Minimal API built-in validation 활성화 |
| `CloudSharp.Core` | `FluentValidation` | Command / Query validator |
| `CloudSharp.Core.Tests` | `FluentValidation` | validator test helper 사용 |

---

## 8. 테스트 규칙

| 테스트 | 검증 대상 |
|--------|-----------|
| API 통합 테스트 | DataAnnotations validation, 400 status, response body |
| Core validator 테스트 | property별 error code |
| Core UseCase 테스트 | validation 실패가 `Result.Fail`로 변환되는지 |

API 계층에는 `CreateSpaceRequestValidatorTests` 같은 단위 테스트를 만들지 않는다. 어노테이션 검증은 API 통합 테스트로 확인한다.

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

Core validator 테스트는 계속 유지한다.

```csharp
using FluentValidation.TestHelper;

[Test]
public void Should_Have_Error_When_FileName_Is_Empty()
{
    var validator = new InitializeUploadCommandValidator();
    var command = new InitializeUploadCommand
    {
        RequesterUserId = Guid.NewGuid(),
        SpaceId = Guid.NewGuid(),
        TargetFolderId = Guid.NewGuid(),
        FileName = "",
        SizeBytes = 1024
    };

    var result = validator.TestValidate(command);

    result.ShouldHaveValidationErrorFor(x => x.FileName)
        .WithErrorCode("UPLOAD_FILE_NAME_INVALID");
}
```

---

## 9. 금지 사항

| 금지 사항 | 이유 |
|-----------|------|
| API request DTO마다 FluentValidation validator를 만든다 | API 입력 규칙을 DataAnnotations로 통일하기 위해 |
| handler에서 request validator를 직접 호출한다 | `.NET 10` built-in validation과 중복 |
| `required`만 믿고 어노테이션을 생략한다 | null 외의 형식/범위/길이 제약을 보장하지 못한다 |
| 도메인 규칙을 어노테이션이나 validator에만 넣는다 | 도메인 불변식은 도메인 모델도 보장해야 한다 |
| 권한/존재 여부/quota를 request validation 단계에서 끝낸다 | 유스케이스 흐름과 정책 판단이 흐려진다 |

---

## 10. 최종 요약

| 질문 | 답 |
|------|----|
| API request 검증은 무엇을 쓰는가? | DataAnnotations |
| Minimal API에서 자동 검증이 가능한가? | 가능하다. `.NET 10`에서 `AddValidation()`으로 활성화한다 |
| API handler에서 request validator를 주입하는가? | 아니다 |
| FluentValidation은 어디에 쓰는가? | Core command/query validator |
| 권한, quota, 존재 여부는 어디서 검증하는가? | UseCase / Domain |
| API validation 실패 응답은 누가 만드는가? | ASP.NET Core runtime |

> API는 어노테이션으로 HTTP 입력을 걸러내고, Core는 FluentValidation으로 유스케이스 입력 계약을 지키며, 비즈니스 판단은 UseCase와 Domain이 맡는다.
