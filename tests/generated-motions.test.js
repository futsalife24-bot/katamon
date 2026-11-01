const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const motion = require('../shared/content-studio-motion.js');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/generated-motion-manifest.json'), 'utf8'));
require('../generated/content-studio-catalog.js');
const catalog = globalThis.__CONTENT_STUDIO_CATALOG__;

test('generated legacy motions resolve to complete, bounded game assets', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(Object.keys(manifest.characters).length, 18, '通常キャラ18体が揃っていること');
  assert.equal(catalog.schemaVersion, 1);
  for (const [id, binding] of Object.entries(manifest.characters)) {
    const character = catalog.characters[id];
    assert.equal(character.key, id);
    assert.equal(character.legacyTargetId, id);
    assert(catalog.order.includes(id));
    for (const clip of motion.CLIPS) {
      const png = binding.motionSheets[clip];
      const json = binding.motionMetadata[clip];
      assert.equal(character.motionSheets[clip], png);
      assert.equal(character.motionMetadata[clip], json);
      const directory = png.slice(0, png.lastIndexOf('/'));
      assert.deepEqual(motion.paths(character, clip), { png, json, directory });
      const metadata = JSON.parse(fs.readFileSync(path.join(root, json), 'utf8'));
      assert(motion.validateMetadata(metadata, clip, directory), `${id}/${clip} metadata`);
      const bytes = fs.readFileSync(path.join(root, png));
      assert(bytes.length <= 6 * 1024 * 1024, `${id}/${clip} exceeds 6 MiB`);
      assert.deepEqual(motion.pngDimensions(bytes),
        { width: metadata.frameWidth * metadata.frameCount, height: metadata.frameHeight });
      assert.equal(metadata.rendering.sourceFacing, 'right');
      assert.equal(metadata.rendering.contactFrame, clip === 'land' ? 4 : 0);
      assert(fs.statSync(path.join(root, directory, 'character.png')).size > 0);
    }
  }
});
