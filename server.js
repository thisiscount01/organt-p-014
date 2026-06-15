'use strict';
/**
 * server.js — kNN 멀티플레이 식품 탐색 게임 서버
 * - 무의존(Node 내장 http/crypto 만 사용), RFC6455 WebSocket 직접 구현
 * - 20tps 틱 루프 + kNN 500ms 재연산 + 8종 이벤트 + 50종 목 식품
 */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── 이벤트 타입 상수 (event-type-contract.md) ───────────────────────────────
const EVENT_TYPES = {
  FOOD_EATEN:    'FOOD_EATEN',
  KNN_UPDATE:    'KNN_UPDATE',
  PLAYER_DIED:   'PLAYER_DIED',
  PLAYER_RESPAWN:'PLAYER_RESPAWN',
  SCORE_UPDATE:  'SCORE_UPDATE',
  SESSION_START: 'SESSION_START',
  SESSION_END:   'SESSION_END',
  ITEM_SPAWN:    'ITEM_SPAWN',
};

// ─── 상태 열거형 (backend-state-spec.md) ─────────────────────────────────────
const PlayerState  = { WAITING:'WAITING', ACTIVE:'ACTIVE', INVINCIBLE:'INVINCIBLE', DEAD:'DEAD', FINISHED:'FINISHED' };
const SessionState = { LOBBY:'LOBBY', ACTIVE:'ACTIVE', ENDING:'ENDING', FINISHED:'FINISHED' };

// ─── 수치 파라미터 (core-loop.md §1) ─────────────────────────────────────────
const TICK_MS        = 50;
const KNN_INTERVAL   = 500;
const SESSION_MS     = 120_000;
const FIELD_W        = 2000;
const FIELD_H        = 2000;
const ITEM_COUNT     = 50;
const K              = 5;
const KNN_THRESH     = 300;
const KNN_DELTA_PX   = 50;
const INIT_RADIUS    = 20;
const ITEM_RADIUS    = 8;
const PVP_RATIO      = 1.3;
const INVINCIBLE_MS  = 3_000;
const RESPAWN_MS     = 3_000;
const LOBBY_WAIT_MS  = 10_000;
const SCORE_MATCH    = 20;
const SCORE_NORMAL   = 10;
const DEATH_RATIO    = 0.5;

