import type { ImageProgress, ProcessedImage, ProcessImageRequest } from './types';

export interface ImageWorkerRequest {
  id: string;
  type: 'process';
  request: ProcessImageRequest;
}

export type ImageWorkerResponse =
  | { id: string; type: 'progress'; progress: ImageProgress }
  | { id: string; type: 'complete'; result: ProcessedImage }
  | { id: string; type: 'error'; error: { name: string; message: string; code?: string } };
