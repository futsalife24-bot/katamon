import type { ContentBounds, MotionAction, MotionActionPreset, MotionParameters, MotionPreset } from '../domain/types';
import { buildSpriteMetadata } from '../generation/sprite-metadata';
import { findContentBounds, normalizeImage } from '../image/processing';
import type { PixelBuffer } from '../image/types';
import { assertPixelBuffer } from '../image/types';
import { validatePartMasks } from './part-masks';
import { resolveMotionParameters } from './presets';
import type {
  IdleSpriteResult,
  MotionControl,
  MotionFrameTransform,
  MotionGenerationRequest,
} from './types';

const TWO_PI = Math.PI * 2;
const HIT_TAKEOFF_END = 0.3;
const HIT_LAND_START = 0.54;
const HIT_BOUNCE_END = 0.78;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const progress = clampUnit(value);
  return 1 - Math.pow(1 - progress, 3);
}

function easeInOutCubic(value: number): number {
  const progress = clampUnit(value);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function hitBounceLift(parameters: MotionParameters, progress: number): number {
  if (progress < HIT_LAND_START || progress >= HIT_BOUNCE_END) return 0;
  const bounceProgress = (progress - HIT_LAND_START) / (HIT_BOUNCE_END - HIT_LAND_START);
  return Math.sin(Math.PI * bounceProgress) * Math.max(5, parameters.moveY * 0.14) * parameters.intensity;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('モーション生成を中止しました。', 'AbortError');
}

function shapedWave(value: number, pause: number): number {
  const magnitude = Math.abs(value);
  const exponent = 1 + pause * 4;
  return Math.sign(value) * (1 - Math.pow(1 - magnitude, exponent));
}

export function motionTransformForFrame(
  parameters: MotionParameters,
  frameIndex: number,
  action: MotionAction = 'idle',
  actionPreset?: MotionActionPreset,
): MotionFrameTransform {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= parameters.frameCount) {
    throw new RangeError('フレーム番号が範囲外です。');
  }
  const phase = TWO_PI * frameIndex / parameters.frameCount;
  const progress = parameters.frameCount <= 1 ? 0 : frameIndex / (parameters.frameCount - 1);
  const intensity = parameters.intensity;

  if (action === 'move') {
    const stride = Math.sin(phase);
    const stepLift = Math.abs(Math.sin(phase));
    const squash = parameters.squashAmount * stepLift * intensity;
    return {
      translateX: parameters.moveX * stride * intensity * 0.22,
      translateY: -parameters.moveY * stepLift * intensity,
      scaleX: Math.max(0.5, 1 + squash),
      scaleY: Math.max(0.5, 1 - squash + parameters.scaleAmount * stepLift),
      rotationRadians: parameters.rotationDegrees * Math.PI / 180 * stride * intensity,
      flipHorizontal: parameters.flipHorizontal,
    };
  }

  if (action === 'fire') {
    const basicPulse = Math.pow(Math.sin(Math.PI * progress), 3);
    const pulse = actionPreset === 'fire-rapid'
      ? Math.pow(Math.abs(Math.sin(Math.PI * 3 * progress)), 2)
      : actionPreset === 'fire-charge'
        ? Math.pow(Math.sin(Math.PI * progress), 2)
        : basicPulse;
    const squash = parameters.squashAmount * pulse * intensity;
    return {
      translateX: -parameters.moveX * pulse * intensity,
      translateY: -parameters.moveY * pulse * intensity,
      scaleX: Math.max(0.5, 1 - squash + parameters.scaleAmount * pulse),
      scaleY: Math.max(0.5, 1 + squash),
      rotationRadians: -parameters.rotationDegrees * Math.PI / 180 * pulse * intensity,
      flipHorizontal: parameters.flipHorizontal,
    };
  }

  if (action === 'hit') {
    // Take off, keep the overturned pose through landing and one small bounce,
    // then stand back up. Negative rotation is counterclockwise on y-down canvas.
    const takeoff = easeOutCubic(progress / HIT_TAKEOFF_END);
    const recover = easeInOutCubic((progress - HIT_BOUNCE_END) / (1 - HIT_BOUNCE_END));
    const flip = progress <= HIT_TAKEOFF_END ? takeoff : progress < HIT_BOUNCE_END ? 1 : 1 - recover;
    const fall = easeInOutCubic((progress - HIT_TAKEOFF_END) / (HIT_LAND_START - HIT_TAKEOFF_END));
    const vertical = progress <= HIT_TAKEOFF_END
      ? -parameters.moveY * takeoff * intensity
      : progress < HIT_LAND_START
        ? -parameters.moveY * (1 - fall) * intensity
        : -hitBounceLift(parameters, progress);
    return {
      translateX: parameters.moveX * flip * intensity,
      translateY: vertical,
      scaleX: 1,
      scaleY: 1,
      rotationRadians: parameters.rotationDegrees * Math.PI / 180 * flip * intensity,
      flipHorizontal: parameters.flipHorizontal,
    };
  }

  if (action === 'land') {
    const fallEnd = 0.48;
    const fall = Math.min(1, progress / fallEnd);
    const landingPulse = Math.exp(-Math.pow((progress - 0.58) / 0.13, 2));
    const settle = progress > fallEnd
      ? Math.sin((progress - fallEnd) * Math.PI * 4.2) * (1 - progress) * 0.28
      : 0;
    const vertical = progress < fallEnd
      ? -parameters.moveY * (1 - fall) * (1 - fall)
      : -parameters.moveY * settle;
    const squash = parameters.squashAmount * landingPulse * intensity;
    return {
      translateX: parameters.moveX * Math.sin(Math.PI * progress) * intensity * 0.18,
      translateY: vertical * intensity,
      scaleX: Math.max(0.5, 1 + squash),
      scaleY: Math.max(0.5, 1 - squash),
      rotationRadians: parameters.rotationDegrees * Math.PI / 180 * settle * intensity,
      flipHorizontal: parameters.flipHorizontal,
    };
  }

  const wave = shapedWave(Math.sin(phase), parameters.idlePause);
  const lift = shapedWave((1 - Math.cos(phase)) / 2, parameters.idlePause * 0.5);
  const breath = parameters.scaleAmount * wave * intensity;
  const squash = parameters.squashAmount * lift * intensity;
  return {
    translateX: parameters.moveX * wave * intensity,
    translateY: -parameters.moveY * lift * intensity,
    scaleX: Math.max(0.5, 1 + breath - squash),
    scaleY: Math.max(0.5, 1 + breath + squash),
    rotationRadians: parameters.rotationDegrees * Math.PI / 180 * wave * intensity,
    flipHorizontal: parameters.flipHorizontal,
  };
}

