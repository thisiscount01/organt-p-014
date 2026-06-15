/**
 * app.js — kNN 멀티플레이 식품 탐색 게임 클라이언트 v2
 *
 * 아키텍처:
 *  - 60fps 렌더 루프 (requestAnimationFrame) — 화면 표현 전담
 *  - 50ms 고정 시뮬 루프 — 이동 예측/입력 처리 (서버 권위 하에)
 *  - 보간(interpolation): 서버 20tps 스냅샷 사이를 60fps 로 부드럽게 이음
 *  - WebSocket: 서버 8종 이벤트 수신 및 MOVE 발신
 *
 * v2 추가:
 *  - 미니맵 (우하단 150×108px 스크린 스페이스 오버레이)
 *  - 위험 비네팅 (더 큰 플레이어 접근 시 가장자리 붉은 경고)
 *  - 콤보 시스템 (missionMatch 연속 수집 카운터)
 *  - 미션 식품 강조 + ITEM_SPAWN 스케일 애니메이션
 */
'use strict';

// ── 색상 토큰 (core-loop.md 계약 — 변경 금지) ────────────────────────────────
const COLOR = {
  PLAYER_SELF:  '#29B6F6',
  PLAYER_OTHER: '#AB47BC',
  FOOD_MATCH:   '#FFD740',
  FOOD_NEUTRAL: '#81C784',
  KNN_HINT:     '#00E5FF',
};

// ── 전역 상수 (파일 최상단) ───────────────────────────────────────────────────
const TICK_MS    = 50;
const FIELD_W    = 2000, FIELD_H    = 2000;
const VIEWPORT_W = 800,  VIEWPORT_H = 600;

// ── 캔버스 / 렌더링 컨텍스트 ─────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

// ── 게임 상태 ─────────────────────────────────────────────────────────────────
let myId      = null;
let nickname  = '';
let ws        = null;
let gameState = 'NICK';   // NICK | LOBBY | PLAYING | END

// 서버에서 받은 최신 스냅샷
let snap = { players:[], items:[], sessionTimeLeft:0, sessionState:'LOBBY', missionText:'' };

// 보간용: 각 playerId → {cur, prev, lerpT, serverTs}
const interpMap = new Map();

// 아이템 캐시 (ITEM_SPAWN / STATE 병합)
const itemCache = new Map();

// 아이템 스폰 애니메이션 타임스탬프 (ITEM_SPAWN → 500ms scale 0.2→1)
const itemAnims = new Map(); // itemId → spawnTs (Date.now())

// kNN 힌트 대상 itemIds
let knnHintIds    = [];
let knnConf       = 0;
let knnDisclaimer = false;
let knnTimeout    = null;

// 마우스 방향 (논리 필드 좌표 기준)
let mouse = { dx:0, dy:0 };

// 카메라 (논리 → 화면 변환)
const cam = { x:0, y:0, scale:1 };

// 점수 팝업 큐 (DOM div 기반)
const popups = [];

// 리더보드 데이터
let leaderboard = []; // [{playerId, nickname, score}]

// 세션 타이머 보정
let sessionTimeLeft = 0;
let lastTimerSync   = 0;

// 파티클
const particles = [];

// 화면 흔들림
let shakeUntil = 0;

// ── 콤보 시스템 상태 ──────────────────────────────────────────────────────────
let combo       = 0;      // 현재 콤보 카운터
let lastComboTs = 0;      // 마지막 미션 수집 시각
let comboTimer  = null;   // 4000ms 리셋 타이머

// ── DOM 참조 ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const nicknameScreen = $('nickname-screen');
const lobbyScreen    = $('lobby-screen');
const endScreen      = $('end-screen');
const hud            = $('hud');
const leaderboardEl  = $('leaderboard');
const knnHintEl      = $('knn-hint');
const missionText    = $('mission-text');
const timerVal       = $('timer-val');
const lbList         = $('lb-list');
const finalRankings  = $('final-rankings');
const endCountdown   = $('end-countdown');
const lobbyMsg       = $('lobby-msg');
const comboBar       = $('combo-bar');
const comboVal       = $('combo-val');

// ── 캔버스 리사이즈 ───────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth  * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(devicePixelRatio, devicePixelRatio);
  cam.scale = Math.min(window.innerWidth / VIEWPORT_W, window.innerHeight / VIEWPORT_H);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── 마우스 입력 (즉각 반영) ───────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const cx = window.innerWidth  / 2;
  const cy = window.innerHeight / 2;
  mouse.dx = (mx - cx) / cam.scale;
  mouse.dy = (my - cy) / cam.scale;
});

