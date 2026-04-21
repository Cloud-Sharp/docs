# C# 개체 이니셜라이저 컨벤션

> C#의 개체 이니셜라이저(object initializer), `init`, `required` 사용 기준을 Java와 비교해 정리한다.

---

## 1. 목적

CloudSharp 백엔드에서는 입력 모델과 설정 객체를 만들 때 **이름 기반 초기화**를 적극 사용한다.

특히 Command / Query처럼 `Guid`, `string`, `long` 값이 여러 개 섞이는 타입은 생성자 인자 순서 실수가 나기 쉽다. 이때 C# 개체 이니셜라이저와 `required init`을 쓰면 필수값 누락을 줄이고 매핑 코드를 읽기 쉽게 만들 수 있다.

이 문서에서 다루는 대상은 다음 세 가지다.

| 기능 | 용도 |
|------|------|
| 개체 이니셜라이저 | `new Type { Property = value }` 형태의 이름 기반 초기화 |
| `init` | 생성 시점에만 set 가능한 property |
| `required` | 개체 생성 시 반드시 초기화해야 하는 property 표시 |

---

## 2. 기본 문법

```csharp
public sealed record CreateSpaceCommand
{
    public required Guid RequesterUserId { get; init; }
    public required string Name { get; init; }
    public long? StorageAllowedBytes { get; init; }
}

var command = new CreateSpaceCommand
{
    RequesterUserId = userContext.UserId,
    Name = request.Name,
    StorageAllowedBytes = request.StorageAllowedBytes
};
```

### 핵심 특징

| 특징 | 설명 |
|------|------|
| 이름 기반 | 값이 어느 property에 들어가는지 코드에서 바로 보인다 |
| 순서 비의존 | 생성자 parameter 순서를 외울 필요가 없다 |
| `init`과 궁합이 좋다 | 생성 후에는 값을 바꿀 수 없다 |
| `required`와 궁합이 좋다 | 필수 property 누락을 컴파일 타임에 잡는다 |

개체 이니셜라이저는 생성자를 우회하지 않는다. C# 컴파일러는 먼저 접근 가능한 생성자를 호출하고, 그다음 initializer에 적힌 property를 대입한다.

```csharp
var options = new StorageOptions
{
    RootPath = "/data/cloudsharp"
};
```

위 코드는 개념적으로 다음 흐름이다.

```csharp
var options = new StorageOptions();
options.RootPath = "/data/cloudsharp";
```

단, property가 `init`이면 이 대입은 개체 생성 식 안에서만 가능하다.

---

## 3. Java와 비교

Java에는 C# 개체 이니셜라이저와 같은 문법이 없다.

### 3.1 Java 생성자 방식

```java
CreateSpaceCommand command = new CreateSpaceCommand(
    requesterUserId,
    name,
    storageAllowedBytes
);
```

장점은 필수값이 생성자에서 강제된다는 점이다. 단점은 같은 타입의 인자가 많아지면 순서 실수가 잘 보이지 않는다는 점이다.

### 3.2 Java record 방식

```java
public record CreateSpaceCommand(
    UUID requesterUserId,
    String name,
    Long storageAllowedBytes
) {
}
```

Java record는 짧고 불변 데이터에 적합하지만, 생성은 여전히 순서 기반이다.

```java
new CreateSpaceCommand(requesterUserId, name, storageAllowedBytes);
```

### 3.3 Java builder 방식

```java
CreateSpaceCommand command = CreateSpaceCommand.builder()
    .requesterUserId(requesterUserId)
    .name(name)
    .storageAllowedBytes(storageAllowedBytes)
    .build();
```

C# 개체 이니셜라이저는 별도 builder 없이 이와 비슷한 이름 기반 초기화 경험을 제공한다.

```csharp
var command = new CreateSpaceCommand
{
    RequesterUserId = requesterUserId,
    Name = name,
    StorageAllowedBytes = storageAllowedBytes
};
```

### 3.4 비교 요약

| 관점 | Java constructor / record | Java builder | C# object initializer |
|------|---------------------------|--------------|-----------------------|
| 생성 방식 | 순서 기반 | 이름 기반 | 이름 기반 |
| 필수값 강제 | 생성자에서 강제 | builder 구현에 따라 다름 | `required`로 강제 |
| 불변성 | `final`, record | 구현에 따라 다름 | `init`으로 보장 |
| 코드 길이 | 짧음 | 김 | 중간 |
| 인자 순서 실수 | 발생 가능 | 낮음 | 낮음 |

---

## 4. `required init` 사용 기준

필수 입력은 `required init`으로 둔다.

```csharp
public required Guid SpaceId { get; init; }
```

선택 입력은 `required`를 붙이지 않는다.

```csharp
public string? Cursor { get; init; }
public Guid? ParentFolderId { get; init; }
```

기본값이 있는 선택 입력은 property initializer를 사용한다.

```csharp
public int Limit { get; init; } = 50;
public IReadOnlyList<string> ContentTypes { get; init; } = Array.Empty<string>();
```

### 주의사항

