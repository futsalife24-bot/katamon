#!/usr/bin/env node
const { scanOnly } = require('./lib/pv_pipeline');

scanOnly().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