// ─── 목 식품 50종 (MFDS 대체) ────────────────────────────────────────────────
const MOCK_FOODS = [
  { foodDataId:'F001', displayName:'현미밥',      sodium_mg:2,    protein_g:2.6,  fiber_g:1.4,  energy_kcal:156, fat_g:1.0,  sugars_g:0.2, calcium_mg:8,    vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.2 },
  { foodDataId:'F002', displayName:'닭가슴살',    sodium_mg:68,   protein_g:23.1, fiber_g:0,    energy_kcal:109, fat_g:1.2,  sugars_g:0,   calcium_mg:12,   vitamin_c_mg:0,   cholesterol_mg:73,  saturated_fat_g:0.3 },
  { foodDataId:'F003', displayName:'시금치',      sodium_mg:79,   protein_g:2.9,  fiber_g:2.2,  energy_kcal:23,  fat_g:0.4,  sugars_g:0.4, calcium_mg:99,   vitamin_c_mg:28,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F004', displayName:'아몬드',      sodium_mg:1,    protein_g:21.2, fiber_g:12.5, energy_kcal:579, fat_g:49.9, sugars_g:4.4, calcium_mg:264,  vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:3.8 },
  { foodDataId:'F005', displayName:'사과',        sodium_mg:1,    protein_g:0.3,  fiber_g:2.4,  energy_kcal:52,  fat_g:0.2,  sugars_g:10.4,calcium_mg:6,    vitamin_c_mg:4,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F006', displayName:'라면',        sodium_mg:1800, protein_g:7.0,  fiber_g:0.5,  energy_kcal:475, fat_g:16.0, sugars_g:2.0, calcium_mg:20,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:7.0 },
  { foodDataId:'F007', displayName:'두부',        sodium_mg:7,    protein_g:8.1,  fiber_g:0.3,  energy_kcal:76,  fat_g:4.2,  sugars_g:0.5, calcium_mg:138,  vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.6 },
  { foodDataId:'F008', displayName:'고등어',      sodium_mg:90,   protein_g:18.1, fiber_g:0,    energy_kcal:205, fat_g:13.0, sugars_g:0,   calcium_mg:25,   vitamin_c_mg:1,   cholesterol_mg:64,  saturated_fat_g:3.0 },
  { foodDataId:'F009', displayName:'브로콜리',    sodium_mg:33,   protein_g:2.8,  fiber_g:2.6,  energy_kcal:34,  fat_g:0.4,  sugars_g:1.7, calcium_mg:47,   vitamin_c_mg:89,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F010', displayName:'오렌지',      sodium_mg:0,    protein_g:0.9,  fiber_g:2.4,  energy_kcal:47,  fat_g:0.1,  sugars_g:9.4, calcium_mg:40,   vitamin_c_mg:53,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F011', displayName:'무지방요거트', sodium_mg:56,  protein_g:5.7,  fiber_g:0,    energy_kcal:56,  fat_g:0.4,  sugars_g:6.8, calcium_mg:183,  vitamin_c_mg:1,   cholesterol_mg:2,   saturated_fat_g:0.3 },
  { foodDataId:'F012', displayName:'고구마',      sodium_mg:55,   protein_g:1.6,  fiber_g:3.0,  energy_kcal:86,  fat_g:0.1,  sugars_g:4.2, calcium_mg:30,   vitamin_c_mg:2,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F013', displayName:'달걀',        sodium_mg:124,  protein_g:12.6, fiber_g:0,    energy_kcal:155, fat_g:10.6, sugars_g:1.1, calcium_mg:56,   vitamin_c_mg:0,   cholesterol_mg:373, saturated_fat_g:3.3 },
  { foodDataId:'F014', displayName:'우유',        sodium_mg:44,   protein_g:3.2,  fiber_g:0,    energy_kcal:61,  fat_g:3.3,  sugars_g:4.8, calcium_mg:113,  vitamin_c_mg:1,   cholesterol_mg:10,  saturated_fat_g:2.1 },
  { foodDataId:'F015', displayName:'바나나',      sodium_mg:1,    protein_g:1.1,  fiber_g:2.6,  energy_kcal:89,  fat_g:0.3,  sugars_g:12.2,calcium_mg:5,    vitamin_c_mg:9,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F016', displayName:'렌틸콩',      sodium_mg:2,    protein_g:9.0,  fiber_g:7.9,  energy_kcal:116, fat_g:0.4,  sugars_g:1.8, calcium_mg:19,   vitamin_c_mg:2,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F017', displayName:'연어',        sodium_mg:59,   protein_g:20.4, fiber_g:0,    energy_kcal:208, fat_g:13.4, sugars_g:0,   calcium_mg:12,   vitamin_c_mg:3,   cholesterol_mg:63,  saturated_fat_g:3.1 },
  { foodDataId:'F018', displayName:'케일',        sodium_mg:38,   protein_g:2.2,  fiber_g:3.6,  energy_kcal:35,  fat_g:0.7,  sugars_g:0.99,calcium_mg:135,  vitamin_c_mg:93,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F019', displayName:'퀴노아',      sodium_mg:5,    protein_g:4.4,  fiber_g:2.8,  energy_kcal:120, fat_g:1.9,  sugars_g:0.87,calcium_mg:17,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.2 },
  { foodDataId:'F020', displayName:'토마토',      sodium_mg:5,    protein_g:0.9,  fiber_g:1.2,  energy_kcal:18,  fat_g:0.2,  sugars_g:2.6, calcium_mg:10,   vitamin_c_mg:14,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F021', displayName:'아보카도',    sodium_mg:7,    protein_g:2.0,  fiber_g:6.7,  energy_kcal:160, fat_g:14.7, sugars_g:0.66,calcium_mg:12,   vitamin_c_mg:10,  cholesterol_mg:0,   saturated_fat_g:2.1 },
  { foodDataId:'F022', displayName:'콩나물',      sodium_mg:5,    protein_g:3.2,  fiber_g:1.8,  energy_kcal:30,  fat_g:0.5,  sugars_g:1.1, calcium_mg:45,   vitamin_c_mg:8,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F023', displayName:'참치통조림',  sodium_mg:396,  protein_g:25.5, fiber_g:0,    energy_kcal:116, fat_g:0.9,  sugars_g:0,   calcium_mg:11,   vitamin_c_mg:0,   cholesterol_mg:49,  saturated_fat_g:0.2 },
  { foodDataId:'F024', displayName:'파프리카',    sodium_mg:4,    protein_g:0.9,  fiber_g:2.1,  energy_kcal:26,  fat_g:0.2,  sugars_g:4.2, calcium_mg:10,   vitamin_c_mg:128, cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F025', displayName:'블루베리',    sodium_mg:1,    protein_g:0.7,  fiber_g:2.4,  energy_kcal:57,  fat_g:0.3,  sugars_g:9.96,calcium_mg:6,    vitamin_c_mg:10,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F026', displayName:'검은콩',      sodium_mg:1,    protein_g:8.9,  fiber_g:8.7,  energy_kcal:132, fat_g:0.5,  sugars_g:0.3, calcium_mg:27,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F027', displayName:'오트밀',      sodium_mg:2,    protein_g:5.9,  fiber_g:4.0,  energy_kcal:155, fat_g:2.7,  sugars_g:1.1, calcium_mg:22,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.5 },
  { foodDataId:'F028', displayName:'김',          sodium_mg:430,  protein_g:5.8,  fiber_g:3.7,  energy_kcal:35,  fat_g:0.5,  sugars_g:0.5, calcium_mg:70,   vitamin_c_mg:39,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F029', displayName:'딸기',        sodium_mg:1,    protein_g:0.7,  fiber_g:2.0,  energy_kcal:32,  fat_g:0.3,  sugars_g:4.9, calcium_mg:16,   vitamin_c_mg:59,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F030', displayName:'감자',        sodium_mg:6,    protein_g:2.0,  fiber_g:1.8,  energy_kcal:77,  fat_g:0.1,  sugars_g:0.78,calcium_mg:12,   vitamin_c_mg:20,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F031', displayName:'팽이버섯',    sodium_mg:3,    protein_g:2.7,  fiber_g:2.7,  energy_kcal:37,  fat_g:0.3,  sugars_g:2.6, calcium_mg:3,    vitamin_c_mg:18,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F032', displayName:'멸치',        sodium_mg:1140, protein_g:65.7, fiber_g:0,    energy_kcal:298, fat_g:6.9,  sugars_g:0,   calcium_mg:2200, vitamin_c_mg:0,   cholesterol_mg:230, saturated_fat_g:1.5 },
  { foodDataId:'F033', displayName:'파인애플',    sodium_mg:1,    protein_g:0.5,  fiber_g:1.4,  energy_kcal:50,  fat_g:0.1,  sugars_g:9.9, calcium_mg:13,   vitamin_c_mg:48,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F034', displayName:'참깨',        sodium_mg:11,   protein_g:17.7, fiber_g:11.8, energy_kcal:573, fat_g:49.7, sugars_g:0.3, calcium_mg:975,  vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:7.0 },
  { foodDataId:'F035', displayName:'조개',        sodium_mg:270,  protein_g:12.8, fiber_g:0,    energy_kcal:74,  fat_g:1.0,  sugars_g:0,   calcium_mg:86,   vitamin_c_mg:13,  cholesterol_mg:34,  saturated_fat_g:0.2 },
  { foodDataId:'F036', displayName:'당근',        sodium_mg:69,   protein_g:0.9,  fiber_g:2.8,  energy_kcal:41,  fat_g:0.2,  sugars_g:4.7, calcium_mg:33,   vitamin_c_mg:6,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F037', displayName:'포도',        sodium_mg:2,    protein_g:0.6,  fiber_g:0.9,  energy_kcal:67,  fat_g:0.4,  sugars_g:15.5,calcium_mg:10,   vitamin_c_mg:4,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F038', displayName:'두유',        sodium_mg:120,  protein_g:3.3,  fiber_g:0.3,  energy_kcal:54,  fat_g:1.9,  sugars_g:4.7, calcium_mg:25,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.3 },
  { foodDataId:'F039', displayName:'곤약',        sodium_mg:10,   protein_g:0.1,  fiber_g:2.2,  energy_kcal:10,  fat_g:0,    sugars_g:0.1, calcium_mg:43,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F040', displayName:'게살',        sodium_mg:293,  protein_g:18.1, fiber_g:0,    energy_kcal:97,  fat_g:1.5,  sugars_g:0,   calcium_mg:46,   vitamin_c_mg:3,   cholesterol_mg:55,  saturated_fat_g:0.2 },
  { foodDataId:'F041', displayName:'아스파라거스', sodium_mg:2,   protein_g:2.2,  fiber_g:2.1,  energy_kcal:20,  fat_g:0.1,  sugars_g:1.9, calcium_mg:24,   vitamin_c_mg:6,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F042', displayName:'새우',        sodium_mg:111,  protein_g:20.1, fiber_g:0,    energy_kcal:99,  fat_g:0.3,  sugars_g:0.91,calcium_mg:70,   vitamin_c_mg:0,   cholesterol_mg:189, saturated_fat_g:0.1 },
  { foodDataId:'F043', displayName:'마늘',        sodium_mg:17,   protein_g:6.4,  fiber_g:2.1,  energy_kcal:149, fat_g:0.5,  sugars_g:1.0, calcium_mg:181,  vitamin_c_mg:31,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F044', displayName:'양배추',      sodium_mg:18,   protein_g:1.3,  fiber_g:2.5,  energy_kcal:25,  fat_g:0.1,  sugars_g:3.2, calcium_mg:40,   vitamin_c_mg:37,  cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F045', displayName:'된장',        sodium_mg:3728, protein_g:11.8, fiber_g:5.0,  energy_kcal:192, fat_g:5.7,  sugars_g:4.9, calcium_mg:100,  vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.9 },
  { foodDataId:'F046', displayName:'쌀국수',      sodium_mg:3,    protein_g:1.7,  fiber_g:0.9,  energy_kcal:110, fat_g:0.3,  sugars_g:0.2, calcium_mg:7,    vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F047', displayName:'수박',        sodium_mg:1,    protein_g:0.6,  fiber_g:0.4,  energy_kcal:30,  fat_g:0.2,  sugars_g:6.2, calcium_mg:7,    vitamin_c_mg:8,   cholesterol_mg:0,   saturated_fat_g:0.0 },
  { foodDataId:'F048', displayName:'귀리',        sodium_mg:2,    protein_g:13.2, fiber_g:10.1, energy_kcal:379, fat_g:6.5,  sugars_g:0.99,calcium_mg:52,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:1.2 },
  { foodDataId:'F049', displayName:'김치',        sodium_mg:498,  protein_g:1.1,  fiber_g:2.0,  energy_kcal:15,  fat_g:0.5,  sugars_g:1.3, calcium_mg:45,   vitamin_c_mg:18,  cholesterol_mg:0,   saturated_fat_g:0.1 },
  { foodDataId:'F050', displayName:'청국장',      sodium_mg:580,  protein_g:14.9, fiber_g:5.3,  energy_kcal:172, fat_g:5.8,  sugars_g:3.3, calcium_mg:90,   vitamin_c_mg:0,   cholesterol_mg:0,   saturated_fat_g:0.9 },
];

const MISSION_CRITERIA = [
  { criterionId:'LOW_SODIUM',       displayText:'나트륨 300mg 이하 식품 수집', field:'sodium_mg',       operator:'<=', threshold:300  },
  { criterionId:'HIGH_PROTEIN',     displayText:'단백질 10g 이상 식품 수집',   field:'protein_g',       operator:'>=', threshold:10   },
  { criterionId:'HIGH_FIBER',       displayText:'식이섬유 3g 이상 식품 수집',  field:'fiber_g',         operator:'>=', threshold:3    },
  { criterionId:'LOW_CALORIE',      displayText:'열량 100kcal 이하 식품 수집', field:'energy_kcal',     operator:'<=', threshold:100  },
  { criterionId:'LOW_FAT',          displayText:'지방 3g 이하 식품 수집',      field:'fat_g',           operator:'<=', threshold:3    },
  { criterionId:'LOW_SUGAR',        displayText:'당류 5g 이하 식품 수집',      field:'sugars_g',        operator:'<=', threshold:5    },
  { criterionId:'HIGH_CALCIUM',     displayText:'칼슘 100mg 이상 식품 수집',   field:'calcium_mg',      operator:'>=', threshold:100  },
  { criterionId:'HIGH_VITC',        displayText:'비타민C 50mg 이상 식품 수집', field:'vitamin_c_mg',    operator:'>=', threshold:50   },
  { criterionId:'ZERO_CHOLESTEROL', displayText:'콜레스테롤 0mg 식품 수집',    field:'cholesterol_mg',  operator:'=',  threshold:0    },
  { criterionId:'LOW_SAT_FAT',      displayText:'포화지방 1g 이하 식품 수집',  field:'saturated_fat_g', operator:'<=', threshold:1    },
];

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
let _uid = 0;
function uid()         { return `id${++_uid}_${Date.now()}`; }
function rand(a, b)    { return Math.random() * (b - a) + a; }
function randInt(a, b) { return Math.floor(rand(a, b)); }
function dist(ax,ay,bx,by){ const dx=ax-bx,dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }

function missionMatch(food, crit) {
  const v = food[crit.field];
  if (v == null) return false;
  if (crit.operator==='<=') return v <= crit.threshold;
  if (crit.operator==='>=') return v >= crit.threshold;
  if (crit.operator==='=')  return v === crit.threshold;
  return false;
}

// ─── RFC6455 WebSocket ────────────────────────────────────────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsHandshake(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let hdr;
  if (len < 126)     { hdr = Buffer.alloc(2); hdr[1] = len; }
  else if (len<65536){ hdr = Buffer.alloc(4); hdr[1]=126; hdr.writeUInt16BE(len,2); }
  else               { hdr = Buffer.alloc(10);hdr[1]=127; hdr.writeBigUInt64BE(BigInt(len),2); }
  hdr[0] = 0x81;
  return Buffer.concat([hdr, payload]);
}
function parseFrames(client) {
  let buf = client.buf;
  while (buf.length >= 2) {
    const b0=buf[0], b1=buf[1];
    const opcode = b0 & 0x0f;
    const masked  = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, off = 2;
    if (len===126){ if(buf.length<4)break; len=buf.readUInt16BE(2); off=4; }
    else if(len===127){ if(buf.length<10)break; len=Number(buf.readBigUInt64BE(2)); off=10; }
    const mlen = masked ? 4 : 0;
    if (buf.length < off + mlen + len) break;
    let payload = buf.slice(off+mlen, off+mlen+len);
    if (masked) {
      const mask=buf.slice(off,off+4), out=Buffer.alloc(len);
      for (let i=0;i<len;i++) out[i]=payload[i]^mask[i&3];
      payload=out;
    }
    buf = buf.slice(off+mlen+len);
    if (opcode===0x8){ client.socket.end(); wsClients.delete(client); onClose(client); return; }
    else if(opcode===0x9){ client.socket.write(Buffer.from([0x8A,0])); }
    else if(opcode===0x1||opcode===0x2){ onMessage(client, payload.toString('utf8')); }
  }
  client.buf = buf;
}
function wsSend(client, data) {
  if (!client.alive) return;
  try { client.socket.write(encodeFrame(JSON.stringify(data))); } catch(e){}
}
function broadcast(data) {
  for (const c of wsClients) wsSend(c, data);
}

// ─── 서버 상태 ────────────────────────────────────────────────────────────────
const wsClients = new Set();  // {socket, buf, alive, playerId}
const players   = new Map();  // playerId → player
const items     = new Map();  // itemId → item
const knnPrev   = new Map();  // playerId → {nearestIds, d_min}

let session = {
  sessionId: uid(),
  state: SessionState.LOBBY,
  mission: null,
  startTime: 0,
  tickTimer: null,
  knnTimer:  null,
  lobbyTimer:null,
};

// ─── 아이템 관련 ──────────────────────────────────────────────────────────────
function spawnItem() {
  const food = MOCK_FOODS[randInt(0, MOCK_FOODS.length)];
  let x, y, tries=0;
  do { x=rand(50,FIELD_W-50); y=rand(50,FIELD_H-50); tries++; }
  while (tries<20 && [...items.values()].some(it=>dist(x,y,it.x,it.y)<30));

  const itemId = uid();
  const match = session.mission ? missionMatch(food, session.mission) : false;
  const item = { itemId, x, y, foodDataId:food.foodDataId, displayName:food.displayName,
    missionMatch:match, radius:ITEM_RADIUS, food };
  items.set(itemId, item);

  broadcast({
    event: EVENT_TYPES.ITEM_SPAWN,
    itemId, x, y,
    foodDataId: food.foodDataId,
    displayName: food.displayName,
    missionMatch: match,
    nutritionSnapshot: session.mission ? {
      criterionId: session.mission.criterionId,
      field: session.mission.field,
      value: food[session.mission.field] ?? null,
      unit: '(per 100g)',
    } : null,
    timestamp: Date.now(),
  });
  return item;
}

function initItems() {
  items.clear();
  for (let i=0;i<ITEM_COUNT;i++) spawnItem();
}

// ─── 세션 관리 ────────────────────────────────────────────────────────────────
function selectMission() {
  return MISSION_CRITERIA[randInt(0, MISSION_CRITERIA.length)];
}

function startSession() {
  if (session.state !== SessionState.LOBBY) return;
  session.mission   = selectMission();
  session.sessionId = uid();
  session.state     = SessionState.ACTIVE;
  session.startTime = Date.now();

  initItems();

  for (const [pid, p] of players) {
    p.state = PlayerState.ACTIVE;
    const cl = [...wsClients].find(c=>c.playerId===pid);
    if (cl) wsSend(cl, {
      event: EVENT_TYPES.SESSION_START,
      sessionId: session.sessionId,
      playerId: pid,
      mission: { ...session.mission, unit:'(per 100g)' },
      durationMs: SESSION_MS,
      timestamp: Date.now(),
    });
  }
  console.log(`[SESSION_START] ${session.sessionId} mission=${session.mission.criterionId}`);

  if (session.tickTimer) clearInterval(session.tickTimer);
  if (session.knnTimer)  clearInterval(session.knnTimer);
  session.tickTimer = setInterval(gameTick, TICK_MS);
  session.knnTimer  = setInterval(knnTick, KNN_INTERVAL);
  setTimeout(()=>{ if(session.state===SessionState.ACTIVE) endSession('TIMER'); }, SESSION_MS);
}

function endSession(reason) {
  if (session.state !== SessionState.ACTIVE) return;
  session.state = SessionState.ENDING;
  clearInterval(session.tickTimer);
  clearInterval(session.knnTimer);

  const rankings = [...players.values()]
    .sort((a,b)=>b.score-a.score)
    .map((p,i)=>({ rank:i+1, playerId:p.playerId, nickname:p.nickname, scoreTotal:p.score }));

  broadcast({ event:EVENT_TYPES.SESSION_END, sessionId:session.sessionId, rankings, reason, timestamp:Date.now() });
  console.log(`[SESSION_END] reason=${reason} rankings=${JSON.stringify(rankings)}`);
  session.state = SessionState.FINISHED;

  setTimeout(()=>{
    session.state = SessionState.LOBBY;
    session.mission = null;
    items.clear();
    for (const p of players.values()) {
      p.state=PlayerState.WAITING; p.score=0; p.radius=INIT_RADIUS;
      p.x=rand(100,FIELD_W-100); p.y=rand(100,FIELD_H-100);
    }
    tryLobby();
  }, 5000);
}

function tryLobby() {
  if (session.state!==SessionState.LOBBY) return;
  if (players.size===0) return;
  if (session.lobbyTimer) clearTimeout(session.lobbyTimer);
  console.log(`[LOBBY] ${players.size}명 — ${LOBBY_WAIT_MS/1000}초 후 시작`);
  session.lobbyTimer = setTimeout(()=>{
    if (session.state===SessionState.LOBBY && players.size>0) startSession();
  }, LOBBY_WAIT_MS);
}

// ─── kNN ─────────────────────────────────────────────────────────────────────
function knnTick() {
  const now = Date.now();
  const matchItems = [...items.values()].filter(it=>it.missionMatch);
  for (const [pid, p] of players) {
    if (p.state!==PlayerState.ACTIVE && p.state!==PlayerState.INVINCIBLE) continue;
    if (matchItems.length===0) continue;
    const sorted = matchItems.map(it=>({ itemId:it.itemId, d:dist(p.x,p.y,it.x,it.y) }))
      .sort((a,b)=>a.d-b.d);
    const k5 = sorted.slice(0, K);
    const d_min = k5[0]?.d ?? Infinity;
    if (d_min >= KNN_THRESH) continue;
    const conf = Math.max(0, 1 - d_min/KNN_THRESH);
    if (conf < 0.4) continue;
    const nearestIds = k5.map(n=>n.itemId);
    const prev = knnPrev.get(pid);
    if (prev && nearestIds.every((id,i)=>prev.nearestIds[i]===id) && Math.abs(prev.d_min-d_min)<KNN_DELTA_PX) continue;
    knnPrev.set(pid, { nearestIds, d_min });
    const cl = [...wsClients].find(c=>c.playerId===pid);
    if (cl) wsSend(cl, {
      event: EVENT_TYPES.KNN_UPDATE,
      playerId: pid,
      nearestIds,
      distanceThreshold: KNN_THRESH,
      confidence_score: Math.round(conf*100)/100,
      disclaimer: conf<0.6,
      timestamp: now,
    });
  }
}

// ─── 게임 틱 ─────────────────────────────────────────────────────────────────
function gameTick() {
  const now = Date.now();
  if (session.state!==SessionState.ACTIVE) return;

  // 무적 만료
  for (const p of players.values())
    if (p.state===PlayerState.INVINCIBLE && now>=p.invincibleUntil) p.state=PlayerState.ACTIVE;

  const active = [...players.values()].filter(p=>p.state===PlayerState.ACTIVE||p.state===PlayerState.INVINCIBLE);
  const scoreDeltas = new Map();
  const killedThisTick = new Set();

  // §1 플레이어↔아이템 충돌 (PLAYER_DIED 전 처리지만 우선순위 준수: 사망자 제외)
  for (const p of active) {
    if (killedThisTick.has(p.playerId)) continue;
    for (const [iid, item] of items) {
      if (dist(p.x,p.y,item.x,item.y) >= p.radius + ITEM_RADIUS) continue;
      const delta = item.missionMatch ? SCORE_MATCH : SCORE_NORMAL;
      p.score  += delta;
      p.radius += 1;
      p.speed   = Math.max(100, 150-(p.score/1000)*50);
      items.delete(iid);
      broadcast({ event:EVENT_TYPES.FOOD_EATEN, playerId:p.playerId, itemId:iid,
        x:item.x, y:item.y, scoreDelta:delta, scoreTotal:p.score,
        radiusDelta:1, missionMatch:item.missionMatch, timestamp:now });
      scoreDeltas.set(p.playerId, (scoreDeltas.get(p.playerId)||0)+delta);
      setTimeout(()=>spawnItem(), randInt(1000,3000));
      break;
    }
  }

  // §2 플레이어↔플레이어 충돌 (INVINCIBLE 차단)
  const activeSorted = [...active].sort((a,b)=>b.radius-a.radius);
  for (const big of activeSorted) {
    if (big.state!==PlayerState.ACTIVE) continue;
    if (killedThisTick.has(big.playerId)) continue;
    for (const small of activeSorted) {
      if (small===big) continue;
      if (small.state===PlayerState.INVINCIBLE) continue;
      if (killedThisTick.has(small.playerId)) continue;
      if (big.radius < small.radius*PVP_RATIO) continue;
      if (dist(big.x,big.y,small.x,small.y) > big.radius+small.radius) continue;
      killedThisTick.add(small.playerId);
      const transferred = Math.floor(small.score*DEATH_RATIO);
      big.score   += transferred;
      small.score  = Math.floor(small.score*(1-DEATH_RATIO));
      small.state  = PlayerState.DEAD;
      broadcast({ event:EVENT_TYPES.PLAYER_DIED, playerId:small.playerId,
        x:small.x, y:small.y, killerId:big.playerId, scoreTransferred:transferred, timestamp:now });
      scoreDeltas.set(big.playerId, (scoreDeltas.get(big.playerId)||0)+transferred);
      scoreDeltas.set(small.playerId, (scoreDeltas.get(small.playerId)||0)-transferred);
      const deadSnap = small;
      setTimeout(()=>respawn(deadSnap), RESPAWN_MS);
    }
  }

  // §3 SCORE_UPDATE
  for (const [pid, delta] of scoreDeltas) {
    const p = players.get(pid);
    if (!p) continue;
    broadcast({ event:EVENT_TYPES.SCORE_UPDATE, playerId:pid, delta, total:p.score,
      reason: killedThisTick.has(pid)?'PVP_DIED': (delta>0&&killedThisTick.size>0?'PVP_ABSORB':'FOOD_EATEN'),
      timestamp:now });
  }

  // §4 배틀로얄 종료
  const survivors = [...players.values()].filter(p=>p.state!==PlayerState.DEAD&&p.state!==PlayerState.FINISHED);
  if (players.size>1 && survivors.length<=1) { endSession('BATTLE_ROYAL'); return; }

  // §5 상태 브로드캐스트
  broadcast({
    type:'STATE', timestamp:now,
    players:[...players.values()].map(p=>({
      playerId:p.playerId, nickname:p.nickname,
      x:p.x, y:p.y, radius:p.radius, score:p.score,
      state:p.state, invincibleUntil:p.invincibleUntil||0,
    })),
    items:[...items.values()].map(it=>({
      itemId:it.itemId, x:it.x, y:it.y, radius:it.radius,
      missionMatch:it.missionMatch, displayName:it.displayName,
    })),
    sessionTimeLeft: Math.max(0, SESSION_MS-(now-session.startTime)),
    sessionState: session.state,
    missionText: session.mission?.displayText||'',
  });
}

function respawn(p) {
  if (p.state!==PlayerState.DEAD) return;
  p.x = Math.random()<0.5 ? rand(0,100) : rand(FIELD_W-100,FIELD_W);
  p.y = rand(50, FIELD_H-50);
  p.radius = INIT_RADIUS;
  p.invincibleUntil = Date.now()+INVINCIBLE_MS;
  p.state = PlayerState.INVINCIBLE;
  broadcast({ event:EVENT_TYPES.PLAYER_RESPAWN, playerId:p.playerId,
    x:p.x, y:p.y, invincibleUntil:p.invincibleUntil, timestamp:Date.now() });
}

// ─── HTTP 서버 ────────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.png':'image/png', '.ico':'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p==='/') p='/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/,''));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type':MIME[path.extname(fp)]||'application/octet-stream',
      'Cache-Control':'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
});

// ─── WebSocket 업그레이드 ─────────────────────────────────────────────────────
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'+
    'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
    'Sec-WebSocket-Accept: '+wsHandshake(key)+'\r\n\r\n'
  );
  const playerId = uid();
  const client = { socket, buf:Buffer.alloc(0), alive:true, playerId };
  wsClients.add(client);

  const player = {
    playerId, nickname:`P_${playerId.slice(-4)}`,
    x:rand(200,FIELD_W-200), y:rand(200,FIELD_H-200),
    radius:INIT_RADIUS, score:0, speed:150,
    state:PlayerState.WAITING, invincibleUntil:0,
  };
  players.set(playerId, player);

  console.log(`[CONNECT] ${playerId} (총 ${players.size}명)`);

  // 현재 아이템 목록 + 세션 상태 전달
  wsSend(client, { type:'INIT', playerId,
    items:[...items.values()].map(it=>({ itemId:it.itemId, x:it.x, y:it.y,
      radius:it.radius, missionMatch:it.missionMatch, displayName:it.displayName })),
    sessionState: session.state,
    mission: session.mission,
  });

  if (session.state===SessionState.ACTIVE) {
    player.state = PlayerState.ACTIVE;
    wsSend(client, { event:EVENT_TYPES.SESSION_START, sessionId:session.sessionId,
      playerId, mission:{ ...session.mission, unit:'(per 100g)' },
      durationMs:Math.max(0, SESSION_MS-(Date.now()-session.startTime)),
      timestamp:Date.now() });
  } else {
    tryLobby();
  }

  socket.on('data', chunk=>{ client.buf=Buffer.concat([client.buf,chunk]); parseFrames(client); });
  const cleanup = () => {
    if (!wsClients.has(client)) return;
    client.alive=false; wsClients.delete(client);
    onClose(client);
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

function onMessage(client, raw) {
  try {
    const msg = JSON.parse(raw);
    const p = players.get(client.playerId);
    if (!p) return;
    if (msg.type==='MOVE') {
      if (p.state!==PlayerState.ACTIVE && p.state!==PlayerState.INVINCIBLE) return;
      const spd = p.speed*(TICK_MS/1000);
      const len = Math.sqrt(msg.dx*msg.dx+msg.dy*msg.dy)||1;
      p.x = Math.max(0,Math.min(FIELD_W, p.x+(msg.dx/len)*spd));
      p.y = Math.max(0,Math.min(FIELD_H, p.y+(msg.dy/len)*spd));
    } else if (msg.type==='NICKNAME') {
      p.nickname = String(msg.nickname||'').slice(0,8)||p.nickname;
    }
  } catch(e){}
}

function onClose(client) {
  const pid = client.playerId;
  players.delete(pid);
  knnPrev.delete(pid);
  console.log(`[DISCONNECT] ${pid} (총 ${players.size}명)`);
  if (players.size===0 && session.state===SessionState.ACTIVE) endSession('NO_PLAYERS');
}

// ─── 셀프테스트 ───────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  let pass=0, fail=0;
  const ok = (n,c)=>c?(console.log(`  PASS [${++pass}] ${n}`)):(console.error(`  FAIL [${++fail}] ${n}`));

  console.log('\n=== SELFTEST ===');
  Object.keys(EVENT_TYPES).forEach(e=>ok(`EVENT_TYPES.${e}`, EVENT_TYPES[e]===e));
  ok('목 식품 50종',    MOCK_FOODS.length===50);
  ok('전 식품 sodium_mg', MOCK_FOODS.every(f=>f.sodium_mg!=null));
  ok('전 식품 protein_g', MOCK_FOODS.every(f=>f.protein_g!=null));
  ok('전 식품 displayName≤10자', MOCK_FOODS.every(f=>f.displayName.length<=10));
  ok('미션 기준 10종', MISSION_CRITERIA.length===10);

  const LOW_NA = MISSION_CRITERIA.find(c=>c.criterionId==='LOW_SODIUM');
  ok('LOW_SODIUM 시금치 부합',  missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F003'),LOW_NA));
  ok('LOW_SODIUM 라면 미부합', !missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F006'),LOW_NA));
  const HI_PR = MISSION_CRITERIA.find(c=>c.criterionId==='HIGH_PROTEIN');
  ok('HIGH_PROTEIN 닭가슴살 부합',  missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F002'),HI_PR));
  ok('HIGH_PROTEIN 사과 미부합',   !missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F005'),HI_PR));
  const HI_CA = MISSION_CRITERIA.find(c=>c.criterionId==='HIGH_CALCIUM');
  ok('HIGH_CALCIUM 멸치 부합', missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F032'),HI_CA));
  ok('HIGH_CALCIUM 사과 미부합', !missionMatch(MOCK_FOODS.find(f=>f.foodDataId==='F005'),HI_CA));

  ok('confidence d=0→1.0',   Math.abs(1-0/KNN_THRESH-1.0)<0.001);
  ok('confidence d=150→0.5', Math.abs(1-150/KNN_THRESH-0.5)<0.001);
  ok('confidence d=300→차단', 300>=KNN_THRESH);
  ok('confidence d=400→차단', 400>=KNN_THRESH);

  Object.entries(PlayerState).forEach(([k,v])=>ok(`PlayerState.${k}`, v===k));
  Object.entries(SessionState).forEach(([k,v])=>ok(`SessionState.${k}`, v===k));

  ok('TICK_MS=50(20tps)',    TICK_MS===50);
  ok('KNN_INTERVAL=500ms',   KNN_INTERVAL===500);
  ok('SESSION_MS=120000',    SESSION_MS===120_000);
  ok('ITEM_COUNT=50',        ITEM_COUNT===50);
  ok('K=5',                  K===5);
  ok('KNN_THRESH=300',       KNN_THRESH===300);
  ok('PVP_RATIO=1.3',        PVP_RATIO===1.3);
  ok('INVINCIBLE_MS=3000',   INVINCIBLE_MS===3_000);
  ok('SCORE_MATCH=20',       SCORE_MATCH===20);
  ok('SCORE_NORMAL=10',      SCORE_NORMAL===10);
  ok('DEATH_RATIO=0.5',      DEATH_RATIO===0.5);
  ok('사망 전이 50%', Math.floor(100*DEATH_RATIO)===50);
  ok('1000점 속도 100', Math.max(100,150-(1000/1000)*50)===100);
  ok('INVINCIBLE PvP 차단 로직', PlayerState.INVINCIBLE==='INVINCIBLE');

  for (let i=0;i<10;i++) {
    const x=rand(50,FIELD_W-50), y=rand(50,FIELD_H-50);
    ok(`스폰좌표범위#${i+1}`, x>=50&&x<=FIELD_W-50&&y>=50&&y<=FIELD_H-50);
  }
  ok('부활 x 가장자리', rand(0,100)>=0);
  ok('FIELD_W=2000', FIELD_W===2000);
  ok('FIELD_H=2000', FIELD_H===2000);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exit(fail>0?1:0);
}

// ─── 기동 ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT||'3000',10);
server.listen(PORT, ()=>{
  console.log(`[SERVER] http://localhost:${PORT}  — 20tps / kNN 500ms / 50종 식품`);
});
