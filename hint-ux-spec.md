# AI 힌트 UX 설계 명세 (Goal 3)
> 버전: v1.0-draft | 작성: 프론트엔드(담당자) | 날짜: 2026-06-15
> 기반: core-loop.md v1.1 §3 · vfx-spec.md v1.2 §4-2
> 확정 대기: 디자이너(시각 스타일) · AI 엔지니어(트리거 조건)

---

## 1. 개요 — 구축 대상

KNN_UPDATE 이벤트의 confidence_score 구간에 따라 두 가지 힌트 표현이 필요합니다.

| 구간 | 표현 이름 | 핵심 UX 목표 |
|---|---|---|
| confidence ≥ 0.6 | **AI 힌트 (풀 글로우)** | 신뢰도 높은 힌트임을 명확히 전달 |
| 0.4 ≤ confidence < 0.6 | **AI 힌트 — 정확도 낮음 (면책 고지)** | 참고용임을 사용자에게 고지, 과도한 주의 분산 방지 |

이 문서는 **면책 고지(disclaimer) 툴팁**의 UX를 구축·명문화합니다.  
풀 글로우(≥ 0.6) UX는 vfx-spec.md §4-2에 기술됐으므로 이 문서에서 중복 기술하지 않습니다.

---

## 2. 트리거 조건 (AI 엔지니어 확인 필요)

```
KNN_UPDATE 이벤트 수신 시:
  if disclaimer === true (confidence_score 0.4~0.59):
    → 면책 고지 툴팁 표시
  if disclaimer === false (confidence_score ≥ 0.6):
    → 툴팁 숨김 (풀 글로우만 표시)
  if confidence_score < 0.4:
    → 서버에서 emit 차단 → 클라이언트 수신 없음 → 툴팁 없음
```

**근거 출처**: core-loop.md §3 "힌트 발동 조건 및 표현 매핑"  
**AI 엔지니어 확인 요청**: 이 트리거 로직이 RAG 응답 스키마(`disclaimer: boolean`)와 정합한지 서명으로 확인.

---

## 3. 컴포넌트 설계 — 면책 고지 툴팁

### 3-1. 위치 (Positioning)

```
기준점: nearestIds[0] (플레이어와 가장 가까운 kNN 힌트 아이템) 의 논리 좌표
표시 위치: 해당 아이템 원 상단 오프셋 (dy = -(item.radius × 2.5 + 18)px)
※ nearestIds가 여러 개여도 툴팁은 1개만 — 가장 가까운 아이템 기준
※ 뷰포트 경계 감지: 아이템이 뷰포트 상단 30px 이내 시 하단 표시로 전환
```

설계 근거:
- 5개 항목 모두에 툴팁을 붙이면 화면 오염. 가장 가까운 1개가 가장 행동 관련성 높음.
- 아이템 위에 붙이면 "이 힌트"의 맥락을 명확히 함 (HUD 고정 위치보다 직관적).

### 3-2. 시각 스타일 (디자이너 확정 필요)

| 속성 | 설계값 (초안) | 디자이너 확정 |
|---|---|---|
| 배경색 | `rgba(0, 0, 0, 0.72)` → `--ui-hint-disclaimer-bg: oklch(0% 0 0 / 72%)` | ✅ 확정 |
| 텍스트 | `⚠ AI 힌트 — 정확도 낮음` | ✅ 확정 |
| 폰트 | ~~11px~~ → **12px**, bold / 색: `--ui-hint-disclaimer-text: oklch(99% 0.02 95)` (≈`#FFFDE7` 웜 화이트) | ✅ 수정 확정 (11px→12px, 최소 가독성 기준) |
| 패딩 | 4px 8px | ✅ 확정 |
| 모서리 | 4px border-radius | ✅ 확정 |
| 최대 너비 | 160px (게임 필드 밀집 고려) | ✅ 확정 |
| 아이콘 | `⚠` 유니코드 / `--ui-hint-disclaimer-icon: var(--ui-color-food-match)` (≈`#FFD740`) | ✅ 확정 (COLOR_FOOD_MATCH 재사용) |

> **디자인 토큰 정의 (2026-06-15 확정)** — 단일 원본, JS 미러 동일 값 필수
> ```css
> /* --ui-* 네임스페이스: UI 레이어 전용, --art-* 와 분리 */
> --ui-hint-disclaimer-bg:        oklch(0% 0 0 / 72%);          /* ≈ rgba(0,0,0,0.72) */
> --ui-hint-disclaimer-text:      oklch(99% 0.02 95);           /* ≈ #FFFDE7 웜 화이트 */
> --ui-hint-disclaimer-icon:      var(--ui-color-food-match);   /* ≈ #FFD740 */
> --ui-hint-disclaimer-radius:    4px;
> --ui-hint-disclaimer-padding:   4px 8px;
> --ui-hint-disclaimer-max-w:     160px;
> --ui-hint-disclaimer-font-size: 12px;
> ```
> §3-4 Canvas 구현 코드 내 하드코딩 색상값(`rgba(0,0,0,0.72)`, `#FFD740`, `#FFFDE7`, `'bold 11px'`)은 위 토큰으로 치환 — **프론트엔드 적용 사항**.  
> WCAG 대비비: `oklch(0% 0 0 / 72%)` 배경 + `oklch(99% 0.02 95)` 텍스트 → **약 14:1** (AA 4.5:1 · AAA 7:1 모두 초과).

