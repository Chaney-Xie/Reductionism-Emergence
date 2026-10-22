#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compareRepairGateEvidence,
  isCleanRepairGate
} from './repairGateEvidence.mjs';

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
    'Obsidian source repair-gate evidence bridge',
    '',
    'node test/markdownConformance/runner/repairGateEvidenceCli.mjs \\',
    '  --scenarios test/markdownConformance/scenarios/obsidianSourceRepairGate.json \\',
    '  --viewer /tmp/viewer-repair-gate.json \\',
    '  --output /tmp/viewer-repair-gate-comparison.json [--require-clean]',
    '',
    '--viewer accepts realRuntimeCli output, a viewer-v1 result object, or observations[].',
    '--require-clean exits 2 for Viewer failures or unresolved automation/evidence ambiguity;',
    'explicit productDecisionRequired ambiguity is allowed.'
  ].join('\n');
}

async function readJson(filename, label) {
  if (!filename) throw new Error(`${label} is required.`);
  return JSON.parse(await readFile(path.resolve(filename), 'utf8'));
}

async function emit(result, filename = '-') {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (filename === '-') process.stdout.write(serialized);
  else await writeFile(path.resolve(filename), serialized, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const [scenarios, viewer] = await Promise.all([
    readJson(options.scenarios, '--scenarios'),
    readJson(options.viewer, '--viewer')
  ]);
  const result = compareRepairGateEvidence(scenarios, viewer);
  await emit(result, options.output || '-');
  if (options['require-clean'] && !isCleanRepairGate(result)) process.exitCode = 2;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export { main, parseArguments, usage };
