import type { ImageInfo } from '../domain/types';
import type { ImageHeader, ImageSafetyLimits, ImageSafetyResult, SupportedImageMime } from './types';

export const DEFAULT_IMAGE_LIMITS: Readonly<ImageSafetyLimits> = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 24_000_000,
  maxDecodedBytes: 96 * 1024 * 1024,
});

export const WORKER_DECODE_MAX_DIMENSION = 3072;
export const MAIN_THREAD_DECODE_MAX_DIMENSION = 1600;
const HEADER_READ_BYTES = 512 * 1024;

export class ImageSafetyError extends Error {
  constructor(
    public readonly code:
      | 'unsupported-format'
      | 'invalid-header'
      | 'file-too-large'
      | 'dimensions-too-large'
      | 'pixel-count-too-large'
      | 'decoded-memory-too-large'
      | 'unsafe-file-name',
    message: string,
  ) {
    super(message);
    this.name = 'ImageSafetyError';
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let result = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i += 1) result += String.fromCharCode(bytes[i]);
  return result;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function includesAscii(bytes: Uint8Array, value: string): boolean {
  if (value.length === 0 || bytes.length < value.length) return false;
  outer: for (let index = 0; index <= bytes.length - value.length; index += 1) {
    for (let offset = 0; offset < value.length; offset += 1) {
      if (bytes[index + offset] !== value.charCodeAt(offset)) continue outer;
    }
    return true;
  }
  return false;
}

function detectColorMode(bytes: Uint8Array): ImageInfo['colorMode'] {
  if (includesAscii(bytes, 'Display P3') || includesAscii(bytes, 'Display-P3')) return 'Display-P3';
  if (includesAscii(bytes, 'sRGB')) return 'sRGB';
  return 'unknown';
}

function parsePng(bytes: Uint8Array): ImageHeader | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 26 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') throw new ImageSafetyError('invalid-header', 'PNGのヘッダーが壊れています。');
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  const colorType = bytes[25];
  return {
    mimeType: 'image/png',
    width,
    height,
    hasAlphaHint: colorType === 4 || colorType === 6,
    colorMode: detectColorMode(bytes),
  };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = u16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new ImageSafetyError('invalid-header', 'JPEGのサイズ情報が壊れています。');
      return {
        mimeType: 'image/jpeg',
        width: u16be(bytes, offset + 5),
        height: u16be(bytes, offset + 3),
        hasAlphaHint: false,
        colorMode: detectColorMode(bytes),
      };
    }
    offset += segmentLength;
  }
  throw new ImageSafetyError('invalid-header', 'JPEGのサイズ情報を読み取れませんでした。');
}

function parseWebp(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  let width = 0;
  let height = 0;
  let hasAlphaHint = false;
  if (chunk === 'VP8X') {
    hasAlphaHint = (bytes[20] & 0x10) !== 0;
    width = u24le(bytes, 24) + 1;
    height = u24le(bytes, 27) + 1;
  } else if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f || bytes.length < 25) throw new ImageSafetyError('invalid-header', 'WebPのヘッダーが壊れています。');
    width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    hasAlphaHint = true;
  } else if (chunk === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new ImageSafetyError('invalid-header', 'WebPのフレーム情報が壊れています。');
    }
    width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
  } else {
    throw new ImageSafetyError('invalid-header', '未対応のWebP形式です。');
  }
  return { mimeType: 'image/webp', width, height, hasAlphaHint, colorMode: detectColorMode(bytes) };
}

export function inspectImageHeader(input: ArrayBuffer | Uint8Array): ImageHeader {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
  if (!parsed) throw new ImageSafetyError('unsupported-format', 'PNG、JPEG、WebPの画像を選択してください。');
  if (!Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) || parsed.width <= 0 || parsed.height <= 0) {
    throw new ImageSafetyError('invalid-header', '画像サイズが不正です。');
  }
  return parsed;
}

export function validateImageFileName(fileName: string): void {
  if (!fileName || fileName.length > 160 || /[\\/\0-\x1f\x7f]/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new ImageSafetyError('unsafe-file-name', '安全な画像ファイル名を使用してください。');
  }
  if (!/\.(?:png|jpe?g|webp)$/i.test(fileName)) {
    throw new ImageSafetyError('unsupported-format', 'ファイル名の拡張子はPNG、JPEG、WebPにしてください。');
  }
}

export function validateImageSafety(
  header: ImageHeader,
  byteLength: number,
  fileName: string,
  options: Partial<ImageSafetyLimits> & { decodeMaxDimension?: number } = {},
): ImageSafetyResult {
  validateImageFileName(fileName);
  const limits = { ...DEFAULT_IMAGE_LIMITS, ...options };
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > limits.maxInputBytes) {
    throw new ImageSafetyError('file-too-large', `画像は${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB以下にしてください。`);
  }
  if (header.width > limits.maxWidth || header.height > limits.maxHeight) {
    throw new ImageSafetyError('dimensions-too-large', `画像の辺は${limits.maxWidth}px以下にしてください。`);
  }
  const pixels = header.width * header.height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new ImageSafetyError('pixel-count-too-large', '画像の総画素数が大きすぎます。縮小した画像を選択してください。');
  }
  const decodedBytes = pixels * 4;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes) {
    throw new ImageSafetyError('decoded-memory-too-large', '展開後の画像が端末の安全なメモリ上限を超えます。');
  }
  const maxDimension = Math.max(128, options.decodeMaxDimension ?? WORKER_DECODE_MAX_DIMENSION);
  const scale = Math.min(1, maxDimension / Math.max(header.width, header.height));
  const safeDecodeWidth = Math.max(1, Math.round(header.width * scale));
  const safeDecodeHeight = Math.max(1, Math.round(header.height * scale));
  const warnings: string[] = [];
  if (scale < 1) warnings.push(`端末保護のため読み込み時に${safeDecodeWidth}×${safeDecodeHeight}pxへ縮小します。`);
  if (header.colorMode === 'Display-P3') warnings.push('Display-P3画像は書き出し時にsRGB相当へ変換される場合があります。');
  return {
    header,
    fileName,
    byteLength,
    estimatedDecodedBytes: safeDecodeWidth * safeDecodeHeight * 4,
    safeDecodeWidth,
    safeDecodeHeight,
    resizedBeforeDecode: scale < 1,
    warnings,
  };
}

export async function inspectImageBlob(
  blob: Blob,
  fileName: string,
  options: Partial<ImageSafetyLimits> & { decodeMaxDimension?: number } = {},
): Promise<ImageSafetyResult> {
  validateImageFileName(fileName);
  if (blob.size <= 0) throw new ImageSafetyError('invalid-header', '画像ファイルが空です。');
  const headerBytes = await blob.slice(0, Math.min(blob.size, HEADER_READ_BYTES)).arrayBuffer();
  const header = inspectImageHeader(headerBytes);
  const declared = blob.type.toLowerCase();
  const knownDeclared = new Set<SupportedImageMime>(['image/png', 'image/jpeg', 'image/webp']);
  if (declared && knownDeclared.has(declared as SupportedImageMime) && declared !== header.mimeType) {
    throw new ImageSafetyError('invalid-header', '拡張子またはMIMEタイプと画像内容が一致しません。');
  }
  return validateImageSafety(header, blob.size, fileName, options);
}
