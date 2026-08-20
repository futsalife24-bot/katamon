import type { CharacterForm, SkillParameters, SpecialTemplate } from './types.js';

export interface DeclarativeSkillDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  template: Exclude<SpecialTemplate, 'custom-required'>;
  projectile: {
    power: number;
    count: number;
    intervalMs: number;
    speedMultiplier: number;
    gravityMultiplier: number;
    penetrationCount: number;
  };
  impact: {
    mode: 'standard' | 'area' | 'explosion' | 'emp';
    radiusMultiplier: number;
    knockback: number;
  };
  selfEffect: { heal: number } | null;
  targetEffect: { kind: 'movement-lock'; chance: number; durationTurns: number } | null;
  cooldownTurns: number;
  effectRef: string;
  soundRef: string;
}

export interface SkillTemplateConversion {
  autoRegistrable: boolean;
  definition: DeclarativeSkillDefinition | null;
  customImplementationNote: string | null;
}

function projectileValues(template: Exclude<SpecialTemplate, 'custom-required'>, parameters: SkillParameters) {
  switch (template) {
    case 'multi-shot':
      return { count: parameters.projectileCount, intervalMs: parameters.intervalMs };
    case 'straight':
      return { count: 1, intervalMs: 0, gravityMultiplier: 0 };
    default:
      return { count: 1, intervalMs: 0 };
  }
}

/**
 * Converts a selected template to data only. It never evaluates user text and
 * never emits JavaScript source supplied by a user.
 */
export function convertSkillTemplate(character: CharacterForm): SkillTemplateConversion {
  if (character.specialTemplate === 'custom-required') {
    return {
      autoRegistrable: false,
      definition: null,
      customImplementationNote: character.customImplementationNote,
    };
  }

  const template = character.specialTemplate;
  const parameters = character.specialParameters;
  const projectile = projectileValues(template, parameters);
  const impactMode = template === 'emp'
    ? 'emp'
    : template === 'area'
      ? 'area'
      : template === 'explosion'
        ? 'explosion'
        : 'standard';

  return {
    autoRegistrable: true,
    customImplementationNote: null,
    definition: {
      schemaVersion: 1,
      id: `${character.slug}-special`,
      name: character.specialName,
      description: character.specialDescription,
      template,
      projectile: {
        power: parameters.power,
        count: projectile.count,
        intervalMs: projectile.intervalMs,
        speedMultiplier: parameters.projectileSpeed,
        gravityMultiplier: projectile.gravityMultiplier ?? parameters.gravityMultiplier,
        penetrationCount: template === 'piercing' ? parameters.penetrationCount : 0,
      },
      impact: {
        mode: impactMode,
        radiusMultiplier: parameters.explosionRadius,
        knockback: template === 'knockback' ? parameters.knockback : 0,
      },
      selfEffect: template === 'healing' ? { heal: parameters.healing } : null,
      targetEffect: template === 'emp'
        ? {
            kind: 'movement-lock',
            chance: parameters.statusChance,
            durationTurns: parameters.statusDurationTurns,
          }
        : null,
      cooldownTurns: parameters.cooldownTurns,
      effectRef: parameters.effectRef,
      soundRef: parameters.soundRef,
    },
  };
}

export const NORMAL_SKILL_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  id: 'standard-projectile' as const,
  readOnly: true as const,
});
