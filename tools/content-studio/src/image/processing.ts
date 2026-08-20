import type { ImageOperation } from '../domain/types';
import { analyzeBackground, estimateBorderPalette, rgbDistance, type Rgba } from './analysis';
import type {
  BackgroundRemovalOptions,
  BrushStroke,
  NormalizeOptions,
  NormalizedImage,
  PixelBuffer,
} from './types';
import { assertPixelBuffer, clonePixelBuffer } from './types';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('画像処理を中止しました。', 'AbortError');
}

function colorAt(image: PixelBuffer, pixel: number): Rgba {
  const offset = pixel * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

function pixelMatchesPalette(image: PixelBuffer, pixel: number, palette: Rgba[], tolerance: number): boolean {
  const color = colorAt(image, pixel);
  if (color[3] <= 4) return true;
  return palette.some((candidate) => rgbDistance(color, candidate) <= tolerance);
}

/** Removes only background pixels connected to an outer edge. Interior areas are never seeded. */
export function removeEdgeConnectedBackground(image: PixelBuffer, options: BackgroundRemovalOptions): PixelBuffer {
  assertPixelBuffer(image);
  const tolerance = Math.min(128, Math.max(0, options.tolerance));
  const feather = Math.min(8, Math.max(0, Math.round(options.feather)));
  throwIfAborted(options.signal);
  const result = clonePixelBuffer(image);
  const pixelCount = image.width * image.height;
  const removed = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let read = 0;
  let write = 0;
  const analysis = analyzeBackground(image);
  const allPalette = estimateBorderPalette(image, analysis.hasBakedCheckerboard ? 4 : 2);
  const palette = allPalette.length > 0 ? allPalette : [[255, 255, 255, 255] as Rgba];

  const enqueue = (pixel: number) => {
    if (removed[pixel] || !pixelMatchesPalette(image, pixel, palette, tolerance)) return;
    removed[pixel] = 1;
    queue[write] = pixel;
    write += 1;
  };
  for (let x = 0; x < image.width; x += 1) {
    enqueue(x);
    if (image.height > 1) enqueue((image.height - 1) * image.width + x);
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    enqueue(y * image.width);
    if (image.width > 1) enqueue(y * image.width + image.width - 1);
  }

  while (read < write) {
    if ((read & 4095) === 0) {
      throwIfAborted(options.signal);
      options.onProgress?.(Math.min(0.9, read / Math.max(1, pixelCount)));
    }
    const pixel = queue[read];
    read += 1;
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < image.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - image.width);
    if (y + 1 < image.height) enqueue(pixel + image.width);
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (removed[pixel]) result.data[pixel * 4 + 3] = 0;
  }

  if (feather > 0 && write > 0) {
    const distance = new Uint8Array(pixelCount);
    distance.fill(255);
    const featherQueue = new Int32Array(pixelCount);
    let featherRead = 0;
    let featherWrite = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (!removed[pixel]) continue;
      distance[pixel] = 0;
      featherQueue[featherWrite] = pixel;
      featherWrite += 1;
    }
    while (featherRead < featherWrite) {
      const pixel = featherQueue[featherRead];
      featherRead += 1;
      const nextDistance = distance[pixel] + 1;
      if (nextDistance > feather) continue;
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x + 1 < image.width ? pixel + 1 : -1,
        y > 0 ? pixel - image.width : -1,
        y + 1 < image.height ? pixel + image.width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || distance[neighbor] <= nextDistance) continue;
        distance[neighbor] = nextDistance;
        featherQueue[featherWrite] = neighbor;
        featherWrite += 1;
      }
    }
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const value = distance[pixel];
      if (value === 0 || value === 255 || value > feather) continue;
      const alphaOffset = pixel * 4 + 3;
      result.data[alphaOffset] = Math.round(result.data[alphaOffset] * (value / (feather + 1)));
    }
  }
  options.onProgress?.(1);
  return result;
}

