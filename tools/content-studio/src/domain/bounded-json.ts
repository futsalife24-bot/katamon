/** Check structural depth before JSON.parse creates a deeply nested object. Never echo input. */
export function parseBoundedJson(text: string): unknown {
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { if (++depth > 32) throw new Error('JSONの階層が深すぎます。'); }
    else if (char === '}' || char === ']') depth--;
  }
  return JSON.parse(text);
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('応答の容量が上限を超えています。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('応答が空です。');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('応答の容量が上限を超えています。');
      text += decoder.decode(next.value, {stream: true});
    }
    text += decoder.decode();
    return text ? parseBoundedJson(text) : {};
  } finally { await reader.cancel().catch(() => undefined); }
}
