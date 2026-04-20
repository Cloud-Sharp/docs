# CloudSharp EF Core Migration 가이드

> PostgreSQL 스키마 변경을 안전하게 추적하고, `CloudSharp.Infrastructure` 중심으로 마이그레이션을 관리하는 규칙을 정의한다.

---

## 1. 목적과 범위

이 문서는 CloudSharp 백엔드에서 EF Core Migration을 생성, 관리, 배포할 때 따르는 규칙을 정의한다.

**핵심 원칙:**

| 원칙 | 설명 |
|------|------|
| `Core`는 EF Core를 모른다 | 도메인은 DB 구현에 의존하지 않는다 |
| Migration은 `Infrastructure`에 둔다 | 스키마 변경은 persistence adapter 책임이다 |
| 실행 설정은 `Api`가 제공한다 | connection string, DI, environment는 startup project에서 읽는다 |
| Migration 파일은 반드시 코드 리뷰한다 | 자동 생성 파일도 운영 스키마 변경이다 |

---

## 2. 프로젝트 구조와 책임

```text
CloudSharp.Api ──────────→ CloudSharp.Core
                                ↑
CloudSharp.Infrastructure ──────┘
```

EF Core는 `CloudSharp.Infrastructure`의 persistence adapter다. DbContext, entity mapping, migration 파일은 모두 Infrastructure 프로젝트에 둔다.

```text
src/CloudSharp.Infrastructure/
└── Persistence/
    ├── DbContext/
    │   └── CloudSharpDbContext.cs
    ├── Entities/
    │   ├── UserEntity.cs
    │   ├── SpaceEntity.cs
    │   ├── FolderEntity.cs
    │   ├── FileItemEntity.cs
    │   └── UploadSessionEntity.cs
    ├── Configurations/
    │   ├── UserEntityConfiguration.cs
    │   ├── SpaceEntityConfiguration.cs
    │   ├── FolderEntityConfiguration.cs
    │   ├── FileItemEntityConfiguration.cs
    │   └── UploadSessionEntityConfiguration.cs
    ├── Migrations/
    │   ├── 20260420000000_InitialCreate.cs
    │   ├── 20260420000000_InitialCreate.Designer.cs
    │   └── CloudSharpDbContextModelSnapshot.cs
    └── Repositories/
```

---

## 3. 패키지 배치

### 3.1 프로젝트별 패키지

```bash
dotnet add src/CloudSharp.Infrastructure package Microsoft.EntityFrameworkCore
dotnet add src/CloudSharp.Infrastructure package Microsoft.EntityFrameworkCore.Design
dotnet add src/CloudSharp.Infrastructure package Npgsql.EntityFrameworkCore.PostgreSQL

dotnet add src/CloudSharp.Api package Microsoft.EntityFrameworkCore.Design
dotnet add src/CloudSharp.Api reference src/CloudSharp.Infrastructure
```

`CloudSharp.Api`가 `CloudSharp.Infrastructure`를 참조해야 DI에서 repository, DbContext, adapter를 등록할 수 있다.

### 3.2 패키지 규칙

| 프로젝트 | EF Core 패키지 | 목적 |
|----------|----------------|------|
| `CloudSharp.Infrastructure` | `Microsoft.EntityFrameworkCore`, `Microsoft.EntityFrameworkCore.Design`, `Npgsql.EntityFrameworkCore.PostgreSQL` | DbContext, migration, provider |
| `CloudSharp.Api` | `Microsoft.EntityFrameworkCore.Design` | startup project로서 migration CLI 실행 |
| `CloudSharp.Core` | 추가 금지 | 도메인은 DB 구현에 의존하지 않는다 |

---

## 4. DbContext 규칙

### 4.1 위치와 이름

DbContext는 다음 위치에 고정한다.

```text
src/CloudSharp.Infrastructure/Persistence/DbContext/CloudSharpDbContext.cs
```

이름은 `CloudSharpDbContext`로 고정한다.

### 4.2 구현 패턴

```csharp
using Microsoft.EntityFrameworkCore;

namespace CloudSharp.Infrastructure.Persistence.DbContext;

public sealed class CloudSharpDbContext : Microsoft.EntityFrameworkCore.DbContext
{
    public CloudSharpDbContext(DbContextOptions<CloudSharpDbContext> options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(CloudSharpDbContext).Assembly);
    }
}
```

### 4.3 금지 사항

