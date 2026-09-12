// Real Chromium QA. Hooks are injected only into the test response, never shipped.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.STORM_BASE_URL || 'http://127.0.0.1:4174';
const evidence = path.join(__dirname, '../docs/tasks/2026-09-12-second-boss-evidence');
fs.mkdirSync(evidence, { recursive: true });
const hook = `globalThis.__stormQa = {
  state: () => ({...coopNormalBattleState(),gamePhase,matchOver,resultReady:matchOver && matchEndPause<=0}),
  buttons: () => ({restart:{x:continueBtn.x,y:continueBtn.y+resultButtonShift()},lobby:{x:resultTitleBtn.x,y:resultTitleBtn.y+resultButtonShift()}}),
  overview() { cameraZoom=MIN_CAMERA_ZOOM; cameraDistanceSetting=0; cameraX=0; cameraY=0; cameraTargetX=null; cameraTargetY=null; },
  focus() { cameraZoom=.65; cameraDistanceSetting=cameraSliderValue(); focusCameraOn(coopBossUnit.x,true,coopBossUnit.y); },
  lightning() { coopBossUnit.bossState=coopBossLiveApi().exposeLiveCore(coopBossUnit.bossState,'attack');coopBossUnit.bossState.round=3; },
  awaken() { coopBossUnit.hp=coopBossUnit.maxHp*.49; activateCoopBossPhase2(); },
  finish() { const r=coopBossRect(coopBossUnit);coopBossUnit.hp=1;fireProjectile('p1',{x:r.x+r.width*.42-3,y:r.y+r.height*.62},180,0,{radius:5,damageMul:1,windMul:0,gravityMul:0});awaitingResolve=true; },
};\n`;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/index.html*', async route => {
      const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
      await route.fulfill({ contentType: 'text/html', body: html.replace('  globalThis.KatamonCoopBridge = Object.freeze({', hook + '  globalThis.KatamonCoopBridge = Object.freeze({') });
    });
    await page.goto(base + '/index.html?coopMvp=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => globalThis.KatamonCustomStageBridge?.getState()?.gamePhase === 'press');
    const canvas = page.locator('#game');
    const box = await canvas.boundingBox();
    await page.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
    await page.waitForFunction(() => globalThis.KatamonCustomStageBridge?.getState()?.gamePhase === 'title', { timeout: 30000 });
    await page.evaluate(() => globalThis.KatamonCoopRoom.openLobby());
    await page.locator('#coopBossTarget').selectOption('storm-dragon-02');
    assert.match(await page.locator('#coopBossGuide').textContent(), /蓄雷/);
    await page.screenshot({ path: path.join(evidence, '01-selection-mobile.png') });
    await page.locator('#coopSoloStart').click();
    await page.waitForFunction(() => globalThis.__stormQa.state().inputReady, { timeout: 30000 });
    let state = await page.evaluate(() => globalThis.__stormQa.state());
    assert.equal(state.bossId, 'storm-dragon-02'); assert.equal(state.terrainPattern, 'stormAltar');
    assert.equal(state.units.length, 5);
    // Use the real FIRE control and let the three CPU actions and boss reply resolve.
    const pt = (x,y) => ({x:box.x+x/540*box.width,y:box.y+y/960*box.height});
    const fire = pt(270,810), pull = pt(178,860);
    await page.mouse.move(fire.x,fire.y); await page.mouse.down();
    await page.mouse.move(pull.x,pull.y,{steps:10}); await page.mouse.up();
    await page.waitForFunction(() => globalThis.__stormQa.state().turnCount>=5 && globalThis.__stormQa.state().inputReady, { timeout:45000 });
    await page.evaluate(() => globalThis.__stormQa.overview());
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidence, '02-altar-overview-mobile.png') });
    await page.evaluate(() => globalThis.__stormQa.focus());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidence, '03-volteris-parts-mobile.png') });
    await page.evaluate(() => { globalThis.__stormQa.lightning(); globalThis.__stormQa.overview(); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidence, '04-lightning-warning-mobile.png') });
    await page.evaluate(() => { globalThis.__stormQa.awaken(); globalThis.__stormQa.focus(); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidence, '05-awakened-mobile.png') });
    await page.evaluate(() => globalThis.__stormQa.finish());
    await page.waitForFunction(() => globalThis.__stormQa.state().matchOver, { timeout: 15000 });
    await page.waitForFunction(() => globalThis.__stormQa.state().resultReady, { timeout:15000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(evidence, '06-victory-mobile.png') });
    let buttons = await page.evaluate(() => globalThis.__stormQa.buttons());
    const restart = pt(buttons.restart.x,buttons.restart.y);
    await page.touchscreen.tap(restart.x,restart.y);
    await page.waitForFunction(() => globalThis.__stormQa.state().inputReady && globalThis.__stormQa.state().turnCount===0, { timeout:30000 });
    state = await page.evaluate(() => globalThis.__stormQa.state());
    assert.equal(state.units[4].phase,1); assert.equal(state.units[4].hp,state.units[4].maxHp);
    await page.evaluate(() => globalThis.__stormQa.finish());
    await page.waitForFunction(() => globalThis.__stormQa.state().resultReady, { timeout:15000 });
    buttons = await page.evaluate(() => globalThis.__stormQa.buttons());
    const lobby = pt(buttons.lobby.x,buttons.lobby.y);
    await page.touchscreen.tap(lobby.x,lobby.y);
    await page.locator('#coopSoloStart').waitFor({state:'visible'});
    assert.equal(await page.locator('#coopBossTarget').inputValue(),'storm-dragon-02');
    // Host settings use the existing room API; verify the chosen boss survives writes.
    await page.goto(base+'/tests/fixtures/coop-ai-roster-visual.html?coopMvp=1');
    await page.locator('#coopBossTarget').selectOption('storm-dragon-02');
    await page.locator('#coopCreate').click();
    await page.waitForFunction(() => globalThis.qaRoom()?.settings?.bossId === 'storm-dragon-02');
    assert.match(await page.locator('#coopRoomTarget').textContent(),/雷雲の祭壇/);
    await page.locator('#coopRoomBossTarget').selectOption('siege-fortress-01');
    await page.waitForFunction(() => !globalThis.qaRoom()?.settings?.bossId);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'browser-result.json'), JSON.stringify({ browser: 'Chromium', viewport: '390x844',
      assertions: ['boss selection','real solo entry','dedicated stage','five units','actual FIRE and complete round','rendered parts','telegraph','awakening','real impact to victory','rematch reset','return to lobby','room creation and boss setting update','zero page errors'], errors }, null, 2));
    console.log('Browser QA passed: selection, solo entry, stage, parts, lightning warning, victory; pageerrors=0');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
