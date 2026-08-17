#!/usr/bin/env node
const { qaOnly } = require('./lib/pv_pipeline');

qaOnly(process.argv[2] || 'final').catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
