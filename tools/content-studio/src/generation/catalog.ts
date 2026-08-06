import { z } from 'zod';

import { characterFormSchema, spriteMetadataSchema } from '../domain/schemas.js';
import { convertSkillTemplate, NORMAL_SKILL_DEFINITION, type DeclarativeSkillDefinition } from '../domain/skills.js';
import { GENERATOR_VERSION, type CharacterForm, type SpriteMetadata } from '../domain/types.js';
import { isAllowedGeneratedPath } from '../domain/validation.js';
import type { GeneratedAssetPaths } from './paths.js';
import { stableJsonFile, stableStringify } from './stable.js';

const generatedAssetPathsSchema = z.object({
  directory: z.string().regex(/^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}$/u),
  sourceImage: z.string().optional(),
  normalizedPng: z.string(),
  optimizedWebp: z.string(),
  iconPng: z.string(),
  thumbnailWebp: z.string(),
  spriteSheetPng: z.string(),
  spriteMetadataJson: z.string(),
  previewPng: z.string(),
}).superRefine((assets, context) => {
  for (const [field, path] of Object.entries(assets)) {
    if (field === 'directory' || path === undefined) continue;
    if (!isAllowedGeneratedPath(path)) context.addIssue({ code: 'custom', path: [field], message: '許可されていない生成パスです' });
  }
});

export const canonicalCharacterRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    character: characterFormSchema,
    assets: generatedAssetPathsSchema,
    spriteMetadata: spriteMetadataSchema,
    generatorVersion: z.string().min(1).max(32),
  })
  .strict()
  .superRefine((record, context) => {
    const expectedDirectoryPrefix = `assets/content-studio/${record.character.slug}/`;
    if (!record.assets.directory.startsWith(expectedDirectoryPrefix)) {
      context.addIssue({ code: 'custom', path: ['assets', 'directory'], message: 'asset directoryとslugが一致しません' });
    }
    const expectedPaths: Partial<Record<keyof GeneratedAssetPaths, string>> = {
      normalizedPng: `${record.assets.directory}/character.png`,
      optimizedWebp: `${record.assets.directory}/character.webp`,
      iconPng: `${record.assets.directory}/icon.png`,
      thumbnailWebp: `${record.assets.directory}/thumbnail.webp`,
      spriteSheetPng: `${record.assets.directory}/idle.png`,
      spriteMetadataJson: `${record.assets.directory}/idle.json`,
      previewPng: `${record.assets.directory}/preview.png`,
    };
    for (const [field, expected] of Object.entries(expectedPaths)) {
      if (record.assets[field as keyof GeneratedAssetPaths] !== expected) {
        context.addIssue({ code: 'custom', path: ['assets', field], message: '生成ファイル参照が一致しません' });
      }
    }
    if (record.assets.sourceImage && !new RegExp(`^${record.assets.directory}/source\\.(?:png|jpg|webp)$`, 'u').test(record.assets.sourceImage)) {
      context.addIssue({ code: 'custom', path: ['assets', 'sourceImage'], message: '元画像参照が一致しません' });
    }
    if (record.spriteMetadata.sourceImage !== record.assets.normalizedPng) {
      context.addIssue({ code: 'custom', path: ['spriteMetadata', 'sourceImage'], message: 'スプライトの元画像参照が一致しません' });
    }
  });

export interface CanonicalCharacterRecord {
  schemaVersion: 1;
  character: CharacterForm;
  assets: GeneratedAssetPaths;
  spriteMetadata: SpriteMetadata;
  generatorVersion: string;
}

export interface CompatibilityCharacter {
  key: string;
  slug: string;
  name: string;
  role: string;
  roleEn: string;
  desc: string;
  selectStats: [number, number, number];
  specialDesc: string;
  maxHp: number;
  blastMul: number;
  windMul: number;
  fuelMul: number;
  velScaleMul: number;
  damageTakenMul: number;
  guideMul: number;
  gravityMul: number;
  specialVelocityMul: number;
  tBias: number;
  color: string;
  special: string;
  facesLeft: boolean;
  spriteScale: number;
  assetBase: string;
  icon: string;
  idleSheet: string;
  idleMetadata: string;
  face: [number, number, number];
  matchupFace: [number, number, number];
  normalSkill: typeof NORMAL_SKILL_DEFINITION;
  specialSkill: DeclarativeSkillDefinition;
  implementationVersion: string;
}