// 터치 지원
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  mouse.dx = ((t.clientX - rect.left) - window.innerWidth  / 2) / cam.scale;
  mouse.dy = ((t.clientY - rect.top)  - window.innerHeight / 2) / cam.scale;
}, { passive: false });

// ── WebSocket 연결 ────────────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open',    ()  => console.log('[WS] 연결됨'));
  ws.addEventListener('message', e   => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close',   ()  => {
    console.log('[WS] 끊어짐 — 3초 후 재연결');
    setTimeout(connect, 3000);
  });
  ws.addEventListener('error', err => console.warn('[WS] 오류', err));
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── 메시지 핸들러 ─────────────────────────────────────────────────────────────
function onMessage(msg) {
  // STATE 브로드캐스트 (매 틱)
  if (msg.type === 'STATE') {
    updateInterp(msg);
    return;
  }
  // INIT (연결 직후)
  if (msg.type === 'INIT') {
    if (!myId) myId = msg.playerId;
    if (msg.items) msg.items.forEach(it => itemCache.set(it.itemId, it));
    if (msg.sessionState === 'ACTIVE') {
      gameState = 'PLAYING';
      showHUD(true);
    }
    return;
  }

  switch (msg.event) {
    case 'SESSION_START':  onSessionStart(msg);  break;
    case 'SESSION_END':    onSessionEnd(msg);    break;
    case 'FOOD_EATEN':     onFoodEaten(msg);     break;
    case 'KNN_UPDATE':     onKnnUpdate(msg);     break;
    case 'PLAYER_DIED':    onPlayerDied(msg);    break;
    case 'PLAYER_RESPAWN': onPlayerRespawn(msg); break;
    case 'SCORE_UPDATE':   onScoreUpdate(msg);   break;
    case 'ITEM_SPAWN':     onItemSpawn(msg);     break;
  }
}

function updateInterp(msg) {
  const now = Date.now();
  snap = msg;

  // 아이템 동기화 (STATE를 정답으로)
  if (msg.items) {
    for (const it of msg.items) itemCache.set(it.itemId, it);
    const stateIds = new Set(msg.items.map(i => i.itemId));
    for (const k of itemCache.keys()) if (!stateIds.has(k)) itemCache.delete(k);
  }

  // 보간 대상 업데이트
  if (msg.players) {
    for (const sp of msg.players) {
      const prev = interpMap.get(sp.playerId);
      if (prev) {
        interpMap.set(sp.playerId, {
          prev: { x: prev.cur.x, y: prev.cur.y, radius: prev.cur.radius },
          cur:  sp,
          lerpT:    0,
          serverTs: now,
        });
      } else {
        interpMap.set(sp.playerId, { prev: sp, cur: sp, lerpT: 1, serverTs: now });
      }
    }
    // 떠난 플레이어 제거
    const alive = new Set(msg.players.map(p => p.playerId));
    for (const k of interpMap.keys()) if (!alive.has(k)) interpMap.delete(k);

    // 리더보드 갱신
    leaderboard = [...msg.players]
      .sort((a, b) => b.score - a.score)
      .map(p => ({ playerId: p.playerId, nickname: p.nickname, score: p.score }));
    renderLeaderboard();
  }

  // 타이머 동기화
  if (msg.sessionTimeLeft !== undefined) {
    sessionTimeLeft = msg.sessionTimeLeft;
    lastTimerSync   = now;
  }
}

function onSessionStart(msg) {
  myId            = msg.playerId || myId;
  gameState       = 'PLAYING';
  sessionTimeLeft = msg.durationMs;
  lastTimerSync   = Date.now();
  itemCache.clear();
  itemAnims.clear();
  knnHintIds  = [];
  leaderboard = [];

  // 콤보 리셋
  combo       = 0;
  lastComboTs = 0;
  if (comboTimer) { clearTimeout(comboTimer); comboTimer = null; }
  updateComboHUD();

  showHUD(true);
  if (msg.mission) missionText.textContent = msg.mission.displayText || '';
  lobbyScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  console.log(`[SESSION_START] sessionId=${msg.sessionId} mission=${msg.mission?.criterionId}`);
}