function applyBrushDab(
  target: PixelBuffer,
  original: PixelBuffer,
  centerX: number,
  centerY: number,
  stroke: BrushStroke,
): void {
  const radius = Math.max(1, stroke.size / 2);
  const hardness = Math.min(1, Math.max(0, stroke.hardness ?? 0.78));
  const hardRadius = radius * hardness;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(target.width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(target.height - 1, Math.ceil(centerY + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius) continue;
      const strength = distance <= hardRadius || hardRadius === radius
        ? 1
        : 1 - (distance - hardRadius) / (radius - hardRadius);
      const offset = (y * target.width + x) * 4;
      if (stroke.mode === 'erase') {
        target.data[offset + 3] = Math.round(target.data[offset + 3] * (1 - strength));
      } else {
        for (let channel = 0; channel < 4; channel += 1) {
          target.data[offset + channel] = Math.round(
            target.data[offset + channel] + (original.data[offset + channel] - target.data[offset + channel]) * strength,
          );
        }
      }
    }
  }
}

export function applyBrushStroke(image: PixelBuffer, original: PixelBuffer, stroke: BrushStroke): PixelBuffer {
  assertPixelBuffer(image);
  assertPixelBuffer(original);
  if (image.width !== original.width || image.height !== original.height) {
    throw new RangeError('復元ブラシ用の元画像サイズが一致しません。');
  }
  if (stroke.points.length === 0) return clonePixelBuffer(image);
  const size = Math.min(Math.max(2, stroke.size), Math.max(image.width, image.height));
  const normalizedStroke = { ...stroke, size };
  const result = clonePixelBuffer(image);
  const spacing = Math.max(1, size / 5);
  let previous = stroke.points[0];
  applyBrushDab(result, original, previous.x, previous.y, normalizedStroke);
  for (let index = 1; index < stroke.points.length; index += 1) {
    const current = stroke.points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      applyBrushDab(
        result,
        original,
        previous.x + (current.x - previous.x) * ratio,
        previous.y + (current.y - previous.y) * ratio,
        normalizedStroke,
      );
    }
    previous = current;
  }
  return result;
}

export function findContentBounds(image: PixelBuffer, alphaThreshold = 4): { x: number; y: number; width: number; height: number } | null {
  assertPixelBuffer(image);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function cropPixelBuffer(image: PixelBuffer, bounds: { x: number; y: number; width: number; height: number }): PixelBuffer {
  assertPixelBuffer(image);
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(bounds.x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(bounds.y)));
  const width = Math.max(1, Math.min(image.width - x0, Math.ceil(bounds.width)));
  const height = Math.max(1, Math.min(image.height - y0, Math.ceil(bounds.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }
  return { width, height, data };
}

export function trimTransparent(image: PixelBuffer, padding = 0, alphaThreshold = 4): PixelBuffer {
  const content = findContentBounds(image, alphaThreshold);
  if (!content) return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  const pad = Math.max(0, Math.floor(padding));
  const x = Math.max(0, content.x - pad);
  const y = Math.max(0, content.y - pad);
  const right = Math.min(image.width, content.x + content.width + pad);
  const bottom = Math.min(image.height, content.y + content.height + pad);
  return cropPixelBuffer(image, { x, y, width: right - x, height: bottom - y });
}

function sampleBilinear(image: PixelBuffer, x: number, y: number, output: Uint8ClampedArray, offset: number): void {
  if (x < -0.5 || y < -0.5 || x > image.width - 0.5 || y > image.height - 0.5) return;
  const clampedX = Math.max(0, Math.min(image.width - 1, x));
  const clampedY = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const topLeft = (y0 * image.width + x0) * 4;
  const topRight = (y0 * image.width + x1) * 4;
  const bottomLeft = (y1 * image.width + x0) * 4;
  const bottomRight = (y1 * image.width + x1) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    const top = image.data[topLeft + channel] * (1 - fx) + image.data[topRight + channel] * fx;
    const bottom = image.data[bottomLeft + channel] * (1 - fx) + image.data[bottomRight + channel] * fx;
    output[offset + channel] = Math.round(top * (1 - fy) + bottom * fy);
  }
}

export function resizePixelBuffer(image: PixelBuffer, width: number, height: number): PixelBuffer {
  assertPixelBuffer(image);
  const outputWidth = Math.max(1, Math.round(width));
  const outputHeight = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const scaleX = image.width / outputWidth;
  const scaleY = image.height / outputHeight;
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      sampleBilinear(image, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5, data, (y * outputWidth + x) * 4);
    }
  }
  return { width: outputWidth, height: outputHeight, data };
}

