# VFX 구현 명세 — kNN 멀티플레이 식품 탐색 게임
> 버전: v1.2 | 작성: VFX 전문가 | 기반: core-loop.md v1.1 + VFX 트리거 계약 (2026-06-15) | 색상 토큰 hex 확정 반영 (디자이너, 2026-06-15) | 프론트엔드 3건 확정 반영 (2026-06-15)
> **계약 수치(이벤트명·필드명·opacity·주기)는 기획자 합의 없이 변경 금지. 성능 예산 수치는 제안값 — 프론트엔드 실측 후 확정.**

---

## 1. 렌더 레이어 구조 (Z-Order 전체 계층)

> emit 지점 · draw 호출 · z-order 슬롯을 모두 명시한 VFX 계층표.  
> 오프스크린 캔버스는 `(offscreen)`으로 표기 — 매 프레임 compositing 대신 배칭.

| 레이어 ID | z-index | 이름 | 내용 | 합성 방식 |
|---|---|---|---|---|
| L0 | 0 | background | 정적 배경 필드 | offscreen 1회 렌더 후 `drawImage` 재사용 |
| L1 | 10 | items | 필드 아이템 (ITEM_SPAWN 팝인 포함) | normal |
| L2 | 20 | knn-glow | KNN_UPDATE 글로우 오버레이 (offscreen) | `screen` (가산혼합) |
| L3 | 30 | players | 플레이어 엔티티 (무적 깜빡임 포함) | normal |
| L4 | 40 | particles | FOOD_EATEN 파티클 · PLAYER_DIED 폭발 | normal |
| L5 | 50 | screen-fx | 화면 셰이크 (PLAYER_DIED) | ctx translate 진동 |
| L6 | 60 | ui-popup | SCORE_UPDATE 팝업 · disclaimer 툴팁 | normal |
| L7 | 70 | session-overlay | SESSION_START 카드·카운트다운 · SESSION_END 랭킹 | normal |

**L0 오프스크린 정책**: 배경 변경(세션 재시작 등)이 아닌 한 재렌더 하지 않음. drawImage 1회/frame.  
**L2 오프스크린 정책**: 매 frame clearRect → nearestIds 글로우 재드로우 → `ctx.drawImage(glowCanvas, 0, 0)`.

---

## 2. 성능 예산 ⚠ 제안값 — 프론트엔드 실측 확정 필요

| 항목 | 제안값 | 근거 |
|---|---|---|
| 목표 FPS | 60 fps | 계약 기준 |
| VFX 프레임 예산 | ≤ 5ms / frame | 전체 16.67ms 중 ~30% |
| 파티클 Pool 크기 | 300개 | FOOD_EATEN 12 × 8인 + PLAYER_DIED 32 × 여유 |
| 동시 활성 파티클 상한 | 200개 | 초과 시 가장 오래된 파티클 강제 소멸 |
| GC 목표 | `new Particle()` 0회 (Pool 내 재활용) | GC 스파이크 방지 |
| knn-glow 오프스크린 캔버스 | 1개 (2000×2000) | 전체 필드 커버 |

> **확정 전까지** 위 수치는 제안값으로만 처리. 프론트엔드가 실측 후 수정 시 이 문서 버전업.

---

## 3. 오브젝트 풀 설계

```
ParticlePool
├── pool: Particle[300]          // 초기화 시 생성, 이후 new 없음
├── acquire() → Particle         // alive=true, 위치·색·생존 시간 세팅
│   └── 풀 소진 시: 가장 오래된 alive Particle 재활용 + 경고 로그
└── release(p)                   // alpha=0, alive=false, 풀 반환

Particle
├── x, y           // 스폰 위치
├── vx, vy         // 방사형 초기 속도
├── life           // ms 남은 생존시간
├── maxLife        // 생성 시 고정
├── alpha          // 현재 불투명도
├── color          // 토큰 문자열 (렌더 시 실제 hex로 룩업)
└── alive          // Pool 관리 플래그
```

---

## 4. 이벤트별 VFX 명세

> 각 항목: **Emit 지점 → Draw 호출 → Z-Order 슬롯** 3종 세트로 기술.

---

