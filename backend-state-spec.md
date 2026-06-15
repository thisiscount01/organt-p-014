# 백엔드 상태 열거형 및 타이밍 기준점 명세
> 버전: v1.0 | 작성: 게임 기획자 | 기반: core-loop.md v1.1 | 2026-06-15
> **목적**: 백엔드 계약 문서 작성의 게임 기획 측 입력 명세.
> 백엔드는 이 문서를 기반으로 서버 상태 열거형 코드 및 타이밍 계약 문서를 구현한다.
> 수정 필요 시 게임 기획자와 합의 후 버전업.

---

## 1. 플레이어 상태 열거형 (PlayerState Enum)

| 상태값 | 의미 | 진입 조건 | 탈출 조건 |
|---|---|---|---|
| `WAITING` | 대기실 — 세션 시작 전 | 접속 직후 | SESSION_START emit |
| `ACTIVE` | 게임 중 — 정상 이동·충돌 판정 대상 | SESSION_START 수신 / INVINCIBLE 만료 | PLAYER_DIED / SESSION_END |
| `INVINCIBLE` | 부활 직후 무적 — PvP 피격 판정 제외 | PLAYER_RESPAWN emit 직후 | `invincibleUntil` 타임스탬프 경과 → 자동 ACTIVE 전환 |
| `DEAD` | 사망 — 부활 타이머 대기 중 | PLAYER_DIED emit | PLAYER_RESPAWN emit (3,000ms 후) |
| `FINISHED` | 세션 종료 후 결과 화면 | SESSION_END emit | 로비 복귀 또는 다음 세션 |

**상태 전이도**:
```
WAITING → ACTIVE ────→ DEAD → INVINCIBLE → ACTIVE
                 ↘                               ↓
                  └──────────────→ FINISHED ←───┘
```

---

## 2. 세션 상태 열거형 (SessionState Enum)

| 상태값 | 의미 | 진입 조건 | 탈출 조건 |
|---|---|---|---|
| `LOBBY` | 대기 — 플레이어 모집 중 | 서버 초기화 / 이전 세션 종료 | 전원 준비 완료 OR 10초 경과 |
| `ACTIVE` | 게임 진행 중 | SESSION_START emit | 종료 조건 A/B 충족 |
| `ENDING` | 종료 처리 중 (점수 집계·랭킹) | 종료 조건 충족 즉시 | SESSION_END emit 완료 |
| `FINISHED` | 세션 완료 | SESSION_END emit | 다음 LOBBY 전환 |

**종료 조건**:
- 조건 A: 서버 타이머 ≥ 120,000ms
- 조건 B: 생존 플레이어 수 = 1명 (배틀로얄 종료)

---

## 3. 서버 이벤트 발화 vs 클라이언트 렌더 타이밍 기준

> **서버 틱레이트 기준**: 20 tps (50ms/틱) — 아래 모든 타이밍 보장의 전제 조건.

| 이벤트 | 서버 발화 기준점 | 클라이언트 렌더 기준점 | 허용 E2E |
|---|---|---|---|
| `FOOD_EATEN` | 서버 틱 내 충돌 판정 확정 즉시 | 수신 후 파티클 첫 스폰 | ≤ 200ms |
| `KNN_UPDATE` | 500ms 재연산 후 변경 감지 즉시 | 수신 후 glowLoop 첫 프레임 | ≤ 3,000ms E2E |
| `PLAYER_DIED` | 서버 틱 내 PvP 판정 확정 즉시 | 수신 후 연출 시작 | ≤ 1프레임 (16ms) |
| `PLAYER_RESPAWN` | PLAYER_DIED timestamp + 3,000ms | 수신 후 위치 이동 즉시 | ≤ 1프레임 (16ms) |
| `SCORE_UPDATE` | 점수 변경 즉시 (FOOD_EATEN·PLAYER_DIED와 동일 틱) | PLAYER_DIED 동시 시 클라 150ms 지연 큐 | 클라 렌더 큐 관리 |
| `SESSION_START` | 전원 준비 완료 OR 10초 경과 | 수신 후 미션 카드 표시 즉시 | ≤ 1프레임 (16ms) |
| `SESSION_END` | 종료 조건 충족 즉시 | 수신 후 3초 페이드 시작 | ≤ 1프레임 (16ms) |
| `ITEM_SPAWN` | FOOD_EATEN 후 1,000~3,000ms 내 서버 판단 | 수신 후 팝인 즉시 | ≤ 1프레임 (16ms) |

**클라이언트 타이밍 측정 기준점 통일**: "서버 emit timestamp 수신 후" — RTT 제외.

---

## 4. 경계 케이스 명세

### 4-1. 무적 구간(INVINCIBLE) 중 PvP 피격

