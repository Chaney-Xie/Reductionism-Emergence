#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isCleanOracleReplay,
  validateRepairGateOracleReplay
} = require('./repairGateOracleReplay');
const { stableStringify } = require('./utils');

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'require-reproducible') {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    'Repair-gate O1 oracle replay validator',
    '',
    'node test/markdownConformance/runner/repairGateOracleReplayCli.js \\',
    '  --gate /tmp/generated-repair-gate.json \\',
    '  --obsidian /tmp/repair-gate-o1.json \\',
    '  --output /tmp/repair-gate-o1-replay.json [--require-reproducible]',
    '',
    '--obsidian accepts realRuntimeCli output or an Obsidian observations[] envelope.',
    '--require-reproducible exits 2 unless every embedded oracle is reproducible.'
  ].join('\n');
}

function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function writeOutput(value, filename = '-') {
  const serialized = `${stableStringify(value)}\n`;
  if (filename === '-') process.stdout.write(serialized);
  else {
    const destination = path.resolve(filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, 'utf8');
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = validateRepairGateOracleReplay(
    readJson(options.gate, '--gate'),
    readJson(options.obsidian, '--obsidian')
  );
  writeOutput(result, options.output || '-');
  if (options['require-reproducible'] && !isCleanOracleReplay(result)) {
    process.exitCode = 2;
  }
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ main, parseArguments, usage, writeOutput });
