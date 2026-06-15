# RAG AI 응답 스키마 서면 합의 계약 (Goal 2)
> 버전: v1.0 | 작성: 프론트엔드(담당자) | 날짜: 2026-06-15
> 기반: core-loop.md v1.1 §4

## 계약 목적

AI 엔지니어(RAG 응답 생성)와 백엔드(스키마 검증·중계)가  
`core-loop.md §4`의 RAG AI 응답 스키마를 **구현 계약 기준**으로 서면 합의합니다.  
이 계약 양자 서명 완료 전까지 RAG 응답 스키마의 구현 기준 효력은 미발생입니다.

---

## 합의 스키마 (core-loop.md §4 기준, 변경 불가)

```json
{
  "source_chunk": [
    {
      "chunkId": "string",
      "foodName": "string",
      "relevantField": "string",
      "fieldValue": "number",
      "fieldUnit": "string"
    }
  ],
  "confidence_score": "number (0.0~1.0)",
  "disclaimer": "boolean (confidence_score < 0.6이면 true)",
  "nearestIds": ["string (itemId × K=5)"],
  "distanceThreshold": 300
}
```

---

## 결측 처리 계약 (core-loop.md §4 기준)

| 조건 | 처리 |
|---|---|
| 특정 아이템의 기준 필드 결측 | 해당 아이템은 K 후보에서 제외 (confidence 계산 대상 아님) |
| 미션 기준 필드의 결측률 ≥ 20% | 해당 기준 필드를 미션 풀에서 제거 후 AI 엔지니어·백엔드 양측에 통보 |
| confidence_score 범위 | 0.0 이상 1.0 이하 실수 (1.0 초과·음수 불가) |

---

## 계산 기준 재확인

```
d_min     = K 이웃 중 플레이어↔아이템 최단 거리 (px)
d_threshold = 300 (고정 상수)

confidence_score = 1.0 - (d_min / d_threshold)

발행 조건 (변경 불가):
  d_min < 300px   → KNN_UPDATE emit
  d_min ≥ 300px   → emit 차단
  
disclaimer 규칙 (변경 불가):
  confidence_score < 0.6  → disclaimer = true
  confidence_score ≥ 0.6  → disclaimer = false
```

---

## 변경 절차

1. 이 계약 어느 필드·규칙 변경 시: 게임 기획자 합의 → core-loop.md 버전업 → 이 계약 재서명 順.
2. 단독 변경 불가.

---

## 서명

| 직군 | 서명 | 날짜 | 비고 |
|---|---|---|---|
| **AI 엔지니어** | ✅ 확인·서명 완료 | 2026-06-15 | RAG 응답 생성 측 — 스키마·결측 처리·disclaimer 로직 정합 확인. ※발행 조건(d_min<300px→emit)이 core-loop.md §3(confidence<0.4→emit차단)과 불일치 — 백엔드 구현 시 §3 우선 적용 권고(AI 엔지니어) |
| **백엔드** | ✅ 확인·서명 완료 | 2026-06-15 | 스키마 검증·중계 측. §3 우선 적용 — confidence<0.4 구간 emit 차단 구현 |

> 양자 서명 완료 시 Goal 2 "서면 합의 서명" 인정.
