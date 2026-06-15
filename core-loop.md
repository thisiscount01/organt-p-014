# Core Loop Document — kNN 멀티플레이 식품 탐색 게임
> 버전: v1.1 | 작성: 게임 기획자 | 상태: **확정 (팀 계약 기준)** | 색상 토큰 hex/oklch 확정 (디자이너, 2026-06-15)
> 이 문서는 백엔드·AI·프론트엔드·QA 전 도메인의 수치·이벤트명 기준점입니다. 수정은 기획자와 합의 후 버전업.

---

## 한 문장 루프 정의

> **플레이어가 2D 필드에서 미션 기준에 맞는 식품 아이템을 탐색·수집해 점수를 쌓고, kNN AI 힌트로 다음 최적 먹이를 선택하며, 제한 시간(120초) 내 최고 점수로 경쟁한다.**

이 문장 하나로 루프 한 바퀴를 손으로 시뮬레이션할 수 있어야 합니다.  
루프 한 바퀴 = 이동 → 인지(kNN 글로우) → 수집(FOOD_EATEN) → 보상(점수+성장) → 위협(PvP) → [생존 or 사망→부활] → 다음 이동

---

## 1. 장르 및 핵심 메커닉

### 장르
**실시간 멀티플레이어 수집·성장 경쟁 (agar.io 변형) + 식품 공공데이터 기반 AI 힌트 레이어**

브라우저 기반 웹 게임. 플러그인 없이 동작. 최대 8인 동시 접속 1개 세션.

### 핵심 메커닉

| 메커닉 | 설명 |
|---|---|
| 이동 | WASD 또는 마우스 방향 — 플레이어 원형 엔티티 2D 상단 뷰 조종 |
| 수집 | 플레이어 원이 식품 아이템 원과 겹치면 즉시 흡수 (서버 판정) |
| 성장 | 아이템 수집 시 반지름 +1px, 점수 +10(일반) or +20(미션 부합) |
| AI 힌트 | 미션 기준에 맞는 아이템 중 K=5 최근접 항목에 글로우 오버레이 |
| PvP | 반지름 차이 1.3× 이상일 때 큰 플레이어가 작은 플레이어 흡수·사망 |
| 세션 종료 | 120초 경과 OR 생존 플레이어 1명 → 점수 최고자 승리 |

### 핵심 수치 파라미터 (모든 도메인 기준상수)

| 파라미터 | 값 | 단위 | 근거 |
|---|---|---|---|
| 세션 시간 | 120 | 초 | 캐주얼 멀티 표준, 후반 긴장감 확보 |
| 서버 틱레이트 | 20 | tps | 50ms/틱 — ④트레일 ≤100ms 달성 가능 |
| kNN 재연산 주기 | 500 | ms | 서버 틱 10회마다 1회 — 클라 글로우 800ms 주기와 정렬 |
| 논리 필드 크기 | 2000 × 2000 | px | 8인 분산 탐색 기준 |
| 뷰포트 | 800 × 600 | px | 브라우저 기본 해상도 |
| 최대 동시 플레이어 | 8 | 명 | 서버 브로드캐스트 부하 상한 |
| 초기 플레이어 반지름 | 20 | px | |
| 아이템 반지름 | 8 | px | |
| PvP 흡수 배율 | 1.3 × | — | 역전 가능 범위 유지 |
| 부활 무적 시간 | 3,000 | ms | |
| 기본 이동 속도 | 150 | px/s | 점수 증가 시 선형 감소 |
| 최고 점수 시 이동 속도 | 100 | px/s | (최대 점수 = 1,000점 기준) |
| 필드 아이템 총 수 | 50 | 개 | 항상 유지 (수집 후 1~3초 내 리스폰) |
| kNN K | 5 | 개 | 힌트 대상 최근접 아이템 수 |
| 힌트 발동 최대 거리 | 300 | px | 논리 좌표 기준 |
| 미션 부합 점수 | 20 | 점 | missionMatch=true 시 |
| 일반 아이템 점수 | 10 | 점 | missionMatch=false 시 |
| 사망 점수 손실률 | 50 | % | 나머지 50%는 흡수자에게 이전 |

---

## 2. 플레이어 행동 흐름 — 한 세션의 단계별 흐름

### 단계 0 — 대기실 (세션 시작 전, 최대 10초)

