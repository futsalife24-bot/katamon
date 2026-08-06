import { describe, expect, it } from 'vitest';

import {
  ImageSafetyError,
  inspectImageHeader,
  validateImageFileName,
  validateImageSafety,
} from '../../src/image/header';

function pngHeader(width: number, height: number, colorType = 6): Uint8Array {
  const bytes = new Uint8Array(48);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([...'IHDR'].map((value) => value.charCodeAt(0)), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = colorType;
  bytes.set([...'sRGB'].map((value) => value.charCodeAt(0)), 32);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpExtendedHeader(width: number, height: number, alpha = true): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([...'RIFF'].map((value) => value.charCodeAt(0)), 0);
  bytes.set([...'WEBP'].map((value) => value.charCodeAt(0)), 8);
  bytes.set([...'VP8X'].map((value) => value.charCodeAt(0)), 12);
  bytes[20] = alpha ? 0x10 : 0;
  const storedWidth = width - 1;
  const storedHeight = height - 1;
  bytes.set([storedWidth & 0xff, (storedWidth >> 8) & 0xff, (storedWidth >> 16) & 0xff], 24);
  bytes.set([storedHeight & 0xff, (storedHeight >> 8) & 0xff, (storedHeight >> 16) & 0xff], 27);
  return bytes;
}

describe('画像ヘッダー検査', () => {
  it('PNGの寸法・透過・色空間を展開前に読み取る', () => {
    expect(inspectImageHeader(pngHeader(640, 480))).toEqual({
      mimeType: 'image/png',
      width: 640,
      height: 480,
      hasAlphaHint: true,
      colorMode: 'sRGB',
    });
  });

  it('JPEGとWebPの寸法を読み取る', () => {
    expect(inspectImageHeader(jpegHeader(1280, 720))).toMatchObject({
      mimeType: 'image/jpeg', width: 1280, height: 720, hasAlphaHint: false,
    });
    expect(inspectImageHeader(webpExtendedHeader(511, 257))).toMatchObject({
      mimeType: 'image/webp', width: 511, height: 257, hasAlphaHint: true,
    });
  });

  it('未対応形式と壊れたヘッダーを拒否する', () => {
    expect(() => inspectImageHeader(new Uint8Array([1, 2, 3, 4]))).toThrow(ImageSafetyError);
    expect(() => inspectImageHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/サイズ情報/);
  });

  it('パストラバーサルと制御文字を含むファイル名を拒否する', () => {
    expect(() => validateImageFileName('../character.png')).toThrow(/安全/);
    expect(() => validateImageFileName('folder\\character.png')).toThrow(/安全/);
    expect(() => validateImageFileName('bad\u0000.png')).toThrow(/安全/);
    expect(() => validateImageFileName('sample-character.webp')).not.toThrow();
  });

  it('安全な寸法へデコード前縮小し、画素爆弾は拒否する', () => {
    const safe = validateImageSafety(
      { mimeType: 'image/png', width: 4000, height: 3000, hasAlphaHint: true, colorMode: 'sRGB' },
      2_000_000,
      'sample.png',
      { decodeMaxDimension: 1600 },
    );
    expect(safe).toMatchObject({ safeDecodeWidth: 1600, safeDecodeHeight: 1200, resizedBeforeDecode: true });
    expect(() => validateImageSafety(
      { mimeType: 'image/png', width: 8000, height: 8000, hasAlphaHint: true, colorMode: 'sRGB' },
      2_000_000,
      'sample.png',
    )).toThrow(/画素数/);
  });
});
