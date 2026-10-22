#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildPrefixProbeScenarios } = require('./prefixProbeScenarios');
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
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    'Generate bounded prefix probes for authoritative O1/V1 random mismatches.',
    '',
    'node test/markdownConformance/runner/prefixProbeScenariosCli.js \\',
    '  --scenarios FILE --obsidian FILE --viewer FILE --output FILE',
    '',
    'Optional: --max-prefix N (default: 6). The full trace is always included.'
  ].join('\n');
}

function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  if (!options.output) throw new Error('--output is required.');
  const result = buildPrefixProbeScenarios(
    readJson(options.scenarios, '--scenarios'),
    readJson(options.obsidian, '--obsidian'),
    readJson(options.viewer, '--viewer'),
    {
      maximumEarlyPrefix: options['max-prefix'] == null
        ? undefined
        : Number(options['max-prefix'])
    }
  );
  const destination = path.resolve(options.output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${stableStringify(result)}\n`, 'utf8');
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

module.exports = Object.freeze({ main, parseArguments, usage });
