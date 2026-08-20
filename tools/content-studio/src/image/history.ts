import type { ImageOperation } from '../domain/types';
import type { HistoryEntry, PixelBuffer } from './types';
import { assertPixelBuffer, clonePixelBuffer } from './types';

/**
 * Bounded in-memory history. Draft persistence stores operations; snapshots only make touch editing responsive.
 */
export class ImageOperationHistory {
  private snapshots: PixelBuffer[];
  private operations: ImageOperation[] = [];
  private cursor = 0;

  constructor(
    initial: PixelBuffer,
    private readonly maxEntries = 20,
    private readonly maxBytes = 48 * 1024 * 1024,
  ) {
    assertPixelBuffer(initial);
    this.snapshots = [clonePixelBuffer(initial)];
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.operations.length;
  }

  get current(): PixelBuffer {
    return clonePixelBuffer(this.snapshots[this.cursor]);
  }

  get appliedOperations(): ImageOperation[] {
    return structuredClone(this.operations.slice(0, this.cursor));
  }

  commit(operation: ImageOperation, pixels: PixelBuffer): PixelBuffer {
    assertPixelBuffer(pixels);
    if (this.cursor < this.operations.length) {
      this.operations.splice(this.cursor);
      this.snapshots.splice(this.cursor + 1);
    }
    this.operations.push(structuredClone(operation));
    this.snapshots.push(clonePixelBuffer(pixels));
    this.cursor += 1;
    this.trimBudget();
    return this.current;
  }

  undo(): PixelBuffer {
    if (this.canUndo) this.cursor -= 1;
    return this.current;
  }

  redo(): PixelBuffer {
    if (this.canRedo) this.cursor += 1;
    return this.current;
  }

  clear(initial?: PixelBuffer): PixelBuffer {
    const source = initial ?? this.snapshots[this.cursor];
    assertPixelBuffer(source);
    this.snapshots = [clonePixelBuffer(source)];
    this.operations = [];
    this.cursor = 0;
    return this.current;
  }

  entries(): HistoryEntry[] {
    return this.operations.map((operation, index) => ({
      operation: structuredClone(operation),
      pixels: clonePixelBuffer(this.snapshots[index + 1]),
    }));
  }

  private trimBudget(): void {
    const totalBytes = () => this.snapshots.reduce((sum, pixels) => sum + pixels.data.byteLength, 0);
    while (this.operations.length > 1 && (this.operations.length > this.maxEntries || totalBytes() > this.maxBytes)) {
      this.operations.shift();
      this.snapshots.shift();
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }
}