| 주의 | 설명 |
|------|------|
| `required`는 validation이 아니다 | 값 누락만 막고, 값의 유효성은 검증하지 않는다 |
| `null!`을 넣으면 통과할 수 있다 | nullable warning과 validator를 함께 사용한다 |
| setter 접근성이 필요하다 | `required` property는 외부에서 접근 가능한 `init` 또는 `set`이 있어야 한다 |
| 도메인 불변식 보장용이 아니다 | 도메인 객체는 factory/생성자에서 검증한다 |

---

## 5. CloudSharp 적용 기준

### 5.1 Command / Query

입력이 3개 이상인 Command / Query는 `sealed record` + `required init` + 개체 이니셜라이저를 기본으로 한다.

```csharp
public sealed record InitializeUploadCommand
{
    public required Guid RequesterUserId { get; init; }
    public required Guid SpaceId { get; init; }
    public required Guid TargetFolderId { get; init; }
    public required string FileName { get; init; }
    public required long SizeBytes { get; init; }
    public required string ContentType { get; init; }
}
```

API에서 변환할 때:

```csharp
var command = new InitializeUploadCommand
{
    RequesterUserId = userContext.UserId,
    SpaceId = spaceId,
    TargetFolderId = request.TargetFolderId,
    FileName = request.FileName,
    SizeBytes = request.SizeBytes,
    ContentType = request.ContentType
};
```

입력이 1~2개이고 순서가 명확하면 Command / Query를 생략하고 UseCase에 직접 인자로 넘겨도 된다.

```csharp
await useCase.Handle(
    requesterUserId,
    spaceId,
    cancellationToken);
```

### 5.2 Options / config

Options class는 `required init`과 잘 맞는다.

```csharp
public sealed class StorageOptions
{
    public required string RootPath { get; init; }
    public required long MaxFileSizeBytes { get; init; }
    public string TempPath { get; init; } = "tmp";
}
```

### 5.3 테스트 데이터

테스트에서는 개체 이니셜라이저가 의도를 잘 드러낸다.

```csharp
var command = new CreateSpaceCommand
{
    RequesterUserId = Guid.NewGuid(),
    Name = "",
    StorageAllowedBytes = 1024
};
```

### 5.4 중첩 객체

필터나 item 객체도 이름 기반으로 만든다.

```csharp
var query = new SearchFilesQuery
{
    RequesterUserId = requesterUserId,
    SpaceId = spaceId,
    Keyword = "report",
    Filter = new FileSearchFilter
    {
        ContentTypes = new[] { "application/pdf" },
        IncludeDeleted = false
    },
    Limit = 50
};
```

---

## 6. 피해야 하는 위치

### 6.1 외부에서 변경 가능한 DTO

Command / Query는 `set`보다 `init`을 사용한다.

```csharp
// 피한다
public required string Name { get; set; }

// 권장
public required string Name { get; init; }
```

---

## 7. 작성 규칙

| 규칙 | 설명 |
|------|------|
| 필수 입력은 `required init` | 생성 시 누락을 막는다 |
| 선택 입력은 nullable 또는 기본값 | 생략 가능한 값임을 드러낸다 |
| Command / Query는 `sealed record` | 값 기반 비교와 DTO 의도가 맞다 |
| 3개 이상 필드는 개체 이니셜라이저 | 순서 기반 생성자 실수를 줄인다 |
| 도메인 객체는 factory/생성자 | 불변식을 타입 내부에서 보장한다 |
| `set` 대신 `init` | 생성 후 변경을 막는다 |
| validator는 별도로 둔다 | `required`는 validation 대체가 아니다 |

---

## 8. 금지 사항

| 금지 사항                                       | 이유                            |
| ------------------------------------------- | ----------------------------- |
| `required`를 validation 대체로 사용한다             | null, empty, 범위, 권한을 보장하지 않는다 |
| Command / Query에 public `set`을 둔다           | UseCase 실행 중 입력 변경 가능성이 생긴다   |
| 필수값에 기본값을 넣어 required를 피한다                  | 누락을 숨긴다                       |
| 필드가 많은 Command를 positional constructor로 만든다 | 같은 타입 인자 순서 실수가 생긴다           |
| `SetsRequiredMembers`를 일반 패턴으로 쓴다           | 컴파일러 검사를 우회한다                 |

---

## 9. 최종 가이드

> **Command / Query와 Options는 `required init` + 개체 이니셜라이저로 만들고, 도메인 객체는 factory/생성자로 만든다.**

Java에 익숙하다면 이렇게 기억한다.

| Java 감각 | C#에서 대응 |
|-----------|-------------|
| record/constructor DTO | `required init` record + object initializer |
| builder | object initializer |
| setter DTO | `init` property DTO |
| constructor validation | factory 또는 명시 생성자 |
| final field 불변성 | `init` + 외부 변경 금지 |

---

## 참고 자료

- [Microsoft Learn - Object and collection initializers](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/object-and-collection-initializers)
- [Microsoft Learn - required modifier](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/required)
- [Oracle Java Documentation - Record Classes](https://docs.oracle.com/en/java/javase/23/language/records.html)
