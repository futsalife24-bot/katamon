/**
 * The legacy game keeps these identifiers in its hand-written character table.
 * They are intentionally not migrated or rewritten by Content Studio.
 */
export const LEGACY_CHARACTERS = [
  { id: 'kyoryu', slug: 'kyoryu' },
  { id: 'medama', slug: 'medama' },
  { id: 'iwa', slug: 'iwa' },
  { id: 'tori', slug: 'tori' },
  { id: 'barugerukan', slug: 'barugerukan' },
  { id: 'nisenmono', slug: 'nisenmono' },
  { id: 'burumutan', slug: 'burumutan' },
  { id: 'sumoeru', slug: 'sumoeru' },
  { id: 'doRednote', slug: 'do-rednote' },
  { id: 'mocchario', slug: 'mocchario' },
  { id: 'mecha', slug: 'mecha' },
  { id: 'akuma', slug: 'akuma' },
  { id: 'jinba', slug: 'jinba' },
  { id: 'kishi', slug: 'kishi' },
  { id: 'neko', slug: 'neko' },
  { id: 'shinigami', slug: 'shinigami' },
] as const;

export type LegacyCharacterId = (typeof LEGACY_CHARACTERS)[number]['id'];

export const LEGACY_CHARACTER_IDS = Object.freeze(LEGACY_CHARACTERS.map(({ id }) => id));
export const LEGACY_CHARACTER_SLUGS = Object.freeze(LEGACY_CHARACTERS.map(({ slug }) => slug));
