import type { ContentBounds, EyeMarker, MotionAction, MotionActionPreset, MotionParameters, MotionPreset, NormalizedPoint } from '../domain/types';
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
    const impact = Math.sin(Math.PI * progress);
    const wobble = Math.sin(Math.PI * 3 * progress) * (1 - progress);
    const squash = parameters.squashAmount * impact * intensity;
    return {
      translateX: parameters.moveX * impact * intensity,
      translateY: -parameters.moveY * impact * intensity,
      scaleX: Math.max(0.5, 1 + squash),
      scaleY: Math.max(0.5, 1 - squash + parameters.scaleAmount * impact),
      rotationRadians: parameters.rotationDegrees * Math.PI / 180 * (impact * 0.72 + wobble * 0.28) * intensity,
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

function prepareMotionSource(source: PixelBuffer, parameters: MotionParameters, placement?: MotionGenerationRequest['sourcePlacement']): PixelBuffer {
  const size = parameters.outputSize;
  const diagonal = Math.sqrt(2) * size;
  const rotationMargin = diagonal * Math.abs(Math.sin(parameters.rotationDegrees * Math.PI / 180)) * 0.5;
  const scaleMargin = size * (parameters.scaleAmount + parameters.squashAmount) * parameters.intensity * 0.55;
  const movementMargin = Math.max(Math.abs(parameters.moveX), Math.abs(parameters.moveY)) * parameters.intensity;
  const safePadding = Math.min(
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

function transformPoint(point: NormalizedPoint, transform: MotionFrameTransform, pivot: NormalizedPoint, size: number): { x: number; y: number } {
  let localX = (point.x - pivot.x) * size;
  const localY = (point.y - pivot.y) * size;
  if (transform.flipHorizontal) localX = -localX;
  const scaledX = localX * transform.scaleX;
  const scaledY = localY * transform.scaleY;
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);
  return {
    x: pivot.x * size + scaledX * cos - scaledY * sin + transform.translateX,
    y: pivot.y * size + scaledX * sin + scaledY * cos + transform.translateY,
  };
}

function paintDisc(frame: PixelBuffer, cx: number, cy: number, radius: number, color: readonly [number, number, number, number]): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(frame.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(frame.height - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radiusSquared) continue;
      const offset = (y * frame.width + x) * 4;
      frame.data[offset] = color[0];
      frame.data[offset + 1] = color[1];
      frame.data[offset + 2] = color[2];
      frame.data[offset + 3] = color[3];
    }
  }
}

function paintLine(frame: PixelBuffer, fromX: number, fromY: number, toX: number, toY: number, thickness: number, color: readonly [number, number, number, number]): void {
  const distance = Math.max(1, Math.hypot(toX - fromX, toY - fromY));
  const steps = Math.ceil(distance * 1.4);
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    paintDisc(frame, fromX + (toX - fromX) * ratio, fromY + (toY - fromY) * ratio, thickness / 2, color);
  }
}

function paintHitEyes(frame: PixelBuffer, markers: EyeMarker[], transform: MotionFrameTransform, pivot: NormalizedPoint, visibility: number): void {
  if (visibility < 0.3) return;
  for (const marker of markers) {
    const center = transformPoint(marker, transform, pivot, frame.width);
    const half = Math.max(4, marker.size * frame.width * 0.5);
    const sampleX = Math.max(0, Math.min(frame.width - 1, Math.round(center.x)));
    const sampleY = Math.max(0, Math.min(frame.height - 1, Math.round(center.y)));
    const offset = (sampleY * frame.width + sampleX) * 4;
    const localLight = frame.data[offset] * 0.2126 + frame.data[offset + 1] * 0.7152 + frame.data[offset + 2] * 0.0722;
    const foreground = localLight > 132 ? [22, 26, 31, 255] as const : [255, 255, 255, 255] as const;
    const outline = localLight > 132 ? [255, 255, 255, 255] as const : [22, 26, 31, 255] as const;
    const outer = Math.max(4, half * 0.3);
    const inner = Math.max(2, outer * 0.55);
    paintLine(frame, center.x - half, center.y - half, center.x + half, center.y + half, outer, outline);
    paintLine(frame, center.x + half, center.y - half, center.x - half, center.y + half, outer, outline);
    paintLine(frame, center.x - half, center.y - half, center.x + half, center.y + half, inner, foreground);
    paintLine(frame, center.x + half, center.y - half, center.x - half, center.y + half, inner, foreground);
  }
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
  const prepared = prepareMotionSource(request.source, parameters, request.sourcePlacement);
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

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    throwIfAborted(control.signal);
    const transform = motionTransformForFrame(parameters, frameIndex, action, request.actionPreset);
    const frame = renderMotionFrame(prepared, transform, pivot.x, pivot.y, control.signal);
    if (action === 'hit' && request.eyeMarkers?.length) {
      const progress = parameters.frameCount <= 1 ? 0 : frameIndex / (parameters.frameCount - 1);
      paintHitEyes(frame, request.eyeMarkers, transform, pivot, Math.sin(Math.PI * progress));
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
