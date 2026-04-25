# UseCases 디렉토리 / 네임스페이스 정리

> 작성일: 2026-04-25
> 상태: 적용 완료

---

## 1. 목적

`CloudSharp.Core/UseCases` 아래 기능 파일 수가 증가하면서, Command / Query / Validator / Result / DTO를 같은 디렉토리에 평면적으로 두는 방식의 탐색 비용이 커졌다.

이번 작업의 목적은 다음 두 가지다.

1. 도메인별 파일 배치를 타입 기준으로 일관되게 정리한다.
2. 물리 디렉토리와 C# namespace를 동일한 규칙으로 맞춘다.

---

## 2. 적용 결과

기능 디렉토리는 다음 구조를 기본형으로 사용한다.

```text
CloudSharp.Core/
└── UseCases/
    └── Folders/
        ├── FolderUseCases.cs
        ├── IFolderUseCases.cs
        ├── Commands/
        ├── Queries/
        ├── Validators/
        ├── Results/
        ├── Dtos/
        └── Extensions/
```

규칙은 다음과 같다.

- 도메인 루트에는 `I{Domain}UseCases.cs`, `{Domain}UseCases.cs`를 둔다.
- 상태 변경 입력 모델은 `Commands/`에 둔다.
- 조회 입력 모델은 `Queries/`에 둔다.
- `FluentValidation` validator는 `Validators/`에 둔다.
- UseCase 반환 모델은 `Results/`에 둔다.
- 응답 조합용 내부 DTO는 `Dtos/`에 둔다.
- 내부 매핑/헬퍼 extension은 필요한 경우에만 `Extensions/`를 둔다.

---

## 3. 네임스페이스 규칙

디렉토리 구조와 namespace는 1:1 대응으로 맞춘다.

| 위치 | namespace |
|------|-----------|
| `{Feature}/I{Feature}UseCases.cs` | `CloudSharp.Core.UseCases.{Feature}` |
| `{Feature}/{Feature}UseCases.cs` | `CloudSharp.Core.UseCases.{Feature}` |
| `{Feature}/Commands/*` | `CloudSharp.Core.UseCases.{Feature}.Commands` |
| `{Feature}/Queries/*` | `CloudSharp.Core.UseCases.{Feature}.Queries` |
| `{Feature}/Validators/*` | `CloudSharp.Core.UseCases.{Feature}.Validators` |
| `{Feature}/Results/*` | `CloudSharp.Core.UseCases.{Feature}.Results` |
| `{Feature}/Dtos/*` | `CloudSharp.Core.UseCases.{Feature}.Dtos` |
| `{Feature}/Extensions/*` | `CloudSharp.Core.UseCases.{Feature}.Extensions` |

예시:

- `CreateFolderCommand` → `CloudSharp.Core.UseCases.Folders.Commands`
- `ListFolderChildrenQuery` → `CloudSharp.Core.UseCases.Folders.Queries`
- `FolderChildrenResult` → `CloudSharp.Core.UseCases.Folders.Results`
- `FolderChildDto` → `CloudSharp.Core.UseCases.Folders.Dtos`

---

## 4. 실제 반영 범위

### 4.1 구조 정리

다음 도메인은 실제 구현 파일을 새 구조로 이동했다.

- `Auth`
- `Files`
- `Folders`

다음 도메인은 이후 구현을 대비해 동일 골격만 먼저 생성했다.

- `Admin`
- `Downloads`
- `Members`
- `Quotas`
- `ShareLinks`
- `Spaces`
- `Uploads`

빈 디렉토리는 Git 추적 유지를 위해 타입별 하위 디렉토리에 `.gitkeep`을 둔다.

### 4.2 namespace 정리

실제 파일 이동 후 namespace도 동일 규칙으로 반영했다.

특히 `Auth` 도메인에는 기존에 섞여 있던 `CloudSharp.Core.UseCases.Users` namespace가 남아 있었는데, 이번 작업에서 다음처럼 정리했다.

- `UserRegisterCommand` → `CloudSharp.Core.UseCases.Auth.Commands`
- `UserRegisterCommandValidator` → `CloudSharp.Core.UseCases.Auth.Validators`
- `UserResult` → `CloudSharp.Core.UseCases.Auth.Results`
- `UserSessionPayload` → `CloudSharp.Core.UseCases.Auth.Dtos`

이에 따라 `Api`, `Infrastructure`, `tests`의 `using`도 함께 갱신했다.

---

## 5. 관련 문서 반영

이번 구조 변경에 맞춰 다음 문서도 함께 수정했다.

- `docs/.llm/conventions/command-query.md`
- `docs/.llm/conventions/validation.md`
- `docs/.llm/context/directory.md`
- `docs/.llm/wiki/decisions.md`

즉, 현재 기준 구조 문서와 컨벤션 문서가 실제 코드 배치와 일치한다.

---

## 6. 검증 결과

적용 후 다음 검증을 통과했다.

```bash
dotnet build
dotnet test
```

테스트 결과:

- `CloudSharp.Core.Tests`: 105 통과
- `CloudSharp.Infrastructure.Tests`: 11 통과
- `CloudSharp.Architecture.Tests`: 1 통과
- `CloudSharp.Api.IntegrationTests`: 8 통과

---

## 7. 유지 원칙

앞으로 새로운 UseCase 관련 파일을 추가할 때는 아래 원칙을 따른다.

1. 파일을 먼저 타입별 하위 디렉토리에 배치한다.
2. namespace는 물리 경로와 동일하게 맞춘다.
3. 루트 UseCases 클래스와 인터페이스만 도메인 루트 namespace를 유지한다.
4. 다른 계층에서 참조할 때는 더 이상 flat namespace를 가정하지 않는다.
5. 새 도메인을 시작할 때는 최소 `Commands/Queries/Validators/Results/Dtos` 골격부터 만든다.

---

## 8. 기대 효과

- 파일 탐색성이 좋아진다.
- 도메인별 규모가 커져도 평면 디렉토리 혼잡이 줄어든다.
- namespace만 봐도 파일 성격을 바로 알 수 있다.
- 리뷰 시 구조 규칙 위반을 더 쉽게 찾을 수 있다.
- 이후 MCP Console, Worker, API가 공통으로 참조하는 입력/출력 모델의 위치가 명확해진다.
