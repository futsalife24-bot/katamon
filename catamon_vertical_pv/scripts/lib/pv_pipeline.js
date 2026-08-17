'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'pv_config.yaml');
const LOG_PATH = path.join(ROOT, 'logs', 'build.log');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendLog(line) {
  ensureDir(path.dirname(LOG_PATH));
  fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

function quoteForLog(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function run(executable, args, options = {}) {
  appendLog(`RUN ${quoteForLog(executable)} ${args.map(quoteForLog).join(' ')}`);
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.error) {
    appendLog(`ERROR ${result.error.message}`);
    if (!options.allowFailure) throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || '').slice(-12000);
    appendLog(`FAILED status=${result.status}\n${detail}`);
    throw new Error(`Command failed (${result.status}): ${path.basename(executable)}\n${detail}`);
  }
  if (result.status !== 0) appendLog(`NONZERO status=${result.status}`);
  return result;
}

function walkFind(root, filename, maxDepth = 6, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const direct = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase());
  if (direct) return path.join(root, direct.name);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = walkFind(path.join(root, entry.name), filename, maxDepth, depth + 1);
    if (found) return found;
  }
  return null;
}

function discoverTool(name) {
  const envName = `${name.toUpperCase()}_PATH`;
  if (process.env[envName] && fs.existsSync(process.env[envName])) return process.env[envName];
  const where = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0) {
    const first = where.stdout.split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first.trim())) return first.trim();
  }
  const packages = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(packages)) {
    const preferred = fs.readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(Gyan\.FFmpeg|yt-dlp\.FFmpeg)_/i.test(entry.name))
      .map((entry) => path.join(packages, entry.name));
    for (const dir of preferred) {
      const found = walkFind(dir, `${name}.exe`);
      if (found) return found;
    }
  }
  throw new Error(`${name} が見つかりません。winget install --id Gyan.FFmpeg -e を実行してください。`);
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`pv_config.yaml はJSON互換YAMLとして保存してください: ${error.message}`);
  }
}

function resolveProject(relativePath) {
  return path.resolve(ROOT, relativePath);
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function seconds(value) {
  return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeFilterPath(file) {
  return file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function escapeDrawText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function validateConfig(config) {
  const problems = [];
  let cursor = 0;
  for (const scene of config.scenes) {
    if (Math.abs(Number(scene.start) - cursor) > 0.001) {
      problems.push(`${scene.id}: start=${scene.start}, expected=${cursor}`);
    }
    cursor += Number(scene.duration);
    for (const file of [scene.background, ...(scene.overlays || []).map((item) => item.file)]) {
      if (!fs.existsSync(resolveProject(file))) problems.push(`${scene.id}: missing ${file}`);
    }
  }
  if (Math.abs(cursor - Number(config.project.duration_seconds)) > 0.001) {
    problems.push(`scene total=${cursor}, project duration=${config.project.duration_seconds}`);
  }
  if (!fs.existsSync(resolveProject(config.audio.bgm))) problems.push(`missing BGM ${config.audio.bgm}`);
  if (!fs.existsSync(config.font.file)) problems.push(`missing font ${config.font.file}`);
  if (problems.length) throw new Error(`設定検証に失敗しました:\n- ${problems.join('\n- ')}`);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() && entry.name !== '.gitkeep' ? [full] : [];
  });
}

function probeFile(ffprobe, file) {
  const result = run(ffprobe, [
    '-v', 'error', '-show_entries',
    'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
    '-of', 'json', '--', file
  ], { allowFailure: true });
  if (result.status !== 0) return { error: (result.stderr || '').trim() };
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { error: error.message };
  }
}

