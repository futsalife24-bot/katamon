import { useEffect, useRef } from 'react';
import type { DetectedMotionPart } from '../domain/types';
import type { PixelBuffer } from '../image';

const COLORS: Record<DetectedMotionPart['role'], string> = {
  upper: '#8b5cf6',
  core: '#10b981',
  left: '#3b82f6',
  right: '#f59e0b',
  base: '#ef4444',
};

export function PartPreview({ source, parts, focusPartId, anchorPartId }: {
  source: PixelBuffer | null;
  parts: DetectedMotionPart[];
  focusPartId: string | null;
  anchorPartId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, source.width, source.height);
    context.putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
    context.font = `700 ${Math.max(12, source.width / 34)}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    for (const part of parts.filter(({ enabled }) => enabled)) {
      const { x, y, width, height } = part.bounds;
      const left = x * source.width;
      const top = y * source.height;
      const boxWidth = width * source.width;
      const boxHeight = height * source.height;
      const color = COLORS[part.role];
      context.strokeStyle = color;
      context.lineWidth = part.id === focusPartId || part.id === anchorPartId ? 5 : 3;
      context.setLineDash(part.id === anchorPartId ? [10, 6] : []);
      context.strokeRect(left, top, boxWidth, boxHeight);
      context.setLineDash([]);
      const suffix = part.id === focusPartId ? '・動作中心' : part.id === anchorPartId ? '・接地点' : '';
      const label = `${part.label}${suffix}`;
      const metrics = context.measureText(label);
      const labelTop = Math.max(0, top - Math.max(20, source.width / 24));
      context.fillStyle = 'rgba(8, 17, 22, .82)';
      context.fillRect(left, labelTop, metrics.width + 12, Math.max(20, source.width / 24));
      context.fillStyle = '#fff';
      context.fillText(label, left + 6, labelTop + 3);
    }
  }, [anchorPartId, focusPartId, parts, source]);

  return (
    <div className="part-preview" aria-label="部位候補プレビュー">
      {source ? <canvas ref={canvasRef} /> : <div className="canvas-empty">先に画像を切り抜いてください。</div>}
    </div>
  );
}
