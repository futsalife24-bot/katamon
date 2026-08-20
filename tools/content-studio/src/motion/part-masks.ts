import type { MotionPreset } from '../domain/types';
import { assertPixelBuffer } from '../image/types';
import type { PartMaskDefinition, PartMotionProvider } from './types';

const SAFE_PART_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function validatePartMasks(
  parts: PartMaskDefinition[],
  frameWidth: number,
  frameHeight: number,
): Array<{ id: string; label: string; blobKey?: string }> {
  if (parts.length > 32) throw new RangeError('部位マスクは32個以下にしてください。');
  const ids = new Set<string>();
  return parts.map((part) => {
    if (!SAFE_PART_ID.test(part.id) || ids.has(part.id)) throw new Error('部位マスクIDが不正または重複しています。');
    if (!part.label.trim() || part.label.length > 40 || /[<>\u0000-\u001f]/u.test(part.label)) {
      throw new Error('部位マスク名が不正です。');
    }
    if (part.blobKey && (part.blobKey.length > 160 || /(?:\.\.|[\\/\u0000-\u001f])/u.test(part.blobKey))) {
      throw new Error('部位マスクの保存キーが不正です。');
    }
    if (part.mask) {
      assertPixelBuffer(part.mask);
      if (part.mask.width !== frameWidth || part.mask.height !== frameHeight) {
        throw new Error('部位マスクのサイズがフレームと一致しません。');
      }
    }
    ids.add(part.id);
    return { id: part.id, label: part.label.trim(), ...(part.blobKey ? { blobKey: part.blobKey } : {}) };
  });
}

export class PartMotionRegistry {
  private readonly providers = new Map<string, PartMotionProvider>();

  register(provider: PartMotionProvider): void {
    if (!provider.id || this.providers.has(provider.id)) throw new Error('部位モーションプロバイダーIDが重複しています。');
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  find(part: PartMaskDefinition, preset: MotionPreset): PartMotionProvider | undefined {
    return [...this.providers.values()].find((provider) => provider.supports(part, preset));
  }
}
