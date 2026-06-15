# QA 합격 수치 체크리스트 — kNN 멀티플레이 식품 탐색 게임
> 버전: v1.0 | 작성: 게임 기획자 | 기반: core-loop.md v1.1, vfx-spec.md v1.2 | 2026-06-15
> **목적**: QA가 직접 실행 가능한 합격 기준 체크리스트.
> **원칙**: 기준점 없는 수치는 합격/불합격 판정 불인정.
> **모든 클라이언트 타이밍 기준점 통일**: "서버 emit timestamp 수신 후" — RTT 제외.

---

## 0. 측정 환경 전제조건 (미충족 시 결과 무효)

| 항목 | 요구값 | 확인 방법 |
|---|---|---|
| 서버 틱레이트 | 20 tps (50ms/틱) | 서버 로그 타임스탬프 간격 |
| 네트워크 RTT | ≤ 100ms (로컬 테스트 기준) | ping 측정 기록 |
| 뷰포트 | 800 × 600 px | 브라우저 devtools |
| 브라우저 | 크롬 최신 | |
| FPS (HIGH 품질 기준) | ≥ 50 fps | 콘솔 FPS 모니터 |
| 환경 확인 | □ | 모든 항목 충족 후 아래 체크리스트 진행 |

---

## 1. FOOD_EATEN — 수집 파티클

> 기준점: 서버 FOOD_EATEN emit 수신 후

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 1-1 | 파티클 첫 스폰 타이밍 | ≤ **200ms** | 200ms 초과 시 불합격 | □ PASS □ FAIL |
| 1-2 | 파티클 개수 (HIGH 품질) | **8개 이상** (8~12개) | 7개 이하 불합격 | □ PASS □ FAIL |
| 1-3 | 파티클 개수 (LOW 품질) | 정확히 **8개** | 7개 이하·9개 이상 불합격 | □ PASS □ FAIL |
| 1-4 | 파티클 생존 시간 | **300ms 이상 500ms 이하** | 299ms 이하 or 501ms 이상 불합격 | □ PASS □ FAIL |
| 1-5 | missionMatch=true 색상 | `COLOR_FOOD_MATCH` **#FFD740** | hex 불일치 불합격 | □ PASS □ FAIL |
| 1-6 | missionMatch=false 색상 | `COLOR_FOOD_NEUTRAL` **#81C784** | hex 불일치 불합격 | □ PASS □ FAIL |
| 1-7 | 동일 itemId 중복 수집 차단 | 서버 로그에 동일 itemId FOOD_EATEN **2회 없음** | 1회 초과 시 불합격 | □ PASS □ FAIL |

---

## 2. KNN_UPDATE — AI 힌트 글로우

> 기준점: 서버 KNN_UPDATE emit 수신 후

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 2-1 | 글로우 opacity 사이클 (confidence ≥ 0.6) | **0 → 1.0 → 0, 800ms** 1사이클 | 주기 ±50ms 초과 불합격 | □ PASS □ FAIL |
| 2-2 | 글로우 opacity 사이클 (confidence 0.4~0.59) | **0 → 0.5 → 0, 800ms** 1사이클 | 최대값 0.5 초과 불합격 | □ PASS □ FAIL |
| 2-3 | disclaimer 툴팁 표시 (confidence 0.4~0.59) | **"AI 힌트 — 정확도 낮음"** 표시 | 미표시 불합격 | □ PASS □ FAIL |
| 2-4 | confidence < 0.4 시 글로우 미표시 | 클라이언트 글로우 **없음** (서버 emit 차단) | 글로우 표시 시 불합격 | □ PASS □ FAIL |
| 2-5 | 동일 playerId 연속 수신 — 중첩 금지 | 기존 글로우 **취소 후 재시작** (동시 2개 없음) | 중첩 발생 시 불합격 | □ PASS □ FAIL |
| 2-6 | E2E 레이턴시 (kNN 계산→클라 첫 프레임) | **≤ 3,000ms** | 3,001ms 초과 불합격 | □ PASS □ FAIL |
| 2-7 | 글로우 색상 | `COLOR_KNN_HINT` **#00E5FF** | hex 불일치 불합격 | □ PASS □ FAIL |

---

## 3. PLAYER_DIED — 사망 연출

