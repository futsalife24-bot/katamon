import type { ContentBounds, ImageInfo, ImageOperation } from '../domain/types';

/** A structured-clone friendly replacement for ImageData. */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type SupportedImageMime = ImageInfo['mimeType'];

export interface ImageHeader {
  mimeType: SupportedImageMime;
  width: number;
  height: number;
  hasAlphaHint: boolean;
  colorMode: ImageInfo['colorMode'];
}

export interface ImageSafetyLimits {
  maxInputBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxDecodedBytes: number;
}

export interface ImageSafetyResult {
  header: ImageHeader;
  fileName: string;
  byteLength: number;
  estimatedDecodedBytes: number;
  safeDecodeWidth: number;
  safeDecodeHeight: number;
  resizedBeforeDecode: boolean;
  warnings: string[];
}

export interface BackgroundAnalysis {
  hasAlpha: boolean;
  alphaPixelRatio: number;
  isLikelySolidBackground: boolean;
  solidBackgroundConfidence: number;
  backgroundColor: [number, number, number, number] | null;
  hasBakedCheckerboard: boolean;
  hasBakedBlackBackground: boolean;
  warnings: string[];
}

export interface BackgroundRemovalOptions {
  tolerance: number;
  feather: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface BrushStroke {
  mode: 'erase' | 'restore';
  size: number;
  points: Array<{ x: number; y: number }>;
  hardness?: number;
}

export interface NormalizeOptions {
  outputSize: 128 | 256 | 384 | 512;
  padding: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  flipHorizontal: boolean;
  alphaThreshold?: number;
}

export interface NormalizedImage {
  pixels: PixelBuffer;
  contentBounds: ContentBounds;
  anchorX: number;
  anchorY: number;
  sourceBounds: ContentBounds;
  appliedScale: number;
  warnings: string[];
}

export interface EncodedImage {
  blob: Blob;
  mimeType: SupportedImageMime;
  width: number;
  height: number;
  byteLength: number;
}

export interface ImageVariants {
  normalizedPng: EncodedImage;
  lightweightWebp: EncodedImage;
  iconPng: EncodedImage;
  thumbnail: EncodedImage;
}

export type ImageProgressStage =
  | 'inspect'
  | 'decode'
  | 'analyze'
  | 'background'
  | 'trim'
  | 'normalize'
  | 'encode'
  | 'complete';

export interface ImageProgress {
  stage: ImageProgressStage;
  progress: number;
  message: string;
}

export interface ProcessImageRequest {
  fileName: string;
  blob: Blob;
  removeBackground: boolean;
  background: Omit<BackgroundRemovalOptions, 'signal' | 'onProgress'>;
  operations?: ImageOperation[];
  normalize: NormalizeOptions;
  generateVariants?: boolean;
}

export interface ProcessedImage {
  info: ImageInfo;
  analysis: BackgroundAnalysis;
  original: PixelBuffer;
  edited: PixelBuffer;
  normalized: NormalizedImage;
  variants?: ImageVariants;
  usedWorker: boolean;
  decodeScale: number;
}

export interface ProcessControl {
  signal?: AbortSignal;
  onProgress?: (progress: ImageProgress) => void;
}

export interface HistoryEntry {
  operation: ImageOperation;
  pixels: PixelBuffer;
}

export function clonePixelBuffer(source: PixelBuffer): PixelBuffer {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
  };
}

export function assertPixelBuffer(source: PixelBuffer): void {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width <= 0 || source.height <= 0) {
    throw new RangeError('画像サイズが不正です。');
  }
  const expected = source.width * source.height * 4;
  if (!Number.isSafeInteger(expected) || source.data.length !== expected) {
    throw new RangeError('画像の画素データ長が一致しません。');
  }
}
