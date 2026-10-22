#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObsidianO1Adapter } from './obsidianO1.mjs';
import { ViewerV1Adapter, verifyPackagedViewerFreshness } from './viewerV1.mjs';

function parseArguments(argv) {
  const [command = 'help', ...tokens] = argv;
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
  return { command, options };
}

function usage() {
  return [
    'Real-runtime Markdown conformance adapter CLI',
    '',
    'probe [--adapter obsidian|viewer|both] [--trace-actions] [--keep-artifacts] [--output FILE|-]',
    'run --adapter obsidian|viewer|both --scenarios FILE [--set scenarios|random] [--ids a,b] [--limit N] [--per-family N] [--batch-size N] [--families a,b] [--modes a,b] [--actions a,b] [--trace-actions] [--keep-artifacts] [--output FILE|-]',
    'check-viewer-package [--viewer-executable FILE] [--source-root DIR] [--output FILE|-]',
    '',
    'Optional paths:',
    '  --obsidian-executable FILE  --obsidian-asar FILE  --viewer-executable FILE',
    '  --trace-actions captures a compact authoritative observation after every action.',
    '',
    'Every launch uses a disposable profile/Vault. Real profiles and Vaults are never attached.'
  ].join('\n');
}

function probeScenarios() {
  return [
    {
      id: 'probe.plain.type',
      syntaxFamily: 'plain-text',
      initialSource: 'Alpha',
      mode: 'source',
      state: { active: true },
      initialSelection: { anchor: 5, focus: 5 },
      boundary: { name: 'document-end', offset: 5 },
      action: { id: 'insert-text', type: 'input', command: 'insertText', text: '!' }
    },
    {
      id: 'probe.quote.enter',
      syntaxFamily: 'quotes',
      initialSource: '>> Quote',
      mode: 'live-preview',
      state: { active: true, quoteDepth: 2 },
      initialSelection: { anchor: 8, focus: 8 },
      boundary: { name: 'document-end', offset: 8 },
      action: { id: 'enter', type: 'keyboard', key: 'Enter' }
    },
    {
      id: 'probe.live.inactive.inspect',
      syntaxFamily: 'strong',
      initialSource: '**Bold**',
      mode: 'live-preview',
      state: { active: false },
      initialSelection: { anchor: 4, focus: 4 },
      boundary: { name: 'text-middle', offset: 4 },
      action: { id: 'inspect', type: 'inspect', editable: false },
      requiredObservations: ['source', 'physical', 'semantic', 'presentation']
    }
  ];
}

async function readScenarios(filename, setName = 'scenarios') {
  if (!filename) throw new Error('run requires --scenarios FILE.');
  const document = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const normalizedSet = String(setName || 'scenarios').toLowerCase();
  if (!['scenarios', 'random'].includes(normalizedSet)) {
    throw new Error('--set must be scenarios or random.');
  }
  const scenarios = Array.isArray(document)
    ? document
    : normalizedSet === 'random'
      ? document.random?.sequences || document.sequences
      : document.scenarios || document.sequences || (document.sequence ? [document.sequence] : null);
  if (!Array.isArray(scenarios)) {
    throw new Error(normalizedSet === 'random'
      ? 'Scenario document does not contain random.sequences[] or sequences[].'
      : 'Scenario document must be an array or contain scenarios[], sequences[], or sequence.');
  }
  return scenarios;
}

function selectScenarios(scenarios, options) {
  const ids = options.ids
    ? new Set(String(options.ids).split(',').map((value) => value.trim()).filter(Boolean))
    : null;
  const families = options.families
    ? new Set(String(options.families).split(',').map((value) => value.trim()).filter(Boolean))
    : null;
  const modes = options.modes
    ? new Set(String(options.modes).split(',').map((value) => value.trim()).filter(Boolean))
    : null;
  const actions = options.actions
    ? new Set(String(options.actions).split(',').map((value) => value.trim()).filter(Boolean))
    : null;
  let filtered = ids
    ? scenarios.filter((scenario) => ids.has(scenario.id))
    : scenarios;
  filtered = families
    ? filtered.filter((scenario) => families.has(scenario.syntaxFamily))
    : filtered;
  if (modes) filtered = filtered.filter((scenario) => modes.has(scenario.mode));
  if (actions) filtered = filtered.filter((scenario) => actions.has(
    scenario.action?.id || scenario.action?.command || scenario.action?.type
  ));
  if (options['per-family'] != null) {
    const perFamily = Number(options['per-family']);
    if (!Number.isSafeInteger(perFamily) || perFamily < 1) {
      throw new Error('--per-family must be a positive integer.');
    }
    const selectedCounts = new Map();
    filtered = filtered.filter((scenario) => {
      const family = scenario.syntaxFamily || 'unclassified';
      const count = selectedCounts.get(family) || 0;
      if (count >= perFamily) return false;
      selectedCounts.set(family, count + 1);
      return true;
    });
  }
  if (options.limit == null) return filtered;
  const limit = Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
  return filtered.slice(0, limit);
}

function adapterNames(value = 'both') {
  const normalized = String(value).toLowerCase();
  if (normalized === 'both') return ['obsidian', 'viewer'];
  if (normalized === 'obsidian' || normalized === 'o1') return ['obsidian'];
  if (normalized === 'viewer' || normalized === 'v1') return ['viewer'];
  throw new Error('--adapter must be obsidian, viewer, or both.');
}

