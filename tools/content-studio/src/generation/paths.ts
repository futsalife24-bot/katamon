import { safeIdentifierSchema } from '../domain/schemas.js';
import type { MotionClipId } from '../domain/types.js';

const MOTION_FILE_STEMS: Record<MotionClipId, string> = {
  'move-forward': 'move-forward',
  'move-backward': 'move-backward',
  fire: 'fire',
  hit: 'hit',
  land: 'land',
};

export interface GeneratedAssetPaths {
  directory: string;
  sourceImage?: string;
  normalizedPng: string;
  optimizedWebp: string;
  iconPng: string;
  thumbnailWebp: string;
  spriteSheetPng: string;
  spriteMetadataJson: string;
  motionSpriteSheets?: Record<MotionClipId, string>;
  motionMetadataJson?: Record<MotionClipId, string>;
  previewPng: string;
}

export interface GeneratedContentPaths {
  characterJson: string;
  catalogScript: 'generated/content-studio-catalog.js';
  manifestJson: 'generated/content-studio-manifest.json';
  assets: GeneratedAssetPaths;
}

export function extensionForImageMime(mimeType: string): 'png' | 'jpg' | 'webp' {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: throw new Error('未対応の画像形式です');
  }
}

export function buildGeneratedPaths(
  slugInput: string,
  contentHash: string,
  sourceMimeType?: string,
  includeMotionBatch = false,
): GeneratedContentPaths {
  const slug = safeIdentifierSchema.parse(slugInput);
  if (!/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error('画像ハッシュが正しくありません');
  const shortHash = contentHash.slice(0, 12);
  const directory = `assets/content-studio/${slug}/${shortHash}`;
  const sourceImage = sourceMimeType
    ? `${directory}/source.${extensionForImageMime(sourceMimeType)}`
    : undefined;

  const motionSpriteSheets = Object.fromEntries(Object.entries(MOTION_FILE_STEMS).map(([clipId, stem]) => [clipId, `${directory}/${stem}.png`])) as Record<MotionClipId, string>;
  const motionMetadataJson = Object.fromEntries(Object.entries(MOTION_FILE_STEMS).map(([clipId, stem]) => [clipId, `${directory}/${stem}.json`])) as Record<MotionClipId, string>;
  return {
    characterJson: `content/characters/${slug}.json`,
    catalogScript: 'generated/content-studio-catalog.js',
    manifestJson: 'generated/content-studio-manifest.json',
    assets: {
      directory,
      sourceImage,
      normalizedPng: `${directory}/character.png`,
      optimizedWebp: `${directory}/character.webp`,
      iconPng: `${directory}/icon.png`,
      thumbnailWebp: `${directory}/thumbnail.webp`,
      spriteSheetPng: includeMotionBatch ? motionSpriteSheets['move-forward'] : `${directory}/idle.png`,
      spriteMetadataJson: includeMotionBatch ? motionMetadataJson['move-forward'] : `${directory}/idle.json`,
      ...(includeMotionBatch ? { motionSpriteSheets, motionMetadataJson } : {}),
      previewPng: `${directory}/preview.png`,
    },
  };
}
