import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from '../domain/types';

export class UnconfiguredImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'unconfigured';
  readonly available = false;

  async generate(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return {
      status: 'failed',
      error: '画像生成APIは未設定です。画像アップロードから作業を続けてください。',
    };
  }

  async cancel(): Promise<void> {
    return;
  }
}
