# UseCase Command / Query 컨벤션

> API 계층에서 Core 유스케이스를 호출할 때 사용하는 `Command`와 `Query`의 명명 규칙, 배치, 작성 방식을 정의한다.

---

## 1. 목적

클린 아키텍처에서 API는 외부 요청을 받는 진입점이고, Core는 비즈니스 유스케이스를 수행하는 중심이다.

따라서 API의 HTTP request DTO를 Core에 그대로 넘기지 않고, Core가 이해하는 유스케이스 입력 모델로 변환해야 한다.

```text
HTTP Request
    ↓
CloudSharp.Api
    - Request DTO binding
    - Request validation
    - 인증 정보 추출
    - Request DTO → Command / Query 또는 UseCase 직접 인자 변환
    ↓
CloudSharp.Core
    - Command / Query validation 또는 간단한 인자 방어
    - UseCase 실행
    - Domain / Port 호출
```

이 문서는 Command / Query 작성 규칙과, 단순한 유스케이스에서 이를 생략해도 되는 기준을 함께 다룬다.

| 타입 | 의미 |
|------|------|
| `Command` | 상태를 변경하는 유스케이스 입력 |
| `Query` | 상태를 조회하는 유스케이스 입력 |

---

## 2. 기본 원칙

| 원칙                                  | 설명                                                          |
| ----------------------------------- | ----------------------------------------------------------- |
| API request DTO를 Core로 넘기지 않는다      | HTTP 계약과 유스케이스 계약을 분리한다                                     |
| Command / Query를 만든다면 Core에 둔다      | 유스케이스의 입력 계약이므로 `CloudSharp.Core` 소유다                       |
| 이름은 유스케이스 행위 이름과 맞춘다                | `CreateSpace` 유스케이스의 입력은 `CreateSpaceCommand`               |
| 복잡한 유스케이스는 하나의 입력 모델을 받는다           | 입력이 많거나 검증이 필요하면 Command / Query 하나로 묶는다                    |
| 단순한 유스케이스는 입력 모델을 생략할 수 있다          | ID 1~2개만 받는 조회/처리까지 무조건 타입을 만들지 않는다                         |
| Command / Query는 외부 기술 타입을 참조하지 않는다 | `HttpContext`, `ClaimsPrincipal`, `IFormFile`, EF Entity 금지 |
| 인증 주체는 API가 추출해서 명시적으로 넣는다          | body에서 받은 `UserId`를 신뢰하지 않는다                                |

---

## 3. Command / Query 생략 기준

Command / Query는 유스케이스 입력 계약이 복잡해질 때 유용하다. 반대로 입력이 너무 단순하면 별도 타입이 오히려 파일과 코드만 늘린다.

### 3.1 생략해도 되는 경우

아래 조건을 모두 만족하면 Command / Query를 만들지 않고 UseCase 메서드에 값을 직접 넘겨도 된다.

| 조건 | 예시 |
|------|------|
| 입력이 없거나 1~2개다 | `requesterUserId`, `spaceId` |
| body DTO 조합이 없다 | route id + 인증 사용자 정도 |
| 별도 validator가 필요 없다 | `Guid.Empty` 정도만 방어 |
| pagination/filter/sort가 없다 | 단일 상세 조회 |
| 다른 진입점에서 재사용할 입력 계약이 아니다 | API 전용 단순 조회 |

예시:

```csharp
public Task<Result<SpaceDetailResult>> GetDetailAsync(
    Guid requesterUserId,
    Guid spaceId,
    CancellationToken cancellationToken)
```

```csharp
public Task<Result> RevokeAsync(
    Guid requesterUserId,
    Guid shareLinkId,
    CancellationToken cancellationToken)
```

### 3.2 만들어야 하는 경우

다음 중 하나라도 해당하면 Command / Query를 만든다.

| 조건 | 이유 |
|------|------|
| 입력이 3개 이상이다 | 메서드 시그니처가 금방 읽기 어려워진다 |
| body + path + auth 값을 조합한다 | API 입력과 유스케이스 입력을 분리해야 한다 |
| FluentValidation validator가 필요하다 | 검증 대상 타입이 필요하다 |
| 목록 조회 조건이 있다 | `Cursor`, `Limit`, `SortBy`, filter 등을 묶어야 한다 |
| bulk 작업이다 | item별 입력과 정책 확장이 필요하다 |
| MCP Console, worker 등 다른 진입점에서도 호출한다 | Core 입력 계약을 명시하는 편이 낫다 |
| 추후 필드가 늘어날 가능성이 높다 | 시그니처 변경 파급을 줄인다 |