function scanAssets(config, ffprobe) {
  const inputRoot = path.join(ROOT, 'input');
  const inventory = listFiles(inputRoot).sort().map((file) => {
    const stat = fs.statSync(file);
    const probe = probeFile(ffprobe, file);
    const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
    const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
    return {
      file: rel(file),
      category: rel(path.dirname(file)).replace(/^input\//, ''),
      extension: path.extname(file).toLowerCase(),
      bytes: stat.size,
      duration_seconds: probe.format?.duration ? Number(probe.format.duration) : null,
      width: video?.width || null,
      height: video?.height || null,
      fps: video?.r_frame_rate || null,
      video_codec: video?.codec_name || null,
      audio_codec: audio?.codec_name || null,
      sample_rate: audio?.sample_rate || null,
      channels: audio?.channels || null,
      probe_error: probe.error || null
    };
  });
  ensureDir(path.join(ROOT, 'reports'));
  fs.writeFileSync(path.join(ROOT, 'reports', 'asset_inventory.json'), JSON.stringify(inventory, null, 2), 'utf8');
  const headers = Object.keys(inventory[0] || { file: '', category: '' });
  const rows = [headers.join(','), ...inventory.map((item) => headers.map((header) => csvCell(item[header])).join(','))];
  fs.writeFileSync(path.join(ROOT, 'reports', 'asset_inventory.csv'), `${rows.join('\n')}\n`, 'utf8');

  const gameplay = inventory.filter((item) => item.category === 'gameplay' && VIDEO_EXTENSIONS.has(item.extension));
  const suppliedSfx = inventory.filter((item) => item.category === 'sound_effects' && AUDIO_EXTENSIONS.has(item.extension));
  const categories = Object.fromEntries([...new Set(inventory.map((item) => item.category))]
    .map((category) => [category, inventory.filter((item) => item.category === category).length]));
  const missing = [
    '# 不足素材・代替処理レポート',
    '',
    `生成日時: ${new Date().toLocaleString('ja-JP')}`,
    '',
    '## 判定',
    '',
    `- 実プレイ動画: ${gameplay.length ? `${gameplay.length}本あり` : '不足'}`,
    `- 提供効果音: ${suppliedSfx.length ? `${suppliedSfx.length}本あり` : '不足'}`,
    `- キャラクター画像: ${categories.characters || 0}点`,
    `- 背景画像: ${categories.backgrounds || 0}点`,
    `- ロゴ: ${categories.logo || 0}点`,
    `- BGM: ${categories.music || 0}点`,
    '',
    '## 今回の安全な代替',
    '',
    '- 実プレイ動画が無いため、既存の正規背景・キャラクター・ロゴを使った演出再構成版とした。発射、弾道、着弾は実装済み砲撃要素の抽象演出であり、ゲーム画面録画ではない。',
    '- 効果音はFFmpegで合成した権利フリーの仮音。`input/sound_effects/` に提供音源を置き、設定・スクリプトを更新すれば差し替え可能。',
    '- 公式SNS名とゲームURLは未提供。設定内プレースホルダーを保持し、動画には表示していない。',
    '- 素材の権利状態はユーザー提供物として扱い、制作側では外部取得・権利断定をしていない。',
    '',
    '## 推奨追加素材',
    '',
    '- 1080p以上、30fps以上の実プレイ録画（移動、照準、発射、弾道、着弾、必殺技、勝利）',
    '- 発射・着弾・爆発・UI決定の正式効果音',
    '- 公式SNS名とゲームURL（公開する場合のみ）',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'reports', 'missing_materials.md'), missing, 'utf8');
  return inventory;
}

