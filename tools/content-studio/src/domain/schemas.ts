import { z } from 'zod';

import type {
  CharacterForm,
  DraftRecord,
  ImageEditorState,
  ImageInfo,
  ImageOperation,
  MotionParameters,
  PreviewSettings,
  SpriteMetadata,
  ValidationIssue,
} from './types.js';
import { DRAFT_SCHEMA_VERSION } from './types.js';
import { getUnsafePathReason, getUnsafeTextReason } from './security.js';

const addUnsafeTextIssue = (value: string, context: z.RefinementCtx) => {
  const reason = getUnsafeTextReason(value);
  if (reason) {
    context.addIssue({
      code: 'custom',
      message: `安全でない入力です (${reason})`,
    });
  }
};

const plainText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum).superRefine(addUnsafeTextIssue);

const optionalPlainText = (maximum: number) =>
  z.string().trim().max(maximum).superRefine(addUnsafeTextIssue);

export const safeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[a-z][a-z0-9-]*$/u, '小文字英数字とハイフンだけを使用してください')
  .refine((value) => !value.includes('--'), 'ハイフンを連続させないでください')
  .refine((value) => getUnsafePathReason(value) === null, '安全な識別子を指定してください');

export const assetReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, '許可された参照名を指定してください')
  .refine((value) => getUnsafePathReason(value) === null, '安全な参照名を指定してください');

const cropPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.05).max(1),
});

export const skillParametersSchema = z.object({
  power: z.number().finite().min(0.05).max(5),
  projectileCount: z.number().int().min(1).max(12),
  intervalMs: z.number().int().min(0).max(3_000),
  projectileSpeed: z.number().finite().min(0.1).max(5),
  gravityMultiplier: z.number().finite().min(0).max(3),
  explosionRadius: z.number().finite().min(0.1).max(5),
  penetrationCount: z.number().int().min(0).max(20),
  cooldownTurns: z.number().int().min(1).max(20),
  knockback: z.number().finite().min(0).max(500),
  statusChance: z.number().finite().min(0).max(1),
  statusDurationTurns: z.number().int().min(0).max(20),
  healing: z.number().int().min(0).max(999),
  effectRef: assetReferenceSchema,
  soundRef: assetReferenceSchema,
});

export const characterFormSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: safeIdentifierSchema,
    slug: safeIdentifierSchema,
    displayName: plainText(1, 40).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'),
    attribute: z.enum(['neutral', 'fire', 'water', 'earth', 'wind', 'light', 'dark']),
    classification: plainText(1, 40).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'),
    rarity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    description: optionalPlainText(500),
    tags: z
      .array(plainText(1, 24).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'))
      .max(20)
      .superRefine((tags, context) => {
        const seen = new Set<string>();
        tags.forEach((tag, index) => {
          const folded = tag.toLocaleLowerCase('en-US');
          if (seen.has(folded)) {
            context.addIssue({ code: 'custom', path: [index], message: 'タグが重複しています' });
          }
          seen.add(folded);
        });
      }),
    maxHp: z.number().int().min(1).max(999),
    attack: z.number().int().min(1).max(5),
    defense: z.number().int().min(1).max(5),
    speed: z.number().int().min(1).max(5),
    weight: z.number().int().min(1).max(5),
    movement: z.enum(['ground', 'floating', 'flying', 'flexible']),
    blastMultiplier: z.number().finite().min(0.1).max(3),
    windMultiplier: z.number().finite().min(0.1).max(3),
    fuelMultiplier: z.number().finite().min(0.1).max(3),
    velocityMultiplier: z.number().finite().min(0.1).max(3),
    damageTakenMultiplier: z.number().finite().min(0.1).max(3),
    guideMultiplier: z.number().finite().min(0.1).max(3),
    gravityMultiplier: z.number().finite().min(0).max(3),
    specialVelocityMultiplier: z.number().finite().min(0.1).max(3),
    cpuTargetBias: z.number().finite().min(0.1).max(3),
    color: z.string().regex(/^#[0-9a-f]{6}$/iu, '6桁の色コードを指定してください'),
    sourceFacesLeft: z.boolean(),
    spriteScale: z.number().finite().min(0.25).max(3),
    faceCrop: cropPointSchema,
    matchupCrop: cropPointSchema,
    normalSkillId: z.literal('standard-projectile'),
    specialName: plainText(1, 40).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'),
    specialDescription: optionalPlainText(200),
    specialTemplate: z.enum([
      'single',
      'multi-shot',
      'straight',
      'area',
      'explosion',
      'piercing',
      'knockback',
      'healing',
      'emp',
      'custom-required',
    ]),
    specialParameters: skillParametersSchema,
    customImplementationNote: optionalPlainText(1_000),
    implementationVersion: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9][a-z0-9._-]*$/iu, '安全なバージョンを指定してください')
      .refine((value) => !value.includes('..'), '連続するピリオドは使用できません'),
  })
  .strict()
  .superRefine((character, context) => {
    if (character.specialTemplate === 'custom-required' && character.customImplementationNote.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['customImplementationNote'],
        message: 'カスタム実装の仕様メモが必要です',
      });
    }
  });

