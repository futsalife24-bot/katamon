export const REQUIRED_STUDIO_CHECKS = ['Type, unit, integration, build and regression', 'Android 13 portrait Chromium E2E'] as const;
export const GITHUB_ACTIONS_APP_ID = 15368;
export function safeMergeProtection(value: unknown): boolean {
  const p = value as { required_status_checks?: { strict?: boolean; checks?: { context: string; app_id: number }[]; contexts?: string[] }; enforce_admins?: { enabled: boolean }; required_pull_request_reviews?: { bypass_pull_request_allowances?: Record<string, unknown[]> }; allow_force_pushes?: { enabled: boolean }; allow_deletions?: { enabled: boolean } } | null;
  if (!p?.enforce_admins?.enabled || !p.required_status_checks?.strict || p.allow_force_pushes?.enabled !== false || p.allow_deletions?.enabled !== false) return false;
  const checks = p.required_status_checks.checks;
  if (!checks || !REQUIRED_STUDIO_CHECKS.every(name => checks.some(c => c.context === name && c.app_id === GITHUB_ACTIONS_APP_ID))) return false;
  const bypass = p.required_pull_request_reviews?.bypass_pull_request_allowances;
  return !bypass || Object.values(bypass).every(items => Array.isArray(items) && items.length === 0);
}

/** appId=null is GitHub's explicitly unbound context (null response/-1/legacy contexts), not a discarded source. */
export interface RequiredCheck { context: string; appId: number | null; }
export function requiredChecksFromProtection(value: unknown): RequiredCheck[] {
  const p = value as { required_status_checks?: { contexts?: unknown; checks?: unknown } };
  const raw = p?.required_status_checks;
  if (!raw || !Array.isArray(raw.contexts) || !Array.isArray(raw.checks)) throw new Error('必須CI設定の形式を確認できません。');
  const result = new Map<string, RequiredCheck>();
  for (const v of raw.checks) {
    const c = v as { context: unknown; app_id: unknown };
    if (typeof c.context !== 'string' || !c.context.trim() || !(c.app_id === null || (Number.isSafeInteger(c.app_id) && ((c.app_id as number) > 0 || c.app_id === -1)))) throw new Error('必須CIの実行元設定が未対応または不正です。');
    const appId = c.app_id === -1 ? null : c.app_id as number;
    if (result.has(c.context) && result.get(c.context)!.appId !== appId) throw new Error('同名の必須CIに異なる実行元が設定されています。');
    result.set(c.context, { context: c.context, appId });
  }
  for (const context of raw.contexts) {
    if (typeof context !== 'string' || !context.trim()) throw new Error('必須status contextが不正です。');
    if (!result.has(context)) result.set(context, { context, appId: null });
  }
  return [...result.values()];
}