기준은 간단하다.

> **단순하면 직접 인자, 복잡해지면 Command / Query.**

---

## 4. 용어 구분

### 4.1 Request DTO

API 계층의 HTTP 요청 모양이다.

```csharp
namespace CloudSharp.Api.Endpoints.Spaces;

public sealed record CreateSpaceRequest(
    string Name,
    long? StorageAllowedBytes);
```

특징:

| 항목 | 기준 |
|------|------|
| 위치 | `CloudSharp.Api/Endpoints/{Feature}/` |
| 이름 | `{Action}{Resource}Request` |
| 책임 | HTTP body/query/path binding |
| 포함 가능 | 사용자가 보낸 값 |
| 포함 금지 | Core 비즈니스 흐름, 도메인 판단 |

### 4.2 Command

상태를 변경하는 유스케이스 입력이다.

```csharp
namespace CloudSharp.Core.UseCases.Spaces;

public sealed record CreateSpaceCommand
{
    public required Guid RequesterUserId { get; init; }
    public required string Name { get; init; }
    public long? StorageAllowedBytes { get; init; }
}
```

특징:

| 항목 | 기준 |
|------|------|
| 위치 | `CloudSharp.Core/UseCases/{Feature}/` |
| 이름 | `{Verb}{Resource}Command` |
| 책임 | 유스케이스 실행에 필요한 입력 표현 |
| 반환 | UseCase가 `Result` 또는 `Result<T>` 반환 |
| 예시 | `CreateSpaceCommand`, `RenameFolderCommand`, `FinalizeUploadCommand` |

### 4.3 Query

상태를 변경하지 않고 조회하는 유스케이스 입력이다.

```csharp
namespace CloudSharp.Core.UseCases.Files;

public sealed record ListFilesQuery
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public Guid? ParentFolderId { get; init; }
    public string? Cursor { get; init; }
    public required int Limit { get; init; }
}
```

특징:

| 항목 | 기준 |
|------|------|
| 위치 | `CloudSharp.Core/UseCases/{Feature}/` |
| 이름 | `{Verb}{Resource}Query` |
| 책임 | 조회 조건 표현 |
| 반환 | UseCase가 `Result<T>` 반환 |
| 예시 | `GetSpaceDetailQuery`, `ListFilesQuery`, `SearchFilesQuery` |

---

## 5. Command / Query 선택 기준

### 5.1 Command를 쓰는 경우

시스템 상태가 바뀌면 Command다.

| 유스케이스 | 입력 모델 |
|------------|-----------|
| Space 생성 | `CreateSpaceCommand` |
| Space 이름 변경 | `RenameSpaceCommand` |
| 폴더 이동 | `MoveFolderCommand` |
| 업로드 초기화 | `InitializeUploadCommand` |
| 업로드 finalize | `FinalizeUploadCommand` |
| 공유 링크 폐기 | `RevokeShareLinkCommand` |

다음 변경도 Command로 본다.

| 변경 유형 | 예시 |
|-----------|------|
| DB row 생성/수정/삭제 | 파일 메타데이터 생성 |
| 상태 전이 | 업로드 세션 `Uploading` → `Completed` |
| 권한 변경 | 멤버 role 변경 |
| 예약/락/토큰 생성 | 업로드 용량 예약, 다운로드 세션 생성 |
| 이벤트 발행이 핵심인 작업 | 후처리 작업 요청 |

### 5.2 Query를 쓰는 경우

상태를 조회만 하면 Query다.

| 유스케이스 | 입력 모델 |
|------------|-----------|
| Space 상세 조회 | `GetSpaceDetailQuery` |
| 파일 목록 조회 | `ListFilesQuery` |
| 파일 검색 | `SearchFilesQuery` |
| 공유 링크 정보 조회 | `GetShareLinkQuery` |
| 다운로드 가능 여부 확인 | `CheckDownloadAccessQuery` |

> Query도 권한 검사를 생략하지 않는다. 읽기 권한, Space 접근 가능 여부, 공유 링크 만료 여부는 UseCase에서 판단한다.

