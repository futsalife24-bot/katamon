import { createHash } from 'node:crypto';

import { loadConfig } from '../../server/config.js';
import type { ServerConfig, SubmittedFile, ValidatedBundle, ValidatedFile } from '../../server/types.js';
import { sampleCharacter, sampleMetadata } from './test-character';

export function canonicalRecordBytes(): Buffer {
  const directory = 'assets/content-studio/sample-unit/0123456789ab';
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    character: sampleCharacter(),
    assets: {
      directory,
      normalizedPng: `${directory}/character.png`,
      optimizedWebp: `${directory}/character.webp`,
      iconPng: `${directory}/icon.png`,
      thumbnailWebp: `${directory}/thumbnail.webp`,
      spriteSheetPng: `${directory}/idle.png`,
      spriteMetadataJson: `${directory}/idle.json`,
      previewPng: `${directory}/preview.png`,
    },
    spriteMetadata: sampleMetadata({ sourceImage: `${directory}/character.png` }),
    generatorVersion: '0.1.0',
  }), 'utf8');
}

export function serverTestConfig(overrides: Record<string, string> = {}): ServerConfig {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '8787',
    PUBLIC_APP_URL: 'https://studio.invalid',
    GITHUB_OAUTH_CLIENT_ID: 'oauth-client',
    GITHUB_OAUTH_CLIENT_SECRET: 'oauth-secret',
    GITHUB_APP_ID: '123456',
    GITHUB_PRIVATE_KEY: 'test-private-key-placeholder',
    GITHUB_INSTALLATION_ID: '654321',
    GITHUB_OWNER: 'target-owner',
    GITHUB_REPO: 'target-repository',
    GITHUB_BASE_BRANCH: 'master',
    ALLOWED_GITHUB_USERS: 'allowed-user',
    SESSION_SECRET: 'test-session-secret-with-32-characters-minimum',
    ...overrides,
  });
}

export function submittedFile(path: string, mimeType: string, bytes: Buffer): SubmittedFile {
  return {
    path,
    mimeType,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentBase64: bytes.toString('base64'),
  };
}

export function validatedFile(path: string, mimeType: string, bytes: Buffer): ValidatedFile {
  const gitHeader = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return {
    path,
    mimeType,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    gitBlobSha: createHash('sha1').update(gitHeader).update(bytes).digest('hex'),
  };
}

export function validatedBundle(): ValidatedBundle {
  const bytes = canonicalRecordBytes();
  const record = JSON.parse(bytes.toString());
  const png = Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(256,16); png.writeUInt32BE(256,20);
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22,4); webp.write('WEBP',8); webp.write('VP8X',12); webp.writeUIntLE(255,24,3); webp.writeUIntLE(255,27,3);
  const files = [validatedFile('content/characters/sample-unit.json', 'application/json', bytes)];
  for (const [key,path] of Object.entries(record.assets)) {
    if (key === 'directory') continue;
    const name = path as string;
    const image = Buffer.from(name.endsWith('.webp') ? webp : png);
    if (name.endsWith('/idle.png')) image.writeUInt32BE(2048,16);
    files.push(validatedFile(name, name.endsWith('.json') ? 'application/json' : name.endsWith('.webp') ? 'image/webp' : 'image/png', name.endsWith('.json') ? Buffer.from(JSON.stringify(record.spriteMetadata)) : image));
  }
  return {
    bundleId: 'a'.repeat(64),
    generatorVersion: '0.1.0',
    character: { id: 'sample-unit', slug: 'sample-unit', displayName: 'サンプルキャラクター' },
    files,
    prBody: '## Content Studio\n\n- 自動確認: 成功\n',
    digest: 'b'.repeat(64),
  };
}
