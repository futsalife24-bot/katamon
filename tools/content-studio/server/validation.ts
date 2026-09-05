import { inflateSync } from 'node:zlib';
import { publishedRevisionSchema } from '../src/domain/editing-checkpoint.js';
import { parseBoundedJson } from '../src/domain/bounded-json.js';
import { createHash } from 'node:crypto';

import { canonicalCharacterRecordSchema } from '../src/generation/catalog.js';
import { HttpError } from './security.js';
import type {
  ServerConfig,
  SubmittedBundle,
  SubmittedFile,
  ValidatedBundle,
  ValidatedFile,
} from './types.js';

const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RESERVED_IDENTIFIERS = new Set([
  'admin',
  'api',
  'assets',
  'content',
  'generated',
  'mock',
  'null',
  'studio',
  'test',
  'undefined',
]);
const GENERATED_FILES = new Set([
  'generated/content-studio-catalog.js',
  'generated/content-studio-manifest.json',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(field: string, message: string): never {
  throw new HttpError(422, 'invalid_submission', `${field}: ${message}`);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    invalid(field, '値が空か、長すぎます。');
  }
  if (pattern && !pattern.test(value)) invalid(field, '使用できない文字が含まれています。');
  return value;
}

export function validateIdentifier(value: unknown, field = 'slug'): string {
  const identifier = requiredString(value, field, 24, SLUG_PATTERN);
  if (RESERVED_IDENTIFIERS.has(identifier)) invalid(field, '予約済みの値です。');
  return identifier;
}

function validateSafeDisplayText(value: unknown, field: string, maxLength: number): string {
  const text = requiredString(value, field, maxLength);
  if (
    /[\x00-\x1f\x7f]/.test(text) ||
    /<\/?[a-z!][^>]*>/i.test(text) ||
    /javascript\s*:/i.test(text) ||
    /on(?:error|load|click)\s*=/i.test(text)
  ) {
    invalid(field, '危険な文字列が含まれています。');
  }
  return text;
}

export function normalizeGitPath(value: unknown): string {
  const path = requiredString(value, 'files.path', 240, SAFE_PATH_PATTERN);
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.includes('%') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    invalid('files.path', '安全でないパスです。');
  }
  return path;
}

function isAllowedPath(path: string, slug: string, config: ServerConfig): boolean {
  if (config.allowedExactFiles.has(path)) return true;
  if (path === `content/characters/${slug}.json`) return true;
  if (GENERATED_FILES.has(path)) return true;
  const assetPattern = new RegExp(
    `^assets/content-studio/${slug}/[a-f0-9]{8,64}/[a-z0-9][a-z0-9._-]{0,79}$`,
  );
  return assetPattern.test(path);
}

function decodeBase64(value: unknown, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    invalid(field, 'Base64データが不正です。');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    invalid(field, 'Base64データが不正です。');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) invalid(field, 'Base64データが正規形式ではありません。');
  return bytes;
}

function textFromBytes(bytes: Buffer, field: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid(field, 'UTF-8として読み込めません。');
  }
}

function inspectStrings(value: unknown, field: string, depth = 0): void {
  if (depth > 32) invalid(field, 'JSONの階層が深すぎます。');
  if (typeof value === 'string') {
    if (
      value.length > 20_000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ||
      /<\/?(?:script|iframe|object|embed|style|svg|math)\b/i.test(value) ||
      /javascript\s*:/i.test(value) ||
      /on(?:error|load|click)\s*=/i.test(value)
    ) {
      invalid(field, '危険な文字列が含まれています。');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) invalid(field, '配列が大きすぎます。');
    value.forEach((item, index) => inspectStrings(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 500) invalid(field, '項目数が多すぎます。');
    for (const [key, item] of entries) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        invalid(field, '使用できない項目名です。');
      }
      inspectStrings(item, `${field}.${key}`, depth + 1);
    }
  }
}

function parseJson(bytes: Buffer, field: string): unknown {
  const text = textFromBytes(bytes, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid(field, 'JSONとして読み込めません。');
  }
  inspectStrings(parsed, field);
  return parsed;
}