### 5.3 애매한 경우

| 상황 | 기준 |
|------|------|
| 조회하면서 access log만 남김 | 로그가 부수 효과면 Query 허용 |
| 조회하면서 last viewed time을 갱신 | 비즈니스 상태 변경이면 Command |
| 다운로드 토큰을 발급 | 토큰 생성 상태가 남으므로 Command |
| quota 사용 가능 여부 확인 | 단순 확인이면 Query, 예약까지 하면 Command |

---

## 6. 네이밍 규칙

### 6.1 기본 형식

```text
{UseCaseActionName}Command
{UseCaseActionName}Query
```

Command / Query 이름은 클래스 파일명이 아니라 **유스케이스 행위 이름**과 맞춘다.

| 유스케이스 행위 | 입력 모델 |
|---------------|-----------|
| `CreateSpace` | `CreateSpaceCommand` |
| `RenameFolder` | `RenameFolderCommand` |
| `InitializeUpload` | `InitializeUploadCommand` |
| `GetSpaceDetail` | `GetSpaceDetailQuery` |
| `ListFiles` | `ListFilesQuery` |

즉, 기능 단위 클래스에 메서드를 모아도 Command / Query 이름은 메서드 행위와 맞춘다.

```csharp
public sealed class SpaceUseCases
{
    public Task<Result<CreateSpaceResult>> CreateAsync(
        CreateSpaceCommand command,
        CancellationToken cancellationToken)
        => throw new NotImplementedException();

    public Task<Result<SpaceDetailResult>> GetDetailAsync(
        GetSpaceDetailQuery query,
        CancellationToken cancellationToken)
        => throw new NotImplementedException();
}
```

| 구성 요소 | 기준 | 예시 |
|-----------|------|------|
| `Verb` | 유스케이스 행위 | `Create`, `Rename`, `Move`, `Get`, `List` |
| `Resource` | 도메인 대상 | `Space`, `Folder`, `File`, `Upload` |
| 접미사 | 변경은 `Command`, 조회는 `Query` | `CreateSpaceCommand` |

### 6.2 Command 동사

| 동사 | 사용 기준 | 예시 |
|------|-----------|------|
| `Create` | 새 리소스 생성 | `CreateSpaceCommand` |
| `Update` | 여러 속성 변경 | `UpdateSpaceSettingsCommand` |
| `Rename` | 이름만 변경 | `RenameFolderCommand` |
| `Move` | 위치 변경 | `MoveFileCommand` |
| `Delete` | 삭제 처리 | `DeleteFileCommand` |
| `Restore` | 삭제/비활성 상태 복구 | `RestoreFileCommand` |
| `Initialize` | 세션/작업 시작 전 준비 | `InitializeUploadCommand` |
| `Finalize` | 외부 작업 완료 후 확정 | `FinalizeUploadCommand` |
| `Cancel` | 진행 중인 작업 취소 | `CancelUploadCommand` |
| `Revoke` | 권한/토큰/링크 폐기 | `RevokeShareLinkCommand` |
| `Invite` | 초대 생성 | `InviteMemberCommand` |
| `Accept` | 초대/요청 수락 | `AcceptInviteCommand` |

### 6.3 Query 동사

| 동사 | 사용 기준 | 예시 |
|------|-----------|------|
| `Get` | 단일 리소스 상세 조회 | `GetSpaceDetailQuery` |
| `List` | 특정 범위의 목록 조회 | `ListFilesQuery` |
| `Search` | 검색어, 필터, 정렬 기반 검색 | `SearchFilesQuery` |
| `Check` | 가능 여부나 상태 확인 | `CheckDownloadAccessQuery` |
| `Count` | 개수 조회 | `CountSpaceMembersQuery` |

`Find`는 repository 내부 조회 메서드에 주로 사용하고, 유스케이스 행위 이름에는 `Get`, `List`, `Search`를 우선 사용한다.

### 6.4 피해야 할 이름

