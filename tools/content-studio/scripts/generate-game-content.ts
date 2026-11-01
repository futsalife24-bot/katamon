import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GENERATOR_VERSION } from '../src/domain/types';
import { buildRegistrationCandidate, serializeRegistration } from '../src/generation/registration';
import { validateCharacter } from '../src/domain/validation';
import { LEGACY_CHARACTERS } from '../src/domain/legacy-characters';
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
    const errors = validateCharacter(current.character, { existing, includeLegacy: !current.legacyTargetId }).filter(({ severity }) => severity === 'error');
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

async function applyGeneratedMotionManifest(repoRoot: string, catalog: ReturnType<typeof buildCompatibilityCatalog>): Promise<void> {
  const manifestPath = resolve(repoRoot, 'content/generated-motion-manifest.json');
  let raw: string;
  try { raw = await readFile(manifestPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const manifest = JSON.parse(raw) as { schemaVersion?: number; characters?: Record<string, {
    asset?: string; slug?: string; motionSheets?: Record<string, string>; motionMetadata?: Record<string, string>;
  }> };
  if (manifest.schemaVersion !== 1 || !manifest.characters || Array.isArray(manifest.characters)) throw new Error('motion manifest schema');
  const clips = ['move-forward', 'move-backward', 'fire', 'hit', 'land'] as const;
  for (const id of [...LEGACY_CHARACTERS.map(character => character.id), ...Object.keys(manifest.characters).filter(id => !LEGACY_CHARACTERS.some(character => character.id === id))]) {
    const binding = manifest.characters[id];
    if (!binding) continue;
    const legacy = LEGACY_CHARACTERS.find(character => character.id === id);
    if (!legacy || binding.asset !== legacy.asset || binding.slug !== legacy.slug) throw new Error(`motion manifest identity: ${id}`);
    if (!binding.motionSheets || !binding.motionMetadata || Object.keys(binding.motionSheets).length !== 5 || Object.keys(binding.motionMetadata).length !== 5) throw new Error(`motion manifest clips: ${id}`);
    for (const clip of clips) {
      const png = binding.motionSheets[clip];
      const json = binding.motionMetadata[clip];
      if (typeof png !== 'string' || !new RegExp(`^assets/content-studio/${legacy.slug}/[a-f0-9]{12}/${clip}\\.png$`).test(png)
          || json !== png.slice(0, -4) + '.json') throw new Error(`motion manifest path: ${id}/${clip}`);
      await readFile(resolve(repoRoot, png));
      await readFile(resolve(repoRoot, json));
    }
    const existing = catalog.characters[id];
    if (existing && existing.legacyTargetId !== id) throw new Error(`motion manifest collision: ${id}`);
    catalog.characters[id] = { ...(existing ?? {}), key: id, legacyTargetId: id,
      motionSheets: binding.motionSheets, motionMetadata: binding.motionMetadata } as typeof catalog.characters[string];
    if (!catalog.order.includes(id)) catalog.order.push(id);
  }
}

export async function generateGameContent(options: GenerateGameContentOptions): Promise<GenerateGameContentResult> {
  const repoRoot = resolve(options.repoRoot);
  const records = await readRecords(repoRoot);
  validateRecords(records);
  const catalog = buildCompatibilityCatalog(records, GENERATOR_VERSION);
  await applyGeneratedMotionManifest(repoRoot, catalog);
  const catalogText = serializeCompatibilityCatalog(catalog);
  const manifestText = buildContentManifest(records, GENERATOR_VERSION);
  const catalogPath = resolve(repoRoot, 'generated/content-studio-catalog.js');
  const manifestPath = resolve(repoRoot, 'generated/content-studio-manifest.json');
  const registryPath = resolve(repoRoot, 'generated/content-studio-registration.json');
  const registryText = serializeRegistration(await buildRegistrationCandidate(records,
    await readFile(resolve(repoRoot, 'index.html'), 'utf8'), async path => readFile(resolve(repoRoot, path))));

  if (options.check) {
    await assertCurrent(catalogPath, catalogText);
    await assertCurrent(manifestPath, manifestText);
    await assertCurrent(registryPath, registryText);
  } else if (options.write !== false) {
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, catalogText, 'utf8');
    await writeFile(manifestPath, manifestText, 'utf8');
    await writeFile(registryPath, registryText, 'utf8');
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
