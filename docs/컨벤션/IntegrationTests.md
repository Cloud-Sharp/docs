# CloudSharp API 통합 테스트 가이드

> `CloudSharp.Api.IntegrationTests` 프로젝트에서 실제 PostgreSQL, Redis, ASP.NET Core 앱을 함께 띄워 API 계약과 인프라 연동을 검증하는 규칙

## 1. 목적

### 1.1 대상 범위

이 문서는 `apps/backend/tests/CloudSharp.Api.IntegrationTests` 프로젝트를 기준으로 한다.

이 테스트 프로젝트는 다음을 함께 검증한다.

- Minimal API 엔드포인트의 HTTP status code와 응답 본문
- FluentValidation 및 `ResultHttpMapper`를 거친 에러 응답 계약
- EF Core를 통한 DB 반영 결과
- Redis 세션/상태 저장소 연동

이 문서는 유닛 테스트 규칙을 대체하지 않는다.  
유닛 테스트 공통 규칙은 `conventions/testing.md`를 따르고, 여기서는 **API 통합 테스트에서만 필요한 호스트/인프라/검증 규칙**을 추가로 정의한다.

---

## 2. 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **실제 인프라를 붙인다** | PostgreSQL, Redis는 Testcontainers로 실제 컨테이너를 띄운다 |
| **앱은 테스트 호스트로 부팅한다** | `WebApplicationFactory<Program>` 기반으로 API를 메모리 내에서 실행한다 |
| **테스트 간 상태를 완전히 초기화한다** | 각 테스트 전 DB는 Respawn, Redis는 flush로 비운다 |
| **HTTP 계약을 먼저 검증한다** | 1차 검증은 항상 status code와 응답 바디 계약이다 |
| **필요할 때만 DB side effect를 확인한다** | 성공 후 영속화/변경 여부는 `ExecuteDbContextAsync`로 검증한다 |
| **실패는 메시지보다 에러 코드로 본다** | `JsonElement` + `ExtractErrorCodes()`로 계약을 검증한다 |
| **정상 요청은 factory로 만든다** | 기본 요청 생성은 `RequestFactories`에 숨기고 테스트는 override만 한다 |

---

## 3. 패키지 기준

`CloudSharp.Api.IntegrationTests.csproj` 기준 필수 패키지는 다음과 같다.

```xml
<PackageReference Include="Bogus" Version="35.6.5" />
<PackageReference Include="coverlet.collector" Version="6.0.4" />
<PackageReference Include="FluentValidation" Version="12.1.1" />
<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.5" />
<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.0" />
<PackageReference Include="NUnit" Version="4.3.2" />
<PackageReference Include="NUnit.Analyzers" Version="4.7.0" />
<PackageReference Include="NUnit3TestAdapter" Version="5.0.0" />
<PackageReference Include="Respawn" Version="7.0.0" />
<PackageReference Include="StackExchange.Redis" Version="3.0.2-preview" />
<PackageReference Include="Testcontainers.PostgreSql" Version="4.11.0" />
<PackageReference Include="Testcontainers.Redis" Version="4.11.0" />
```

### 3.1 역할

| 패키지 | 용도 |
|--------|------|
| `Microsoft.AspNetCore.Mvc.Testing` | `WebApplicationFactory<Program>` 기반 API 부팅 |
| `Testcontainers.PostgreSql` | 테스트 전용 PostgreSQL 컨테이너 |
| `Testcontainers.Redis` | 테스트 전용 Redis 컨테이너 |
| `Respawn` | 각 테스트 전 DB 상태 초기화 |
| `StackExchange.Redis` | Redis flush 및 연결 관리 |
| `Bogus` | 정상 요청 기본값 생성 |
| `FluentValidation` | 요청/응답 계약 타입 참조 시 사용 |
| `coverlet.collector` | 코드 커버리지 수집 |

---

## 4. 테스트 호스트와 초기화 규칙

### 4.1 전역 초기화

전역 초기화는 `[SetUpFixture]`를 사용한다.