function writeUsageReport(config) {
  const rows = [['scene_id', 'start_seconds', 'end_seconds', 'duration_seconds', 'transition', 'background', 'overlays', 'texts']];
  for (const scene of config.scenes) {
    rows.push([
      scene.id,
      scene.start,
      Number(scene.start) + Number(scene.duration),
      scene.duration,
      scene.transition || config.video.default_transition,
      scene.background,
      (scene.overlays || []).map((item) => item.file).join(' | '),
      (scene.texts || []).map((item) => item.text).join(' | ')
    ]);
  }
  fs.writeFileSync(
    path.join(ROOT, 'reports', 'used_assets_timeline.csv'),
    `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
    'utf8'
  );
}

function writeStoryboard(config) {
  const lines = [
    '# カタモン縦型PV 絵コンテ',
    '',
    `尺: ${config.project.duration_seconds}秒 / 9:16 / ${config.video.fps}fps`,
    '',
    '| 時間 | シーン | 映像 | テロップ | 音 |',
    '|---:|---|---|---|---|'
  ];
  for (const scene of config.scenes) {
    const end = Number(scene.start) + Number(scene.duration);
    const visual = [path.basename(scene.background), ...(scene.overlays || []).map((item) => path.basename(item.file))].join(' + ');
    const text = (scene.texts || []).map((item) => item.text).join(' / ');
    const sounds = config.sfx_events.filter((event) => event.time >= scene.start && event.time < end).map((event) => event.type).join(', ') || 'BGM';
    lines.push(`| ${seconds(scene.start)}–${seconds(end)} | ${scene.id} | ${visual} | ${text} | ${sounds} |`);
  }
  lines.push('', '> 実プレイ録画未提供のため、今回の砲撃場面は正規素材による演出再構成。', '');
  fs.writeFileSync(path.join(ROOT, 'reports', 'storyboard.md'), lines.join('\n'), 'utf8');
}

function generatePlaceholderSfx(ffmpeg) {
  const dir = path.join(ROOT, 'temp', 'generated_sfx');
  ensureDir(dir);
  const recipes = {
    shot: ['sine=frequency=180:sample_rate=48000:duration=0.34', 'volume=0.9,lowpass=f=1500,afade=t=out:st=0.02:d=0.32'],
    impact: ['anoisesrc=color=pink:sample_rate=48000:duration=0.56', 'volume=0.75,lowpass=f=1100,afade=t=out:st=0.03:d=0.53'],
    ui: ['sine=frequency=920:sample_rate=48000:duration=0.13', 'volume=0.45,afade=t=out:st=0.03:d=0.1'],
    victory: ['sine=frequency=660:sample_rate=48000:duration=0.72', 'volume=0.42,tremolo=f=7:d=0.35,afade=t=out:st=0.38:d=0.34']
  };
  for (const [name, [source, filters]] of Object.entries(recipes)) {
    const target = path.join(dir, `${name}.wav`);
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-af', filters, '-ar', '48000', '-ac', '2', target]);
  }
}

function renderScene(ffmpeg, config, scene, modeName, mode, index) {
  const width = mode.width;
  const height = mode.height;
  const fps = mode.fps;
  const duration = Number(scene.duration);
  const out = path.join(ROOT, 'temp', 'scenes', `${modeName}_${String(index).padStart(2, '0')}_${scene.id}.mp4`);
  ensureDir(path.dirname(out));
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const background = resolveProject(scene.background);
  const backgroundIsVideo = VIDEO_EXTENSIONS.has(path.extname(background).toLowerCase());
  if (backgroundIsVideo) {
    args.push('-stream_loop', '-1', '-i', background);
  } else {
    args.push('-loop', '1', '-framerate', String(fps), '-t', seconds(duration), '-i', background);
  }
  const inputIndexes = [];
  for (const overlay of scene.overlays || []) {
    const file = resolveProject(overlay.file);
    const indexValue = inputIndexes.length + 1;
    inputIndexes.push(indexValue);
    args.push('-loop', '1', '-framerate', String(fps), '-t', seconds(duration), '-i', file);
  }
  let projectileInput = null;
  if (scene.projectile) {
    projectileInput = inputIndexes.length + 1;
    const size = Math.max(24, Math.round(width * 0.045));
    args.push('-f', 'lavfi', '-i', `color=c=black@0.0:s=${size}x${size}:r=${fps}:d=${seconds(duration)}`);
  }

  const filters = [];
  const focusX = scene.focus_x == null ? 0.5 : Number(scene.focus_x);
  const focusY = scene.focus_y == null ? 0.5 : Number(scene.focus_y);
  if (backgroundIsVideo) {
    filters.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:x='(in_w-out_w)*${focusX}':y='(in_h-out_h)*${focusY}',fps=${fps},setsar=1[base0]`);
  } else {
    filters.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:x='(in_w-out_w)*${focusX}':y='(in_h-out_h)*${focusY}',zoompan=z='min(zoom+0.00035,1.055)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},setsar=1[base0]`);
  }
  let current = 'base0';
  (scene.overlays || []).forEach((overlay, overlayIndex) => {
    const inputIndex = inputIndexes[overlayIndex];
    const overlayWidth = Math.max(2, Math.round(Number(overlay.width) * width));
    const fadeOutStart = Math.max(0, duration - 0.22);
    filters.push(`[${inputIndex}:v]scale=${overlayWidth}:-2:flags=lanczos,format=rgba,fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=${seconds(fadeOutStart)}:d=0.22:alpha=1[ov${overlayIndex}]`);
    const x0 = Number(overlay.x0) * width;
    const x1 = Number(overlay.x1) * width;
    const y = Number(overlay.y) * height;
    const move = Math.max(0.05, Number(overlay.move_seconds || 0.6));
    const bob = Number(overlay.bob || 0) * height;
    const next = `base${overlayIndex + 1}`;
    filters.push(`[${current}][ov${overlayIndex}]overlay=x='${x0}+(${x1 - x0})*min(t/${move},1)':y='${y}+${bob}*sin(2*PI*t)':eof_action=pass:format=auto[${next}]`);
    current = next;
  });

  if (scene.projectile) {
    const p = scene.projectile;
    filters.push(`[${projectileInput}:v]format=rgba,geq=r='255':g='215':b='55':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/3,2)),255,0)',gblur=sigma=1.8[projectile]`);
    const progress = `((t-${Number(p.start)})/${Number(p.end) - Number(p.start)})`;
    const x = `${Number(p.x0) * width}+(${(Number(p.x1) - Number(p.x0)) * width})*${progress}`;
    const y = `${Number(p.y0) * height}+(${(Number(p.y1) - Number(p.y0)) * height})*${progress}-${Number(p.arc) * height}*4*${progress}*(1-${progress})`;
    filters.push(`[${current}][projectile]overlay=x='${x}':y='${y}':enable='between(t,${Number(p.start)},${Number(p.end)})':eof_action=pass[projected]`);
    current = 'projected';
  }

  (scene.flashes || []).forEach((flash, flashIndex) => {
    const next = `flash${flashIndex}`;
    filters.push(`[${current}]drawbox=x=0:y=0:w=iw:h=ih:color=white@0.72:t=fill:enable='between(t,${Number(flash)},${Number(flash) + 0.075})'[${next}]`);
    current = next;
  });

  const fontPath = escapeFilterPath(config.font.file);
  (scene.texts || []).forEach((item, textIndex) => {
    const next = `text${textIndex}`;
    const size = Math.max(18, Math.round(Number(item.size) * width));
    const y = Math.round(Number(item.y) * height);
    const start = Number(item.start == null ? 0 : item.start);
    const end = Number(item.end == null ? duration : item.end);
    const border = Math.max(2, Math.round(width / 180));
    const shadow = Math.max(2, Math.round(width / 270));
    filters.push(`[${current}]drawtext=fontfile='${fontPath}':text='${escapeDrawText(item.text)}':expansion=none:fontsize=${size}:fontcolor=${item.color || config.font.default_color}:bordercolor=${config.font.outline_color}:borderw=${border}:shadowcolor=black@0.65:shadowx=${shadow}:shadowy=${shadow}:x='(w-text_w)/2':y=${y}:enable='between(t,${start},${end})'[${next}]`);
    current = next;
  });

  filters.push(`[${current}]scale=in_range=pc:out_range=tv,format=yuv420p[delivery]`);
  current = 'delivery';

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${current}]`,
    '-an', '-t', seconds(duration), '-r', String(fps),
    '-c:v', 'libx264', '-preset', mode.preset, '-crf', String(mode.crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out
  );
  run(ffmpeg, args);
  return out;
}

function concatScenes(ffmpeg, clips, modeName) {
  const listFile = path.join(ROOT, 'temp', `${modeName}_concat.txt`);
  const content = clips.map((clip) => `file '${clip.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listFile, `${content}\n`, 'utf8');
  const out = path.join(ROOT, 'temp', `${modeName}_video.mp4`);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out]);
  return out;
}

