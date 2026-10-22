#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildNoEarlyDivergenceCorpus,
  buildRepairGate
} = require('./randomPrefixRepairArtifacts');
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

function writeJson(filename, value, label) {
  if (!filename) throw new Error(`${label} is required.`);
  const destination = path.resolve(filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${stableStringify(value)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const source = readJson(options.source, '--source');
  const prefixes = readJson(options.prefixes, '--prefixes');
  const obsidian = readJson(options.obsidian, '--obsidian');
  const viewer = readJson(options.viewer, '--viewer');
  const gate = buildRepairGate(prefixes, obsidian, viewer);
  const noEarly = buildNoEarlyDivergenceCorpus(source, prefixes, obsidian, viewer);
  writeJson(options['gate-output'], gate, '--gate-output');
  writeJson(options['no-early-output'], noEarly, '--no-early-output');
  return { gate, noEarly };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ main, parseArguments, readJson, writeJson });
