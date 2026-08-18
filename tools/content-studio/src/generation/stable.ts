export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort((left, right) => left.localeCompare(right, 'en-US'))
        .map((key) => [key, sortJsonValue(record[key])]),
    );
  }
  return value;
}

export function stableStringify(value: unknown, space = 2): string {
  return JSON.stringify(sortJsonValue(value), null, space);
}

export function stableJsonFile(value: unknown): string {
  return `${stableStringify(value, 2)}\n`;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