export function normalizeImage(image: PixelBuffer, options: NormalizeOptions): NormalizedImage {
  assertPixelBuffer(image);
  const alphaThreshold = options.alphaThreshold ?? 4;
  const sourceBounds = findContentBounds(image, alphaThreshold);
  const outputSize = options.outputSize;
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  if (!sourceBounds) {
    return {
      pixels: { width: outputSize, height: outputSize, data: new Uint8ClampedArray(outputSize * outputSize * 4) },
      contentBounds: empty,
      anchorX: 0.5,
      anchorY: 1,
      sourceBounds: empty,
      appliedScale: 0,
      warnings: ['表示できる不透明画素がありません。'],
    };
  }
  const padding = Math.min(Math.floor(outputSize * 0.4), Math.max(0, Math.round(options.padding)));
  const available = Math.max(1, outputSize - padding * 2);
  const fitScale = Math.min(available / sourceBounds.width, available / sourceBounds.height);
  const requestedScale = Math.min(4, Math.max(0.1, options.scale));
  const unclampedScale = fitScale * requestedScale;
  const maxScale = Math.min(outputSize / sourceBounds.width, outputSize / sourceBounds.height);
  const appliedScale = Math.min(unclampedScale, maxScale);
  const targetWidth = Math.max(1, Math.round(sourceBounds.width * appliedScale));
  const targetHeight = Math.max(1, Math.round(sourceBounds.height * appliedScale));
  const desiredLeft = (outputSize - targetWidth) / 2 + options.offsetX;
  const desiredBottom = outputSize - padding + options.offsetY;
  const left = Math.round(Math.max(0, Math.min(outputSize - targetWidth, desiredLeft)));
  const top = Math.round(Math.max(0, Math.min(outputSize - targetHeight, desiredBottom - targetHeight)));
  const data = new Uint8ClampedArray(outputSize * outputSize * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const normalizedX = (x + 0.5) / targetWidth;
      const normalizedY = (y + 0.5) / targetHeight;
      const sourceX = sourceBounds.x + (options.flipHorizontal ? 1 - normalizedX : normalizedX) * sourceBounds.width - 0.5;
      const sourceY = sourceBounds.y + normalizedY * sourceBounds.height - 0.5;
      sampleBilinear(image, sourceX, sourceY, data, ((top + y) * outputSize + left + x) * 4);
    }
  }
  const pixels = { width: outputSize, height: outputSize, data };
  const contentBounds = findContentBounds(pixels, alphaThreshold) ?? empty;
  const warnings: string[] = [];
  if (unclampedScale > maxScale) warnings.push('見切れ防止のため拡大率を自動調整しました。');
  if (Math.abs(left - desiredLeft) > 0.51 || Math.abs(top - (desiredBottom - targetHeight)) > 0.51) {
    warnings.push('見切れ防止のため位置を自動調整しました。');
  }
  return {
    pixels,
    contentBounds,
    anchorX: (left + targetWidth / 2) / outputSize,
    anchorY: (top + targetHeight) / outputSize,
    sourceBounds,
    appliedScale,
    warnings,
  };
}

export interface AppliedOperations {
  pixels: PixelBuffer;
  normalize: Partial<NormalizeOptions>;
}

export function applyImageOperations(base: PixelBuffer, operations: ImageOperation[], signal?: AbortSignal): AppliedOperations {
  assertPixelBuffer(base);
  const original = clonePixelBuffer(base);
  let current = clonePixelBuffer(base);
  let normalize: Partial<NormalizeOptions> = {};
  for (const operation of operations) {
    throwIfAborted(signal);
    if (operation.type === 'remove-background') {
      current = removeEdgeConnectedBackground(current, {
        tolerance: operation.tolerance,
        feather: operation.feather,
        signal,
      });
    } else if (operation.type === 'brush') {
      if (current.width !== original.width || current.height !== original.height) {
        throw new Error('トリミング後のブラシ操作は保存順序が不正です。');
      }
      current = applyBrushStroke(current, original, {
        mode: operation.mode,
        size: operation.size,
        points: operation.points,
      });
    } else if (operation.type === 'trim') {
      current = trimTransparent(current);
    } else {
      normalize = {
        ...normalize,
        offsetX: operation.offsetX,
        offsetY: operation.offsetY,
        scale: operation.scale,
        flipHorizontal: operation.flipHorizontal,
        padding: operation.padding,
      };
    }
  }
  return { pixels: current, normalize };
}