### 4-1. FOOD_EATEN — 수집 파티클

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 FOOD_EATEN 메시지 수신 즉시 |
| **Draw 호출** | L4(particles): Pool.acquire() × ≥8개 → 방사형 arc() |
| **Z-Order 슬롯** | L4 |
| **스폰 타이밍** | 수신 후 ≤ 200ms (QA 기준점: 서버 timestamp 수신 후) |
| **파티클 개수** | 8~12개 (HIGH 품질) / 8개 고정 (LOW 품질) |
| **초기 속도** | 방사형 랜덤 50~150 px/s, 각도 균등 분포 |
| **생존 시간** | 300~500ms 랜덤, alpha 1.0→0 선형 감소 |
| **색상** | missionMatch=true → `COLOR_FOOD_MATCH` / false → `COLOR_FOOD_NEUTRAL` |
| **1회 점화 보장** | 서버 레벨에서 중복 차단 완료 → 클라이언트 별도 방어 불필요 |
| **풀 사용** | Pool.acquire() / 소멸 시 Pool.release() |
| **토글** | `VFX_FOOD_EATEN`: `HIGH` / `LOW` (8개 고정) / `OFF` |

```
// 의사코드
on FOOD_EATEN(e):
  count = quality === 'HIGH' ? randInt(8, 12) : 8
  for i in range(count):
    p = Pool.acquire()
    p.x = e.x;  p.y = e.y
    angle = (i / count) * 2π + random(-0.2, 0.2)
    speed = random(50, 150)
    p.vx = cos(angle) * speed
    p.vy = sin(angle) * speed
    p.maxLife = random(300, 500)
    p.color = e.missionMatch ? COLOR_FOOD_MATCH : COLOR_FOOD_NEUTRAL
```

---

### 4-2. KNN_UPDATE — AI 힌트 글로우

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 KNN_UPDATE 메시지 수신 즉시 |
| **Draw 호출** | L2(knn-glow) 오프스크린 캔버스: nearestIds × arc() 글로우 |
| **Z-Order 슬롯** | L2 (아이템 위, 플레이어 아래) |
| **색상 토큰** | `COLOR_KNN_HINT` (강도 차등, 구간 무관 동일 토큰) |
| **1회 점화 보장** | 동일 playerId KNN_UPDATE 중복 수신 시 기존 타이머 `cancelAnimationFrame` 후 재시작 (중첩 스폰 금지) |
| **토글** | `VFX_KNN_GLOW`: `HIGH` / `LOW` (MED 고정) / `OFF` |

**신뢰도 구간별 렌더 명세**:

| 구간 | confidence_score | Opacity 사이클 | 주기 | 글로우 반지름 | 보조 표현 | disclaimer |
|---|---|---|---|---|---|---|
| HIGH | ≥ 0.80 | 0 → 1.0 → 0 | 800ms 사인 | item.r × 2.5 | 내측 보조 링 (item.r × 1.5, alpha × 0.4) | false |
| MED | 0.60 ~ 0.79 | 0 → 1.0 → 0 | 800ms 사인 | item.r × 2.0 | 없음 | false |
| LOW | 0.40 ~ 0.59 | 0 → 0.5 → 0 | 800ms 사인 | item.r × 1.5 | disclaimer 툴팁 (L6) | true: "AI 힌트 — 정확도 낮음" |
| NONE | < 0.40 | 미표시 | — | — | 서버에서 emit 차단 | — |

> HIGH vs MED 시각 구분: 보조 링과 글로우 반지름 차이로 구분 (opacity·주기는 계약상 동일 고정).

```
// 의사코드
on KNN_UPDATE(e):
  cancelGlow(e.playerId)           // 기존 animation frame 취소
  if e.confidence_score < 0.4: return
  tier = scoreTier(e.confidence_score)  // HIGH/MED/LOW
  for itemId of e.nearestIds:
    pos = getItemPosition(itemId)   // 프론트엔드 read-only 상태에서 조회
    scheduleGlowLoop(pos, tier)     // requestAnimationFrame 루프 등록

glowLoop(pos, tier, t):
  phase = (t % 800) / 800          // 0~1
  opacity = sin(phase * π) * tier.maxOpacity
  drawGlow(glowCanvas, pos, tier.radius, opacity)
  if tier === LOW: showDisclaimer(pos)
```

---

### 4-3. PLAYER_DIED — 사망 폭발 + 화면 셰이크

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 PLAYER_DIED 메시지 수신 즉시 |
| **Draw 호출 (순서)** | ① 해당 playerId 기존 VFX 전부 클리어 → ② L4: 폭발 파티클 → ③ L5: 화면 셰이크 |
| **Z-Order 슬롯** | L4 (폭발 파티클) + L5 (셰이크) |
| **토글** | `VFX_PLAYER_DIED`: `HIGH` / `LOW` / `OFF`, `VFX_SCREEN_SHAKE`: `ON` / `OFF` (별도) |