function samplePremultiplied(image: PixelBuffer, x: number, y: number, output: Uint8ClampedArray, offset: number): void {
  if (x < -0.5 || y < -0.5 || x > image.width - 0.5 || y > image.height - 0.5) return;
  const cx = Math.max(0, Math.min(image.width - 1, x));
  const cy = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const samples = [
    { offset: (y0 * image.width + x0) * 4, weight: (1 - fx) * (1 - fy) },
    { offset: (y0 * image.width + x1) * 4, weight: fx * (1 - fy) },
    { offset: (y1 * image.width + x0) * 4, weight: (1 - fx) * fy },
    { offset: (y1 * image.width + x1) * 4, weight: fx * fy },
  ];
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const sample of samples) {
    const sampleAlpha = image.data[sample.offset + 3] / 255;
    const weightedAlpha = sample.weight * sampleAlpha;
    alpha += weightedAlpha;
    red += image.data[sample.offset] * weightedAlpha;
    green += image.data[sample.offset + 1] * weightedAlpha;
    blue += image.data[sample.offset + 2] * weightedAlpha;
  }
  if (alpha <= 0) return;
  output[offset] = Math.round(red / alpha);
  output[offset + 1] = Math.round(green / alpha);
  output[offset + 2] = Math.round(blue / alpha);
  output[offset + 3] = Math.round(alpha * 255);
}

