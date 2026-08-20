import type { DetectedMotionPart, MotionPartRole, PartDetectionState } from '../domain/types';
import type { PixelBuffer } from '../image/types';
import { assertPixelBuffer } from '../image/types';

interface Seed {
  role: MotionPartRole;
  label: string;
  x: number;
  y: number;
  weightX: number;
  weightY: number;
}

const SEEDS: readonly Seed[] = [
  { role: 'upper', label: '上部', x: 0.5, y: 0.12, weightX: 1.15, weightY: 0.82 },
  { role: 'core', label: '中心部', x: 0.5, y: 0.48, weightX: 1.12, weightY: 1.05 },
  { role: 'left', label: '左側', x: 0.14, y: 0.5, weightX: 0.78, weightY: 1.22 },
  { role: 'right', label: '右側', x: 0.86, y: 0.5, weightX: 0.78, weightY: 1.22 },
  { role: 'base', label: '接地部', x: 0.5, y: 0.9, weightX: 1.08, weightY: 0.78 },
];

interface RegionStats {
  count: number;
  alpha: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyStats(): RegionStats {
  return { count: 0, alpha: 0, minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
}

function alphaBounds(source: PixelBuffer): { left: number; top: number; right: number; bottom: number; count: number } | null {
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  let count = 0;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.data[(y * source.width + x) * 4 + 3] < 16) continue;
      count += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return count === 0 ? null : { left, top, right, bottom, count };
}

/**
 * Deterministic, on-device silhouette partitioning. It intentionally reports
 * spatial candidates instead of pretending to understand anatomy.
 */
export function detectMotionParts(source: PixelBuffer, analyzedAt = new Date().toISOString()): PartDetectionState {
  assertPixelBuffer(source);
  const content = alphaBounds(source);
  if (!content) return { status: 'needs-review', parts: [], focusPartId: null, anchorPartId: null, analyzedAt };

  const width = Math.max(1, content.right - content.left + 1);
  const height = Math.max(1, content.bottom - content.top + 1);
  const stats = SEEDS.map(() => emptyStats());
  let totalAlpha = 0;

  for (let y = content.top; y <= content.bottom; y += 1) {
    for (let x = content.left; x <= content.right; x += 1) {
      const alpha = source.data[(y * source.width + x) * 4 + 3];
      if (alpha < 16) continue;
      const nx = (x - content.left) / Math.max(1, width - 1);
      const ny = (y - content.top) / Math.max(1, height - 1);
      let winner = 0;
      let best = Infinity;
      SEEDS.forEach((seed, index) => {
        const dx = (nx - seed.x) * seed.weightX;
        const dy = (ny - seed.y) * seed.weightY;
        const distance = dx * dx + dy * dy;
        if (distance < best) {
          best = distance;
          winner = index;
        }
      });
      const region = stats[winner];
      region.count += 1;
      region.alpha += alpha;
      region.minX = Math.min(region.minX, x);
      region.minY = Math.min(region.minY, y);
      region.maxX = Math.max(region.maxX, x);
      region.maxY = Math.max(region.maxY, y);
      totalAlpha += alpha;
    }
  }

  const minimumPixels = Math.max(12, Math.floor(content.count * 0.0025));
  const parts: DetectedMotionPart[] = stats.flatMap((region, index) => {
    if (region.count < minimumPixels) return [];
    const seed = SEEDS[index];
    const expand = 2;
    const left = Math.max(0, region.minX - expand);
    const top = Math.max(0, region.minY - expand);
    const right = Math.min(source.width - 1, region.maxX + expand);
    const bottom = Math.min(source.height - 1, region.maxY + expand);
    const pixelRatio = region.alpha / Math.max(1, totalAlpha);
    const fill = region.count / Math.max(1, (right - left + 1) * (bottom - top + 1));
    return [{
      id: `part-${seed.role}`,
      label: seed.label,
      role: seed.role,
      bounds: {
        x: left / source.width,
        y: top / source.height,
        width: (right - left + 1) / source.width,
        height: (bottom - top + 1) / source.height,
      },
      confidence: Math.max(0.35, Math.min(0.96, 0.52 + fill * 0.32 + Math.min(0.12, pixelRatio))),
      pixelRatio,
      enabled: true,
    }];
  });

  const focus = parts.find(({ role }) => role === 'right') ?? parts.find(({ role }) => role === 'core') ?? parts[0];
  const anchor = parts.find(({ role }) => role === 'base') ?? parts.find(({ role }) => role === 'core') ?? parts[0];
  return {
    status: parts.length >= 3 ? 'ready' : 'needs-review',
    parts,
    focusPartId: focus?.id ?? null,
    anchorPartId: anchor?.id ?? null,
    analyzedAt,
  };
}
