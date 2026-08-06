import { useEffect, useRef } from 'react';
import type { PreviewSettings, SpriteMetadata } from '../domain/types';
import type { EncodedIdleSpriteResult } from '../motion';
import type { PixelBuffer } from '../image';

interface MotionPreviewProps {
  sprite: EncodedIdleSpriteResult | null;
  fallback: PixelBuffer | null;
  settings: PreviewSettings;
  metadata?: SpriteMetadata | null;
  label?: string;
}

function checker(context: CanvasRenderingContext2D, width: number, height: number): void {
  const size = 16;
  context.fillStyle = '#edf0f4';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#cfd5dd';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((x / size + y / size) % 2 === 0) context.fillRect(x, y, size, size);
    }
  }
}

export function MotionPreview({ sprite, fallback, settings, metadata = sprite?.metadata, label = '待機モーションプレビュー' }: MotionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const active = sprite?.sheet.data.length ? sprite : null;
    const width = metadata?.frameWidth ?? fallback?.width ?? 256;
    const height = metadata?.frameHeight ?? fallback?.height ?? 256;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    let animation = 0;
    let lastFrame = -1;
    const frameCount = active?.metadata.frameCount ?? 1;
    const fps = active?.metadata.fps ?? 1;
    const sheetCanvas = document.createElement('canvas');
    const sheetContext = sheetCanvas.getContext('2d');
    if (active && sheetContext) {
      sheetCanvas.width = active.sheet.width;
      sheetCanvas.height = active.sheet.height;
      sheetContext.putImageData(new ImageData(new Uint8ClampedArray(active.sheet.data), active.sheet.width, active.sheet.height), 0, 0);
    }
    const fallbackCanvas = document.createElement('canvas');
    const fallbackContext = fallbackCanvas.getContext('2d');
    if (fallback && fallbackContext) {
      fallbackCanvas.width = fallback.width;
      fallbackCanvas.height = fallback.height;
      fallbackContext.putImageData(new ImageData(new Uint8ClampedArray(fallback.data), fallback.width, fallback.height), 0, 0);
    }

    const draw = (timestamp: number) => {
      const frame = settings.playing && document.visibilityState === 'visible'
        ? Math.floor(timestamp / (1000 / fps)) % frameCount
        : 0;
      if (frame !== lastFrame) {
        lastFrame = frame;
        context.clearRect(0, 0, width, height);
        if (settings.background === 'light') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
        } else if (settings.background === 'dark') {
          context.fillStyle = '#151922';
          context.fillRect(0, 0, width, height);
        } else {
          const gradient = context.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, '#87bad4');
          gradient.addColorStop(0.64, '#d8c58b');
          gradient.addColorStop(0.65, '#718b55');
          gradient.addColorStop(1, '#34462c');
          context.fillStyle = gradient;
          context.fillRect(0, 0, width, height);
        }
        context.save();
        if (settings.direction === 'left') {
          context.translate(width, 0);
          context.scale(-1, 1);
        }
        if (active) {
          context.drawImage(sheetCanvas, frame * width, 0, width, height, 0, 0, width, height);
        } else if (fallback) {
          context.drawImage(fallbackCanvas, 0, 0, fallback.width, fallback.height, 0, 0, width, height);
        }
        context.restore();
        if (settings.showAnchor && metadata) {
          context.strokeStyle = '#ff3b5c';
          context.lineWidth = Math.max(1, width / 180);
          const x = metadata.anchorX * width;
          const y = metadata.anchorY * height;
          context.beginPath();
          context.moveTo(x - 9, y);
          context.lineTo(x + 9, y);
          context.moveTo(x, y - 9);
          context.lineTo(x, y + 9);
          context.stroke();
        }
        if (settings.showCollision && metadata) {
          const box = metadata.collisionBounds;
          context.strokeStyle = '#21e6aa';
          context.setLineDash([6, 4]);
          context.lineWidth = Math.max(1, width / 180);
          context.strokeRect(box.x, box.y, box.width, box.height);
          context.setLineDash([]);
        }
      }
      if (settings.playing) animation = requestAnimationFrame(draw);
    };
    draw(0);
    return () => cancelAnimationFrame(animation);
  }, [fallback, metadata, settings.background, settings.direction, settings.playing, settings.showAnchor, settings.showCollision, sprite]);

  return (
    <div className={`motion-preview motion-preview--${settings.size}`}>
      <canvas ref={canvasRef} aria-label={label} />
    </div>
  );
}