| 나쁜 이름 | 이유 | 권장 이름 |
|-----------|------|-----------|
| `PostSpacesCommand` | HTTP 메서드 기준 | `CreateSpaceCommand` |
| `CreateSpaceRequestCommand` | Request와 Command 개념 혼합 | `CreateSpaceCommand` |
| `SpaceCreateCommand` | 유스케이스 행위 이름과 어긋남 | `CreateSpaceCommand` |
| `GetSpaceCommand` | 조회인데 Command 사용 | `GetSpaceDetailQuery` |
| `CreateSpaceDto` | DTO 의미가 모호함 | `CreateSpaceCommand` |
| `HandleCreateSpaceCommand` | Handler 동작을 타입명에 반복 | `CreateSpaceCommand` |

---

## 7. 파일 배치

### 7.1 Core UseCases

```text
CloudSharp.Core/
└── UseCases/
    ├── Spaces/
    │   ├── CreateSpaceCommand.cs
    │   ├── CreateSpaceCommandValidator.cs
    │   ├── GetSpaceDetailQuery.cs
    │   ├── GetSpaceDetailQueryValidator.cs
    │   └── SpaceUseCases.cs
    └── Uploads/
        ├── InitializeUploadCommand.cs
        ├── InitializeUploadCommandValidator.cs
        └── UploadUseCases.cs
```

MVP 단계에서는 유스케이스마다 클래스를 하나씩 만들지 않고, **기능 단위 UseCases 클래스**에 메서드로 모은다.

| 방식 | 사용 시점 |
|------|-----------|
| `SpaceUseCases`에 `CreateAsync`, `GetDetailAsync`, `RenameAsync` 배치 | MVP 기본 |
| `CreateSpaceUseCase`처럼 유스케이스별 class 분리 | 메서드가 커지거나 의존성이 갈라질 때 |

분리 기준:

| 분리 신호 | 이유 |
|-----------|------|
| 한 메서드가 여러 private helper를 계속 만든다 | 독립 유스케이스로 빼는 편이 읽기 쉽다 |
| 특정 메서드만 필요한 의존성이 많다 | 기능 단위 class 생성자가 비대해진다 |
| 테스트 fixture가 메서드마다 크게 달라진다 | 분리하면 테스트 구성이 단순해진다 |
| 트랜잭션/락/이벤트 흐름이 복잡하다 | 독립 class가 책임을 더 명확히 한다 |

### 7.2 API Endpoints

```text
CloudSharp.Api/
└── Endpoints/
    ├── Spaces/
    │   ├── CreateSpaceRequest.cs
    │   ├── CreateSpaceRequestValidator.cs
    │   └── SpaceEndpoints.cs
    └── Uploads/
        ├── InitializeUploadRequest.cs
        ├── InitializeUploadRequestValidator.cs
        └── UploadEndpoints.cs
```

### 7.3 파일 분리 기준

| 상황 | 기준 |
|------|------|
| 타입이 작아도 공개 계약이면 별도 파일 | `CreateSpaceCommand.cs` |
| 한 유스케이스 전용 item record | 같은 파일에 함께 배치 가능 |
| validator는 별도 파일 | `CreateSpaceCommandValidator.cs` |
| UseCase 실행 클래스는 기능 단위로 시작 | `SpaceUseCases.cs` |
| mapper가 짧으면 endpoint private method | 반복되면 API 계층 extension으로 분리 |

---

## 8. 작성 규칙

### 8.1 record와 개체 이니셜라이저 사용

Command / Query는 기본적으로 `sealed record`와 `required init` property로 작성하고, 생성할 때는 개체 이니셜라이저를 사용한다.

```csharp
public sealed record RenameFolderCommand
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public required Guid FolderId { get; init; }
    public required string NewName { get; init; }
}

var command = new RenameFolderCommand
{
    RequesterUserId = userContext.UserId,
    SpaceId = spaceId,
    FolderId = folderId,
    NewName = request.NewName
};
```

이유:

| 이유 | 설명 |
|------|------|
| 불변 입력 모델 | UseCase 실행 중 입력이 바뀌지 않는다 |
| 이름 기반 생성 | 인자 순서 실수를 줄인다 |
| 필수값 누락 방지 | `required`로 빠진 필드를 컴파일 타임에 잡는다 |
| 테스트 편의 | 값 비교와 테스트 데이터 생성이 쉽다 |
| 의도 명확성 | 데이터 전달 객체임이 분명하다 |

입력이 1~2개이고 순서가 명확한 작은 타입은 positional record를 허용한다. 다만 Command / Query 입력이 3개 이상이면 개체 이니셜라이저 방식을 우선한다.

