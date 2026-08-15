'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../shared/stage-core.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function lowerPlatformStage() {
  const stage = Core.generateStage({
    preset: 'flat',
    seed: 'game-integration-lower-platform',
    title: '統合テストステージ',
    format: '1v1',
    wind: { direction: -1, strength: 0.5 }
  });

  // 同じXに上段と下段を置き、出撃地点は下段を明示する。ゲームがXだけを見て
  // 最上面へ置く実装へ戻ると、このテストは184px付近になって失敗する。
  for (const spawn of stage.spawnPoints) {
    const center = Math.floor(spawn.x / Core.LIMITS.columnWidth);
    for (let column = center - 8; column <= center + 8; column += 1) {
      stage.terrain.columns[column] = [[200, 232], [500, Core.LIMITS.terrainBottom]];
    }
    spawn.y = 500 - Core.LIMITS.unitRadius;
  }
  stage.background = {
    mode: 'gradient',
    theme: 'snow',
    color: '#26405A',
    gradient: { from: '#102030', to: '#708090' }
  };
  stage.materials[0].color = '#8A5C32';
  stage.decorations.enabled = false;
  return Core.finalizeStage(stage, { touchUpdatedAt: false });
}

async function largePlatformStage() {
  const stage = Core.generateStage({
    size: 'large',
    preset: 'mountainCenter',
    seed: 'game-integration-large-stage',
    title: '大型テストステージ',
    format: '2v2',
    generationParameters: { playerCount: 4 }
  });
  const limits = Core.getStageLimits(stage);
  for (const spawn of stage.spawnPoints) {
    const center = Math.floor(spawn.x / limits.columnWidth);
    for (let column = center - 8; column <= center + 8; column += 1) {
      stage.terrain.columns[column] = [[320, 352], [760, limits.terrainBottom]];
    }
    spawn.y = 760 - limits.unitRadius;
  }
  return Core.finalizeStage(stage, { touchUpdatedAt: false });
}

