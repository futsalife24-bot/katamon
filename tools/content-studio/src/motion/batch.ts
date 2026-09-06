import { GENERATOR_VERSION } from '../domain/types';
import { sha256Bytes, sha256Text } from '../generation/hash';
import { stableStringify } from '../generation/stable';
import { DEFAULT_MOTION } from '../domain/defaults';
import type {
  FacingDirection,
  MotionAction,
  MotionClipId,
  MotionIntensityLevel,
  MotionLandmarks,
  MotionParameters,
  MotionPreset,
} from '../domain/types';
import { encodePixelBuffer } from '../image/canvas-codec';
import type { PixelBuffer } from '../image/types';
import { ContentMotionProcessor } from './processor';
import type { MotionBatchResult, MotionGenerationRequest, MotionProgress } from './types';

export const MOTION_CLIP_IDS = [
  'move-forward',
  'move-backward',
  'fire',
  'hit',
  'land',
] as const satisfies readonly MotionClipId[];

export const MOTION_CLIP_LABELS: Readonly<Record<MotionClipId, string>> = Object.freeze({
  'move-forward': '前進',
  'move-backward': '後退',
  fire: '単発砲撃',
  hit: '被弾',
  land: '着地',
});

export const MOTION_INTENSITY_LABELS: Readonly<Record<MotionIntensityLevel, string>> = Object.freeze({
  subtle: '控えめ',
  standard: '標準',
  strong: '激しめ',
});

const MOTION_INTENSITY_SCALE: Readonly<Record<MotionIntensityLevel, number>> = Object.freeze({
  subtle: 0.75,
  standard: 1,
  strong: 1.25,
});

interface ClipDefinition {
  action: MotionAction;
  preset: MotionPreset;
  loop: boolean;
  parameters: Partial<MotionParameters>;
}

const BASE_CLIPS: Readonly<Record<MotionClipId, ClipDefinition>> = Object.freeze({
  'move-forward': {
    action: 'move', preset: 'standard', loop: true,
    parameters: { frameCount: 8, fps: 12, durationMs: 667, moveX: 3, moveY: 7, scaleAmount: 0.003, squashAmount: 0.018, rotationDegrees: 0.8, intensity: 1 },
  },
  'move-backward': {
    action: 'move', preset: 'heavy', loop: true,
    parameters: { frameCount: 8, fps: 10, durationMs: 800, moveX: -2.5, moveY: 5, scaleAmount: 0.002, squashAmount: 0.014, rotationDegrees: -0.55, intensity: 0.88 },
  },
  fire: {
    action: 'fire', preset: 'mechanical', loop: false,
    parameters: { frameCount: 8, fps: 12, durationMs: 667, moveX: 14, moveY: 2, scaleAmount: 0.003, squashAmount: 0.014, rotationDegrees: 1.25, idlePause: 0, intensity: 1 },
  },
  hit: {
    action: 'hit', preset: 'standard', loop: false,
    parameters: { frameCount: 12, fps: 12, durationMs: 1000, moveX: -128, moveY: 58, scaleAmount: 0, squashAmount: 0, rotationDegrees: -112, idlePause: 0, intensity: 1 },
  },
  land: {
    action: 'land', preset: 'heavy', loop: false,
    parameters: { frameCount: 8, fps: 10, durationMs: 800, moveX: 0, moveY: 24, scaleAmount: 0, squashAmount: 0.045, rotationDegrees: 0.8, idlePause: 0, intensity: 1 },
  },
});

export function motionClipParameters(
  clipId: MotionClipId,
  facing: FacingDirection,
  outputSize: MotionParameters['outputSize'] = 512,
  intensity: MotionIntensityLevel = 'standard',
): MotionParameters {
  const direction = facing === 'right' ? 1 : -1;
  const definition = BASE_CLIPS[clipId];
  const amplitude = MOTION_INTENSITY_SCALE[intensity];
  const parameters = {
    ...definition.parameters,
    moveX: (definition.parameters.moveX ?? 0) * amplitude,
    moveY: (definition.parameters.moveY ?? 0) * amplitude,
    scaleAmount: (definition.parameters.scaleAmount ?? 0) * amplitude,
    squashAmount: (definition.parameters.squashAmount ?? 0) * amplitude,
    rotationDegrees: clipId === 'hit'
      ? (intensity === 'subtle' ? -96 : intensity === 'strong' ? -124 : -112)
      : (definition.parameters.rotationDegrees ?? 0) * amplitude,
  };
  const hitOutputScale = outputSize / 512;
  const directional = clipId === 'fire'
    ? { moveX: Math.abs(parameters.moveX) * direction, rotationDegrees: Math.abs(parameters.rotationDegrees) * direction }
    : clipId === 'hit'
      ? { moveX: -Math.abs(parameters.moveX) * hitOutputScale * direction, rotationDegrees: -Math.abs(parameters.rotationDegrees) * direction }
      : clipId === 'move-forward'
        ? { moveX: Math.abs(parameters.moveX) * direction, rotationDegrees: Math.abs(parameters.rotationDegrees) * direction }
        : clipId === 'move-backward'
          ? { moveX: -Math.abs(parameters.moveX) * direction, rotationDegrees: -Math.abs(parameters.rotationDegrees) * direction }
          : {};
  return {
    ...DEFAULT_MOTION,
    ...parameters,
    ...directional,
    outputSize,
    canvasPadding: Math.max(DEFAULT_MOTION.canvasPadding, 32),
    flipHorizontal: false,
    lightweightPreview: outputSize < 512,
  };
}