```csharp
[SetUpFixture]
public sealed class ApiIntegrationGlobalSetup
{
    [OneTimeSetUp]
    public Task SetUp() => ApiIntegrationTestHost.InitializeAsync();

    [OneTimeTearDown]
    public Task TearDown() => ApiIntegrationTestHost.DisposeAsync().AsTask();
}
```

규칙:

- 테스트 런 전체에서 공용 호스트는 한 번만 초기화한다
- 컨테이너 시작, 마이그레이션, 앱 부팅은 `ApiIntegrationTestHost`에만 둔다
- 테스트 클래스가 직접 컨테이너를 만들거나 dispose하지 않는다

### 4.2 공용 테스트 호스트

공용 호스트는 `TestSupport/ApiIntegrationTestHost.cs`가 담당한다.

역할:

- PostgreSQL 컨테이너 시작
- Redis 컨테이너 시작
- 테스트용 설정값 조립
- 마이그레이션 실행
- `CloudSharpApiFactory` 생성
- 테스트 간 DB/Redis 초기화

### 4.3 앱 부팅 방식

API는 `CloudSharpApiFactory : WebApplicationFactory<Program>`로 부팅한다.

규칙:

- 환경은 `Development`로 고정한다
- 테스트 설정은 `AddInMemoryCollection(...)`으로 주입한다
- 테스트는 운영 설정 파일을 직접 수정하지 않는다

### 4.4 데이터베이스와 Redis 초기화

DB와 Redis는 테스트마다 깨끗해야 한다.

규칙:

- PostgreSQL은 Testcontainers로 실제 컨테이너를 띄운다
- Redis도 Testcontainers로 실제 컨테이너를 띄운다
- DB schema는 앱 시작 전에 마이그레이션으로 만든다
- DB reset은 Respawn으로 수행한다
- Respawn reset 대상에서 `__EFMigrationsHistory`는 제외한다
- Redis는 각 테스트 전 `FlushAllDatabasesAsync()`로 비운다

이 프로젝트의 테스트는 **실제 PostgreSQL/Redis와 통신하므로 유닛 테스트가 아니다.**

---

## 5. 테스트 클래스 구조

### 5.1 기본 클래스 규칙

API 통합 테스트 클래스는 다음 패턴을 따른다.

```csharp
[TestFixture]
[Category("ApiIntegration")]
public sealed class RegisterEndpointTests : IntegrationTestBase
{
}
```

규칙:

- 클래스에는 `[TestFixture]`를 붙인다
- 클래스에는 `[Category("ApiIntegration")]`를 붙인다
- 공통 베이스 클래스는 `IntegrationTestBase`를 상속한다
- `sealed`를 기본값으로 사용한다

### 5.2 `IntegrationTestBase` 사용 규칙

`IntegrationTestBase`는 다음 공용 기능을 제공한다.

- `[SetUp]`에서 `ResetStateAsync()` 호출
- `CreateClient()`로 테스트용 `HttpClient` 생성
- `ExecuteDbContextAsync(...)`로 DB side effect 조회

규칙:

- 각 테스트는 독립적이어야 하며 이전 테스트 상태에 의존하지 않는다
- 테스트 코드에서 직접 서비스 스코프를 열기보다 `ExecuteDbContextAsync(...)`를 우선 사용한다
- 테스트 시작 시 상태 리셋은 베이스 클래스에만 둔다

### 5.3 파일/폴더 배치

테스트 파일은 기능별 폴더 아래에 둔다.

예시:

```text
Auth/RegisterEndpointTests.cs
Health/HealthEndpointTests.cs
```

규칙:

- 기능 단위 폴더를 사용한다
- 파일명은 `*EndpointTests.cs` 패턴을 따른다
- `TestSupport/`에는 fixture, host, factory, JSON helper, request factory만 둔다

---

## 6. HttpClient 규칙

클라이언트는 반드시 `CreateClient()`로 생성한다.

기본 옵션:

- `AllowAutoRedirect = false`
- `HandleCookies = false`
- `BaseAddress = https://localhost`

규칙:

- 테스트마다 `using var client = CreateClient();`로 새 클라이언트를 만든다
- 자동 리다이렉트를 끈 상태에서 실제 응답 status code를 검증한다
- 쿠키 자동 저장에 의존하지 않는다

---

## 7. 테스트 이름 규칙

메서드 이름은 결과 중심으로 작성한다.

기본 형식:

```text
EndpointOrAction_ShouldExpectedResult
```

예시:

```csharp
Register_ShouldReturnCreated
Register_ShouldReturnConflict
Register_ShouldReturnBadRequest
GetHealth_ShouldReturnOk
```

규칙:

- 조건보다 결과를 이름에 우선 반영한다
- 같은 기대 결과를 공유하는 입력 변화는 `[TestCaseSource]`로 표현한다
- 성공/실패는 한 메서드에 합치지 않는다

---

## 8. 검증 규칙

### 8.1 1차 검증은 HTTP 응답

모든 API 통합 테스트는 먼저 HTTP 응답을 검증한다.

```csharp
Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
```

규칙:

- 첫 assertion은 status code를 우선한다
- 디버깅이 어려운 엔드포인트는 응답 본문을 assertion 메시지에 포함해도 된다

예시:

```csharp
var responseBody = await response.Content.ReadAsStringAsync();

Assert.That(
    response.StatusCode,
    Is.EqualTo(HttpStatusCode.Created),
    $"Response body: {responseBody}");
```

### 8.2 성공 응답 검증

성공 응답은 DTO로 deserialize 한 뒤 필드를 검증한다.

규칙:

- `ReadFromJsonAsync<T>()`로 응답 DTO를 읽는다
- null 여부를 먼저 확인한다
- API 계약상 중요한 필드를 명시적으로 검증한다
- 토큰, 식별자, 만료시간처럼 계약상 의미 있는 값은 `Not.Empty`, `GreaterThan(0)` 등으로 검증한다

### 8.3 DB side effect 검증

성공 응답 뒤에 영속화 결과가 중요하면 DB를 직접 조회해 검증한다.

규칙:

- DB 확인은 `ExecuteDbContextAsync(...)`로 수행한다
- API 응답만으로 충분한 경우 DB 조회를 강제하지 않는다
- 단순 repository 구현 자체를 검증하려는 테스트는 이 프로젝트가 아니라 Infrastructure 테스트로 분리한다

### 8.4 실패 응답 검증

실패 응답은 `JsonElement`로 읽고 에러 코드 계약을 검증한다.

```csharp
var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.BadRequest));
Assert.That(problem.ValueKind, Is.EqualTo(JsonValueKind.Object));
Assert.That(problem.ExtractErrorCodes(), Does.Contain("AUTH_PASSWORD_INVALID"));
```

규칙:

- 실패는 문자열 메시지보다 `ErrorCode`를 우선 검증한다
- `JsonExtensions.ExtractErrorCodes()`를 공용 helper로 사용한다
- `ProblemDetails` 구조가 변해도 error code 계약은 유지되어야 한다

---

## 9. 입력 데이터 규칙

### 9.1 기본 요청 생성

정상 기본 요청은 `RequestFactories`에서 생성한다.

규칙:

- 테스트 본문에 Bogus 설정을 반복해서 쓰지 않는다
- 기본 요청은 factory/helper에 숨긴다
- 테스트에서는 필요한 값만 override 한다

예시:

```csharp
var request = RequestFactories.CreateRegisterRequest(
    email: "duplicate@example.com");
```

### 9.2 Bogus 사용 기준

Bogus는 **정상 기본 입력 생성**에만 사용한다.

권장:

- 랜덤하지만 유효한 email, username, display name 생성
- 테스트마다 충돌 가능성이 낮은 기본 요청 생성

지양:

- 경계값, 잘못된 입력, 정책 위반 값을 Bogus에 맡기기
- 어떤 조건이 깨졌는지 테스트에서 보이지 않게 만드는 것

즉, 경계값과 실패 조건은 테스트 코드에서 명시적으로 override 한다.

### 9.3 조건 표현 방식