test('custom stage adapter starts an actual local battle with terrain, lower spawn and wind', async () => {
  // seatharnessはindex.htmlの本体スクリプトをCanvas/DOMスタブ上で実行する。
  // StageCoreを先にglobalThisへ公開すると、実ブラウザと同じ共有モジュール経路になる。
  globalThis.StageCore = Core;
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const bridge = globalThis.KatamonCustomStageBridge;
  const stage = await lowerPlatformStage();

  assert.ok(bridge, 'game bridge is exposed');
  assert.equal(bridge.getState().featureEnabled, true);
  const adapter = await bridge.selectStage(stage);
  assert.equal(adapter.stageId, stage.stageId);
  assert.equal(adapter.contentHash, stage.checksums.contentHash);
  assert.deepEqual(adapter.appearance, {
    background: stage.background,
    terrainMaterial: 'terrain',
    terrainColor: '#8A5C32',
    decorationsEnabled: false
  });
  assert.equal(bridge.getState().gamePhase, 'freeSetup');

  await bridge.startSelectedStage(stage);
  const snapshot = kt.buildSnapshotForTest();
  assert.equal(snapshot.battleMode, 'free');
  assert.equal(snapshot.customStage.stageId, stage.stageId);
  assert.equal(snapshot.wind.dir, -1);
  assert.equal(snapshot.wind.strength, 0.5);
  assert.equal(snapshot.nextWind.dir, -1);
  assert.equal(snapshot.nextWind.strength, 0.5);
  const customAppearance = kt.appearanceForTest();
  assert.equal(customAppearance.themeKey, 'snow');
  assert.deepEqual(customAppearance.theme.sky, ['#102030', '#405060', '#708090']);
  assert.equal(customAppearance.theme.dirtTop, '#8A5C32');
  assert.equal(customAppearance.custom.decorationsEnabled, false);
  assert.equal(customAppearance.usesOfficialThemeObject, false, 'custom colors use a cloned theme');
  for (const spawn of stage.spawnPoints) {
    const unit = snapshot.units.find((entry) => entry.id === spawn.slot);
    assert.ok(unit, `unit ${spawn.slot} exists`);
    assert.equal(unit.x, spawn.x);
    assert.equal(unit.y, spawn.y, `${spawn.slot} remains on the requested lower platform`);
  }

  const sampleX = stage.spawnPoints[0].x;
  assert.equal(kt.isSolidAt(sampleX, 212), true, 'custom upper platform enters the real collision mask');
  kt.carveCraterForTest(sampleX, 212, 30);
  assert.equal(kt.isSolidAt(sampleX, 212), false, 'real battle crater removes custom collision');

  await bridge.startSelectedStage(stage);
  assert.equal(kt.isSolidAt(sampleX, 212), true, 'restart reloads the pristine custom terrain');

  const resumableSnapshot = kt.buildSnapshotForTest();
  const changedSnapshot = clone(resumableSnapshot);
  changedSnapshot.customStage.title = '改ざんされたステージ';
  assert.throws(() => kt.applySnapshotForTest(changedSnapshot), /contentHash/);

  const changedTerrainSnapshot = clone(resumableSnapshot);
  changedTerrainSnapshot.segments[0][0][0] += 4;
  assert.throws(() => kt.applySnapshotForTest(changedTerrainSnapshot), /地形.*一致/);

  const missingManifestSnapshot = clone(resumableSnapshot);
  missingManifestSnapshot.customStage = null;
  assert.throws(() => kt.applySnapshotForTest(missingManifestSnapshot), /ステージ情報/);

  const wrongModeSnapshot = clone(resumableSnapshot);
  wrongModeSnapshot.battleMode = 'normal';
  assert.throws(() => kt.applySnapshotForTest(wrongModeSnapshot), /対戦種別/);

  kt.saveSuspendedForTest();
  const storedSnapshot = JSON.parse(globalThis.localStorage.getItem('katamon_custom_suspend_v1'));
  storedSnapshot.customStage.description = '保存後に変更';
  globalThis.localStorage.setItem('katamon_custom_suspend_v1', JSON.stringify(storedSnapshot));
  assert.equal(kt.loadSuspendedForTest(), null, 'tampered custom save is not offered for resume');

  kt.startBattle();
  const officialSnapshot = kt.buildSnapshotForTest();
  assert.equal(officialSnapshot.battleMode, 'normal');
  assert.equal(officialSnapshot.customStage, null, 'normal battle snapshots never include custom stages');
  assert.notEqual(officialSnapshot.pattern, 'custom', 'normal battle returns to official terrain generation');
  assert.notEqual(
    Core.canonicalStringify(officialSnapshot.segments),
    Core.canonicalStringify(stage.terrain.columns),
    'official terrain is isolated from the selected custom stage'
  );
  const officialAppearance = kt.appearanceForTest();
  assert.equal(officialAppearance.custom, null);
  assert.equal(officialAppearance.usesOfficialThemeObject, true, 'official terrain palette is not mutated by custom colors');

  kt.applySnapshotForTest(resumableSnapshot);
  assert.equal(kt.appearanceForTest().custom.decorationsEnabled, false, 'snapshot restore reapplies custom appearance');
});

test('large custom stage uses the 2160x960 field, upper terrain and four-player spawn map in battle', async () => {
  globalThis.StageCore = Core;
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const stage = await largePlatformStage();
  const bridge = globalThis.KatamonCustomStageBridge;

  const adapter = await bridge.selectStage(stage);
  assert.equal(adapter.stageSize, 'large');
  assert.equal(adapter.stageWidth, 2160);
  assert.equal(adapter.stageHeight, 960);

  await bridge.startSelectedStage(stage);
  const snapshot = kt.buildSnapshotForTest();
  assert.equal(snapshot.stageW, 2160);
  assert.equal(snapshot.stageH, 960);
  assert.equal(snapshot.segments.length, 720);
  assert.equal(snapshot.units.length, 4);
  const upperX = stage.spawnPoints[0].x;
  assert.equal(kt.isSolidAt(upperX, 332), true, 'large-stage upper platform reaches the real collision mask');

  kt.applySnapshotForTest(snapshot);
  const restored = kt.buildSnapshotForTest();
  assert.equal(restored.stageW, 2160, 'large dimensions survive a snapshot restore');
  assert.equal(restored.segments.length, 720, 'large terrain columns survive a snapshot restore');
});

