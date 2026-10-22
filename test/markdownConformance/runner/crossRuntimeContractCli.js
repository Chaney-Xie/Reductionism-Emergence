#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const overridesDefault = require('../overrides/viewerOverrides.json');
const {
  parseArguments,
  scenarioDocument,
  writeOutput
} = require('./finalTraceEvidenceCli');
const {
  compareNormalizedCrossRuntimeEvidence,
  isCleanNormalizedCrossRuntimeEvidence
} = require('./crossRuntimeContract');

function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function usage() {
  return [
    'Normalized O1 ↔ V1 behavioral evidence comparator',
    '',
    'node test/markdownConformance/runner/crossRuntimeContractCli.js \\',
    '  --scenarios test/markdownConformance/scenarios/generated-v0.3.json \\',
    '  --scenario-ids-from /tmp/selected-scenario-ids.json \\',
    '  --obsidian /tmp/o1-v1.json --viewer /tmp/o1-v1.json \\',
    '  --output /tmp/normalized-comparison.json',
    '',
    'Scenario generation flags match finalTraceEvidenceCli.js.',
    'Optional: --overrides FILE --require-clean'
  ].join('\n');
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
  const result = compareNormalizedCrossRuntimeEvidence(
    scenarios,
    obsidian,
    viewer,
    overrides
  );
  writeOutput(result, options.output || '-');
  if (options['require-clean'] && !isCleanNormalizedCrossRuntimeEvidence(result)) {
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

module.exports = Object.freeze({ main, usage });
