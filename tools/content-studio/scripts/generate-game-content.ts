import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GENERATOR_VERSION } from '../src/domain/types';
import { validateCharacter } from '../src/domain/validation';
import {
  buildCompatibilityCatalog,
  buildContentManifest,
  canonicalCharacterRecordSchema,
  serializeCompatibilityCatalog,
  type CanonicalCharacterRecord,
} from '../src/generation/catalog';

export interface GenerateGameContentOptions {
  repoRoot: string;
  write?: boolean;
  check?: boolean;
}

export interface GenerateGameContentResult {
  recordCount: number;
  catalogPath: string;
  manifestPath: string;
  catalogText: string;
  manifestText: string;
}

async function readRecords(repoRoot: string): Promise<CanonicalCharacterRecord[]> {
  const charactersDirectory = resolve(repoRoot, 'content/characters');
  let names: string[];
  try {
    names = (await readdir(charactersDirectory)).filter((name) => name.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en-US'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const records: CanonicalCharacterRecord[] = [];
  for (const name of names) {
    const json = await readFile(resolve(charactersDirectory, name), 'utf8');
    const parsed = canonicalCharacterRecordSchema.parse(JSON.parse(json) as unknown) as CanonicalCharacterRecord;
    if (name !== `${parsed.character.slug}.json`) throw new Error('キャラクターJSONのファイル名とslugが一致しません');
    records.push(parsed);
  }
  return records;
}

function validateRecords(records: readonly CanonicalCharacterRecord[]): void {
  for (const current of records) {
    const existing = records
      .filter((candidate) => candidate !== current)
      .map(({ character }) => ({ id: character.id, slug: character.slug }));
    const errors = validateCharacter(current.character, { existing }).filter(({ severity }) => severity === 'error');
    if (errors.length > 0) throw new Error(`キャラクターデータの検証に失敗しました: ${current.character.slug}`);
  }
}

async function assertCurrent(path: string, expected: string): Promise<void> {
  let actual: string;
  try {
    actual = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`生成ファイルがありません: ${path}`);
    throw error;
  }
  if (actual !== expected) throw new Error(`生成ファイルが古くなっています: ${path}`);
}

export async function generateGameContent(options: GenerateGameContentOptions): Promise<GenerateGameContentResult> {
  const repoRoot = resolve(options.repoRoot);
  const records = await readRecords(repoRoot);
  validateRecords(records);
  const catalogText = serializeCompatibilityCatalog(buildCompatibilityCatalog(records, GENERATOR_VERSION));
  const manifestText = buildContentManifest(records, GENERATOR_VERSION);
  const catalogPath = resolve(repoRoot, 'generated/content-studio-catalog.js');
  const manifestPath = resolve(repoRoot, 'generated/content-studio-manifest.json');

  if (options.check) {
    await assertCurrent(catalogPath, catalogText);
    await assertCurrent(manifestPath, manifestText);
  } else if (options.write !== false) {
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, catalogText, 'utf8');
    await writeFile(manifestPath, manifestText, 'utf8');
  }
  return { recordCount: records.length, catalogPath, manifestPath, catalogText, manifestText };
}

function parseArguments(argv: readonly string[]): GenerateGameContentOptions {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const defaultRepoRoot = resolve(scriptDirectory, '../../..');
  const rootArgument = argv.find((value) => value.startsWith('--repo-root='));
  return {
    repoRoot: rootArgument ? rootArgument.slice('--repo-root='.length) : defaultRepoRoot,
    check: argv.includes('--check'),
    write: !argv.includes('--dry-run'),
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  generateGameContent(parseArguments(process.argv.slice(2)))
    .then(({ recordCount }) => process.stdout.write(`Content Studio: ${recordCount}件を生成しました。\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