### 8.2 필드 이름

| 값 종류 | 이름 규칙 | 예시 |
|---------|-----------|------|
| 사용자 주체 | `RequesterUserId` | 현재 요청 사용자 |
| 리소스 식별자 | `{Resource}Id` | `SpaceId`, `FileId` |
| 시간 | `{Name}AtUtc` | `ExpiresAtUtc` |
| 용량 | `{Name}Bytes` | `SizeBytes`, `QuotaBytes` |
| 개수 제한 | `Limit` | 목록 조회 최대 개수 |
| 커서 | `Cursor` | cursor pagination |
| 검색어 | `Keyword` | 파일 검색어 |
| 포함 여부 | `Include{Target}` | `IncludeDeleted` |

`RequesterUserId`는 body에서 받지 않고 API가 인증 정보에서 추출한다.

### 8.3 타입 선택

| 값 | 권장 타입 |
|----|-----------|
| ID | `Guid` 또는 프로젝트 표준 ID 타입 |
| 시간 | `DateTimeOffset` |
| byte 크기 | `long` |
| 금액/정밀 수치 | `decimal` |
| 선택값 | nullable 타입 |
| 목록 | `IReadOnlyList<T>` |
| 정렬/상태 | `enum` |

Core에 이미 값 객체가 있고 생성 실패를 처리할 수 있다면 값 객체를 사용해도 된다. 다만 API request DTO의 raw string을 검증 없이 값 객체처럼 취급하지 않는다.

### 8.4 넣지 않는 값

Command / Query에 다음 타입을 넣지 않는다.

| 금지 타입               | 이유                   |
| ------------------- | -------------------- |
| `HttpContext`       | API 기술 타입            |
| `ClaimsPrincipal`   | 인증 프레임워크 타입          |
| `IFormFile`         | ASP.NET 업로드 타입       |
| EF Entity           | 인프라 persistence 타입   |
| `DbContext`         | 인프라 구현 타입            |
| `IServiceProvider`  | 의존성 숨김               |
| `CancellationToken` | Handle 메서드 파라미터로 받는다 |

### 8.5 개체 이니셜라이저 사용 기준

필수 입력은 `required init`, 선택 입력은 일반 `init`으로 둔다.

```csharp
public sealed record CreateSpaceCommand
{
    public required Guid RequesterUserId { get; init; }
    public required string Name { get; init; }
    public long? StorageAllowedBytes { get; init; }
}
```

개체 이니셜라이저를 쓰는 이유는 다음과 같다.

| 이유 | 설명 |
|------|------|
| 매핑 코드가 읽기 쉽다 | 어떤 request 값이 어떤 command 필드로 가는지 바로 보인다 |
| 인자 순서 버그를 줄인다 | 같은 타입의 `Guid`, `string`이 많아도 안전하다 |
| 선택값 표현이 자연스럽다 | optional property는 생략하거나 `null`로 둘 수 있다 |
| Java builder와 비슷한 읽기 경험을 준다 | 별도 builder 클래스 없이 이름 기반 초기화 가능 |

도메인 엔티티나 값 객체는 개체 이니셜라이저로 만들지 않는다. 불변식이 있는 타입은 factory나 생성자로 유효한 상태만 만들게 한다.

---

## 9. API에서 변환하는 방식

### 9.1 Endpoint 기본 패턴

```csharp
private static async Task<IResult> CreateSpace(
    CreateSpaceRequest request,
    IValidator<CreateSpaceRequest> requestValidator,
    SpaceUseCases useCases,
    IUserContext userContext,
    CancellationToken cancellationToken)
{
    var validationResult = await requestValidator.ValidateAsync(request, cancellationToken);
    if (!validationResult.IsValid)
        return validationResult.ToValidationProblem();

    var command = new CreateSpaceCommand
    {
        RequesterUserId = userContext.UserId,
        Name = request.Name,
        StorageAllowedBytes = request.StorageAllowedBytes
    };

    var result = await useCases.CreateAsync(command, cancellationToken);

    return result.ToHttpResult(space =>
        Results.Created($"/spaces/{space.SpaceId}", space));
}
```

### 9.2 변환 위치

