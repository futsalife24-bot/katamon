import { DEFAULT_MOTION } from '../domain/defaults';
import type {
  MotionAction,
  MotionActionPreset,
  MotionParameters,
  MotionPartRole,
  MotionPreset,
} from '../domain/types';

export interface MotionActionPresetDefinition {
  id: MotionActionPreset;
  action: MotionAction;
  label: string;
  description: string;
  motionPreset: MotionPreset;
  focusRole: MotionPartRole;
  parameters: MotionParameters;
}

const define = (
  id: MotionActionPreset,
  action: MotionAction,
  label: string,
  description: string,
  motionPreset: MotionPreset,
  focusRole: MotionPartRole,
  values: Partial<MotionParameters>,
): MotionActionPresetDefinition => ({
  id,
  action,
  label,
  description,
  motionPreset,
  focusRole,
  parameters: { ...DEFAULT_MOTION, ...values },
});

export const ACTION_PRESETS: Readonly<Record<MotionActionPreset, MotionActionPresetDefinition>> = Object.freeze({
  'idle-standard': define('idle-standard', 'idle', '標準待機', '小さな呼吸と上下動です。', 'standard', 'core', {}),
  'idle-heavy': define('idle-heavy', 'idle', '重量待機', '接地点を安定させた重い動きです。', 'heavy', 'base', {
    frameCount: 12, fps: 8, durationMs: 1500, moveY: 2, scaleAmount: 0.006, squashAmount: 0.008, rotationDegrees: 0.15, intensity: 0.72,
  }),
  'idle-hover': define('idle-hover', 'idle', '浮遊待機', 'ゆっくり漂う待機です。', 'hover', 'core', {
    frameCount: 12, fps: 8, durationMs: 1500, moveX: 2, moveY: 7, scaleAmount: 0.006, squashAmount: 0.002, rotationDegrees: 0.8, groundContact: 0.86,
  }),
  'move-steady': define('move-steady', 'move', '通常移動', 'その場で進行感を確認できる周期運動です。', 'standard', 'base', {
    frameCount: 12, fps: 12, durationMs: 1000, moveX: 2, moveY: 7, scaleAmount: 0.004, squashAmount: 0.018, rotationDegrees: 0.8,
  }),
  'move-heavy': define('move-heavy', 'move', '重量移動', '低い姿勢で重く踏み込む動きです。', 'heavy', 'base', {
    frameCount: 12, fps: 8, durationMs: 1500, moveX: 1, moveY: 4, scaleAmount: 0.003, squashAmount: 0.025, rotationDegrees: 0.35, intensity: 0.8,
  }),
  'move-dash': define('move-dash', 'move', '高速移動', '前傾と短い上下動を強めます。', 'light', 'base', {
    frameCount: 8, fps: 12, durationMs: 667, moveX: 5, moveY: 9, scaleAmount: 0.004, squashAmount: 0.032, rotationDegrees: 1.8, intensity: 1.2,
  }),
  'fire-recoil': define('fire-recoil', 'fire', '単発砲撃', '選んだ部位を中心に一度だけ反動を付けます。', 'mechanical', 'right', {
    frameCount: 8, fps: 10, durationMs: 800, moveX: 14, moveY: 2, scaleAmount: 0.004, squashAmount: 0.012, rotationDegrees: 1.4, idlePause: 0,
  }),
  'fire-charge': define('fire-charge', 'fire', '溜め砲撃', 'ゆっくり溜めて大きめの反動を返します。', 'heavy', 'right', {
    frameCount: 12, fps: 8, durationMs: 1500, moveX: 18, moveY: 3, scaleAmount: 0.012, squashAmount: 0.018, rotationDegrees: 2.1, idlePause: 0,
  }),
  'fire-rapid': define('fire-rapid', 'fire', '連続砲撃', '小刻みな反動を短い周期で繰り返します。', 'mechanical', 'right', {
    frameCount: 12, fps: 15, durationMs: 800, moveX: 7, moveY: 1, scaleAmount: 0.002, squashAmount: 0.008, rotationDegrees: 0.8, idlePause: 0,
  }),
  'hit-light': define('hit-light', 'hit', '軽い被弾', '小さくのけぞって姿勢を戻します。', 'standard', 'core', {
    frameCount: 8, fps: 10, durationMs: 800, moveX: 8, moveY: 2, scaleAmount: 0.002, squashAmount: 0.012, rotationDegrees: 2.2, idlePause: 0,
  }),
  'hit-heavy': define('hit-heavy', 'hit', '強い被弾', '大きく押され、少し揺れて戻ります。', 'heavy', 'core', {
    frameCount: 12, fps: 10, durationMs: 1200, moveX: 18, moveY: 5, scaleAmount: 0.004, squashAmount: 0.025, rotationDegrees: 4.5, idlePause: 0,
  }),
  'hit-knockback': define('hit-knockback', 'hit', '吹き飛び', '大きな横移動と回転で衝撃を表します。', 'light', 'core', {
    frameCount: 12, fps: 12, durationMs: 1000, moveX: 28, moveY: 10, scaleAmount: 0.003, squashAmount: 0.018, rotationDegrees: 7, idlePause: 0,
  }),
});

export const ACTION_LABELS: Readonly<Record<MotionAction, { label: string; description: string }>> = Object.freeze({
  idle: { label: '待機', description: '呼吸・浮遊・重量感' },
  move: { label: '移動', description: '通常移動・重量移動・高速移動' },
  fire: { label: '砲撃', description: '単発・溜め・連続の反動' },
  hit: { label: '被弾', description: '軽い衝撃・強い衝撃・吹き飛び' },
  land: { label: '着地', description: '落下・接地・小さな跳ね返り' },
});

export function listActionPresets(action: MotionAction): MotionActionPresetDefinition[] {
  return Object.values(ACTION_PRESETS).filter((preset) => preset.action === action);
}

export function getActionPreset(id: MotionActionPreset): MotionActionPresetDefinition {
  return ACTION_PRESETS[id];
}
