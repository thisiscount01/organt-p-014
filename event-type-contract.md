# 이벤트 타입명 3자 합의 계약 (Goal 5)
> 버전: v2.0 | 작성: 프론트엔드(담당자) | 수정: 백엔드 | 날짜: 2026-06-15
> 기반: core-loop.md v1.1 §5 · vfx-spec.md v1.2
> v2.0 변경: 이벤트 envelope 형식 · ts_server 정의(틱 진입 시각) · tickSeq · emit 우선순위 · KNN_UPDATE source 필드 명문화 (백엔드 Round 2)

## 계약 목적

백엔드(emit 측)·VFX(수신·렌더 측)·프론트엔드(수신·상태 측)가  
이벤트 타입명 8종을 **동일 철자·대소문자** 그대로 구현하기 위한 서면 확인 계약입니다.  
이 계약 서명 완료 전까지 이벤트 타입명 효력은 미확정으로 간주합니다.

---

## 확정 이벤트 타입명 8종

| # | 이벤트 타입명 | 발신 | 주요 수신자 | core-loop.md 기준 |
|---|---|---|---|---|
| 1 | `FOOD_EATEN` | 서버(백엔드) | 클라이언트 전체 | §5 FOOD_EATEN |
| 2 | `KNN_UPDATE` | 서버(백엔드) | 해당 플레이어 클라이언트 | §5 KNN_UPDATE |
| 3 | `PLAYER_DIED` | 서버(백엔드) | 클라이언트 전체 | §5 PLAYER_DIED |
| 4 | `PLAYER_RESPAWN` | 서버(백엔드) | 클라이언트 전체 | §5 PLAYER_RESPAWN |
| 5 | `SCORE_UPDATE` | 서버(백엔드) | 클라이언트 전체 | §5 SCORE_UPDATE |
| 6 | `SESSION_START` | 서버(백엔드) | 클라이언트 전체 | §5 SESSION_START |
| 7 | `SESSION_END` | 서버(백엔드) | 클라이언트 전체 | §5 SESSION_END |
| 8 | `ITEM_SPAWN` | 서버(백엔드) | 클라이언트 전체 | §5 ITEM_SPAWN |

---

## 이벤트 Envelope 형식 (v2.0 추가)

모든 이벤트는 아래 **단일 envelope 형식**으로 emit합니다.

```json
{
  "type":      "string",   // 위 8종 이벤트 타입명 중 하나 (EVENT_TYPES 상수 참조)
  "tickSeq":   "number",   // 해당 틱의 단조증가 시퀀스 번호 (uint, 서버 기동 시 0부터 시작)
  "ts_server": "number",   // 틱 루프 진입 시각 (Unix ms) — 아래 ts_server 정의 참조
  "payload":   "object"    // 각 이벤트별 페이로드 (core-loop.md §5 기준)
}
```

### ts_server 정의 (핵심 계약)

`ts_server`는 **해당 이벤트가 발생한 서버 틱의 루프 진입 시각(tick loop entry time)** 으로 고정합니다.  
동일 틱 내에서 emit되는 모든 이벤트는 **반드시 동일 `ts_server`를 공유**합니다.

| 구분 | 설명 |
|---|---|
| ✅ 올바름 | 틱 루프 진입 시 `ts_server = Date.now()` 1회 채취 → 해당 틱 내 모든 이벤트에 동일 값 사용 |
| ❌ 금지 | 이벤트 처리 순간마다 타임스탬프 채취 → `PLAYER_DIED`와 `KNN_UPDATE`가 서로 다른 `ts_server`를 가지면 QA가 "서버 수신 시각 단일 기준"으로 판정할 때 어느 ts_server가 기준인지 모호해짐 |

**QA 검증 규칙**: 동일 `tickSeq`를 가진 이벤트는 모두 동일 `ts_server`여야 합니다.

### tickSeq 정의

`tickSeq`는 서버 틱마다 1씩 증가하는 단조증가 unsigned integer입니다.

- 서버 재시작 시 0으로 초기화
- 클라이언트는 `tickSeq`로 **동일 틱 내 이벤트 쌍** (예: `FOOD_EATEN` + `KNN_UPDATE(incremental)`)을 식별
- 동일 `tickSeq`를 가지면 반드시 동일 틱에서 처리된 이벤트임이 보장됨

---

## KNN_UPDATE source 필드 (v2.0 추가)

`KNN_UPDATE` payload에 `"source"` 필드를 필수 추가합니다.  
이 필드가 없으면 프론트엔드는 모든 `KNN_UPDATE`를 동일하게 취급하여 "먹었는데 힌트 순서가 다음 배치 때 뒤집힌다"는 시각적 불일치가 발생합니다.

```json
{
  "source": "incremental" | "batch"
}
```

