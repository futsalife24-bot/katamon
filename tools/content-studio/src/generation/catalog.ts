import { editingCheckpointSchema, type EditingCheckpoint } from '../domain/editing-checkpoint.js';
import { z } from 'zod';

import { characterFormSchema, spriteMetadataSchema } from '../domain/schemas.js';
import { LEGACY_CHARACTERS, LEGACY_CHARACTER_IDS, getLegacyRepositoryIdentity, type LegacyCharacterId } from '../domain/legacy-characters.js';
import { convertSkillTemplate, NORMAL_SKILL_DEFINITION, type DeclarativeSkillDefinition } from '../domain/skills.js';
import { GENERATOR_VERSION, type CharacterForm, type CharacterUnlock, type MotionClipId, type SpriteMetadata } from '../domain/types.js';
import { isAllowedGeneratedPath } from '../domain/validation.js';
import type { GeneratedAssetPaths } from './paths.js';
import { stableJsonFile, stableStringify } from './stable.js';

const motionPathMapSchema = z.object({
  'move-forward': z.string(),
  'move-backward': z.string(),
  fire: z.string(),
  hit: z.string(),
  land: z.string(),
});

const motionMetadataMapSchema = z.object({
  'move-forward': spriteMetadataSchema,
  'move-backward': spriteMetadataSchema,
  fire: spriteMetadataSchema,
  hit: spriteMetadataSchema,
  land: spriteMetadataSchema,
});

const generatedAssetPathsSchema = z.object({
  directory: z.string().regex(/^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}$/u),
  sourceImage: z.string().optional(),
  editSourcePng: z.string().optional(),
  editHitPng: z.string().optional(),
  normalizedPng: z.string(),
  optimizedWebp: z.string(),
  iconPng: z.string(),
  thumbnailWebp: z.string(),
  spriteSheetPng: z.string(),
  spriteMetadataJson: z.string(),
  motionSpriteSheets: motionPathMapSchema.optional(),
  motionMetadataJson: motionPathMapSchema.optional(),
  previewPng: z.string(),
}).superRefine((assets, context) => {
  for (const [field, path] of Object.entries(assets)) {
    if (field === 'directory' || path === undefined || typeof path !== 'string') continue;
    if (!isAllowedGeneratedPath(path)) context.addIssue({ code: 'custom', path: [field], message: '許可されていない生成パスです' });
  }
  for (const field of ['motionSpriteSheets', 'motionMetadataJson'] as const) {
    const paths = assets[field];
    if (!paths) continue;
    for (const [clipId, path] of Object.entries(paths)) {
      if (!isAllowedGeneratedPath(path)) context.addIssue({ code: 'custom', path: [field, clipId], message: '許可されていない生成パスです' });
    }
  }
});

