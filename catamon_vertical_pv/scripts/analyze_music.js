#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'pv_config.yaml');
const SAMPLE_RATE = 4000;
const FRAME_SECONDS = 0.02;

function findExecutable(name) {
  const envName = `${name.toUpperCase()}_PATH`;
  if (process.env[envName] && fs.existsSync(process.env[envName])) return process.env[envName];
  const where = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0) {
    const hit = where.stdout.split(/\r?\n/).find(Boolean);
    if (hit && fs.existsSync(hit.trim())) return hit.trim();
  }
  const packages = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  const pending = fs.existsSync(packages) ? [packages] : [];
  while (pending.length) {
    const dir = pending.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === `${name}.exe`) return full;
      if (entry.isDirectory() && full.split(path.sep).length - packages.split(path.sep).length <= 7) pending.push(full);
    }
  }
  throw new Error(`${name} が見つかりません。`);
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    throw new Error(`${path.basename(executable)} failed (${result.status}): ${stderr.slice(-6000)}`);
  }
  return result;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
}

function average(values, start, end) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(values.length, Math.ceil(end));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i];
  return sum / (to - from);
}

function framesInRange(values, startSeconds, endSeconds) {
  return average(values, startSeconds / FRAME_SECONDS, endSeconds / FRAME_SECONDS);
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function findPeaks(values, minDistanceFrames, minimum, limit) {
  const candidates = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] >= minimum && values[i] >= values[i - 1] && values[i] > values[i + 1]) {
      candidates.push({ index: i, value: values[i] });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every((item) => Math.abs(item.index - candidate.index) >= minDistanceFrames)) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.sort((a, b) => a.index - b.index);
}

function estimateBpm(onsets) {
  const minBpm = 72;
  const maxBpm = 180;
  const minLag = Math.floor(60 / maxBpm / FRAME_SECONDS);
  const maxLag = Math.ceil(60 / minBpm / FRAME_SECONDS);
  let best = { lag: 0, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = lag; i < onsets.length; i += 1) score += onsets[i] * onsets[i - lag];
    score /= Math.max(1, onsets.length - lag);
    if (score > best.score) best = { lag, score };
  }
  return best.lag ? 60 / (best.lag * FRAME_SECONDS) : 0;
}

