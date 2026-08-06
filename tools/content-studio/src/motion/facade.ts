import type {
  DetectedMotionPart,
  EyeMarker,
  MotionAction,
  MotionActionPreset,
  MotionParameters,
  MotionPreset,
  MotionClipId,
  NormalizedPoint,
} from '../domain/types';
import { encodePixelBuffer } from '../image/canvas-codec';
import { ContentImageProcessor } from '../image/pipeline';
import type { ImageProgress, ProcessControl } from '../image/types';
import { ContentMotionProcessor } from './processor';
import { resolveMotionParameters } from './presets';
import type { EncodedIdleSpriteResult, MotionGenerationRequest, MotionProgress } from './types';

export interface IdleMotionBlobRequest {
  blob: Blob;
  fileName: string;
  sourceImage: string;
  preset: MotionPreset;
  parameters?: Partial<MotionParameters>;
  sourcePlacement?: MotionGenerationRequest['sourcePlacement'];
  action?: MotionAction;
  actionPreset?: MotionActionPreset;
  partRegions?: DetectedMotionPart[];
  focusPartId?: string | null;
  anchorPartId?: string | null;
  groundPoint?: NormalizedPoint;
  muzzlePoint?: NormalizedPoint;
  eyeMarkers?: EyeMarker[];
  clipId?: MotionClipId;
  removeBackground?: boolean;
  backgroundTolerance?: number;
  edgeFeather?: number;
  generatedAt?: string;
}

export interface IdleMotionBlobControl {
  signal?: AbortSignal;
  onImageProgress?: (progress: ImageProgress) => void;
  onMotionProgress?: (progress: MotionProgress) => void;
}

/** One-call facade used by the UI and mock publishing flow. No network or AI service is involved. */
export async function generateIdleMotionFromBlob(
  request: IdleMotionBlobRequest,
  control: IdleMotionBlobControl = {},
): Promise<EncodedIdleSpriteResult> {
  const parameters = resolveMotionParameters(request.preset, request.parameters);
  const imageControl: ProcessControl = { signal: control.signal, onProgress: control.onImageProgress };
  const prepared = await new ContentImageProcessor().process(
    {
      fileName: request.fileName,
      blob: request.blob,
      removeBackground: request.removeBackground ?? false,
      background: {
        tolerance: request.backgroundTolerance ?? 32,
        feather: request.edgeFeather ?? 1,
      },
      normalize: {
        outputSize: parameters.outputSize,
        padding: parameters.canvasPadding,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        flipHorizontal: false,
      },
      generateVariants: false,
    },
    imageControl,
  );
  const generated = await new ContentMotionProcessor().generate(
    {
      // Use the safety-limited edited source. The generator normalizes it once;
      // feeding the already-normalized variant here caused visible repeated blur.
      source: prepared.edited,
      sourceImage: request.sourceImage,
      preset: request.preset,
      parameters,
      sourcePlacement: request.sourcePlacement,
      action: request.action,
      actionPreset: request.actionPreset,
      partRegions: request.partRegions,
      focusPartId: request.focusPartId,
      anchorPartId: request.anchorPartId,
      groundPoint: request.groundPoint,
      muzzlePoint: request.muzzlePoint,
      eyeMarkers: request.eyeMarkers,
      clipId: request.clipId,
      generatedAt: request.generatedAt,
    },
    { signal: control.signal, onProgress: control.onMotionProgress },
  );
  const spriteSheetPng = await encodePixelBuffer(generated.sheet, 'image/png');
  return { ...generated, spriteSheetPng };
}