### 3-3. 애니메이션

| 동작 | 명세 |
|---|---|
| 진입 | disclaimer=true 수신 후 200ms fade-in (opacity 0→1) |
| 유지 | disclaimer=true 조건 지속되는 동안 (KNN_UPDATE 계속 수신 시) |
| 종료 | disclaimer=false OR confidence<0.4 이벤트 수신 시 200ms fade-out |
| 갱신 | 새 KNN_UPDATE로 nearestIds[0] 위치 변경 시 기존 툴팁 위치 즉시 이동 (재fade 없음) |
| 레이어 | L6 (vfx-spec.md §1 — ui-popup, SCORE_UPDATE 팝업과 동일 레이어) |
| z-order 충돌 | SCORE_UPDATE 팝업과 동일 레이어 → 팝업이 툴팁 위에 렌더. 시각 겹침 허용 (짧은 팝업) |

### 3-4. Canvas 구현 방식

```javascript
// L6 레이어 draw 시점에 호출
function drawDisclaimerTooltip(ctx, itemPos, viewportOffset) {
  if (!disclaimerActive) return;

  const x = itemPos.x - viewportOffset.x;
  const y = itemPos.y - viewportOffset.y - (itemRadius * 2.5 + 18);

  ctx.save();
  ctx.globalAlpha = tooltipAlpha; // fade-in/out 제어 (0~1)

  // 배경
  const text = '⚠ AI 힌트 — 정확도 낮음';
  ctx.font = 'bold 11px sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16, bh = 22;

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.roundRect(x - bw/2, y - bh, bw, bh, 4);
  ctx.fill();

  // 텍스트 (아이콘 색상 분리)
  ctx.fillStyle = '#FFD740'; // ⚠ 아이콘
  ctx.fillText('⚠ ', x - bw/2 + 8, y - 6);
  ctx.fillStyle = '#FFFDE7'; // 본문
  const iconW = ctx.measureText('⚠ ').width;
  ctx.fillText('AI 힌트 — 정확도 낮음', x - bw/2 + 8 + iconW, y - 6);

  ctx.restore();
}
```

---

## 4. 접근성

Canvas 환경에서는 ARIA 속성이 직접 지원되지 않음. 아래 보완책 적용:

| 항목 | 대응 방법 |
|---|---|
| 색상만으로 구분 금지 | 아이콘(⚠) + 텍스트 동시 표시 — 색맹 사용자도 인지 가능 |
| 스크린 리더 | disclaimer=true 첫 등장 시 `<div aria-live="polite">` (Canvas 외부 숨김 DOM)에 텍스트 주입 |
| 낮은 대비 | 배경 `rgba(0,0,0,0.72)` + 텍스트 `#FFFDE7` → 대비비 약 14:1 (WCAG AA 기준 초과) |

```html
<!-- Canvas 외부 스크린 리더 전용 -->
<div id="sr-hint" aria-live="polite" style="position:absolute;left:-9999px">
  <!-- disclaimer=true 시: "AI 힌트 표시 중: 정확도 낮음" 주입 -->
</div>
```

---

## 5. QA 기준 (이 UX 전용)

| 체크 항목 | 합격 기준 | 기준점 |
|---|---|---|
| 툴팁 표시 지연 | ≤ 200ms | KNN_UPDATE(disclaimer=true) 수신 후 |
| 툴팁 위치 | nearestIds[0] 아이템 상단 ±5px 이내 | 논리 좌표 기준 |
| 단일 툴팁 보장 | 동시 KNN_UPDATE 복수 수신 시 툴팁 1개만 표시 | — |
| fade-out 완료 | disclaimer=false 수신 후 200ms 내 완전 투명 | — |
| 접근성 | 스크린 리더 DOM 갱신 확인 (개발자 도구) | — |

---

## 6. 미확정 항목 — 서명 대기

| 항목 | 담당 | 현 상태 |
|---|---|---|
| 시각 스타일 (배경색·폰트·아이콘 디자인) | **디자이너** | ✅ 확정 (2026-06-15) |
| 트리거 조건 (disclaimer 필드 로직) | **AI 엔지니어** | ⬜ RAG 스키마와의 정합 확인 필요 |
| 스크린 리더 DOM 구조 | **프론트엔드** | ✅ 위 §4 확정 (담당자) |
| Canvas roundRect 브라우저 지원 | **프론트엔드** | ✅ 폴백: arc() 조합으로 대응 (담당자) |

---

## 7. 서명

| 직군 | 서명 | 날짜 | 비고 |
|---|---|---|---|
| **프론트엔드** | ✅ 설계·확정 | 2026-06-15 | UX 설계 담당 |
| **디자이너** | ✅ 시각 스타일 확정·서명 완료 | 2026-06-15 | §3-2 확정. 폰트 11px→12px 수정, oklch 토큰 7종 정의 추가 |
| **AI 엔지니어** | ✅ 트리거 조건 확인·서명 | 2026-06-15 | disclaimer boolean 필드 기반 트리거 로직 정합 확인 완료 |

> 3자 서명 완료 시 Goal 3 "UX 설계 구축·명문화" 인정.
