'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../shared/stage-core.js');

function makeStage(overrides) {
  return core.generateStage(Object.assign({ seed: 'stage-test-seed', preset: 'rolling' }, overrides));
}

function deterministicProjection(stage) {
  return {
    seed: stage.seed,
    generatorVersion: stage.generatorVersion,
    generation: stage.generation,
    terrain: stage.terrain,
    spawnPoints: stage.spawnPoints,
    gimmicks: stage.gimmicks
  };
}

test('schema file is exactly the schema exported by StageCore', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'stage.schema.json'), 'utf8'));
  assert.deepEqual(file, core.schemaDocument);
  assert.equal(file.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(file.additionalProperties, false);
});

test('generator is deterministic for seed, version, preset and parameters', () => {
  const options = {
    seed: '再現性-123',
    preset: 'rolling',
    generationParameters: { elevation: 0.61, density: 0.72, smoothness: 0.4, playerCount: 4 },
    wind: { direction: -1, strength: 0.35 }
  };
  const first = makeStage(options);
  const second = makeStage(options);
  assert.deepEqual(deterministicProjection(first), deterministicProjection(second));

  const changedSeed = makeStage(Object.assign({}, options, { seed: '再現性-124' }));
  assert.notDeepEqual(first.terrain.columns, changedSeed.terrain.columns);
  const changedParameters = makeStage(Object.assign({}, options, {
    generationParameters: Object.assign({}, options.generationParameters, { elevation: 0.9 })
  }));
  assert.notDeepEqual(first.terrain.columns, changedParameters.terrain.columns);
});

test('random preset survives save metadata and regenerates the same terrain', () => {
  const first = makeStage({
    seed: 'random-round-trip',
    preset: 'random',
    generationParameters: {
      elevation: 0.68,
      density: 0.72,
      platformCount: 3,
      valleyDepth: 0.5,
      mountainCount: 4,
      cavityRate: 0.12,
      smoothness: 0.58,
      playerCount: 2,
      difficulty: 0.7
    }
  });
  assert.equal(first.generation.preset, 'random');

  const regenerated = makeStage({
    seed: first.seed,
    preset: first.generation.preset,
    generationParameters: first.generation.parameters
  });
  assert.equal(regenerated.generation.preset, 'random');
  assert.deepEqual(regenerated.terrain.columns, first.terrain.columns);
  assert.deepEqual(regenerated.spawnPoints, first.spawnPoints);
});

test('mountain count and difficulty affect generated terrain deterministically', () => {
  const common = {
    seed: 'terrain-controls',
    preset: 'rolling',
    generationParameters: { elevation: 0.6, density: 0.75, smoothness: 0.55, cavityRate: 0.1 }
  };
  const gentle = makeStage(Object.assign({}, common, {
    generationParameters: Object.assign({}, common.generationParameters, { mountainCount: 0, difficulty: 0.1 })
  }));
  const rugged = makeStage(Object.assign({}, common, {
    generationParameters: Object.assign({}, common.generationParameters, { mountainCount: 6, difficulty: 0.9 })
  }));
  const ruggedAgain = makeStage(Object.assign({}, common, {
    generationParameters: Object.assign({}, common.generationParameters, { mountainCount: 6, difficulty: 0.9 })
  }));
  assert.notDeepEqual(rugged.terrain.columns, gentle.terrain.columns);
  assert.deepEqual(rugged.terrain.columns, ruggedAgain.terrain.columns);
});