export function renderMotionFrame(
  source: PixelBuffer,
  transform: MotionFrameTransform,
  anchorX: number,
  anchorY: number,
  signal?: AbortSignal,
): PixelBuffer {
  assertPixelBuffer(source);
  const output = new Uint8ClampedArray(source.width * source.height * 4);
  const pivotX = source.width * anchorX;
  const pivotY = source.height * anchorY;
  const cos = Math.cos(-transform.rotationRadians);
  const sin = Math.sin(-transform.rotationRadians);
  const inverseScaleX = 1 / transform.scaleX;
  const inverseScaleY = 1 / transform.scaleY;
  for (let y = 0; y < source.height; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    for (let x = 0; x < source.width; x += 1) {
      const translatedX = x + 0.5 - pivotX - transform.translateX;
      const translatedY = y + 0.5 - pivotY - transform.translateY;
      const rotatedX = translatedX * cos - translatedY * sin;
      const rotatedY = translatedX * sin + translatedY * cos;
      let sourceX = rotatedX * inverseScaleX;
      const sourceY = rotatedY * inverseScaleY + pivotY - 0.5;
      if (transform.flipHorizontal) sourceX = -sourceX;
      sourceX += pivotX - 0.5;
      samplePremultiplied(source, sourceX, sourceY, output, (y * source.width + x) * 4);
    }
  }
  return { width: source.width, height: source.height, data: output };
}

function prepareMotionSource(
  source: PixelBuffer,
  parameters: MotionParameters,
  placement?: MotionGenerationRequest['sourcePlacement'],
  action: MotionAction = 'idle',
): PixelBuffer {
  const size = parameters.outputSize;
  const diagonal = Math.sqrt(2) * size;
  const rotationMargin = diagonal * Math.abs(Math.sin(parameters.rotationDegrees * Math.PI / 180)) * 0.5;
  const scaleMargin = size * (parameters.scaleAmount + parameters.squashAmount) * parameters.intensity * 0.55;
  const movementMargin = Math.max(Math.abs(parameters.moveX), Math.abs(parameters.moveY)) * parameters.intensity;
  const safePadding = action === 'hit'
    ? Math.max(parameters.canvasPadding, Math.ceil(size * 0.22))
    : Math.min(
        Math.floor(size * 0.4),
        Math.ceil(parameters.canvasPadding + rotationMargin + scaleMargin + movementMargin),
      );
  const referenceSize = Math.max(1, placement?.referenceSize ?? size);
  const placementScale = size / referenceSize;
  const requestedPadding = Math.round((placement?.padding ?? 0) * placementScale);
  // Normalize once from the highest-resolution edited source. Resizing a
  // rectangular source to a square first both softened and distorted it.
  return normalizeImage(source, {
    outputSize: size,
    padding: Math.max(safePadding, requestedPadding),
    offsetX: (placement?.offsetX ?? 0) * placementScale,
    offsetY: (placement?.offsetY ?? 0) * placementScale,
    scale: placement?.scale ?? 1,
    flipHorizontal: placement?.flipHorizontal ?? false,
  }).pixels;
}

function resolvePivot(request: MotionGenerationRequest, action: MotionAction, fallbackX: number, fallbackY: number): { x: number; y: number } {
  if (action === 'fire' && request.muzzlePoint) return { ...request.muzzlePoint };
  if ((action === 'move' || action === 'idle' || action === 'land') && request.groundPoint) return { ...request.groundPoint };
  if (action === 'hit' && request.groundPoint) {
    return { x: request.groundPoint.x, y: Math.max(0.32, request.groundPoint.y - 0.34) };
  }
  const enabled = (request.partRegions ?? []).filter((part) => part.enabled);
  const requestedId = action === 'move' || action === 'idle' ? request.anchorPartId : request.focusPartId;
  const role = action === 'move' ? 'base' : action === 'fire' ? 'right' : action === 'hit' ? 'core' : 'core';
  const part = enabled.find(({ id }) => id === requestedId) ?? enabled.find((candidate) => candidate.role === role);
  if (!part) return { x: fallbackX, y: fallbackY };
  return {
    x: Math.max(0, Math.min(1, part.bounds.x + part.bounds.width / 2)),
    y: Math.max(0, Math.min(1, action === 'move' ? part.bounds.y + part.bounds.height : part.bounds.y + part.bounds.height / 2)),
  };
}

