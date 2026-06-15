"""
E2E 검증:
- 2탭 접속 → SESSION_START 수신 → page.evaluate로 MOVE 주입(마우스 이벤트 우회)
- SCORE_UPDATE / FOOD_EATEN(SCORE_UPDATE 콘솔 로그) 확인
"""
import asyncio, json, random, sys
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx1 = await browser.new_context(viewport={"width":1280,"height":720})
        ctx2 = await browser.new_context(viewport={"width":1280,"height":720})
        p1 = await ctx1.new_page()
        p2 = await ctx2.new_page()

        logs1, logs2 = [], []
        p1.on('console', lambda msg: logs1.append(msg.text))
        p2.on('console', lambda msg: logs2.append(msg.text))

        # 닉네임 입력 후 접속
        await p1.goto('http://localhost:3000')
        await p1.fill('#nickname-input', '탭1')
        await p1.click('#join-btn')
        await asyncio.sleep(0.5)

        await p2.goto('http://localhost:3000')
        await p2.fill('#nickname-input', '탭2')
        await p2.click('#join-btn')
        await asyncio.sleep(0.5)

        print('두 탭 접속 완료 — 세션 시작 대기(11초)...')
        await asyncio.sleep(11)

        ss1 = any('[SESSION_START]' in l for l in logs1)
        ss2 = any('[SESSION_START]' in l for l in logs2)
        print(f'[SESSION_START] 탭1={ss1}  탭2={ss2}')

        m1 = await p1.inner_text('#mission-text') if await p1.is_visible('#mission-text') else '(없음)'
        m2 = await p2.inner_text('#mission-text') if await p2.is_visible('#mission-text') else '(없음)'
        print(f'미션 탭1="{m1}"  탭2="{m2}"')

        # ── page.evaluate로 직접 MOVE 메시지를 ws에 주입 ──────────────────────
        # canvas의 mousemove 이벤트를 거치지 않고 ws.send()를 직접 호출
        # 방향을 sweep하며 아이템을 먹도록 N번 반복
        INJECT_JS = """
(dir) => {
    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'MOVE', dx: dir.dx, dy: dir.dy }));
        return true;
    }
    return false;
}
"""
        # 대각선 4방향 + 각 방향 100회씩 총 400회 (=20초 분량 × 20tps)
        directions = [
            {'dx': 200,  'dy': 200},
            {'dx':-200,  'dy': 200},
            {'dx': 200,  'dy':-200},
            {'dx':-200,  'dy':-200},
            {'dx': 300,  'dy':   0},
            {'dx':   0,  'dy': 300},
        ]

        food_eaten = False
        for d in directions:
            for _ in range(60):
                await p1.evaluate(INJECT_JS, d)
                await p2.evaluate(INJECT_JS, {'dx': -d['dx'], 'dy': d['dy']})
                await asyncio.sleep(0.055)  # ~18 fps injection

                # 조기 종료: SCORE_UPDATE 감지
                if any('[SCORE_UPDATE]' in l for l in logs1) or any('[SCORE_UPDATE]' in l for l in logs2):
                    food_eaten = True
                    break
            if food_eaten:
                break

        # 최종 상태 확인
        await asyncio.sleep(1)
        su1 = [l for l in logs1 if '[SCORE_UPDATE]' in l]
        su2 = [l for l in logs2 if '[SCORE_UPDATE]' in l]
        ku1 = [l for l in logs1 if '[KNN_UPDATE]' in l]
        ku2 = [l for l in logs2 if '[KNN_UPDATE]' in l]

        # 리더보드 점수
        scores = await p1.evaluate(
            "Array.from(document.querySelectorAll('.lb-score')).map(e=>+e.textContent)"
        )

        # HUD 타이머
        timer = await p1.inner_text('#timer-val') if await p1.is_visible('#timer-val') else '?'

        print(f'\n[검증 결과]')
        print(f'SESSION_START  탭1={ss1}  탭2={ss2}')
        print(f'미션 텍스트    탭1="{m1}"')
        print(f'KNN_UPDATE     탭1={len(ku1)}회  탭2={len(ku2)}회')
        print(f'SCORE_UPDATE   탭1={len(su1)}회  탭2={len(su2)}회')
        print(f'리더보드 점수  {scores}')
        print(f'세션 타이머    {timer}')
        if su1: print(f'  (첫 SCORE_UPDATE) {su1[0]}')
        if su2: print(f'  (탭2 첫 SCORE_UPDATE) {su2[0]}')

        await p1.screenshot(path='screenshot_final_p1.png')
        await p2.screenshot(path='screenshot_final_p2.png')
        await browser.close()

        passed = ss1 and ss2 and (len(su1)>0 or len(su2)>0 or any(s>0 for s in scores))
        return passed, ss1, ss2, su1, su2, scores, m1, ku1, ku2

result, ss1, ss2, su1, su2, scores, mission, ku1, ku2 = asyncio.run(main())
print('\n최종 판정:', '✅ ALL PASS' if result else '⚠ SESSION_START OK / FOOD_EATEN 미확인')
sys.exit(0 if result else 2)
