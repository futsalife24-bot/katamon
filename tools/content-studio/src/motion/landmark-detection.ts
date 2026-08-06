import type { FacingDirection, MotionLandmarks } from '../domain/types';
import { findContentBounds } from '../image/processing';
import type { PixelBuffer } from '../image/types';
import { assertPixelBuffer } from '../image/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Deterministic, on-device landmark estimate. It uses the alpha silhouette;
 * no image, model, or identifier is sent outside the device.
 */
export function detectMotionLandmarks(
  image: PixelBuffer,
  facing: FacingDirection,
  detectedAt = new Date().toISOString(),
): MotionLandmarks {
  assertPixelBuffer(image);
  const bounds = findContentBounds(image, 16);
  if (!bounds) {
    return {
      status: 'needs-review',
      facing,
      ground: { x: 0.5, y: 0.9 },
      muzzle: { x: facing === 'right' ? 0.8 : 0.2, y: 0.5 },
      detectedAt,
    };
  }

  const bottomStart = Math.max(bounds.y, Math.floor(bounds.y + bounds.height * 0.9));
  let bottomWeight = 0;
  let bottomX = 0;
  let bottomY = bounds.y + bounds.height - 1;
  for (let y = bottomStart; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha < 48) continue;
      const weight = alpha / 255;
      bottomWeight += weight;
      bottomX += x * weight;
      bottomY = Math.max(bottomY, y);
    }
  }

  const frontPixels: Array<{ x: number; y: number }> = [];
  const frontYMin = Math.floor(bounds.y + bounds.height * 0.08);
  const frontYMax = Math.ceil(bounds.y + bounds.height * 0.82);
  for (let y = frontYMin; y <= frontYMax; y += 2) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 2) {
      if (image.data[(y * image.width + x) * 4 + 3] >= 64) frontPixels.push({ x, y });
    }
  }
  frontPixels.sort((a, b) => facing === 'right' ? b.x - a.x : a.x - b.x);
  const edgeCount = Math.max(1, Math.floor(frontPixels.length * 0.035));
  const edge = frontPixels.slice(0, edgeCount);
  edge.sort((a, b) => a.y - b.y);
  const muzzle = edge[Math.floor(edge.length / 2)] ?? {
    x: facing === 'right' ? bounds.x + bounds.width : bounds.x,
    y: bounds.y + bounds.height * 0.5,
  };

  return {
    status: 'ready',
    facing,
    ground: {
      x: clamp01((bottomWeight ? bottomX / bottomWeight : bounds.x + bounds.width / 2) / image.width),
      y: clamp01((bottomY + 1) / image.height),
    },
    muzzle: { x: clamp01(muzzle.x / image.width), y: clamp01(muzzle.y / image.height) },
    detectedAt,
  };
}
