import type { ImageInfo, ImageOperation } from '../domain/types';
import { analyzeBackground } from './analysis';
import { decodeImageBlob, generateImageVariants } from './canvas-codec';
import { inspectImageBlob } from './header';
import { applyImageOperations, normalizeImage } from './processing';
import type { ImageProgress, ProcessControl, ProcessedImage, ProcessImageRequest } from './types';

const PROGRESS_MESSAGES: Record<ImageProgress['stage'], string> = {
  inspect: '画像の安全性を確認しています',
  decode: '端末に合わせて画像を読み込んでいます',
  analyze: '背景と透明部分を調べています',
  background: '背景を切り抜いています',
  trim: '余白を整えています',
  normalize: 'ゲーム用の位置とサイズを整えています',
  encode: '画像ファイルを書き出しています',
  complete: '画像処理が完了しました',
};

function report(control: ProcessControl, stage: ImageProgress['stage'], progress: number): void {
  control.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)), message: PROGRESS_MESSAGES[stage] });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('画像処理を中止しました。', 'AbortError');
}

export async function processImageCore(
  request: ProcessImageRequest,
  control: ProcessControl = {},
  decodeMaxDimension = 3072,
  usedWorker = false,
): Promise<ProcessedImage> {
  throwIfAborted(control.signal);
  report(control, 'inspect', 0.02);
  const safety = await inspectImageBlob(request.blob, request.fileName, { decodeMaxDimension });
  throwIfAborted(control.signal);
  report(control, 'decode', 0.12);
  const original = await decodeImageBlob(request.blob, safety);
  throwIfAborted(control.signal);
  report(control, 'analyze', 0.3);
  const analysis = analyzeBackground(original);

  const operations: ImageOperation[] = [];
  if (request.removeBackground) {
    operations.push({
      type: 'remove-background',
      tolerance: request.background.tolerance,
      feather: request.background.feather,
    });
  }
  operations.push(...(request.operations ?? []));
  report(control, 'background', 0.4);
  const applied = applyImageOperations(original, operations, control.signal);
  throwIfAborted(control.signal);
  report(control, 'trim', 0.62);
  const normalizeOptions = { ...request.normalize, ...applied.normalize };
  report(control, 'normalize', 0.68);
  const normalized = normalizeImage(applied.pixels, normalizeOptions);
  throwIfAborted(control.signal);

  const info: ImageInfo = {
    fileName: request.fileName,
    mimeType: safety.header.mimeType,
    byteLength: request.blob.size,
    width: safety.header.width,
    height: safety.header.height,
    hasAlpha: analysis.hasAlpha,
    colorMode: safety.header.colorMode,
    estimatedOutputBytes: Math.ceil(normalized.pixels.width * normalized.pixels.height * (analysis.hasAlpha ? 1.5 : 1)),
    status: 'ready',
    warnings: [...safety.warnings, ...analysis.warnings, ...normalized.warnings],
  };
  let variants;
  if (request.generateVariants !== false) {
    report(control, 'encode', 0.78);
    variants = await generateImageVariants(normalized.pixels, (value) => report(control, 'encode', 0.78 + value * 0.2));
  }
  throwIfAborted(control.signal);
  report(control, 'complete', 1);
  return {
    info,
    analysis,
    original,
    edited: applied.pixels,
    normalized,
    variants,
    usedWorker,
    decodeScale: original.width / safety.header.width,
  };
}