test('custom steel stage keeps real game collision after an explosion', async () => {
  globalThis.StageCore = Core;
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const bridge = globalThis.KatamonCustomStageBridge;
  const steelStage = await lowerPlatformStage();
  steelStage.materials[0] = { id: 'steel', type: 'indestructible', destructible: false, color: '#49515B' };
  const stage = await Core.finalizeStage(steelStage, { touchUpdatedAt: false });

  const adapter = await bridge.selectStage(stage);
  assert.equal(adapter.appearance.terrainMaterial, 'steel');
  await bridge.startSelectedStage(stage);

  const sampleX = stage.spawnPoints[0].x;
  assert.equal(kt.isSolidAt(sampleX, 212), true, 'steel upper platform enters the real collision mask');
  kt.carveCraterForTest(sampleX, 212, 30);
  assert.equal(kt.isSolidAt(sampleX, 212), true, 'a real battle explosion cannot remove steel collision');
});

test('custom battle keeps the official suspended save in an isolated slot', async () => {
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const bridge = globalThis.KatamonCustomStageBridge;
  const stage = await lowerPlatformStage();

  globalThis.localStorage.clear();
  kt.startBattle();
  assert.equal(kt.saveSuspendedForTest(), true);
  const officialRaw = globalThis.localStorage.getItem('katamon_suspend_v1');
  assert.ok(officialRaw, 'official battle has a suspended save');

  await bridge.startSelectedStage(stage);
  assert.equal(
    globalThis.localStorage.getItem('katamon_suspend_v1'),
    officialRaw,
    'starting a custom battle must not overwrite or delete the official save'
  );
  assert.equal(globalThis.localStorage.getItem('katamon_custom_suspend_v1'), null, 'custom slot starts clean');

  assert.equal(kt.saveSuspendedForTest(), true);
  const customRaw = globalThis.localStorage.getItem('katamon_custom_suspend_v1');
  assert.ok(customRaw, 'custom battle uses a separate suspended-save slot');
  assert.equal(JSON.parse(customRaw).customStage.stageId, stage.stageId);
  assert.equal(kt.loadSuspendedForTest().customStage.stageId, stage.stageId, 'custom resume takes priority');
  assert.equal(globalThis.localStorage.getItem('katamon_suspend_v1'), officialRaw, 'official save remains unchanged');

  kt.startBattle();
});

test('battle selection rejects a changed hash and inconsistent player layout', async () => {
  const bridge = globalThis.KatamonCustomStageBridge;
  const stage = await lowerPlatformStage();
  assert.equal(Core.contentHashSync(stage), await Core.contentHash(stage));
  assert.equal(Core.verifyStageHashSync(stage).valid, true);
  const changed = clone(stage);
  changed.title = '内容を変更したステージ';
  await assert.rejects(() => bridge.selectStage(changed), /contentHash/);

  const inconsistent = clone(stage);
  inconsistent.battleRules.format = '2v2';
  inconsistent.battleRules.maxPlayers = 4;
  // ハッシュ検査より前に、生データのスキーマ/対戦構成で拒否される。
  assert.throws(() => bridge.validateStage(inconsistent), /出撃地点|ステージ|人数/);
});

