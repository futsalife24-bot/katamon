import registration, { type RegistrationCandidate } from '../../../../shared/content-studio-registration.js';
import { buildCompatibilityCatalog, type CanonicalCharacterRecord } from './catalog.js';
import { LEGACY_CHARACTERS } from '../domain/legacy-characters.js';

/** Parse the game's literal declaration, not JavaScript execution. Expressions fail closed. */
export function readLegacyDefinitions(source: string): Record<string, Record<string, unknown>> {
  const marker = 'const LEGACY_CHARACTERS = ';
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('registry.legacySource');
  let at = start + marker.length;
  const ws = () => { for (;;) { const match = /^(?:\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/.exec(source.slice(at)); if (!match) break; at += match[0].length; } };
  const value = (depth = 0): unknown => {
    ws(); if (depth > 8) throw new Error('registry.legacyDepth');
    const ch = source[at++];
    if (ch === '{') {
      const result: Record<string, unknown> = {};
      ws();
      while (source[at] !== '}') {
        const key = /^[a-zA-Z][a-zA-Z0-9_]*/.exec(source.slice(at));
        if (!key || ['__proto__','constructor','prototype'].includes(key[0]) || Object.hasOwn(result, key[0])) throw new Error('registry.legacyKey');
        at += key[0].length; ws(); if (source[at++] !== ':') throw new Error('registry.legacySyntax');
        result[key[0]] = value(depth + 1); ws();
        if (source[at] === ',') { at++; ws(); } else if (source[at] !== '}') throw new Error('registry.legacySyntax');
      }
      at++; return result;
    }
    if (ch === '[') {
      const result: unknown[] = []; ws();
      while (source[at] !== ']') { result.push(value(depth + 1)); ws(); if (source[at] === ',') { at++; ws(); } else if (source[at] !== ']') throw new Error('registry.legacySyntax'); }
      at++; return result;
    }
    if (ch === "'" || ch === '"') {
      let text = '';
      while (at < source.length) {
        const c = source[at++]; if (c === ch) return text;
        if (c === '\\') { const escaped = source[at++]; if (!['\\', "'", '"'].includes(escaped)) throw new Error('registry.legacyEscape'); text += escaped; }
        else { if (c === '\n' || c === '\r') throw new Error('registry.legacyString'); text += c; }
      }
      throw new Error('registry.legacyString');
    }
    at--;
    const token = /^(?:-?\d+(?:\.\d+)?|true|false|null)(?=\s|,|\]|\})/.exec(source.slice(at));
    if (!token) throw new Error('registry.legacyExpression'); at += token[0].length; return JSON.parse(token[0]);
  };
  const result = value() as Record<string, Record<string, unknown>>;
  ws(); if (source[at] !== ';') throw new Error('registry.legacySyntax');
  if (Object.keys(result).sort().join('|') !== LEGACY_CHARACTERS.map(c => c.id).sort().join('|')) throw new Error('registry.legacyList');
  return result;
}

export async function buildRegistrationCandidate(
  records: readonly CanonicalCharacterRecord[], gameSource: string,
  readAsset: (path: string) => Promise<Uint8Array>,
): Promise<RegistrationCandidate> {
  const legacy = readLegacyDefinitions(gameSource);
  const catalog = buildCompatibilityCatalog(records);
  const definitions: Record<string, Record<string, unknown>> = { ...legacy };
  for (const [id, character] of Object.entries(catalog.characters)) if (!character.legacyTargetId) definitions[id] = { ...character };
  const characters: Record<string, unknown> = {};
  for (const id of Object.keys(definitions).sort()) {
    const def = { ...definitions[id] };
    delete def.motionSheets; delete def.motionMetadata;
    const source = catalog.characters[id];
    const appearance = { motionSheets: source?.motionSheets ?? null, motionMetadata: source?.motionMetadata ?? null };
    const slug = LEGACY_CHARACTERS.find(c => c.id === id)?.slug ?? source?.slug;
    if (!slug) throw new Error('registry.slug');
    const paths = new Set<string>(legacy[id] ? [`assets/characters/runtime/${def.asset}.webp`, `assets/characters/master/${def.asset}.png`]
      : [`${def.assetBase}.webp`, `${def.assetBase}.png`, String(def.icon), String(def.idleSheet), String(def.idleMetadata)]);
    Object.values(appearance).forEach(map => { if (map) Object.values(map).forEach(path => paths.add(path)); });
    const assets = [];
    for (const path of [...paths].sort()) {
      if (!registration.assetPath(path)) throw new Error('registry.assetPath');
      const bytes = await readAsset(path);
      if (bytes.byteLength > 6 * 1024 * 1024 || bytes.byteLength < 1) throw new Error('registry.assetCapacity');
      assets.push({ path, sha256: await registration.hash(bytes), bytes: bytes.byteLength });
    }
    characters[id] = { gameId: id, slug, legacy: Boolean(legacy[id]), definition: def,
      definitionHash: await registration.hash(registration.stable(registration.gameplayDefinition(def))), appearance, assets };
  }
  return registration.create(characters);
}

export function serializeRegistration(candidate: RegistrationCandidate): string { return registration.stable(candidate) + '\n'; }
