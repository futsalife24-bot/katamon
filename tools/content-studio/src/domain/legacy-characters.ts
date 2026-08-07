/**
 * The legacy game keeps these identifiers in its hand-written character table.
 * They are intentionally not migrated or rewritten by Content Studio.
 */
export const LEGACY_CHARACTERS = [
  { id: 'kyoryu', slug: 'kyoryu', displayName: '恐竜', asset: 'kyoryu', facesLeft: false },
  { id: 'medama', slug: 'medama', displayName: '目玉', asset: 'medama', facesLeft: false },
  { id: 'iwa', slug: 'iwa', displayName: '岩', asset: 'iwa', facesLeft: false },
  { id: 'tori', slug: 'tori', displayName: '鳥', asset: 'tori', facesLeft: false },
  { id: 'barugerukan', slug: 'barugerukan', displayName: 'バルゲルカン', asset: 'barugerukan', facesLeft: false },
  { id: 'nisenmono', slug: 'nisenmono', displayName: 'ニセンモノ', asset: 'nisenmono', facesLeft: false },
  { id: 'burumutan', slug: 'burumutan', displayName: 'ブルームタン', asset: 'burumutan', facesLeft: false },
  { id: 'sumoeru', slug: 'sumoeru', displayName: 'スモエル', asset: 'sumoeru', facesLeft: true },
  { id: 'doRednote', slug: 'do-rednote', displayName: '弩レッドノート', asset: 'do-rednote', facesLeft: true },
  { id: 'mocchario', slug: 'mocchario', displayName: 'モッチャリオ', asset: 'mocchario', facesLeft: false },
  { id: 'mecha', slug: 'mecha', displayName: 'メカ', asset: 'mecha', facesLeft: false },
  { id: 'akuma', slug: 'akuma', displayName: '悪魔', asset: 'akuma', facesLeft: true },
  { id: 'jinba', slug: 'jinba', displayName: '人馬', asset: 'jinba', facesLeft: false },
  { id: 'kishi', slug: 'kishi', displayName: '騎士', asset: 'kishi', facesLeft: true },
  { id: 'neko', slug: 'neko', displayName: '猫', asset: 'neko', facesLeft: true },
  { id: 'shinigami', slug: 'shinigami', displayName: '死神', asset: 'shinigami', facesLeft: false },
] as const;

export type LegacyCharacterId = (typeof LEGACY_CHARACTERS)[number]['id'];
export type LegacyCharacter = (typeof LEGACY_CHARACTERS)[number];

export const LEGACY_CHARACTER_IDS = Object.freeze(LEGACY_CHARACTERS.map(({ id }) => id));
export const LEGACY_CHARACTER_SLUGS = Object.freeze(LEGACY_CHARACTERS.map(({ slug }) => slug));

export function getLegacyRepositoryIdentity(id: LegacyCharacterId): { id: string; slug: string } {
  const character = LEGACY_CHARACTERS.find((candidate) => candidate.id === id);
  if (!character) throw new Error('既存キャラクターが見つかりません。');
  return {
    id: character.id === 'doRednote' ? character.slug : character.id,
    slug: character.slug,
  };
}
