import { strToU8, zip } from 'fflate';
import type { DraftRecord, MotionClipId } from '../domain/types';
import { MOTION_CLIP_IDS, MOTION_CLIP_LABELS } from './batch';
import type { EncodedIdleSpriteResult, MotionBatchResult } from './types';

export interface MotionPackageProfile {
  schemaVersion: 1;
  generatorVersion: string;
  action: DraftRecord['motionAction'];
  actionPreset: DraftRecord['actionPreset'];
  quality: 'high' | 'lightweight';
  sprite: {
    file: string;
    metadataFile: string;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    fps: number;
    byteLength: number;
  };
  parts: DraftRecord['partDetection'];
  generatedAt: string;
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    });
  });
}

export function buildMotionProfile(draft: DraftRecord, sprite: EncodedIdleSpriteResult): MotionPackageProfile {
  return {
    schemaVersion: 1,
    generatorVersion: sprite.metadata.generatorVersion,
    action: draft.motionAction,
    actionPreset: draft.actionPreset,
    quality: sprite.metadata.frameWidth >= 512 ? 'high' : 'lightweight',
    sprite: {
      file: 'sprite-sheet.png',
      metadataFile: 'sprite-metadata.json',
      frameWidth: sprite.metadata.frameWidth,
      frameHeight: sprite.metadata.frameHeight,
      frameCount: sprite.metadata.frameCount,
      fps: sprite.metadata.fps,
      byteLength: sprite.spriteSheetPng.byteLength,
    },
    parts: structuredClone(draft.partDetection),
    generatedAt: sprite.metadata.generatedAt,
  };
}

export function buildMotionProfileJson(draft: DraftRecord, sprite: EncodedIdleSpriteResult): string {
  return `${JSON.stringify(buildMotionProfile(draft, sprite), null, 2)}\n`;
}

export async function createMotionPackage(draft: DraftRecord, sprite: EncodedIdleSpriteResult): Promise<Blob> {
  const spriteBytes = new Uint8Array(await sprite.spriteSheetPng.blob.arrayBuffer());
  const metadata = `${JSON.stringify(sprite.metadata, null, 2)}\n`;
  return zipAsync({
    'motion/sprite-sheet.png': spriteBytes,
    'motion/sprite-metadata.json': strToU8(metadata),
    'motion/motion-profile.json': strToU8(buildMotionProfileJson(draft, sprite)),
  });
}

export interface MotionBatchProfile {
  schemaVersion: 2;
  generatorVersion: string;
  sourceFacing: DraftRecord['landmarks']['facing'];
  landmarks: DraftRecord['landmarks'];
  motions: Record<MotionClipId, {
    label: string;
    spriteFile: string;
    metadataFile: string;
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    fps: number;
    loop: boolean;
    byteLength: number;
  }>;
  generatedAt: string;
}

export function buildMotionBatchProfile(draft: DraftRecord, motions: MotionBatchResult): MotionBatchProfile {
  const generatedAt = motions['move-forward'].metadata.generatedAt;
  return {
    schemaVersion: 2,
    generatorVersion: motions['move-forward'].metadata.generatorVersion,
    sourceFacing: draft.landmarks.facing,
    landmarks: structuredClone(draft.landmarks),
    motions: Object.fromEntries(MOTION_CLIP_IDS.map((clipId) => {
      const sprite = motions[clipId];
      return [clipId, {
        label: MOTION_CLIP_LABELS[clipId],
        spriteFile: `motions/${clipId}/sprite.png`,
        metadataFile: `motions/${clipId}/metadata.json`,
        frameWidth: sprite.metadata.frameWidth,
        frameHeight: sprite.metadata.frameHeight,
        frameCount: sprite.metadata.frameCount,
        fps: sprite.metadata.fps,
        loop: sprite.metadata.loop,
        byteLength: sprite.spriteSheetPng.byteLength,
      }];
    })) as MotionBatchProfile['motions'],
    generatedAt,
  };
}

export function buildMotionBatchProfileJson(draft: DraftRecord, motions: MotionBatchResult): string {
  return `${JSON.stringify(buildMotionBatchProfile(draft, motions), null, 2)}\n`;
}

export async function createMotionBatchPackage(draft: DraftRecord, motions: MotionBatchResult): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    'motion-profile.json': strToU8(buildMotionBatchProfileJson(draft, motions)),
  };
  for (const clipId of MOTION_CLIP_IDS) {
    const sprite = motions[clipId];
    files[`motions/${clipId}/sprite.png`] = new Uint8Array(await sprite.spriteSheetPng.blob.arrayBuffer());
    files[`motions/${clipId}/metadata.json`] = strToU8(`${JSON.stringify(sprite.metadata, null, 2)}\n`);
  }
  return zipAsync(files);
}
