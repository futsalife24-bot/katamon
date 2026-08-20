import { describe, expect, it } from 'vitest';

import { ImageOperationHistory } from '../../src/image/history';
import type { PixelBuffer } from '../../src/image/types';

function pixels(alpha: number): PixelBuffer {
  return { width: 1, height: 1, data: Uint8ClampedArray.from([10, 20, 30, alpha]) };
}

describe('画像操作履歴', () => {
  it('undo/redoし、新操作時にredo枝を破棄する', () => {
    const history = new ImageOperationHistory(pixels(255));
    history.commit({ type: 'trim' }, pixels(180));
    history.commit({ type: 'transform', offsetX: 1, offsetY: 0, scale: 1, flipHorizontal: false, padding: 0 }, pixels(120));
    expect(history.undo().data[3]).toBe(180);
    expect(history.redo().data[3]).toBe(120);
    history.undo();
    history.commit({ type: 'brush', mode: 'erase', size: 4, points: [{ x: 0, y: 0 }] }, pixels(0));
    expect(history.canRedo).toBe(false);
    expect(history.appliedOperations.map((operation) => operation.type)).toEqual(['trim', 'brush']);
  });

  it('返却した画素の変更が履歴内部へ波及しない', () => {
    const history = new ImageOperationHistory(pixels(255));
    const current = history.current;
    current.data[3] = 0;
    expect(history.current.data[3]).toBe(255);
  });
});
