import type { IdleSpriteResult, MotionGenerationRequest, MotionProgress } from './types';

export interface MotionWorkerRequest {
  id: string;
  type: 'generate';
  request: MotionGenerationRequest;
}

export type MotionWorkerResponse =
  | { id: string; type: 'progress'; progress: MotionProgress }
  | { id: string; type: 'complete'; result: IdleSpriteResult }
  | { id: string; type: 'error'; error: { name: string; message: string } };
