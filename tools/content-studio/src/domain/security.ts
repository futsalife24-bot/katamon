const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const HTML_TAG = /<\s*\/?\s*[a-z][^>]*>/iu;
const EVENT_HANDLER = /\bon[a-z]+\s*=/iu;
const ACTIVE_SCHEME = /(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/iu;
const SCRIPT_BREAKOUT = /<\s*\/\s*script\s*>/iu;
const ENCODED_PATH_SEPARATOR = /%(?:2e|2f|5c)/iu;

export type UnsafeTextReason =
  | 'control-character'
  | 'html'
  | 'active-content'
  | 'path-traversal';

/** Returns the first security reason without echoing the unsafe input. */
export function getUnsafeTextReason(value: string): UnsafeTextReason | null {
  const normalized = value.normalize('NFKC');
  if (UNSAFE_CONTROL_CHARACTER.test(normalized)) return 'control-character';
  if (HTML_TAG.test(normalized) || SCRIPT_BREAKOUT.test(normalized)) return 'html';
  if (EVENT_HANDLER.test(normalized) || ACTIVE_SCHEME.test(normalized)) return 'active-content';
  return null;
}

export function getUnsafePathReason(value: string): UnsafeTextReason | null {
  const textReason = getUnsafeTextReason(value);
  if (textReason) return textReason;

  const normalized = value.normalize('NFKC');
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '.') ||
    ENCODED_PATH_SEPARATOR.test(normalized)
  ) {
    return 'path-traversal';
  }
  return null;
}

export function isSafePlainText(value: string): boolean {
  return getUnsafeTextReason(value) === null;
}

export function isSafeRepositoryPath(value: string): boolean {
  return getUnsafePathReason(value) === null;
}