function parseCatalog(bytes: Buffer): unknown {
  const text = textFromBytes(bytes, 'catalog');
  const generatedPrefix =
    '/* Generated by Content Studio. Do not edit manually. */\nglobalThis.__CONTENT_STUDIO_CATALOG__ = ';
  const trimmed = text.trim();
  if (trimmed.startsWith(generatedPrefix) && trimmed.endsWith(';')) {
    const json = trimmed.slice(generatedPrefix.length, -1);
    return parseJson(Buffer.from(json, 'utf8'), 'catalog');
  }
  const wrappers: Array<[string, string]> = [
    ['window.CONTENT_STUDIO_CATALOG = Object.freeze(', ');'],
    ['globalThis.CONTENT_STUDIO_CATALOG = Object.freeze(', ');'],
    ['const CONTENT_STUDIO_CATALOG = Object.freeze(', ');'],
  ];
  for (const [prefix, suffix] of wrappers) {
    if (trimmed.startsWith(prefix) && trimmed.endsWith(suffix)) {
      const json = trimmed.slice(prefix.length, -suffix.length);
      return parseJson(Buffer.from(json, 'utf8'), 'catalog');
    }
  }
  invalid('catalog', '許可された固定ラッパー形式ではありません。');
}

interface ImageDimensions {
  width: number;
  height: number;
}

function pngDimensions(bytes: Buffer): ImageDimensions | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    ) {
      if (length < 7) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Buffer): ImageDimensions | null {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function validateImage(
  bytes: Buffer,
  mimeType: string,
  config: ServerConfig,
): ImageDimensions {
  let dimensions: ImageDimensions | null = null;
  if (mimeType === 'image/png') dimensions = pngDimensions(bytes);
  if (mimeType === 'image/jpeg') dimensions = jpegDimensions(bytes);
  if (mimeType === 'image/webp') dimensions = webpDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    invalid('files.contentBase64', '画像の形式またはmagic bytesが不正です。');
  }
  if (
    dimensions.width > config.maxImageDimension ||
    dimensions.height > config.maxImageDimension ||
    dimensions.width * dimensions.height > config.maxImagePixels
  ) {
    invalid('files.contentBase64', '画像の寸法が上限を超えています。');
  }
  return dimensions;
}

function expectedMime(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json';
  if (path === 'generated/content-studio-catalog.js') return 'text/javascript';
  return null;
}

export function validateSubmittedFile(
  raw: unknown,
  slug: string,
  config: ServerConfig,
): ValidatedFile {
  if (!isRecord(raw)) invalid('files', 'ファイル情報が不正です。');
  const path = normalizeGitPath(raw.path);
  if (!isAllowedPath(path, slug, config)) invalid('files.path', '変更が許可されていない場所です。');
  const mimeType = requiredString(raw.mimeType, 'files.mimeType', 80, /^[a-z0-9.+/-]+$/);
  const requiredMime = expectedMime(path);
  if (!requiredMime || mimeType !== requiredMime) invalid('files.mimeType', '拡張子とMIMEが一致しません。');
  if (typeof raw.contentBase64 !== 'string' || raw.contentBase64.length > 4 * Math.ceil(config.maxFileBytes / 3)) invalid('files.byteLength', 'ファイル容量が上限外です。');
  const bytes = decodeBase64(raw.contentBase64, 'files.contentBase64');
  if (bytes.length === 0 || bytes.length > config.maxFileBytes) {
    invalid('files.byteLength', 'ファイル容量が上限外です。');
  }
  if (!Number.isSafeInteger(raw.byteLength) || raw.byteLength !== bytes.length) {
    invalid('files.byteLength', '申告容量と実容量が一致しません。');
  }
  const suppliedSha = requiredString(raw.sha256, 'files.sha256', 64, SHA256_PATTERN);
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (suppliedSha !== actualSha) invalid('files.sha256', '内容ハッシュが一致しません。');

  if (mimeType.startsWith('image/')) validateImage(bytes, mimeType, config);
  if (mimeType === 'application/json') parseJson(bytes, path);
  if (mimeType === 'text/javascript') parseCatalog(bytes);

  const gitHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const gitBlobSha = createHash('sha1').update(gitHeader).update(bytes).digest('hex');
  return { path, mimeType, bytes, sha256: actualSha, gitBlobSha };
}

