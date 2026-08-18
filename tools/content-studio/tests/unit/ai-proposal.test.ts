import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER } from '../../src/domain/defaults';
import { diffAiProposal, validateAiProposal, type AiProposal } from '../../src/domain/ai-proposal';

const proposal: AiProposal = {
  schemaVersion: 1,
  proposalId: '11111111-1111-4111-8111-111111111111',
  characterId: '22222222-2222-4222-8222-222222222222',
  characterSlug: 'cool-kai',
  sourceRevision: 3,
  sourceSchemaVersion: 1,
  specialName: 'Amour 握り飯',
  specialDescription: '提案テキスト',
  specialTemplate: 'multi-shot',
  specialParameters: { projectileCount: 47, power: 1.2, intervalMs: 80 },
  motionDirection: '右向きに連射、ランダム回転',
  implementationNote: '',
  status: 'experimental',
  createdAt: '2026-08-18T00:00:00.000Z',
};

describe('AI proposal contract', () => {
  it('rejects malformed values and detects stale character context', () => {
    expect(validateAiProposal({ ...proposal, specialParameters: { projectileCount: 999 } }).proposal).toBeNull();
    expect(validateAiProposal(proposal, { characterId: proposal.characterId, revision: 2 }).stale).toBe(true);
    expect(validateAiProposal(proposal, { characterId: proposal.characterId, revision: 3 }).warnings).toHaveLength(0);
  });

  it('creates a reviewable diff without mutating the current character', () => {
    const current = { ...structuredClone(DEFAULT_CHARACTER), specialName: '旧技', id: 'cool-kai', slug: 'cool-kai' };
    const diffs = diffAiProposal(current, proposal);
    expect(diffs.map((diff) => diff.field)).toContain('specialName');
    expect(diffs.map((diff) => diff.field)).toContain('specialParameters.projectileCount');
    expect(current.specialName).toBe('旧技');
  });
});
