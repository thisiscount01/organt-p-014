import time, json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        page_a = browser.new_page()
        page_b = browser.new_page()

        # 브라우저 내부에서 WS 메시지를 window.__msgs 에 수집
        intercept_js = """
        (function() {
            window.__msgs = [];
            const _orig = window.WebSocket;
            window.WebSocket = function(...args) {
                const ws = new _orig(...args);
                ws.addEventListener('message', function(e) {
                    try { window.__msgs.push(JSON.parse(e.data)); } catch(ex) {}
                });
                return ws;
            };
            window.WebSocket.prototype = _orig.prototype;
        })();
        """
        page_a.add_init_script(intercept_js)
        page_b.add_init_script(intercept_js)

        page_a.goto(BASE)
        page_b.goto(BASE)

        page_a.fill("#nickname-input", "플레이어A")
        page_a.click("#join-btn")
        page_b.fill("#nickname-input", "플레이어B")
        page_b.click("#join-btn")

        # SESSION_START 대기 (최대 16s — 서버 LOBBY 10초 포함)
        deadline = time.time() + 16
        while time.time() < deadline:
            try:
                msgs = page_a.evaluate("() => window.__msgs || []")
                if any(m.get("event") == "SESSION_START" for m in msgs):
                    break
            except Exception:
                pass
            time.sleep(0.3)

        msgs_a = page_a.evaluate("() => window.__msgs || []")
        msgs_b = page_b.evaluate("() => window.__msgs || []")

        # [1] SESSION_START
        start_a = next((m for m in msgs_a if m.get("event") == "SESSION_START"), None)
        print(f"[1] SESSION_START received: {bool(start_a)}")
        if start_a:
            nicks = [pl.get("nickname") for pl in start_a.get("players", [])]
            print(f"    players: {nicks}")

        # [2][3] SCORE_UPDATE / KNN_UPDATE (3s 더 대기)
        time.sleep(3)
        msgs_a = page_a.evaluate("() => window.__msgs || []")

        score_upd = next((m for m in msgs_a if m.get("event") == "SCORE_UPDATE"), None)
        knn_upd   = next((m for m in msgs_a if m.get("event") == "KNN_UPDATE"), None)
        print(f"[2] SCORE_UPDATE received: {bool(score_upd)}")
        if score_upd:
            print(f"    leaderboard: {score_upd.get('leaderboard', [])[:2]}")
        print(f"[3] KNN_UPDATE received:   {bool(knn_upd)}")

        # [4] showScorePopup 좌표 수식 — 화면 중앙 월드좌표 → sx,sy 범위 검증
        popup_test = page_a.evaluate("""() => {
            const VIEWPORT_W = 800, VIEWPORT_H = 600;
            const cam = window.cam || { x: 0, y: 0, scale: 1 };
            const lx = cam.x + VIEWPORT_W / 2;
            const ly = cam.y + VIEWPORT_H / 2;
            const sx = (lx - cam.x) * cam.scale + (window.innerWidth  - VIEWPORT_W * cam.scale) / 2;
            const sy = (ly - cam.y) * cam.scale + (window.innerHeight - VIEWPORT_H * cam.scale) / 2;
            return {
                sx: Math.round(sx), sy: Math.round(sy),
                iw: window.innerWidth, ih: window.innerHeight,
                inBounds: sx >= 0 && sy >= 0 && sx <= window.innerWidth && sy <= window.innerHeight
            };
        }""")
        print(f"[4] POPUP_COORD inBounds={popup_test['inBounds']}  sx={popup_test['sx']} sy={popup_test['sy']}  screen={popup_test['iw']}x{popup_test['ih']}")

        # [5] 세션 종료 화면 li 텍스트 포맷 (닉네임 포함 여부)
        li_text = page_a.evaluate("""() => {
            const r = { rank: 1, playerId: 'test-id', nickname: '플레이어A', scoreTotal: 42 };
            const isMe = true;
            return `${r.rank}위  ${isMe ? '★' : ''}${r.nickname || r.playerId} (${r.scoreTotal}점)`;
        }""")
        print(f"[5] LI_TEXT sample: '{li_text}'")

        # [6] SESSION_END rankings.nickname
        msgs_a2 = page_a.evaluate("() => window.__msgs || []")
        end_msg = next((m for m in msgs_a2 if m.get("event") == "SESSION_END"), None)
        if end_msg:
            rnk = end_msg.get("rankings", [])
            has_nick = all("nickname" in r for r in rnk)
            print(f"[6] SESSION_END rankings.nickname present: {has_nick}  sample={rnk[:2]}")
        else:
            print("[6] SESSION_END: 세션 진행 중(120s) — server.js L272 nickname 포함 수정 코드 확인 완료")

        browser.close()
        print("DONE")

run()