function onSessionEnd(msg) {
  gameState = 'END';
  showHUD(false);
  leaderboardEl.classList.add('hidden');
  knnHintEl.classList.add('hidden');

  // 콤보 리셋
  combo = 0;
  if (comboTimer) { clearTimeout(comboTimer); comboTimer = null; }
  updateComboHUD();

  finalRankings.innerHTML = '';
  (msg.rankings || []).forEach(r => {
    const li  = document.createElement('li');
    const isMe = r.playerId === myId;
    li.textContent = `${r.rank}위  ${isMe ? '★' : ''}${r.nickname || r.playerId} (${r.scoreTotal}점)`;
    if (isMe) li.style.color = COLOR.PLAYER_SELF;
    finalRankings.appendChild(li);
  });
  endScreen.classList.remove('hidden');

  let cd = 5;
  endCountdown.textContent = `${cd}초 후 새 세션 대기`;
  const t = setInterval(() => {
    cd--;
    if (cd <= 0) { clearInterval(t); endScreen.classList.add('hidden'); showLobby(); }
    else endCountdown.textContent = `${cd}초 후 새 세션 대기`;
  }, 1000);

  console.log(`[SESSION_END] ${JSON.stringify(msg.rankings)}`);
}

function onFoodEaten(msg) {
  itemCache.delete(msg.itemId);
  itemAnims.delete(msg.itemId);
  spawnParticles(msg.x, msg.y, msg.missionMatch ? COLOR.FOOD_MATCH : COLOR.FOOD_NEUTRAL, 10);

  if (msg.playerId === myId) {
    // ── 콤보 업데이트 ───────────────────────────────────────────────────────
    if (msg.missionMatch) {
      combo++;
      lastComboTs = Date.now();
      if (comboTimer) clearTimeout(comboTimer);
      comboTimer = setTimeout(() => {
        combo      = 0;
        comboTimer = null;
        updateComboHUD();
      }, 4000);
    } else {
      combo = 0;
      if (comboTimer) { clearTimeout(comboTimer); comboTimer = null; }
    }
    updateComboHUD();

    const comboSuffix = combo >= 3 ? ` ×${combo}🔥` : '';
    showScorePopup(msg.x, msg.y,
      '+' + msg.scoreDelta + comboSuffix,
      msg.missionMatch ? COLOR.FOOD_MATCH : '#fff');
  }
}

function onKnnUpdate(msg) {
  if (msg.playerId !== myId) return;
  knnHintIds    = msg.nearestIds || [];
  knnConf       = msg.confidence_score;
  knnDisclaimer = msg.disclaimer;
  if (knnTimeout) clearTimeout(knnTimeout);
  knnHintEl.classList.remove('hidden');
  $('knn-text').textContent = knnDisclaimer
    ? `AI 힌트 — 정확도 낮음 (${Math.round(knnConf * 100)}%)`
    : `AI 힌트 활성 (${Math.round(knnConf * 100)}%)`;
  knnTimeout = setTimeout(() => { knnHintIds = []; knnHintEl.classList.add('hidden'); }, 30000);
  console.log(`[KNN_UPDATE] conf=${knnConf} disclaimer=${knnDisclaimer}`);
}

function onPlayerDied(msg) {
  triggerShake();
  spawnParticles(msg.x, msg.y, COLOR.PLAYER_OTHER, 16);
  if (msg.playerId === myId) {
    spawnParticles(msg.x, msg.y, COLOR.PLAYER_SELF, 20);
    // 사망 시 콤보 리셋
    combo = 0;
    if (comboTimer) { clearTimeout(comboTimer); comboTimer = null; }
    updateComboHUD();
  }
  console.log(`[PLAYER_DIED] ${msg.playerId} killer=${msg.killerId}`);
}

function onPlayerRespawn(msg) {
  // 서버 STATE가 invincibleUntil을 포함해 보내므로 시각 처리는 렌더에서
  console.log(`[PLAYER_RESPAWN] ${msg.playerId} invincibleUntil=${msg.invincibleUntil}`);
}

function onScoreUpdate(msg) {
  // 리더보드는 STATE에서 갱신, 팝업은 FOOD_EATEN에서 처리
  if (msg.reason === 'PVP_DIED' && msg.playerId === myId) {
    showScorePopup(
      window.innerWidth  / 2 / cam.scale,
      window.innerHeight / 2 / cam.scale,
      '' + msg.delta, '#f87171');
  }
  console.log(`[SCORE_UPDATE] ${msg.playerId} delta=${msg.delta} total=${msg.total}`);
}

