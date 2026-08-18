import type { BackgroundAnalysis, PixelBuffer } from './types';
import { assertPixelBuffer } from './types';

export type Rgba = [number, number, number, number];

interface SamplePoint {
  x: number;
  y: number;
  rgba: Rgba;
}

function rgbaAt(image: PixelBuffer, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

export function rgbDistance(left: Rgba, right: Rgba): number {
  const red = left[0] - right[0];
  const green = left[1] - right[1];
  const blue = left[2] - right[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

function luminance(color: Rgba): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function chroma(color: Rgba): number {
  return Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
}

function borderSamples(image: PixelBuffer, target = 4096): SamplePoint[] {
  const perimeter = Math.max(1, (image.width + image.height) * 2 - 4);
  const stride = Math.max(1, Math.floor(perimeter / target));
  const samples: SamplePoint[] = [];
  let sequence = 0;
  const add = (x: number, y: number) => {
    if (sequence % stride === 0) samples.push({ x, y, rgba: rgbaAt(image, x, y) });
    sequence += 1;
  };
  for (let x = 0; x < image.width; x += 1) add(x, 0);
  for (let y = 1; y < image.height; y += 1) add(image.width - 1, y);
  if (image.height > 1) for (let x = image.width - 2; x >= 0; x -= 1) add(x, image.height - 1);
  if (image.width > 1) for (let y = image.height - 2; y > 0; y -= 1) add(0, y);
  return samples;
}

function quantizedKey(color: Rgba, step = 16): string {
  return `${Math.round(color[0] / step)},${Math.round(color[1] / step)},${Math.round(color[2] / step)}`;
}

export function estimateBorderPalette(image: PixelBuffer, maximumColors = 8): Rgba[] {
  assertPixelBuffer(image);
  const bins = new Map<string, { count: number; red: number; green: number; blue: number; alpha: number }>();
  for (const { rgba } of borderSamples(image)) {
    if (rgba[3] < 8) continue;
    const key = quantizedKey(rgba);
    const current = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0, alpha: 0 };
    current.count += 1;
    current.red += rgba[0];
    current.green += rgba[1];
    current.blue += rgba[2];
    current.alpha += rgba[3];
    bins.set(key, current);
  }
  return [...bins.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, maximumColors)
    .map((entry) => [
      Math.round(entry.red / entry.count),
      Math.round(entry.green / entry.count),
      Math.round(entry.blue / entry.count),
      Math.round(entry.alpha / entry.count),
    ]);
}

function detectCheckerboard(image: PixelBuffer): boolean {
  if (image.width < 12 || image.height < 12) return false;
  const grid = 48;
  const values: Array<{ gx: number; gy: number; level: number; eligible: boolean }> = [];
  const levels = new Map<number, number>();
  let eligibleCount = 0;

  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      // The center can contain the character. Four broad corner areas carry the background signal.
      const corner = (gx < grid * 0.28 || gx >= grid * 0.72) && (gy < grid * 0.28 || gy >= grid * 0.72);
      if (!corner) continue;
      const x = Math.min(image.width - 1, Math.floor(((gx + 0.5) * image.width) / grid));
      const y = Math.min(image.height - 1, Math.floor(((gy + 0.5) * image.height) / grid));
      const rgba = rgbaAt(image, x, y);
      const eligible = rgba[3] > 245 && luminance(rgba) >= 185 && chroma(rgba) <= 18;
      const level = Math.round(luminance(rgba) / 6);
      values.push({ gx, gy, level, eligible });
      if (eligible) {
        eligibleCount += 1;
        levels.set(level, (levels.get(level) ?? 0) + 1);
      }
    }
  }
  if (values.length === 0 || eligibleCount / values.length < 0.82) return false;
  const top = [...levels.entries()].sort((left, right) => right[1] - left[1]).slice(0, 2);
  if (top.length < 2) return false;
  const [first, second] = top;
  const represented = (first[1] + second[1]) / eligibleCount;
  const smallerShare = Math.min(first[1], second[1]) / eligibleCount;
  const levelGap = Math.abs(first[0] - second[0]);
  if (represented < 0.58 || smallerShare < 0.16 || levelGap < 1 || levelGap > 8) return false;

  const valueByCoordinate = new Map(values.map((value) => [`${value.gx}:${value.gy}`, value]));
  let comparable = 0;
  let transitions = 0;
  for (const value of values) {
    if (!value.eligible) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const neighbor = valueByCoordinate.get(`${value.gx + dx}:${value.gy + dy}`);
      if (!neighbor?.eligible) continue;
      const leftClass = Math.abs(value.level - first[0]) <= Math.abs(value.level - second[0]) ? 0 : 1;
      const rightClass = Math.abs(neighbor.level - first[0]) <= Math.abs(neighbor.level - second[0]) ? 0 : 1;
      comparable += 1;
      if (leftClass !== rightClass) transitions += 1;
    }
  }
  const transitionRatio = comparable === 0 ? 0 : transitions / comparable;
  // Large baked checker cells can produce only one transition every eight
  // samples on phone-sized preview buffers. Keep the lower bound permissive,
  // while the two-tone/brightness checks above continue to reject flat fields.
  // A source whose checker cell size is close to this sampling interval can
  // alternate on virtually every neighbouring sample. That is still a strong
  // checker signal (and occurs in exported JPEG previews), not noise.
  return transitionRatio >= 0.08;
}

export function analyzeBackground(image: PixelBuffer): BackgroundAnalysis {
  assertPixelBuffer(image);
  const pixelCount = image.width * image.height;
  const samplingStride = Math.max(1, Math.floor(pixelCount / 1_000_000));
  let sampled = 0;
  let alphaPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += samplingStride) {
    sampled += 1;
    if (image.data[pixel * 4 + 3] < 250) alphaPixels += 1;
  }
  const alphaPixelRatio = sampled === 0 ? 0 : alphaPixels / sampled;
  const border = borderSamples(image);
  const opaqueBorder = border.filter(({ rgba }) => rgba[3] >= 245);
  const palette = estimateBorderPalette(image, 4);
  const backgroundColor = palette[0] ?? null;
  let similar = 0;
  let black = 0;
  for (const { rgba } of opaqueBorder) {
    if (backgroundColor && rgbDistance(rgba, backgroundColor) <= 28) similar += 1;
    if (luminance(rgba) < 24 && chroma(rgba) < 18) black += 1;
  }
  const opaqueBorderCount = Math.max(1, opaqueBorder.length);
  const solidBackgroundConfidence = similar / opaqueBorderCount;
  const hasBakedCheckerboard = alphaPixelRatio < 0.001 && detectCheckerboard(image);
  const hasBakedBlackBackground = alphaPixelRatio < 0.001 && black / opaqueBorderCount >= 0.72;
  const warnings: string[] = [];
  if (hasBakedCheckerboard) warnings.push('市松模様が画像に焼き付いています。自動背景除去後に輪郭を確認してください。');
  if (hasBakedBlackBackground) warnings.push('黒い背景が画像に焼き付いている可能性があります。暗い輪郭を確認してください。');
  if (alphaPixelRatio > 0) warnings.push('透明部分を検出しました。');
  else warnings.push('透明部分は検出されませんでした。');

  return {
    hasAlpha: alphaPixelRatio > 0,
    alphaPixelRatio,
    isLikelySolidBackground: solidBackgroundConfidence >= 0.72,
    solidBackgroundConfidence,
    backgroundColor,
    hasBakedCheckerboard,
    hasBakedBlackBackground,
    warnings,
  };
}
