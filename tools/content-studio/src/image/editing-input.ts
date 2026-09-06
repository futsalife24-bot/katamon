import { editingCheckpointSchema } from '../domain/editing-checkpoint';
import { GENERATOR_VERSION, type DraftRecord } from '../domain/types';
import { sha256Blob } from '../generation/hash';
import { encodePixelBuffer } from './canvas-codec';
import type { PixelBuffer } from './types';
import type { MotionBatchResult } from '../motion/types';
import { MOTION_CLIP_IDS, motionInputKeys } from '../motion/batch';

/** Checkpoint begins after destructive editing and before placement. Camera metadata never crosses this boundary. */
export async function sanitizeEditingInput(pixels: PixelBuffer): Promise<Blob> {
  if (pixels.width > 1600 || pixels.height > 1600 || pixels.width < 1 || pixels.height < 1 || pixels.data.length !== pixels.width * pixels.height * 4) throw new Error('編集基準画像の寸法が上限を超えています。下書きを保持しました。');
  const data = new Uint8ClampedArray(pixels.data);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 0) data.fill(0, i, i + 3);
  return (await encodePixelBuffer({ width: pixels.width, height: pixels.height, data }, 'image/png')).blob;
}
export async function createEditingInput(draft: DraftRecord, source: PixelBuffer, hitSource: PixelBuffer | undefined, motions: MotionBatchResult, reuse: {source?:Blob;hitSource?:Blob} = {}) {
  const inputKeys = await motionInputKeys({source,hitSource,sourceImage:'normalized.png',landmarks:draft.landmarks,
    outputSize:draft.motion.outputSize,intensity:draft.motionIntensity,sourcePlacement:{padding:draft.editor.padding,
      offsetX:draft.editor.offsetX,offsetY:draft.editor.offsetY,scale:draft.editor.scale,
      flipHorizontal:draft.editor.flipHorizontal,referenceSize:draft.editor.outputSize}});
  if(MOTION_CLIP_IDS.some(id=>motions[id].inputKey!==inputKeys[id]))throw new Error('生成物と編集入力が一致しません。必要なモーションを生成してから公開してください。');
  const normal = reuse.source ?? await sanitizeEditingInput(source), hit = hitSource ? reuse.hitSource ?? await sanitizeEditingInput(hitSource) : undefined;
  const describe = async (blob: Blob, pixels: PixelBuffer) => ({sha256: await sha256Blob(blob), width: pixels.width, height: pixels.height});
  const checkpoint = editingCheckpointSchema.parse({
    version: 1, generatorVersion: GENERATOR_VERSION,
    source: await describe(normal, source), ...(hit && hitSource ? {hitSource: await describe(hit, hitSource)} : {}),
    placement: {padding: draft.editor.padding, offsetX: draft.editor.offsetX, offsetY: draft.editor.offsetY, scale: draft.editor.scale, flipHorizontal: draft.editor.flipHorizontal, referenceSize: draft.editor.outputSize},
    landmarks: {facing: draft.landmarks.facing, ground: {x:draft.landmarks.ground.x, y:draft.landmarks.ground.y}, muzzle: {x:draft.landmarks.muzzle.x, y:draft.landmarks.muzzle.y}},
    outputSize: motions['move-forward'].metadata.frameWidth, intensity: draft.motionIntensity,
    clips: Object.fromEntries(MOTION_CLIP_IDS.map(id => [id, {preset: motions[id].metadata.preset, parameters: motions[id].metadata.motionParameters}])),
  });
  return {checkpoint, source: normal, hitSource: hit};
}