**VFX 클리어 대상 (해당 playerId)**:
- KNN_UPDATE 글로우 타이머 취소 (`cancelGlow(playerId)`)
- 진행 중인 FOOD_EATEN 파티클 중 `playerId` 귀속분 강제 소멸 (`Pool.release()`)
- 무적 깜빡임 타이머 취소
- SCORE_UPDATE 팝업 큐 플러시 후 재삽입 (PLAYER_DIED 이후 순서로)

**폭발 파티클 스펙**:

| 항목 | HIGH 품질 | LOW 품질 |
|---|---|---|
| 개수 | 32개 | 16개 |
| 속도 | 방사형 100~300 px/s | 방사형 100~200 px/s |
| 생존 | 400~600ms | 400ms 고정 |
| 색상 | `COLOR_PLAYER_DIED_FX` — `#FF4500` / oklch(0.60 0.22 37) (VFX 전용 토큰, **확정**) | 동일 |

> `COLOR_PLAYER_DIED_FX`: hex `#FF4500` / oklch(0.60 0.22 37) — 디자이너 확정 (2026-06-15). core-loop.md 5종 공유 토큰과 별도로 VFX 네임스페이스에만 존재 (`--art-*` 소유). QA 판정 즉시 가능.

**화면 셰이크 스펙**:

| 항목 | 명세 |
|---|---|
| 범위 | ±5px (계약 수치, 변경 불가) |
| 지속 | 300ms (계약 수치, 변경 불가) |
| 구현 | `ctx.save() → ctx.translate(offsetX, offsetY) → 렌더 → ctx.restore()` |
| offset 계산 | `offsetX = sin(t / 300 × π × 6) × 5` (감쇠 진동) |

---

### 4-4. PLAYER_RESPAWN — 무적 깜빡임

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 PLAYER_RESPAWN 메시지 수신 즉시 |
| **Draw 호출** | ① 플레이어 위치 즉시 이동 → ② L3(players): invincibleUntil 만료까지 alpha 진동 |
| **Z-Order 슬롯** | L3 (플레이어 draw 시 alpha 제어) |
| **깜빡임 스펙** | alpha = 0.4 + 0.6 × sin²(t / 500 × π), 500ms 주기, invincibleUntil 만료 시 alpha=1.0 고정 |
| **사망 플래그 해제** | PLAYER_RESPAWN 수신 시 `deadPlayers.delete(playerId)` |
| **토글** | `VFX_RESPAWN_BLINK`: `ON` / `OFF` |

---

### 4-5. SCORE_UPDATE — 점수 팝업

| 항목 | 명세 |
|---|---|
| **Emit 지점** | PLAYER_DIED 연출 시작 이후 팝업 표시 (z-order 계약 준수) |
| **Draw 호출** | L6(ui-popup): fillText() — fade-up 600ms |
| **Z-Order 슬롯** | L6 |
| **PLAYER_DIED 동시 처리** | PLAYER_DIED 수신 시 SCORE_UPDATE 팝업을 처리 큐에 150ms 지연 후순위로 push |
| **토글** | `VFX_SCORE_POPUP`: `ON` / `OFF` |

**팝업 애니메이션**:

| 항목 | 명세 |
|---|---|
| 지속 | 600ms (계약 수치, 변경 불가) |
| 이동 | y 위치 `-=30px` over 600ms (ease-out) |
| alpha | 1.0 → 0 over 600ms |
| 색상 (delta > 0, 일반) | `#66BB6A` / oklch(0.72 0.15 145) — **확정** |
| 색상 (delta > 0, 미션 보너스) | `#FFD740` / oklch(0.88 0.17 75) — `COLOR_FOOD_MATCH` 재사용, **확정** |
| 색상 (delta < 0) | `#EF5350` / oklch(0.62 0.20 25) — **확정** |

---

### 4-6. SESSION_START — 세션 시작 연출

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 SESSION_START 메시지 수신 즉시 |
| **Draw 호출** | L7(session-overlay): 미션 카드 → 카운트다운 순서 |
| **Z-Order 슬롯** | L7 (최상위) |
| **연출 순서** | ① 미션 카드 슬라이드인 0.5s → ② 카드 유지 1.5s → ③ 카운트다운 3→2→1→GO (각 1s) → ④ 오버레이 페이드아웃 0.5s → 게임 시작 |
| **미션 표시** | `mission.displayText` 표시 (`SESSION_START` 페이로드 직접 사용) |
| **토글** | `VFX_SESSION_START`: `ON` / `OFF` |