> 기준점: 서버 PLAYER_DIED emit 수신 후

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 3-1 | 화면 셰이크 범위 | **±5px** | ±4px 이하 or ±6px 이상 불합격 | □ PASS □ FAIL |
| 3-2 | 화면 셰이크 지속 시간 | **300ms** | 299ms 이하 or 301ms 이상 불합격 | □ PASS □ FAIL |
| 3-3 | 폭발 파티클 개수 (HIGH 품질) | **32개** | 31개 이하 불합격 | □ PASS □ FAIL |
| 3-4 | 폭발 파티클 개수 (LOW 품질) | **16개** | 15개 이하 불합격 | □ PASS □ FAIL |
| 3-5 | 폭발 파티클 색상 | `COLOR_PLAYER_DIED_FX` **#FF4500** | hex 불일치 불합격 | □ PASS □ FAIL |
| 3-6 | 폭발 파티클 생존 시간 (HIGH) | **400~600ms** | 399ms 이하 or 601ms 이상 불합격 | □ PASS □ FAIL |
| 3-7 | 폭발 파티클 생존 시간 (LOW) | 정확히 **400ms** | ±50ms 초과 불합격 | □ PASS □ FAIL |
| 3-8 | 사망 시 기존 VFX 클리어 | 해당 playerId **글로우·무적깜빡임 즉시 소멸** | 잔여 VFX 시 불합격 | □ PASS □ FAIL |

---

## 4. 무적 구간 경계 케이스

> 기준점: PLAYER_RESPAWN 수신 후 (무적 깜빡임) / 서버 로그 (판정)

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 4-1 | 무적 구간 중 PvP 접촉 → PLAYER_DIED 미발생 | 서버 로그: PLAYER_DIED **emit 없음** | emit 1회라도 발생 시 불합격 | □ PASS □ FAIL |
| 4-2 | 무적 시각화 (깜빡임) 지속 시간 | **3,000ms** | 2,900ms 이하 불합격 | □ PASS □ FAIL |
| 4-3 | 무적 만료 직후 PvP 판정 정상 재개 | invincibleUntil 경과 후 PLAYER_DIED **정상 발행** | 5틱(250ms) 후에도 미발행 시 불합격 | □ PASS □ FAIL |
| 4-4 | 부활 위치 범위 | x·y 각각 **0~100 또는 1900~2000 범위** | 범위 밖 시 불합격 | □ PASS □ FAIL |
| 4-5 | 부활 후 반지름 초기화 | **20px** | ±1px 초과 불합격 | □ PASS □ FAIL |

---

## 5. SCORE_UPDATE — 점수 팝업

> 기준점: SCORE_UPDATE emit 수신 후 (PLAYER_DIED 동시 시 150ms 지연 기준점 별도 명기)

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 5-1 | 팝업 fade-up 지속 시간 | **600ms** | ±50ms 초과 불합격 | □ PASS □ FAIL |
| 5-2 | 팝업 y 이동량 | **-30px** over 600ms | ±3px 초과 불합격 | □ PASS □ FAIL |
| 5-3 | delta > 0 일반 색상 | **#66BB6A** | hex 불일치 불합격 | □ PASS □ FAIL |
| 5-4 | delta > 0 미션 보너스 색상 | **#FFD740** (COLOR_FOOD_MATCH) | hex 불일치 불합격 | □ PASS □ FAIL |
| 5-5 | delta < 0 색상 | **#EF5350** | hex 불일치 불합격 | □ PASS □ FAIL |
| 5-6 | PLAYER_DIED 동시 발생 시 팝업 지연 | PLAYER_DIED 수신 후 **≥ 150ms** 이후 팝업 표시 | 149ms 이하 표시 시 불합격 | □ PASS □ FAIL |

---

## 6. 이동 트레일

> 기준점: 서버 위치 브로드캐스트 수신 후 / 전제: 서버 틱레이트 20tps 확인 후 진행

| # | 측정 항목 | 합격 기준 | 경계값 | 판정 |
|---|---|---|---|---|
| 6-1 | 트레일 렌더 지연 | **≤ 100ms** | 101ms 초과 불합격 | □ PASS □ FAIL |
| 6-2 | 전제 확인: 서버 틱레이트 | 20 tps (50ms/틱) | 미달 시 이 항목 결과 무효 | □ 확인 |

---

## 7. 색상 토큰 전체 UI 적용

| # | 토큰명 | hex | 적용 대상 | 판정 |
|---|---|---|---|---|
| 7-1 | `COLOR_PLAYER_SELF` | **#29B6F6** | 내 플레이어 엔티티 fill | □ PASS □ FAIL |
| 7-2 | `COLOR_PLAYER_OTHER` | **#AB47BC** | 타 플레이어 엔티티 fill | □ PASS □ FAIL |
| 7-3 | `COLOR_FOOD_MATCH` | **#FFD740** | 미션 부합 아이템·미션 보너스 팝업 | □ PASS □ FAIL |
| 7-4 | `COLOR_FOOD_NEUTRAL` | **#81C784** | 일반 아이템 fill | □ PASS □ FAIL |
| 7-5 | `COLOR_KNN_HINT` | **#00E5FF** | kNN 글로우 오버레이 | □ PASS □ FAIL |

