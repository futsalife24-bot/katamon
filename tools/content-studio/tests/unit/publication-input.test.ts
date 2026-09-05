import { describe, it, expect } from 'vitest';
import { createDraft } from '../../src/domain/defaults';
import { publicationInputKey } from '../../src/domain/publication-input';
import { migrateDraft } from '../../src/storage/db';
describe('publication input binding', () => {
  it('ignores navigation, review-only controls and timestamps', () => { const d = createDraft(), before = publicationInputKey(d); d.updatedAt = 'later'; d.lastStep = 'publish'; d.preview.playing = !d.preview.playing; d.editor.zoom = 2; d.historyStatus = 'clean'; expect(publicationInputKey(d)).toBe(before); });
  it.each(['character', 'landmark', 'motion', 'image', 'hit'])('invalidates actual %s changes', kind => { const d = createDraft(), before = publicationInputKey(d); if (kind === 'character') d.character.displayName += 'edit'; if (kind === 'landmark') d.landmarks.ground.x += 0.1; if (kind === 'motion') d.motionIntensity.fire = 'strong'; if (kind === 'image') d.originalSha256 = 'a'.repeat(64); if (kind === 'hit') d.hitOriginalSha256 = 'b'.repeat(64); expect(publicationInputKey(d)).not.toBe(before); });
  it('keeps byte identity through old-schema migration without discarding old drafts', () => { const d = createDraft(); d.originalSha256 = 'a'.repeat(64); d.hitOriginalSha256 = 'b'.repeat(64); expect(publicationInputKey(migrateDraft(d))).toBe(publicationInputKey(d)); expect(migrateDraft({ ...d, schemaVersion: 4 }).id).toBe(d.id); });
});