export const canonicalCharacterRecordSchema = z
  .object({
    editing: editingCheckpointSchema.optional(),
    schemaVersion: z.literal(1),
    character: characterFormSchema,
    assets: generatedAssetPathsSchema,
    spriteMetadata: spriteMetadataSchema,
    motionMetadata: motionMetadataMapSchema.optional(),
    legacyTargetId: z.enum(LEGACY_CHARACTER_IDS).optional(),
    generatorVersion: z.string().min(1).max(32),
  })
  .strict()
  .superRefine((record, context) => {
    if (Boolean(record.editing) !== Boolean(record.assets.editSourcePng) || Boolean(record.editing?.hitSource) !== Boolean(record.assets.editHitPng)) {
      context.addIssue({code:'custom',path:['editing'],message:'編集入力の参照が揃っていません'});
    }
    if (record.editing) {
      if(record.editing.generatorVersion!==record.generatorVersion) context.addIssue({code:'custom',path:['editing'],message:'編集形式と生成器versionが一致しません'});
      if (!record.motionMetadata || record.assets.editSourcePng !== `${record.assets.directory}/edit-source.png` || (record.assets.editHitPng && record.assets.editHitPng !== `${record.assets.directory}/edit-hit.png`)) context.addIssue({code:'custom',path:['editing'],message:'編集入力の場所が不正です'});
      if ((record.editing.landmarks.facing === 'left') !== record.character.sourceFacesLeft) context.addIssue({code:'custom',path:['editing'],message:'編集入力と原画方向が一致しません'});
      for (const id of ['move-forward','move-backward','fire','hit','land'] as const) {
        const meta=record.motionMetadata?.[id], settings=record.editing.clips[id];
        if (!meta?.rendering || meta.generatorVersion!==record.editing.generatorVersion || meta.preset!==settings.preset || stableStringify(meta.motionParameters)!==stableStringify(settings.parameters) || meta.frameWidth!==record.editing.outputSize) context.addIssue({code:'custom',path:['editing','clips',id],message:'実使用モーション設定と編集情報が一致しません'});
      }
    }
    const reserved = new Set(LEGACY_CHARACTERS.flatMap(c => [c.id.toLowerCase(), c.slug]));
    if (!record.legacyTargetId && (reserved.has(record.character.id.toLowerCase()) || reserved.has(record.character.slug))) {
      context.addIssue({ code: 'custom', path: ['character', 'id'], message: '既存キャラクターのID/slugはモーション追加からのみ使用できます' });
    }
    const expectedDirectoryPrefix = `assets/content-studio/${record.character.slug}/`;
    if (!record.assets.directory.startsWith(expectedDirectoryPrefix)) {
      context.addIssue({ code: 'custom', path: ['assets', 'directory'], message: 'asset directoryとslugが一致しません' });
    }
    const expectedPaths: Partial<Record<keyof GeneratedAssetPaths, string>> = {
      normalizedPng: `${record.assets.directory}/character.png`,
      optimizedWebp: `${record.assets.directory}/character.webp`,
      iconPng: `${record.assets.directory}/icon.png`,
      thumbnailWebp: `${record.assets.directory}/thumbnail.webp`,
      spriteSheetPng: record.assets.motionSpriteSheets?.['move-forward'] ?? `${record.assets.directory}/idle.png`,
      spriteMetadataJson: record.assets.motionMetadataJson?.['move-forward'] ?? `${record.assets.directory}/idle.json`,
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
    if (record.legacyTargetId) {
      const expectedIdentity = getLegacyRepositoryIdentity(record.legacyTargetId as LegacyCharacterId);
      if (record.character.id !== expectedIdentity.id || record.character.slug !== expectedIdentity.slug) {
        context.addIssue({
          code: 'custom',
          path: ['legacyTargetId'],
          message: '既存キャラクターのIDとslugが更新対象に一致しません。',
        });
      }
    }
    const clipIds = ['move-forward', 'move-backward', 'fire', 'hit', 'land'] as const;
    if (record.assets.motionSpriteSheets || record.assets.motionMetadataJson || record.motionMetadata) {
      if (!record.assets.motionSpriteSheets || !record.assets.motionMetadataJson || !record.motionMetadata) {
        context.addIssue({ code: 'custom', path: ['motionMetadata'], message: '5種類のモーション参照が揃っていません' });
      } else {
        if (stableStringify(record.spriteMetadata) !== stableStringify(record.motionMetadata['move-forward'])) {
          context.addIssue({ code: 'custom', path: ['spriteMetadata'], message: '共通スプライト情報と前進モーション情報が一致しません' });
        }
        const rendering = record.motionMetadata['move-forward'].rendering;
        if (rendering && (rendering.sourceFacing === 'left') !== record.character.sourceFacesLeft) {
          context.addIssue({ code: 'custom', path: ['character', 'sourceFacesLeft'], message: '原画方向と生成済みモーションの方向が一致しません' });
        }
        for (const clipId of clipIds) {
          const currentRendering = record.motionMetadata[clipId].rendering;
          if (Boolean(rendering) !== Boolean(currentRendering) || (rendering && currentRendering?.sourceFacing !== rendering.sourceFacing)) {
            context.addIssue({ code: 'custom', path: ['motionMetadata', clipId, 'rendering'], message: '5動作の描画形式・原画方向が一致しません' });
          }
          if (record.assets.motionSpriteSheets[clipId] !== `${record.assets.directory}/${clipId}.png`) {
            context.addIssue({ code: 'custom', path: ['assets', 'motionSpriteSheets', clipId], message: 'モーション画像参照が一致しません' });
          }
          if (record.assets.motionMetadataJson[clipId] !== `${record.assets.directory}/${clipId}.json`) {
            context.addIssue({ code: 'custom', path: ['assets', 'motionMetadataJson', clipId], message: 'モーション情報参照が一致しません' });
          }
          if (record.motionMetadata[clipId].clipId !== clipId || record.motionMetadata[clipId].sourceImage !== record.assets.normalizedPng) {
            context.addIssue({ code: 'custom', path: ['motionMetadata', clipId], message: 'モーション情報の参照が一致しません' });
          }
        }
      }
    }
  });

export interface CanonicalCharacterRecord {
  editing?: EditingCheckpoint;
  schemaVersion: 1;
  character: CharacterForm;
  assets: GeneratedAssetPaths;
  spriteMetadata: SpriteMetadata;
  motionMetadata?: Record<MotionClipId, SpriteMetadata>;
  legacyTargetId?: string;
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
  specialEnabled: boolean;
  facesLeft: boolean;
  spriteScale: number;
  assetBase: string;
  icon: string;
  idleSheet: string;
  idleMetadata: string;
  motionSheets?: Record<MotionClipId, string>;
  motionMetadata?: Record<MotionClipId, string>;
  face: [number, number, number];
  matchupFace: [number, number, number];
  normalSkill: typeof NORMAL_SKILL_DEFINITION;
  specialSkill: DeclarativeSkillDefinition | null;
  implementationVersion: string;
  unlock: CharacterUnlock;
  legacyTargetId?: string;
}

export interface CompatibilityCatalog {
  schemaVersion: 1;
  generatorVersion: string;
  order: string[];
  characters: Record<string, CompatibilityCharacter>;
}

export function createCompatibilityCharacter(record: CanonicalCharacterRecord): CompatibilityCharacter | null {
  const skill = convertSkillTemplate(record.character);
  if (record.character.specialEnabled && (!skill.autoRegistrable || !skill.definition)) return null;
  const character = record.character;
  return {
    key: record.legacyTargetId ?? character.id,
    slug: character.slug,
    name: character.displayName,
    role: character.classification,
    roleEn: character.classification.toLocaleUpperCase('en-US'),
    desc: character.description,
    selectStats: [character.defense, character.attack, character.speed],
    specialDesc: character.specialEnabled ? character.specialDescription : '必殺技は未設定です。',
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
    special: character.specialEnabled ? character.specialName : '未設定',
    specialEnabled: character.specialEnabled,
    facesLeft: character.sourceFacesLeft,
    spriteScale: character.spriteScale,
    assetBase: record.assets.normalizedPng.replace(/\.png$/u, ''),
    icon: record.assets.iconPng,
    idleSheet: record.assets.spriteSheetPng,
    idleMetadata: record.assets.spriteMetadataJson,
    ...(record.assets.motionSpriteSheets ? { motionSheets: record.assets.motionSpriteSheets } : {}),
    ...(record.assets.motionMetadataJson ? { motionMetadata: record.assets.motionMetadataJson } : {}),
    face: [character.faceCrop.x, character.faceCrop.y, character.faceCrop.width],
    matchupFace: [character.matchupCrop.x, character.matchupCrop.y, character.matchupCrop.width],
    normalSkill: NORMAL_SKILL_DEFINITION,
    specialSkill: character.specialEnabled ? skill.definition : null,
    implementationVersion: character.implementationVersion,
    unlock: character.unlock,
    ...(record.legacyTargetId ? { legacyTargetId: record.legacyTargetId } : {}),
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
    const id = (record.legacyTargetId ?? record.character.id).toLocaleLowerCase('en-US');
    const slug = record.character.slug.toLocaleLowerCase('en-US');
    if (ids.has(id) || slugs.has(slug)) throw new Error('互換カタログに重複したIDまたはslugがあります');
    ids.add(id);
    slugs.add(slug);
  }

  const entries: Array<[string, CompatibilityCharacter]> = [];
  for (const record of sorted) {
    const compatible = createCompatibilityCharacter(record);
    if (compatible) entries.push([compatible.key, compatible]);
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
      autoRegistrable: !record.character.specialEnabled || convertSkillTemplate(record.character).autoRegistrable,
      implementationVersion: record.character.implementationVersion,
    }));
  return stableJsonFile({ schemaVersion: 1, generatorVersion, characters });
}
