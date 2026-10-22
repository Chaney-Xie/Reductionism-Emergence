#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ViewerV1Adapter } from './viewerV1.mjs';

const outputPath = path.resolve(
  process.argv[2] || '/private/tmp/markdown-v03-viewer-editable-position-certification.json'
);

const source = [
  '# Heading',
  'Plain *em* **strong** ~~strike~~ \\*escape\\*',
  '',
  '> quote',
  '1. Alpha',
  '2. Beta',
  '\t- Nested',
  '',
  '`inline`',
  '```js',
  'const x = 1;',
  '```',
  '[link](https://example.com)',
  '$x^2$',
  '| A | B |',
  '| - | - |',
  '| one | two |',
  ''
].join('\r\n');

function positionKey(position) {
  return [
    position.physicalLineIndex,
    position.logicalColumn,
    position.affinity
  ].join(':');
}

function summarizeSet(keys) {
  return [...keys].sort((left, right) => {
    const [leftLine, leftColumn] = left.split(':').map(Number);
    const [rightLine, rightColumn] = right.split(':').map(Number);
    return leftLine - rightLine || leftColumn - rightColumn || left.localeCompare(right);
  });
}

function sameMembers(left, right) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

const diagnosticExpression = `(() => {
  const body = document.querySelector('.workspace-pane.is-workspace-pane-active .markdown-page-body')
    || document.querySelector('.markdown-page-body');
  if (!body) throw new Error('Markdown editable body is missing.');
  const diagnostic = globalThis.markdownPageView?.editableProjectionSnapshot?.(body);
  if (!diagnostic) throw new Error('EditableProjection diagnostic snapshot is unavailable.');
  return {
    mode: diagnostic.mode,
    markdownBody: diagnostic.markdownBody,
    lineCount: diagnostic.lineCount,
    physicalRowCount: body.querySelectorAll('.markdown-editable-physical-row').length,
    nativeEditableListNodeCount: body.querySelectorAll('ol, ul, li').length,
    userAgent: navigator.userAgent,
    runtimeVersions: typeof process === 'object' ? {
      electron: process.versions?.electron || null,
      chrome: process.versions?.chrome || null
    } : null,
    selection: (() => {
      const value = globalThis.markdownPageView?.editableSelection?.(body);
      const endpoint = (position) => position ? ({
        key: [position.physicalLineIndex, position.logicalColumn, position.affinity].join(':'),
        offset: position.offset
      }) : null;
      return value ? { anchor: endpoint(value.anchor), focus: endpoint(value.focus) } : null;
    })(),
    positions: diagnostic.positions.map((entry) => ({
      key: [
        entry.position.physicalLineIndex,
        entry.position.logicalColumn,
        entry.position.affinity
      ].join(':'),
      position: {
        offset: entry.position.offset,
        physicalLineIndex: entry.position.physicalLineIndex,
        logicalColumn: entry.position.logicalColumn,
        affinity: entry.position.affinity,
        semanticOwnerId: entry.position.semanticOwnerId,
        visibility: entry.position.visibility,
        interactionPolicy: entry.position.interactionPolicy
      },
      roundTripExact: entry.roundTripExact,
      pointerRoundTripExact: entry.pointerRoundTripExact,
      positiveCaretRect: entry.positiveCaretRect,
      positiveCollapsedCaretRect: entry.positiveCollapsedCaretRect,
      collapsedCaretHeight: Number(entry.collapsedRect?.height || 0),
      leafId: entry.leafId
    }))
  };
})()`;

function classify(diagnostic) {
  const K = new Set(diagnostic.positions.map((entry) => entry.key));
  const P = new Set(diagnostic.positions
    .filter((entry) => (
      entry.pointerRoundTripExact
      && entry.roundTripExact
      && entry.positiveCollapsedCaretRect
      && entry.collapsedCaretHeight > 0
    ))
    .map((entry) => entry.key));
  const V = new Set(diagnostic.positions
    .filter((entry) => (
      entry.roundTripExact
      && entry.positiveCollapsedCaretRect
      && entry.collapsedCaretHeight > 0
    ))
    .map((entry) => entry.key));
  return { K, P, V };
}