test('all generated presets stay in bounds and non-blank presets validate', () => {
  assert.ok(core.PRESETS.length >= 18);
  for (const preset of core.PRESETS) {
    const stage = makeStage({ seed: 'preset-' + preset.key, preset: preset.key });
    assert.equal(stage.terrain.columns.length, core.LIMITS.columns, preset.key);
    for (const column of stage.terrain.columns) {
      assert.ok(column.length <= 32, preset.key);
      let previousBottom = -1;
      for (const segment of column) {
        assert.ok(segment[0] >= 0 && segment[1] <= core.LIMITS.stageHeight, preset.key);
        assert.ok(segment[1] > segment[0], preset.key);
        assert.ok(segment[0] >= previousBottom, preset.key + ' has overlapping segments');
        previousBottom = segment[1];
      }
    }
    const validation = core.validateStage(stage);
    if (preset.key === 'blank') {
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some((entry) => entry.code === 'spawn_count'));
    } else {
      assert.equal(validation.valid, true, preset.key + ': ' + validation.errors.map((entry) => entry.code).join(', '));
    }
  }
});

test('large stages use the 2160x960 terrain grid and keep 2v2 spawns valid', () => {
  const stage = makeStage({
    size: 'large',
    preset: 'mountainCenter',
    seed: 'large-stage-grid',
    generationParameters: { playerCount: 4, elevation: 0.72, mountainCount: 4 }
  });
  const limits = core.getStageLimits(stage);
  assert.equal(stage.stageWidth, 2160);
  assert.equal(stage.stageHeight, 960);
  assert.equal(stage.terrain.columns.length, 720);
  assert.equal(limits.terrainBottom, 924);
  assert.equal(stage.spawnPoints.length, 4);
  assert.equal(core.validateStage(stage).valid, true);

  const grid = core.segmentsToGrid(stage);
  assert.equal(grid.length, 720 * 240);
  const restored = core.gridToSegments(grid, stage);
  assert.equal(restored.length, 720);
  assert.equal(core.isSolidAt(stage, stage.spawnPoints[0].x, stage.spawnPoints[0].y + 16), true);
});

test('terrain grid editing round-trips and circle painting changes collision', () => {
  const stage = makeStage({ preset: 'flat' });
  const grid = core.segmentsToGrid(stage);
  assert.equal(grid.length, core.LIMITS.columns * core.LIMITS.rows);
  const ground = core.groundYAt(stage, 720);
  assert.equal(core.isSolidAt(stage, 720, ground + 8), true);

  core.paintCircle(grid, 720, ground + 8, 36, false);
  const edited = core.normalizeStage(stage);
  edited.terrain.columns = core.gridToSegments(grid);
  assert.equal(core.isSolidAt(edited, 720, ground + 8), false);
  assert.equal(edited.terrain.columns.length, core.LIMITS.columns);

  const carved = core.carveCircle(stage, 720, ground + 8, 36);
  assert.equal(core.isSolidAt(carved, 720, ground + 8), false);
  assert.equal(carved.checksums.contentHash, '');
});

test('spawn validation rejects missing, overlapping, embedded and outside points', () => {
  const base = makeStage({ preset: 'flat' });

  const missing = core.normalizeStage(base);
  missing.spawnPoints = missing.spawnPoints.slice(0, 1);
  assert.ok(core.validateStage(missing).errors.some((entry) => entry.code === 'spawn_count'));

  const overlap = core.normalizeStage(base);
  overlap.spawnPoints[1].x = overlap.spawnPoints[0].x;
  overlap.spawnPoints[1].y = overlap.spawnPoints[0].y;
  assert.ok(core.validateStage(overlap).errors.some((entry) => entry.code === 'spawn_overlap'));

  const embedded = core.normalizeStage(base);
  embedded.spawnPoints[0].y = core.groundYAt(embedded, embedded.spawnPoints[0].x) + 8;
  assert.ok(core.validateStage(embedded).errors.some((entry) => entry.code === 'spawn_inside_terrain'));

  const outside = core.normalizeStage(base);
  outside.spawnPoints[0].x = -100;
  assert.ok(core.validateStage(outside).errors.some((entry) => entry.code === 'spawn_bounds'));
});

