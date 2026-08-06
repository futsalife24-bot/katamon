import { strToU8, zip } from 'fflate';
import type { DraftRecord } from '../domain/types';
import type { EncodedIdleSpriteResult } from './types';

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
