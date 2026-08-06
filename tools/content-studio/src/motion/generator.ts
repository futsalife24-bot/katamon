import type { ContentBounds, MotionParameters, MotionPreset } from '../domain/types';
import { buildSpriteMetadata } from '../generation/sprite-metadata';
import { findContentBounds, normalizeImage, resizePixelBuffer } from '../image/processing';
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

export function motionTransformForFrame(parameters: MotionParameters, frameIndex: number): MotionFrameTransform {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= parameters.frameCount) {
    throw new RangeError('フレーム番号が範囲外です。');
  }
  const phase = TWO_PI * frameIndex / parameters.frameCount;
  const wave = shapedWave(Math.sin(phase), parameters.idlePause);
  const lift = shapedWave((1 - Math.cos(phase)) / 2, parameters.idlePause * 0.5);
  const intensity = parameters.intensity;
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

function prepareMotionSource(source: PixelBuffer, parameters: MotionParameters): PixelBuffer {
  const size = parameters.outputSize;
  const resized = source.width === size && source.height === size ? source : resizePixelBuffer(source, size, size);
  const diagonal = Math.sqrt(2) * size;
  const rotationMargin = diagonal * Math.abs(Math.sin(parameters.rotationDegrees * Math.PI / 180)) * 0.5;
  const scaleMargin = size * (parameters.scaleAmount + parameters.squashAmount) * parameters.intensity * 0.55;
  const movementMargin = Math.max(Math.abs(parameters.moveX), Math.abs(parameters.moveY)) * parameters.intensity;
  const safePadding = Math.min(
    Math.floor(size * 0.4),
    Math.ceil(parameters.canvasPadding + rotationMargin + scaleMargin + movementMargin),
  );
  return normalizeImage(resized, {
    outputSize: size,
    padding: safePadding,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    flipHorizontal: false,
  }).pixels;
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
  const prepared = prepareMotionSource(request.source, parameters);
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

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    throwIfAborted(control.signal);
    const transform = motionTransformForFrame(parameters, frameIndex);
    const frame = renderMotionFrame(prepared, transform, anchorX, anchorY, control.signal);
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
    motionParameters: parameters,
    partMasks,
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