1. 플레이어 접속 → 닉네임 입력 (최대 8자)
2. **미션 카드 표시**: "이번 세션 미션 — [기준명]" (예: "나트륨 300mg 이하 식품 5종 수집")
3. 준비 완료 표시 후 SESSION_START emit (모든 플레이어 준비 or 10초 경과)

### 단계 1 — 탐색 · 수집 (0초 ~ 120초)

```
[매 서버 틱 — 50ms마다]
1. 모든 플레이어 위치 수신
2. 충돌 판정: 플레이어↔아이템, 플레이어↔플레이어
3. FOOD_EATEN / PLAYER_DIED 발생 시 즉시 emit
4. 업데이트된 위치·점수·반지름 전체 브로드캐스트

[매 500ms마다 — kNN 재연산]
1. 플레이어별 필드 아이템 거리 계산
2. 미션 부합 아이템 중 K=5 최근접 선별
3. confidence_score 계산
4. 변경 있으면 KNN_UPDATE emit
```

**플레이어 행동 선택지**:
- A. kNN 글로우가 가리키는 미션 부합 아이템을 쫓아 20점씩 효율 수집
- B. 가까운 일반 아이템을 빠르게 수집해 반지름 성장 → PvP 우위 확보
- C. 작은 플레이어를 추적해 PvP 흡수 (상대 점수의 50% 획득)

**첫 보상까지 예상 시간**: 약 3~5초 (초기 이동 속도 150px/s, 아이템 밀도 50개/4,000,000px² 기준)

### 단계 2 — 사망 · 부활 (비선형 삽입 단계)

```
PLAYER_DIED emit
→ 클라이언트: 폭발 파티클 + 화면 셰이크 (±5px, 300ms)
→ 서버: 3,000ms 대기
→ PLAYER_RESPAWN emit (필드 가장자리 임의 위치, 반지름 20px 초기화)
→ invincibleUntil 만료 전까지 PvP 피격 판정 제외
```

### 단계 3 — 세션 종료

- **조건 A**: 서버 타이머 ≥ 120,000ms
- **조건 B**: 생존 플레이어 수 = 1명 (배틀로얄 종료)
- SESSION_END emit → 랭킹 화면 전환 (클라이언트 3초 페이드)
- 최고 총점 플레이어 승리 (동점 시 먼저 도달한 플레이어)

### 밸런스 페이싱 의도

| 구간 | 시간 | 의도 |
|---|---|---|
| 초반 훅 | 0~20초 | 빠른 수집, 첫 미션 부합 아이템 달성 (보상 즉시) |
| 중반 유지 | 20~80초 | 성장한 플레이어 간 PvP 긴장감, kNN 힌트 활용 전략 분기 |
| 후반 반복동기 | 80~120초 | 점수 격차 좁히기, 역전 PvP 가능 구간 |

---

## 3. AI 힌트 개입 시점

### 계산 구조

```
[서버, 매 500ms]
플레이어 위치 → 필드 아이템 거리 계산
→ 미션 부합(missionMatch=true) 아이템만 대상
→ 거리 오름차순 정렬 → K=5 선별
→ confidence_score 계산 → 임계값 필터 → KNN_UPDATE emit (변경 시만)
```

**계산 주체**: 서버 (클라이언트는 원시 이웃 데이터만 수신, kNN 연산 없음)

### confidence_score 계산식

```
d_min     = K 이웃 중 플레이어↔아이템 최단 거리 (px)
d_threshold = 300 (고정 상수, 논리 px)

confidence_score = 1.0 - (d_min / d_threshold)

- d_min = 0px    → confidence = 1.0 (아이템 위에 있음)
- d_min = 150px  → confidence = 0.5
- d_min = 300px  → confidence = 0.0 (emit 안 함)
- d_min > 300px  → 필터링 (KNN_UPDATE 미발행)
```

### 힌트 발동 조건 및 표현 매핑

| confidence_score 구간 | 글로우 표현 | disclaimer | 처리 위치 |
|---|---|---|---|
| ≥ 0.6 | opacity 0→1→0, 800ms 주기, full | false | 프론트엔드: 힌트 표시 |
| 0.4 ~ 0.59 | opacity 0→0.5→0, 800ms 주기 | true | 프론트엔드: "AI 힌트 — 정확도 낮음" 툴팁 |
| < 0.4 | 비표시 | — | 서버에서 emit 차단 |