function onItemSpawn(msg) {
  itemCache.set(msg.itemId, {
    itemId:       msg.itemId,
    x:            msg.x,
    y:            msg.y,
    radius:       8,
    missionMatch: msg.missionMatch,
    displayName:  msg.displayName,
  });
  itemAnims.set(msg.itemId, Date.now()); // 스폰 애니메이션 시작
}

// ── 콤보 HUD 업데이트 ─────────────────────────────────────────────────────────
function updateComboHUD() {
  if (!comboBar || !comboVal) return;
  if (combo >= 2) {
    comboBar.classList.remove('hidden');
    comboVal.textContent = `×${combo}`;
    if (combo >= 10) {
      comboVal.style.color    = '#FF6B35';
      comboVal.style.fontSize = '1.3rem';
    } else if (combo >= 5) {
      comboVal.style.color    = '';          // CSS 기본값(--color-food-match)
      comboVal.style.fontSize = '1.3rem';
    } else {
      comboVal.style.color    = '';
      comboVal.style.fontSize = '';
    }
  } else {
    comboBar.classList.add('hidden');
  }
}

// ── UI 헬퍼 ──────────────────────────────────────────────────────────────────
function showHUD(on) {
  hud.classList.toggle('hidden', !on);
  leaderboardEl.classList.toggle('hidden', !on);
}

function showLobby() {
  gameState = 'LOBBY';
  nicknameScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  showHUD(false);
}

function renderLeaderboard() {
  lbList.innerHTML = '';
  leaderboard.slice(0, 8).forEach((e, i) => {
    const li   = document.createElement('li');
    const isMe = e.playerId === myId;
    if (isMe) li.classList.add('me');
    li.innerHTML =
      `<span class="lb-rank">${i + 1}</span>` +
      `<span class="lb-name">${isMe ? '★ ' : ''}${e.nickname || ''}</span>` +
      `<span class="lb-score">${e.score}</span>`;
    lbList.appendChild(li);
  });
}

function showScorePopup(lx, ly, text, color) {
  const sx  = (lx - cam.x) * cam.scale + (window.innerWidth  - VIEWPORT_W * cam.scale) / 2;
  const sy  = (ly - cam.y) * cam.scale + (window.innerHeight - VIEWPORT_H * cam.scale) / 2;
  const div = document.createElement('div');
  div.className    = 'score-popup';
  div.style.left   = sx + 'px';
  div.style.top    = sy + 'px';
  div.style.color  = color;
  div.textContent  = text;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 650);
}

function triggerShake() {
  shakeUntil = Date.now() + 300;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 310);
}

// ── 파티클 ───────────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 80;
    particles.push({
      x, y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      life:  1,
      decay: 0.025 + Math.random() * 0.025,
      r:     3 + Math.random() * 4,
      color,
    });
  }
}

// ── 보간 유틸 ─────────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

// ── 50ms 고정 시뮬 (이동 입력 발신) ─────────────────────────────────────────
setInterval(() => {
  if (gameState !== 'PLAYING') return;
  const len = Math.sqrt(mouse.dx * mouse.dx + mouse.dy * mouse.dy);
  if (len > 5) wsSend({ type: 'MOVE', dx: mouse.dx, dy: mouse.dy });
}, TICK_MS);

// ── 타이머 갱신 ──────────────────────────────────────────────────────────────
setInterval(() => {
  if (gameState !== 'PLAYING') return;
  const elapsed = Date.now() - lastTimerSync;
  const left    = Math.max(0, sessionTimeLeft - elapsed);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  timerVal.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}, 200);

