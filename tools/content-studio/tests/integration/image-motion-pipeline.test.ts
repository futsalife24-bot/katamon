import { describe, expect, it, vi } from 'vitest';

import { analyzeBackground } from '../../src/image/analysis';
import { normalizeImage, removeEdgeConnectedBackground } from '../../src/image/processing';
import type { PixelBuffer } from '../../src/image/types';
import { generateIdleSpriteSheet } from '../../src/motion/generator';

function sourceWithBackground(): PixelBuffer {
  const width = 64;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const background = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 246 : 232;
      data.set([background, background, background, 255], (y * width + x) * 4);
    }
  }
  for (let y = 10; y < 43; y += 1) {
    for (let x = 18; x < 47; x += 1) data.set([210, 120, 25, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('画像から待機モーションまでの端末内統合', () => {
  it('検出→背景除去→正規化→スプライトmetadata生成を完走する', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('外部通信は禁止'));
    try {
      const source = sourceWithBackground();
      expect(analyzeBackground(source).hasBakedCheckerboard).toBe(true);
      const cutout = removeEdgeConnectedBackground(source, { tolerance: 28, feather: 1 });
      expect(cutout.data[3]).toBe(0);
      const normalized = normalizeImage(cutout, {
        outputSize: 128,
        padding: 12,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        flipHorizontal: false,
      });
      const generated = await generateIdleSpriteSheet({
        source: normalized.pixels,
        sourceImage: 'assets/characters/sample-character.png',
        preset: 'mechanical',
        parameters: { outputSize: 128, frameCount: 8 },
        generatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(generated.sheet.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      expect(generated.metadata.contentBounds.width).toBeGreaterThan(0);
      expect(generated.metadata.motionParameters.frameCount).toBe(8);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