function adapterOptions(name, options) {
  const common = {
    keepArtifacts: Boolean(options['keep-artifacts']),
    traceActions: options['trace-actions'] === true,
    label: options.label || ''
  };
  if (name === 'obsidian') {
    return {
      ...common,
      ...(options['obsidian-executable'] ? { executablePath: path.resolve(options['obsidian-executable']) } : {}),
      ...(options['obsidian-asar'] ? { cachedAsarPath: path.resolve(options['obsidian-asar']) } : {})
    };
  }
  return {
    ...common,
    sourceRoot: path.resolve(options['source-root'] || process.cwd()),
    ...(options['viewer-executable'] ? { executablePath: path.resolve(options['viewer-executable']) } : {}),
    ...(options['viewer-commit'] ? { viewerCommit: options['viewer-commit'] } : {})
  };
}

async function createAdapter(name, options) {
  return name === 'obsidian'
    ? ObsidianO1Adapter.launch(adapterOptions(name, options))
    : ViewerV1Adapter.launch(adapterOptions(name, options));
}

const activeAdapters = new Set();

async function closeActiveAdapters() {
  const adapters = [...activeAdapters];
  activeAdapters.clear();
  await Promise.allSettled(adapters.map((adapter) => adapter.close()));
}

async function executeAdapterCorpus(name, scenarios, options) {
  let adapter;
  let batchCount = 0;
  let runtimeLaunchCount = 0;
  let transportRetryCount = 0;
  const batchSize = options['batch-size'] == null ? 0 : Number(options['batch-size']);
  if (!Number.isSafeInteger(batchSize) || batchSize < 0) {
    throw new Error('--batch-size must be a non-negative integer.');
  }
  const closeAdapter = async () => {
    if (!adapter) return;
    activeAdapters.delete(adapter);
    await adapter.close();
    adapter = null;
  };
  const launchAdapter = async () => {
    adapter = await createAdapter(name, options);
    activeAdapters.add(adapter);
    batchCount = 0;
    runtimeLaunchCount += 1;
  };
  const transportUnavailable = (observation) => observation?.automatable === false
    && /CDP socket (?:is not open|closed)|ECONNRESET|WebSocket/i.test(
      observation?.metadata?.automationError?.message || ''
    );
  try {
    const observations = [];
    for (const scenario of scenarios) {
      if (!adapter || (batchSize > 0 && batchCount >= batchSize)) {
        await closeAdapter();
        await launchAdapter();
      }
      let observation = await adapter.runScenario(scenario);
      batchCount += 1;
      if (transportUnavailable(observation)) {
        await closeAdapter();
        await launchAdapter();
        observation = await adapter.runScenario(scenario);
        batchCount = 1;
        transportRetryCount += 1;
      }
      observations.push(observation);
    }
    const actionTraceObservations = observations.flatMap((observation) => (
      (observation.actionTrace || []).map((entry) => entry?.observation || entry)
    ));
    return {
      schemaVersion: 1,
      adapter: name === 'obsidian' ? 'obsidian-o1' : 'viewer-v1',
      evidenceLevel: name === 'obsidian' ? 'O1' : 'V1',
      scenarioCount: scenarios.length,
      observationCount: observations.length,
      automatableCount: observations.filter((observation) => observation.automatable !== false).length,
      actionTraceEnabled: options['trace-actions'] === true,
      actionTraceObservationCount: actionTraceObservations.length,
      automatableActionTraceCount: actionTraceObservations.filter((observation) => (
        observation?.automatable !== false
      )).length,
      runtimeLaunchCount,
      transportRetryCount,
      observations
    };
  } finally {
    await closeAdapter();
  }
}

async function executeRealCorpus(names, scenarios, options) {
  const results = {};
  for (const name of names) results[name] = await executeAdapterCorpus(name, scenarios, options);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      isolatedProfiles: true,
      realVaultsTouched: false,
      realConfigurationsTouched: false
    },
    scenarios: scenarios.map((scenario) => scenario.id),
    results
  };
}

async function writeOutput(value, filename = '-') {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!filename || filename === '-') {
    process.stdout.write(text);
    return;
  }
  await writeFile(path.resolve(filename), text, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'help' || options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'check-viewer-package') {
    const result = await verifyPackagedViewerFreshness({
      executablePath: options['viewer-executable']
        ? path.resolve(options['viewer-executable'])
        : undefined,
      sourceRoot: path.resolve(options['source-root'] || process.cwd())
    });
    await writeOutput(result, options.output);
    return result;
  }
  if (command !== 'probe' && command !== 'run') throw new Error(`Unknown command: ${command}`);
  const rawScenarios = command === 'probe'
    ? probeScenarios()
    : await readScenarios(options.scenarios, options.set || 'scenarios');
  const scenarios = selectScenarios(rawScenarios, options);
  const result = await executeRealCorpus(adapterNames(options.adapter), scenarios, options);
  await writeOutput(result, options.output);
  if (options['require-automatable']) {
    const failed = Object.values(result.results)
      .flatMap((entry) => entry.observations)
      .flatMap((observation) => [
        observation,
        ...(observation.actionTrace || []).map((entry) => entry?.observation || entry)
      ])
      .filter((observation) => observation?.automatable === false);
    if (failed.length) process.exitCode = 2;
  }
  return result;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeActiveAdapters().finally(() => {
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => {
    await closeActiveAdapters();
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  adapterOptions,
  executeRealCorpus,
  main,
  parseArguments,
  probeScenarios,
  readScenarios,
  selectScenarios,
  usage
};
