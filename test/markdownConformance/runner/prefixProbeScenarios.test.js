'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  authoritativeMismatchKind,
  buildPrefixProbeScenarios,
  prefixLengths
} = require('./prefixProbeScenarios');

function observation(scenarioId, source, selection, additions = {}) {
  return {
    scenarioId,
    evidenceLevel: additions.evidenceLevel || 'O1',
    automatable: additions.automatable ?? true,
    source,
    selection,
    ...additions
  };
}

test('prefix lengths cap early probes and retain the full trace exactly once', () => {
  assert.deepEqual(prefixLengths(3, 6), [1, 2, 3]);
  assert.deepEqual(prefixLengths(8, 6), [1, 2, 3, 4, 5, 6, 8]);
});

test('authoritative mismatch selection excludes non-automatable and integrity evidence', () => {
  const selection = { anchor: 1, focus: 1 };
  assert.equal(authoritativeMismatchKind(
    observation('one', 'A', selection),
    observation('one', 'B', selection, { evidenceLevel: 'V1' })
  ), 'source-mismatch');
  assert.equal(authoritativeMismatchKind(
    observation('one', 'A', selection),
    observation('one', 'A', { anchor: 0, focus: 0 }, { evidenceLevel: 'V1' })
  ), 'caret-only-mismatch');
  assert.equal(authoritativeMismatchKind(
    observation('one', 'A', selection, { automatable: false }),
    observation('one', 'B', selection, { evidenceLevel: 'V1' })
  ), null);
  assert.equal(authoritativeMismatchKind(
    observation('one', 'A', selection),
    observation('one', 'B', selection, {
      evidenceLevel: 'V1',
      integrityFailure: ['dom']
    })
  ), null);
});

test('prefix probe corpus is deterministic and preserves origin scenario metadata', () => {
  const scenarios = {
    corpusSha256: 'source-corpus',
    sequences: [
      {
        id: 'random.source',
        fixtureId: 'quote',
        syntaxFamily: 'quotes',
        mode: 'source',
        initialSource: '> A',
        initialSelection: { anchor: 2, focus: 2 },
        requiredObservations: ['source', 'selection', 'physical', 'semantic'],
        profile: 'v0.3-valid',
        seed: 'fixed',
        actions: Array.from({ length: 8 }, (_, index) => ({
          type: 'input', command: 'insertText', text: String(index)
        }))
      },
      {
        id: 'random.caret',
        fixtureId: 'plain',
        syntaxFamily: 'paragraphs',
        mode: 'live-preview',
        initialSource: 'A',
        initialSelection: { anchor: 0, focus: 0 },
        requiredObservations: ['source', 'selection'],
        actions: [
          { type: 'keyboard', key: 'Tab' },
          { type: 'keyboard', key: 'Tab', shiftKey: true },
          { type: 'keyboard', key: 'ArrowRight' }
        ]
      },
      {
        id: 'random.match',
        initialSource: 'A',
        actions: [{ type: 'keyboard', key: 'ArrowRight' }]
      }
    ]
  };
  const obsidian = [
    observation('random.source', '> OA', { anchor: 4, focus: 4 }),
    observation('random.caret', 'A', { anchor: 1, focus: 1 }),
    observation('random.match', 'A', { anchor: 1, focus: 1 })
  ];
  const viewer = [
    observation('random.source', '> VA', { anchor: 4, focus: 4 }, { evidenceLevel: 'V1' }),
    observation('random.caret', 'A', { anchor: 0, focus: 0 }, { evidenceLevel: 'V1' }),
    observation('random.match', 'A', { anchor: 1, focus: 1 }, { evidenceLevel: 'V1' })
  ];
  const first = buildPrefixProbeScenarios(scenarios, obsidian, viewer, {
    maximumEarlyPrefix: 2
  });
  const second = buildPrefixProbeScenarios(scenarios, obsidian, viewer, {
    maximumEarlyPrefix: 2
  });

  assert.deepEqual(first, second);
  assert.equal(first.originScenarioCount, 2);
  assert.equal(first.sourceMismatchOriginCount, 1);
  assert.equal(first.caretOnlyOriginCount, 1);
  assert.equal(first.count, 6);
  assert.deepEqual(first.sequences.map(({ id }) => id), [
    'random.source.prefix.1',
    'random.source.prefix.2',
    'random.source.prefix.8',
    'random.caret.prefix.1',
    'random.caret.prefix.2',
    'random.caret.prefix.3'
  ]);
  const full = first.sequences[2];
  assert.equal(full.fixtureId, 'quote');
  assert.equal(full.requiredObservations.length, 4);
  assert.equal(full.actions.length, 8);
  assert.deepEqual(full.prefixProbe, {
    originScenarioId: 'random.source',
    mismatchKind: 'source-mismatch',
    prefixLength: 8,
    originalActionCount: 8,
    isFullTrace: true
  });
});