function buildAudio(ffmpeg, config, mode) {
  const duration = Number(config.project.duration_seconds);
  const audioOut = path.join(ROOT, 'temp', `audio_${mode.audio_bitrate.replace(/\W/g, '')}.m4a`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-ss', seconds(config.audio.bgm_start_seconds), '-i', resolveProject(config.audio.bgm)];
  const sfxDir = path.join(ROOT, 'temp', 'generated_sfx');
  config.sfx_events.forEach((event) => {
    const configured = config.audio.sfx_sources?.[event.type];
    const source = configured && configured !== '__GENERATED__'
      ? resolveProject(configured)
      : path.join(sfxDir, `${event.type}.wav`);
    if (!fs.existsSync(source)) throw new Error(`効果音がありません: ${source}`);
    args.push('-i', source);
  });
  const filters = [];
  filters.push(`[0:a]atrim=0:${seconds(duration)},asetpts=PTS-STARTPTS,volume=${Number(config.audio.bgm_volume)},afade=t=in:st=0:d=0.12,afade=t=out:st=${seconds(duration - 0.65)}:d=0.65,aformat=sample_fmts=fltp:channel_layouts=stereo[bgm]`);
  const labels = ['[bgm]'];
  config.sfx_events.forEach((event, index) => {
    const label = `sfx${index}`;
    const delay = Math.max(0, Math.round(Number(event.time) * 1000));
    filters.push(`[${index + 1}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${Number(event.volume)},adelay=${delay}|${delay}[${label}]`);
    labels.push(`[${label}]`);
  });
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,atrim=0:${seconds(duration)},loudnorm=I=${Number(config.audio.target_lufs)}:LRA=9:TP=${Number(config.audio.true_peak_db)},alimiter=limit=0.84,volume=0.87,aresample=${Number(config.audio.sample_rate)}[mix]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'aac', '-b:a', mode.audio_bitrate, '-ar', String(config.audio.sample_rate), audioOut);
  run(ffmpeg, args);
  return audioOut;
}

