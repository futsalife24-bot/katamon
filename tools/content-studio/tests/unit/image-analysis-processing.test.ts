import { describe, expect, it } from 'vitest';

import { analyzeBackground } from '../../src/image/analysis';
import {
  applyBrushStroke,
  findContentBounds,
  normalizeImage,
  removeEdgeConnectedBackground,
  trimTransparent,
} from '../../src/image/processing';
import type { PixelBuffer } from '../../src/image/types';

function image(width: number, height: number, color: [number, number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) data.set(color, pixel * 4);
  return { width, height, data };
}

function setPixel(target: PixelBuffer, x: number, y: number, color: [number, number, number, number]): void {
  target.data.set(color, (y * target.width + x) * 4);
}

function alphaAt(target: PixelBuffer, x: number, y: number): number {
  return target.data[(y * target.width + x) * 4 + 3];
}

describe('背景・透過検出', () => {
  it('透明、単色、黒背景を区別する', () => {
    const transparent = image(16, 16, [20, 40, 60, 255]);
    setPixel(transparent, 0, 0, [0, 0, 0, 0]);
    expect(analyzeBackground(transparent).hasAlpha).toBe(true);
    expect(analyzeBackground(image(16, 16, [230, 230, 230, 255])).isLikelySolidBackground).toBe(true);
    expect(analyzeBackground(image(16, 16, [2, 3, 2, 255])).hasBakedBlackBackground).toBe(true);
  });

  it('明るい2色の周期的な市松焼き付きを警告する', () => {
    const checker = image(96, 96, [246, 246, 246, 255]);
    for (let y = 0; y < checker.height; y += 1) {
      for (let x = 0; x < checker.width; x += 1) {
        const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 246 : 228;
        setPixel(checker, x, y, [value, value, value, 255]);
      }
    }
    const result = analyzeBackground(checker);
    expect(result.hasAlpha).toBe(false);
    expect(result.hasBakedCheckerboard).toBe(true);
    expect(result.warnings.join(' ')).toContain('市松模様');

    const tightlySampled = image(96, 96, [246, 246, 246, 255]);
    for (let y = 0; y < tightlySampled.height; y += 1) {
      for (let x = 0; x < tightlySampled.width; x += 1) {
        const value = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 252 : 246;
        setPixel(tightlySampled, x, y, [value, value, value, 255]);
      }
    }
    expect(analyzeBackground(tightlySampled).hasBakedCheckerboard).toBe(true);
  });
});

describe('決定的な画像編集', () => {
  it('外周と連結した背景だけをflood-fillで除去する', () => {
    const source = image(12, 12, [250, 250, 250, 255]);
    for (let y = 3; y <= 8; y += 1) {
      for (let x = 3; x <= 8; x += 1) setPixel(source, x, y, [220, 120, 30, 255]);
    }
    setPixel(source, 5, 5, [250, 250, 250, 255]);
    const removed = removeEdgeConnectedBackground(source, { tolerance: 24, feather: 0 });
    expect(alphaAt(removed, 0, 0)).toBe(0);
    expect(alphaAt(removed, 3, 3)).toBe(255);
    expect(alphaAt(removed, 5, 5)).toBe(255);
  });

  it('消しゴムと復元ブラシを往復できる', () => {
    const original = image(24, 24, [40, 140, 220, 255]);
    const erased = applyBrushStroke(original, original, { mode: 'erase', size: 10, points: [{ x: 12, y: 12 }] });
    expect(alphaAt(erased, 12, 12)).toBe(0);
    const restored = applyBrushStroke(erased, original, { mode: 'restore', size: 10, points: [{ x: 12, y: 12 }] });
    expect(alphaAt(restored, 12, 12)).toBe(255);
    expect(restored.data[(12 * 24 + 12) * 4]).toBe(40);
  });

  it('余白をトリミングし、正方形へ底面中央配置する', () => {
    const source = image(20, 16, [0, 0, 0, 0]);
    for (let y = 4; y < 14; y += 1) for (let x = 7; x < 13; x += 1) setPixel(source, x, y, [200, 90, 20, 255]);
    const trimmed = trimTransparent(source);
    expect([trimmed.width, trimmed.height]).toEqual([6, 10]);
    const normalized = normalizeImage(source, {
      outputSize: 128,
      padding: 12,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      flipHorizontal: false,
    });
    expect([normalized.pixels.width, normalized.pixels.height]).toEqual([128, 128]);
    expect(normalized.contentBounds.x + normalized.contentBounds.width / 2).toBeCloseTo(64, 0);
    expect(normalized.contentBounds.y + normalized.contentBounds.height).toBeCloseTo(116, 0);
    expect(normalized.contentBounds.x).toBeGreaterThanOrEqual(0);
    expect(normalized.contentBounds.y).toBeGreaterThanOrEqual(0);
    expect(findContentBounds(normalized.pixels)).not.toBeNull();
  });

  it('過大な移動・拡大でも見切れを防ぐ', () => {
    const source = image(20, 20, [180, 80, 30, 255]);
    const normalized = normalizeImage(source, {
      outputSize: 128,
      padding: 10,
      offsetX: 500,
      offsetY: -500,
      scale: 4,
      flipHorizontal: true,
    });
    const bounds = normalized.contentBounds;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(128);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(128);
    expect(normalized.warnings.length).toBeGreaterThan(0);
  });
});
