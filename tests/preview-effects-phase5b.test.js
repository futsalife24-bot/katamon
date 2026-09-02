const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const game = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shop = fs.readFileSync(path.join(__dirname, '..', 'coop-mvp-shop.js'), 'utf8');

const shopIds = [
  'barrier', 'impact', 'drill', 'rescue-kit', 'healing-kit',
  'debuff-grenade', 'icon-brass', 'shell-amber', 'impact-cyan',
];
const specialIds = [
  'kyoryu', 'medama', 'iwa', 'tori', 'barugerukan', 'nisenmono',
  'burumutan', 'sumoeru', 'doRednote', 'hamulton', 'mocchario', 'mecha',
  'akuma', 'jinba', 'kishi', 'neko', 'shinigami', 'coolKai',
];

assert.match(game, /function prepareDeterministicPreviewTerrain\(\)[\s\S]*?const previewFloorY = DEAD_LINE_Y - 126;[\s\S]*?wind = \{ dir: 1, strength: 0 \};/,
  '商品・必殺プレビューは場外にならない平面と無風を使う');
assert.doesNotMatch(game, /currentSegments = Array\.from\([^\n]+\[\[FLOOR_Y, TERRAIN_BOTTOM_Y\]\]/,
  'FLOOR_Y番兵を実在地形として使わない');
assert.match(game, /function previewAimVelocity\([\s\S]*?perfectAimVelocity\(/,
  '展示用照準も本編の逆算弾道を利用する');
assert.match(game, /function launchWorkshopBattlePreviewEffect\([\s\S]*?unitAnchor\(target\)/,
  '商品プレビューは商品ごとの正しい対象へ照準する');
assert.match(game, /function updateWorkshopPreviewEvidence\([\s\S]*?const completeByItem = \{/,
  '商品効果の成立条件を表示専用telemetryで確認する');
assert.match(game, /function updateSpecialDemoEvidence\([\s\S]*?const completeByKey = \{/,
  '必殺固有効果の成立条件を表示専用telemetryで確認する');
assert.match(game, /function focusActivePreviewCamera\(\)[\s\S]*?const safeZoom = \(VW - PREVIEW_SIDE_SAFE_MARGIN \* 2\) \/ span;[\s\S]*?cameraZoom = clampCameraZoom\(Math\.min\(MAX_CAMERA_ZOOM, safeZoom\)\);[\s\S]*?focusCameraOn/,
  '商品・必殺プレビューは保存済み距離設定に依存せず、安全域内で最大まで寄せる');
assert.match(game, /if \(battleMode === 'demo' && \(workshopBattlePreview \|\| specialDemo\)\)[\s\S]*?focusActivePreviewCamera\(\)/,
  '展示中は弾追尾で主役の2体を画面外へ流さない');
assert.match(game, /camera: capturePreviewCameraState\(\)/,
  'プレビュー開始前のカメラ状態を保存する');
assert.match(game, /restorePreviewCameraState\(restore\.camera\)/,
  'プレビュー終了後は通常プレイのカメラ状態へ戻す');
assert.match(game, /workshopPreviewPositionUnit\(ally2, STAGE_W \* 0\.62\)[\s\S]*?workshopPreviewPositionUnit\(cpu, STAGE_W \* 0\.90\)/,
  '回復・救助展示は対象の味方を右側へ置き、無関係な敵を表示外へ退避する');
assert.match(shop, /'icon-brass': 'バトル中の自分ステータス枠へ添える真鍮の砲兵章。性能差なし。'/,
  '真鍮アイコンの説明はactualのバトル中ステータス枠と一致する');
assert.doesNotMatch(`${game}\n${shop}`, /ロビーの自分表示/,
  '未実装のロビー表示を商品説明やプレビューで案内しない');

for (const id of shopIds) {
  assert.match(game, new RegExp(`(?:'${id}'|${id.replace('-', '\\-')}):`), `${id}の商品効果監査が必要`);
}
for (const id of specialIds) {
  assert.match(game, new RegExp(`(?:'${id}'|${id}): evidence\\.`), `${id}の必殺効果監査が必要`);
}

assert.match(game, /globalThis\.KatamonWorkshopBattlePreview = Object\.freeze\([\s\S]*?inspect:/,
  'ショッププレビューをread-onlyに検査できる');
assert.match(game, /globalThis\.KatamonSpecialDemo = Object\.freeze\([\s\S]*?inspect:/,
  '全キャラ必殺プレビューをread-onlyに検査できる');

console.log('Workshop 9商品 + 全18必殺プレビューの命中・固有効果契約 PASS');
