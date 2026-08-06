import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/image/canvas-codec', () => ({
  encodePixelBuffer: async (pixels: PixelBuffer) => {
    const blob = new Blob([new Uint8Array(pixels.data)], { type: 'image/png' });
    return { blob, mimeType: 'image/png' as const, width: pixels.width, height: pixels.height, byteLength: blob.size };
  },
}));

import { createDraft } from '../../src/domain/defaults';
import type { MotionLandmarks } from '../../src/domain/types';
import type { PixelBuffer } from '../../src/image/types';
import { generateMotionBatch, MOTION_CLIP_IDS, motionClipParameters } from '../../src/motion/batch';
import { createMotionBatchPackage } from '../../src/motion/package';

function sourceImage(): PixelBuffer {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 5; y < 29; y += 1) {
    for (let x = 7; x < 26; x += 1) data.set([220, 145, 30, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const landmarks: MotionLandmarks = {
  status: 'ready',
  facing: 'right',
  ground: { x: 0.5, y: 0.9 },
  muzzle: { x: 0.8, y: 0.48 },
  eyes: [{ id: 'eye-1', x: 0.62, y: 0.3, size: 0.06 }],
  detectedAt: '2026-08-06T00:00:00.000Z',
};

describe('5モーション一括生成', () => {
  it('前後方向を元の向きに対して正しく決め、左右反転しない', () => {
    expect(motionClipParameters('move-forward', 'right', 128).moveX).toBeGreaterThan(0);
    expect(motionClipParameters('move-backward', 'right', 128).moveX).toBeLessThan(0);
    expect(motionClipParameters('move-forward', 'left', 128).moveX).toBeLessThan(0);
    expect(motionClipParameters('move-backward', 'left', 128).moveX).toBeGreaterThan(0);
    expect(MOTION_CLIP_IDS.every((clip) => motionClipParameters(clip, 'right', 128).flipHorizontal === false)).toBe(true);
  });

  it('5種類を同一条件で生成し、個別PNG/JSON入りZIPへまとめる', async () => {
    const progress: number[] = [];
    const motions = await generateMotionBatch({
      source: sourceImage(),
      sourceImage: 'source.png',
      landmarks,
      outputSize: 128,
      generatedAt: '2026-08-06T00:00:00.000Z',
    }, { onProgress: ({ progress: value }) => progress.push(value) });

    expect(Object.keys(motions)).toEqual(MOTION_CLIP_IDS);
    expect(motions['move-forward'].metadata.loop).toBe(true);
    expect(motions['move-backward'].metadata.loop).toBe(true);
    expect(motions.fire.metadata.loop).toBe(false);
    expect(motions.hit.metadata.loop).toBe(false);
    expect(motions.land.metadata.loop).toBe(false);
    expect(MOTION_CLIP_IDS.every((clip) => motions[clip].metadata.clipId === clip)).toBe(true);
    expect(progress.at(-1)).toBe(1);

    const draft = createDraft('motion-batch-test');
    draft.landmarks = structuredClone(landmarks);
    const archive = unzipSync(new Uint8Array(await (await createMotionBatchPackage(draft, motions)).arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual([
      'motion-profile.json',
      ...MOTION_CLIP_IDS.flatMap((clip) => [`motions/${clip}/metadata.json`, `motions/${clip}/sprite.png`]),
    ].sort());
  });
});
