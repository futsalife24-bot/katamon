import { LEGACY_CHARACTERS, type LegacyCharacter } from './legacy-characters';

export const CHARACTER_DB_SCHEMA_VERSION = 1 as const;

export type CharacterRecordStatus = 'active' | 'needs-review' | 'archived';
export type CharacterAssetKind = 'source-image' | 'icon' | 'thumbnail' | 'motion' | 'skill';

export interface CharacterIdentityRecord {
  schemaVersion: typeof CHARACTER_DB_SCHEMA_VERSION;
  characterId: string;
  legacyId: string | null;
  slug: string;
  displayName: string;
  status: CharacterRecordStatus;
  controlledTags: string[];
  freeTags: string[];
  assetKey: string;
  source: 'legacy-scan' | 'content-studio' | 'imported';
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterAssetVersionRecord {
  id: string;
  characterId: string;
  kind: CharacterAssetKind;
  sourceRef: string;
  contentHash: string | null;
  version: number;
  status: 'current' | 'superseded' | 'needs-review';
  createdAt: string;
}

export interface CharacterRevisionRecord {
  id: string;
  characterId: string;
  revision: number;
  reason: 'import' | 'edit' | 'rollback' | 'publish';
  changedFields: string[];
  snapshot: Record<string, unknown>;
  createdAt: string;
}

/** A stable UUID-shaped ID lets the legacy migration be repeatable without overwriting IDs. */
export function stableCharacterId(slug: string): string {
  const parts = [0, 1, 2, 3].map((salt) => {
    let hash = 2166136261 ^ salt;
    for (const char of `${slug}:${salt}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  });
  const seed = parts.join('');
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-5${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`.toLowerCase();
}

function tagsFor(character: LegacyCharacter): { controlledTags: string[]; freeTags: string[] } {
  const controlledTags = ['legacy', 'character'];
  if (character.facesLeft) controlledTags.push('faces-left');
  return { controlledTags, freeTags: [character.asset] };
}

export function createLegacyCharacterRecord(character: LegacyCharacter, now = new Date().toISOString()): CharacterIdentityRecord {
  const tags = tagsFor(character);
  return {
    schemaVersion: CHARACTER_DB_SCHEMA_VERSION,
    characterId: stableCharacterId(character.slug),
    legacyId: character.id,
    slug: character.slug,
    displayName: character.displayName,
    status: 'active',
    ...tags,
    assetKey: character.asset,
    source: 'legacy-scan',
    currentRevision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialCharacterRecords(now = new Date().toISOString()): CharacterIdentityRecord[] {
  return LEGACY_CHARACTERS.map((character) => createLegacyCharacterRecord(character, now));
}

export function searchCharacterRecords(records: readonly CharacterIdentityRecord[], query: string): CharacterIdentityRecord[] {
  const needle = query.trim().toLocaleLowerCase('ja-JP');
  if (!needle) return [...records];
  return records.filter((record) => [record.displayName, record.characterId, record.legacyId ?? '', record.slug, ...record.controlledTags, ...record.freeTags]
    .some((value) => value.toLocaleLowerCase('ja-JP').includes(needle)));
}