---

### 4-7. SESSION_END — 세션 종료 연출

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 SESSION_END 메시지 수신 즉시 |
| **Draw 호출** | L7(session-overlay): 3초 페이드 → 랭킹 화면 |
| **Z-Order 슬롯** | L7 (최상위) |
| **연출 순서** | ① 현재 화면 페이드아웃 3s → ② 랭킹 화면 페이드인 0.5s → ③ rank=1 플레이어 골드 펄스 강조 |
| **1위 강조** | rank=1: 테두리 골드 글로우 pulse (COLOR_KNN_HINT 유사 패턴, 1.5s 주기 3회) |
| **토글** | `VFX_SESSION_END`: `ON` / `OFF` |

---

### 4-8. ITEM_SPAWN — 아이템 등장 연출

| 항목 | 명세 |
|---|---|
| **Emit 지점** | 서버 ITEM_SPAWN 메시지 수신 즉시 |
| **Draw 호출** | L1(items): scale 0→1 팝인 200ms |
| **Z-Order 슬롯** | L1 |
| **팝인 스펙** | scale = easeOutBack(t / 200), 200ms |
| **색상** | missionMatch=true → `COLOR_FOOD_MATCH` / false → `COLOR_FOOD_NEUTRAL` |
| **토글** | `VFX_ITEM_SPAWN`: `ON` / `OFF` |

---

## 5. 동시 이벤트 VFX 우선순위 처리

### 최악 시나리오: PLAYER_DIED + FOOD_EATEN + KNN_UPDATE + SCORE_UPDATE 동시 수신

```
처리 큐 (동일 틱 수신 시):
  [1] PLAYER_DIED       → 즉시 실행 + 해당 playerId 기존 VFX 전부 클리어
  [2] FOOD_EATEN        → 사망 주체가 아닌 경우 독립 실행 (L4, 위치 기반 분리)
                          사망 주체의 FOOD_EATEN → 생략 (엔티티 클리어로 이미 처리)
  [3] KNN_UPDATE        → L2 독립 레이어, PLAYER_DIED와 z-order 충돌 없음 → 독립 실행
  [4] SCORE_UPDATE      → 150ms 지연 큐 → PLAYER_DIED 연출 시작 후 팝업 표시
```

### 1회 점화 보장 구현 체크리스트

| 이벤트 | 보장 방법 |
|---|---|
| FOOD_EATEN | 서버 레벨 중복 차단 → VFX 측 별도 방어 불필요 |
| KNN_UPDATE | `glowTimers[playerId]` 맵 관리 — 기존 rAF ID `cancelAnimationFrame` 후 재등록 |
| PLAYER_DIED | `deadPlayers` Set 관리 — 사망 플래그 설정 즉시 해당 플레이어 신규 VFX 차단 |
| PLAYER_DIED → RESPAWN 구간 | `deadPlayers`에 있는 playerId의 FOOD_EATEN·KNN_UPDATE VFX 발동 차단 (서버 보장이지만 클라 방어 유지) |

---

## 6. 저사양 자동 디그레이드 경로

FPS 모니터링 기반 자동 전환:

| 조건 | 품질 단계 | 파티클 변화 |
|---|---|---|
| FPS ≥ 50 | HIGH | 모든 VFX 풀 사양 |
| 45 ≤ FPS < 50 | LOW | 파티클 개수 50% 감소, HIGH kNN 글로우 → MED 고정 |
| FPS < 30 | MINIMAL | 파티클 OFF, 셰이크 OFF, 글로우 LOW 고정 |

- FPS 측정: 최근 60프레임 이동평균
- 전환 이력 로그: 콘솔 출력 (QA 진단용)

---

## 7. 개별 토글 목록 (QA·디자이너 조정용)

```javascript
const VFX_FLAGS = {
  VFX_FOOD_EATEN:    'HIGH',    // 'HIGH' | 'LOW' | 'OFF'
  VFX_KNN_GLOW:      'HIGH',    // 'HIGH' | 'LOW' | 'OFF'
  VFX_PLAYER_DIED:   'HIGH',    // 'HIGH' | 'LOW' | 'OFF'
  VFX_SCREEN_SHAKE:  'ON',      // 'ON'   | 'OFF'
  VFX_RESPAWN_BLINK: 'ON',      // 'ON'   | 'OFF'
  VFX_SCORE_POPUP:   'ON',      // 'ON'   | 'OFF'
  VFX_SESSION_START: 'ON',      // 'ON'   | 'OFF'
  VFX_SESSION_END:   'ON',      // 'ON'   | 'OFF'
  VFX_ITEM_SPAWN:    'ON',      // 'ON'   | 'OFF'
}
```

