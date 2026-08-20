import { describe, expect, it } from 'vitest';

import { convertSkillTemplate } from '../../src/domain/skills';
import type { SpecialTemplate } from '../../src/domain/types';
import { sampleCharacter } from './test-character';

describe('convertSkillTemplate', () => {
  it.each<SpecialTemplate>([
    'single', 'multi-shot', 'straight', 'area', 'explosion', 'piercing', 'knockback', 'healing', 'emp',
  ])('converts the fixed %s template without code generation', (template) => {
    const result = convertSkillTemplate(sampleCharacter({ specialTemplate: template }));
    expect(result.autoRegistrable).toBe(true);
    expect(result.definition?.template).toBe(template);
    expect(JSON.stringify(result.definition)).not.toContain('function');
  });

  it('maps only relevant parameters', () => {
    const character = sampleCharacter({
      specialTemplate: 'emp',
      specialParameters: {
        ...sampleCharacter().specialParameters,
        statusChance: 0.75,
        statusDurationTurns: 2,
      },
    });
    expect(convertSkillTemplate(character).definition?.targetEffect).toEqual({
      kind: 'movement-lock', chance: 0.75, durationTurns: 2,
    });
  });

  it('keeps custom specifications out of automatic registration', () => {
    const result = convertSkillTemplate(sampleCharacter({
      specialTemplate: 'custom-required',
      customImplementationNote: '専用の挙動を別途実装する。',
    }));
    expect(result.autoRegistrable).toBe(false);
    expect(result.definition).toBeNull();
  });
});
