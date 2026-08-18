import { describe, expect, it } from 'vitest';
import { LEGACY_CHARACTERS } from '../../src/domain/legacy-characters';
import { createInitialCharacterRecords, searchCharacterRecords, stableCharacterId } from '../../src/domain/character-db';

describe('character database foundation', () => {
  it('creates a repeatable immutable identity for every legacy character', () => {
    const records = createInitialCharacterRecords('2026-01-01T00:00:00.000Z');
    expect(records).toHaveLength(LEGACY_CHARACTERS.length);
    expect(new Set(records.map((record) => record.characterId)).size).toBe(records.length);
    expect(records.every((record) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u.test(record.characterId))).toBe(true);
    expect(stableCharacterId('cool-kai')).toBe(records.find((record) => record.slug === 'cool-kai')?.characterId);
  });

  it('keeps legacy keys as compatibility data while making the slug searchable', () => {
    const records = createInitialCharacterRecords();
    expect(searchCharacterRecords(records, 'クール=カイ')[0]?.slug).toBe('cool-kai');
    expect(searchCharacterRecords(records, 'coolKai')[0]?.legacyId).toBe('coolKai');
    expect(searchCharacterRecords(records, 'faces-left').length).toBeGreaterThan(0);
  });
});