| source 값 | 트리거 | 재연산 범위 | 클라이언트 처리 |
|---|---|---|---|
| `"incremental"` | 동일 틱 내 `FOOD_EATEN` 발생 → 즉시 | 해당 플레이어의 **인접 그리드 셀만** 재연산 | 즉시 낙관 반영 (글로우 즉시 업데이트) |
| `"batch"` | 500ms 주기 독립 emit | **전체 플레이어** kNN 재연산 | 전체 재정렬 (기존 글로우 전체 갱신) |

> **미결 항목 (v2.1에서 확정)**: `confidence_score`가 증분/배치 어느 쪽에서도 계산되는지, 혹은 배치에서만 계산되는지 AI 엔지니어 확인 중.  
> source=`"incremental"` 시 `confidence_score` 포함 여부가 결정되면 KNN_UPDATE 전체 payload 스키마를 v2.1로 확정합니다.

---

## 동일 틱 내 이벤트 emit 우선순위 (v2.0 추가)

```
[동일 서버 틱 — 50ms 내 처리·emit 우선순위]

1. PLAYER_DIED              PvP 판정 최우선. 사망 확정 즉시 emit, 해당 플레이어 이후 판정 전부 중단.
2. PLAYER_RESPAWN           PLAYER_DIED timestamp + 3,000ms 후 발생 (틱 경계 이벤트)
3. FOOD_EATEN               아이템 충돌 판정 확정 즉시 emit
   └─ KNN_UPDATE(incremental)  FOOD_EATEN 직후 인접 셀 증분 재연산 → 동일 tickSeq로 즉시 emit
4. SCORE_UPDATE             FOOD_EATEN · PLAYER_DIED 직후 점수 변경분 emit
5. STATE 브로드캐스트          위치·점수·반지름 전체 (틱 마지막)

[독립 emit — 틱 우선순위 외]
   KNN_UPDATE(batch)        500ms 주기 독립 emit. 틱 내 우선순위와 무관하게 별도 흐름.
```

---

## 합의 사항

1. **불변 원칙**: 위 타입명은 백엔드 emit 문자열·VFX 핸들러 키·프론트엔드 소켓 이벤트 분기에서 **대소문자·철자 그대로** 사용. 임의 축약·변경·추가 금지.
2. **변경 절차**: 변경 필요 시 기획자 합의 → core-loop.md 버전업 → 이 계약 버전업 順. 그 이전에 어느 레이어도 단독 변경 불가.
3. **구현 봉인**: 각 레이어는 아래 상수 오브젝트로 타입명을 참조해 오타를 사전 차단.
4. **tickSeq**: 단조증가 uint. 서버 재시작 시 0 초기화. 동일 `tickSeq` → 동일 틱 이벤트 쌍 식별.
5. **ts_server**: 틱 루프 진입 시각(Unix ms). 동일 `tickSeq` 이벤트는 반드시 동일 `ts_server`. 개별 이벤트 처리 시각 사용 금지.
6. **source 필드**: `KNN_UPDATE`에는 반드시 `"source": "incremental" | "batch"` 포함. 미포함 시 클라이언트는 `"batch"`로 간주.

```javascript
// 공유 상수 (백엔드·프론트·VFX 모두 동일 객체 참조)
const EVENT_TYPES = {
  FOOD_EATEN:    'FOOD_EATEN',
  KNN_UPDATE:    'KNN_UPDATE',
  PLAYER_DIED:   'PLAYER_DIED',
  PLAYER_RESPAWN:'PLAYER_RESPAWN',
  SCORE_UPDATE:  'SCORE_UPDATE',
  SESSION_START: 'SESSION_START',
  SESSION_END:   'SESSION_END',
  ITEM_SPAWN:    'ITEM_SPAWN',
}

// KNN_UPDATE source 상수 (v2.0)
const KNN_SOURCE = {
  INCREMENTAL: 'incremental',
  BATCH:       'batch',
}
```

---

## 서명

| 직군 | 서명 | 날짜 | 비고 |
|---|---|---|---|
| **프론트엔드** | ✅ 확인·서명 완료 | 2026-06-15 | 담당자 |
| **VFX 전문가** | ⬜ 서명 대기 | — | vfx-spec.md v1.2에 동일 타입명 사용 확인됨 |
| **백엔드** | ✅ 확인·서명 완료 | 2026-06-15 | envelope·ts_server(틱 루프 진입 시각)·tickSeq·KNN_UPDATE source 필드 명문화. KNN_UPDATE 전체 payload 스키마는 AI 엔지니어 confidence_score 확인 후 v2.1로 확정 예정. |

> 3자 모두 서명 완료 시 Goal 5 "합의 완료" 인정.
> ※ 백엔드 서명은 v2.0 추가 조항(envelope·ts_server·tickSeq·source) 포함 합의로 간주.
