import type { CharacterForm, ValidationIssue } from './types.js';
import { LEGACY_CHARACTERS } from './legacy-characters.js';
import { characterFormSchema } from './schemas.js';
import { getUnsafePathReason } from './security.js';

export interface CharacterIdentity {
  id: string;
  slug: string;
}

export interface CharacterValidationContext {
  existing?: readonly CharacterIdentity[];
  includeLegacy?: boolean;
  current?: CharacterIdentity;
}

const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');

function addCollisionIssue(
  issues: ValidationIssue[],
  field: 'id' | 'slug',
  value: string,
  candidate: CharacterIdentity,
  source: 'legacy' | 'canonical',
) {
  const candidateValue = candidate[field];
  if (fold(candidateValue) !== fold(value)) return;

  const exact = candidateValue === value;
  issues.push({
    severity: 'error',
    code: `${field}.${source}_${exact ? 'duplicate' : 'case_collision'}`,
    field,
    message: exact
      ? `${field} は登録済みです`
      : `${field} は大文字・小文字だけが異なる登録済み値と衝突します`,
  });
}

export function validateCharacter(
  input: unknown,
  context: CharacterValidationContext = {},
): ValidationIssue[] {
  const result = characterFormSchema.safeParse(input);
  const issues: ValidationIssue[] = result.success
    ? []
    : result.error.issues.map((issue) => ({
        severity: 'error',
        code: 'schema.invalid',
        field: issue.path.join('.'),
        message: issue.message,
      }));

  if (!input || typeof input !== 'object') return issues;
  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const slug = typeof record.slug === 'string' ? record.slug : null;
  if (!id || !slug) return issues;

  const current = context.current;
  const isCurrent = (candidate: CharacterIdentity) =>
    current !== undefined && fold(candidate.id) === fold(current.id) && fold(candidate.slug) === fold(current.slug);

  if (context.includeLegacy !== false) {
    for (const candidate of LEGACY_CHARACTERS) {
      addCollisionIssue(issues, 'id', id, candidate, 'legacy');
      addCollisionIssue(issues, 'slug', slug, candidate, 'legacy');
    }
  }

  for (const candidate of context.existing ?? []) {
    if (isCurrent(candidate)) continue;
    addCollisionIssue(issues, 'id', id, candidate, 'canonical');
    addCollisionIssue(issues, 'slug', slug, candidate, 'canonical');
  }

  return deduplicateIssues(issues);
}

export function assertValidCharacter(input: unknown, context: CharacterValidationContext = {}): CharacterForm {
  const issues = validateCharacter(input, context);
  const errors = issues.filter(({ severity }) => severity === 'error');
  if (errors.length > 0) {
    throw new CharacterValidationError(errors);
  }
  return characterFormSchema.parse(input) as CharacterForm;
}

export function isAllowedGeneratedPath(path: string): boolean {
  if (getUnsafePathReason(path) !== null || path.includes('//')) return false;
  return (
    /^content\/characters\/[a-z][a-z0-9-]{0,23}\.json$/u.test(path) ||
    /^generated\/content-studio-(?:catalog\.js|manifest\.json)$/u.test(path) ||
    /^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}\/(?:source\.(?:png|jpe?g|webp)|character\.(?:png|webp)|icon\.png|thumbnail\.webp|idle\.(?:png|json)|(?:move-forward|move-backward|fire|hit|land)\.(?:png|json)|preview\.png)$/u.test(path)
  );
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const unique = new Map<string, ValidationIssue>();
  for (const issue of issues) {
    unique.set(`${issue.severity}\u0000${issue.code}\u0000${issue.field ?? ''}`, issue);
  }
  return [...unique.values()];
}

export class CharacterValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('キャラクターデータを検証できませんでした');
    this.name = 'CharacterValidationError';
    this.issues = issues;
  }
}
