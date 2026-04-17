# Cloud# Space 기반 파일 저장 전략

---

## 핵심 개념

```
┌─────────────────────────────────────────────────────────┐
│  사용자가 보는 경로 (논리)    →   /프로젝트 문서/기획안.pdf    │
│  실제 저장 경로 (물리)       →   spaces/ab/{spaceId}/      │
│                                  objects/cd/ef/{fileKey}.bin │
└─────────────────────────────────────────────────────────┘
```

> **논리 경로와 물리 경로를 완전히 분리**하여 유연성을 확보한다.

---

## 1. 설계 원칙 3가지

| 원칙 | 설명 |
|------|------|
| **Space = 논리 테넌트** | 권한·협업·공유의 기준. 버킷과 1:1 매핑하지 않음 |
| **Bucket = 물리 저장 단위** | 공용 버킷 1~소수개만 사용. Space는 prefix로 분리 |
| **Storage Key = 공통 식별자** | Local FS에서는 경로, S3/MinIO에서는 object key로 해석 |

---

## 2. 최종 저장 경로 규칙

```
spaces/{spaceShard}/{spaceId}/objects/{fileShard1}/{fileShard2}/{fileKey}.bin
```

### 각 요소 설명

![[Gemini_Generated_Image_7u82kc7u82kc7u82.png]]

| 요소           | 생성 방식                  | 목적                   | 분산 범위 |
| ------------ | ---------------------- | -------------------- | ----- |
| `spaceShard` | `sha256(spaceId)[0:2]` | Space 루트 디렉터리 분산     | 256개  |
| `spaceId`    | UUID                   | Space 논리 식별          | -     |
| `fileShard1` | `sha256(fileKey)[0:2]` | Space 내부 파일 분산 (1단계) | 256개  |
| `fileShard2` | `sha256(fileKey)[2:4]` | Space 내부 파일 분산 (2단계) | 256개  |
| `fileKey`    | UUID / content hash    | 물리 저장 객체 식별          | -     |

---

## 3. 버킷 전략

### ✅ 채택: 공용 버킷 + prefix 분리

```
bucket = files
key    = spaces/ab/{spaceId}/objects/cd/ef/{fileKey}.bin
```

### ❌ 미채택: Space당 버킷 1개

| 공용 버킷 방식 (채택) | Space당 버킷 방식 (미채택) |
|----------------------|--------------------------|
| 버킷 수 최소화 | 버킷 수가 Space 수만큼 증가 |
| 정책 관리 단순 | lifecycle/notification 관리 복잡 |
| Local FS와 구조 일관 | Local FS 매핑 어려움 |
| 권한은 DB/API에 집중 | 권한이 스토리지 계층으로 누출 |

---

## 4. Sharding 전략

### 왜 필요한가?

```
❌ 분산 없음                    ✅ shard 분산
objects/file1.bin              objects/ab/cd/filekey1.bin
objects/file2.bin              objects/91/2f/filekey2.bin
objects/file3.bin              objects/00/7a/filekey3.bin
... (수십만 개 집중)            ... (256 × 256 = 65,536 버킷으로 분산)
```

### 2단계 분리 구조

```
┌─────────────────────────────────────────┐
│         Space Shard (상위 분산)           │
│  spaces/ 아래 256개 디렉터리로 분산        │
│  → Space 수가 많아져도 과밀 방지           │
├─────────────────────────────────────────┤
│         File Shard (하위 분산)            │
│  objects/ 아래 256×256 = 65,536개로 분산   │
│  → 대형 Space의 대량 파일에도 대응          │
└─────────────────────────────────────────┘
```

### hex shard 선택 이유

- 해시값과 자연스럽게 연결
- 추가 변환 규칙 불필요
- 계산 단순
- content-addressed storage 패턴과 일치

---

## 5. Storage Provider 추상화

### DB 메타데이터 필드

```
storage_provider   = "local" | "minio" | "s3"
bucket_name        = "files"
storage_key        = "spaces/ab/{spaceId}/objects/cd/ef/{fileKey}.bin"
size_bytes         = 1048576
checksum_sha256    = "a1b2c3..."
```

### Provider별 해석

```
┌──────────────┬──────────────────────────────────────────────┐
│  Local FS    │  /data/storage/{storage_key}                  │
│              │  → /data/storage/spaces/ab/.../fileKey.bin     │
├──────────────┼──────────────────────────────────────────────┤
│  MinIO / S3  │  bucket = files                               │
│              │  key    = {storage_key}                        │
│              │  → spaces/ab/.../fileKey.bin                   │
└──────────────┴──────────────────────────────────────────────┘
```

> **동일한 storage_key**를 경로로도, object key로도 사용 가능

---

## 6. 업로드 파이프라인

### Local FS 사용 시

```
Client ──→ tusd (filestore) ──→ Local FS (최종 저장)
```

### S3/MinIO 사용 시

```
Client ──→ tusd (s3store) ──→ S3/MinIO (최종 저장)
```

### ❌ 피해야 할 구조

```
Client → tusd(local temp) → 완료 → S3 복사   ← 디스크 I/O 이중 발생
```

---

## 7. 마이그레이션 전략 (Local → S3/MinIO)

```
단계 1  │  DB에 storage_provider + storage_key 유지
│
단계 2  │  신규 업로드 → MinIO/S3에 저장
│
단계 3  │  기존 Local 파일 → 백그라운드 worker가 순차 복사
│
단계 4  │  검증 완료 → DB의 storage_provider 변경
│
단계 5  │  유예 기간 후 Local 파일 삭제
```

> **무중단 전환** 가능. storage_key는 변경 없이 provider만 교체

---

## 최종 정리

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloud# 저장 전략 요약                      │
├──────────────────┬──────────────────────────────────────────┤
│  논리 구조        │  Space > Folder > FileItem               │
│  물리 저장 key    │  spaces/{shard}/{id}/objects/{s1}/{s2}/  │
│                  │  {fileKey}.bin                            │
│  버킷 전략        │  공용 버킷 + prefix 분리                   │
│  분산 전략        │  hex shard (Space 2자리 + File 2+2자리)   │
│  Provider 추상화  │  local / minio / s3 교체 가능             │
│  업로드           │  tusd + provider별 store 직접 연결         │
│  마이그레이션      │  storage_key 유지, provider만 전환         │
└──────────────────┴──────────────────────────────────────────┘
```

**달성하는 것들:**

- ✅ Space 중심 권한 모델 유지
- ✅ Local FS ↔ S3/MinIO 공통 구조
- ✅ 디렉터리/prefix 과밀 방지 (65,536개 버킷 분산)
- ✅ 무중단 마이그레이션
- ✅ 대형 Space · 대량 파일 대응
- ✅ tus 업로드와 자연스러운 결합