test('changing a stage-owned free battle option clears the selected custom stage', async () => {
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const bridge = globalThis.KatamonCustomStageBridge;
  const stage = await lowerPlatformStage();

  for (const kind of ['format', 'wind', 'windStrength', 'terrain']) {
    await bridge.selectStage(stage);
    assert.equal(bridge.getState().selectedStageId, stage.stageId);
    kt.changeFreeOption(kind, 1);
    assert.equal(bridge.getState().selectedStageId, null, `${kind} must not leave a stale custom adapter selected`);
  }

  await bridge.selectStage(stage);
  kt.changeFreeOption('player', 1);
  assert.equal(bridge.getState().selectedStageId, stage.stageId, 'character choice remains independent from stage data');
});

test('online custom battle transfers a canonical stage and rejects changed identity data', async () => {
  const harness = require('./seatharness.js');
  const kt = harness.kt();
  const bridge = globalThis.KatamonCustomStageBridge;
  const stage = await lowerPlatformStage();
  const identity = Core.createStageIdentity(stage);

  await bridge.selectStage(stage);
  kt.setBattleModeForTest('normal');
  kt.stage3().setOnlineForLogTest({ kind: 'firebase', customStageIdentity: identity });
  kt.stage3().resetMatchForTest();

  const snapshot = kt.buildSnapshotForTest();
  assert.equal(snapshot.battleMode, 'normal');
  assert.equal(snapshot.customStage.stageId, stage.stageId);
  assert.deepEqual(snapshot.customStageIdentity, identity);
  assert.equal(kt.stage3().hasSafeSnapshot(snapshot), true, 'Firebase accepts a fully verified custom start snapshot');

  const rtdbSnapshot = clone(snapshot);
  delete rtdbSnapshot.customStage.gameCompatibility.maxBuild;
  delete rtdbSnapshot.customStage.preview.mimeType;
  delete rtdbSnapshot.customStage.preview.data;
  delete rtdbSnapshot.customStageIdentity.gameCompatibility.maxBuild;
  rtdbSnapshot.customStage.decorations.foreground = null;
  rtdbSnapshot.customStage.decorations.background = null;
  const restoredRtdbSnapshot = kt.stage3().normalizeFirebaseSnapshot(rtdbSnapshot);
  assert.deepEqual(Core.normalizeStage(restoredRtdbSnapshot.customStage), Core.normalizeStage(snapshot.customStage));
  assert.equal(
    kt.stage3().snapshotValidationReason(restoredRtdbSnapshot),
    '',
    'Firebase null and empty-array normalization preserves the canonical stage'
  );
  kt.applySnapshotForTest(restoredRtdbSnapshot);

  kt.applySnapshotForTest(snapshot);
  assert.equal(bridge.getState().selectedStageId, stage.stageId);
  assert.equal(bridge.getState().onlineStageSelection, false, 'a guest cannot edit the host stage selection');
  const sampleX = stage.spawnPoints[0].x;
  assert.equal(kt.isSolidAt(sampleX, 212), true, 'online snapshot loads the shared collision terrain');

  const changedHash = clone(snapshot);
  changedHash.customStage.title = '改ざんされたオンラインステージ';
  assert.equal(kt.stage3().hasSafeSnapshot(changedHash), false, 'Firebase rejects a changed stage before applying it');
  assert.throws(() => kt.applySnapshotForTest(changedHash), /contentHash/);

  const changedIdentity = clone(snapshot);
  changedIdentity.customStageIdentity.contentHash = '0'.repeat(64);
  assert.throws(() => kt.applySnapshotForTest(changedIdentity), /一致|contentHash/);

  const missingStage = clone(snapshot);
  missingStage.customStage = null;
  assert.throws(() => kt.applySnapshotForTest(missingStage), /本体データ|ステージ情報/);

  kt.stage3().setOnlineForLogTest(null);
  kt.startBattle();
});