---

## 8. 동시 이벤트 시나리오 (QA 필수 재현)

| # | 시나리오 | 합격 기준 | 판정 |
|---|---|---|---|
| 8-1 | PLAYER_DIED + SCORE_UPDATE 동시 수신 | PLAYER_DIED 연출 선행, SCORE_UPDATE 팝업 150ms 후 표시 | □ PASS □ FAIL |
| 8-2 | FOOD_EATEN + KNN_UPDATE 동시 수신 | 파티클(L4)·글로우(L2) 독립 렌더, z-order 겹침 없음 | □ PASS □ FAIL |
| 8-3 | INVINCIBLE 중 PvP 접촉 | PLAYER_DIED **서버 로그에 없음** | □ PASS □ FAIL |
| 8-4 | 동일 playerId KNN_UPDATE 연속 수신 | 글로우 중첩 없음, 기존 rAF 취소 후 재시작 | □ PASS □ FAIL |
| 8-5 | 사망 직전 FOOD_EATEN + PLAYER_DIED 동일 틱 | PLAYER_DIED 먼저 emit, 사망자의 FOOD_EATEN 파티클 미스폰 | □ PASS □ FAIL |
| 8-6 | 최악 시나리오: 4이벤트 동시 (PLAYER_DIED + FOOD_EATEN + KNN_UPDATE + SCORE_UPDATE) | 큐 처리 순서 준수, VFX 누락 없음, FPS ≥ 30 유지 | □ PASS □ FAIL |

---

## 9. 게임 세션 E2E 흐름

| # | 시나리오 | 합격 기준 | 판정 |
|---|---|---|---|
| 9-1 | 세션 시작: 미션 카드 표시 | SESSION_START 수신 후 **0.5s 내** 카드 슬라이드인 시작 | □ PASS □ FAIL |
| 9-2 | 첫 보상까지 소요 시간 | 정상 조종 시 **3~5초** 내 첫 FOOD_EATEN 발생 | □ PASS □ FAIL |
| 9-3 | 세션 총 시간 | **120,000ms ± 50ms** (1틱 허용) | □ PASS □ FAIL |
| 9-4 | 배틀로얄 종료: 생존자 1명 → 즉시 SESSION_END | 마지막 PLAYER_DIED 후 **동일 틱** SESSION_END emit | □ PASS □ FAIL |
| 9-5 | 세션 종료: 랭킹 화면 | SESSION_END 수신 후 **3s 페이드 → 랭킹 표시** | □ PASS □ FAIL |

---

## 10. AI 레이어 합격 기준 (AI 엔지니어·백엔드 측정)

| # | 측정 항목 | 합격 기준 | 기준점 | 판정 |
|---|---|---|---|---|
| 10-1 | kNN 재연산 주기 | **500ms ±1틱 (50ms)** | 서버 로그 KNN_UPDATE 타임스탬프 간격 | □ PASS □ FAIL |
| 10-2 | AI 응답 스키마 필드 완결성 | `source_chunk[]` + `confidence_score` + `disclaimer` **모두 포함** | API 응답 JSON 검증 | □ PASS □ FAIL |
| 10-3 | 결측 필드 처리 | confidence_score = 0 처리, emit 차단 (서버 로그) | 서버 로그 | □ PASS □ FAIL |
| 10-4 | 결측률 기준 | 미션 기준 필드 결측률 **< 20%** | 데이터 품질 리포트 (샘플 N건) | □ PASS □ FAIL |
| 10-5 | 힌트 E2E 레이턴시 (단일 쿼리 K=5) | **≤ 3,000ms** | 서버 kNN 완료 → 클라 첫 프레임 | □ PASS □ FAIL |

---

## 합격 판정 기준

**전체 합격**: §1~§9 항목 **전부 PASS** + §10 항목 **전부 PASS**

- §0 전제조건 미충족 → 전체 결과 무효
- §8 동시 이벤트 시나리오 미재현 → 해당 항목 FAIL 처리
- **경계값 항목**: 경계값 자체(exactly 200ms, exactly 300ms 등)는 PASS로 처리 (경계 포함)

---

*v1.0 — 게임 기획자 작성 (2026-06-15). QA는 판정란(□)에 PASS/FAIL + 실측값 기재. 기준점 불명 항목 발생 시 게임 기획자에게 협의 요청.*