| 방식 | 사용 기준 |
|------|-----------|
| endpoint 안에서 직접 생성 | 매핑이 1~3줄로 단순한 경우 |
| private `ToCommand` 메서드 | path/body/auth 조합이 필요한 경우 |
| API 계층 extension mapper | 여러 endpoint에서 반복되는 경우 |

예시:

```csharp
private static InitializeUploadCommand ToCommand(
    this InitializeUploadRequest request,
    Guid requesterUserId,
    Guid spaceId)
{
    return new InitializeUploadCommand
    {
        RequesterUserId = requesterUserId,
        SpaceId = spaceId,
        TargetFolderId = request.TargetFolderId,
        FileName = request.FileName,
        SizeBytes = request.SizeBytes,
        ContentType = request.ContentType
    };
}
```

이 mapper는 `CloudSharp.Api`에 둔다. Core가 API request DTO를 알면 안 된다.

---

## 10. Validation 규칙

### 10.1 Request validator와 Command / Query validator 역할

| 위치 | 검증 대상 | 예시 |
|------|-----------|------|
| API request validator | HTTP 입력 모양 | body 필수값, query string 범위, path/body 조합 |
| Core command/query validator | 유스케이스 공통 입력 조건 | `SpaceId` 필수, 파일 크기 양수, 이름 길이 |
| UseCase 본문 | 비즈니스 판단 | 권한, 존재 여부, quota, 상태 전이 |
| Domain | 불변식 | 값 객체 생성, 상태 전이 가능 여부 |

### 10.2 Command validator 예시

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

### 10.3 Validator에 넣지 않는 것

| 금지 판단 | 담당 위치 |
|-----------|-----------|
| Space가 실제 존재하는가 | UseCase |
| 사용자가 Space에 접근 가능한가 | UseCase / Domain policy |
| quota가 충분한가 | UseCase / Domain policy |
| 파일명이 중복되는가 | UseCase |
| 업로드 세션 상태가 finalize 가능한가 | Domain entity |

---

## 11. UseCases 작성 패턴

### 11.1 MVP 기본: 기능 단위로 모으기

MVP 단계에서는 유스케이스마다 class를 만들지 않고, 기능 단위 class에 메서드로 모은다.

```csharp
public sealed class UploadUseCases
{
    private readonly IValidator<InitializeUploadCommand> _initializeValidator;
    private readonly ISpaceRepository _spaces;
    private readonly IUploadSessionRepository _uploadSessions;

    public UploadUseCases(
        IValidator<InitializeUploadCommand> initializeValidator,
        ISpaceRepository spaces,
        IUploadSessionRepository uploadSessions)
    {
        _initializeValidator = initializeValidator;
        _spaces = spaces;
        _uploadSessions = uploadSessions;
    }

    public async Task<Result<InitializeUploadResult>> InitializeAsync(
        InitializeUploadCommand command,
        CancellationToken cancellationToken)
    {
        var validationResult = await _initializeValidator.ValidateAsync(command, cancellationToken);
        if (!validationResult.IsValid)
            return validationResult.ToResult().ToResult<InitializeUploadResult>();

        // 존재 여부, 권한, quota, 상태 전이는 여기서 판단한다.
        // ...
    }
}
```

조회도 같은 기능 class에 둔다.

```csharp
public sealed class SpaceUseCases
{
    private readonly IValidator<CreateSpaceCommand> _createValidator;
    private readonly IValidator<GetSpaceDetailQuery> _getDetailValidator;
    private readonly ISpaceRepository _spaces;

    public SpaceUseCases(
        IValidator<CreateSpaceCommand> createValidator,
        IValidator<GetSpaceDetailQuery> getDetailValidator,
        ISpaceRepository spaces)
    {
        _createValidator = createValidator;
        _getDetailValidator = getDetailValidator;
        _spaces = spaces;
    }

    public async Task<Result<CreateSpaceResult>> CreateAsync(
        CreateSpaceCommand command,
        CancellationToken cancellationToken)
    {
        var validationResult = await _createValidator.ValidateAsync(command, cancellationToken);
        if (!validationResult.IsValid)
            return validationResult.ToResult().ToResult<CreateSpaceResult>();

        // 생성 권한, 중복, quota 초기값 판단
        // ...
    }

    public async Task<Result<SpaceDetailResult>> GetDetailAsync(
        GetSpaceDetailQuery query,
        CancellationToken cancellationToken)
    {
        var validationResult = await _getDetailValidator.ValidateAsync(query, cancellationToken);
        if (!validationResult.IsValid)
            return validationResult.ToResult().ToResult<SpaceDetailResult>();

        var space = await _spaces.FindByIdAsync(query.SpaceId, cancellationToken);
        if (space is null)
            return Result.Fail(new SpaceNotFoundError(query.SpaceId));

        // 읽기 권한 검증 후 결과 반환
        // ...
    }
}
```