function readCanonicalIdentity(file: ValidatedFile): { id: string; slug: string; displayName: string } {
  const parsed = parseJson(file.bytes, file.path);
  // Browser validation is only a convenience. The trusted server must reject
  // a hand-crafted request whose canonical record violates ranges, references,
  // strict fields, or the declarative skill schema.
  const result = canonicalCharacterRecordSchema.safeParse(parsed);
  if (!result.success) invalid(file.path, '正規キャラクターデータの形式が正しくありません。');
  const candidate = result.data.character;
  return {
    displayName: candidate.displayName,
    id: validateIdentifier(candidate.id, `${file.path}.id`),
    slug: validateIdentifier(candidate.slug, `${file.path}.slug`),
  };
}

function validatePrBody(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20_000) {
    invalid('prBody', 'PR本文が空か、長すぎます。');
  }
  if (
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ||
    /<\/?[a-z!][^>]*>/i.test(value) ||
    /javascript\s*:/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/.test(value)
  ) {
    invalid('prBody', 'PR本文に危険な文字列または秘密らしき値が含まれています。');
  }
  return value;
}

export function validateSubmission(raw: unknown, config: ServerConfig): ValidatedBundle {
  if (!isRecord(raw)) invalid('bundle', '送信形式が不正です。');
  const bundleId = requiredString(raw.bundleId, 'bundleId', 80, /^[A-Za-z0-9_-]+$/);
  const generatorVersion = requiredString(
    raw.generatorVersion,
    'generatorVersion',
    32,
    /^[A-Za-z0-9._-]+$/,
  );
  if (!isRecord(raw.character)) invalid('character', 'キャラクター情報が不正です。');
  const id = validateIdentifier(raw.character.id, 'character.id');
  const slug = validateIdentifier(raw.character.slug, 'character.slug');
  const displayName = validateSafeDisplayText(raw.character.displayName, 'character.displayName', 40);
  const expectedBaseSha = raw.expectedBaseSha === undefined
    ? undefined
    : requiredString(raw.expectedBaseSha, 'expectedBaseSha', 40, /^[a-f0-9]{40}$/);
  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > config.maxFiles) {
    invalid('files', 'ファイル数が上限外です。');
  }
  const files = raw.files.map((file) => validateSubmittedFile(file, slug, config));
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) invalid('files.path', '重複または大文字小文字だけが異なるパスです。');
    seen.add(key);
    totalBytes += file.bytes.length;
  }
  if (totalBytes > config.maxTotalFileBytes) invalid('files', '合計ファイル容量が上限を超えています。');

  const canonicalPath = `content/characters/${slug}.json`;
  const canonical = files.find((file) => file.path === canonicalPath);
  if (!canonical) invalid('files', '正規キャラクターデータがありません。');
  const canonicalIdentity = readCanonicalIdentity(canonical);
  if (canonicalIdentity.id !== id || canonicalIdentity.slug !== slug || canonicalIdentity.displayName !== displayName) {
    invalid('files', '正規データと送信情報のID・slug・表示名が一致しません。');
  }
  const prBody = validatePrBody(raw.prBody);
  let revalidation: ValidatedBundle['revalidation'];
  if (raw.revalidation !== undefined) {
    const r=raw.revalidation;
    if(!isRecord(r)||Object.keys(r).some(k=>!['branch','headSha','baseSha','digest','targetBaseSha'].includes(k)))invalid('revalidation','再検証情報が不正です。');
    revalidation={
      branch:requiredString(r.branch,'revalidation.branch',150,/^studio\/add-character-[a-z0-9-]+$/),
      headSha:requiredString(r.headSha,'revalidation.headSha',40,/^[a-f0-9]{40}$/),
      baseSha:requiredString(r.baseSha,'revalidation.baseSha',40,/^[a-f0-9]{40}$/),
      digest:requiredString(r.digest,'revalidation.digest',64,SHA256_PATTERN),
      targetBaseSha:requiredString(r.targetBaseSha,'revalidation.targetBaseSha',40,/^[a-f0-9]{40}$/),
    };
  }
  let sourceRevision: ValidatedBundle['sourceRevision'];
  if (raw.sourceRevision !== undefined) {
    const parsed=publishedRevisionSchema.safeParse(raw.sourceRevision);
    if(!parsed.success)invalid('sourceRevision','公開元revisionが不正です。');
    sourceRevision=parsed.data;
  }
  const digest = createHash('sha256');
  if(sourceRevision)digest.update(JSON.stringify(sourceRevision));
  if(revalidation)digest.update(JSON.stringify(revalidation));
  digest.update(`${bundleId}\0${generatorVersion}\0${id}\0${slug}\0${prBody}\0`);
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(`${file.path}\0${file.sha256}\0`);
  }
  return {
    ...(typeof raw.recoveryBranch === 'string' ? { recoveryBranch: requiredString(raw.recoveryBranch, 'recoveryBranch', 150, /^studio\/add-character-[a-z0-9-]+$/) } : {}),
    revalidation,
    sourceRevision,
    bundleId,
    generatorVersion,
    expectedBaseSha,
    character: { id, slug, displayName },
    files,
    prBody,
    digest: digest.digest('hex'),
  };
}

