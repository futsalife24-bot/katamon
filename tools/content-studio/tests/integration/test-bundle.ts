import type { ArtifactBundle, CharacterForm } from '../../src/domain/types';
import { buildArtifactBundle } from '../../src/generation/artifacts';
import { sampleCharacter, sampleMetadata } from '../unit/test-character';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

export async function sampleBundle(
  character: CharacterForm = sampleCharacter(),
  createdAt = '2026-08-06T00:00:00.000Z',
): Promise<ArtifactBundle> {
  return buildArtifactBundle({
    character,
    spriteMetadata: sampleMetadata(),
    createdAt,
    expectedBaseSha: '0000000000000000000000000000000000000000',
    images: {
      sourceImage: new Blob([JPEG], { type: 'image/jpeg' }),
      normalizedPng: new Blob([PNG], { type: 'image/png' }),
      optimizedWebp: new Blob([WEBP], { type: 'image/webp' }),
      iconPng: new Blob([PNG, new Uint8Array([4])], { type: 'image/png' }),
      thumbnailWebp: new Blob([WEBP, new Uint8Array([5])], { type: 'image/webp' }),
      spriteSheetPng: new Blob([PNG, new Uint8Array([6])], { type: 'image/png' }),
      previewPng: new Blob([PNG, new Uint8Array([7])], { type: 'image/png' }),
    },
  });
}
