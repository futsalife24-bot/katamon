import type {
  DetectedMotionPart,
  EyeMarker,
  MotionAction,
  MotionActionPreset,
  MotionParameters,
  MotionPreset,
  MotionClipId,
  NormalizedPoint,
  SpriteMetadata,
} from '../domain/types';
import type { EncodedImage, PixelBuffer } from '../image/types';

export interface MotionFrameTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotationRadians: number;
  flipHorizontal: boolean;
}

export interface PartMaskDefinition {
  id: string;
  label: string;
  blobKey?: string;
  /** Optional alpha mask; omitted in the MVP metadata and retained only in the local draft. */
  mask?: PixelBuffer;
}

export interface PartMotionContext {
  frameIndex: number;
  frameCount: number;
  phase: number;
  preset: MotionPreset;
  parameters: MotionParameters;
}

/** Future providers can supply per-part affine transforms without changing the base generator. */
export interface PartMotionProvider {
  readonly id: string;
  supports(part: PartMaskDefinition, preset: MotionPreset): boolean;
  transform(part: PartMaskDefinition, context: PartMotionContext): MotionFrameTransform;
}

export interface MotionGenerationRequest {
  source: PixelBuffer;
  sourceImage: string;
  preset: MotionPreset;
  parameters?: Partial<MotionParameters>;
  sourcePlacement?: {
    padding: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    flipHorizontal: boolean;
    referenceSize: number;
  };
  action?: MotionAction;
  actionPreset?: MotionActionPreset;
  partRegions?: DetectedMotionPart[];
  focusPartId?: string | null;
  anchorPartId?: string | null;
  groundPoint?: NormalizedPoint;
  muzzlePoint?: NormalizedPoint;
  eyeMarkers?: EyeMarker[];
  clipId?: MotionClipId;
  partMasks?: PartMaskDefinition[];
  generatedAt?: string;
}

export interface MotionProgress {
  frame: number;
  totalFrames: number;
  progress: number;
  message: string;
}

export interface MotionControl {
  signal?: AbortSignal;
  onProgress?: (progress: MotionProgress) => void;
  yieldToMainThread?: boolean;
}

export interface IdleSpriteResult {
  sheet: PixelBuffer;
  metadata: SpriteMetadata;
  transforms: MotionFrameTransform[];
  frameBounds: Array<{ x: number; y: number; width: number; height: number }>;
  usedWorker: boolean;
}

export interface EncodedIdleSpriteResult extends IdleSpriteResult {
  spriteSheetPng: EncodedImage;
}

export type MotionBatchResult = Record<MotionClipId, EncodedIdleSpriteResult>;