test('battle format, teams, spawn identity and disabled MVP previews stay internally consistent', () => {
  const wrongTeam = makeStage();
  wrongTeam.spawnPoints[0].team = 'enemy';
  assert.ok(core.validateStage(wrongTeam).errors.some((entry) => entry.code === 'spawn_team'));

  const duplicateIdentity = makeStage();
  duplicateIdentity.spawnPoints[1].id = duplicateIdentity.spawnPoints[0].id;
  duplicateIdentity.spawnPoints[1].order = duplicateIdentity.spawnPoints[0].order;
  const identityErrors = core.validateStage(duplicateIdentity).errors;
  assert.ok(identityErrors.some((entry) => entry.code === 'spawn_duplicate_id'));
  assert.ok(identityErrors.some((entry) => entry.code === 'spawn_duplicate_order'));

  const mismatchedFormat = makeStage();
  mismatchedFormat.battleRules = { format: '2v2', maxPlayers: 4, turnLimit: null, rankedAllowed: false, onlineAllowed: false };
  assert.ok(core.validateStage(mismatchedFormat).errors.some((entry) => entry.code === 'battle_format_spawns'));

  const invalidPreview = makeStage();
  invalidPreview.preview = { width: 320, height: 180, mimeType: 'image/webp', data: 'not base64!' };
  assert.ok(core.validateStage(invalidPreview).errors.some((entry) => entry.code === 'preview_unsupported'));

  const plausibleButUnverifiedPreview = makeStage();
  plausibleButUnverifiedPreview.preview = { width: 1, height: 1, mimeType: 'image/png', data: 'iVBORw0KGgo=' };
  assert.ok(core.validateStage(plausibleButUnverifiedPreview).errors.some((entry) => entry.code === 'preview_unsupported'));
});

test('only the supported global wind gimmick and range are accepted', () => {
  const valid = makeStage({ wind: { direction: -1, strength: 0.75 } });
  assert.equal(core.validateStage(valid).valid, true);
  assert.equal(core.getGlobalWind(valid).direction, -1);

  const unsupported = core.normalizeStage(valid);
  unsupported.gimmicks[0].type = 'arbitraryCode';
  assert.ok(core.validateStage(unsupported).errors.some((entry) => entry.code === 'unsupported_gimmick'));

  const outOfRange = core.normalizeStage(valid);
  outOfRange.gimmicks[0].strength = 5;
  assert.ok(core.validateStage(outOfRange).errors.some((entry) => entry.code === 'wind_strength'));
});

test('material allowlist accepts a whole-stage steel material that never loses collision', () => {
  assert.deepEqual(core.MATERIAL_CATALOG.terrain, {
    id: 'terrain',
    label: '通常地形',
    type: 'destructible',
    destructible: true,
    enabled: true,
    exportable: true,
    requiresGameFeature: null
  });
  assert.deepEqual(core.MATERIAL_CATALOG.steel, {
    id: 'steel',
    label: '壊れない鋼鉄',
    type: 'indestructible',
    destructible: false,
    enabled: true,
    exportable: true,
    requiresGameFeature: null
  });

  const valid = makeStage();
  assert.equal(core.validateStage(valid).valid, true);

  const steel = makeStage();
  steel.materials[0] = { id: 'steel', type: 'indestructible', destructible: false, color: '#49515B' };
  assert.equal(core.validateStage(steel).valid, true);
  const steelGround = core.groundYAt(steel, 720);
  const carvedSteel = core.carveCircle(steel, 720, steelGround + 8, 36);
  assert.equal(core.isSolidAt(carvedSteel, 720, steelGround + 8), true, 'steel remains solid after a crater');

  const unknown = makeStage();
  unknown.materials[0].id = 'unknown';
  assert.ok(core.validateStage(unknown).errors.some((entry) => entry.code === 'unsupported_material'));

  const multiple = makeStage();
  multiple.materials.push({ id: 'terrain', type: 'destructible', destructible: true, color: '#7A5435' });
  assert.ok(core.validateStage(multiple).errors.some((entry) => entry.code === 'unsupported_material'));

  const mismatchedSteel = makeStage();
  mismatchedSteel.materials[0] = { id: 'steel', type: 'destructible', destructible: true, color: '#49515B' };
  assert.ok(core.validateStage(mismatchedSteel).errors.some((entry) => entry.code === 'unsupported_material'));
});

