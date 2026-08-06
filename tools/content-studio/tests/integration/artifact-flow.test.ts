import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildCompatibilityCatalog, canonicalCharacterRecordSchema } from '../../src/generation/catalog';
import { createArtifactZip } from '../../src/generation/zip';
import { sampleCharacter } from '../unit/test-character';
import { sampleBundle } from './test-bundle';

describe('artifact generation flow', () => {
  it('creates deterministic, collision-safe files from actual blobs', async () => {
    const first = await sampleBundle();
    const second = await sampleBundle();
    expect(first.bundleId).toBe(second.bundleId);
    expect(first.files.map(({ path }) => path)).toEqual([...first.files.map(({ path }) => path)].sort());
    expect(first.files.map(({ path }) => path)).toEqual(expect.arrayContaining([
      'content/characters/sample-unit.json',
      'generated/content-studio-catalog.js',
      'generated/content-studio-manifest.json',
    ]));
    expect(first.files.some(({ path }) => /assets\/content-studio\/sample-unit\/[a-f0-9]{12}\/idle\.png/u.test(path))).toBe(true);
    expect(first.prBody).toContain('サンプルキャラクター');
    expect(first.prBody).toContain('自動確認');

    const canonical = first.files.find(({ kind }) => kind === 'character-data');
    expect(canonicalCharacterRecordSchema.safeParse(JSON.parse(canonical!.text!)).success).toBe(true);
  });

  it('exports every planned file to a deterministic ZIP', async () => {
    const bundle = await sampleBundle();
    const first = new Uint8Array(await (await createArtifactZip(bundle.files)).arrayBuffer());
    const second = new Uint8Array(await (await createArtifactZip(bundle.files)).arrayBuffer());
    expect(first).toEqual(second);
    expect(Object.keys(unzipSync(first)).sort()).toEqual(bundle.files.map(({ path }) => path).sort());
    const changed = bundle.files.map((file, index) => index === 0 ? { ...file, byteLength: file.byteLength + 1 } : file);
    await expect(createArtifactZip(changed)).rejects.toThrow('整合性');
  });

  it('uses a new immutable asset directory for a later generation', async () => {
    const first = await sampleBundle(sampleCharacter(), '2026-08-06T00:00:00.000Z');
    const second = await sampleBundle(sampleCharacter(), '2026-08-06T00:01:00.000Z');
    const firstImage = first.files.find(({ path }) => path.endsWith('/character.png'))!;
    const secondImage = second.files.find(({ path }) => path.endsWith('/character.png'))!;
    expect(firstImage.path).not.toBe(secondImage.path);
  });

  it('does not register custom-required skills in the compatibility catalog', async () => {
    const bundle = await sampleBundle(sampleCharacter({
      specialEnabled: true,
      specialTemplate: 'custom-required',
      customImplementationNote: '専用処理を別途実装する。',
    }));
    const recordFile = bundle.files.find(({ kind }) => kind === 'character-data')!;
    const record = canonicalCharacterRecordSchema.parse(JSON.parse(recordFile.text!));
    expect(buildCompatibilityCatalog([record]).order).toEqual([]);
    expect(bundle.issues.some(({ code }) => code === 'skill.custom_implementation_required')).toBe(true);
  });

  it('rejects canonical records whose asset directory does not match the slug', async () => {
    const bundle = await sampleBundle();
    const recordFile = bundle.files.find(({ kind }) => kind === 'character-data')!;
    const record = JSON.parse(recordFile.text!) as Record<string, any>;
    record.assets.directory = record.assets.directory.replace('/sample-unit/', '/different-unit/');
    expect(canonicalCharacterRecordSchema.safeParse(record).success).toBe(false);
  });
});
