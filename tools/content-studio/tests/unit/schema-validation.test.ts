import { describe, expect, it } from 'vitest';

import { characterFormSchema } from '../../src/domain/schemas';
import { getUnsafePathReason, getUnsafeTextReason } from '../../src/domain/security';
import { isAllowedGeneratedPath, validateCharacter } from '../../src/domain/validation';
import { sampleCharacter } from './test-character';

describe('characterFormSchema', () => {
  it('accepts a complete generic character', () => {
    expect(characterFormSchema.safeParse(sampleCharacter()).success).toBe(true);
  });

  it.each([
    ['HTML', { displayName: '<img src=x onerror=alert(1)>' }],
    ['active scheme', { description: 'javascript:alert(1)' }],
    ['control character', { specialName: 'sample\u0000skill' }],
    ['path traversal', { slug: '../sample-unit' }],
    ['mixed-case id', { id: 'Sample-Unit' }],
  ])('rejects %s', (_label, overrides) => {
    expect(characterFormSchema.safeParse(sampleCharacter(overrides)).success).toBe(false);
  });

  it('detects all legacy identifiers and case-only collisions', () => {
    const exact = validateCharacter(sampleCharacter({ id: 'kyoryu' }));
    expect(exact.some(({ code }) => code === 'id.legacy_duplicate')).toBe(true);

    const caseOnly = validateCharacter(sampleCharacter({ id: 'KYORYU' }));
    expect(caseOnly.some(({ code }) => code === 'id.legacy_case_collision')).toBe(true);
  });

  it('detects canonical id and slug collisions independently', () => {
    const issues = validateCharacter(sampleCharacter({ id: 'new-id', slug: 'new-slug' }), {
      existing: [{ id: 'new-id', slug: 'NEW-SLUG' }],
    });
    expect(issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'id.canonical_duplicate',
      'slug.canonical_case_collision',
    ]));
  });

  it('accepts a streak, login and achievement unlock contract while rejecting invalid targets', () => {
    expect(characterFormSchema.safeParse(sampleCharacter({
      unlock: { enabled: true, type: 'streak', target: 30, achievementId: '', description: '連戦30勝で解放' },
    })).success).toBe(true);
    expect(characterFormSchema.safeParse(sampleCharacter({
      unlock: { enabled: true, type: 'achievement', target: 1, achievementId: 'steel-stage-clear', description: '鋼鉄ステージを突破' },
    })).success).toBe(true);
    expect(characterFormSchema.safeParse(sampleCharacter({
      unlock: { enabled: true, type: 'wins', target: 0, achievementId: '', description: '' },
    })).success).toBe(false);
  });
});

describe('security boundaries', () => {
  it('does not echo unsafe text while classifying it', () => {
    expect(getUnsafeTextReason('<script>unsafe()</script>')).toBe('html');
    expect(getUnsafePathReason('content/../private')).toBe('path-traversal');
  });

  it('allows only generated repository paths', () => {
    expect(isAllowedGeneratedPath('content/characters/sample-unit.json')).toBe(true);
    expect(isAllowedGeneratedPath('assets/content-studio/sample-unit/0123456789ab/character.png')).toBe(true);
    expect(isAllowedGeneratedPath('../index.html')).toBe(false);
    expect(isAllowedGeneratedPath('assets/content-studio/sample-unit/0123456789ab/../../index.html')).toBe(false);
  });
});
