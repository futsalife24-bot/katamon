/**
 * The legacy game keeps these identifiers in its hand-written character table.
 * They are intentionally not migrated or rewritten by Content Studio.
 */
export const LEGACY_CHARACTERS = [
  { id: 'kyoryu', slug: 'kyoryu', displayName: 'ディラノ', asset: 'dirano', facesLeft: false },
  { id: 'medama', slug: 'medama', displayName: 'アイボルト', asset: 'eyebolt', facesLeft: false },
  { id: 'iwa', slug: 'iwa', displayName: 'ゴーロッカ', asset: 'gorocca', facesLeft: false },
  { id: 'tori', slug: 'tori', displayName: 'フェニーチェ', asset: 'fenice', facesLeft: false },
  { id: 'barugerukan', slug: 'barugerukan', displayName: 'バルゲルカン', asset: 'barugerukan', facesLeft: false },
  { id: 'nisenmono', slug: 'nisenmono', displayName: 'オベリスク', asset: 'obelisk', facesLeft: false },
  { id: 'burumutan', slug: 'burumutan', displayName: 'ブルームタン', asset: 'bloom-tan', facesLeft: false },
  { id: 'sumoeru', slug: 'sumoeru', displayName: 'スモエル', asset: 'sumoeru', facesLeft: false },
  { id: 'doRednote', slug: 'do-rednote', displayName: 'ドレッドアロー', asset: 'dread-arrow', facesLeft: false },
  { id: 'hamulton', slug: 'hamulton', displayName: 'ハムルトン', asset: 'hamulton', facesLeft: false },
  { id: 'mocchario', slug: 'mocchario', displayName: 'モッチャリオ', asset: 'mocchario', facesLeft: false },
  { id: 'mecha', slug: 'mecha', displayName: 'クロムギア', asset: 'chrome-gear', facesLeft: false },
  { id: 'akuma', slug: 'akuma', displayName: 'ルビデビ', asset: 'rubidevi', facesLeft: false },
  { id: 'jinba', slug: 'jinba', displayName: 'アスタウロス', asset: 'astauros', facesLeft: false },
  { id: 'kishi', slug: 'kishi', displayName: 'パラディエ', asset: 'paladier', facesLeft: false },
  { id: 'neko', slug: 'neko', displayName: 'にゃんタンク', asset: 'nyan-tank', facesLeft: false },
  { id: 'shinigami', slug: 'shinigami', displayName: 'ヨミガマ', asset: 'yomigama', facesLeft: false },
  { id: 'coolKai', slug: 'cool-kai', displayName: 'クール=カイ', asset: 'cool-kai', facesLeft: false },
] as const;

export type LegacyCharacterId = (typeof LEGACY_CHARACTERS)[number]['id'];
export type LegacyCharacter = (typeof LEGACY_CHARACTERS)[number];

export const LEGACY_CHARACTER_IDS = Object.freeze(LEGACY_CHARACTERS.map(({ id }) => id));
export const LEGACY_CHARACTER_SLUGS = Object.freeze(LEGACY_CHARACTERS.map(({ slug }) => slug));

export function getLegacyRepositoryIdentity(id: LegacyCharacterId): { id: string; slug: string } {
  const character = LEGACY_CHARACTERS.find((candidate) => candidate.id === id);
  if (!character) throw new Error('既存キャラクターが見つかりません。');
  return {
    id: /^[a-z][a-z0-9-]{0,23}$/u.test(character.id) ? character.id : character.slug,
    slug: character.slug,
  };
}