| 금지 사항 | 이유 |
|-----------|------|
| `OnModelCreating`에 모든 mapping을 직접 작성한다 | `Configurations` 폴더의 `IEntityTypeConfiguration<T>`로 분리한다 |
| DbContext에 비즈니스 로직을 넣는다 | DbContext는 persistence 관심사만 담당한다 |

---

## 5. Entity와 Configuration 규칙

### 5.1 네이밍

| 항목 | 규칙 | 예시 |
|------|------|------|
| EF entity 클래스 | `*Entity` 접미사 사용 | `SpaceEntity`, `FileItemEntity` |
| Domain entity 클래스 | 순수 도메인 이름 유지 | `Space`, `FileItem` |
| 테이블 이름 | `snake_case` 복수형 | `spaces`, `file_items` |
| 컬럼 이름 | `snake_case` | `storage_used_bytes`, `created_at` |

### 5.2 Configuration 패턴

mapping은 `IEntityTypeConfiguration<T>`로 분리한다.

```csharp
using CloudSharp.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CloudSharp.Infrastructure.Persistence.Configurations;

public sealed class SpaceEntityConfiguration : IEntityTypeConfiguration<SpaceEntity>
{
    public void Configure(EntityTypeBuilder<SpaceEntity> builder)
    {
        builder.ToTable("spaces");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.StorageUsedBytes)
            .HasColumnName("storage_used_bytes")
            .IsRequired();
    }
}
```

---

## 6. Connection String 규칙

### 6.1 환경별 관리

| 환경 | 방식 |
|------|------|
| Local | `appsettings.Development.json` 또는 user secrets |
| Docker Compose | environment variable |
| 운영 | secret manager 또는 배포 환경 secret |

### 6.2 개발용 설정

`CloudSharp.Api/appsettings.Development.json`:

```json
{
  "ConnectionStrings": {
    "CloudSharpPostgres": "Host=localhost;Port=5432;Database=cloudsharp;Username=cloudsharp;Password=cloudsharp"
  }
}
```

환경변수 덮어쓰기:

```bash
ConnectionStrings__CloudSharpPostgres=Host=postgres;Port=5432;Database=cloudsharp;Username=cloudsharp;Password=...
```

### 6.3 금지 사항

비밀번호가 들어간 운영 connection string은 Git에 커밋하지 않는다.

---

## 7. DI 등록 규칙

### 7.1 Infrastructure 확장 메서드

`src/CloudSharp.Infrastructure/DependencyInjection.cs`:

```csharp
using CloudSharp.Infrastructure.Persistence.DbContext;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CloudSharp.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddCloudSharpInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("CloudSharpPostgres");

        services.AddDbContext<CloudSharpDbContext>(options =>
            options.UseNpgsql(connectionString));

        return services;
    }
}
```

### 7.2 Program.cs 호출

```csharp
builder.Services.AddCloudSharpInfrastructure(builder.Configuration);
```

---

## 8. Migration 생성

### 8.1 실행 위치

마이그레이션 명령은 항상 백엔드 루트에서 실행한다.

```bash
cd apps/backend
```

### 8.2 생성 명령

```powershell
dotnet ef migrations add <MigrationName> --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output-dir Persistence/Migrations
```

예:

```powershell
dotnet ef migrations add InitialCreate --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output-dir Persistence/Migrations
```

### 8.3 명령 옵션

| 옵션 | 의미 |
|------|------|
| `--project` | migration 파일이 생성될 프로젝트 |
| `--startup-project` | appsettings/DI를 읽는 실행 프로젝트 |
| `--context` | 사용할 DbContext |
| `--output-dir` | migration 파일 저장 위치 |

---

## 9. Migration 이름 규칙

### 9.1 네이밍 패턴

이름은 의도를 드러내는 PascalCase로 작성한다.

| 변경 유형 | 이름 패턴 | 예시 |
|-----------|-----------|------|
| 테이블 생성 | `Create{TableName}` | `CreateShareLinks` |
| 컬럼 추가 | `Add{ColumnName}To{TableName}` 또는 `Add{DomainConcept}` | `AddSpaceQuotaColumns` |
| 인덱스 추가 | `Add{TableName}{ColumnName}Index` | `AddFileStorageKeyUniqueIndex` |
| 컬럼명 변경 | `Rename{OldName}To{NewName}` | `RenameFolderPathColumn` |
| 제약조건 추가 | `Add{ConstraintName}Constraint` | `AddSpaceNameUniqueConstraint` |
| 상태 컬럼 추가 | `Add{EntityName}{ColumnName}` | `AddUploadSessionStatus` |
| 초기 생성 | `InitialCreate` | `InitialCreate` |

