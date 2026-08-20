import type { ImageSafetyResult } from './types';
import type { EncodedImage, ImageVariants, PixelBuffer, SupportedImageMime } from './types';
import { assertPixelBuffer } from './types';
import { resizePixelBuffer } from './processing';

type CanvasLike = OffscreenCanvas | HTMLCanvasElement;
type CanvasContextLike = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('この環境ではCanvas画像処理を利用できません。Android Chromeまたは開発用Chromeで開いてください。');
}

function context2d(canvas: CanvasLike): CanvasContextLike {
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) throw new Error('Canvas 2Dコンテキストを初期化できませんでした。');
  return context as CanvasContextLike;
}

async function decodeWithImageElement(blob: Blob, width: number, height: number): Promise<PixelBuffer> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new Error('画像デコードAPIが利用できません。通常のファイル選択で再度お試しください。');
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('画像を読み込めませんでした。ファイルが壊れていないか確認してください。'));
      image.src = url;
    });
    const canvas = createCanvas(width, height);
    const context = context2d(canvas);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const decoded = context.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8ClampedArray(decoded.data) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes at the already safety-limited dimensions and always closes ImageBitmap. */
export async function decodeImageBlob(blob: Blob, safety: ImageSafetyResult): Promise<PixelBuffer> {
  const width = safety.safeDecodeWidth;
  const height = safety.safeDecodeHeight;
  if (typeof createImageBitmap !== 'function') return decodeWithImageElement(blob, width, height);
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'default',
      colorSpaceConversion: 'default',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    const canvas = createCanvas(width, height);
    const context = context2d(canvas);
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const decoded = context.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8ClampedArray(decoded.data) };
  } catch (error) {
    // Some older Chrome builds reject resize options for specific WebP encodings.
    if (typeof document !== 'undefined') return decodeWithImageElement(blob, width, height);
    throw error;
  } finally {
    bitmap?.close();
  }
}

async function canvasToBlob(canvas: CanvasLike, mimeType: SupportedImageMime, quality?: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mimeType, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の書き出しに失敗しました。'))),
      mimeType,
      quality,
    );
  });
}

export async function encodePixelBuffer(
  pixels: PixelBuffer,
  mimeType: 'image/png' | 'image/webp',
  quality = 0.86,
): Promise<EncodedImage> {
  assertPixelBuffer(pixels);
  const canvas = createCanvas(pixels.width, pixels.height);
  const context = context2d(canvas);
  const imageData = context.createImageData(pixels.width, pixels.height);
  imageData.data.set(pixels.data);
  context.putImageData(imageData, 0, 0);
  let blob = await canvasToBlob(canvas, mimeType, quality);
  let actualType: SupportedImageMime = mimeType;
  if (mimeType === 'image/webp' && blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/png');
    actualType = 'image/png';
  }
  return {
    blob,
    mimeType: actualType,
    width: pixels.width,
    height: pixels.height,
    byteLength: blob.size,
  };
}

export async function generateImageVariants(
  normalized: PixelBuffer,
  onProgress?: (progress: number) => void,
): Promise<ImageVariants> {
  assertPixelBuffer(normalized);
  const iconPixels = resizePixelBuffer(normalized, 128, 128);
  const thumbnailSize = Math.min(256, normalized.width);
  const thumbnailPixels = resizePixelBuffer(normalized, thumbnailSize, thumbnailSize);
  const normalizedPng = await encodePixelBuffer(normalized, 'image/png');
  onProgress?.(0.25);
  const lightweightWebp = await encodePixelBuffer(normalized, 'image/webp', 0.84);
  onProgress?.(0.5);
  const iconPng = await encodePixelBuffer(iconPixels, 'image/png');
  onProgress?.(0.75);
  const thumbnail = await encodePixelBuffer(thumbnailPixels, 'image/webp', 0.82);
  onProgress?.(1);
  return { normalizedPng, lightweightWebp, iconPng, thumbnail };
}
