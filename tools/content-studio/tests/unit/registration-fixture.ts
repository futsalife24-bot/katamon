import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEGACY_CHARACTERS } from '../../src/domain/legacy-characters';
const root = new URL('../../../../', import.meta.url);
export function registrationBaseFiles(): Array<{path:string; bytes:Buffer}> {
  return ['index.html', ...LEGACY_CHARACTERS.flatMap(character => [
    `assets/characters/runtime/${character.asset}.webp`, `assets/characters/master/${character.asset}.png`,
  ])].map(path => ({ path, bytes:readFileSync(fileURLToPath(new URL(path,root))) }));
}