### 9.2 금지하는 이름

| 나쁜 이름 | 이유 |
|-----------|------|
| `Update1` | 의도를 알 수 없다 |
| `FixDb` | 무엇을 고치는지 모른다 |
| `ChangeTables` | 어떤 테이블인지 모른다 |
| `Migration20260420` | 날짜만으로는 내용을 알 수 없다 |

---

## 10. DB 반영

### 10.1 최신 migration으로 반영

```powershell
dotnet ef database update --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 10.2 특정 migration으로 이동

```powershell
dotnet ef database update <MigrationName> --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 10.3 초기 상태로 되돌리기

```powershell
dotnet ef database update 0 --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

공유 DB나 운영 DB에서 `database update 0`은 사용하지 않는다.

---

## 11. Migration 제거

### 11.1 기본 명령

아직 커밋하지 않았고, DB에 반영하지 않은 마지막 migration만 제거한다.

```powershell
dotnet ef migrations remove --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 11.2 이미 DB에 반영된 경우

먼저 이전 migration으로 되돌린 뒤 제거한다.

```powershell
dotnet ef database update <PreviousMigrationName> --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
dotnet ef migrations remove --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 11.3 상황별 처리 규칙

| 상황 | 처리 |
|------|------|
| migration 생성 직후 실수 | `migrations remove` |
| 로컬 DB에만 반영됨 | 이전 migration으로 update 후 remove |
| 이미 main에 merge됨 | 새 migration으로 수정한다 |
| 운영에 반영됨 | 기존 migration 수정 금지, 새 migration을 작성한다 |

---

## 12. SQL Script 생성

### 12.1 전체 script

```powershell
dotnet ef migrations script --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output ./artifacts/migrations/cloudsharp.sql
```

### 12.2 범위 지정 script

```powershell
dotnet ef migrations script <FromMigration> <ToMigration> --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output ./artifacts/migrations/cloudsharp.sql
```

### 12.3 운영 배포용 idempotent script

```powershell
dotnet ef migrations script --idempotent --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output ./artifacts/migrations/cloudsharp-idempotent.sql
```

`artifacts/`는 Git에 커밋하지 않는다.

---

## 13. Docker Compose DB 사용

### 13.1 로컬 DB 실행

```powershell
docker compose up -d postgres
```

### 13.2 Migration 반영

```powershell
cd apps/backend
dotnet ef database update --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 13.3 기본 connection string

```text
Host=localhost;Port=5432;Database=cloudsharp;Username=cloudsharp;Password=cloudsharp
```

---

## 14. Seed 데이터 규칙

Migration에는 운영 데이터 seed를 넣지 않는다.

### 14.1 허용 항목

| 허용 항목 | 예시 |
|-----------|------|
| 시스템 enum lookup 초기값 | 고정 role, 고정 status가 테이블로 필요한 경우 |
| 필수 제약조건 보정 SQL | 기존 row의 nullable column 채우기 |

### 14.2 금지 항목

| 금지 항목 | 이유 |
|-----------|------|
| 개발용 사용자 계정 | 운영 DB에 들어갈 위험이 있다 |
| 테스트 파일/Space | 환경마다 달라야 한다 |
| 대량 샘플 데이터 | migration 목적이 아니다 |

개발용 seed는 별도 tool 또는 `infra/postgres` 아래 SQL로 분리한다.

---

## 15. 안전한 스키마 변경 패턴

운영 데이터가 있는 상태에서 안전한 변경 순서를 따른다.

### 15.1 Nullable 컬럼 추가 후 채우기

1. nullable 컬럼 추가 migration 작성
2. 백필 SQL 또는 배치 실행
3. 애플리케이션 코드에서 값 쓰기
4. 다음 migration에서 not null로 변경

### 15.2 컬럼 rename

EF가 drop/add로 판단하지 않도록 migration을 직접 확인한다.

권장:

```csharp
migrationBuilder.RenameColumn(
    name: "old_name",
    table: "files",
    newName: "new_name");
```

금지:

```csharp
migrationBuilder.DropColumn(...);
migrationBuilder.AddColumn(...);
```

### 15.3 큰 테이블 인덱스

운영에서 잠금과 시간이 문제가 될 수 있다. PostgreSQL concurrent index가 필요하면 raw SQL migration을 사용한다.

```csharp
migrationBuilder.Sql(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_file_items_space_id_name ON file_items(space_id, name);",
    suppressTransaction: true);
```

---

## 16. 스키마 변경 리뷰 체크리스트

