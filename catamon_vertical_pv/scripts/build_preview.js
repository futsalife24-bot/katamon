#!/usr/bin/env node
const { build } = require('./lib/pv_pipeline');

build('preview').catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