export function toSubmittedBundle(value: unknown): SubmittedBundle {
  return value as SubmittedBundle;
}

/** Checkpoint PNGs contain only raster/color chunks. Decode scanlines within a fixed limit to reject hidden RGB. */
export function validateCheckpointPng(bytes:Buffer, expected:{width:number;height:number;sha256:string}, config:ServerConfig):void {
  const dimensions=validateImage(bytes,'image/png',config);
  if(dimensions.width!==expected.width||dimensions.height!==expected.height||dimensions.width>1600||dimensions.height>1600||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)invalid('editing','編集入力の寸法/hashが一致しません。');
  if(bytes[24]!==8||![2,6].includes(bytes[25])||bytes[26]!==0||bytes[27]!==0||bytes[28]!==0)invalid('editing','編集入力PNG形式が未対応です。');
  let offset=8, ended=false, chunks=0;const parts:Buffer[]=[];
  while(offset<bytes.length){
    if(++chunks>2048||offset+12>bytes.length)invalid('editing','編集PNGが不正です。');
    const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
    if(offset+length+12>bytes.length||!['IHDR','IDAT','IEND','sRGB'].includes(kind))invalid('editing','編集PNGに不要なmetadataが含まれています。');
    if((offset===8 && (kind!=='IHDR'||length!==13)) || (offset!==8&&kind==='IHDR') || (kind==='sRGB'&&(length!==1||bytes[offset+8]>3||parts.length>0)))invalid('editing','編集PNGのchunk順序が不正です。');
    let crc=0xffffffff;for(const byte of bytes.subarray(offset+4,offset+8+length)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(offset+8+length))invalid('editing','編集PNGのCRCが一致しません。');
    if(kind==='IDAT')parts.push(bytes.subarray(offset+8,offset+8+length));
    if(kind==='IEND'){ended=true;if(length!==0||offset+12!==bytes.length)invalid('editing','編集PNG末尾が不正です。');}
    offset+=length+12;
  }
  if(!ended||!parts.length)invalid('editing','編集PNGが不完全です。');
  const channels=bytes[25]===6?4:3,rowLength=dimensions.width*channels,expectedBytes=(rowLength+1)*dimensions.height;
  let decoded:Buffer;try{const compressed=Buffer.concat(parts), result=inflateSync(compressed,{maxOutputLength:expectedBytes,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};if(result.engine.bytesWritten!==compressed.length)invalid('editing','編集PNGに余分な圧縮データがあります。');decoded=result.buffer;}catch{invalid('editing','編集PNGの展開が不正です。');}
  if(decoded!.length!==expectedBytes)invalid('editing','編集PNGの展開寸法が不正です。');
  let previous=Buffer.alloc(rowLength);
  for(let y=0;y<dimensions.height;y++){
    const start=y*(rowLength+1),filter=decoded![start],row=Buffer.alloc(rowLength);
    if(filter>4)invalid('editing','編集PNGのfilterが不正です。');
    for(let x=0;x<rowLength;x++){
      const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const value=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      row[x]=(decoded![start+1+x]+value)&255;
    }
    if(channels===4)for(let x=0;x<rowLength;x+=4)if(row[x+3]===0&&(row[x]!==0||row[x+1]!==0||row[x+2]!==0))invalid('editing','透明領域に不要な画像情報が残っています。');
    previous=row;
  }
}
