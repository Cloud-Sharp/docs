# CloudSharp FluentResults 가이드

---

## 1. 개요

### 1.1 FluentResults란

[FluentResults](https://github.com/altmann/FluentResults)는 비즈니스 실패를 예외로 던지지 않고 `Result` 객체로 명시적으로 반환하게 해주는 경량 .NET 라이브러리다.

### 1.2 이 문서의 목적

CloudSharp 백엔드 아키텍처에서 FluentResults를 **어디에**, **어떻게**, **어떤 기준으로** 사용할지 정의한다.

### 1.3 대상 독자

- CloudSharp 백엔드 개발자
- 코드 리뷰어
- 아키텍처 의사결정에 참여하는 팀원

### 1.4 CloudSharp 프로젝트 구조

```
CloudSharp.Api ──────────→ CloudSharp.Core
                                ↑
CloudSharp.Infrastructure ──────┘
```

| 프로젝트 | 역할 |
|----------|------|
| `CloudSharp.Core` | 도메인 모델, 유스케이스, 포트 인터페이스 |
| `CloudSharp.Api` | HTTP 요청/응답 변환, 엔드포인트, 미들웨어 |
| `CloudSharp.Infrastructure` | DB, Redis, Local FS, opaque session auth, tusd, ffmpeg, AI adapter 구현 |

---

## 2. 도입 배경

### 2.1 CloudSharp의 예상 가능한 비즈니스 실패

CloudSharp에는 시스템 장애가 아닌, 예상 가능한 비즈니스 실패가 많다.

| 도메인 | 예상 가능한 실패 |
|--------|------------------|
| **Auth** | 이메일 중복, 비밀번호 정책 위반, 로그인 실패 |
| **Spaces** | Space 없음, 비활성 Space, 권한 없음 |
| **Members** | 초대 만료, 이미 멤버임, Role 변경 불가 |
| **Folders** | 부모 폴더 없음, 같은 이름의 폴더 존재, 순환 이동 |
| **Files** | 파일 없음, 삭제된 파일, 이동 불가 |
| **Uploads** | quota 초과, 예약 만료, 업로드 세션 상태 불일치 |
| **Downloads** | 다운로드 토큰 만료, 권한 없음 |
| **ShareLinks** | 링크 만료, 비활성화된 링크, 비밀번호 불일치 |
| **Quotas** | 예약 용량 초과, Space quota 초과 |

이런 실패는 시스템 장애가 아니므로 `throw`보다 `Result.Fail(...)`이 더 적합하다.

### 2.2 처리 방식 선택 기준

| 상황 | 권장 방식 |
|------|-----------|
| 입력 검증 실패 | `Result.Fail(...)` |
| 도메인 규칙 위반 | `Result.Fail(...)` |
| 권한 없음, 리소스 없음 | `Result.Fail(...)` |
| DB 연결 장애, 버그, 인프라 장애 | 예외 또는 `Result.Try(...)` 후 로깅 |
| 실패 가능성이 없는 단순 계산 | 그냥 값 반환 |

---

## 3. 아키텍처 내 실패 처리 전략

각 계층마다 실패의 성격과 처리 방식이 다르다.

| 계층 | 실패의 의미 | 처리 방식 |
|------|-------------|-----------|
| `CloudSharp.Core/Domain` | 도메인 규칙 위반 | `Result` / `Result<T>`로 반환 |
| `CloudSharp.Core/UseCases` | 유스케이스 실패, 권한 없음, quota 초과 | `Result` / `Result<T>`로 반환 |
| `CloudSharp.Api/Endpoints` | Result를 HTTP 응답으로 변환 | `ProblemDetails` 또는 응답 DTO로 매핑 |
| `CloudSharp.Infrastructure` | 외부 시스템 실패, 저장소 실패 | 예상 실패는 `Result`, 예상 못 한 장애는 예외 또는 `Try`로 감싸기 |
| `CloudSharp.Api/Middlewares` | 처리되지 않은 시스템 예외 | 공통 예외 미들웨어에서 500 응답과 로그 처리 |

### 아키텍처 흐름도

```
HTTP Request
    ↓
CloudSharp.Api/Endpoints
    - request DTO 검증
    - UseCase 호출
    - Result를 HTTP response로 변환
    ↓
CloudSharp.Core/UseCases
    - 업무 흐름 실행
    - Domain 정책 호출
    - Abstractions port 호출
    - Result<T> 반환
    ↓
CloudSharp.Core/Domain
    - 도메인 규칙 검증
    - 상태 전이
    - 커스텀 Error 생성
    ↓
CloudSharp.Infrastructure
    - DB/Redis/Storage/외부 도구 구현
    - 외부 실패를 Result 또는 예외로 표현
```

---

## 4. 패키지 배치

### 4.1 설치

CloudSharp에서는 `Result`가 내부 애플리케이션 계약으로 쓰이므로, 세 프로젝트 모두에 설치한다.

```bash
dotnet add src/CloudSharp.Core package FluentResults
dotnet add src/CloudSharp.Api package FluentResults
dotnet add src/CloudSharp.Infrastructure package FluentResults
```

### 4.2 프로젝트별 사용 목적

| 프로젝트 | 사용 목적 |
|----------|-----------|
| `CloudSharp.Core` | 도메인 팩토리, 정책, 유스케이스 반환형 |
| `CloudSharp.Api` | `Result<T>`를 HTTP 응답으로 변환 |
| `CloudSharp.Infrastructure` | 외부 adapter 실패를 `Result`로 변환 |

### 4.3 주의사항

> **public API 응답에 `Result<T>`를 그대로 노출하지 않는다.** API 경계에서는 항상 CloudSharp의 응답 DTO 또는 `ProblemDetails`로 변환한다.

---

## 5. Core 계층 사용 원칙

### 5.1 디렉토리 구조

```
CloudSharp.Core/
├── Common/
│   ├── Errors/          ← 공통 Error base, ErrorCode
│   └── Results/         ← Result helper
├── Domain/              ← 도메인 규칙 위반을 커스텀 Error로 표현
├── Abstractions/        ← 저장소/외부 포트의 실패 계약
└── UseCases/            ← 유스케이스 흐름을 Result<T>로 반환
```

### 5.2 위치별 원칙

| 위치 | 원칙 |
|------|------|
| `Common` | 공통 Error base, ErrorCode, Result helper |
| `Domain/*` | 도메인 규칙 위반을 커스텀 `Error`로 표현 |
| `UseCases/*` | 유스케이스 흐름을 `Result<T>`로 반환 |
| `Abstractions/*` | 저장소/외부 포트의 실패 계약을 명확히 표현 |

---

## 6. 에러 객체 설계

### 6.1 문자열 에러 vs 객체 에러

간단한 프로토타입에서는 문자열 에러도 충분하다.

```csharp
return Result.Fail("Space를 찾을 수 없습니다.");
```

하지만 CloudSharp처럼 도메인이 많은 시스템에서는 **커스텀 `Error` 객체**가 낫다.

### 6.2 공통 에러 베이스 클래스

```csharp
using FluentResults;

namespace CloudSharp.Core.Common.Errors;

public abstract class CloudSharpError : Error
{
    protected CloudSharpError(string errorCode, string message)
        : base(message)
    {
        Metadata.Add("ErrorCode", errorCode);
    }
}
```

### 6.3 도메인별 에러 클래스

도메인별 에러는 해당 도메인 폴더 또는 `Common/Errors`에 둔다.

```csharp
using CloudSharp.Core.Common.Errors;

namespace CloudSharp.Core.Domain.Users;

public sealed class DuplicateEmailError : CloudSharpError
{
    public DuplicateEmailError(string email)
        : base("USER_DUPLICATE_EMAIL", "이미 사용 중인 이메일입니다.")
    {
        Metadata.Add("Email", email);
    }
}
```

### 6.4 사용 예시

```csharp
public Result Register(string email)
{
    if (_userRepository.Exists(email))
        return Result.Fail(new DuplicateEmailError(email));

    return Result.Ok();
}
```

### 6.5 객체 에러의 장점

| 장점 | 설명 |
|------|------|
| **표준화** | `ErrorCode`를 모든 계층에서 동일하게 사용 |
| **API 변환** | HTTP status와 response body 매핑이 쉬움 |
| **로깅** | SpaceId, FileId, UploadSessionId 같은 메타데이터 보관 가능 |
| **테스트** | 문자열 비교 대신 에러 타입/코드 검증 가능 |

---

## 7. Domain — 팩토리와 상태 전이

### 7.1 원칙

도메인 객체 생성이나 상태 전이는 실패할 수 있다. `FolderPath`, `UploadSession`, `ShareLink` 같은 값 객체/엔티티는 잘못된 값으로 만들어지면 안 된다.

| 규칙 | 이유 |
|------|------|
| 비즈니스 실패에 예외를 쓰지 않는다 | 예상 가능한 실패는 호출자가 처리해야 한다 |
| `Result<T>`는 유효한 객체만 성공으로 반환한다 | 실패한 객체가 시스템에 들어오지 않게 한다 |
| 인프라 예외 타입을 참조하지 않는다 | `Core → Infrastructure` 의존성을 막는다 |

### 7.2 팩토리 패턴 예시

```csharp
using FluentResults;

namespace CloudSharp.Core.Domain.Folders;

public sealed record FolderPath
{
    public string Value { get; }

    private FolderPath(string value)
    {
        Value = value;
    }

    public static Result<FolderPath> Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Fail<FolderPath>("폴더 경로는 비어 있을 수 없습니다.");

        if (!value.StartsWith('/'))
            return Result.Fail<FolderPath>("폴더 경로는 /로 시작해야 합니다.");

        return Result.Ok(new FolderPath(value));
    }
}
```

### 7.3 상태 전이 예시

```csharp
public Result FinalizeUpload()
{
    if (Status != UploadSessionStatus.Uploading)
        return Result.Fail("업로드 중인 세션만 finalize할 수 있습니다.");

    Status = UploadSessionStatus.Completed;
    return Result.Ok();
}
```

### 7.4 Quota 검증 예시

```csharp
public Result ValidateQuota(long requestedBytes)
{
    if (requestedBytes <= 0)
        return Result.Fail("업로드 크기는 0보다 커야 합니다.");

    if (requestedBytes > RemainingBytes)
        return Result.Fail("Space quota를 초과했습니다.");

    return Result.Ok();
}
```

---

## 8. UseCases — 업무 흐름 파이프라인

### 8.1 디렉토리 구조

```
CloudSharp.Core/UseCases/
├── Auth/
├── Spaces/
├── Members/
├── Folders/
├── Files/
├── Uploads/
├── Downloads/
├── ShareLinks/
├── Quotas/
└── Admin/
```

### 8.2 Bind를 이용한 파이프라인

업로드 초기화처럼 여러 단계가 있는 흐름에서 `Bind`를 쓰면 실패 가능한 단계를 연결할 수 있다.

```csharp
public Result<InitializeUploadResponse> Handle(InitializeUploadCommand command)
{
    return EnsureSpaceExists(command.SpaceId)
        .Bind(_ => EnsureCanUpload(command.SpaceId, command.UserId))
        .Bind(_ => EnsureQuotaAvailable(command.SpaceId, command.SizeBytes))
        .Bind(_ => ReserveFileName(command))
        .Bind(reservation => CreateUploadSession(command, reservation));
}
```

### 8.3 Bind 패턴의 장점

| 장점 | 설명 |
|------|------|
| **앞 단계 실패 시 뒤 단계가 실행되지 않음** | 불필요한 DB/Storage 호출 방지 |
| **실패 이유가 보존됨** | API 응답과 로그에서 원인 추적 가능 |
| **중첩 `if` 감소** | 유스케이스가 업무 흐름처럼 읽힘 |

---

## 9. Map — 도메인 객체를 DTO로 변환

### 9.1 사용 패턴

조회 유스케이스에서는 도메인 객체를 DTO로 바꿔야 한다. `Map`은 성공 값만 변환하고, 실패하면 기존 에러를 그대로 유지한다.

```csharp
public Result<SpaceDetailDto> Handle(GetSpaceDetailQuery query)
{
    return FindSpace(query.SpaceId)
        .Bind(space => EnsureReadable(space, query.UserId).Map(_ => space))
        .Map(space => new SpaceDetailDto(
            space.Id,
            space.Name,
            space.Status.ToString()));
}
```

### 9.2 활용 위치

| 위치 | 예시 |
|------|------|
| `UseCases/Spaces` | `Space` → `SpaceDetailDto` |
| `UseCases/Files` | `FileItem` → `FileListItemDto` |
| `UseCases/Downloads` | `DownloadSession` → `DownloadTokenDto` |
| `UseCases/ShareLinks` | `ShareLink` → `ShareLinkDto` |

---

## 10. Merge — 복수 검증 결과 집계

### 10.1 사용 시나리오

회원가입, Space 생성, 파일 업로드 초기화처럼 입력값이 많은 유스케이스에서는 검증 오류가 여러 개 나올 수 있다.

```csharp
public Result ValidateCreateSpace(CreateSpaceCommand command)
{
    var nameResult = ValidateSpaceName(command.Name);
    var quotaResult = ValidateInitialQuota(command.InitialQuotaBytes);

    return Result.Merge(nameResult, quotaResult);
}
```

### 10.2 개별 검증 메서드

각 검증은 작게 유지한다.

```csharp
private static Result ValidateSpaceName(string name)
{
    if (string.IsNullOrWhiteSpace(name))
        return Result.Fail("Space 이름은 필수입니다.");

    if (name.Length > 80)
        return Result.Fail("Space 이름은 80자를 초과할 수 없습니다.");

    return Result.Ok();
}
```

API는 이 에러 목록을 그대로 모아 400 응답으로 변환할 수 있다.

---

## 11. Abstractions — 포트의 실패 계약

### 11.1 디렉토리 구조

```
CloudSharp.Core/Abstractions/
├── Auth/
├── Persistence/
├── Storage/
├── Messaging/
├── Clock/
└── Processing/
```

### 11.2 반환형 설계 기준

| 포트 성격 | 권장 반환형 |
|-----------|-------------|
| 단순 조회, 없을 수 있음 | `Task<T?>` |
| 저장/상태 변경, 실패 이유 필요 | `Task<Result>` |
| 외부 adapter 결과가 필요 | `Task<Result<T>>` |
| 실패 가능성이 없는 시간/ID 생성 | 일반 값 반환 |

### 11.3 예시

```csharp
public interface IUploadSessionRepository
{
    Task<UploadSession?> FindByIdAsync(
        Guid id,
        CancellationToken cancellationToken);

    Task<Result> AddAsync(
        UploadSession uploadSession,
        CancellationToken cancellationToken);
}
```

### 11.4 NotFound 처리 지침

> 리소스가 없는 것이 도메인/유스케이스 의미를 가져야 한다면, **저장소는 `null`을 반환**하고 **UseCase에서 `SpaceNotFoundError`, `FileNotFoundError` 같은 에러로 바꾸는** 편이 명확하다.

---

## 12. Infrastructure — 외부 실패를 Result로 감싸기

### 12.1 디렉토리 구조

```
CloudSharp.Infrastructure/
├── Persistence/
├── Storage/
├── Uploads/
├── Messaging/
├── Auth/
├── Preview/
└── Ai/
```

### 12.2 실패 분류 및 처리 기준

| 실패 유형 | 처리 방식 |
|-----------|-----------|
| 비즈니스적으로 예상 가능한 adapter 실패 | `Result.Fail(...)` |
| 외부 프로세스 실패 코드 | `Result.Fail(...)` + 메타데이터 |
| DB 연결 장애, 파일 시스템 장애 | 예외를 로깅하거나 `CausedBy`로 보존 |
| 프로그래밍 버그 | 예외를 숨기지 않음 |

### 12.3 외부 프로세스 실패 예시

```csharp
public async Task<Result> GeneratePreviewAsync(
    FileItem file,
    CancellationToken cancellationToken)
{
    try
    {
        var exitCode = await _ffmpegRunner.RunAsync(
            file.StorageKey, cancellationToken);

        if (exitCode != 0)
        {
            return Result.Fail(
                new Error("미리보기 생성에 실패했습니다.")
                    .WithMetadata("ErrorCode", "PREVIEW_FFMPEG_FAILED")
                    .WithMetadata("FileId", file.Id)
                    .WithMetadata("ExitCode", exitCode));
        }

        return Result.Ok();
    }
    catch (Exception exception)
    {
        return Result.Fail(
            new Error("미리보기 작업 중 예외가 발생했습니다.")
                .CausedBy(exception)
                .WithMetadata("ErrorCode", "PREVIEW_UNEXPECTED_ERROR")
                .WithMetadata("FileId", file.Id));
    }
}
```

### 12.4 Result.Try 활용

```csharp
public Result<string> CreateToken(DownloadSession session)
{
    return Result.Try(
        () => _tokenWriter.Write(session),
        exception => new Error("다운로드 토큰 생성에 실패했습니다.")
            .CausedBy(exception)
            .WithMetadata("ErrorCode", "DOWNLOAD_TOKEN_CREATE_FAILED")
            .WithMetadata("DownloadSessionId", session.Id));
}
```

---

## 13. Api — Result를 HTTP 응답으로 변환

### 13.1 디렉토리 구조

```
CloudSharp.Api/
├── Endpoints/
│   └── ResultHttpMapper.cs    ← 공통 변환기
├── Auth/
├── OpenApi/
├── Middlewares/
│   └── ExceptionHandlingMiddleware.cs
└── BackgroundServices/
```

### 13.2 핵심 원칙

`CloudSharp.Api`는 `Result<T>`를 외부 계약으로 노출하지 않는다.

| 내부 | 외부 |
|------|------|
| `Result<T>` (성공) | `200 OK` + DTO |
| `Result.Fail` | `ProblemDetails` 또는 CloudSharp error response |
| `Error.Metadata` | `errors[].metadata` 또는 내부 로그 필드 |

### 13.3 Endpoint 사용 예시

```csharp
public static async Task<IResult> GetSpace(
    Guid spaceId,
    GetSpaceDetailUseCase useCase,
    CancellationToken cancellationToken)
{
    var result = await useCase.Handle(
        new GetSpaceDetailQuery(spaceId),
        cancellationToken);

    return result.ToHttpResult(Results.Ok);
}
```

### 13.4 공통 변환기 구현

```csharp
using FluentResults;
using Microsoft.AspNetCore.Http;

namespace CloudSharp.Api.Endpoints;

public static class ResultHttpMapper
{
    public static IResult ToHttpResult<T>(
        this Result<T> result,
        Func<T, IResult> onSuccess)
    {
        if (result.IsSuccess)
            return onSuccess(result.Value);

        var statusCode = ResolveStatusCode(result.Errors);

        return Results.Problem(
            statusCode: statusCode,
            title: "요청을 처리할 수 없습니다.",
            extensions: new Dictionary<string, object?>
            {
                ["errors"] = result.Errors.Select(error => new
                {
                    message = error.Message,
                    metadata = error.Metadata
                })
            });
    }

    private static int ResolveStatusCode(IReadOnlyList<IError> errors)
    {
        var errorCodes = errors
            .Select(error =>
                error.Metadata.TryGetValue("ErrorCode", out var code)
                    ? code?.ToString()
                    : null)
            .Where(code => code is not null)
            .ToArray();

        if (errorCodes.Any(c => c!.EndsWith("_NOT_FOUND")))
            return StatusCodes.Status404NotFound;

        if (errorCodes.Any(c =>
            c!.Contains("FORBIDDEN") || c!.Contains("UNAUTHORIZED")))
            return StatusCodes.Status403Forbidden;

        if (errorCodes.Any(c =>
            c!.Contains("CONFLICT") || c!.Contains("DUPLICATE")))
            return StatusCodes.Status409Conflict;

        return StatusCodes.Status400BadRequest;
    }
}
```

---

## 14. BackgroundServices에서의 사용

`CloudSharp.Api/BackgroundServices`는 Redis 이벤트 구독, media/AI 후처리 host를 담당한다.

BackgroundService에서는 실패를 HTTP 응답으로 바꾸지 않는다. 대신 **Result를 로그와 재시도 정책으로 연결**한다.

```csharp
var result = await previewUseCase.Handle(command, stoppingToken);

if (result.IsFailed)
{
    _logger.LogWarning(
        "Preview job failed. Errors: {Errors}",
        result.Errors.Select(error => new
        {
            error.Message,
            error.Metadata
        }));

    return;
}
```

> 반복 작업에서 예외를 삼켜서 서비스가 조용히 죽지 않게 하고, 예상 가능한 실패는 `Result`로 기록한다.

---

## 15. 테스트 전략

### 15.1 테스트 프로젝트 구조

```
tests/
├── CloudSharp.Core.Tests/
├── CloudSharp.Infrastructure.Tests/
├── CloudSharp.Api.IntegrationTests/
└── CloudSharp.Architecture.Tests/
```

### 15.2 프로젝트별 검증 대상

| 테스트 프로젝트 | FluentResults 검증 대상 |
|-----------------|-------------------------|
| `CloudSharp.Core.Tests` | 도메인 정책, 상태 전이, UseCase 실패 이유 |
| `CloudSharp.Infrastructure.Tests` | adapter 실패가 적절한 `ErrorCode`로 변환되는지 |
| `CloudSharp.Api.IntegrationTests` | `Result.Fail`이 올바른 HTTP status/body로 변환되는지 |
| `CloudSharp.Architecture.Tests` | `Core`가 `Api`, `Infrastructure`를 참조하지 않는지 |

### 15.3 Core 테스트 예시

```csharp
[Test]
public void Create_ShouldFail_WhenFolderPathIsEmpty()
{
    var result = FolderPath.Create("");

    Assert.That(result.IsFailed, Is.True);
    Assert.That(
        result.Errors[0].Message,
        Is.EqualTo("폴더 경로는 비어 있을 수 없습니다."));
}
```

### 15.4 API 통합 테스트 예시

```csharp
[Test]
public async Task GetSpace_ShouldReturn404_WhenSpaceDoesNotExist()
{
    var response = await _client.GetAsync(
        "/spaces/00000000-0000-0000-0000-000000000000");

    Assert.That(
        response.StatusCode,
        Is.EqualTo(HttpStatusCode.NotFound));
}
```

---

## 16. 에러 코드 체계

### 16.1 도메인별 에러 코드

| 영역 | 예시 코드 |
|------|-----------|
| **Auth** | `AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_ALREADY_USED` |
| **Users** | `USER_NOT_FOUND`, `USER_DUPLICATE_EMAIL` |
| **Spaces** | `SPACE_NOT_FOUND`, `SPACE_INACTIVE`, `SPACE_FORBIDDEN` |
| **Members** | `MEMBER_NOT_FOUND`, `MEMBER_ALREADY_EXISTS`, `INVITE_EXPIRED` |
| **Folders** | `FOLDER_NOT_FOUND`, `FOLDER_DUPLICATE_NAME`, `FOLDER_INVALID_MOVE` |
| **Files** | `FILE_NOT_FOUND`, `FILE_DELETED`, `FILE_DUPLICATE_NAME` |
| **Uploads** | `UPLOAD_QUOTA_EXCEEDED`, `UPLOAD_SESSION_EXPIRED`, `UPLOAD_INVALID_STATUS` |
| **Downloads** | `DOWNLOAD_TOKEN_EXPIRED`, `DOWNLOAD_FORBIDDEN` |
| **ShareLinks** | `SHARE_LINK_EXPIRED`, `SHARE_LINK_DISABLED`, `SHARE_LINK_PASSWORD_MISMATCH` |
| **Preview** | `PREVIEW_FFMPEG_FAILED`, `PREVIEW_UNEXPECTED_ERROR` |
| **AI** | `AI_METADATA_EXTRACTION_FAILED` |

### 16.2 권장 메타데이터 필드

| 필드 | 예시 |
|------|------|
| `ErrorCode` | `UPLOAD_QUOTA_EXCEEDED` |
| `SpaceId` | `space.Id` |
| `FileId` | `file.Id` |
| `UploadSessionId` | `uploadSession.Id` |
| `TraceId` | HTTP trace id |
| `CurrentUserId` | 현재 사용자 id |

---

## 17. 자주 하는 실수

### 17.1 모든 실패를 Result로만 처리하기

진짜 시스템 장애까지 전부 `Result.Fail`로 덮으면 장애 감지가 흐려진다.

| 실패 | 처리 |
|------|------|
| quota 초과 | `Result.Fail` |
| 권한 없음 | `Result.Fail` |
| 파일 없음 | `Result.Fail` |
| DB 서버 다운 | **예외** + 미들웨어/로그 |
| 코드 버그 | **예외** |

### 17.2 실패 상태에서 Value 바로 읽기

`Result<T>.Value`는 **성공일 때만** 읽는다.

```csharp
// ✅ 올바른 패턴
if (result.IsFailed)
    return result.ToHttpResult();

var value = result.Value;
```

### 17.3 문자열 에러만 남발하기

초기에는 빠르지만, API 매핑과 테스트가 어려워진다. 도메인별 커스텀 `Error` 또는 최소한 표준 `ErrorCode` 메타데이터를 둔다.

### 17.4 API 응답에 Result를 그대로 노출하기

외부 계약은 라이브러리 타입이 아니라 CloudSharp의 DTO여야 한다.

```csharp
// ❌ 피한다
public Task<Result<SpaceDetailDto>> GetSpace(...)

// ✅ 권장한다
public Task<IResult> GetSpace(...)
```

### 17.5 실패 가능성이 없는 메서드까지 Result로 감싸기

모든 메서드가 `Result<T>`를 반환하면 오히려 의미가 흐려진다.

```csharp
// ✅ 실패할 이유가 없다면 그냥 값으로 둔다
public long CalculateRemainingBytes(long quotaBytes, long usedBytes)
    => quotaBytes - usedBytes;
```

---

## 18. 도입 순서

한 번에 모든 계층을 바꾸지 말고 다음 순서로 진행한다.

### 1단계: Core 공통 에러 규칙 정의

`CloudSharp.Core/Common/Errors`에 `CloudSharpError`, 에러 코드 규칙, 공통 메타데이터 규칙을 둔다.

### 2단계: Domain 팩토리와 상태 전이에 적용

`FolderPath.Create`, `UploadSession.Finalize`, `ShareLink.ValidatePassword` 같은 실패 가능한 도메인 메서드부터 적용한다.

### 3단계: UseCases 반환형 통일

`UseCases/*`의 command/query handler는 `Result` 또는 `Result<T>`를 반환한다.

### 4단계: Api 공통 Result mapper 작성

`CloudSharp.Api/Endpoints`에 `ResultHttpMapper`를 두고, endpoint마다 반복되는 `if (result.IsFailed)` 코드를 줄인다.

### 5단계: Infrastructure adapter 실패 정리

DB, Redis, Local FS, tusd, ffmpeg, AI adapter에서 예상 가능한 실패에 `ErrorCode`와 메타데이터를 붙인다.

### 6단계: 테스트로 규칙 고정

`Core.Tests`와 `Api.IntegrationTests`에서 실패 결과와 HTTP 매핑을 검증하고, `Architecture.Tests`에서 의존성 규칙을 지킨다.

---

## 19. 요약

| 질문 | 답 |
|------|----|
| **어디서 쓰나?** | `CloudSharp.Core/Domain`, `CloudSharp.Core/UseCases`, 일부 `Infrastructure adapter` |
| **어디서 변환하나?** | `CloudSharp.Api/Endpoints`의 공통 mapper |
| **무엇을 표현하나?** | 비즈니스 실패, 검증 실패, 권한 실패, quota 실패 |
| **무엇을 표현하지 않나?** | 버그, 시스템 장애, 실패 가능성이 없는 단순 계산 |
| **핵심 API** | `Result.Ok`, `Result.Fail`, `Map`, `Bind`, `Merge`, `Try` |
| **핵심 규칙** | 내부는 `Result`, 외부 API는 DTO / `ProblemDetails` |

> **CloudSharp에서 FluentResults는 Core의 비즈니스 실패를 명시적으로 표현하고, Api가 이를 HTTP 응답으로 변환하게 만드는 내부 애플리케이션 계약이다.**

---

## 참고 자료

- [FluentResults GitHub](https://github.com/altmann/FluentResults)
