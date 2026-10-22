#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateScenarios } = require('../scenarios/generator');
const {
  CERTIFICATION_PROFILE,
  generateCertificationRandomSequences,
  generateRandomSequences
} = require('./randomSequences');
const { compareCorpus } = require('./comparator');
const { matrixMarkdown, summaryMarkdown } = require('./report');
const { stableStringify } = require('./utils');

const ROOT = path.resolve(__dirname, '..');

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next == null || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return {command, options};
}

function readJson(filename, fallback) {
  if (!filename) {
    if (fallback) return JSON.parse(fs.readFileSync(fallback, 'utf8'));
    throw new Error('A required JSON input path was not supplied.');
  }
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function writeOutput(value, filename) {
  const text = typeof value === 'string' ? value : `${stableStringify(value)}\n`;
  if (!filename || filename === '-') {
    process.stdout.write(text);
    return null;
  }
  const destination = path.resolve(filename);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, text);
  return destination;
}

function csv(value) {
  return value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

function generateCommand(options) {
  const fixtures = readJson(options.fixtures, path.join(ROOT, 'fixtures/canonicalFixtures.json'));
  const actions = readJson(options.actions, path.join(ROOT, 'scenarios/actionCatalog.json'));
  const corpus = generateScenarios(fixtures, actions, {families: csv(options.families)});
  const randomProfile = options['random-profile'];
  if (randomProfile && randomProfile !== CERTIFICATION_PROFILE.id && randomProfile !== 'diagnostic') {
    throw new Error(`Unknown random profile: ${randomProfile}`);
  }
  if (randomProfile === CERTIFICATION_PROFILE.id) {
    corpus.random = generateCertificationRandomSequences(fixtures, {
      seed: options.seed,
      count: options['random-count'] == null ? undefined : Number(options['random-count']),
      minimumActions: options['random-min-actions'] == null
        ? undefined
        : Number(options['random-min-actions']),
      maximumActions: options['random-max-actions'] == null
        ? undefined
        : Number(options['random-max-actions']),
      includeNonComparableVerticalNavigation: options['include-non-comparable-vertical'] === true
    });
  } else if (options['random-count']) {
    corpus.random = generateRandomSequences(fixtures, {
      seed: options.seed,
      count: Number(options['random-count']),
      minimumActions: options['random-min-actions'] == null
        ? undefined
        : Number(options['random-min-actions']),
      maximumActions: options['random-max-actions'] == null
        ? undefined
        : Number(options['random-max-actions'])
    });
  }
  if (options['random-only']) {
    if (!corpus.random) throw new Error('--random-only requires a random profile or --random-count.');
    writeOutput(corpus.random, options.output);
  } else {
    writeOutput(corpus, options.output);
  }
}

function compareCommand(options) {
  const scenarios = readJson(options.scenarios);
  const obsidian = readJson(options.obsidian);
  const viewer = readJson(options.viewer);
  const overrides = readJson(
    options.overrides,
    path.join(ROOT, 'overrides/viewerOverrides.json')
  );
  const comparison = compareCorpus(scenarios, obsidian, viewer, overrides, {
    strictEvidence: options['allow-unit-evidence'] !== true
  });
  writeOutput(comparison, options.output);
}

function reportCommand(options) {
  const comparisons = readJson(options.comparisons);
  const metadata = options.metadata ? readJson(options.metadata) : {};
  const format = options.format || 'both';
  if (format === 'matrix') {
    writeOutput(matrixMarkdown(comparisons, metadata), options.output);
    return;
  }
  if (format === 'summary') {
    writeOutput(summaryMarkdown(comparisons, metadata), options.output);
    return;
  }
  if (format !== 'both') throw new Error('report --format must be matrix, summary, or both.');
  if (!options.matrix || !options.summary) {
    throw new Error('report --format both requires --matrix and --summary destinations.');
  }
  writeOutput(matrixMarkdown(comparisons, metadata), options.matrix);
  writeOutput(summaryMarkdown(comparisons, metadata), options.summary);
}

function usage() {
  return [
    'Markdown conformance core CLI',
    '',
    'generate [--fixtures FILE] [--actions FILE] [--families a,b] [--random-profile diagnostic|v0.3-valid] [--random-count N] [--random-only] [--seed S] [--output FILE|-]',
    'compare --scenarios FILE --obsidian FILE --viewer FILE [--overrides FILE] [--output FILE|-]',
    'report --comparisons FILE [--metadata FILE] --format matrix|summary --output FILE|-',
    'report --comparisons FILE [--metadata FILE] --format both --matrix FILE --summary FILE'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const {command, options} = parseArguments(argv);
  if (!command || command === 'help' || options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'generate') return generateCommand(options);
  if (command === 'compare') return compareCommand(options);
  if (command === 'report') return reportCommand(options);
  throw new Error(`Unknown command: ${command}`);
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
  compareCommand,
  generateCommand,
  main,
  parseArguments,
  readJson,
  reportCommand,
  usage,
  writeOutput
});