/** Drafts deliberately allow the four fields that are empty at the first step. */
export const draftCharacterFormSchema = characterFormSchema.safeExtend({
  id: z.union([z.literal(''), safeIdentifierSchema]),
  slug: z.union([z.literal(''), safeIdentifierSchema]),
  displayName: optionalPlainText(40).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'),
  specialName: optionalPlainText(40).refine((value) => !/[\r\n]/u.test(value), '改行は使用できません'),
});

export const motionParametersSchema = z.object({
  frameCount: z.union([z.literal(8), z.literal(12)]),
  fps: z.number().finite().min(1).max(30),
  durationMs: z.number().int().min(250).max(10_000),
  moveX: z.number().finite().min(-64).max(64),
  moveY: z.number().finite().min(-64).max(64),
  scaleAmount: z.number().finite().min(0).max(0.25),
  squashAmount: z.number().finite().min(0).max(0.25),
  rotationDegrees: z.number().finite().min(-15).max(15),
  idlePause: z.number().finite().min(0).max(0.9),
  groundContact: z.number().finite().min(0).max(1),
  intensity: z.number().finite().min(0).max(2),
  flipHorizontal: z.boolean(),
  canvasPadding: z.number().int().min(0).max(128),
  outputSize: z.union([z.literal(128), z.literal(256), z.literal(384), z.literal(512)]),
  lightweightPreview: z.boolean(),
});

const imageInfoSchema = z.object({
  fileName: plainText(1, 160).refine((value) => getUnsafePathReason(value) === null && !/[\\/]/u.test(value), '安全なファイル名を指定してください'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteLength: z.number().int().min(0).max(25 * 1024 * 1024),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
  hasAlpha: z.boolean(),
  colorMode: z.enum(['sRGB', 'Display-P3', 'unknown']),
  estimatedOutputBytes: z.number().int().min(0).max(25 * 1024 * 1024),
  status: z.enum(['idle', 'reading', 'ready', 'processing', 'error']),
  warnings: z.array(optionalPlainText(200)).max(20),
});

const imageEditorStateSchema = z.object({
  tolerance: z.number().int().min(0).max(255),
  edgeFeather: z.number().finite().min(0).max(16),
  brushSize: z.number().finite().min(1).max(256),
  offsetX: z.number().finite().min(-2_048).max(2_048),
  offsetY: z.number().finite().min(-2_048).max(2_048),
  scale: z.number().finite().min(0.05).max(8),
  flipHorizontal: z.boolean(),
  padding: z.number().int().min(0).max(512),
  outputSize: z.union([z.literal(128), z.literal(256), z.literal(384), z.literal(512)]),
  zoom: z.number().finite().min(0.1).max(8),
  tool: z.enum(['pan', 'erase', 'restore']),
});

const previewSettingsSchema = z.object({
  background: z.enum(['light', 'dark', 'game']),
  direction: z.enum(['left', 'right']),
  size: z.enum(['small', 'normal']),
  showAnchor: z.boolean(),
  showCollision: z.boolean(),
  playing: z.boolean(),
});

const validationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: plainText(1, 80),
  field: optionalPlainText(120).optional(),
  message: plainText(1, 500),
});

const imageOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('remove-background'), tolerance: z.number().min(0).max(255), feather: z.number().min(0).max(16) }),
  z.object({
    type: z.literal('brush'),
    mode: z.enum(['erase', 'restore']),
    size: z.number().min(1).max(256),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(50_000),
  }),
  z.object({ type: z.literal('trim') }),
  z.object({
    type: z.literal('transform'),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    scale: z.number().finite().min(0.05).max(8),
    flipHorizontal: z.boolean(),
    padding: z.number().min(0).max(512),
  }),
]);

