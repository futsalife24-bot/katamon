(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StageZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZIP_LIMITS = Object.freeze({
    maxArchiveBytes: 6 * 1024 * 1024,
    maxUncompressedBytes: 12 * 1024 * 1024,
    maxEntryBytes: 6 * 1024 * 1024,
    maxJsonBytes: 2 * 1024 * 1024,
    maxImageBytes: 4 * 1024 * 1024,
    maxImageWidth: 2048,
    maxImageHeight: 2048,
    maxImagePixels: 4 * 1024 * 1024,
    maxEntries: 32,
    maxNameBytes: 180,
    maxPathDepth: 4,
    maxExtraBytes: 1024,
    maxJsonDepth: 32,
    maxJsonNodes: 250000
  });

  const ZIP_MIME_TYPES = Object.freeze([
    '',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]);
  const IMAGE_MIME_BY_EXTENSION = Object.freeze({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  });
  const REQUIRED_STAGE_ENTRIES = Object.freeze(['manifest.json', 'terrain.json', 'gimmicks.json']);
  const UTF8_FLAG = 0x0800;
  const STORE_METHOD = 0;
  const LOCAL_SIGNATURE = 0x04034b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const EOCD_SIGNATURE = 0x06054b50;

  class StageZipError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'StageZipError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  function fail(code, message, details) {
    throw new StageZipError(code, message, details);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function utf8Encode(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value));
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(String(value), 'utf8'));
    fail('utf8.unavailable', 'UTF-8を利用できない環境です。');
  }

  function utf8Decode(bytes) {
    try {
      if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (typeof Buffer !== 'undefined') {
        const text = Buffer.from(bytes).toString('utf8');
        if (text.includes('\ufffd')) fail('utf8.invalid', 'ZIP内の文字コードが不正です。');
        return text;
      }
    } catch (error) {
      fail('utf8.invalid', 'ZIP内の文字コードが不正です。', error && error.message);
    }
    fail('utf8.unavailable', 'UTF-8を利用できない環境です。');
  }

  async function toBytes(input) {
    if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    if (typeof input === 'string') return utf8Encode(input);
    fail('input.unsupported', '読み込めないデータ形式です。');
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      fail('json.serialize', 'ステージデータをJSONへ変換できません。', error && error.message);
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isPlainObject(value)) return value;
    const result = {};
    Object.keys(value).sort().forEach((key) => {
      if (typeof value[key] !== 'undefined') result[key] = stableValue(value[key]);
    });
    return result;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function extensionOf(name) {
    const lower = String(name).toLowerCase();
    const dot = lower.lastIndexOf('.');
    return dot < 0 ? '' : lower.slice(dot);
  }

  function validateEntryName(name, limits) {
    if (typeof name !== 'string' || !name) fail('path.empty', 'ZIP内に名前のないファイルがあります。');
    const nameBytes = utf8Encode(name);
    if (nameBytes.length > limits.maxNameBytes) fail('path.tooLong', 'ZIP内のファイル名が長すぎます。', name);
    if (name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
      fail('path.unsafe', 'ZIP内に危険なファイルパスがあります。', name);
    }
    const parts = name.split('/');
    if (parts.length > limits.maxPathDepth || parts.some((part) => !part || part === '.' || part === '..')) {
      fail('path.unsafe', 'ZIP内に危険なファイルパスがあります。', name);
    }
    if (name.endsWith('/')) fail('path.directory', 'ZIP内のディレクトリ項目には対応していません。', name);
    return nameBytes;
  }

  function isAllowedStageEntry(name) {
    if (REQUIRED_STAGE_ENTRIES.includes(name)) return true;
    if (/^(preview|background)\.(png|jpe?g|webp)$/i.test(name)) return true;
    return /^assets\/[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/i.test(name);
  }

  function mimeForName(name) {
    if (name.toLowerCase().endsWith('.json')) return 'application/json';
    return IMAGE_MIME_BY_EXTENSION[extensionOf(name)] || 'application/octet-stream';
  }

  function readU24Le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  }

  function jpegDimensions(bytes) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = (bytes[offset] << 8) | bytes[offset + 1];
      if (size < 2 || offset + size > bytes.length) break;
      const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && size >= 7) {
        return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
      }
      offset += size;
    }
    return null;
  }

  function webpDimensions(bytes) {
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { width: readU24Le(bytes, 24) + 1, height: readU24Le(bytes, 27) + 1 };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: (bytes[26] | bytes[27] << 8) & 0x3fff, height: (bytes[28] | bytes[29] << 8) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = (bytes[21] | bytes[22] << 8 | bytes[23] << 16 | bytes[24] << 24) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  function validateImageSignature(name, bytes, limits) {
    const ext = extensionOf(name);
    let valid = false;
    let dimensions = null;
    if (ext === '.png') {
      valid = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
        bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
      if (valid) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        dimensions = { width: view.getUint32(16, false), height: view.getUint32(20, false) };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (valid) dimensions = jpegDimensions(bytes);
    } else if (ext === '.webp') {
      valid = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (valid) dimensions = webpDimensions(bytes);
    }
    if (!valid) fail('image.signature', '画像の形式とファイル内容が一致しません。', name);
    if (!dimensions || !dimensions.width || !dimensions.height) fail('image.dimensions', '画像の寸法を安全に確認できません。', name);
    if (dimensions.width > limits.maxImageWidth || dimensions.height > limits.maxImageHeight || dimensions.width * dimensions.height > limits.maxImagePixels) {
      fail('image.dimensions', '画像の解像度が上限を超えています。', { name, width: dimensions.width, height: dimensions.height });
    }
    return dimensions;
  }

  function validateStageEntry(name, bytes, limits) {
    if (!isAllowedStageEntry(name)) fail('entry.unsupported', 'ZIP内に未対応のファイルがあります。', name);
    if (name.endsWith('.json')) {
      if (bytes.length > limits.maxJsonBytes) fail('json.tooLarge', 'ZIP内のJSONが大きすぎます。', name);
    } else {
      if (bytes.length > limits.maxImageBytes) fail('image.tooLarge', 'ZIP内の画像が大きすぎます。', name);
      validateImageSignature(name, bytes, limits);
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let k = 0; k < 8; k++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[n] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks, totalLength) {
    const result = new Uint8Array(totalLength == null
      ? chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      : totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function zipLocalHeader(entry) {
    const bytes = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(bytes.buffer);
    writeU32(view, 0, LOCAL_SIGNATURE);
    writeU16(view, 4, 20);
    writeU16(view, 6, UTF8_FLAG);
    writeU16(view, 8, STORE_METHOD);
    writeU16(view, 10, 0);
    writeU16(view, 12, 0x21);
    writeU32(view, 14, entry.crc);
    writeU32(view, 18, entry.bytes.length);
    writeU32(view, 22, entry.bytes.length);
    writeU16(view, 26, entry.nameBytes.length);
    writeU16(view, 28, 0);
    bytes.set(entry.nameBytes, 30);
    return bytes;
  }

  function zipCentralHeader(entry) {
    const bytes = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(bytes.buffer);
    writeU32(view, 0, CENTRAL_SIGNATURE);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, UTF8_FLAG);
    writeU16(view, 10, STORE_METHOD);
    writeU16(view, 12, 0);
    writeU16(view, 14, 0x21);
    writeU32(view, 16, entry.crc);
    writeU32(view, 20, entry.bytes.length);
    writeU32(view, 24, entry.bytes.length);
    writeU16(view, 28, entry.nameBytes.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, 0);
    writeU32(view, 42, entry.localOffset);
    bytes.set(entry.nameBytes, 46);
    return bytes;
  }

  function zipEocd(entryCount, centralSize, centralOffset) {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    writeU32(view, 0, EOCD_SIGNATURE);
    writeU16(view, 4, 0);
    writeU16(view, 6, 0);
    writeU16(view, 8, entryCount);
    writeU16(view, 10, entryCount);
    writeU32(view, 12, centralSize);
    writeU32(view, 16, centralOffset);
    writeU16(view, 20, 0);
    return bytes;
  }

  async function normalizeCreateEntries(source, options) {
    const limits = Object.assign({}, ZIP_LIMITS, options && options.limits);
    const rawEntries = Array.isArray(source)
      ? source
      : Object.keys(source || {}).map((name) => ({ name, data: source[name] }));
    if (!rawEntries.length) fail('entry.empty', 'ZIPへ保存するファイルがありません。');
    if (rawEntries.length > limits.maxEntries) fail('entry.tooMany', 'ZIP内のファイル数が上限を超えています。');
    const seen = new Set();
    let total = 0;
    const entries = [];
    for (const raw of rawEntries) {
      const name = String(raw && raw.name || '');
      const nameBytes = validateEntryName(name, limits);
      const folded = name.toLowerCase();
      if (seen.has(folded)) fail('entry.duplicate', 'ZIP内に重複したファイル名があります。', name);
      seen.add(folded);
      const bytes = await toBytes(raw && Object.prototype.hasOwnProperty.call(raw, 'data') ? raw.data : raw);
      if (bytes.length > limits.maxEntryBytes) fail('entry.tooLarge', 'ZIP内のファイルが大きすぎます。', name);
      total += bytes.length;
      if (total > limits.maxUncompressedBytes) fail('archive.expandedTooLarge', 'ZIPの展開後サイズが上限を超えています。');
      if (options && options.strictStageBundle) validateStageEntry(name, bytes, limits);
      entries.push({ name, nameBytes, bytes: new Uint8Array(bytes), crc: crc32(bytes), localOffset: 0 });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return { entries, limits };
  }

  async function createZip(source, options) {
    const normalized = await normalizeCreateEntries(source, options || {});
    const localChunks = [];
    let localLength = 0;
    normalized.entries.forEach((entry) => {
      entry.localOffset = localLength;
      const header = zipLocalHeader(entry);
      localChunks.push(header, entry.bytes);
      localLength += header.length + entry.bytes.length;
    });
    const centralChunks = normalized.entries.map(zipCentralHeader);
    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const totalLength = localLength + centralSize + 22;
    if (totalLength > normalized.limits.maxArchiveBytes) fail('archive.tooLarge', 'ZIPファイルが上限を超えています。');
    return concatBytes(localChunks.concat(centralChunks, zipEocd(normalized.entries.length, centralSize, localLength)), totalLength);
  }

  function findEocd(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minimum = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= minimum; offset--) {
      if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.length) return offset;
    }
    fail('archive.eocd', 'ZIPの終端情報が見つかりません。');
  }

  function inspectExtra(extra) {
    let offset = 0;
    const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    while (offset < extra.length) {
      if (offset + 4 > extra.length) fail('archive.extra', 'ZIPの追加情報が壊れています。');
      const id = view.getUint16(offset, true);
      const size = view.getUint16(offset + 2, true);
      offset += 4;
      if (offset + size > extra.length) fail('archive.extra', 'ZIPの追加情報が壊れています。');
      if (id === 0x0001) fail('archive.zip64', 'ZIP64形式には対応していません。');
      offset += size;
    }
  }

  async function readZip(input, options) {
    const settings = options || {};
    const limits = Object.assign({}, ZIP_LIMITS, settings.limits);
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      const mime = String(input.type || '').toLowerCase();
      if (!ZIP_MIME_TYPES.includes(mime)) fail('archive.mime', 'ZIPとして認識できないMIMEタイプです。', mime);
      if (input.size > limits.maxArchiveBytes) fail('archive.tooLarge', 'ZIPファイルが上限を超えています。');
    }
    const bytes = await toBytes(input);
    if (bytes.length > limits.maxArchiveBytes) fail('archive.tooLarge', 'ZIPファイルが上限を超えています。');
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('archive.magic', 'ZIPファイルのシグネチャが不正です。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEocd(bytes);
    const disk = view.getUint16(eocdOffset + 4, true);
    const centralDisk = view.getUint16(eocdOffset + 6, true);
    const diskEntries = view.getUint16(eocdOffset + 8, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (disk || centralDisk || diskEntries !== entryCount) fail('archive.multidisk', '分割ZIPには対応していません。');
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('archive.zip64', 'ZIP64形式には対応していません。');
    if (!entryCount || entryCount > limits.maxEntries) fail('entry.count', 'ZIP内のファイル数が不正です。');
    if (centralOffset + centralSize !== eocdOffset || centralOffset > eocdOffset) fail('archive.central', 'ZIPの中央ディレクトリが壊れています。');

    const metadata = [];
    const seen = new Set();
    let cursor = centralOffset;
    let totalUncompressed = 0;
    for (let i = 0; i < entryCount; i++) {
      if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) fail('archive.central', 'ZIPの中央ディレクトリが壊れています。');
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const diskStart = view.getUint16(cursor + 34, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > eocdOffset || !nameLength || nameLength > limits.maxNameBytes || extraLength > limits.maxExtraBytes) fail('archive.central', 'ZIPの項目情報が不正です。');
      if (flags & 0x0001) fail('archive.encrypted', '暗号化ZIPには対応していません。');
      if ((flags & ~UTF8_FLAG) !== 0) fail('archive.flags', '未対応のZIPフラグが使われています。');
      if (method !== STORE_METHOD) fail('archive.compression', 'このZIP圧縮方式には対応していません。');
      if (compressedSize !== uncompressedSize) fail('archive.sizeMismatch', 'ZIP内のファイルサイズ情報が不正です。');
      if (uncompressedSize > limits.maxEntryBytes) fail('entry.tooLarge', 'ZIP内のファイルが大きすぎます。');
      if (diskStart !== 0) fail('archive.multidisk', '分割ZIPには対応していません。');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = utf8Decode(nameBytes);
      validateEntryName(name, limits);
      const folded = name.toLowerCase();
      if (seen.has(folded)) fail('entry.duplicate', 'ZIP内に重複したファイル名があります。', name);
      seen.add(folded);
      inspectExtra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > limits.maxUncompressedBytes) fail('archive.expandedTooLarge', 'ZIPの展開後サイズが上限を超えています。');
      metadata.push({ name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, localOffset });
      cursor = end;
    }
    if (cursor !== eocdOffset) fail('archive.central', 'ZIPの中央ディレクトリ長が一致しません。');

    const ranges = [];
    const entries = Object.create(null);
    for (const item of metadata) {
      const offset = item.localOffset;
      if (offset + 30 > centralOffset || view.getUint32(offset, true) !== LOCAL_SIGNATURE) fail('archive.local', 'ZIPのローカルヘッダーが壊れています。', item.name);
      const flags = view.getUint16(offset + 6, true);
      const method = view.getUint16(offset + 8, true);
      const localCrc = view.getUint32(offset + 14, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const dataStart = offset + 30 + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (flags !== item.flags || method !== item.method || localCrc !== item.crc || compressedSize !== item.compressedSize || uncompressedSize !== item.uncompressedSize) {
        fail('archive.headerMismatch', 'ZIPのヘッダー情報が一致しません。', item.name);
      }
      if (extraLength > limits.maxExtraBytes || dataEnd > centralOffset) fail('archive.local', 'ZIPのファイル領域が不正です。', item.name);
      const localName = utf8Decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      if (localName !== item.name) fail('archive.nameMismatch', 'ZIPのファイル名情報が一致しません。', item.name);
      inspectExtra(bytes.subarray(offset + 30 + nameLength, dataStart));
      for (const range of ranges) {
        if (offset < range.end && dataEnd > range.start) fail('archive.overlap', 'ZIP内のファイル領域が重複しています。');
      }
      ranges.push({ start: offset, end: dataEnd });
      const data = new Uint8Array(bytes.subarray(dataStart, dataEnd));
      if (crc32(data) !== item.crc) fail('archive.crc', 'ZIP内のファイルが破損しています。', item.name);
      if (settings.strictStageBundle) validateStageEntry(item.name, data, limits);
      entries[item.name] = Object.freeze({ name: item.name, data, mimeType: mimeForName(item.name), size: data.length, crc32: item.crc });
    }
    return Object.freeze({ entries, byteLength: bytes.length, uncompressedBytes: totalUncompressed });
  }

  function securityScanJson(value, limits) {
    const stack = [{ value, depth: 0, path: '$' }];
    let nodes = 0;
    while (stack.length) {
      const item = stack.pop();
      nodes++;
      if (nodes > limits.maxJsonNodes) fail('json.complex', 'JSONの要素数が上限を超えています。');
      if (item.depth > limits.maxJsonDepth) fail('json.depth', 'JSONの入れ子が深すぎます。');
      if (typeof item.value === 'number' && !Number.isFinite(item.value)) fail('json.number', 'JSONに有限でない数値があります。', item.path);
      if (!item.value || typeof item.value !== 'object') continue;
      const keys = Object.keys(item.value);
      for (const key of keys) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('json.prototype', 'JSONに禁止されたプロパティがあります。', item.path + '.' + key);
        stack.push({ value: item.value[key], depth: item.depth + 1, path: item.path + '.' + key });
      }
    }
    return value;
  }

  function parseJsonEntry(entry, limits) {
    if (!entry) fail('entry.missing', 'ZIP内に必要なJSONがありません。');
    if (entry.data.length > limits.maxJsonBytes) fail('json.tooLarge', 'ZIP内のJSONが大きすぎます。', entry.name);
    let value;
    try {
      value = JSON.parse(utf8Decode(entry.data));
    } catch (error) {
      if (error instanceof StageZipError) throw error;
      fail('json.invalid', 'ZIP内のJSONが壊れています。', entry.name);
    }
    return securityScanJson(value, limits);
  }

  function resolveCore(provided) {
    if (provided) return provided;
    if (typeof globalThis !== 'undefined' && globalThis.StageCore) return globalThis.StageCore;
    if (typeof require === 'function') {
      try { return require('./stage-core.js'); } catch (_) { return null; }
    }
    return null;
  }

  function imageName(prefix, value) {
    const mime = value && typeof value.type === 'string' ? value.type.toLowerCase() : '';
    if (mime === 'image/png') return prefix + '.png';
    if (mime === 'image/jpeg') return prefix + '.jpg';
    if (mime === 'image/webp' || !mime) return prefix + '.webp';
    fail('image.mime', '未対応の画像MIMEタイプです。', mime);
  }

  async function createStageBundle(stage, options) {
    const settings = options || {};
    const core = resolveCore(settings.core);
    let document = cloneJson(stage);
    if (settings.finalize !== false && core && typeof core.finalizeStage === 'function') {
      document = await core.finalizeStage(document, { touchUpdatedAt: false });
    }
    if (!isPlainObject(document) || !isPlainObject(document.terrain) || !Array.isArray(document.gimmicks)) {
      fail('stage.structure', 'ステージデータの構造が不正です。');
    }
    if (core && typeof core.validateStage === 'function') {
      const validation = core.validateStage(document);
      if (!validation.valid) fail('stage.invalid', '検証に失敗したステージは出力できません。', validation);
    }
    const manifest = cloneJson(document);
    const terrain = manifest.terrain;
    const gimmicks = manifest.gimmicks;
    delete manifest.terrain;
    delete manifest.gimmicks;
    const entries = [
      { name: 'manifest.json', data: stableStringify(manifest) },
      { name: 'terrain.json', data: stableStringify(terrain) },
      { name: 'gimmicks.json', data: stableStringify(gimmicks) }
    ];
    if (settings.previewBlob) entries.push({ name: imageName('preview', settings.previewBlob), data: settings.previewBlob });
    if (settings.backgroundBlob) entries.push({ name: imageName('background', settings.backgroundBlob), data: settings.backgroundBlob });
    if (settings.assets) {
      const assets = Array.isArray(settings.assets)
        ? settings.assets
        : Object.keys(settings.assets).map((name) => ({ name, data: settings.assets[name] }));
      assets.forEach((asset) => {
        const name = String(asset.name || '');
        const data = asset && asset.data && Object.prototype.hasOwnProperty.call(asset.data, 'data') ? asset.data.data : asset.data;
        entries.push({ name: name.startsWith('assets/') ? name : 'assets/' + name, data });
      });
    }
    const bytes = await createZip(entries, { strictStageBundle: true, limits: settings.limits });
    if (settings.output === 'uint8array' || typeof Blob === 'undefined') return bytes;
    return new Blob([bytes], { type: 'application/zip' });
  }

  async function readStageBundle(input, options) {
    const settings = options || {};
    const limits = Object.assign({}, ZIP_LIMITS, settings.limits);
    const archive = await readZip(input, { strictStageBundle: true, limits });
    for (const name of REQUIRED_STAGE_ENTRIES) {
      if (!archive.entries[name]) fail('entry.missing', 'ZIP内に必要なファイルがありません。', name);
    }
    const manifest = parseJsonEntry(archive.entries['manifest.json'], limits);
    const terrain = parseJsonEntry(archive.entries['terrain.json'], limits);
    const gimmicks = parseJsonEntry(archive.entries['gimmicks.json'], limits);
    if (!isPlainObject(manifest) || Object.prototype.hasOwnProperty.call(manifest, 'terrain') || Object.prototype.hasOwnProperty.call(manifest, 'gimmicks')) {
      fail('manifest.structure', 'manifest.jsonの構造が不正です。');
    }
    if (!isPlainObject(terrain) || !Array.isArray(gimmicks)) fail('stage.structure', 'ZIP内のステージ構造が不正です。');
    let stage = Object.assign({}, manifest, { terrain, gimmicks });
    const core = resolveCore(settings.core);
    if (core && typeof core.validateStage === 'function') {
      const rawValidation = core.validateStage(stage, { fileSize: archive.byteLength });
      if (!rawValidation.valid) fail('stage.invalid', 'ステージデータの検証に失敗しました。', rawValidation);
    }
    if (core && typeof core.migrateStage === 'function') {
      let migrated;
      try { migrated = core.migrateStage(stage); }
      catch (error) { fail('stage.version', '対応していないステージ形式です。', error && error.message); }
      if (!migrated) fail('stage.version', '対応していないステージ形式です。');
      stage = migrated;
    }
    if (core && typeof core.validateStage === 'function') {
      const validation = core.validateStage(stage, { fileSize: archive.byteLength });
      if (!validation.valid) fail('stage.invalid', 'ステージデータの検証に失敗しました。', validation);
    }
    if (settings.verifyHash !== false && core && typeof core.verifyStageHash === 'function') {
      const hashResult = await core.verifyStageHash(stage);
      const hashValid = typeof hashResult === 'boolean' ? hashResult : !!(hashResult && hashResult.valid);
      if (!hashValid) fail('stage.hash', 'ステージのハッシュが一致しません。', hashResult);
    }
    const assets = Object.create(null);
    Object.keys(archive.entries).forEach((name) => {
      if (!REQUIRED_STAGE_ENTRIES.includes(name)) assets[name] = archive.entries[name];
    });
    return Object.freeze({ stage, assets, entries: archive.entries, byteLength: archive.byteLength });
  }

  return Object.freeze({
    ZIP_LIMITS,
    ZIP_MIME_TYPES,
    REQUIRED_STAGE_ENTRIES,
    StageZipError,
    crc32,
    stableStringify,
    createZip,
    readZip,
    createStageBundle,
    readStageBundle
  });
});