function muxOutput(ffmpeg, video, audio, config, mode) {
  const target = resolveProject(mode.path);
  ensureDir(path.dirname(target));
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy',
    '-t', seconds(config.project.duration_seconds), '-movflags', '+faststart', target
  ]);
  return target;
}

function analyzeMusic(ffmpeg, config) {
  const duration = Number(config.project.duration_seconds);
  const result = run(ffmpeg, [
    '-hide_banner', '-nostats', '-loglevel', 'verbose', '-t', seconds(duration),
    '-ss', seconds(config.audio.bgm_start_seconds), '-i', resolveProject(config.audio.bgm),
    '-filter_complex', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'
  ], { allowFailure: true });
  const samples = [];
  const regex = /t:\s*([0-9.]+).*?M:\s*(-?[0-9.]+)/g;
  let match;
  while ((match = regex.exec(result.stderr || ''))) {
    const time = Number(match[1]);
    const momentaryLufs = Number(match[2]);
    if (Number.isFinite(time) && Number.isFinite(momentaryLufs)) samples.push({ time, momentary_lufs: momentaryLufs });
  }
  const strongest = [];
  for (const candidate of [...samples].sort((a, b) => b.momentary_lufs - a.momentary_lufs)) {
    if (strongest.every((item) => Math.abs(item.time - candidate.time) >= 1.0)) strongest.push(candidate);
    if (strongest.length === 12) break;
  }
  strongest.sort((a, b) => a.time - b.time);
  const report = {
    source: config.audio.bgm,
    analyzed_from_seconds: config.audio.bgm_start_seconds,
    analyzed_duration_seconds: duration,
    method: 'FFmpeg ebur128 momentary loudness peaks; scene cuts are manually aligned to the configured climax grid',
    strongest_moments: strongest
  };
  fs.writeFileSync(path.join(ROOT, 'reports', 'bgm_analysis.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

function parseRate(rate) {
  if (!rate) return 0;
  const [a, b = '1'] = String(rate).split('/');
  return Number(a) / Number(b);
}

function qaVideo(ffmpeg, ffprobe, config, modeName, target) {
  const probeResult = run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '--', target]);
  const probe = JSON.parse(probeResult.stdout);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const expected = config.outputs[modeName];
  const black = run(ffmpeg, ['-hide_banner', '-nostats', '-i', target, '-vf', 'blackdetect=d=0.25:pic_th=0.98:pix_th=0.02', '-an', '-f', 'null', '-'], { allowFailure: true });
  const silence = run(ffmpeg, ['-hide_banner', '-nostats', '-i', target, '-vn', '-af', 'silencedetect=n=-45dB:d=0.4', '-f', 'null', '-'], { allowFailure: true });
  const volume = run(ffmpeg, ['-hide_banner', '-nostats', '-i', target, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { allowFailure: true });
  const blackEvents = [...(black.stderr || '').matchAll(/black_start:([0-9.]+).*?black_end:([0-9.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const silenceEvents = [...(silence.stderr || '').matchAll(/silence_start:\s*([0-9.]+).*?silence_end:\s*([0-9.]+)/gs)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const maxVolumeMatch = (volume.stderr || '').match(/max_volume:\s*(-?[0-9.]+) dB/);
  const meanVolumeMatch = (volume.stderr || '').match(/mean_volume:\s*(-?[0-9.]+) dB/);
  const maxVolume = maxVolumeMatch ? Number(maxVolumeMatch[1]) : null;
  const checks = [
    ['duration', Math.abs(duration - Number(config.project.duration_seconds)) <= 0.2, `${duration.toFixed(3)} sec`],
    ['resolution', video?.width === expected.width && video?.height === expected.height, `${video?.width}x${video?.height}`],
    ['fps', Math.abs(parseRate(video?.avg_frame_rate || video?.r_frame_rate) - expected.fps) < 0.01, String(parseRate(video?.avg_frame_rate || video?.r_frame_rate))],
    ['video_codec', video?.codec_name === 'h264', video?.codec_name || 'missing'],
    ['audio_codec', audio?.codec_name === 'aac', audio?.codec_name || 'missing'],
    ['pixel_format', video?.pix_fmt === 'yuv420p', video?.pix_fmt || 'missing'],
    ['black_frames', blackEvents.length === 0, JSON.stringify(blackEvents)],
    ['long_silence', silenceEvents.length === 0, JSON.stringify(silenceEvents)],
    ['peak_below_minus_0_8_db', maxVolume == null || maxVolume <= -0.8, maxVolume == null ? 'unavailable' : `${maxVolume} dB`]
  ];
  const contact = path.join(ROOT, 'temp', `${modeName}_qa_contact_sheet.png`);
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', target,
    '-vf', 'fps=1/7,scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2,tile=4x2',
    '-frames:v', '1', contact
  ]);
  const sceneContact = path.join(ROOT, 'temp', `${modeName}_scene_contact_sheet.png`);
  const midpointFrames = config.scenes.map((scene) => Math.round((Number(scene.start) + Number(scene.duration) * 0.55) * expected.fps));
  const selectExpression = midpointFrames.map((frame) => `eq(n\\,${frame})`).join('+');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', target,
    '-vf', `select='${selectExpression}',scale=216:384:force_original_aspect_ratio=decrease,pad=216:384:(ow-iw)/2:(oh-ih)/2,tile=5x3`,
    '-vsync', 'vfr', '-frames:v', '1', sceneContact
  ]);
  const lines = [
    `# QAレポート（${modeName}）`,
    '',
    `対象: \`${rel(target)}\``,
    '',
    '| 検査 | 結果 | 実測 |',
    '|---|---|---|',
    ...checks.map(([name, ok, measured]) => `| ${name} | ${ok ? 'PASS' : 'WARN'} | ${String(measured).replace(/\|/g, '\\|')} |`),
    '',
    `- 平均音量: ${meanVolumeMatch ? `${meanVolumeMatch[1]} dB` : '取得不能'}`,
    `- 最大音量: ${maxVolumeMatch ? `${maxVolumeMatch[1]} dB` : '取得不能'}`,
    `- コンタクトシート: \`${rel(contact)}\``,
    `- 全シーン中央フレーム: \`${rel(sceneContact)}\``,
    '- テロップは設定上すべて縦画面セーフエリア内。自動検査は画面意味を完全には判定できないため、コンタクトシートの目視確認も併用する。',
    ''
  ];
  const report = path.join(ROOT, 'reports', `qa_report_${modeName}.md`);
  fs.writeFileSync(report, lines.join('\n'), 'utf8');
  return { checks, report, contact, sceneContact, probe, blackEvents, silenceEvents, maxVolume };
}

function generateThumbnail(ffmpeg, config, finalPath) {
  const target = resolveProject(config.outputs.final.thumbnail);
  ensureDir(path.dirname(target));
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '50.2', '-i', finalPath,
    '-frames:v', '1', '-vf', 'scale=1080:1920:flags=lanczos', target
  ]);
  return target;
}

async function scanOnly() {
  fs.writeFileSync(LOG_PATH, '', 'utf8');
  const config = loadConfig();
  validateConfig(config);
  const ffprobe = discoverTool('ffprobe');
  const inventory = scanAssets(config, ffprobe);
  writeStoryboard(config);
  writeUsageReport(config);
  console.log(`素材 ${inventory.length}点を一覧化しました。`);
}

async function qaOnly(modeName = 'final') {
  const config = loadConfig();
  if (!config.outputs[modeName]) throw new Error(`不明な出力モード: ${modeName}`);
  const ffmpeg = discoverTool('ffmpeg');
  const ffprobe = discoverTool('ffprobe');
  const target = resolveProject(config.outputs[modeName].path);
  if (!fs.existsSync(target)) throw new Error(`動画がありません: ${target}`);
  const qa = qaVideo(ffmpeg, ffprobe, config, modeName, target);
  console.log(`QA完了: ${rel(qa.report)}`);
}

async function build(modeName) {
  fs.writeFileSync(LOG_PATH, '', 'utf8');
  const started = Date.now();
  const config = loadConfig();
  validateConfig(config);
  const mode = config.outputs[modeName];
  if (!mode) throw new Error(`不明な出力モード: ${modeName}`);
  const ffmpeg = discoverTool('ffmpeg');
  const ffprobe = discoverTool('ffprobe');
  appendLog(`TOOLS ffmpeg=${ffmpeg} ffprobe=${ffprobe}`);
  scanAssets(config, ffprobe);
  writeStoryboard(config);
  writeUsageReport(config);
  generatePlaceholderSfx(ffmpeg);
  analyzeMusic(ffmpeg, config);
  const clips = config.scenes.map((scene, index) => {
    process.stdout.write(`[${index + 1}/${config.scenes.length}] ${scene.id}\n`);
    return renderScene(ffmpeg, config, scene, modeName, mode, index);
  });
  const video = concatScenes(ffmpeg, clips, modeName);
  const audio = buildAudio(ffmpeg, config, mode);
  const output = muxOutput(ffmpeg, video, audio, config, mode);
  if (modeName === 'final') generateThumbnail(ffmpeg, config, output);
  const qa = qaVideo(ffmpeg, ffprobe, config, modeName, output);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  appendLog(`DONE mode=${modeName} output=${output} elapsed=${elapsed}s`);
  console.log(`完成: ${rel(output)} (${elapsed}秒)`);
  console.log(`QA: ${rel(qa.report)}`);
}

module.exports = { build, scanOnly, qaOnly };
