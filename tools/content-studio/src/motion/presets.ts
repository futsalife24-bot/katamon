import type { MotionParameters, MotionPreset } from '../domain/types';
import { DEFAULT_MOTION } from '../domain/defaults';

export interface MotionPresetDefinition {
  id: MotionPreset;
  label: string;
  description: string;
  parameters: MotionParameters;
}

const preset = (
  id: MotionPreset,
  label: string,
  description: string,
  values: Partial<MotionParameters>,
): MotionPresetDefinition => ({
  id,
  label,
  description,
  parameters: { ...DEFAULT_MOTION, ...values },
});

export const MOTION_PRESETS: Readonly<Record<MotionPreset, MotionPresetDefinition>> = Object.freeze({
  standard: preset('standard', '標準', '小さな上下動と呼吸を組み合わせます。', {}),
  heavy: preset('heavy', '重量級', '接地感を保った遅く小さな動きです。', {
    fps: 8,
    durationMs: 1500,
    frameCount: 12,
    moveY: 2,
    scaleAmount: 0.006,
    squashAmount: 0.008,
    rotationDegrees: 0.15,
    intensity: 0.72,
  }),
  light: preset('light', '軽量', '軽快な上下動を少し強めにします。', {
    fps: 10,
    durationMs: 1200,
    frameCount: 12,
    moveX: 1,
    moveY: 6,
    scaleAmount: 0.014,
    squashAmount: 0.018,
    rotationDegrees: 0.8,
    intensity: 1.15,
  }),
  hover: preset('hover', '浮遊', '接地点からわずかに浮かせて漂わせます。', {
    moveX: 2,
    moveY: 7,
    scaleAmount: 0.006,
    squashAmount: 0.002,
    rotationDegrees: 0.8,
    groundContact: 0.86,
  }),
  flying: preset('flying', '飛行', '長めの周期で空中をゆるく移動します。', {
    frameCount: 12,
    fps: 8,
    durationMs: 1500,
    moveX: 3,
    moveY: 9,
    scaleAmount: 0.005,
    squashAmount: 0.002,
    rotationDegrees: 1.2,
    groundContact: 0.78,
  }),
  flexible: preset('flexible', '柔体', '輪郭を壊さない範囲で潰れと伸びを加えます。', {
    moveY: 3,
    scaleAmount: 0.012,
    squashAmount: 0.035,
    rotationDegrees: 0.25,
  }),
  winged: preset('winged', '翼あり', '全体の形を維持したまま飛行に近い周期で揺らします。', {
    frameCount: 12,
    fps: 10,
    durationMs: 1200,
    moveX: 1.5,
    moveY: 7,
    scaleAmount: 0.008,
    squashAmount: 0.006,
    rotationDegrees: 0.65,
    groundContact: 0.82,
  }),
  mechanical: preset('mechanical', '機械', '規則的で小さなピストン風の上下動です。', {
    moveY: 3,
    scaleAmount: 0.003,
    squashAmount: 0.004,
    rotationDegrees: 0,
    idlePause: 0.05,
  }),
  breathing: preset('breathing', '呼吸のみ', '位置を動かさず、ごく弱い拡大縮小だけを行います。', {
    moveX: 0,
    moveY: 0,
    scaleAmount: 0.009,
    squashAmount: 0.003,
    rotationDegrees: 0,
  }),
  'almost-still': preset('almost-still', 'ほぼ静止', '低性能端末向けの最小限の動きです。', {
    moveX: 0,
    moveY: 1,
    scaleAmount: 0.002,
    squashAmount: 0,
    rotationDegrees: 0,
    intensity: 0.45,
    lightweightPreview: true,
  }),
});

export function getMotionPreset(id: MotionPreset): MotionPresetDefinition {
  return MOTION_PRESETS[id];
}

export function resolveMotionParameters(id: MotionPreset, overrides: Partial<MotionParameters> = {}): MotionParameters {
  const base = MOTION_PRESETS[id].parameters;
  const frameCount = overrides.frameCount === 12 ? 12 : overrides.frameCount === 8 ? 8 : base.frameCount;
  let fps = Number.isFinite(overrides.fps) ? Math.min(30, Math.max(1, overrides.fps as number)) : base.fps;
  if (overrides.durationMs !== undefined && overrides.fps === undefined) {
    const duration = Math.min(10_000, Math.max(250, overrides.durationMs));
    fps = Math.min(30, Math.max(1, frameCount * 1000 / duration));
  }
  const durationMs = Math.round(frameCount * 1000 / fps);
  const outputSize = [128, 256, 384, 512].includes(overrides.outputSize as number)
    ? overrides.outputSize as MotionParameters['outputSize']
    : base.outputSize;
  return {
    ...base,
    ...overrides,
    frameCount,
    fps,
    durationMs,
    moveX: Math.min(64, Math.max(-64, overrides.moveX ?? base.moveX)),
    moveY: Math.min(64, Math.max(-64, overrides.moveY ?? base.moveY)),
    scaleAmount: Math.min(0.25, Math.max(0, overrides.scaleAmount ?? base.scaleAmount)),
    squashAmount: Math.min(0.25, Math.max(0, overrides.squashAmount ?? base.squashAmount)),
    rotationDegrees: Math.min(15, Math.max(-15, overrides.rotationDegrees ?? base.rotationDegrees)),
    idlePause: Math.min(0.9, Math.max(0, overrides.idlePause ?? base.idlePause)),
    groundContact: Math.min(1, Math.max(0, overrides.groundContact ?? base.groundContact)),
    intensity: Math.min(2, Math.max(0, overrides.intensity ?? base.intensity)),
    canvasPadding: Math.min(128, Math.max(0, Math.round(overrides.canvasPadding ?? base.canvasPadding))),
    outputSize,
  };
}

export function makeLightweightMotionParameters(parameters: MotionParameters): MotionParameters {
  const outputSize = parameters.outputSize > 256 ? 256 : parameters.outputSize;
  return {
    ...parameters,
    outputSize,
    frameCount: 8,
    fps: Math.min(parameters.fps, 8),
    durationMs: Math.round(8 * 1000 / Math.min(parameters.fps, 8)),
    lightweightPreview: true,
  };
}