test('generator can deterministically create partial and whole steel stages', () => {
  const partial = makeStage({ preset: 'rolling', generationParameters: { steelMode: 'partial' } });
  const whole = makeStage({ preset: 'rolling', generationParameters: { steelMode: 'whole' } });
  const partialAgain = makeStage({ preset: 'rolling', generationParameters: { steelMode: 'partial' } });
  assert.deepEqual(partial.terrain.materialSegments, partialAgain.terrain.materialSegments);
  assert.equal(partial.materials.some((material) => material.id === 'steel'), true);
  assert.equal(partial.terrain.materialSegments.some((column) => column.length > 0), true);
  assert.equal(core.validateStage(partial).valid, true);
  assert.deepEqual(whole.materials, [{ id: 'steel', type: 'indestructible', destructible: false, color: '#49515B' }]);
  assert.equal(whole.terrain.materialSegments.some((column) => column.length > 0), false);
  assert.equal(core.validateStage(whole).valid, true);
});

test('game compatibility accepts only vNNN ranges containing the current build', () => {
  const accepted = makeStage();
  accepted.gameCompatibility = { gameId: core.GAME_ID, minBuild: 'v100', maxBuild: 'v200' };
  assert.equal(core.validateStage(accepted).valid, true);

  const future = makeStage();
  future.gameCompatibility.minBuild = 'v999';
  assert.ok(core.validateStage(future).errors.some((entry) => entry.code === 'compatibility_unsupported'));

  const expired = makeStage();
  expired.gameCompatibility.minBuild = 'v1';
  expired.gameCompatibility.maxBuild = 'v100';
  assert.ok(core.validateStage(expired).errors.some((entry) => entry.code === 'compatibility_unsupported'));

  const reversed = makeStage();
  reversed.gameCompatibility = { gameId: core.GAME_ID, minBuild: 'v200', maxBuild: 'v100' };
  assert.ok(core.validateStage(reversed).errors.some((entry) => entry.code === 'compatibility_build_range'));

  for (const malformed of ['137', 'latest', 'v1.37', 'V137', '', null]) {
    const stage = makeStage();
    stage.gameCompatibility.minBuild = malformed;
    assert.ok(core.validateStage(stage).errors.some((entry) => entry.code === 'compatibility_build_format'), String(malformed));
  }
});

test('security validation rejects executable strings, external URLs, unsafe paths and non-finite numbers', () => {
  const cases = [
    ['javascript:alert(1)', 'executable_content'],
    ['https://example.invalid/image.png', 'external_url'],
    ['../outside/file.png', 'unsafe_path']
  ];
  for (const [description, code] of cases) {
    const stage = makeStage();
    stage.description = description;
    assert.ok(core.validateStage(stage).errors.some((entry) => entry.code === code), code);
  }
  const nonFinite = makeStage();
  nonFinite.spawnPoints[0].x = Infinity;
  assert.ok(core.validateStage(nonFinite).errors.some((entry) => entry.code === 'non_finite'));

  const unknown = makeStage();
  unknown.arbitrary = '<div>not allowed</div>';
  assert.ok(core.validateStage(unknown).errors.some((entry) => entry.code === 'unknown_field'));
});

test('finalization rejects unsafe raw data before normalization and does not mutate prototypes', async () => {
  const malicious = makeStage();
  malicious.generation.parameters = JSON.parse('{"__proto__":{"polluted":true}}');
  await assert.rejects(
    () => core.finalizeStage(malicious, { touchUpdatedAt: false }),
    (error) => error.validation.errors.some((entry) => entry.code === 'unsafe_key')
  );
  assert.equal({}.polluted, undefined);

  const unknown = makeStage();
  unknown.unexpected = 'https://example.invalid/payload';
  await assert.rejects(
    () => core.finalizeStage(unknown, { touchUpdatedAt: false }),
    (error) => error.validation.errors.some((entry) => entry.code === 'external_url' || entry.code === 'unknown_field')
  );
});