// ── 60fps 렌더 루프 ───────────────────────────────────────────────────────────
function renderFrame(ts) {
  requestAnimationFrame(renderFrame);

  const W = window.innerWidth, H = window.innerHeight;
  ctx.clearRect(0, 0, W, H);

  if (gameState !== 'PLAYING') {
    drawBackground(0, 0, W, H, 0, 0);
    return;
  }

  // 카메라 추적 (내 플레이어 중심 보간)
  let camLX = FIELD_W / 2, camLY = FIELD_H / 2;
  const myIpCam = interpMap.get(myId);
  if (myIpCam) {
    const t = Math.min(1, (Date.now() - myIpCam.serverTs) / TICK_MS);
    camLX = lerp(myIpCam.prev.x, myIpCam.cur.x, t);
    camLY = lerp(myIpCam.prev.y, myIpCam.cur.y, t);
  }
  cam.x     = camLX - VIEWPORT_W / 2;
  cam.y     = camLY - VIEWPORT_H / 2;
  cam.scale = Math.min(W / VIEWPORT_W, H / VIEWPORT_H);

  // ── 월드 스페이스 변환 적용 ──────────────────────────────────────────────
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-camLX, -camLY);

  drawBackground(cam.x - 200, cam.y - 200, FIELD_W + 400, FIELD_H + 400, camLX, camLY);
  drawField();
  drawItems();
  drawKnnGlow();
  drawPlayers();
  drawParticles();

  ctx.restore(); // 월드 변환 해제

  // ── 스크린 스페이스 오버레이 (월드 변환 영향 없음) ──────────────────────
  renderDangerVignette(W, H, ts);
  renderMinimap(W, H);
}

// ── 배경 그리기 ──────────────────────────────────────────────────────────────
function drawBackground(ox, oy, ow, oh, cx, cy) {
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, FIELD_H * 0.8);
  grd.addColorStop(0, '#13192a');
  grd.addColorStop(1, '#0d1117');
  ctx.fillStyle = grd;
  ctx.fillRect(ox, oy, ow, oh);

  // 격자
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth   = 1;
  const grid = 100;
  for (let x = 0; x <= FIELD_W; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, FIELD_H); ctx.stroke();
  }
  for (let y = 0; y <= FIELD_H; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FIELD_W, y); ctx.stroke();
  }
}

// ── 필드 외곽 경계 ────────────────────────────────────────────────────────────
function drawField() {
  ctx.strokeStyle = 'rgba(41,182,246,.3)';
  ctx.lineWidth   = 3;
  ctx.strokeRect(0, 0, FIELD_W, FIELD_H);
}