export interface CompatibilityCatalog {
  schemaVersion: 1;
  generatorVersion: string;
  order: string[];
  characters: Record<string, CompatibilityCharacter>;
}

export function createCompatibilityCharacter(record: CanonicalCharacterRecord): CompatibilityCharacter | null {
  const skill = convertSkillTemplate(record.character);
  if (!skill.autoRegistrable || !skill.definition) return null;
  const character = record.character;
  return {
    key: character.id,
    slug: character.slug,
    name: character.displayName,
    role: character.classification,
    roleEn: character.classification.toLocaleUpperCase('en-US'),
    desc: character.description,
    selectStats: [character.defense, character.attack, character.speed],
    specialDesc: character.specialDescription,
    maxHp: character.maxHp,
    blastMul: character.blastMultiplier,
    windMul: character.windMultiplier,
    fuelMul: character.fuelMultiplier,
    velScaleMul: character.velocityMultiplier,
    damageTakenMul: character.damageTakenMultiplier,
    guideMul: character.guideMultiplier,
    gravityMul: character.gravityMultiplier,
    specialVelocityMul: character.specialVelocityMultiplier,
    tBias: character.cpuTargetBias,
    color: character.color,
    special: character.specialName,
    facesLeft: character.sourceFacesLeft,
    spriteScale: character.spriteScale,
    assetBase: record.assets.normalizedPng.replace(/\.png$/u, ''),
    icon: record.assets.iconPng,
    idleSheet: record.assets.spriteSheetPng,
    idleMetadata: record.assets.spriteMetadataJson,
    face: [character.faceCrop.x, character.faceCrop.y, character.faceCrop.width],
    matchupFace: [character.matchupCrop.x, character.matchupCrop.y, character.matchupCrop.width],
    normalSkill: NORMAL_SKILL_DEFINITION,
    specialSkill: skill.definition,
    implementationVersion: character.implementationVersion,
  };
}

export function buildCompatibilityCatalog(
  records: readonly CanonicalCharacterRecord[],
  generatorVersion = GENERATOR_VERSION,
): CompatibilityCatalog {
  const sorted = [...records]
    .map((record) => canonicalCharacterRecordSchema.parse(record) as CanonicalCharacterRecord)
    .sort((left, right) => left.character.id.localeCompare(right.character.id, 'en-US'));

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const record of sorted) {
    const id = record.character.id.toLocaleLowerCase('en-US');
    const slug = record.character.slug.toLocaleLowerCase('en-US');
    if (ids.has(id) || slugs.has(slug)) throw new Error('互換カタログに重複したIDまたはslugがあります');
    ids.add(id);
    slugs.add(slug);
  }

  const entries: Array<[string, CompatibilityCharacter]> = [];
  for (const record of sorted) {
    const compatible = createCompatibilityCharacter(record);
    if (compatible) entries.push([record.character.id, compatible]);
  }
  return {
    schemaVersion: 1,
    generatorVersion,
    order: entries.map(([id]) => id),
    characters: Object.fromEntries(entries),
  };
}

function escapeForJavaScriptJson(json: string): string {
  return json
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

export function serializeCompatibilityCatalog(catalog: CompatibilityCatalog): string {
  const json = escapeForJavaScriptJson(stableStringify(catalog, 2));
  return `/* Generated by Content Studio. Do not edit manually. */\nglobalThis.__CONTENT_STUDIO_CATALOG__ = ${json};\n`;
}

export function buildContentManifest(
  records: readonly CanonicalCharacterRecord[],
  generatorVersion = GENERATOR_VERSION,
): string {
  const characters = [...records]
    .sort((left, right) => left.character.slug.localeCompare(right.character.slug, 'en-US'))
    .map((record) => ({
      id: record.character.id,
      slug: record.character.slug,
      contentFile: `content/characters/${record.character.slug}.json`,
      assetDirectory: record.assets.directory,
      autoRegistrable: convertSkillTemplate(record.character).autoRegistrable,
      implementationVersion: record.character.implementationVersion,
    }));
  return stableJsonFile({ schemaVersion: 1, generatorVersion, characters });
}
