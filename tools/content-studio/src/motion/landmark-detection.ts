import type { FacingDirection, MotionLandmarks } from '../domain/types';
import { findContentBounds } from '../image/processing';
import type { PixelBuffer } from '../image/types';
import { assertPixelBuffer } from '../image/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function luminance(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function sampleLuminance(image: PixelBuffer, x: number, y: number): number {
  const px = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  return luminance(image.data, (py * image.width + px) * 4);
}

interface EyeCandidate {
  x: number;
  y: number;
  score: number;
}

function detectEyes(image: PixelBuffer, bounds: NonNullable<ReturnType<typeof findContentBounds>>, facing: FacingDirection): EyeCandidate[] {
  const step = Math.max(2, Math.round(Math.max(bounds.width, bounds.height) / 120));
  const radius = Math.max(3, Math.round(bounds.width * 0.025));
  const targetX = bounds.x + bounds.width * (facing === 'right' ? 0.62 : 0.38);
  const targetY = bounds.y + bounds.height * 0.31;
  const candidates: EyeCandidate[] = [];
  const xStart = Math.max(0, Math.floor(bounds.x + bounds.width * 0.12));
  const xEnd = Math.min(image.width - 1, Math.ceil(bounds.x + bounds.width * 0.88));
  const yStart = Math.max(0, Math.floor(bounds.y + bounds.height * 0.08));
  const yEnd = Math.min(image.height - 1, Math.ceil(bounds.y + bounds.height * 0.57));

  for (let y = yStart; y <= yEnd; y += step) {
    for (let x = xStart; x <= xEnd; x += step) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset + 3] < 96) continue;
      const center = luminance(image.data, offset);
      const ring = (
        sampleLuminance(image, x - radius, y) +
        sampleLuminance(image, x + radius, y) +
        sampleLuminance(image, x, y - radius) +
        sampleLuminance(image, x, y + radius)
      ) / 4;
      const localContrast = Math.abs(center - ring) / 255;
      const horizontalEdge = Math.abs(sampleLuminance(image, x - step, y) - sampleLuminance(image, x + step, y)) / 255;
      const verticalEdge = Math.abs(sampleLuminance(image, x, y - step) - sampleLuminance(image, x, y + step)) / 255;
      const positionDistance = Math.hypot(
        (x - targetX) / Math.max(1, bounds.width),
        (y - targetY) / Math.max(1, bounds.height),
      );
      const darkOrBrightFeature = Math.abs(center - 128) / 128;
      const score = localContrast * 2.2 + (horizontalEdge + verticalEdge) * 0.7 + darkOrBrightFeature * 0.15 - positionDistance * 0.95;
      if (score > 0.08) candidates.push({ x, y, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const first = candidates[0];
  if (!first) return [];
  const selected = [first];
  const second = candidates.find((candidate) => {
    const dx = Math.abs(candidate.x - first.x);
    const dy = Math.abs(candidate.y - first.y);
    return candidate.score >= first.score * 0.78
      && dx >= bounds.width * 0.055
      && dx <= bounds.width * 0.25
      && dy <= bounds.height * 0.09;
  });
  if (second) selected.push(second);
  return selected;
}

/**
 * Deterministic, on-device landmark estimate. It uses only alpha and local
 * pixel contrast; no image, model, or identifier is sent outside the device.
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
      eyes: [],
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

  const eyeCandidates = detectEyes(image, bounds, facing);
  const eyeSize = Math.max(0.025, Math.min(0.12, bounds.width / image.width * 0.065));
  return {
    status: eyeCandidates.length ? 'ready' : 'needs-review',
    facing,
    ground: {
      x: clamp01((bottomWeight ? bottomX / bottomWeight : bounds.x + bounds.width / 2) / image.width),
      y: clamp01((bottomY + 1) / image.height),
    },
    muzzle: { x: clamp01(muzzle.x / image.width), y: clamp01(muzzle.y / image.height) },
    eyes: eyeCandidates.slice(0, 2).map((candidate, index) => ({
      id: index === 0 ? 'eye-1' : 'eye-2',
      x: clamp01(candidate.x / image.width),
      y: clamp01(candidate.y / image.height),
      size: eyeSize,
    })),
    detectedAt,
  };
}
