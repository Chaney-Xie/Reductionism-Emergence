#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fixturesDefault = require('../fixtures/canonicalFixtures.json');
const overridesDefault = require('../overrides/viewerOverrides.json');
const { generateRandomSequences } = require('./randomSequences');
const { stableStringify } = require('./utils');
const {
  compareFinalTraceEvidence,
  isCleanFinalTrace,
  selectScenariosByEvidenceIds
} = require('./finalTraceEvidence');

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
    if (key === 'require-clean') {
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
    'O1 ↔ V1 final-trace evidence comparator',
    '',
    'node test/markdownConformance/runner/finalTraceEvidenceCli.js \\',
    '  --scenarios /tmp/generated-random.json \\',
    '  --obsidian test/markdownConformance/evidence/random-v0.3-o1.json \\',
    '  --viewer test/markdownConformance/evidence/random-v0.3-v1.json \\',
    '  --output test/markdownConformance/evidence/random-v0.3-comparison.json',
    '',
    'Instead of --scenarios, deterministically regenerate random scenarios with:',
    '  --seed STRING --count N [--min-actions N] [--max-actions N] [--fixtures FILE]',
    '',
    'Optional: --scenario-ids-from FILE --overrides FILE --require-clean',
    '--scenario-ids-from selects, in listed order, string scenarios[] from the generated corpus.',
    '--require-clean exits 2 unless every scenario is MATCH or INTENTIONAL_VIEWER_OVERRIDE.'
  ].join('\n');
}

function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function scenarioDocument(options) {
  let document;
  if (options.scenarios) {
    document = readJson(options.scenarios, '--scenarios');
  } else {
    if (!options.seed || !options.count) {
      throw new Error('Supply --scenarios FILE, or both --seed STRING and --count N.');
    }
    const fixtures = options.fixtures
      ? readJson(options.fixtures, '--fixtures')
      : fixturesDefault;
    document = generateRandomSequences(fixtures, {
      seed: options.seed,
      count: positiveInteger(options.count, '--count'),
      minimumActions: options['min-actions'] == null
        ? undefined
        : positiveInteger(options['min-actions'], '--min-actions'),
      maximumActions: options['max-actions'] == null
        ? undefined
        : positiveInteger(options['max-actions'], '--max-actions')
    });
  }
  return options['scenario-ids-from']
    ? selectScenariosByEvidenceIds(
        document,
        readJson(options['scenario-ids-from'], '--scenario-ids-from')
      )
    : document;
}

function writeOutput(value, filename = '-') {
  const serialized = `${stableStringify(value)}\n`;
  if (filename === '-') {
    process.stdout.write(serialized);
    return;
  }
  const destination = path.resolve(filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, serialized, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const scenarios = scenarioDocument(options);
  const obsidian = readJson(options.obsidian, '--obsidian');
  const viewer = readJson(options.viewer, '--viewer');
  const overrides = options.overrides
    ? readJson(options.overrides, '--overrides')
    : overridesDefault;
  const result = compareFinalTraceEvidence(scenarios, obsidian, viewer, overrides);
  writeOutput(result, options.output || '-');
  if (options['require-clean'] && !isCleanFinalTrace(result)) process.exitCode = 2;
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

module.exports = Object.freeze({
  main,
  parseArguments,
  scenarioDocument,
  usage,
  writeOutput
});
