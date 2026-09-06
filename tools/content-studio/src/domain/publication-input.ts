import type { DraftRecord } from './types';
import { stableStringify } from '../generation/stable';
/** Content identity excludes navigation, review state and preview-only controls. Blobs are invalidated at replacement entry points. */
export function publicationInputKey(draft: DraftRecord): string {
  const { zoom, tool, brushSize, ...editor } = draft.editor;
  return stableStringify({
    id: draft.id, character: draft.character, imageInfo: draft.imageInfo, hitImageInfo: draft.hitImageInfo,
    publishedEdit: draft.publishedEdit, originalSha256: draft.originalSha256, hitOriginalSha256: draft.hitOriginalSha256, editor, processingOperations: draft.processingOperations, landmarks: draft.landmarks, partDetection: draft.partDetection,
    motion: draft.motion, motionPreset: draft.motionPreset, motionAction: draft.motionAction, actionPreset: draft.actionPreset,
    motionIntensity: draft.motionIntensity, sourceIdentity: draft.sourceIdentity, legacyTargetId: draft.legacyTargetId
  });
}