**KNN_UPDATE emit 조건** (불필요한 전송 방지):
- K개 이웃 itemId 집합 변경 OR
- 기존 대비 d_min 변화량 ≥ 50px

**E2E 레이턴시 목표**: 서버 kNN 계산 완료 → 클라이언트 글로우 첫 프레임 렌더 ≤ 3,000ms  
(서버 계산 500ms + 네트워크 RTT 상한 100ms + 클라 렌더 1프레임 50ms = 650ms 예상 — 여유 충분)

---

## 4. 식품·의약품 공공 데이터 활용 방법

### 데이터 출처

- **식품의약품안전처(MFDS) 공공 데이터 API**: 식품영양성분 데이터베이스
- 필드 아이템 1개 = 실제 식품 제품 1건 (제품명 + 영양성분 매핑)
- 결측률 < 20% 필드만 미션 기준으로 사용 (AI 엔지니어 합의 기준)

### 미션 기준 풀 (최소 10종, 세션마다 1개 랜덤 선정)

| criterionId | displayText | field | operator | threshold | unit |
|---|---|---|---|---|---|
| LOW_SODIUM | 나트륨 300mg 이하 | sodium_mg | ≤ | 300 | mg/100g |
| HIGH_PROTEIN | 단백질 10g 이상 | protein_g | ≥ | 10 | g/100g |
| HIGH_FIBER | 식이섬유 3g 이상 | fiber_g | ≥ | 3 | g/100g |
| LOW_CALORIE | 열량 100kcal 이하 | energy_kcal | ≤ | 100 | kcal/100g |
| LOW_FAT | 지방 3g 이하 | fat_g | ≤ | 3 | g/100g |
| LOW_SUGAR | 당류 5g 이하 | sugars_g | ≤ | 5 | g/100g |
| HIGH_CALCIUM | 칼슘 100mg 이상 | calcium_mg | ≥ | 100 | mg/100g |
| HIGH_VITC | 비타민C 50mg 이상 | vitamin_c_mg | ≥ | 50 | mg/100g |
| ZERO_CHOLESTEROL | 콜레스테롤 0mg | cholesterol_mg | = | 0 | mg/100g |
| LOW_SAT_FAT | 포화지방 1g 이하 | saturated_fat_g | ≤ | 1 | g/100g |

### 아이템 데이터 구조 (서버 → 클라이언트 ITEM_SPAWN 시)

```json
{
  "itemId": "string",
  "x": "number (0~2000)",
  "y": "number (0~2000)",
  "foodDataId": "string",
  "displayName": "string (최대 10자)",
  "missionMatch": "boolean",
  "nutritionSnapshot": {
    "criterionId": "string",
    "field": "string",
    "value": "number",
    "unit": "string"
  }
}
```

### RAG AI 응답 스키마 (AI 엔지니어·백엔드 서면 합의 기준)

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

**결측 처리 계약**: confidence_score 계산 시 해당 필드 결측이면 그 아이템은 K 후보에서 제외.  
결측률 ≥ 20%인 기준 필드는 미션 풀에서 제거하고 AI 엔지니어·백엔드에 통보.

---

## 5. 핵심 판정 이벤트 목록

> **계약 기준**: 이 섹션의 event명·필드명은 백엔드·AI 엔지니어·프론트엔드 3자가 그대로 씁니다. 임의 변경·축약·추가 금지. 변경 필요 시 기획자에게 요청 후 이 문서 버전업.

---

### FOOD_EATEN

```json
{
  "event": "FOOD_EATEN",
  "playerId": "string",
  "itemId": "string",
  "x": "number",
  "y": "number",
  "scoreDelta": "number",      // 20 (missionMatch=true) | 10 (false)
  "scoreTotal": "number",      // 변경 후 누적 총점
  "radiusDelta": 1,            // 항상 +1px
  "missionMatch": "boolean",
  "timestamp": "number"        // 서버 Unix ms
}
```

- **트리거**: 서버 틱 내 플레이어↔아이템 충돌 판정 확정 즉시
- **클라이언트 처리**: 수신 후 200ms 이내 파티클 ≥8개 스폰, 300~500ms 생존
- **QA 기준점**: 서버 emit timestamp 기준 (RTT 제외)
- **중복 방지**: 동일 itemId는 FOOD_EATEN 처리 즉시 서버에서 소멸 → 중복 수집 불가