- **처리 주체**: 서버 (클라이언트 독자 판단 금지)
- **규칙**: `PlayerState = INVINCIBLE`인 플레이어가 상대에게 반지름 1.3× 이상으로 접촉되더라도 **PLAYER_DIED 발행하지 않음**
- **판정 코드 위치**: 서버 틱 내 플레이어↔플레이어 충돌 판정부 — INVINCIBLE 상태 필터 선행
- **무적 만료**: `invincibleUntil` 타임스탬프 기준, 경과 즉시 `PlayerState INVINCIBLE → ACTIVE` 자동 전환 (별도 이벤트 emit 없음)
- **클라이언트**: PLAYER_DIED 미수신 → 별도 처리 없음

### 4-2. 스킬 사용 중 사망 (진행 중 상태에서 PLAYER_DIED 발생)

- **처리 주체**: 서버 (PLAYER_DIED 우선 발행)
- **규칙**: PvP 흡수 판정 확정 즉시 `PlayerState → DEAD`, **PLAYER_DIED 즉시 emit** — 진행 중인 서버 사이드 상태(아이템 충돌 대기, kNN 재연산 대기 등) 전부 클리어
- **서버**: DEAD 상태 플레이어는 kNN 재연산 대상에서 제외, 아이템 충돌 판정에서 제외
- **클라이언트 처리 계약**: PLAYER_DIED 수신 시 해당 playerId의 모든 VFX 즉시 클리어 후 사망 연출 시작 (VFX 명세 vfx-spec.md §4-3 참조)

### 4-3. 동일 서버 틱 내 이벤트 emit 순서

```
동일 틱 처리 우선순위:
1. PLAYER_DIED     (PvP 판정 최우선)
2. FOOD_EATEN      (아이템 충돌)
3. SCORE_UPDATE    (점수 변경, PLAYER_DIED·FOOD_EATEN 직후)
4. KNN_UPDATE      (주기 재연산 결과, 독립)
5. STATE 브로드캐스트 (위치·점수·반지름 전체)
```

**PLAYER_DIED + FOOD_EATEN 동일 틱**: PLAYER_DIED 먼저 emit. (해당 플레이어가 사망 직전 틱에 아이템을 수집했더라도 PLAYER_DIED 우선)

### 4-4. 생존 플레이어 1명 → SESSION_END 즉시 처리

- 마지막 PLAYER_DIED emit 후 생존자 수 확인 (동일 틱 내) → `SessionState ENDING` 전환 → `SESSION_END` 즉시 emit
- 타이머 잔여 무관 (배틀로얄 우선 종료)

### 4-5. 결측 영양 데이터 아이템 처리

- `missionMatch` 판정 시 해당 criterionId의 nutrion 필드가 결측 → `missionMatch = false` 처리
- kNN 재연산 시 결측 필드 아이템은 `confidence_score = 0` → emit 차단 대상
- 특정 criterionId 미션 기준 필드의 전체 아이템 결측률 ≥ 20% → 해당 criterionId 세션 사용 금지, AI 엔지니어·백엔드 통보

---

## 5. 서버 틱 처리 순서 (의사코드)

```
매 50ms(1틱):
  1. 클라이언트로부터 위치 업데이트 수신
  2. 플레이어 상태 필터: ACTIVE + INVINCIBLE 만 이후 판정 대상
  3. 플레이어↔아이템 충돌 판정
     → 충돌 감지: FOOD_EATEN emit, 아이템 소멸, 점수·반지름 업데이트
  4. 플레이어↔플레이어 충돌 판정
     → 조건: bigPlayer.radius >= smallPlayer.radius × 1.3
     → smallPlayer.state != INVINCIBLE 일 때만
     → 충돌: PLAYER_DIED emit, 점수 이전 계산
  5. SCORE_UPDATE emit (점수 변경 있는 플레이어 전부)
  6. 생존자 수 확인 → SESSION_END 조건 체크
  7. 전체 상태 브로드캐스트
  
매 500ms(10틱):
  8. kNN 재연산 (전 플레이어)
     → 변경 감지 시 KNN_UPDATE emit (변경 없으면 emit 생략)
```

---

## 6. 미확정 항목 (백엔드 구현 후 확인 필요)

| 항목 | 현 상태 | 필요 행동 |
|---|---|---|
| 서버 브로드캐스트 RTT 실측값 | 권고 ≤100ms, 미측정 | 백엔드 실환경 측정 후 core-loop.md 업데이트 |
| `INVINCIBLE → ACTIVE` 전환 알림 이벤트 | 별도 emit 없음 (기획 의도) | 클라이언트 `invincibleUntil` 로컬 타이머로 처리 — 확인 필요 |
| MFDS API 결측률 실데이터 | 미확정 | AI 엔지니어 API 연동 후 측정 |

---

*v1.0 — 게임 기획자 작성 (2026-06-15). 백엔드는 이 명세를 기반으로 서버 계약 문서(enum 코드·타이밍 보장 테이블) 작성 후 이 문서에 합의 서명란 추가.*