function scoreWindow(energy, onsets, start, duration) {
  const e = (a, b) => framesInRange(energy, start + a, start + b);
  const o = (a, b) => framesInRange(onsets, start + a, start + b);
  const hook = e(0, 3) * 1.25 + o(0, 3) * 0.8;
  const gameplay = e(10, 25) * 0.9 + o(10, 25) * 0.35;
  const characterRun = e(25, 42) * 1.1 + o(25, 42) * 0.55;
  const climax = e(42, 52) * 2.15 + o(42, 52) * 1.2;
  const close = e(52, duration) * 0.45;
  const build = Math.max(0, e(38, 52) - e(10, 24)) * 0.9;
  return hook + gameplay + characterRun + climax + close + build;
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
  const source = path.resolve(ROOT, config.audio.bgm);
  if (!fs.existsSync(source)) throw new Error(`BGMがありません: ${source}`);
  const ffmpeg = findExecutable('ffmpeg');
  const ffprobe = findExecutable('ffprobe');
  const probe = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', '--', source], { encoding: 'utf8' });
  const metadata = JSON.parse(probe.stdout);
  const duration = Number(metadata.format.duration);
  const pcmResult = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { encoding: null });
  const pcm = pcmResult.stdout;
  const frameSamples = Math.max(1, Math.round(SAMPLE_RATE * FRAME_SECONDS));
  const rms = [];
  for (let offset = 0; offset + frameSamples * 4 <= pcm.length; offset += frameSamples * 4) {
    let sum = 0;
    for (let j = 0; j < frameSamples; j += 1) {
      const value = pcm.readFloatLE(offset + j * 4);
      if (Number.isFinite(value)) sum += value * value;
    }
    rms.push(Math.sqrt(sum / frameSamples));
  }
  const db = rms.map((value) => 20 * Math.log10(Math.max(value, 1e-8)));
  const low = percentile(db, 0.08);
  const high = percentile(db, 0.95);
  const energy = db.map((value) => Math.max(0, Math.min(1, (value - low) / Math.max(1e-6, high - low))));
  const baselineFrames = Math.round(0.34 / FRAME_SECONDS);
  const onsets = energy.map((value, index) => {
    const baseline = average(energy, index - baselineFrames, index);
    return Math.max(0, value - baseline);
  });
  const onsetThreshold = percentile(onsets, 0.88);
  const beatPeaks = findPeaks(onsets, Math.round(0.22 / FRAME_SECONDS), onsetThreshold, 300);
  const bpm = estimateBpm(onsets);
  const strongMoments = findPeaks(energy.map((value, index) => value + onsets[index] * 1.6), Math.round(1.0 / FRAME_SECONDS), 0.72, 24)
    .map((item) => ({ time: round(item.index * FRAME_SECONDS), strength: round(item.value) }));
  const transitions = [];
  for (let second = 2; second < duration - 2; second += 0.25) {
    const before = framesInRange(energy, second - 2, second);
    const after = framesInRange(energy, second, second + 2);
    transitions.push({ time: second, lift: after - before });
  }
  transitions.sort((a, b) => b.lift - a.lift);
  const sectionLifts = [];
  for (const item of transitions) {
    if (sectionLifts.every((selected) => Math.abs(selected.time - item.time) >= 4)) sectionLifts.push(item);
    if (sectionLifts.length >= 8) break;
  }
  sectionLifts.sort((a, b) => a.time - b.time);
  const pvDuration = Number(config.project.duration_seconds);
  let bestWindow = { start: 0, score: -Infinity };
  for (let start = 0; start <= Math.max(0, duration - pvDuration); start += 0.1) {
    const score = scoreWindow(energy, onsets, start, pvDuration);
    if (score > bestWindow.score) bestWindow = { start, score };
  }
  const beatInterval = bpm ? 60 / bpm : 0.5;
  const beatTimes = beatPeaks.map((item) => item.index * FRAME_SECONDS);
  const nearbyBeat = (target) => {
    const absolute = bestWindow.start + target;
    let closest = absolute;
    let distance = Infinity;
    for (const time of beatTimes) {
      const delta = Math.abs(time - absolute);
      if (delta < distance) { distance = delta; closest = time; }
    }
    return round(closest - bestWindow.start);
  };
  const report = {
    source: config.audio.bgm,
    duration_seconds: round(duration),
    codec: metadata.streams?.[0]?.codec_name || null,
    sample_rate: metadata.streams?.[0]?.sample_rate || null,
    channels: metadata.streams?.[0]?.channels || null,
    analysis: {
      frame_seconds: FRAME_SECONDS,
      estimated_bpm: round(bpm, 2),
      estimated_beat_interval_seconds: round(beatInterval),
      loudness_floor_db: round(low),
      loudness_reference_db: round(high),
      strongest_moments: strongMoments,
      major_energy_lifts: sectionLifts.map((item) => ({ time: round(item.time), lift: round(item.lift) }))
    },
    recommended_pv_window: {
      start_seconds: round(bestWindow.start, 1),
      end_seconds: round(bestWindow.start + pvDuration, 1),
      score: round(bestWindow.score),
      beat_aligned_scene_boundaries: [0, 3, 10, 25, 42, 52, pvDuration].map(nearbyBeat)
    },
    note: 'BPMと強拍はPCM包絡線からの推定。最終タイムラインは映像の可読性を優先し、近傍の強拍へ手動整列する。'
  };
  const reports = path.join(ROOT, 'reports');
  const temp = path.join(ROOT, 'temp');
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  fs.writeFileSync(path.join(reports, 'bgm_structure_analysis.json'), JSON.stringify(report, null, 2), 'utf8');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1600x420:colors=61E8FF', '-frames:v', '1', path.join(temp, 'bgm_waveform.png')], { encoding: 'utf8' });
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
