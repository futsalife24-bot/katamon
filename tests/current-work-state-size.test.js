const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const maxBytes = 30 * 1024;
const statePath = path.join(__dirname, '..', 'CURRENT_WORK_STATE.md');
const byteLength = fs.statSync(statePath).size;

assert.ok(
  byteLength <= maxBytes,
  `CURRENT_WORK_STATE.md is ${byteLength} bytes; keep it at or below ${maxBytes} bytes and archive completed details in docs/CHANGELOG.md.`,
);

console.log(`CURRENT_WORK_STATE.md: ${byteLength}/${maxBytes} bytes (1/1 passed)`);
