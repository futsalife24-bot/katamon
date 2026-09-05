import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { LEGACY_CHARACTERS, getLegacyRepositoryIdentity } from '../../src/domain/legacy-characters';
import { canonicalCharacterRecordSchema } from '../../src/generation/catalog';
import { loadPublishedContent } from '../../src/game/published-content';
import { canonicalRecordBytes, serverTestConfig, submittedFile } from './server-fixtures';
import { validateSubmission } from '../../server/validation';

afterEach(() => vi.unstubAllGlobals());
describe('Phase 1 legacy and partial catalog regression', () => {
  it('matches the game list in order, including hamulton, without changing game identity', () => {
    const source = readFileSync(new URL('../../../../index.html', import.meta.url), 'utf8');
    const ids = [...source.match(/const LEGACY_CHARACTER_LIST = \[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(LEGACY_CHARACTERS.map(c => c.id)).toEqual(ids);
    for (const c of LEGACY_CHARACTERS) {
      expect(readFileSync(new URL(`../../../../assets/characters/runtime/${c.asset}.webp`, import.meta.url)).length).toBeGreaterThan(0);
      const record = JSON.parse(canonicalRecordBytes().toString());
      const identity = getLegacyRepositoryIdentity(c.id);
      record.character = { ...record.character, ...identity };
      record.legacyTargetId = c.id;
      const text = JSON.stringify(record).replaceAll('sample-unit', identity.slug);
      expect(canonicalCharacterRecordSchema.safeParse(JSON.parse(text)).success).toBe(true);
    }
    expect(getLegacyRepositoryIdentity('doRednote')).toEqual({ id: 'do-rednote', slug: 'do-rednote' });
    expect(getLegacyRepositoryIdentity('coolKai')).toEqual({ id: 'cool-kai', slug: 'cool-kai' });
  });
  it.each([
    { schemaVersion: 1, characters: [{ contentFile: '../bad.json' }] },
    { schemaVersion: 1, characters: [{ contentFile: 'content/characters/sample-unit.json' }] },
  ])('does not label missing/invalid canonical data a healthy empty catalog', async manifest => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://studio.invalid' });
    const result = await loadPublishedContent(vi.fn().mockResolvedValueOnce(Response.json(manifest)).mockResolvedValue(Response.json({})));
    expect(result.warning).not.toBeNull();
  });
  it('a missing manifest is an unavailable snapshot, not a confirmed empty snapshot', async () => {
    vi.stubGlobal('location', { pathname: '/', origin: 'https://studio.invalid' });
    expect((await loadPublishedContent(vi.fn().mockResolvedValue(new Response('', { status: 404 })))).warning).not.toBeNull();
  });
  it('requires the aliased sprite metadata to equal move-forward metadata', () => {
    const record = JSON.parse(canonicalRecordBytes().toString());
    const clips = ['move-forward','move-backward','fire','hit','land'];
    record.motionMetadata = Object.fromEntries(clips.map(clipId => [clipId,{...record.spriteMetadata,clipId}]));
    record.assets.motionSpriteSheets = Object.fromEntries(clips.map(c => [c,record.assets.directory+'/'+c+'.png']));
    record.assets.motionMetadataJson = Object.fromEntries(clips.map(c => [c,record.assets.directory+'/'+c+'.json']));
    record.assets.spriteSheetPng = record.assets.motionSpriteSheets['move-forward'];
    record.assets.spriteMetadataJson = record.assets.motionMetadataJson['move-forward'];
    record.spriteMetadata = {...record.motionMetadata['move-forward']};
    expect(canonicalCharacterRecordSchema.safeParse(record).success).toBe(true);
    record.spriteMetadata.fps += 1;
    expect(canonicalCharacterRecordSchema.safeParse(record).success).toBe(false);
  });
  it('rejects a forged new character using a legacy identity', () => {
    const record = JSON.parse(canonicalRecordBytes().toString().replaceAll('sample-unit', 'hamulton'));
    const input = { bundleId: 'test', generatorVersion: '0.1.0', character: record.character, prBody: 'test', files: [submittedFile('content/characters/hamulton.json', 'application/json', Buffer.from(JSON.stringify(record)))] };
    expect(() => validateSubmission(input, serverTestConfig())).toThrow();
  });
});
