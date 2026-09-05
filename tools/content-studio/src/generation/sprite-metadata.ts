import { spriteMetadataSchema } from '../domain/schemas';
import {
  GENERATOR_VERSION,
  type ContentBounds,
  type DetectedMotionPart,
  type MotionAction,
  type MotionActionPreset,
  type MotionParameters,
  type MotionPreset,
  type MotionClipId,
  type SpriteMetadata,
} from '../domain/types';

export interface BuildSpriteMetadataInput {
  rendering?: SpriteMetadata['rendering'];
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  anchorX: number;
  anchorY: number;
  contentBounds: ContentBounds;
  collisionBounds?: ContentBounds;
  sourceImage: string;
  preset: MotionPreset;
  motionAction?: MotionAction;
  actionPreset?: MotionActionPreset;
  clipId?: MotionClipId;
  loop?: boolean;
  motionParameters: MotionParameters;
  partMasks?: Array<{ id: string; label: string; blobKey?: string }>;
  partRegions?: DetectedMotionPart[];
  generatedAt?: string;
  generatorVersion?: string;
}

export function suggestCollisionBounds(content: ContentBounds): ContentBounds {
  const horizontalInset = content.width * 0.1;
  return {
    x: content.x + horizontalInset,
    y: content.y + content.height * 0.55,
    width: content.width - horizontalInset * 2,
    height: content.height * 0.45,
  };
}

function isInsideFrame(bounds: ContentBounds, width: number, height: number): boolean {
  return bounds.x >= 0 && bounds.y >= 0 && bounds.width >= 0 && bounds.height >= 0 &&
    bounds.x + bounds.width <= width && bounds.y + bounds.height <= height;
}

/** Pure metadata construction; callers can inject generatedAt for deterministic output. */
export function buildSpriteMetadata(input: BuildSpriteMetadataInput): SpriteMetadata {
  if (input.frameCount !== input.motionParameters.frameCount) {
    throw new Error('フレーム数がモーション設定と一致しません');
  }
  if (!isInsideFrame(input.contentBounds, input.frameWidth, input.frameHeight)) {
    throw new Error('コンテンツ境界がフレーム外です');
  }

  const collisionBounds = input.collisionBounds ?? suggestCollisionBounds(input.contentBounds);
  if (!isInsideFrame(collisionBounds, input.frameWidth, input.frameHeight)) {
    throw new Error('当たり判定候補がフレーム外です');
  }

  const metadata: SpriteMetadata = {
    schemaVersion: 1,
    ...(input.rendering ? { rendering: input.rendering } : {}),
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    frameCount: input.frameCount,
    fps: input.fps,
    loop: input.loop ?? true,
    anchorX: input.anchorX,
    anchorY: input.anchorY,
    contentBounds: { ...input.contentBounds },
    collisionBounds: { ...collisionBounds },
    sourceImage: input.sourceImage,
    preset: input.preset,
    ...(input.motionAction ? { motionAction: input.motionAction } : {}),
    ...(input.actionPreset ? { actionPreset: input.actionPreset } : {}),
    ...(input.clipId ? { clipId: input.clipId } : {}),
    motionParameters: { ...input.motionParameters },
    partMasks: (input.partMasks ?? []).map((mask) => ({ ...mask })),
    ...(input.partRegions ? { partRegions: input.partRegions.map((part) => structuredClone(part)) } : {}),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    generatorVersion: input.generatorVersion ?? GENERATOR_VERSION,
  };
  return spriteMetadataSchema.parse(metadata) as SpriteMetadata;
}
