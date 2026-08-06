import { zipSync, type Zippable } from 'fflate';

import type { ArtifactFile } from '../domain/types';
import { isAllowedGeneratedPath } from '../domain/validation';
import { sha256Bytes } from './hash';

const FIXED_ZIP_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z');

export async function createArtifactZip(files: readonly ArtifactFile[]): Promise<Blob> {
  const archive: Zippable = {};
  const seen = new Set<string>();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, 'en-US'))) {
    if (!isAllowedGeneratedPath(file.path) || seen.has(file.path)) throw new Error('ZIPへ追加できないパスです');
    seen.add(file.path);
    if (file.text === undefined && file.blob === undefined) throw new Error('ZIPへ追加するファイルの内容がありません');
    const bytes = file.text !== undefined
      ? new TextEncoder().encode(file.text)
      : new Uint8Array(await file.blob!.arrayBuffer());
    if (bytes.byteLength !== file.byteLength || await sha256Bytes(bytes) !== file.sha256) {
      throw new Error('ZIPへ追加するファイルの整合性を確認できません');
    }
    archive[file.path] = [bytes, { mtime: FIXED_ZIP_TIMESTAMP }];
  }
  return new Blob([zipSync(archive, { level: 6 })], { type: 'application/zip' });
}
