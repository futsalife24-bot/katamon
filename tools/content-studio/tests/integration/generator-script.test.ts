import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateGameContent } from '../../scripts/generate-game-content';
import { LEGACY_CHARACTERS, getLegacyRepositoryIdentity } from '../../src/domain/legacy-characters';
import { canonicalRecordBytes } from '../unit/server-fixtures';
import { sampleBundle } from './test-bundle';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('generate-game-content script', () => {
  it('regenerates all current legacy motion overlays without reserved identity rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'content-studio-test-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'content/characters'), { recursive: true });
    for (const legacy of LEGACY_CHARACTERS) {
      const identity = getLegacyRepositoryIdentity(legacy.id);
      const record = JSON.parse(canonicalRecordBytes().toString().replaceAll('sample-unit', identity.slug));
      record.legacyTargetId = legacy.id;
      await writeFile(join(root, `content/characters/${identity.slug}.json`), JSON.stringify(record));
    }
    const generated = await generateGameContent({ repoRoot: root });
    expect(generated.recordCount).toBe(LEGACY_CHARACTERS.length);
    expect(generated.catalogText).toContain('hamulton');
    expect((await generateGameContent({ repoRoot: root, check: true })).catalogText).toBe(generated.catalogText);
  });
  it('regenerates and checks the catalog from canonical JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'content-studio-test-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'content/characters'), { recursive: true });
    const bundle = await sampleBundle();
    const characterFile = bundle.files.find(({ kind }) => kind === 'character-data')!;
    await writeFile(join(root, characterFile.path), characterFile.text!, 'utf8');

    const generated = await generateGameContent({ repoRoot: root });
    expect(generated.recordCount).toBe(1);
    expect(await readFile(generated.catalogPath, 'utf8')).toBe(generated.catalogText);
    expect(generated.catalogText).toContain('sample-unit');
    await expect(generateGameContent({ repoRoot: root, check: true })).resolves.toMatchObject({ recordCount: 1 });
  });
});
