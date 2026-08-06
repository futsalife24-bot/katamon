import { convertSkillTemplate } from '../domain/skills';
import { spriteMetadataSchema } from '../domain/schemas';
import { GENERATOR_VERSION, type ArtifactBundle, type ArtifactFile, type CharacterForm, type MotionClipId, type SpriteMetadata, type ValidationIssue } from '../domain/types';
import { assertValidCharacter, isAllowedGeneratedPath, type CharacterIdentity } from '../domain/validation';
import {
  buildCompatibilityCatalog,
  buildContentManifest,
  canonicalCharacterRecordSchema,
  serializeCompatibilityCatalog,
  type CanonicalCharacterRecord,
} from './catalog';
import { sha256Blob, sha256Text } from './hash';
import { buildGeneratedPaths } from './paths';
import { buildPullRequestBody } from './pr-body';
import { stableJsonFile, stableStringify, utf8Length } from './stable';

export interface ArtifactImages {
  sourceImage?: Blob;
  normalizedPng: Blob;
  optimizedWebp: Blob;
  iconPng: Blob;
  thumbnailWebp: Blob;
  spriteSheetPng: Blob;
  motionSpriteSheets?: Record<MotionClipId, Blob>;
  previewPng: Blob;
}

export interface BuildArtifactBundleInput {
  character: CharacterForm;
  spriteMetadata: SpriteMetadata;
  motionMetadata?: Record<MotionClipId, SpriteMetadata>;
  images: ArtifactImages;
  createdAt?: string;
  generatorVersion?: string;
  existingCharacters?: readonly CharacterIdentity[];
  existingCanonicalRecords?: readonly CanonicalCharacterRecord[];
  expectedBaseSha?: string;
  currentCharacter?: CharacterIdentity;
}

const MIME_BY_IMAGE_KEY: Record<keyof Omit<ArtifactImages, 'sourceImage' | 'motionSpriteSheets'>, string> = {
  normalizedPng: 'image/png',
  optimizedWebp: 'image/webp',
  iconPng: 'image/png',
  thumbnailWebp: 'image/webp',
  spriteSheetPng: 'image/png',
  previewPng: 'image/png',
};

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/webp') {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

async function assertValidBlob(blob: Blob, expectedMime: string | undefined, label: string, maximumBytes: number) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new ArtifactGenerationError(`${label} が空です`);
  if (blob.size > maximumBytes) throw new ArtifactGenerationError(`${label} の容量が上限を超えています`);
  if (expectedMime && blob.type !== expectedMime) throw new ArtifactGenerationError(`${label} の形式が正しくありません`);
  if (!expectedMime && !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new ArtifactGenerationError(`${label} の形式が正しくありません`);
  }
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!hasImageSignature(header, blob.type)) throw new ArtifactGenerationError(`${label} の画像署名が正しくありません`);
}

async function textFile(
  path: string,
  mimeType: string,
  kind: ArtifactFile['kind'],
  text: string,
): Promise<ArtifactFile> {
  return { path, mimeType, kind, text, byteLength: utf8Length(text), sha256: await sha256Text(text) };
}

async function blobFile(
  path: string,
  kind: ArtifactFile['kind'],
  blob: Blob,
  knownSha256?: string,
): Promise<ArtifactFile> {
  return { path, mimeType: blob.type, kind, blob, byteLength: blob.size, sha256: knownSha256 ?? await sha256Blob(blob) };
}

function validateCreatedAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ArtifactGenerationError('生成日時が正しくありません');
  }
  return value;
}