export interface MotionBatchGenerationRequest {
  reuse?: Partial<MotionBatchResult>;
  source: PixelBuffer;
  /** Optional alternate artwork used for the hit clip only. */
  hitSource?: PixelBuffer;
  sourceImage: string;
  landmarks: MotionLandmarks;
  outputSize?: MotionParameters['outputSize'];
  intensity?: Partial<Record<MotionClipId, MotionIntensityLevel>>;
  sourcePlacement?: MotionGenerationRequest['sourcePlacement'];
  generatedAt?: string;
}

export interface MotionBatchProgress {
  clipId: MotionClipId;
  clipIndex: number;
  clipCount: number;
  progress: number;
  message: string;
}

export interface MotionBatchControl {
  signal?: AbortSignal;
  onProgress?: (progress: MotionBatchProgress) => void;
}

/** Hash actual pixels and the exact per-clip generator inputs. Time is deliberately excluded. */
export async function motionInputKeys(request: MotionBatchGenerationRequest): Promise<Record<MotionClipId,string>> {
  const hash = async (pixels: PixelBuffer) => ({ width: pixels.width, height: pixels.height,
    sha256: await sha256Bytes(new Uint8Array(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength)) });
  const source = await hash(request.source), hit = request.hitSource ? await hash(request.hitSource) : source;
  return Object.fromEntries(await Promise.all(MOTION_CLIP_IDS.map(async id => [id, await sha256Text(stableStringify({
    generatorVersion: GENERATOR_VERSION, source: id === 'hit' ? hit : source, sourceImage: request.sourceImage,
    facing: request.landmarks.facing, ground: request.landmarks.ground, muzzle: request.landmarks.muzzle,
    placement: request.sourcePlacement, definition: BASE_CLIPS[id],
    parameters: motionClipParameters(id,request.landmarks.facing,request.outputSize,request.intensity?.[id] ?? 'standard'),
  }))]))) as Record<MotionClipId,string>;
}

/** Generates the five fixed game clips locally and sequentially to cap peak memory. */
export async function generateMotionBatch(
  request: MotionBatchGenerationRequest,
  control: MotionBatchControl = {},
): Promise<MotionBatchResult> {
  const processor = new ContentMotionProcessor();
  const generatedAt = request.generatedAt ?? new Date().toISOString();
  const result = {} as MotionBatchResult;
  const inputKeys = await motionInputKeys(request);
  for (let index = 0; index < MOTION_CLIP_IDS.length; index += 1) {
    if (control.signal?.aborted) throw new DOMException('モーション生成を中止しました。', 'AbortError');
    const clipId = MOTION_CLIP_IDS[index];
    if (request.reuse?.[clipId]?.inputKey === inputKeys[clipId]) { result[clipId] = request.reuse[clipId]!; continue; }
    const definition = BASE_CLIPS[clipId];
    const motion = await processor.generate({
      source: clipId === 'hit' && request.hitSource ? request.hitSource : request.source,
      sourceImage: request.sourceImage,
      sourceFacing: request.landmarks.facing,
      preset: definition.preset,
      parameters: motionClipParameters(clipId, request.landmarks.facing, request.outputSize, request.intensity?.[clipId] ?? 'standard'),
      sourcePlacement: request.sourcePlacement,
      action: definition.action,
      actionPreset: definition.action === 'move' ? 'move-steady' : definition.action === 'fire' ? 'fire-recoil' : definition.action === 'hit' ? 'hit-light' : undefined,
      groundPoint: request.landmarks.ground,
      muzzlePoint: request.landmarks.muzzle,
      clipId,
      generatedAt,
    }, {
      signal: control.signal,
      onProgress: (frame: MotionProgress) => control.onProgress?.({
        clipId,
        clipIndex: index,
        clipCount: MOTION_CLIP_IDS.length,
        progress: (index + frame.progress) / MOTION_CLIP_IDS.length,
        message: `${MOTION_CLIP_LABELS[clipId]} ${frame.frame}/${frame.totalFrames}枚`,
      }),
    });
    const spriteSheetPng = await encodePixelBuffer(motion.sheet, 'image/png');
    result[clipId] = { ...motion, spriteSheetPng, inputKey: inputKeys[clipId] };
  }
  return result;
}
