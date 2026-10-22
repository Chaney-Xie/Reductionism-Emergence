#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObsidianO1Adapter } from './obsidianO1.mjs';
import { ViewerV1Adapter } from './viewerV1.mjs';

const require = createRequire(import.meta.url);
const { minimizeFailure, writeMinimizedRegression } = require('../minimizer.js');
const {
  compareNormalizedCrossRuntimeScenario,
  isExpandedListBehaviorScenario
} = require('../crossRuntimeContract.js');

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function usage() {
  return [
    'Real O1/V1 Markdown failure minimizer',
    '',
    '--scenarios FILE --id ID --predicate viewer-integrity|source|list-contract',
    '[--difference-path-prefix PATH] [--regressions DIR] [--output FILE|-]',
    '[--max-evaluations N]',
    '',
    'Every replay uses disposable runtime data; no real Vault is attached.'
  ].join('\n');
}

async function loadSequence(filename, id) {
  if (!filename || !id) throw new Error('--scenarios FILE and --id ID are required.');
  const document = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const candidates = [
    ...(document.random?.sequences || []),
    ...(document.sequences || []),
    ...(document.scenarios || []),
    ...(document.sequence ? [document.sequence] : []),
    ...(Array.isArray(document) ? document : [])
  ];
  const sequence = candidates.find((candidate) => candidate.id === id);
  if (!sequence) throw new Error(`Scenario not found: ${id}`);
  if (!Array.isArray(sequence.actions)) throw new Error(`${id} is not a multi-action sequence.`);
  return sequence;
}

function transportUnavailable(observation) {
  return observation?.automatable === false
    && /CDP socket (?:is not open|closed)|ECONNRESET|WebSocket/i.test(
      observation?.metadata?.automationError?.message || ''
    );
}

function exactSelection(observation) {
  return observation?.selection && {
    anchor: observation.selection.anchor,
    focus: observation.selection.focus
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const predicate = String(options.predicate || 'viewer-integrity');
  if (!['viewer-integrity', 'source', 'list-contract'].includes(predicate)) {
    throw new Error('--predicate must be viewer-integrity, source, or list-contract.');
  }
  const sequence = await loadSequence(options.scenarios, options.id);
  if (predicate === 'list-contract' && !isExpandedListBehaviorScenario(sequence)) {
    throw new Error('--predicate list-contract requires a list-editing-expanded scenario.');
  }
  const differencePathPrefix = options['difference-path-prefix'] == null
    ? null
    : String(options['difference-path-prefix']);
  let viewer = null;
  let obsidian = null;
  let viewerLaunches = 0;
  let obsidianLaunches = 0;
  const sourceRoot = path.resolve(options['source-root'] || process.cwd());

  const closeViewer = async () => {
    await viewer?.close().catch(() => {});
    viewer = null;
  };
  const closeObsidian = async () => {
    await obsidian?.close().catch(() => {});
    obsidian = null;
  };
  const runViewer = async (candidate) => {
    if (!viewer) {
      viewer = await ViewerV1Adapter.launch({ sourceRoot });
      viewerLaunches += 1;
    }
    let observation = await viewer.runScenario(candidate);
    if (transportUnavailable(observation)) {
      await closeViewer();
      viewer = await ViewerV1Adapter.launch({ sourceRoot });
      viewerLaunches += 1;
      observation = await viewer.runScenario(candidate);
    }
    return observation;
  };
  const runObsidian = async (candidate) => {
    if (!obsidian) {
      obsidian = await ObsidianO1Adapter.launch();
      obsidianLaunches += 1;
    }
    let observation = await obsidian.runScenario(candidate);
    if (transportUnavailable(observation)) {
      await closeObsidian();
      obsidian = await ObsidianO1Adapter.launch();
      obsidianLaunches += 1;
      observation = await obsidian.runScenario(candidate);
    }
    return observation;
  };

  try {
    const minimized = await minimizeFailure(sequence, async (candidate) => {
      const viewerObservation = await runViewer(candidate);
      if (predicate === 'viewer-integrity') {
        return viewerObservation.automatable !== false
          && Array.isArray(viewerObservation.integrityFailure)
          && viewerObservation.integrityFailure.length > 0;
      }
      const obsidianObservation = await runObsidian(candidate);
      if (obsidianObservation.automatable === false
        || viewerObservation.automatable === false
        || viewerObservation.integrityFailure?.length) return false;
      if (predicate === 'source') {
        return obsidianObservation.source !== viewerObservation.source
          || JSON.stringify(exactSelection(obsidianObservation))
            !== JSON.stringify(exactSelection(viewerObservation));
      }
      const compared = compareNormalizedCrossRuntimeScenario(
        candidate,
        obsidianObservation,
        viewerObservation,
        {}
      );
      if (compared.status !== 'VIEWER_FAIL') return false;
      const differences = Array.isArray(compared.differences) ? compared.differences : [];
      return differencePathPrefix == null
        ? differences.length > 0
        : differences.some(({ path: differencePath }) => (
            differencePath === differencePathPrefix
            || differencePath.startsWith(`${differencePathPrefix}.`)
          ));
    }, {
      maximumEvaluations: options['max-evaluations'] == null
        ? 100
        : Number(options['max-evaluations'])
    });
    const metadata = {
      predicate,
      evidenceLevels: predicate === 'viewer-integrity' ? ['V1'] : ['O1', 'V1'],
      differencePathPrefix,
      randomOriginId: sequence.id,
      viewerLaunches,
      obsidianLaunches,
      minimizedAt: new Date().toISOString()
    };
    const regressionPath = writeMinimizedRegression(
      path.resolve(options.regressions || 'test/markdownConformance/regressions'),
      minimized,
      metadata
    );
    const output = {
      schemaVersion: 1,
      regressionPath,
      metadata,
      originalLength: minimized.originalLength,
      minimizedLength: minimized.minimizedLength,
      evaluations: minimized.evaluations,
      sequence: minimized.minimizedSequence
    };
    const serialized = `${JSON.stringify(output, null, 2)}\n`;
    if (!options.output || options.output === '-') process.stdout.write(serialized);
    else await writeFile(path.resolve(options.output), serialized, 'utf8');
    return output;
  } finally {
    await Promise.allSettled([closeViewer(), closeObsidian()]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export { loadSequence, main, parseArguments, transportUnavailable };
