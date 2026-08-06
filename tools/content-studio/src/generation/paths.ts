import { safeIdentifierSchema } from '../domain/schemas.js';

export interface GeneratedAssetPaths {
  directory: string;
  sourceImage?: string;
  normalizedPng: string;
  optimizedWebp: string;
  iconPng: string;
  thumbnailWebp: string;
  spriteSheetPng: string;
  spriteMetadataJson: string;
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
): GeneratedContentPaths {
  const slug = safeIdentifierSchema.parse(slugInput);
  if (!/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error('画像ハッシュが正しくありません');
  const shortHash = contentHash.slice(0, 12);
  const directory = `assets/content-studio/${slug}/${shortHash}`;
  const sourceImage = sourceMimeType
    ? `${directory}/source.${extensionForImageMime(sourceMimeType)}`
    : undefined;

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
      spriteSheetPng: `${directory}/idle.png`,
      spriteMetadataJson: `${directory}/idle.json`,
      previewPng: `${directory}/preview.png`,
    },
  };
}
