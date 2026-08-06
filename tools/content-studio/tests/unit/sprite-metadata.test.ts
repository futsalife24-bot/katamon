import { describe, expect, it } from 'vitest';

import { DEFAULT_MOTION } from '../../src/domain/defaults';
import { buildSpriteMetadata, suggestCollisionBounds } from '../../src/generation/sprite-metadata';

describe('buildSpriteMetadata', () => {
  it('builds deterministic metadata and a lower-body collision candidate', () => {
    const contentBounds = { x: 20, y: 10, width: 200, height: 220 };
    const input = {
      frameWidth: 256,
      frameHeight: 256,
      frameCount: 8,
      fps: 8,
      anchorX: 0.5,
      anchorY: 0.92,
      contentBounds,
      sourceImage: 'assets/content-studio/sample-unit/0123456789ab/character.png',
      preset: 'standard' as const,
      motionParameters: structuredClone(DEFAULT_MOTION),
      generatedAt: '2026-08-06T00:00:00.000Z',
    };
    expect(buildSpriteMetadata(input)).toEqual(buildSpriteMetadata(input));
    expect(buildSpriteMetadata(input).collisionBounds).toEqual(suggestCollisionBounds(contentBounds));
  });

  it('rejects bounds outside the canvas', () => {
    expect(() => buildSpriteMetadata({
      frameWidth: 128,
      frameHeight: 128,
      frameCount: 8,
      fps: 8,
      anchorX: 0.5,
      anchorY: 1,
      contentBounds: { x: 0, y: 0, width: 129, height: 128 },
      sourceImage: 'source.png',
      preset: 'standard',
      motionParameters: structuredClone(DEFAULT_MOTION),
      generatedAt: '2026-08-06T00:00:00.000Z',
    })).toThrow('フレーム外');
  });
});