export const draftRecordSchema = z
  .object({
    schemaVersion: z.literal(DRAFT_SCHEMA_VERSION),
    id: z.string().uuid(),
    title: plainText(1, 80),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    lastStep: z.enum(['image', 'cutout', 'motion', 'details', 'skills', 'preview', 'validate', 'publish', 'complete']),
    character: draftCharacterFormSchema,
    imageInfo: imageInfoSchema.nullable(),
    editor: imageEditorStateSchema,
    motionPreset: z.enum(['standard', 'heavy', 'light', 'hover', 'flying', 'flexible', 'winged', 'mechanical', 'breathing', 'almost-still']),
    motion: motionParametersSchema,
    preview: previewSettingsSchema,
    validation: z.array(validationIssueSchema).max(200),
    processingOperations: z.array(imageOperationSchema).max(2_000),
    historyStatus: z.enum(['clean', 'dirty', 'corrupt']),
    mockScenario: z.enum(['success', 'network-offline', 'tests-failed', 'conflict']),
    sourceIdentity: z.object({ id: safeIdentifierSchema, slug: safeIdentifierSchema }).nullable().default(null),
  })
  .strict();

const contentBoundsSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const spriteMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    frameWidth: z.number().int().positive().max(4_096),
    frameHeight: z.number().int().positive().max(4_096),
    frameCount: z.union([z.literal(8), z.literal(12)]),
    fps: z.number().finite().positive().max(30),
    loop: z.literal(true),
    anchorX: z.number().finite().min(0).max(1),
    anchorY: z.number().finite().min(0).max(1),
    contentBounds: contentBoundsSchema,
    collisionBounds: contentBoundsSchema,
    sourceImage: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (value) => getUnsafePathReason(value) === null &&
          !value.includes('://') && !value.startsWith('//') && !/[?#\\]/u.test(value),
        '安全な画像参照を指定してください',
      ),
    preset: z.enum(['standard', 'heavy', 'light', 'hover', 'flying', 'flexible', 'winged', 'mechanical', 'breathing', 'almost-still']),
    motionParameters: motionParametersSchema,
    partMasks: z.array(z.object({
      id: assetReferenceSchema,
      label: plainText(1, 40),
      blobKey: z.string().max(160).regex(/^[a-z0-9:_-]+$/iu, '安全な保存キーを指定してください').optional(),
    })).max(32),
    generatedAt: z.string().datetime({ offset: true }),
    generatorVersion: z.string().min(1).max(32),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.frameCount !== metadata.motionParameters.frameCount) {
      context.addIssue({ code: 'custom', path: ['frameCount'], message: 'モーション設定のフレーム数と一致しません' });
    }
    for (const field of ['contentBounds', 'collisionBounds'] as const) {
      const bounds = metadata[field];
      if (bounds.x + bounds.width > metadata.frameWidth || bounds.y + bounds.height > metadata.frameHeight) {
        context.addIssue({ code: 'custom', path: [field], message: '境界がフレーム外です' });
      }
    }
  });

// Compile-time checks keep schemas aligned with the shared UI/domain interfaces.
type _CharacterSchemaCheck = z.infer<typeof characterFormSchema> extends CharacterForm ? true : never;
type _DraftSchemaCheck = z.infer<typeof draftRecordSchema> extends DraftRecord ? true : never;
type _MotionSchemaCheck = z.infer<typeof motionParametersSchema> extends MotionParameters ? true : never;
type _ImageInfoSchemaCheck = z.infer<typeof imageInfoSchema> extends ImageInfo ? true : never;
type _EditorSchemaCheck = z.infer<typeof imageEditorStateSchema> extends ImageEditorState ? true : never;
type _PreviewSchemaCheck = z.infer<typeof previewSettingsSchema> extends PreviewSettings ? true : never;
type _ValidationSchemaCheck = z.infer<typeof validationIssueSchema> extends ValidationIssue ? true : never;
type _OperationSchemaCheck = z.infer<typeof imageOperationSchema> extends ImageOperation ? true : never;
type _MetadataSchemaCheck = z.infer<typeof spriteMetadataSchema> extends SpriteMetadata ? true : never;

export const CharacterFormSchema = characterFormSchema;
export const DraftRecordSchema = draftRecordSchema;
export const MotionParametersSchema = motionParametersSchema;
export const SpriteMetadataSchema = spriteMetadataSchema;
