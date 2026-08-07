import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDraft, DEFAULT_MOTION } from '../../src/domain/defaults';
import type { EncodedIdleSpriteResult } from '../../src/motion';
import {
  createMotionPackage,
  detectMotionParts,
  generateIdleSpriteSheet,
  getActionPreset,
  listActionPresets,
  motionTransformForFrame,
  motionClipParameters,
} from '../../src/motion';

function silhouette(width = 120, height = 100) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y < height - 6; y += 1) {
    const inset = y < 28 ? 35 : y > 78 ? 18 : 10;
    for (let x = inset; x < width - inset; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 220;
      data[offset + 1] = 150;
      data[offset + 2] = 30;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('モーション専用フロー', () => {
  it('標準出力は512pxで、軽量化を明示的に選ばない限り解像度を落とさない', () => {
    expect(DEFAULT_MOTION.outputSize).toBe(512);
    expect(createDraft().motion.outputSize).toBe(512);
  });

  it('端末内の透明輪郭から5つの空間候補を決定的に検出する', () => {
    const first = detectMotionParts(silhouette(), '2026-08-06T00:00:00.000Z');
    const second = detectMotionParts(silhouette(), '2026-08-06T00:00:00.000Z');
    expect(first).toEqual(second);
    expect(first.parts.map(({ role }) => role)).toEqual(['upper', 'core', 'left', 'right', 'base']);
    expect(first.focusPartId).toBe('part-right');
    expect(first.anchorPartId).toBe('part-base');
    for (const part of first.parts) {
      expect(part.bounds.x).toBeGreaterThanOrEqual(0);
      expect(part.bounds.y).toBeGreaterThanOrEqual(0);
      expect(part.bounds.x + part.bounds.width).toBeLessThanOrEqual(1);
      expect(part.bounds.y + part.bounds.height).toBeLessThanOrEqual(1);
    }
  });

  it('移動・砲撃・被弾は別の決定的変形を使い、単発動作は先頭と末尾で静止位置へ戻る', () => {
    const parameters = { ...DEFAULT_MOTION, outputSize: 128 as const, moveX: 14, moveY: 6, rotationDegrees: 3 };
    const move = motionTransformForFrame(parameters, 2, 'move', 'move-steady');
    const fire = motionTransformForFrame(parameters, 2, 'fire', 'fire-recoil');
    const hit = motionTransformForFrame(parameters, 2, 'hit', 'hit-light');
    expect(move).not.toEqual(fire);
    expect(hit).not.toEqual(fire);
    expect(motionTransformForFrame(parameters, 0, 'fire', 'fire-recoil').translateX).toBeCloseTo(0);
    expect(motionTransformForFrame(parameters, 7, 'fire', 'fire-recoil').translateX).toBeCloseTo(0);
    expect(motionTransformForFrame(parameters, 0, 'hit', 'hit-heavy').translateX).toBeCloseTo(0);
    expect(motionTransformForFrame(parameters, 7, 'hit', 'hit-heavy').translateX).toBeCloseTo(0);
  });

  it('右向きの被弾は浮上しながら反時計回りに90度を超え、最終フレームで戻る', () => {
    const parameters = motionClipParameters('hit', 'right', 128);
    const frames = Array.from({ length: parameters.frameCount }, (_, index) => motionTransformForFrame(parameters, index, 'hit', 'hit-light'));
    expect(Math.min(...frames.map(({ rotationRadians }) => rotationRadians))).toBeLessThan(-Math.PI / 2);
    expect(Math.min(...frames.map(({ translateY }) => translateY))).toBeLessThan(-40);
    expect(parameters.frameCount).toBe(12);
    expect(parameters.moveX).toBe(-42);
    expect(frames[6].rotationRadians).toBeLessThan(-Math.PI / 2);
    expect(frames[7].rotationRadians).toBeLessThan(-Math.PI / 2);
    expect(frames[6].translateY).toBeLessThan(frames[5].translateY);
    expect(frames[7].translateY).toBeGreaterThan(frames[6].translateY);
    expect(Math.abs(frames[6].translateY)).toBeLessThan(4);
    expect(frames[8].translateX).toBe(-42);
    expect(frames[9].translateX).toBeLessThan(-35);
    expect(Math.abs(frames[10].rotationRadians)).toBeLessThan(Math.abs(frames[9].rotationRadians));
    expect(frames[0].rotationRadians).toBeCloseTo(0);
    expect(frames.at(-1)?.rotationRadians).toBeCloseTo(0);
    expect(frames.at(-1)?.translateY).toBeCloseTo(0);
  });

  it('各動作に3つの選択式プリセットがあり、自由コードを必要としない', () => {
    for (const action of ['idle', 'move', 'fire', 'hit'] as const) expect(listActionPresets(action)).toHaveLength(3);
    expect(getActionPreset('fire-recoil').action).toBe('fire');
  });

  it('長方形の元画像を正方形へ引き伸ばさず、縦横比を保って1回で正規化する', async () => {
    const source = silhouette(96, 48);
    const result = await generateIdleSpriteSheet({
      source,
      sourceImage: 'motion-source.png',
      preset: 'almost-still',
      action: 'idle',
      parameters: { ...DEFAULT_MOTION, outputSize: 128, frameCount: 8, moveY: 0, scaleAmount: 0, squashAmount: 0, rotationDegrees: 0 },
      generatedAt: '2026-08-06T00:00:00.000Z',
    });
    const bounds = result.frameBounds[0];
    expect(bounds.width / bounds.height).toBeGreaterThan(1.8);
  });

  it('ZIPへPNG、スプライト情報、部位情報をまとめる', async () => {
    const draft = createDraft('00000000-0000-4000-8000-000000000001');
    draft.motionAction = 'fire';
    draft.actionPreset = 'fire-recoil';
    const metadata = {
      schemaVersion: 1 as const,
      frameWidth: 512,
      frameHeight: 512,
      frameCount: 8,
      fps: 10,
      loop: true as const,
      anchorX: 0.5,
      anchorY: 0.92,
      contentBounds: { x: 20, y: 20, width: 470, height: 470 },
      collisionBounds: { x: 60, y: 280, width: 390, height: 210 },
      sourceImage: 'motion-source.png',
      preset: 'mechanical' as const,
      motionAction: 'fire' as const,
      actionPreset: 'fire-recoil' as const,
      motionParameters: { ...DEFAULT_MOTION, fps: 10 },
      partMasks: [],
      generatedAt: '2026-08-06T00:00:00.000Z',
      generatorVersion: '0.2.0',
    };
    const sprite = {
      sheet: { width: 4096, height: 512, data: new Uint8ClampedArray(0) },
      metadata,
      transforms: [],
      frameBounds: [],
      usedWorker: true,
      spriteSheetPng: { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), mimeType: 'image/png' as const, width: 4096, height: 512, byteLength: 4 },
    } satisfies EncodedIdleSpriteResult;
    const archive = unzipSync(new Uint8Array(await (await createMotionPackage(draft, sprite)).arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual(['motion/motion-profile.json', 'motion/sprite-metadata.json', 'motion/sprite-sheet.png']);
    expect(JSON.parse(strFromU8(archive['motion/motion-profile.json']))).toMatchObject({ action: 'fire', actionPreset: 'fire-recoil', quality: 'high' });
  });
});
