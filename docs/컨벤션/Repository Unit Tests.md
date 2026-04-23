# CloudSharp Repository 테스트 컨벤션

> Repository 테스트는 영속성 매핑과 Result 계약을 검증하되, 빠르고 반복 가능한 실행을 우선한다.

---

## 1. 목적

이 문서는 `CloudSharp.Infrastructure`의 Repository 테스트 작성 기준을 정리한다.

Repository 테스트는 다음을 보장해야 한다.

- Core 도메인 객체와 Persistence Entity의 매핑이 깨지지 않는다
- 저장 후 반환되는 도메인 객체가 실제 저장 상태를 반영한다
- 추가, 수정, 조회 실패가 `Result` 계약으로 반환된다
- Role, timestamp, soft delete 상태가 저장과 반환 모두에서 유지된다

Repository 테스트는 DB를 완전히 검증하는 테스트가 아니다. Repository 코드가 계약을 지키는지 검증하는 테스트다. DB constraint, migration, provider-specific type은 별도 통합 테스트에서 검증한다.

---

## 2. 테스트 위치

테스트 파일은 대상 Repository 구조를 그대로 따른다.

```text
tests/CloudSharp.Infrastructure.Tests/
└── Persistence/
    └── Repositories/
        └── UserRepositoryTests.cs
```

파일명은 항상 `{RepositoryName}Tests.cs` 형식을 사용한다.

| 대상 | 테스트 파일 |
|------|-------------|
| `UserRepository` | `UserRepositoryTests.cs` |
| `SpaceRepository` | `SpaceRepositoryTests.cs` |
| `FolderRepository` | `FolderRepositoryTests.cs` |

---

## 3. 테스트 DB 선택 기준

### 3.1 기본은 EF InMemory

Repository의 매핑, 반환 계약, 상태 변경을 빠르게 검증할 때는 EF InMemory를 사용한다.

```xml
<PackageReference Include="Microsoft.EntityFrameworkCore.InMemory" Version="10.0.4" />
```

InMemory 테스트는 다음 목적에 적합하다.

- Domain → Entity 매핑 검증
- Entity → Domain 매핑 검증
- 저장 성공/실패 Result 계약 검증
- update 시 변경 필드 반영 검증
- exists query true/false 검증

### 3.2 Provider 특성 검증은 SQLite나 실제 DB를 사용한다

EF InMemory는 관계형 DB가 아니다. 다음을 검증해야 하면 SQLite 또는 실제 PostgreSQL 기반 통합 테스트를 사용한다.

- unique constraint
- foreign key
- transaction
- raw SQL
- provider-specific type
- migration
- concurrency token

---

## 4. Test DbContext 규칙

Infrastructure의 실제 `CloudSharpDbContext` 전체 모델을 그대로 InMemory에 올리면 provider-specific mapping 때문에 테스트가 깨질 수 있다.

Repository 테스트에서는 필요한 aggregate만 남긴 test-only DbContext를 사용할 수 있다.

```csharp
private sealed class UserRepositoryTestDbContext(DbContextOptions<CloudSharpDbContext> options)
    : CloudSharpDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Ignore<SpaceEntity>();
        modelBuilder.Ignore<FileItemEntity>();

        modelBuilder.Entity<UserEntity>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.Email).IsUnique();
            entity.Property(x => x.Id).ValueGeneratedOnAdd();
        });
    }
}
```

규칙:

- 테스트 대상 Repository에 필요한 entity만 남긴다
- unrelated entity는 `Ignore<T>()`로 제외한다
- 테스트에서 필요한 최소 mapping만 명시한다
- 실제 DB provider 동작을 검증하려는 목적이면 이 방식을 쓰지 않는다

---

## 5. Bogus 데이터 생성 규칙

### 5.1 테스트 데이터는 Bogus로 만든다

테스트 데이터는 하드코딩 문자열보다 Bogus helper로 생성한다.

