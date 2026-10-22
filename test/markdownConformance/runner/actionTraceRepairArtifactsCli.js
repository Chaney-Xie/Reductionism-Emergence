#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildActionTraceRepairGate } = require('./actionTraceRepairArtifacts');
const { stableStringify } = require('./utils');

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!options.output) throw new Error('--output is required.');
  const gate = buildActionTraceRepairGate(
    readJson(options.scenarios, '--scenarios'),
    readJson(options.comparison, '--comparison'),
    readJson(options.obsidian, '--obsidian'),
    readJson(options.viewer, '--viewer'),
    options['o1-replay']
      ? readJson(options['o1-replay'], '--o1-replay')
      : null
  );
  const destination = path.resolve(options.output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${stableStringify(gate)}\n`, 'utf8');
  return gate;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ main, parseArguments, readJson });