같은 기대 결과를 공유하는 실패 입력은 `[TestCaseSource]`로 묶는다.

규칙:

- 요청 객체처럼 복잡한 입력은 `[TestCaseSource]`를 사용한다
- `SetName(...)`으로 실패 상황을 드러낸다
- 메서드 이름은 결과 중심으로 유지한다

---

## 10. 작성 예시

```csharp
[Test]
public async Task Register_ShouldReturnCreated()
{
    using var client = CreateClient();
    var request = RequestFactories.CreateRegisterRequest();

    using var response = await client.PostAsJsonAsync("/api/v1/auth/register", request);
    var responseBody = await response.Content.ReadAsStringAsync();

    Assert.That(
        response.StatusCode,
        Is.EqualTo(HttpStatusCode.Created),
        $"Response body: {responseBody}");

    var body = await response.Content.ReadFromJsonAsync<AuthResponse>();

    Assert.That(body, Is.Not.Null);
    Assert.That(body!.SessionToken, Is.Not.Empty);

    var savedUser = await ExecuteDbContextAsync(dbContext =>
        dbContext.Users.SingleOrDefaultAsync(user => user.Email == request.Email));

    Assert.That(savedUser, Is.Not.Null);
}
```

---

## 11. 금지하는 것

| 금지 항목 | 이유 |
|-----------|------|
| 테스트마다 컨테이너를 직접 만들기 | 초기화 규칙이 분산되고 실행 시간이 늘어난다 |
| 상태 초기화 없이 테스트 간 데이터 공유 | 순서 의존, flaky test 유발 |
| 실패를 메시지 문자열로만 검증 | 다국어/문구 변경에 취약 |
| 테스트 본문에 긴 fixture 생성 코드 작성 | 의도가 흐려지고 중복이 늘어난다 |
| API 통합 테스트에서 repository 내부 구현을 과하게 검증 | 테스트 책임이 흐려진다 |

---

## 12. 실행 명령

기본 경로:

```powershell
cd apps/backend
```

실행:

```powershell
dotnet test tests/CloudSharp.Api.IntegrationTests
```

주의사항:

- Docker/Testcontainers를 사용할 수 있어야 한다
- 로컬 Docker daemon이 실행 중이어야 한다
- 첫 실행 시 컨테이너 이미지 pull 때문에 시간이 더 걸릴 수 있다

---

## 13. PR 체크리스트

| 항목 | 확인 내용 |
|------|-----------|
| **분류** | `[Category("ApiIntegration")]`가 붙어 있는가 |
| **상속** | `IntegrationTestBase`를 사용하고 있는가 |
| **초기화** | 테스트 간 상태가 DB/Redis reset에 의존하도록 작성했는가 |
| **클라이언트** | `CreateClient()`를 사용했는가 |
| **성공 검증** | status code와 응답 DTO 계약을 검증했는가 |
| **실패 검증** | `ExtractErrorCodes()`로 에러 코드를 검증했는가 |
| **DB 검증** | 필요한 경우에만 `ExecuteDbContextAsync(...)`로 side effect를 확인했는가 |
| **데이터 생성** | `RequestFactories`를 사용하고 필요한 값만 override 했는가 |
| **실행** | `dotnet test tests/CloudSharp.Api.IntegrationTests`로 통과했는가 |

---

## 14. 요약

| 질문 | 답 |
|------|----|
| **어떤 테스트인가** | 실제 PostgreSQL/Redis + API 앱을 함께 띄우는 API 통합 테스트 |
| **호스트는 어떻게 띄우나** | `WebApplicationFactory<Program>` + `CloudSharpApiFactory` |
| **DB는 어떻게 초기화하나** | 마이그레이션 후 Respawn reset |
| **Redis는 어떻게 초기화하나** | 매 테스트 전 flush |
| **실패는 무엇으로 검증하나** | status code + error code |
| **정상 요청은 어떻게 만드나** | `RequestFactories` + 필요한 값만 override |
| **실행 명령은 무엇인가** | `dotnet test tests/CloudSharp.Api.IntegrationTests` |