```csharp
private static User CreateDomainUser(int seed, long id = 0)
{
    var faker = CreateFaker(seed);

    return User.Reconstitute(
        id,
        faker.Internet.Email(),
        faker.Internet.Password(20),
        faker.Internet.UserName(),
        faker.Name.FullName(),
        SystemRole.User,
        DateTimeOffset.UtcNow,
        DateTimeOffset.UtcNow,
        null);
}
```

### 5.2 seed는 고정한다

테스트는 항상 같은 입력으로 반복되어야 한다.

현재 Bogus 버전에서 non-generic `Faker`는 `.UseSeed(...)` 대신 `Randomizer`를 직접 지정한다.

```csharp
private static Faker CreateFaker(int seed)
{
    return new Faker("en")
    {
        Random = new Randomizer(seed)
    };
}
```

규칙:

- 테스트마다 seed를 명시한다
- 같은 테스트 안에서 서로 다른 데이터가 필요하면 seed를 다르게 준다
- 랜덤 값을 assertion에 직접 기대하지 않고, helper가 만든 값을 기준으로 비교한다

### 5.3 override는 helper 파라미터로 받는다

테스트마다 필요한 차이만 파라미터로 표현한다.

```csharp
CreateDomainUser(seed: 1, role: SystemRole.Admin);
CreateDomainUser(seed: 2, id: 10, deletedAt: deletedAt);
```

테스트 본문에서 object initializer를 길게 반복하지 않는다.

---

## 6. 필수 테스트 체크리스트

Repository 테스트는 최소한 다음을 포함한다.

| 테스트 | 검증 내용 |
|--------|-----------|
| `SaveAsync_ShouldAddUser` | 신규 domain 저장, generated id 반환, entity persisted |
| `SaveAsync_ShouldPreserveAdminRole` | role mapping round-trip |
| `SaveAsync_ShouldUpdateUser` | tracked entity update, timestamp, delete state 반영 |
| `SaveAsync_ShouldFailWhenUpdatingMissingUser` | 없는 id update 실패 Result 반환 |
| `ExistEmailAsync_ShouldReturnTrueWhenEmailExists` | 존재하는 email true |
| `ExistEmailAsync_ShouldReturnFalseWhenEmailIsMissing` | 없는 email false |

추가 Repository도 같은 패턴으로 성공, 실패, 매핑, 상태 변경을 분리해서 작성한다.

---

## 7. Assertion 규칙

### 7.1 Result 계약을 먼저 본다

```csharp
Assert.That(result.IsSuccess, Is.True);
Assert.That(result.Value.Id, Is.GreaterThan(0));
```

실패 테스트에서는 문자열보다 error contract를 우선한다.

```csharp
Assert.That(result.IsFailed, Is.True);
Assert.That(result.Errors, Is.Not.Empty);
```

### 7.2 반환값과 저장 상태를 둘 다 본다

Repository 테스트는 반환된 domain만 검증하지 않는다. DB에 저장된 entity도 함께 확인한다.

```csharp
var savedEntity = await dbContext.Users.FindAsync(result.Value.Id);

Assert.That(savedEntity, Is.Not.Null);
Assert.That(savedEntity!.Email, Is.EqualTo(domain.Email));
Assert.That(result.Value.Email, Is.EqualTo(domain.Email));
```

### 7.3 Mapping은 의미 있는 필드만 비교한다

모든 필드를 무조건 한 줄씩 비교하기보다, 해당 테스트의 목적에 맞는 필드를 우선한다.

- add 테스트: id, email, user name, display name
- role 테스트: `SystemRole`
- update 테스트: mutable fields, `UpdatedAt`, `DeletedAt`
- exists 테스트: boolean result

---

## 8. 실행 명령

Backend 테스트는 `apps/backend`에서 실행한다.

```powershell
cd apps/backend
dotnet test CloudSharp.Backend.sln
```

Repository 테스트만 빠르게 볼 때는 다음처럼 실행한다.

```powershell
cd apps/backend
dotnet test tests/CloudSharp.Infrastructure.Tests/CloudSharp.Infrastructure.Tests.csproj
```