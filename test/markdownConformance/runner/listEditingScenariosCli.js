#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LIST_LIFECYCLE_SEED,
  LIST_RANDOM_SEED,
  generateListEditingScenarios,
  generateListLifecycleRandomSequences,
  generateListRandomSequences,
  summarizeListEditingScenarios,
  summarizeListLifecycleRandomSequences,
  summarizeListRandomSequences,
  validateListEditingCorpus,
  validateListLifecycleRandomCorpus,
  validateListRandomCorpus
} = require('./listEditingScenarios');
const { stableStringify } = require('./utils');

const DEFAULT_EXPANDED_OUTPUT = path.resolve(
  __dirname,
  '..',
  'scenarios',
  'v0.3ListEditingExpanded.json'
);
const DEFAULT_RANDOM_OUTPUT = path.resolve(
  __dirname,
  '..',
  'scenarios',
  'v0.3ListRandom500.json'
);
const DEFAULT_LIFECYCLE_OUTPUT = path.resolve(
  __dirname,
  '..',
  'scenarios',
  'v0.3ListLifecycleRandom500.json'
);

function parseArguments(argv) {
  const tokens = [...argv];
  let command = 'generate';
  if (tokens[0] && !tokens[0].startsWith('--')) command = tokens.shift();
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (value == null || value.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function usage() {
  return [
    'Generate or validate the isolated v0.3 list-editing conformance corpora.',
    '',
    'node test/markdownConformance/runner/listEditingScenariosCli.js generate [options]',
    'node test/markdownConformance/runner/listEditingScenariosCli.js check [options]',
    '',
    'Options:',
    `  --expanded-output FILE  deterministic corpus (default: ${DEFAULT_EXPANDED_OUTPUT})`,
    `  --random-output FILE    500-sequence corpus (default: ${DEFAULT_RANDOM_OUTPUT})`,
    `  --lifecycle-output FILE 500-sequence empty-item lifecycle corpus (default: ${DEFAULT_LIFECYCLE_OUTPUT})`,
    `  --seed TEXT             persisted random seed (default: ${LIST_RANDOM_SEED})`,
    `  --lifecycle-seed TEXT   persisted lifecycle seed (default: ${LIST_LIFECYCLE_SEED})`,
    '  --quiet                 suppress the JSON summary'
  ].join('\n');
}

function outputPaths(options) {
  return {
    expanded: path.resolve(String(
      options['expanded-output'] || options.expanded || DEFAULT_EXPANDED_OUTPUT
    )),
    random: path.resolve(String(
      options['random-output'] || options.random || DEFAULT_RANDOM_OUTPUT
    )),
    lifecycle: path.resolve(String(
      options['lifecycle-output'] || options.lifecycle || DEFAULT_LIFECYCLE_OUTPUT
    ))
  };
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${stableStringify(value)}\n`, 'utf8');
}

function assertValid(label, validation) {
  if (!validation.valid) {
    throw new Error(`${label} validation failed:\n${validation.errors.join('\n')}`);
  }
}

function generatedResult(options, paths) {
  const expanded = generateListEditingScenarios();
  const random = generateListRandomSequences({ seed: options.seed || LIST_RANDOM_SEED });
  const lifecycle = generateListLifecycleRandomSequences({
    seed: options['lifecycle-seed'] || LIST_LIFECYCLE_SEED
  });
  assertValid('Expanded corpus', validateListEditingCorpus(expanded));
  assertValid('Random corpus', validateListRandomCorpus(random));
  assertValid('Lifecycle corpus', validateListLifecycleRandomCorpus(lifecycle));
  writeJson(paths.expanded, expanded);
  writeJson(paths.random, random);
  writeJson(paths.lifecycle, lifecycle);
  return {
    command: 'generate',
    expanded: {
      path: paths.expanded,
      scenarioCount: expanded.scenarioCount,
      corpusSha256: expanded.corpusSha256,
      summary: summarizeListEditingScenarios(expanded)
    },
    random: {
      path: paths.random,
      sequenceCount: random.count,
      totalActionCount: random.summary.totalActionCount,
      seed: random.seed,
      corpusSha256: random.corpusSha256,
      summary: summarizeListRandomSequences(random)
    },
    lifecycle: {
      path: paths.lifecycle,
      sequenceCount: lifecycle.count,
      totalActionCount: lifecycle.summary.totalActionCount,
      actionTraceStepCount: lifecycle.summary.actionTraceStepCount,
      seed: lifecycle.seed,
      motifCatalogSha256: lifecycle.motifCatalogSha256,
      corpusSha256: lifecycle.corpusSha256,
      summary: summarizeListLifecycleRandomSequences(lifecycle)
    }
  };
}

function checkedResult(paths) {
  const expanded = readJson(paths.expanded);
  const random = readJson(paths.random);
  const lifecycle = readJson(paths.lifecycle);
  const expandedValidation = validateListEditingCorpus(expanded);
  const randomValidation = validateListRandomCorpus(random);
  const lifecycleValidation = validateListLifecycleRandomCorpus(lifecycle);
  assertValid('Expanded corpus', expandedValidation);
  assertValid('Random corpus', randomValidation);
  assertValid('Lifecycle corpus', lifecycleValidation);
  return {
    command: 'check',
    expanded: {
      path: paths.expanded,
      scenarioCount: expanded.scenarioCount,
      corpusSha256: expanded.corpusSha256,
      summary: expandedValidation.summary
    },
    random: {
      path: paths.random,
      sequenceCount: random.count,
      totalActionCount: randomValidation.summary.totalActionCount,
      seed: random.seed,
      corpusSha256: random.corpusSha256,
      summary: randomValidation.summary
    },
    lifecycle: {
      path: paths.lifecycle,
      sequenceCount: lifecycle.count,
      totalActionCount: lifecycleValidation.summary.totalActionCount,
      actionTraceStepCount: lifecycleValidation.summary.actionTraceStepCount,
      seed: lifecycle.seed,
      motifCatalogSha256: lifecycle.motifCatalogSha256,
      corpusSha256: lifecycle.corpusSha256,
      summary: lifecycleValidation.summary
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (options.help || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const paths = outputPaths(options);
  let result;
  if (command === 'generate') result = generatedResult(options, paths);
  else if (command === 'check') result = checkedResult(paths);
  else throw new Error(`Unknown command: ${command}`);
  if (!options.quiet) process.stdout.write(`${stableStringify(result)}\n`);
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
  DEFAULT_EXPANDED_OUTPUT,
  DEFAULT_LIFECYCLE_OUTPUT,
  DEFAULT_RANDOM_OUTPUT,
  main,
  outputPaths,
  parseArguments,
  usage
});
