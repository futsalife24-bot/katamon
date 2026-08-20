import { z } from 'zod';
import type { CharacterForm } from './types';

export const AI_PROPOSAL_SCHEMA_VERSION = 1 as const;

const proposalParametersSchema = z.object({
  power: z.number().finite().min(0.05).max(5).optional(),
  projectileCount: z.number().int().min(1).max(47).optional(),
  intervalMs: z.number().int().min(0).max(3_000).optional(),
  projectileSpeed: z.number().finite().min(0.1).max(5).optional(),
  gravityMultiplier: z.number().finite().min(0).max(3).optional(),
  explosionRadius: z.number().finite().min(0.1).max(5).optional(),
  penetrationCount: z.number().int().min(0).max(20).optional(),
  cooldownTurns: z.number().int().min(1).max(20).optional(),
  knockback: z.number().finite().min(0).max(500).optional(),
  statusChance: z.number().finite().min(0).max(1).optional(),
  statusDurationTurns: z.number().int().min(0).max(20).optional(),
  healing: z.number().int().min(0).max(999).optional(),
  effectRef: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/u).optional(),
  soundRef: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/u).optional(),
}).strict();

export const aiProposalSchema = z.object({
  schemaVersion: z.literal(AI_PROPOSAL_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  characterId: z.string().uuid(),
  characterSlug: z.string().min(1).max(24).regex(/^[a-z][a-z0-9-]*$/u),
  sourceRevision: z.number().int().positive(),
  sourceSchemaVersion: z.literal(1),
  specialName: z.string().trim().min(1).max(40),
  specialDescription: z.string().trim().max(200),
  specialTemplate: z.enum(['single', 'multi-shot', 'straight', 'area', 'explosion', 'piercing', 'knockback', 'healing', 'emp', 'custom-required']),
  specialParameters: proposalParametersSchema,
  motionDirection: z.string().trim().max(500),
  implementationNote: z.string().trim().max(1_000),
  status: z.enum(['draft', 'experimental', 'ready-for-preview']),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type AiProposal = z.infer<typeof aiProposalSchema>;

export interface ProposalValidationResult {
  proposal: AiProposal | null;
  errors: string[];
  warnings: string[];
  stale: boolean;
}

export interface ProposalDiff {
  field: string;
  before: string;
  after: string;
  safety: 'safe' | 'review';
}

export function validateAiProposal(raw: unknown, current?: { characterId: string; revision: number }): ProposalValidationResult {
  const parsed = aiProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { proposal: null, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}：${issue.message}`), warnings: [], stale: false };
  }
  const stale = Boolean(current && (parsed.data.characterId !== current.characterId || parsed.data.sourceRevision !== current.revision));
  return {
    proposal: parsed.data,
    errors: [],
    warnings: stale ? ['対象キャラまたは履歴が最新ではありません。最新コンテキストを再生成してください。'] : [],
    stale,
  };
}

export function diffAiProposal(current: CharacterForm, proposal: AiProposal): ProposalDiff[] {
  const diffs: ProposalDiff[] = [];
  const add = (field: string, before: unknown, after: unknown, safety: ProposalDiff['safety'] = 'review') => {
    if (after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({ field, before: String(before), after: String(after), safety });
    }
  };
  add('specialName', current.specialName, proposal.specialName, 'safe');
  add('specialDescription', current.specialDescription, proposal.specialDescription, 'safe');
  add('specialTemplate', current.specialTemplate, proposal.specialTemplate);
  for (const [field, value] of Object.entries(proposal.specialParameters)) {
    add(`specialParameters.${field}`, current.specialParameters[field as keyof typeof current.specialParameters], value);
  }
  if (proposal.implementationNote) add('implementationNote', current.customImplementationNote, proposal.implementationNote);
  return diffs;
}

/** Apply only the reviewed performance fields; identity and assets remain unchanged. */
export function applyAiProposalToCharacter(current: CharacterForm, proposal: AiProposal): CharacterForm {
  return {
    ...structuredClone(current),
    specialEnabled: true,
    specialName: proposal.specialName,
    specialDescription: proposal.specialDescription,
    specialTemplate: proposal.specialTemplate,
    specialParameters: { ...current.specialParameters, ...proposal.specialParameters },
    customImplementationNote: [
      current.customImplementationNote,
      `AI提案 ${proposal.proposalId}（実験扱い・履歴v${proposal.sourceRevision}起点）`,
      proposal.implementationNote,
    ].filter(Boolean).join('\n'),
  };
}
