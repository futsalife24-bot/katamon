import { describe, expect, it } from 'vitest';

import { createDraft } from '../../src/domain/defaults';
import { DraftMigrationError, exportDraftJson, importDraftJson, migrateDraft } from '../../src/domain/migrations';
import { DRAFT_SCHEMA_VERSION } from '../../src/domain/types';

describe('draft migrations', () => {
  it('migrates a v1 draft and preserves workflow data', () => {
    const original = createDraft('11111111-1111-4111-8111-111111111111');
    const legacy: Record<string, unknown> = {
      ...original,
      schemaVersion: 1,
      step: 'motion',
    };
    delete legacy.lastStep;
    delete legacy.processingOperations;
    delete legacy.historyStatus;
    delete legacy.mockScenario;
    const migrated = migrateDraft(legacy);
    expect(migrated.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(migrated.lastStep).toBe('motion');
    expect(migrated.processingOperations).toEqual([]);
  });

  it('round-trips current drafts as JSON', () => {
    const draft = createDraft('22222222-2222-4222-8222-222222222222');
    expect(importDraftJson(exportDraftJson(draft))).toEqual(draft);
  });

  it('v4の目マーカーを破棄し、被弾用画像なしの現行下書きへ移行する', () => {
    const legacy = createDraft('44444444-4444-4444-8444-444444444444') as unknown as Record<string, unknown>;
    legacy.schemaVersion = 4;
    legacy.landmarks = {
      ...(legacy.landmarks as Record<string, unknown>),
      eyes: [{ id: 'eye-1', x: 0.6, y: 0.3, size: 0.06 }],
    };
    delete legacy.hitImageInfo;
    const migrated = migrateDraft(legacy);
    expect(migrated.hitImageInfo).toBeNull();
    expect(migrated.landmarks).not.toHaveProperty('eyes');
  });

  it('rejects future versions and dangerous fields', () => {
    expect(() => migrateDraft({ schemaVersion: 999 })).toThrow(DraftMigrationError);
    expect(() => migrateDraft({ schemaVersion: '1' })).toThrow(DraftMigrationError);
    const draft = createDraft('33333333-3333-4333-8333-333333333333');
    expect(() => migrateDraft({ ...draft, title: '<script>unsafe()</script>' })).toThrow(DraftMigrationError);
  });
});