function unionBounds(bounds: ContentBounds[]): ContentBounds {
  if (bounds.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function copyFrameToSheet(sheet: PixelBuffer, frame: PixelBuffer, frameIndex: number): void {
  for (let y = 0; y < frame.height; y += 1) {
    const sourceStart = y * frame.width * 4;
    const targetStart = (y * sheet.width + frameIndex * frame.width) * 4;
    sheet.data.set(frame.data.subarray(sourceStart, sourceStart + frame.width * 4), targetStart);
  }
}

function yieldTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateIdleSpriteSheet(
  request: MotionGenerationRequest,
  control: MotionControl = {},
  usedWorker = false,
): Promise<IdleSpriteResult> {
  assertPixelBuffer(request.source);
  const parameters = resolveMotionParameters(request.preset, request.parameters);
  const action = request.action ?? 'idle';
  const prepared = prepareMotionSource(request.source, parameters, request.sourcePlacement, action);
  const frameSize = parameters.outputSize;
  const sheet: PixelBuffer = {
    width: frameSize * parameters.frameCount,
    height: frameSize,
    data: new Uint8ClampedArray(frameSize * parameters.frameCount * frameSize * 4),
  };
  const transforms: MotionFrameTransform[] = [];
  const frameBounds: ContentBounds[] = [];
  const anchorX = 0.5;
  const anchorY = parameters.groundContact;
  const pivot = resolvePivot(request, action, anchorX, anchorY);
  const preparedBounds = findContentBounds(prepared);
  const uprightBottom = preparedBounds ? preparedBounds.y + preparedBounds.height : frameSize * anchorY;

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    throwIfAborted(control.signal);
    let transform = motionTransformForFrame(parameters, frameIndex, action, request.actionPreset);
    let frame = renderMotionFrame(prepared, transform, pivot.x, pivot.y, control.signal);
    const progress = parameters.frameCount <= 1 ? 0 : frameIndex / (parameters.frameCount - 1);
    if (action === 'hit' && progress >= HIT_LAND_START) {
      const provisionalBounds = findContentBounds(frame);
      if (provisionalBounds) {
        const currentBottom = provisionalBounds.y + provisionalBounds.height;
        const targetBottom = uprightBottom - hitBounceLift(parameters, progress);
        transform = { ...transform, translateY: transform.translateY + targetBottom - currentBottom };
        frame = renderMotionFrame(prepared, transform, pivot.x, pivot.y, control.signal);
      }
    }
    transforms.push(transform);
    const bounds = findContentBounds(frame) ?? { x: 0, y: 0, width: 0, height: 0 };
    frameBounds.push(bounds);
    copyFrameToSheet(sheet, frame, frameIndex);
    control.onProgress?.({
      frame: frameIndex + 1,
      totalFrames: parameters.frameCount,
      progress: (frameIndex + 1) / parameters.frameCount,
      message: `${frameIndex + 1}/${parameters.frameCount}フレームを生成しました`,
    });
    if (control.yieldToMainThread) await yieldTask();
  }
  const contentBounds = unionBounds(frameBounds);
  const partMasks = validatePartMasks(request.partMasks ?? [], frameSize, frameSize);
  const metadata = buildSpriteMetadata({
    frameWidth: frameSize,
    frameHeight: frameSize,
    frameCount: parameters.frameCount,
    fps: parameters.fps,
    anchorX,
    anchorY,
    contentBounds,
    sourceImage: request.sourceImage,
    preset: request.preset,
    motionAction: action,
    actionPreset: request.actionPreset,
    motionParameters: parameters,
    loop: action === 'idle' || action === 'move',
    clipId: request.clipId,
    partMasks,
    partRegions: request.partRegions,
    generatedAt: request.generatedAt,
  });
  return { sheet, metadata, transforms, frameBounds, usedWorker };
}

export function loopBoundaryDistance(result: IdleSpriteResult): number {
  if (result.transforms.length < 2) return 0;
  const first = result.transforms[0];
  const last = result.transforms[result.transforms.length - 1];
  return Math.hypot(
    first.translateX - last.translateX,
    first.translateY - last.translateY,
    (first.scaleX - last.scaleX) * result.metadata.frameWidth,
    (first.scaleY - last.scaleY) * result.metadata.frameHeight,
  );
}

export function listMotionPresets(): MotionPreset[] {
  return ['standard', 'heavy', 'light', 'hover', 'flying', 'flexible', 'winged', 'mechanical', 'breathing', 'almost-still'];
}
