import { DEFAULT_CHARACTER, DEFAULT_MOTION } from '../../src/domain/defaults';
import type { CharacterForm, SpriteMetadata } from '../../src/domain/types';
import { buildSpriteMetadata } from '../../src/generation/sprite-metadata';

export function sampleCharacter(overrides: Partial<CharacterForm> = {}): CharacterForm {
  return {
    ...structuredClone(DEFAULT_CHARACTER),
    id: 'sample-unit',
    slug: 'sample-unit',
    displayName: 'サンプルキャラクター',
    description: '検証用の汎用キャラクターです。',
    specialName: 'サンプルショット',
    specialDescription: '決定的な単発技です。',
    ...overrides,
  };
}

export function sampleMetadata(overrides: Partial<SpriteMetadata> = {}): SpriteMetadata {
  return {
    ...buildSpriteMetadata({
      frameWidth: 256,
      frameHeight: 256,
      frameCount: 8,
      fps: 8,
      anchorX: 0.5,
      anchorY: 0.92,
      contentBounds: { x: 24, y: 16, width: 208, height: 216 },
      sourceImage: 'temporary-source.png',
      preset: 'standard',
      motionParameters: structuredClone(DEFAULT_MOTION),
      generatedAt: '2026-08-06T00:00:00.000Z',
    }),
    ...overrides,
  };
}