test('game integration isolates official stages while online custom starts are identity-gated', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'game-custom-stages.js'), 'utf8');
  const managerCss = fs.readFileSync(path.join(root, 'game-custom-stages.css'), 'utf8');
  const studioApp = fs.readFileSync(path.join(root, 'tools', 'stage-studio', 'app-1.7.0.js'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.match(html, /\(battleMode === 'free' \|\| onlineCustomStageActive\(\)\) && selectedCustomAdapter/);
  assert.match(html, /battleMode === 'normal' && online && online\.kind === 'firebase'/);
  assert.match(html, /const ONLINE_CUSTOM_STAGE_MAX_BYTES = 256 \* 1024/);
  assert.match(html, /const includeCustomStage = !!\(selectedCustomStage && \(battleMode === 'free' \|\| onlineCustomStageActive\(\)\)\)/);
  assert.match(html, /customStageIdentity: includeCustomStage \? customStageIdentity\(selectedCustomStage\) : null/);
  assert.match(html, /StageCore\.compareStageIdentity\(identity, data\.customStageIdentity\)/);
  assert.match(html, /firebaseOccupiedPlayerSeats\(\)\.every\(seat => seat === online\.seat \|\| online\.startAcks\[seat\]\)/);
  assert.match(html, /CustomStageManager\.open\(\{ mode: 'online' \}\)/);
  assert.match(html, /onlineActive: isOnline\(\) \|\| roomScreenOpen\(\)/);
  assert.match(html, /StageCore\.stepProjectile\(p, dt, windAccel, projectileGravity\)/);
  assert.match(html, /loadTerrainFromSave\(\s*selectedCustomAdapter\.segments/);
  assert.match(html, /KATAMON_FEATURES\?\.customStages !== false/);
  assert.match(html, /StageCore\.createStageIdentity\(stage\)/);
  assert.match(html, /StageCore\.compareStageIdentity\(sourceIdentity, adapterIdentity\)/);
  assert.match(html, /StageCore\?\.PHYSICS\?\.deadLineY/);
  assert.match(html, /StageCore\?\.PHYSICS\?\.fallTrigger/);
  assert.match(html, /if \(kind === 'wind'\) \{[\s\S]*?selectedCustomStage = null/);
  assert.match(html, /\['terrain', 'stageSize', 'format'\]\.includes\(kind\)/);
  assert.match(html, /\['windStrength'\]\.includes\(kind\)/);
  assert.match(html, /const CUSTOM_SUSPEND_KEY = 'katamon_custom_suspend_v1'/);
  assert.match(html, /startFreeMatch\(\{ preserveOfficialSuspend: true \}\)/);

  assert.match(studioApp, /finalizeStage\(materializeStage\(\),\s*\{\s*touchUpdatedAt:\s*false\s*\}\)/);
  assert.match(studioApp, /finalizeStage\(document,\s*\{\s*touchUpdatedAt:\s*false\s*\}\)/);
  assert.match(studioApp, /catch \(_\) \{[\s\S]*?if \(!copied\) \{/);
  assert.match(studioApp, /typeof document\.execCommand !== 'function'/);
  assert.match(studioApp, /state\.editRevision \+= 1/);
  assert.match(studioApp, /const savingRevision = state\.editRevision/);
  assert.match(studioApp, /estimate\.backend !== 'memory' && estimate\.durable !== false/);
  assert.match(studioApp, /一時保存（再読込で消えます）/);
  assert.match(studioApp, /controllerchange[\s\S]{0,180}if \(!state\.pwaUpdateRequested\) return/);
  assert.doesNotMatch(studioApp, /const hadController =/);
  assert.match(studioApp, /if \(!saved \|\| state\.dirty \|\| !durable\)/);
  assert.match(studioApp, /shareFailed = true[\s\S]{0,180}blobDownload\(file, file\.name\)/);
  assert.match(serviceWorker, /caches\.match\(request, \{ ignoreSearch: true \}\)/);

  assert.match(manager, /listCustom\(\)/);
  assert.match(manager, /putCustom\(migrated\)/);
  assert.match(manager, /StageRepository/);
  assert.match(manager, /createLocalProvider/);
  assert.doesNotMatch(manager, /storageModule\.open\(/);
  assert.match(manager, /verifyStageHash\(migrated\)/);
  assert.match(manager, /core\.getStageLimits \? core\.getStageLimits\(stage\) : core\.LIMITS/);
  assert.match(manager, /readStageBundle\(file\)/);
  assert.match(manager, /createStageBundle\(finalized\)/);
  assert.match(manager, /state\.onlineActive/);
  assert.match(manager, /state\.gamePhase !== 'freeSetup'/);
  assert.match(manager, /managerMode === 'online'/);
  assert.match(manager, /gameBridge\.selectStage\(stage\)/);
  assert.doesNotMatch(manager, /\['press', 'title', 'freeSetup'\]/);
  for (const field of ['stageId', 'schemaVersion', 'contentHash', 'gameCompatibility']) {
    assert.match(manager, new RegExp("label: '" + field + "'"));
  }
  assert.match(manager, /identityLine\.textContent\s*=/);
  assert.match(manager, /バトル開始直前に4項目を再照合します/);
  assert.doesNotMatch(manager, /innerHTML\s*=\s*stage\.|insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(manager, /globalThis\.(prompt|confirm)\s*\(/);
  assert.match(manager, /custom-stage-action-overlay/);
  assert.match(manager, /openActionDialog\('rename', stage\)/);
  assert.match(manager, /openActionDialog\('delete', stage\)/);
  assert.match(managerCss, /\.custom-stage-identity\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(managerCss, /#customStageSelection\s*\{[^}]*white-space:\s*pre-line/s);
  assert.match(managerCss, /\.custom-stage-action-overlay\.open\s*\{\s*display:\s*grid/);
  assert.match(managerCss, /url\("assets\/wall\.jpg"\)/);
  assert.doesNotMatch(html, /id="deviceBackConfirmCrest"/);
  assert.match(html, /id="deviceBackConfirmKicker">カタモンを閉じる？/);
  assert.match(html, /id="deviceBackConfirmNote">終了すると、カタモンを閉じます。/);
  assert.match(html, /id="deviceBackExit"[\s\S]*カタモンを終了する/);
  assert.match(html, /id="deviceBackConfirmActions" class="deviceBackLevers"/);
  assert.match(html, /id="deviceBackStay" class="deviceBackLever deviceBackLever--stay"/);
  assert.match(html, /id="deviceBackExit" class="deviceBackLever deviceBackLever--exit"/);
  assert.match(html, /#deviceBackConfirmKicker\s*\{[\s\S]*position:\s*absolute/);
  assert.match(html, /\.deviceBackLever::before\s*\{[\s\S]*border-radius:\s*50%/);
  const fontCss = fs.readFileSync(path.join(root, 'assets', 'fonts', 'katamon-fonts.css'), 'utf8');
  assert.match(fontCss, /font-family:\s*"RocknRoll One"/);
  assert.match(fontCss, /font-family:\s*"Reggae One"/);
  assert.match(fontCss, /--katamon-font-ui:\s*"RocknRoll One"/);
  assert.match(fontCss, /--katamon-font-display:\s*"Reggae One"/);
  assert.match(html, /const UI_FONT = '"RocknRoll One"/);
  assert.match(html, /const UI_FONT_DISPLAY = '"Reggae One"/);
  assert.match(html, /#deviceBackConfirmTitle\s*\{[\s\S]*var\(--katamon-font-display\)/);
  assert.match(html, /v212-balcopter-triple-size/);
  assert.match(serviceWorker, /assets\/fonts\/rocknroll-one-regular\.ttf/);
  assert.match(serviceWorker, /assets\/fonts\/reggae-one-display\.woff2/);
  assert.match(serviceWorker, /katamon-pwa-v212-balcopter-triple-size/);
  assert.ok(fs.statSync(path.join(root, 'assets', 'fonts', 'rocknroll-one-regular.ttf')).size > 2_000_000);
  assert.ok(fs.statSync(path.join(root, 'assets', 'fonts', 'reggae-one-display.woff2')).size > 5_000);
});