let adapter;
let result;
try {
  adapter = await ViewerV1Adapter.launch({
    sourceRoot: process.cwd(),
    reusePageAcrossScenarios: true,
    label: 'editable-position-certification'
  });

  await adapter.setup({
    id: 'editable-position.source',
    initialSource: source,
    mode: 'source',
    state: { active: true },
    initialSelection: { anchor: 0, focus: 0 }
  });
  const sourceDiagnostic = await adapter.client.evaluate(diagnosticExpression, { timeoutMs: 25_000 });
  const sourceSets = classify(sourceDiagnostic);

  const liveK = new Set();
  const liveP = new Set();
  const liveV = new Set();
  const liveFailures = [];
  await adapter.setup({
    id: 'editable-position.live',
    initialSource: source,
    mode: 'live-preview',
    state: { active: true },
    initialSelection: { anchor: 0, focus: 0 }
  });
  for (let index = 0; index < sourceDiagnostic.positions.length; index += 1) {
    const expected = sourceDiagnostic.positions[index];
    const diagnostic = await adapter.client.evaluate(diagnosticExpression, { timeoutMs: 25_000 });
    diagnostic.positions.forEach((entry) => liveK.add(entry.key));
    const entry = diagnostic.positions.find((candidate) => candidate.key === expected.key);
    const keyboardExact = diagnostic.selection?.anchor?.key === expected.key
      && diagnostic.selection?.focus?.key === expected.key;
    if (entry?.roundTripExact && entry.positiveCollapsedCaretRect && entry.collapsedCaretHeight > 0) {
      liveV.add(expected.key);
    }
    if (entry?.pointerRoundTripExact && entry?.roundTripExact
      && entry?.positiveCollapsedCaretRect && entry?.collapsedCaretHeight > 0) {
      liveP.add(expected.key);
    }
    if (!entry || !keyboardExact || !liveP.has(expected.key) || !liveV.has(expected.key)) {
      liveFailures.push({
        expected,
        observed: entry || null,
        selection: diagnostic.selection,
        keyboardExact
      });
    }
    if ((index + 1) % 25 === 0 || index + 1 === sourceDiagnostic.positions.length) {
      process.stderr.write(
        `Live position certification ${index + 1}/${sourceDiagnostic.positions.length}\n`
      );
    }
    if (index + 1 < sourceDiagnostic.positions.length) {
      await adapter.dispatch({ type: 'keyboard', key: 'ArrowRight' });
    }
  }

  const sourceEqual = sameMembers(sourceSets.K, sourceSets.P)
    && sameMembers(sourceSets.K, sourceSets.V);
  const liveEqual = sameMembers(liveK, liveP)
    && sameMembers(liveK, liveV);
  const architecture = {
    sourceNativeEditableListNodeCount: sourceDiagnostic.nativeEditableListNodeCount,
    sourcePhysicalRowCount: sourceDiagnostic.physicalRowCount,
    expectedPhysicalRowCount: sourceDiagnostic.lineCount
  };
  const architectureValid = architecture.sourceNativeEditableListNodeCount === 0
    && architecture.sourcePhysicalRowCount === architecture.expectedPhysicalRowCount;

  result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceLevel: 'V1',
    runtime: {
      userAgent: sourceDiagnostic.userAgent,
      versions: sourceDiagnostic.runtimeVersions,
      packageFreshness: adapter.packageMetadata
    },
    safety: {
      isolatedProfiles: true,
      realVaultsTouched: false,
      realConfigurationsTouched: false
    },
    fixture: {
      sourceLength: source.length,
      physicalLineCount: sourceDiagnostic.lineCount,
      lineEnding: 'CRLF',
      repeatedBlankAndTerminalRows: true
    },
    definitions: {
      P: 'positions with exact trusted Chromium point hit-testing, exact DOM round-trip, and positive collapsed-caret height',
      K: 'all canonical positions declared by EditableProjection horizontal/vertical navigation',
      V: 'positions with an exact DOM round-trip and positive collapsed-caret height after exact owner activation'
    },
    source: {
      P: sourceSets.P.size,
      K: sourceSets.K.size,
      V: sourceSets.V.size,
      equal: sourceEqual,
      failures: sourceDiagnostic.positions.filter((entry) => (
        !sourceSets.P.has(entry.key) || !sourceSets.V.has(entry.key)
      ))
    },
    livePreview: {
      keyboardNavigationSteps: Math.max(0, sourceDiagnostic.positions.length - 1),
      P: liveP.size,
      K: liveK.size,
      V: liveV.size,
      equal: liveEqual,
      failures: liveFailures
    },
    architecture,
    pass: sourceEqual && liveEqual && architectureValid
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, ...result }, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  await adapter?.close?.().catch(() => {});
}