export async function buildArtifactBundle(input: BuildArtifactBundleInput): Promise<ArtifactBundle> {
  const character = assertValidCharacter(input.character, {
    existing: [
      ...(input.existingCharacters ?? []),
      ...(input.existingCanonicalRecords ?? []).map(({ character: existing }) => ({ id: existing.id, slug: existing.slug })),
    ],
    current: input.currentCharacter,
  });
  const generatorVersion = input.generatorVersion ?? GENERATOR_VERSION;
  const createdAt = validateCreatedAt(input.createdAt ?? new Date().toISOString());

  await assertValidBlob(input.images.normalizedPng, MIME_BY_IMAGE_KEY.normalizedPng, '正規化PNG', 8 * 1024 * 1024);
  await assertValidBlob(input.images.optimizedWebp, MIME_BY_IMAGE_KEY.optimizedWebp, '軽量WebP', 5 * 1024 * 1024);
  await assertValidBlob(input.images.iconPng, MIME_BY_IMAGE_KEY.iconPng, 'アイコン', 2 * 1024 * 1024);
  await assertValidBlob(input.images.thumbnailWebp, MIME_BY_IMAGE_KEY.thumbnailWebp, 'サムネイル', 2 * 1024 * 1024);
  await assertValidBlob(input.images.spriteSheetPng, MIME_BY_IMAGE_KEY.spriteSheetPng, 'スプライトシート', 16 * 1024 * 1024);
  if (input.images.motionSpriteSheets) {
    for (const [clipId, blob] of Object.entries(input.images.motionSpriteSheets)) {
      await assertValidBlob(blob, 'image/png', `${clipId}スプライトシート`, 16 * 1024 * 1024);
    }
  }
  await assertValidBlob(input.images.previewPng, MIME_BY_IMAGE_KEY.previewPng, 'プレビュー', 4 * 1024 * 1024);
  if (input.images.sourceImage) await assertValidBlob(input.images.sourceImage, undefined, '元画像', 20 * 1024 * 1024);

  const imageHashes = {
    normalizedPng: await sha256Blob(input.images.normalizedPng),
    optimizedWebp: await sha256Blob(input.images.optimizedWebp),
    iconPng: await sha256Blob(input.images.iconPng),
    thumbnailWebp: await sha256Blob(input.images.thumbnailWebp),
    spriteSheetPng: await sha256Blob(input.images.spriteSheetPng),
    previewPng: await sha256Blob(input.images.previewPng),
    sourceImage: input.images.sourceImage ? await sha256Blob(input.images.sourceImage) : null,
    motionSpriteSheets: input.images.motionSpriteSheets
      ? Object.fromEntries(await Promise.all(Object.entries(input.images.motionSpriteSheets).map(async ([clipId, blob]) => [clipId, await sha256Blob(blob)])))
      : null,
  };
  const assetVersionHash = await sha256Text(stableStringify({
    createdAt,
    generatorVersion,
    character: { id: character.id, slug: character.slug, implementationVersion: character.implementationVersion },
    images: imageHashes,
    sprite: {
      frameWidth: input.spriteMetadata.frameWidth,
      frameHeight: input.spriteMetadata.frameHeight,
      frameCount: input.spriteMetadata.frameCount,
      fps: input.spriteMetadata.fps,
      anchorX: input.spriteMetadata.anchorX,
      anchorY: input.spriteMetadata.anchorY,
      contentBounds: input.spriteMetadata.contentBounds,
      collisionBounds: input.spriteMetadata.collisionBounds,
      preset: input.spriteMetadata.preset,
      motionParameters: input.spriteMetadata.motionParameters,
      partMasks: input.spriteMetadata.partMasks,
    },
  }));
  const paths = buildGeneratedPaths(character.slug, assetVersionHash, input.images.sourceImage?.type, Boolean(input.images.motionSpriteSheets && input.motionMetadata));
  const normalizedMotionMetadata = input.motionMetadata
    ? Object.fromEntries(Object.entries(input.motionMetadata).map(([clipId, metadata]) => [clipId, spriteMetadataSchema.parse({
      ...metadata,
      sourceImage: paths.assets.normalizedPng,
      clipId,
      generatedAt: createdAt,
      generatorVersion,
    })])) as Record<MotionClipId, SpriteMetadata>
    : undefined;
  const spriteMetadata = normalizedMotionMetadata?.['move-forward'] ?? spriteMetadataSchema.parse({
      ...input.spriteMetadata,
      sourceImage: paths.assets.normalizedPng,
      generatedAt: createdAt,
      generatorVersion,
    }) as SpriteMetadata;

  const record: CanonicalCharacterRecord = canonicalCharacterRecordSchema.parse({
    schemaVersion: 1,
    character,
    assets: paths.assets,
    spriteMetadata,
    ...(normalizedMotionMetadata ? { motionMetadata: normalizedMotionMetadata } : {}),
    generatorVersion,
  }) as CanonicalCharacterRecord;
  const records = [
    ...(input.existingCanonicalRecords ?? []).filter(({ character: existing }) => !input.currentCharacter ||
      existing.id.toLocaleLowerCase('en-US') !== input.currentCharacter.id.toLocaleLowerCase('en-US') ||
      existing.slug.toLocaleLowerCase('en-US') !== input.currentCharacter.slug.toLocaleLowerCase('en-US')),
    record,
  ];

  const issues: ValidationIssue[] = [];
  if (!input.images.sourceImage) {
    issues.push({ severity: 'info', code: 'image.source_not_included', message: '元画像は生成物へ含まれていません' });
  }
  if (!convertSkillTemplate(character).autoRegistrable) {
    issues.push({
      severity: 'warning',
      code: 'skill.custom_implementation_required',
      field: 'specialTemplate',
      message: '必殺技のカスタム実装が必要なため互換カタログへ自動登録しません',
    });
  }

  const files: ArtifactFile[] = [];
  files.push(await blobFile(paths.assets.normalizedPng, 'image', input.images.normalizedPng, imageHashes.normalizedPng));
  files.push(await blobFile(paths.assets.optimizedWebp, 'image', input.images.optimizedWebp, imageHashes.optimizedWebp));
  files.push(await blobFile(paths.assets.iconPng, 'image', input.images.iconPng, imageHashes.iconPng));
  files.push(await blobFile(paths.assets.thumbnailWebp, 'image', input.images.thumbnailWebp, imageHashes.thumbnailWebp));
  if (input.images.motionSpriteSheets && normalizedMotionMetadata && paths.assets.motionSpriteSheets && paths.assets.motionMetadataJson) {
    for (const clipId of Object.keys(input.images.motionSpriteSheets) as MotionClipId[]) {
      files.push(await blobFile(paths.assets.motionSpriteSheets[clipId], 'sprite', input.images.motionSpriteSheets[clipId], imageHashes.motionSpriteSheets?.[clipId]));
      files.push(await textFile(paths.assets.motionMetadataJson[clipId], 'application/json', 'metadata', stableJsonFile(normalizedMotionMetadata[clipId])));
    }
  } else {
    files.push(await blobFile(paths.assets.spriteSheetPng, 'sprite', input.images.spriteSheetPng, imageHashes.spriteSheetPng));
    files.push(await textFile(paths.assets.spriteMetadataJson, 'application/json', 'metadata', stableJsonFile(spriteMetadata)));
  }
  files.push(await blobFile(paths.assets.previewPng, 'preview', input.images.previewPng, imageHashes.previewPng));
  if (input.images.sourceImage && paths.assets.sourceImage) {
    files.push(await blobFile(paths.assets.sourceImage, 'image', input.images.sourceImage, imageHashes.sourceImage ?? undefined));
  }

  files.push(await textFile(paths.characterJson, 'application/json', 'character-data', stableJsonFile(record)));
  const catalog = buildCompatibilityCatalog(records, generatorVersion);
  files.push(await textFile(paths.catalogScript, 'text/javascript', 'game-catalog', serializeCompatibilityCatalog(catalog)));
  files.push(await textFile(paths.manifestJson, 'application/json', 'metadata', buildContentManifest(records, generatorVersion)));

  files.sort((left, right) => left.path.localeCompare(right.path, 'en-US'));
  const pathsSeen = new Set<string>();
  for (const file of files) {
    if (!isAllowedGeneratedPath(file.path)) throw new ArtifactGenerationError('許可されていない生成パスが含まれています');
    if (pathsSeen.has(file.path)) throw new ArtifactGenerationError('生成パスが重複しています');
    pathsSeen.add(file.path);
  }

  const bundleId = await sha256Text(stableStringify(files.map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }))));
  const partial = { character, spriteMetadata, files, issues, generatorVersion };
  return {
    bundleId,
    createdAt,
    generatorVersion,
    character,
    spriteMetadata,
    files,
    issues,
    prBody: buildPullRequestBody(partial),
    expectedBaseSha: input.expectedBaseSha,
  };
}

export class ArtifactGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactGenerationError';
  }
}