---

### KNN_UPDATE

```json
{
  "event": "KNN_UPDATE",
  "playerId": "string",
  "nearestIds": ["string"],    // K=5 itemId 배열 (거리 오름차순)
  "distanceThreshold": 300,    // 고정 상수 (px)
  "confidence_score": "number", // 0.0~1.0
  "disclaimer": "boolean",
  "timestamp": "number"
}
```

- **트리거**: 서버 500ms 재연산 후 변경 감지 시
- **클라이언트 처리**: confidence ≥ 0.6 → full glow 800ms 주기 / 0.4~0.59 → 50% opacity + disclaimer 툴팁
- **1회 점화 보장**: 동일 playerId 기준 KNN_UPDATE 중복 수신 시 기존 애니메이션 재시작 (중첩 스폰 금지)

---

### PLAYER_DIED

```json
{
  "event": "PLAYER_DIED",
  "playerId": "string",
  "x": "number",
  "y": "number",
  "killerId": "string | null",   // PvP 흡수자 playerId | 낙사이면 null
  "scoreTransferred": "number",  // 사망자 총점 × 0.5 (흡수자에게 이전)
  "timestamp": "number"
}
```

- **트리거**: 서버 틱 내 PvP 흡수 판정 (player_A.radius ≥ player_B.radius × 1.3) 확정 즉시
- **클라이언트 처리**: 폭발 파티클 + 화면 셰이크 ±5px 300ms
- **경계 케이스 — 무적 중 피격**: invincibleUntil 미만이면 서버에서 PLAYER_DIED 발행 차단 (클라이언트 판단 금지)
- **경계 케이스 — 스킬 중 사망**: 사망 처리 즉시 진행 중인 모든 상태 클리어, PLAYER_DIED 우선 발행
- **부활 타이머**: 서버에서 PLAYER_DIED 직후 3,000ms 카운트 → PLAYER_RESPAWN 자동 emit

---

### PLAYER_RESPAWN

```json
{
  "event": "PLAYER_RESPAWN",
  "playerId": "string",
  "x": "number",                 // 필드 가장자리 임의 (0~100 or 1900~2000 범위)
  "y": "number",
  "invincibleUntil": "number",   // timestamp + 3000
  "timestamp": "number"
}
```

- **트리거**: PLAYER_DIED timestamp + 3,000ms 후 서버 emit
- **무적 구간**: invincibleUntil 만료 전 PvP 흡수 판정에서 제외 (서버에서 필터)
- **클라이언트 처리**: 부활 위치로 즉시 이동 + 반투명 깜빡임 효과 (무적 구간 시각화)

---

### SCORE_UPDATE

```json
{
  "event": "SCORE_UPDATE",
  "playerId": "string",
  "delta": "number",             // 이번 변화량 (양수: 획득 / 음수: 손실)
  "total": "number",             // 변경 후 총점
  "reason": "FOOD_EATEN | PVP_ABSORB | PVP_DIED",
  "timestamp": "number"
}
```

- **트리거**: 점수 변경 즉시 (FOOD_EATEN·PLAYER_DIED와 동일 서버 틱)
- **클라이언트 처리**: delta 팝업 fade-up 600ms (양수: 초록/노랑, 음수: 빨강)
- **동시 이벤트 충돌 처리**: PLAYER_DIED 동시 발생 시 SCORE_UPDATE는 PLAYER_DIED 이후에 emit (z-order 우선순위: 사망 연출 > 점수팝업)

---

### SESSION_START

```json
{
  "event": "SESSION_START",
  "sessionId": "string",
  "playerId": "string",
  "mission": {
    "criterionId": "string",
    "displayText": "string",
    "field": "string",
    "operator": "<= | >= | =",
    "threshold": "number",
    "unit": "string"
  },
  "durationMs": 120000,
  "timestamp": "number"
}
```

---

### SESSION_END

```json
{
  "event": "SESSION_END",
  "sessionId": "string",
  "rankings": [
    { "rank": "number", "playerId": "string", "scoreTotal": "number" }
  ],
  "timestamp": "number"
}
```

---

### ITEM_SPAWN

```json
{
  "event": "ITEM_SPAWN",
  "itemId": "string",
  "x": "number",
  "y": "number",
  "foodDataId": "string",
  "missionMatch": "boolean",
  "timestamp": "number"
}
```

