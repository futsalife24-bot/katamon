const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const normalize = (source) => source.replace(/^\.\//, '').replace(/[?#].*$/, '');

const gameScripts = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
  .map((match) => normalize(match[1]));
const appShellSource = /const APP_SHELL\s*=\s*\[([\s\S]*?)\];/.exec(serviceWorker)?.[1];
assert.ok(appShellSource, 'sw.js に APP_SHELL が必要です。');
const appShell = new Set([...appShellSource.matchAll(/["']([^"']+)["']/g)].map((match) => normalize(match[1])));

function assertAppShellIncludes(sources) {
  const missing = sources.filter((source) => !appShell.has(source));
  assert.deepEqual(missing, [], `APP_SHELL に未登録のscript: ${missing.join(', ')}`);
}

assert.ok(gameScripts.length > 0, 'index.html に外部scriptが必要です。');
for (const source of gameScripts) {
  assert.ok(fs.existsSync(path.join(root, source)), `script実体がありません: ${source}`);
}
assertAppShellIncludes(gameScripts);
assert.throws(
  () => assertAppShellIncludes([...gameScripts, '__app_shell_test_missing__.js']),
  /APP_SHELL に未登録のscript/,
  'scriptをAPP_SHELLへ追加し忘れた壊れ方を検出できること',
);

console.log(`APP_SHELL: ${gameScripts.length} script、登録漏れなし（3/3 passed）`);
