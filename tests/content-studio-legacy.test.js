const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const studio = fs.readFileSync(path.join(root, 'tools/content-studio/src/domain/legacy-characters.ts'), 'utf8');
const ids = [...game.match(/const LEGACY_CHARACTER_LIST = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const table = game.slice(game.indexOf('  const LEGACY_CHARACTERS ='), game.indexOf('  // Content Studioの生成カタログ'));
const overlay = game.slice(game.indexOf('  const CONTENT_STUDIO_MOTION_CLIPS ='), game.indexOf('  const GENERATED_CHARACTERS ='));
const before = JSON.parse(vm.runInNewContext(`${table}\nJSON.stringify(LEGACY_CHARACTERS)`, {}, { timeout: 1000 }));

test('Studio targets match the actual game list, names, assets and ordering', () => {
  const entries = [...studio.matchAll(/\{ id: '([^']+)', slug: '([^']+)', displayName: '([^']+)', asset: '([^']+)'/g)];
  assert.deepEqual(entries.map(m => m[1]), ids);
  for (const [,id,,name,asset] of entries) {
    assert.equal(before[id].name, name); assert.equal(before[id].asset, asset);
    assert.ok(fs.statSync(path.join(root, `assets/characters/runtime/${asset}.webp`)).size > 0);
  }
  assert.ok(ids.includes('hamulton'));
});
for (const id of ids) test(`${id}: motion overlay preserves all existing game fields`, () => {
  const clips = ['move-forward','move-backward','fire','hit','land'];
  const motionSheets = Object.fromEntries(clips.map(clip => [clip, `assets/content-studio/sample/0123456789ab/${clip}.png`]));
  const motionMetadata = Object.fromEntries(clips.map(clip => [clip, `assets/content-studio/sample/0123456789ab/${clip}.json`]));
  const catalog = { schemaVersion: 1, order: [id], characters: { [id]: { key:id,legacyTargetId:id,motionSheets,motionMetadata,name:'must not replace',maxHp:999,asset:'must-not-replace',special:'must not replace' } } };
  const after = JSON.parse(vm.runInNewContext(`${table}\n${overlay}\nloadGeneratedCharacters(catalog); JSON.stringify(LEGACY_CHARACTERS)`, {catalog}, {timeout:1000}));
  assert.deepEqual(after[id].motionSheets,motionSheets);
  assert.deepEqual(after[id].motionMetadata,motionMetadata);
  delete after[id].motionSheets; delete after[id].motionMetadata;
  assert.deepEqual(after,before);
});
