'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STATUS, countStatuses } = require('./comparator');

function inline(value) {
  if (value == null) return '—';
  return String(value)
    .replaceAll('|', '\\|')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n');
}

function resultSide(result, side) {
  const difference = (result.differences || [])[0];
  if (!difference) return result.status === STATUS.MATCH ? 'same' : inline(result.reason);
  const value = side === 'obsidian' ? difference.expected : difference.actual;
  const rendered = typeof value === 'string' ? value : JSON.stringify(value);
  return `\`${inline(rendered).slice(0, 120)}\``;
}

function matrixMarkdown(comparisonDocument, metadata = {}) {
  const results = comparisonDocument?.results || [];
  const lines = [
    '# Markdown Conformance Matrix',
    '',
    `Oracle: ${inline(metadata.obsidianVersion || comparisonDocument.obsidianVersion || 'not recorded')}`,
    '',
    `Viewer: ${inline(metadata.viewerVersion || metadata.viewerCommit || comparisonDocument.viewerVersion || 'not recorded')}`,
    '',
    '| Family | Scenario | Mode / action | Obsidian | Viewer | Status |',
    '|---|---|---|---|---|---|'
  ];
  results.forEach((result) => {
    lines.push(`| ${inline(result.syntaxFamily)} | ${inline(result.scenarioId)} | ${inline(`${result.mode || '—'} / ${result.actionId || '—'}`)} | ${resultSide(result, 'obsidian')} | ${resultSide(result, 'viewer')} | ${inline(result.status)} |`);
  });
  lines.push('');
  return lines.join('\n');
}

function statusCount(counts, status) {
  return Number(counts?.[status] || 0);
}

function uniqueCount(results, key) {
  return new Set(results.map((result) => result[key]).filter(Boolean)).size;
}

function summaryMarkdown(comparisonDocument, metadata = {}) {
  const results = comparisonDocument?.results || [];
  const counts = comparisonDocument?.counts || countStatuses(results);
  const beforeCounts = comparisonDocument?.beforeRepair?.counts
    || metadata.beforeRepairCounts
    || counts;
  const afterCounts = comparisonDocument?.afterRepair?.counts
    || metadata.afterRepairCounts
    || counts;
  const productionFiles = metadata.productionFilesChanged || [];
  const regressions = metadata.regressionFilesCreated || [];
  const lines = [
    '# Markdown Conformance Summary',
    '',
    `- Obsidian version: ${inline(metadata.obsidianVersion || comparisonDocument.obsidianVersion || 'not recorded')}`,
    `- Viewer version/commit: ${inline(metadata.viewerVersion || metadata.viewerCommit || comparisonDocument.viewerVersion || 'not recorded')}`,
    `- OS: ${inline(metadata.os || 'not recorded')}`,
    `- Obsidian settings: ${inline(metadata.obsidianSettings ? JSON.stringify(metadata.obsidianSettings) : 'not recorded')}`,
    `- Viewer settings: ${inline(metadata.viewerSettings ? JSON.stringify(metadata.viewerSettings) : 'not recorded')}`,
    `- Syntax families: ${metadata.syntaxFamilyCount ?? uniqueCount(results, 'syntaxFamily')}`,
    `- Deterministic scenarios: ${metadata.deterministicScenarioCount ?? comparisonDocument.scenarioCount ?? results.length}`,
    `- Random sequences: ${metadata.randomSequenceCount ?? 0}`,
    `- MATCH: ${statusCount(counts, STATUS.MATCH)}`,
    `- Intentional Viewer overrides: ${statusCount(counts, STATUS.INTENTIONAL_VIEWER_OVERRIDE)}`,
    `- Viewer FAIL before repair: ${statusCount(beforeCounts, STATUS.VIEWER_FAIL)}`,
    `- Viewer FAIL after repair: ${statusCount(afterCounts, STATUS.VIEWER_FAIL)}`,
    `- Obsidian NOT AUTOMATABLE: ${statusCount(counts, STATUS.OBSIDIAN_NOT_AUTOMATABLE)}`,
    `- AMBIGUOUS: ${statusCount(counts, STATUS.AMBIGUOUS)}`,
    `- Production files changed: ${productionFiles.length ? productionFiles.join(', ') : 'none'}`,
    `- Regression files created: ${regressions.length ? regressions.join(', ') : 'none'}`,
    `- Full Viewer suite totals: ${inline(metadata.viewerSuiteTotals || 'not run')}`,
    '',
    'Evidence levels: O1 is the actual Obsidian app, V1 is packaged Viewer in real Chromium, and U is unit/integration support only.',
    ''
  ];
  if (metadata.notes?.length) {
    lines.push('## Notes', '');
    metadata.notes.forEach((note) => lines.push(`- ${inline(note)}`));
    lines.push('');
  }
  return lines.join('\n');
}

function writeReports(comparisonDocument, metadata, destinations) {
  const matrixPath = path.resolve(destinations.matrix);
  const summaryPath = path.resolve(destinations.summary);
  fs.mkdirSync(path.dirname(matrixPath), {recursive: true});
  fs.mkdirSync(path.dirname(summaryPath), {recursive: true});
  fs.writeFileSync(matrixPath, matrixMarkdown(comparisonDocument, metadata));
  fs.writeFileSync(summaryPath, summaryMarkdown(comparisonDocument, metadata));
  return {matrixPath, summaryPath};
}

module.exports = Object.freeze({
  matrixMarkdown,
  summaryMarkdown,
  writeReports
});
