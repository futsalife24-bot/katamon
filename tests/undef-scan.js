const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IDENTIFIER = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const BUILT_INS = new Set(['NaN', 'JSON', 'URL', 'GET', 'PUT', 'POST', 'DELETE']);

function findMissingUppercaseIdentifiers(script) {
  let body = script
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const pattern of [
    /`(?:[^`\\]|\\.)*`/g,
    /'(?:[^'\\\n]|\\.)*'/g,
    /"(?:[^"\\\n]|\\.)*"/g,
  ]) body = body.replace(pattern, ' "" ');

  const used = new Set(body.match(IDENTIFIER) || []);
  const declared = new Set([...body.matchAll(/(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]{2,})\b/g)].map((match) => match[1]));
  for (const match of body.matchAll(/([A-Z][A-Z0-9_]{2,})\s*(?:=|,)/g)) {
    if (used.has(match[1])) declared.add(match[1]);
  }
  const properties = new Set([...body.matchAll(/\.\s*([A-Z][A-Z0-9_]{2,})\b/g)].map((match) => match[1]));
  const objectKeys = new Set([...body.matchAll(/([A-Z][A-Z0-9_]{2,})\s*:/g)].map((match) => match[1]));
  return [...used].filter((name) => !declared.has(name) && !properties.has(name) && !objectKeys.has(name) && !BUILT_INS.has(name)).sort();
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
assert.ok(inlineScript, 'index.html にインラインのゲームscriptが必要です。');

const missing = findMissingUppercaseIdentifiers(inlineScript);
assert.deepEqual(missing, [], `宣言が見つからない大文字識別子: ${missing.join(', ')}`);
assert.deepEqual(
  findMissingUppercaseIdentifiers('const DECLARED = 1; MISSING_TOKEN;').filter((name) => name === 'MISSING_TOKEN'),
  ['MISSING_TOKEN'],
  '検査器自身が未定義識別子を検出できること',
);

console.log('未定義大文字識別子: なし（2/2 passed）');
