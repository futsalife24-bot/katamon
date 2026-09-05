// Shared conservative contract; deployments may lower, never raise these ceilings.
export const PUBLISH_LIMITS = Object.freeze({ maxFileBytes: 6 * 1024 * 1024, maxTotalFileBytes: 16 * 1024 * 1024, maxRequestBytes: 24 * 1024 * 1024, maxFiles: 32 });
export type PublishLimits = typeof PUBLISH_LIMITS;
export function assertPublishSize(files: readonly { path: string; byteLength: number }[], limits: PublishLimits = PUBLISH_LIMITS): void {
  if (!files.length || files.length > limits.maxFiles) throw new Error(`公開ファイル数は1〜${limits.maxFiles}件です。`);
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength <= 0 || file.byteLength > limits.maxFileBytes) throw new Error(`${file.path}: 公開上限${limits.maxFileBytes / 1024 / 1024}MiBを超えています。画像の大きさを調整して再生成してください。`);
    total += file.byteLength;
  }
  if (total > limits.maxTotalFileBytes) throw new Error(`公開する全ファイルの合計は${limits.maxTotalFileBytes / 1024 / 1024}MiBまでです。画像の大きさを調整してください。`);
}
export function assertRequestSize(body: string, maximum = PUBLISH_LIMITS.maxRequestBytes): void {
  if (new TextEncoder().encode(body).byteLength > maximum) throw new Error(`Base64変換後の送信データが${maximum / 1024 / 1024}MiBを超えています。画像の大きさを調整してください。`);
}