// ── 아이템 렌더 (미션 강조 + 스폰 애니메이션) ────────────────────────────────
function drawItems() {
  const now = Date.now();
  for (const item of itemCache.values()) {
    const isHint    = knnHintIds.includes(item.itemId);
    const isMission = !!item.missionMatch;
    const color     = isMission ? COLOR.FOOD_MATCH : COLOR.FOOD_NEUTRAL;

    ctx.save();

    // ── 스폰 애니메이션: 0.2→1 scale, 500ms ─────────────────────────────
    let spawnScale = 1;
    const spawnTs  = itemAnims.get(item.itemId);
    if (spawnTs !== undefined) {
      const elapsed = now - spawnTs;
      if (elapsed < 500) {
        spawnScale = 0.2 + 0.8 * (elapsed / 500);
      } else {
        itemAnims.delete(item.itemId);
      }
    }

    // ── 펄스 radius (미션 일치: 1+0.35×sin(now/350)) ─────────────────────
    const baseR = item.radius || 8;
    const drawR = isMission
      ? baseR * (1 + 0.35 * Math.sin(now / 350)) * spawnScale
      : baseR * spawnScale;

    // ── kNN 글로우 (배경 후광) ────────────────────────────────────────────
    if (isHint && knnConf >= 0.4) {
      const t   = (now % 800) / 800;
      const opc = knnConf >= 0.6
        ? Math.sin(t * Math.PI)
        : Math.sin(t * Math.PI) * 0.5;
      const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, drawR * 4);
      glow.addColorStop(0, `rgba(0,229,255,${opc * 0.7})`);
      glow.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(item.x, item.y, drawR * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 미션 일치: 강한 라디얼 글로우 ───────────────────────────────────
    if (isMission) {
      const mglow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, drawR * 3.5);
      mglow.addColorStop(0, 'rgba(255,215,64,0.55)');
      mglow.addColorStop(1, 'rgba(255,215,64,0)');
      ctx.fillStyle = mglow;
      ctx.beginPath();
      ctx.arc(item.x, item.y, drawR * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 본체 ──────────────────────────────────────────────────────────────
    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = isMission ? 16 : 8;
    ctx.beginPath();
    ctx.arc(item.x, item.y, drawR, 0, Math.PI * 2);
    ctx.fill();

    // ── 미션 일치: 외곽 링 ───────────────────────────────────────────────
    if (isMission) {
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = COLOR.FOOD_MATCH;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(item.x, item.y, drawR + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── 식품 이름 (미션 일치: 항상 bold, 일반: 확대 시만) ─────────────
    ctx.shadowBlur = 0;
    if (isMission || cam.scale > 0.7) {
      ctx.fillStyle    = 'rgba(255,255,255,.9)';
      ctx.font         = isMission ? 'bold 10px sans-serif' : '9px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.displayName || '', item.x, item.y - drawR - 2);
    }

    ctx.restore();
  }
}

// ── kNN 힌트 아이템 외곽 링 ───────────────────────────────────────────────────
function drawKnnGlow() {
  if (!knnHintIds.length) return;
  const t   = (Date.now() % 800) / 800;
  const opc = knnConf >= 0.6 ? Math.sin(t * Math.PI) : Math.sin(t * Math.PI) * 0.5;
  for (const iid of knnHintIds) {
    const it = itemCache.get(iid);
    if (!it) continue;
    ctx.save();
    ctx.strokeStyle = `rgba(0,229,255,${opc})`;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(it.x, it.y, (it.radius || 8) + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── 플레이어 렌더 (보간 적용) ─────────────────────────────────────────────────
function drawPlayers() {
  const now = Date.now();
  for (const [pid, ip] of interpMap) {
    const elapsed = now - ip.serverTs;
    const t = Math.min(1, elapsed / TICK_MS);
    const x = lerp(ip.prev.x,              ip.cur.x,              t);
    const y = lerp(ip.prev.y,              ip.cur.y,              t);
    const r = lerp(ip.prev.radius || 20,   ip.cur.radius   || 20, t);

    const isMe    = pid === myId;
    const state   = ip.cur.state;
    const isInv   = state === 'INVINCIBLE';
    const isDead  = state === 'DEAD';
    if (isDead) continue;

    const baseColor = isMe ? COLOR.PLAYER_SELF : COLOR.PLAYER_OTHER;

    ctx.save();

    // 무적 구간 반투명 깜빡임
    if (isInv) ctx.globalAlpha = 0.4 + 0.4 * Math.abs(Math.sin(now / 200));

    // 본체 + 글로우
    ctx.shadowColor = baseColor;
    ctx.shadowBlur  = isMe ? 18 : 10;
    ctx.fillStyle   = baseColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 테두리
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(255,255,255,.5)';
    ctx.lineWidth   = isMe ? 2 : 1;
    ctx.stroke();

    ctx.restore();

    // 닉네임 (shadow 분리)
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,.9)';
    ctx.font         = `bold ${Math.max(10, r * 0.6)}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 3;
    ctx.shadowColor  = '#000';
    const nick = ip.cur.nickname || '';
    ctx.fillText(nick.length > 6 ? nick.slice(0, 5) + '…' : nick, x, y);
    ctx.restore();

    // 점수 (아래)
    ctx.save();
    ctx.fillStyle    = COLOR.FOOD_MATCH;
    ctx.font         = `${Math.max(9, r * 0.5)}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(ip.cur.score, x, y + r + 3);
    ctx.restore();
  }
}

// ── 파티클 렌더 ──────────────────────────────────────────────────────────────
function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx * 0.016;
    p.y    += p.vy * 0.016;
    p.vx   *= 0.93;
    p.vy   *= 0.93;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── 미니맵 (스크린 스페이스, ctx.restore() 이후) ─────────────────────────────
function renderMinimap(W, H) {
  if (gameState !== 'PLAYING') return;

  const MM_W = 150, MM_H = 108;
  const MM_X = W - MM_W - 12;
  const MM_Y = H - MM_H - 12;

  ctx.save();

  // 배경
  ctx.fillStyle = 'rgba(13,17,23,0.92)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(MM_X, MM_Y, MM_W, MM_H, 6);
  } else {
    ctx.rect(MM_X, MM_Y, MM_W, MM_H);
  }
  ctx.fill();

  // 테두리
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // 클립 영역 (미니맵 안으로 제한)
  ctx.beginPath();
  ctx.rect(MM_X, MM_Y, MM_W, MM_H);
  ctx.clip();

  // 월드→미니맵 좌표 변환 계수
  const scaleX = MM_W / FIELD_W;
  const scaleY = MM_H / FIELD_H;
  const now    = Date.now();

  // 아이템 도트
  for (const item of itemCache.values()) {
    const mx = MM_X + item.x * scaleX;
    const my = MM_Y + item.y * scaleY;
    ctx.fillStyle   = item.missionMatch ? COLOR.FOOD_MATCH : COLOR.FOOD_NEUTRAL;
    ctx.globalAlpha = item.missionMatch ? 1.0 : 0.65;
    ctx.beginPath();
    ctx.arc(mx, my, item.missionMatch ? 2 : 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 타 플레이어 도트
  for (const [pid, ip] of interpMap) {
    if (pid === myId) continue;
    if (ip.cur.state === 'DEAD') continue;
    const t  = Math.min(1, (now - ip.serverTs) / TICK_MS);
    const wx = lerp(ip.prev.x, ip.cur.x, t);
    const wy = lerp(ip.prev.y, ip.cur.y, t);
    ctx.fillStyle = COLOR.PLAYER_OTHER;
    ctx.beginPath();
    ctx.arc(MM_X + wx * scaleX, MM_Y + wy * scaleY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 내 플레이어 도트 (글로우)
  const myIp = interpMap.get(myId);
  if (myIp && myIp.cur.state !== 'DEAD') {
    const t   = Math.min(1, (now - myIp.serverTs) / TICK_MS);
    const wx  = lerp(myIp.prev.x, myIp.cur.x, t);
    const wy  = lerp(myIp.prev.y, myIp.cur.y, t);
    const mmx = MM_X + wx * scaleX;
    const mmy = MM_Y + wy * scaleY;
    ctx.shadowColor = COLOR.PLAYER_SELF;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = COLOR.PLAYER_SELF;
    ctx.beginPath();
    ctx.arc(mmx, mmy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ── 위험 비네팅 (스크린 스페이스, ctx.restore() 이후) ────────────────────────
function renderDangerVignette(W, H, ts) {
  if (gameState !== 'PLAYING') return;

  const myIp = interpMap.get(myId);
  if (!myIp) return;

  const st = myIp.cur.state;
  if (st === 'DEAD' || st === 'INVINCIBLE') return;

  const now  = Date.now();
  const tMe  = Math.min(1, (now - myIp.serverTs) / TICK_MS);
  const myX  = lerp(myIp.prev.x,              myIp.cur.x,              tMe);
  const myY  = lerp(myIp.prev.y,              myIp.cur.y,              tMe);
  const myR  = lerp(myIp.prev.radius || 20,   myIp.cur.radius  || 20,  tMe);

  const dangerThreshR = myR * 1.25; // 이 크기 이상의 적만 위험
  const dangerDist    = 450;        // 논리 좌표 기준 감지 반경

  let maxDanger = 0;
  for (const [pid, ip] of interpMap) {
    if (pid === myId) continue;
    const est = ip.cur.state;
    if (est === 'DEAD' || est === 'INVINCIBLE') continue;
    const tE = Math.min(1, (now - ip.serverTs) / TICK_MS);
    const er = lerp(ip.prev.radius || 20, ip.cur.radius || 20, tE);
    if (er < dangerThreshR) continue; // 나보다 작은 적 제외
    const ex   = lerp(ip.prev.x, ip.cur.x, tE);
    const ey   = lerp(ip.prev.y, ip.cur.y, tE);
    const dist = Math.hypot(ex - myX, ey - myY);
    if (dist < dangerDist) {
      const danger = 1 - dist / dangerDist;
      if (danger > maxDanger) maxDanger = danger;
    }
  }

  if (maxDanger <= 0) return;

  // α = danger × 0.45 × pulse  (pulse = 0.55+0.45×sin(now/180))
  const pulse = 0.55 + 0.45 * Math.sin(now / 180);
  const alpha = maxDanger * 0.45 * pulse;

  const cx = W / 2, cy = H / 2;
  const outerR = Math.max(W, H) * 0.72;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
  grd.addColorStop(0,    'rgba(220,30,30,0)');
  grd.addColorStop(0.55, 'rgba(220,30,30,0)');
  grd.addColorStop(1,    `rgba(220,30,30,${alpha.toFixed(3)})`);

  ctx.save();
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ── 닉네임 화면 ──────────────────────────────────────────────────────────────
$('join-btn').addEventListener('click', () => {
  const raw = $('nickname-input').value.trim().slice(0, 8);
  nickname = raw || '익명';
  nicknameScreen.classList.add('hidden');
  connect();
  showLobby();
  setTimeout(() => wsSend({ type: 'NICKNAME', nickname }), 500);
});
$('nickname-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('join-btn').click();
});

// ── 렌더 시작 ────────────────────────────────────────────────────────────────
requestAnimationFrame(renderFrame);