test('runtime validation enforces required fields, nested types and additionalProperties from the schema', () => {
  const missing = makeStage();
  delete missing.authorDisplayName;
  assert.ok(core.validateStage(missing).errors.some((entry) => entry.code === 'schema_required' && entry.path === '$.authorDisplayName'));

  const nestedUnknown = makeStage();
  nestedUnknown.background.injectedStyle = 'display:none';
  assert.ok(core.validateStage(nestedUnknown).errors.some((entry) => entry.code === 'schema_additional_property' && entry.path === '$.background.injectedStyle'));

  const wrongType = makeStage();
  wrongType.spawnPoints[0].order = '1';
  assert.ok(core.validateStage(wrongType).errors.some((entry) => entry.code === 'schema_type' && entry.path === '$.spawnPoints[0].order'));

  const invalidDate = makeStage();
  invalidDate.createdAt = 'today';
  assert.ok(core.validateStage(invalidDate).errors.some((entry) => entry.code === 'schema_date_time' && entry.path === '$.createdAt'));
});

test('normalization, canonical JSON and SHA-256 are stable', async () => {
  const stage = makeStage({ seed: 'hash-test', preset: 'mountainCenter' });
  stage.spawnPoints.reverse();
  const normalized = core.normalizeStage(stage);
  const canonical = core.canonicalStringify(normalized);
  assert.equal(canonical, core.canonicalStringify(JSON.parse(canonical)));

  const finalized = await core.finalizeStage(normalized, { touchUpdatedAt: false });
  assert.match(finalized.checksums.contentHash, /^[a-f0-9]{64}$/);
  assert.equal((await core.verifyStageHash(finalized)).valid, true);

  const tampered = core.normalizeStage(finalized);
  tampered.title += ' 改変';
  tampered.checksums.contentHash = finalized.checksums.contentHash;
  assert.equal((await core.verifyStageHash(tampered)).valid, false);
});

test('safe file names and game adapter contain no executable input', async () => {
  assert.equal(core.safeFileName('../<script>:stage?', '.stage.json'), 'script-stage.stage.json');
  const finalized = await core.finalizeStage(makeStage({ seed: 'adapter', preset: 'valley' }), { touchUpdatedAt: false });
  const adapter = core.toGameAdapter(finalized);
  assert.equal(adapter.stageId, finalized.stageId);
  assert.equal(adapter.contentHash, finalized.checksums.contentHash);
  assert.deepEqual(adapter.segments, finalized.terrain.columns);
  assert.equal(adapter.pattern, 'custom');
});

test('projectile test play uses shared gravity, wind and collision functions', () => {
  assert.equal(core.PHYSICS.deadLineY, core.LIMITS.terrainBottom);
  assert.equal(core.PHYSICS.fallTrigger, 22);
  const stage = makeStage({ preset: 'flat', wind: { direction: 1, strength: 0.5 } });
  const spawn = stage.spawnPoints[0];
  const trace = core.traceProjectile(stage, { x: spawn.x, y: spawn.y - 10, angle: 52, power: 58, maxSeconds: 8 });
  assert.ok(trace.points.length > 2);
  assert.equal(trace.wind.direction, 1);
  assert.equal(trace.wind.strength, 0.5);
  assert.ok(['terrain', 'out', 'timeout'].includes(trace.outcome));
});

test('migration accepts only the current declared schema version', () => {
  const stage = makeStage();
  assert.deepEqual(core.migrateStage(stage), core.normalizeStage(stage));
  const future = core.normalizeStage(stage);
  future.schemaVersion = '99.0.0';
  assert.throws(() => core.migrateStage(future), /対応外/);
});