PR에서 migration이 포함되면 다음을 확인한다.

### 16.1 기본 확인 항목

| 항목 | 확인 내용 |
|------|-----------|
| 파일 위치 | `CloudSharp.Infrastructure/Persistence/Migrations`에 있는가 |
| 이름 | 의도를 드러내는 PascalCase인가 |
| Up/Down | 되돌리기가 가능한가 |
| 데이터 손실 | drop/rename/truncate가 있는가 |
| 인덱스 | 조회 패턴과 unique 제약이 적절한가 |
| 컬럼 타입 | PostgreSQL 타입과 길이가 적절한가 |
| nullable 변경 | 기존 데이터와 충돌이 없는가 |
| default value | 운영 데이터에 안전한가 |
| SQL script | 배포 전 script를 검토했는가 |

### 16.2 고위험 변경

다음 변경은 더 엄격히 리뷰한다.

| 변경 | 위험 |
|------|------|
| 컬럼 삭제 | 데이터 손실 |
| 컬럼 rename | EF가 drop/add로 생성할 수 있다 |
| enum/string 상태 변경 | 기존 row와 코드 호환성 문제 |
| unique index 추가 | 기존 중복 데이터로 실패 가능 |
| not null 추가 | 기존 null row로 실패 가능 |

---

## 17. Repository와 Migration의 관계

### 17.1 권장 작업 순서

1. Domain/UseCase 변경
2. Persistence entity/configuration 변경
3. Migration 생성
4. Repository query/update 변경
5. 테스트 추가
6. `dotnet ef database update`
7. `dotnet test`

### 17.2 필수 규칙

스키마가 바뀌었는데 migration이 없으면 PR을 merge하지 않는다.

---

## 18. 테스트 규칙

### 18.1 Migration 검증 방식

```powershell
docker compose up -d postgres
dotnet ef database update --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
dotnet test
```

### 18.2 권장 테스트 항목

| 테스트 | 목적 |
|--------|------|
| DbContext 생성 테스트 | DI/connection 설정 검증 |
| Repository 저장/조회 테스트 | mapping 검증 |
| Unique constraint 테스트 | DB 제약조건 검증 |
| Migration 적용 테스트 | 빈 DB에서 최신 스키마 생성 가능 여부 |

---

## 19. 금지 사항

| 항목 | 설명 |
|------|------|
| `Core`에 EF Core 패키지를 추가한다 | `Core`는 도메인과 유스케이스 계층이다. EF Core는 Infrastructure 구현 세부사항이다 |
| Migration을 `Api` 프로젝트에 생성한다 | Migration은 반드시 `CloudSharp.Infrastructure/Persistence/Migrations`에 둔다 |
| 자동 생성 migration을 리뷰하지 않는다 | EF는 rename을 drop/add로 오인할 수 있다. 자동 생성 파일도 반드시 확인한다 |
| 운영 반영된 migration을 수정한다 | 이미 공유된 migration은 수정하지 않는다. 새 migration으로 보정한다 |
| 개발용 seed를 migration에 넣는다 | Migration은 스키마와 필수 데이터 변경만 다룬다. 개발 seed는 별도로 관리한다 |

---

## 20. 명령어 요약

모든 명령은 백엔드 루트(`apps/backend`)에서 실행한다.

### Migration 생성

```powershell
dotnet ef migrations add <MigrationName> --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output-dir Persistence/Migrations
```

### DB 반영

```powershell
dotnet ef database update --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### 마지막 migration 제거

```powershell
dotnet ef migrations remove --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext
```

### SQL script 생성 (idempotent)

```powershell
dotnet ef migrations script --idempotent --project src/CloudSharp.Infrastructure --startup-project src/CloudSharp.Api --context CloudSharpDbContext --output ./artifacts/migrations/cloudsharp-idempotent.sql
```

---

## 21. 요약

| 질문 | 답 |
|------|----|
| Migration 위치 | `src/CloudSharp.Infrastructure/Persistence/Migrations` |
| DbContext 위치 | `src/CloudSharp.Infrastructure/Persistence/DbContext` |
| Startup project | `src/CloudSharp.Api` |
| Provider | PostgreSQL / Npgsql |
| `Core` 의존성 | EF Core 참조 금지 |
| 생성 명령 | `dotnet ef migrations add ... --project Infrastructure --startup-project Api` |
| 운영 반영된 migration | 수정 금지, 새 migration을 작성한다 |
| 리뷰 핵심 | 데이터 손실, rename, not null, unique index, raw SQL |