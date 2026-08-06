import { describe, expect, it } from 'vitest';

import {
  generateIdleSpriteSheet,
  listMotionPresets,
  loopBoundaryDistance,
  motionTransformForFrame,
} from '../../src/motion/generator';
import { validatePartMasks } from '../../src/motion/part-masks';
import { MOTION_PRESETS, resolveMotionParameters } from '../../src/motion/presets';
import type { PixelBuffer } from '../../src/image/types';

function sourceImage(): PixelBuffer {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 6; y < 29; y += 1) {
    for (let x = 8; x < 24; x += 1) data.set([230, 150, 35, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('待機モーションプリセット', () => {
  it('指定された10プリセットを持つ', () => {
    expect(Object.keys(MOTION_PRESETS)).toHaveLength(10);
    expect(listMotionPresets()).toEqual([
      'standard', 'heavy', 'light', 'hover', 'flying', 'flexible', 'winged', 'mechanical', 'breathing', 'almost-still',
    ]);
  });

  it('8/12フレームとループ時間を整合させる', () => {
    const parameters = resolveMotionParameters('standard', { frameCount: 12, durationMs: 1500 });
    expect(parameters.frameCount).toBe(12);
    expect(parameters.fps).toBe(8);
    expect(parameters.durationMs).toBe(1500);
  });

  it('周期変形が同じ入力から必ず同じ値を返す', () => {
    const parameters = resolveMotionParameters('standard');
    expect(motionTransformForFrame(parameters, 3)).toEqual(motionTransformForFrame(parameters, 3));
    expect(() => motionTransformForFrame(parameters, 99)).toThrow(/範囲外/);
  });
});

describe('スプライトシート生成', () => {
  it('全フレームを同一キャンバスへ格納し、必須metadataを生成する', async () => {
    const result = await generateIdleSpriteSheet({
      source: sourceImage(),
      sourceImage: 'assets/characters/sample-character.png',
      preset: 'standard',
      parameters: { outputSize: 128, frameCount: 8 },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect([result.sheet.width, result.sheet.height]).toEqual([128 * 8, 128]);
    expect(result.frameBounds).toHaveLength(8);
    expect(result.frameBounds.every((bounds) => bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 128 && bounds.y + bounds.height <= 128)).toBe(true);
    expect(result.metadata).toMatchObject({
      schemaVersion: 1,
      frameWidth: 128,
      frameHeight: 128,
      frameCount: 8,
      loop: true,
      sourceImage: 'assets/characters/sample-character.png',
      preset: 'standard',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.metadata.collisionBounds.height).toBeGreaterThan(0);
  });

  it('同じ元画像と設定からバイト単位で同じシートを作る', async () => {
    const request = {
      source: sourceImage(),
      sourceImage: 'assets/characters/sample-character.png',
      preset: 'almost-still' as const,
      parameters: { outputSize: 128 as const },
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const first = await generateIdleSpriteSheet(request);
    const second = await generateIdleSpriteSheet(request);
    expect(first.sheet.data).toEqual(second.sheet.data);
    expect(first.metadata).toEqual(second.metadata);
  });

  it('最終→先頭の変化量が隣接フレームと同程度で跳ねない', async () => {
    const result = await generateIdleSpriteSheet({
      source: sourceImage(),
      sourceImage: 'assets/characters/sample-character.png',
      preset: 'standard',
      parameters: { outputSize: 128 },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const adjacent = result.transforms.slice(1).map((value, index) => {
      const previous = result.transforms[index];
      return Math.hypot(value.translateX - previous.translateX, value.translateY - previous.translateY);
    });
    expect(loopBoundaryDistance(result)).toBeLessThan(6);
    expect(Math.hypot(
      result.transforms[0].translateX - result.transforms.at(-1)!.translateX,
      result.transforms[0].translateY - result.transforms.at(-1)!.translateY,
    )).toBeLessThanOrEqual(Math.max(...adjacent) * 1.05);
  });

  it('開始前のキャンセルを尊重する', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(generateIdleSpriteSheet({
      source: sourceImage(),
      sourceImage: 'assets/characters/sample-character.png',
      preset: 'standard',
      parameters: { outputSize: 128 },
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('将来用部位マスクのID・寸法・重複を検証する', () => {
    expect(validatePartMasks([{ id: 'wing-left', label: '左翼' }], 128, 128)).toEqual([{ id: 'wing-left', label: '左翼' }]);
    expect(() => validatePartMasks([{ id: 'wing', label: '翼' }, { id: 'wing', label: '尾' }], 128, 128)).toThrow(/重複/);
  });
});