### 11.2 메서드 이름

기능 class 안에서는 접미사 `UseCase`를 반복하지 않는다.

| 유스케이스 | 기능 class | 메서드 |
|------------|------------|--------|
| Space 생성 | `SpaceUseCases` | `CreateAsync` |
| Space 상세 조회 | `SpaceUseCases` | `GetDetailAsync` |
| 업로드 초기화 | `UploadUseCases` | `InitializeAsync` |
| 업로드 finalize | `UploadUseCases` | `FinalizeAsync` |

Command / Query 이름은 메서드 이름이 짧아져도 전체 행위를 드러내게 유지한다.

| 메서드 | 입력 모델 |
|--------|-----------|
| `CreateAsync` | `CreateSpaceCommand` |
| `GetDetailAsync` | `GetSpaceDetailQuery` |
| `InitializeAsync` | `InitializeUploadCommand` |

### 11.3 나중에 분리하는 기준

아래 상황이 오면 그때 유스케이스별 class로 분리한다.

| 분리 신호 | 예시 |
|-----------|------|
| 기능 class 생성자 의존성이 너무 많다 | `SpaceUseCases`가 8개 이상 dependency를 받음 |
| 특정 메서드만 복잡하다 | `CreateAsync`만 락, 이벤트, 트랜잭션을 모두 다룸 |
| 테스트 setup이 메서드마다 크게 다르다 | 조회 테스트와 생성 테스트 fixture가 완전히 다름 |
| 재사용/배치/worker 진입점이 갈라진다 | 업로드 finalize가 API와 worker에서 별도 흐름을 가짐 |

분리 후에도 Command / Query 이름은 유지한다.

---

## 12. 목록 조회 Query 규칙

### 12.1 기본 pagination

파일 목록처럼 데이터가 계속 변하는 화면은 cursor pagination을 기본으로 한다.

```csharp
public sealed record ListFilesQuery
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public Guid? ParentFolderId { get; init; }
    public string? Cursor { get; init; }
    public required int Limit { get; init; }
    public required FileSortBy SortBy { get; init; }
    public required SortDirection SortDirection { get; init; }
}
```

| 필드 | 기준 |
|------|------|
| `Cursor` | 첫 페이지면 `null` |
| `Limit` | validator에서 최소/최대 제한 |
| `SortBy` | 문자열 대신 enum 사용 |
| `SortDirection` | `Asc`, `Desc` enum 사용 |

관리자 화면처럼 명시적 페이지 이동이 중요한 경우에만 `Page`, `PageSize`를 사용한다.

### 12.2 필터

필터가 3개 이상이면 별도 record로 분리한다.

```csharp
public sealed record SearchFilesQuery
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public required string Keyword { get; init; }
    public required FileSearchFilter Filter { get; init; }
    public string? Cursor { get; init; }
    public required int Limit { get; init; }
}

public sealed record FileSearchFilter
{
    public IReadOnlyList<string> ContentTypes { get; init; } = Array.Empty<string>();
    public DateTimeOffset? CreatedFromUtc { get; init; }
    public DateTimeOffset? CreatedToUtc { get; init; }
    public bool IncludeDeleted { get; init; }
}
```

---

## 13. Bulk Command 규칙

여러 대상을 한 번에 처리하는 경우 `Bulk{Action}{Resource}Command`를 사용한다.

```csharp
public sealed record BulkDeleteFilesCommand
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public required IReadOnlyList<BulkDeleteFilesCommandItem> Items { get; init; }
}

public sealed record BulkDeleteFilesCommandItem
{
    public required Guid FileId { get; init; }
}
```

규칙:

| 규칙 | 설명 |
|------|------|
| item record를 둔다 | 추후 item별 옵션이나 실패 사유를 확장하기 쉽다 |
| 목록은 `IReadOnlyList<T>`를 쓴다 | UseCase 내부에서 입력 목록을 변경하지 않는다 |
| 최대 개수는 validator에서 제한한다 | 과도한 요청을 사전에 차단한다 |
| 부분 성공 정책을 명확히 한다 | 전부 실패/전부 성공/부분 성공 중 하나를 UseCase 계약으로 정한다 |

---

## 14. 테스트 규칙

### 14.1 Core 테스트

Command / Query는 Core 유스케이스의 입력 계약이므로 Core 테스트에서 직접 생성한다.

```csharp
[Test]
public async Task Handle_Should_Fail_When_SizeBytes_Is_Zero()
{
    var command = new InitializeUploadCommand
    {
        RequesterUserId = Guid.NewGuid(),
        SpaceId = Guid.NewGuid(),
        TargetFolderId = Guid.NewGuid(),
        FileName = "sample.mp4",
        SizeBytes = 0,
        ContentType = "video/mp4"
    };

    var result = await _uploadUseCases.InitializeAsync(command, CancellationToken.None);

    Assert.That(result.IsFailed, Is.True);
}
```

### 14.2 API 통합 테스트

API 테스트는 Request DTO와 HTTP 응답을 검증한다. Core Command / Query 타입을 API 응답 계약처럼 검증하지 않는다.

| 테스트 | 검증 대상 |
|--------|-----------|
| Core UseCase 테스트 | Command / Query 입력, Result 실패 이유 |
| Command / Query validator 테스트 | 필드별 error code |
| API 통합 테스트 | Request DTO validation, HTTP status, response body |

---

## 15. 금지 사항

| 금지 사항 | 이유 |
|-----------|------|
| 복잡한 API request DTO를 UseCase에 직접 넘긴다 | API 계약 변경이 Core에 전파된다 |
| Command / Query를 `CloudSharp.Api`에 둔다 | Core 유스케이스 계약이 바깥 계층에 생긴다 |
| Command / Query가 `HttpContext`를 가진다 | Core가 ASP.NET에 의존하게 된다 |
| Query에서 상태를 변경한다 | 읽기 유스케이스의 예측 가능성이 깨진다 |
| Command 이름에 HTTP 메서드를 넣는다 | 유스케이스 행위가 드러나지 않는다 |
| body의 `UserId`를 신뢰한다 | 인증 주체 위조 가능성이 생긴다 |
| validator에서 권한/quota/존재 여부를 모두 처리한다 | UseCase와 Domain의 책임이 흐려진다 |
| 하나의 `UpdateCommand`에 모든 변경을 몰아넣는다 | 권한, 검증, 테스트 범위가 불명확해진다 |
| 단순 조회까지 무조건 Query 파일을 만든다 | 형식만 늘고 실익이 작다 |
| 필드가 많은 Command / Query를 positional record로 만든다 | 같은 타입 인자의 순서 실수가 생기기 쉽다 |

---

## 16. 최종 요약

| 질문 | 답 |
|------|----|
| 상태를 바꾸는가? | `Command` |
| 조회만 하는가? | `Query` |
| 항상 만들어야 하는가? | 아니다. 단순하면 직접 인자로 받아도 된다 |
| 어디에 두는가? | `CloudSharp.Core/UseCases/{Feature}/`에 Command/Query와 기능 단위 `*UseCases` class를 둔다 |
| API request DTO와 같은가? | 다르다. API에서 변환한다 |
| 어떻게 생성하는가? | 필수값은 `required init`, 생성은 개체 이니셜라이저를 기본으로 한다 |
| 이름은 무엇 기준인가? | 유스케이스 행위 이름에 `Command` / `Query`를 붙인다 |
| 인증 사용자 ID는 어디서 넣는가? | API가 인증 컨텍스트에서 추출해 `RequesterUserId`로 넣는다 |
| 검증은 어디서 하는가? | 입력 모양은 API validator, 공통 입력 조건은 Core validator, 비즈니스 판단은 UseCase/Domain |

> **Command / Query는 API 요청 모델이 아니라 Core 유스케이스의 입력 계약이다. MVP에서는 유스케이스 실행 코드를 기능 단위 `*UseCases` class에 모으고, 입력이 복잡할 때 유스케이스 행위 이름과 맞춘 `required init` record를 개체 이니셜라이저로 생성한다.**
