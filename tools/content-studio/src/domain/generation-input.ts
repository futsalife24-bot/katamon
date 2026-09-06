import type { DraftRecord, MotionClipId } from './types';
import { stableStringify } from '../generation/stable';

export const UNAPPLIED_IMAGE_MESSAGE = '未適用の画像設定があります。「画像」の「変更を画像へ反映」を実行してから生成・検証・公開・ZIP出力へ進んでください。';
/** Only settings consumed when applying the image; viewport/tool changes are not edits. */
export function imageInputKey(draft: DraftRecord): string {
  const { zoom, tool, brushSize, ...editor } = draft.editor;
  return stableStringify({ source: draft.originalSha256 ?? null, editor });
}
export function hasUnappliedImage(draft: DraftRecord): boolean {
  return draft.appliedImageInputKey !== imageInputKey(draft);
}
/** Per-clip invalidation is independent of character information and preview controls. */
export function draftClipInputKey(draft: DraftRecord, id: MotionClipId): string {
  return stableStringify({ image: imageInputKey(draft), operations: draft.processingOperations,
    hit: id === 'hit' ? draft.hitOriginalSha256 ?? null : null,
    facing: draft.landmarks.facing, ground: draft.landmarks.ground, muzzle: draft.landmarks.muzzle,
    outputSize: draft.motion.outputSize, intensity: draft.motionIntensity[id] });
}
