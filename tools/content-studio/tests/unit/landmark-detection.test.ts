import { describe, expect, it } from 'vitest';

import type { PixelBuffer } from '../../src/image/types';
import { detectMotionLandmarks } from '../../src/motion/landmark-detection';

function testImage(): PixelBuffer {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, rgba: [number, number, number, number]) => {
    data.set(rgba, (y * width + x) * 4);
  };
  for (let y = 10; y <= 89; y += 1) {
    for (let x = 20; x <= 79; x += 1) paint(x, y, [150, 150, 150, 255]);
  }
  for (let y = 45; y <= 53; y += 1) {
    for (let x = 80; x <= 94; x += 1) paint(x, y, [110, 110, 110, 255]);
  }
  for (let y = 27; y <= 33; y += 1) {
    for (let x = 61; x <= 67; x += 1) paint(x, y, [245, 245, 245, 255]);
  }
  paint(64, 30, [0, 0, 0, 255]);
  return { width, height, data };
}

describe('端末内ランドマーク推定', () => {
  it('同じ画素から接地点と砲口を決定的に返す', () => {
    const detectedAt = '2026-08-06T00:00:00.000Z';
    const first = detectMotionLandmarks(testImage(), 'right', detectedAt);
    const second = detectMotionLandmarks(testImage(), 'right', detectedAt);
    expect(first).toEqual(second);
    expect(first.status).toBe('ready');
    expect(first.ground.y).toBeGreaterThanOrEqual(0.89);
    expect(first.muzzle.x).toBeGreaterThan(0.75);
  });

  it('透明画像でも安全な手動修正用初期値を返す', () => {
    const empty: PixelBuffer = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    expect(detectMotionLandmarks(empty, 'left', '2026-08-06T00:00:00.000Z')).toMatchObject({
      status: 'needs-review',
      facing: 'left',
      ground: { x: 0.5, y: 0.9 },
      muzzle: { x: 0.2, y: 0.5 },
    });
  });
});