- **트리거**: FOOD_EATEN 처리 후 1,000~3,000ms 내 서버가 빈 공간에 스폰 (필드 총 50개 유지)

---

## 색상 토큰 계약 (Color Token Contract)
> 디자이너·프론트엔드·백엔드 공유 계약. 5종 고정. 임의 추가·변경 금지.

| 토큰명 | hex | oklch | 용도 | 상태 매핑 |
|---|---|---|---|---|
| COLOR_PLAYER_SELF | `#29B6F6` | oklch(0.73 0.14 220) | 내 플레이어 엔티티 | 생존 중 (무적 구간 깜빡임 처리 가능) |
| COLOR_PLAYER_OTHER | `#AB47BC` | oklch(0.52 0.17 310) | 타 플레이어 엔티티 | 생존 중 |
| COLOR_FOOD_MATCH | `#FFD740` | oklch(0.88 0.17 75) | 미션 부합 식품 아이템 | missionMatch = true |
| COLOR_FOOD_NEUTRAL | `#81C784` | oklch(0.77 0.13 145) | 일반 식품 아이템 | missionMatch = false |
| COLOR_KNN_HINT | `#00E5FF` | oklch(0.84 0.14 195) | kNN 글로우 오버레이 | confidence_score ≥ 0.4 |

---

## QA 합격 수치 — 이벤트별 체크리스트

> **기준점 통일**: 모든 클라이언트 측 타이밍은 "서버 emit timestamp 수신 후" 기준. RTT 제외.

| 이벤트 | 측정 항목 | 합격 기준 | 기준점 | 비고 |
|---|---|---|---|---|
| FOOD_EATEN | 파티클 첫 스폰까지 시간 | ≤ 200ms | 서버 emit 수신 후 | 개수 ≥ 8개 |
| FOOD_EATEN | 파티클 생존 시간 | 300~500ms | 첫 스폰 후 | |
| KNN_UPDATE | 글로우 opacity 사이클 | 0→1→0, 800ms | 수신 후 첫 사이클 | confidence ≥ 0.6 |
| KNN_UPDATE | disclaimer 툴팁 표시 | confidence 0.4~0.59 구간 전부 | 수신 즉시 | |
| PLAYER_DIED | 화면 셰이크 범위 | ±5px | 수신 후 즉시 | 300ms 지속 |
| PLAYER_RESPAWN | 무적 구간 시각화 | 3,000ms 깜빡임 | PLAYER_RESPAWN 수신 후 | |
| SCORE_UPDATE | 팝업 fade-up | 600ms | 수신 후 즉시 | |
| 이동 트레일 | 렌더 지연 | ≤ 100ms | 서버 위치 브로드캐스트 수신 후 | 틱레이트 20tps 전제 |

**동시 이벤트 시나리오 (QA 필수 재현)**:
1. PLAYER_DIED + SCORE_UPDATE 동시: PLAYER_DIED 연출 우선, SCORE_UPDATE 팝업은 PLAYER_DIED 후 emit 순으로
2. FOOD_EATEN + KNN_UPDATE 동시: 파티클과 글로우 독립 레이어 → z-order 충돌 없음 확인
3. 무적 구간(invincibleUntil) 중 PvP 접촉: PLAYER_DIED 미발생 확인 (서버 로그 기준)
4. 동일 playerId KNN_UPDATE 연속 수신: 글로우 중첩 스폰 금지, 기존 애니메이션 재시작

---

## 미확정 항목 (팀 합의 대기)

| 항목 | 담당 합의 | 현 상태 |
|---|---|---|
| MFDS API 인증 승인 일정 | AI 엔지니어 | 승인 소요 시간 미확정 — 일정 블로커 |
| 서버 브로드캐스트 RTT 상한 | 백엔드 | 권고 ≤ 100ms, 미측정 |
| 색상 토큰 실제 hex 값 | 디자이너 | **확정 (v1.1)** — 5종 hex/oklch 모두 확정. 상세 값은 색상 토큰 계약 섹션 참조 |
| 미션 부합 여부 서버 판정 vs 클라 판정 | 백엔드 | 서버 판정 권고 (이 문서 기준) |

---

*v1.1 — 게임 기획자 확정 / 디자이너 색상 토큰 hex/oklch 확정 반영 (2026-06-15). 변경 시 이 문서 버전업 후 팀 전달.*