---

## 8. 프론트엔드 인터페이스 가정 (확인 필요)

> 현재 프론트엔드 코드 없음 → 아래는 **표준 Canvas 2D rAF 패턴 가정**. 프론트엔드(담당자: 1513819740940927067)와 합의 후 확정.

| 가정 항목 | 가정 내용 | 확인 필요 |
|---|---|---|
| 렌더 루프 | `requestAnimationFrame` 기반, 매 frame `update(dt) → draw()` | 프론트엔드 확인 |
| 캔버스 구성 | `<canvas>` 2D context, 뷰포트 800×600 | 프론트엔드 확인 |
| 상태 접근 | VFX는 read-only 상태 스냅샷(플레이어 위치·아이템 위치)만 수신 | 프론트엔드 확인 |
| 이벤트 수신 | WebSocket on('message') → 이벤트 타입 분기 후 VFX 핸들러 호출 | 프론트엔드 확인 |
| 성능 예산 | 파티클 상한 200개, VFX ≤5ms/frame | **프론트엔드 실측 후 확정** |

**VFX 모듈 호출 인터페이스 (제안)**:
```javascript
// 프론트엔드 이벤트 핸들러에서 호출
VFXManager.onFoodEaten(event)       // FOOD_EATEN 페이로드
VFXManager.onKnnUpdate(event)       // KNN_UPDATE 페이로드
VFXManager.onPlayerDied(event)      // PLAYER_DIED 페이로드
VFXManager.onPlayerRespawn(event)   // PLAYER_RESPAWN 페이로드
VFXManager.onScoreUpdate(event)     // SCORE_UPDATE 페이로드
VFXManager.onSessionStart(event)    // SESSION_START 페이로드
VFXManager.onSessionEnd(event)      // SESSION_END 페이로드
VFXManager.onItemSpawn(event)       // ITEM_SPAWN 페이로드

// 렌더 루프에서 호출
VFXManager.update(dt)               // 파티클 물리·타이머 업데이트
VFXManager.draw(ctx, layers)        // 레이어별 draw 호출
```

---

## 9. 미확정 항목 — 확인 대기

| 항목 | 담당 | 현 상태 |
|---|---|---|
| `COLOR_PLAYER_DIED_FX` hex 값 | 디자이너 | ✅ 확정 — `#FF4500` / oklch(0.60 0.22 37) (2026-06-15) |
| SCORE_UPDATE 팝업 색상 hex 값 | 디자이너 | ✅ 확정 — 일반 `#66BB6A`, 미션보너스 `#FFD740`, 손실 `#EF5350` (2026-06-15) |
| 성능 예산 수치 확정 | 프론트엔드 담당 (1513819740940927067) | ⚠ 구현 착수 — 제안값(≤5ms/frame, Pool 300, 동시 상한 200) 기준. 실측 후 이 문서 버전업 예정 (프론트엔드, 2026-06-15) |
| VFXManager 인터페이스 합의 | 프론트엔드 담당 (1513819740940927067) | ✅ 확정 — 제안 인터페이스(VFXManager.on*, update, draw) 수용 (프론트엔드, 2026-06-15) |
| PLAYER_DIED 연출 사이 SCORE_UPDATE 지연값 150ms | 프론트엔드 담당 | ⚠ 구현 착수 — 제안값 150ms 기준. 체감 실측 후 조정 가능 (프론트엔드, 2026-06-15) |
| `COLOR_PLAYER_DIED_FX` JS 미러 토큰 포함 여부 | 프론트엔드 담당 (1513819740940927067) | ✅ 확정 — Canvas 미러 토큰 구조 구현 시 `--art-*` 네임스페이스 토큰으로 포함 (프론트엔드, 2026-06-15) |

---

*v1.2 — VFX 전문가 작성 / 디자이너 색상 토큰 확정 반영 (2026-06-15) / 프론트엔드 확정값 3건 + `COLOR_PLAYER_DIED_FX` JS 미러 토큰 행 추가 반영 (2026-06-15). 계약 수치 변경 시 기획자 합의 후 문서 버전업.*
