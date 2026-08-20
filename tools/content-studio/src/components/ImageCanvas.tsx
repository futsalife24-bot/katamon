import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ImageEditorState } from '../domain/types';
import type { PixelBuffer } from '../image';

interface ImageCanvasProps {
  pixels: PixelBuffer | null;
  label: string;
  zoom?: number;
  tool?: ImageEditorState['tool'];
  brushSize?: number;
  disabled?: boolean;
  onStroke?: (points: Array<{ x: number; y: number }>) => void;
}

function paintCheckerboard(context: CanvasRenderingContext2D, width: number, height: number): void {
  const cell = Math.max(8, Math.round(Math.min(width, height) / 20));
  context.fillStyle = '#f5f6f8';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#dfe3e8';
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      if ((x / cell + y / cell) % 2 === 0) context.fillRect(x, y, cell, cell);
    }
  }
}

export function ImageCanvas({ pixels, label, zoom = 1, tool = 'pan', brushSize = 24, disabled, onStroke }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stroke, setStroke] = useState<Array<{ x: number; y: number }>>([]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    paintCheckerboard(context, pixels.width, pixels.height);
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  }, [pixels]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width - 1, Math.round((event.clientX - rect.left) * canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.round((event.clientY - rect.top) * canvas.height / rect.height))),
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || tool === 'pan' || !pixels || !onStroke) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setStroke([pointFromEvent(event)]);
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || tool === 'pan') return;
    const point = pointFromEvent(event);
    setStroke((current) => {
      const previous = current.at(-1);
      if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < Math.max(2, brushSize / 6)) return current;
      return [...current, point];
    });
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (stroke.length > 0) onStroke?.(stroke);
    setStroke([]);
  };

  return (
    <div className="canvas-shell" aria-label={label}>
      {pixels ? (
        <canvas
          ref={canvasRef}
          className={tool === 'pan' ? 'image-canvas' : 'image-canvas is-brushing'}
          style={{ width: `${Math.max(100, zoom * 100)}%` }}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          aria-label={label}
        />
      ) : (
        <div className="canvas-empty">画像を選択すると、ここに表示されます。</div>
      )}
    </div>
  );
}
