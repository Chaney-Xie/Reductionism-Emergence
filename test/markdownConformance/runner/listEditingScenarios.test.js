'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  ARBITRARY_ORDERED_FIXTURES,
  EDIT_REQUIRED_OBSERVATIONS,
  EXPANDED_REQUIREMENT_MINIMUM_QUOTAS,
  JOIN_FAMILIES,
  LIST_EDITING_TAG,
  LIST_LIFECYCLE_ACTION_COUNT,
  LIST_LIFECYCLE_ACTION_MINIMUM_QUOTAS,
  LIST_LIFECYCLE_KIND_QUOTAS,
  LIST_LIFECYCLE_MODE_QUOTAS,
  LIST_LIFECYCLE_MOTIF_QUOTAS,
  LIST_LIFECYCLE_SEED,
  LIST_LIFECYCLE_SEQUENCE_COUNT,
  LIST_RANDOM_SEED,
  NESTED_MATRIX_ACTIONS,
  NESTED_STYLES,
  RANDOM_ACTION_MINIMUM_QUOTAS,
  RANDOM_CATEGORY_QUOTAS,
  RANDOM_LENGTH_QUOTAS,
  RANDOM_MODE_QUOTAS,
  READING_REQUIRED_OBSERVATIONS,
  actionName,
  generateListEditingScenarios,
  generateListLifecycleRandomSequences,
  generateListRandomSequences,
  summarizeListEditingScenarios,
  summarizeListLifecycleRandomSequences,
  summarizeListRandomSequences,
  validateListEditingCorpus,
  validateListLifecycleRandomCorpus,
  validateListRandomCorpus,
  validateListRandomHistory
} = require('./listEditingScenarios');

const EXPANDED_PATH = path.join(__dirname, '..', 'scenarios', 'v0.3ListEditingExpanded.json');
const RANDOM_PATH = path.join(__dirname, '..', 'scenarios', 'v0.3ListRandom500.json');
const LIFECYCLE_PATH = path.join(__dirname, '..', 'scenarios', 'v0.3ListLifecycleRandom500.json');
const EXPECTED_EXPANDED_SHA256 = '92090144cdd6aadaf90a32d27a2e0cc870a2054074a1a47f1432e90851d83bdf';
const EXPECTED_RANDOM_SHA256 = '3ae298bd5e71e6a4760df72ca996fc18e178e08edd47ba8343b38dc2ec98d5a5';
const EXPECTED_LIFECYCLE_SHA256 = '8d13cb734b92759de4af552ecd28aaf740e5420f410c85425f324925161bdd0c';
const EXPECTED_LIFECYCLE_MOTIF_SHA256 = '105c16b11f090f97e3222744fa7ac53ca1263e0168db18ba57172dbd1ffe3cf2';

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

test('expanded list corpus is deterministic, valid, and retained byte-semantically', () => {
  const first = generateListEditingScenarios();
  const second = generateListEditingScenarios();
  const retained = readJson(EXPANDED_PATH);
  assert.deepEqual(first, second);
  assert.deepEqual(retained, first);
  assert.equal(first.scenarioCount, 340);
  assert.equal(first.corpusSha256, EXPECTED_EXPANDED_SHA256);
  const validation = validateListEditingCorpus(first);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('all six arbitrary-number fixtures retain every required mode and exact activation path', () => {
  const { scenarios } = generateListEditingScenarios();
  assert.deepEqual(
    ARBITRARY_ORDERED_FIXTURES.map(({ source }) => source),
    [
      '1. A\n2. B\n3. C',
      '1. A\n7. B\n3. C',
      '4. A\n2. B\n19. C',
      '9. A\n10. B\n11. C',
      '1. A\n1. B\n1. C',
      '0. A\n3. B\n99. C'
    ]
  );
  for (const fixture of ARBITRARY_ORDERED_FIXTURES) {
    const matches = scenarios.filter(({ coverage }) => coverage.arbitraryFixture === fixture.id);
    assert.equal(matches.length, 7, fixture.id);
    assert.ok(matches.some(({ coverage }) => coverage.snapshot === 'source'));
    assert.ok(matches.some(({ coverage }) => coverage.snapshot === 'live-preview-inactive'));
    assert.ok(matches.some(({ coverage }) => coverage.snapshot === 'reading'));
    for (const item of [1, 2, 3]) {
      assert.ok(matches.some(({ coverage }) => (
        coverage.snapshot === 'live-preview-active' && coverage.item === item
      )), `${fixture.id} active item ${item}`);
    }
    const activation = matches.find(({ coverage }) => coverage.activationPath);
    assert.deepEqual(activation.coverage.activationPath, [1, 2, 3, 'outside', 2]);
    assert.deepEqual(activation.actions.map(({ type }) => type), ['click', 'click', 'blur', 'click']);
    assert.deepEqual(activation.actions.filter(({ type }) => type === 'click').map(({ targetItem }) => targetItem), [2, 3, 2]);
    assert.deepEqual(activation.expectedInvariants, {
      canonicalSourceUnchanged: fixture.source,
      noEditingActions: true,
      markerStableAcrossEveryAction: true
    });
  }
});

test('ordered Enter, Backspace, and Delete matrices retain every named boundary', () => {
  const scenarios = generateListEditingScenarios().scenarios;
  const positions = (requirement) => new Set(scenarios
    .filter(({ coverage }) => coverage.requirements.includes(requirement))
    .map(({ coverage }) => coverage.position));
  assert.deepEqual([...positions('ordered-enter')].sort(), [
    'empty-first',
    'empty-second',
    'nested-depth-2',
    'nested-depth-3',
    'repeated',
    'terminal',
    'text-end',
    'text-middle',
    'text-start'
  ]);
  assert.deepEqual([...positions('ordered-backspace')].sort(), [
    'after-dot-before-space',
    'after-number-before-dot',
    'after-space-before-text',
    'before-number',
    'nested-content-start',
    'repeated',
    'second-item-content-start',
    'second-item-line-start',
    'text-end',
    'text-middle'
  ]);
  assert.deepEqual([...positions('ordered-delete')].sort(), [
    'digit',
    'dot',
    'empty',
    'indent',
    'newline',
    'space'
  ]);
  const beforeNumber = scenarios.filter(({ coverage }) => (
    coverage.requirements.includes('ordered-backspace') && coverage.position === 'before-number'
  ));
  assert.equal(beforeNumber.length, 2);
  assert.ok(beforeNumber.every(({ boundary }) => boundary.offset === 0 && boundary.notation === '|1. Alpha'));
  assert.ok(scenarios.filter(({ tags }) => tags.includes('repeated-action')).every(
    ({ actions }) => actions.length === 2
  ));
});

test('unordered marker-byte deletion is named for every raw bullet in both edit modes', () => {
  const scenarios = generateListEditingScenarios().scenarios;
  for (const marker of ['-', '*', '+']) {
    for (const [position, action, offset] of [
      ['marker-byte-backspace', 'Backspace', 1],
      ['marker-byte-delete', 'Delete', 0]
    ]) {
      const matches = scenarios.filter(({ coverage, tags }) => (
        coverage.marker === marker
        && coverage.position === position
        && tags.includes('unordered-marker-byte-matrix')
      ));
      assert.equal(matches.length, 2, `${marker} ${position}`);
      assert.deepEqual(matches.map(({ mode }) => mode).sort(), ['live-preview', 'source']);
      assert.ok(matches.every(({ actions, boundary }) => (
        actionName(actions[0]) === action
        && boundary.offset === offset
      )));
    }
  }
});

test('expanded quotas cover every requirement, action, raw marker, mode, depth, and join', () => {
  const document = generateListEditingScenarios();
  const summary = summarizeListEditingScenarios(document);
  assert.deepEqual(summary.requirements, {
    'arbitrary-numbering': 42,
    'active-transitions': 6,
    'structural-joins': 28,
    'nested-depth': 117,
    'ordered-backspace': 20,
    'ordered-delete': 12,
    'ordered-enter': 18,
    'physical-line-semantics': 30,
    'unordered-markers': 73
  });
  for (const [requirement, quota] of Object.entries(EXPANDED_REQUIREMENT_MINIMUM_QUOTAS)) {
    assert.ok(summary.requirements[requirement] >= quota, requirement);
  }
  assert.deepEqual(summary.actions, {
    inspect: 69,
    click: 27,
    blur: 6,
    Backspace: 74,
    Delete: 64,
    Enter: 86,
    ShiftTab: 18,
    Tab: 18
  });
  assert.deepEqual(summary.markers, { ordered: 149, '-': 88, mixed: 69, '+': 17, '*': 17 });
  assert.deepEqual(summary.modes, {
    'live-preview-active': 173,
    'live-preview-inactive': 13,
    reading: 13,
    source: 141
  });
  assert.deepEqual(summary.depths, { 1: 133, 2: 45, 3: 41 });
  for (const family of JOIN_FAMILIES) {
    assert.equal(summary.joins[`${family}.forward-delete`], 2);
    assert.equal(summary.joins[`${family}.backward-backspace`], 2);
  }
});

test('nested ordered, unordered, and mixed matrices cover all actions at depths one through three', () => {
  const summary = generateListEditingScenarios().summary;
  for (const style of NESTED_STYLES) {
    for (const depth of [1, 2, 3]) {
      for (const action of NESTED_MATRIX_ACTIONS) {
        const count = summary.nestedMatrix[`${style}.depth-${depth}.${action}`];
        assert.equal(count, action === 'activate' ? 1 : 2, `${style} depth ${depth} ${action}`);
      }
    }
  }
});

test('every mutation is duplicated in Source and active Live Preview with full observations', () => {
  const scenarios = generateListEditingScenarios().scenarios;
  const groups = new Map();
  for (const scenario of scenarios.filter(({ tags }) => tags.includes('list-mutation'))) {
    const group = groups.get(scenario.coverage.mutationId) || [];
    group.push(scenario);
    groups.set(scenario.coverage.mutationId, group);
    assert.deepEqual(scenario.requiredObservations, EDIT_REQUIRED_OBSERVATIONS);
    assert.equal(scenario.state.active, true);
  }
  assert.ok(groups.size > 100);
  for (const [id, pair] of groups) {
    assert.deepEqual(pair.map(({ mode }) => mode).sort(), ['live-preview', 'source'], id);
  }
  for (const scenario of scenarios) {
    assert.ok(scenario.tags.includes(LIST_EDITING_TAG));
    if (scenario.mode === 'reading') {
      assert.equal(Object.hasOwn(scenario, 'initialSelection'), false);
      assert.deepEqual(scenario.requiredObservations, READING_REQUIRED_OBSERVATIONS);
    } else {
      assert.ok(scenario.requiredObservations.includes('selection'));
      assert.ok(scenario.requiredObservations.includes('presentation'));
    }
  }
});

test('the 500 seeded list sequences are deterministic, quota-stratified, and retained', () => {
  const first = generateListRandomSequences();
  const second = generateListRandomSequences();
  const retained = readJson(RANDOM_PATH);
  assert.deepEqual(first, second);
  assert.deepEqual(retained, first);
  assert.equal(first.seed, LIST_RANDOM_SEED);
  assert.equal(first.count, 500);
  assert.equal(first.corpusSha256, EXPECTED_RANDOM_SHA256);
  const validation = validateListRandomCorpus(first);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(first.summary.totalActionCount, 5000);
});

test('random sequences satisfy every category, mode, length, action, marker, and depth quota', () => {
  const document = generateListRandomSequences();
  const summary = summarizeListRandomSequences(document);
  assert.deepEqual(summary.categories, RANDOM_CATEGORY_QUOTAS);
  assert.deepEqual(summary.modes, RANDOM_MODE_QUOTAS);
  assert.deepEqual(summary.actionLengths, RANDOM_LENGTH_QUOTAS);
  for (const [action, minimum] of Object.entries(RANDOM_ACTION_MINIMUM_QUOTAS)) {
    assert.ok(summary.actions[action] >= minimum, `${action}: ${summary.actions[action]}`);
  }
  for (const marker of ['ordered', '-', '*', '+', 'mixed']) assert.ok(summary.markers[marker], marker);
  for (const depth of [1, 2, 3]) assert.ok(summary.depths[depth], `depth ${depth}`);
  for (const category of Object.keys(RANDOM_CATEGORY_QUOTAS)) {
    for (const mode of Object.keys(RANDOM_MODE_QUOTAS)) {
      assert.ok(summary.categoryModes[`${category}.${mode}`], `${category}.${mode}`);
    }
  }
  for (const fixture of ARBITRARY_ORDERED_FIXTURES) {
    assert.ok(summary.fixtures[`random-${fixture.id}`], fixture.id);
  }
});

test('every random trace starts with a trusted cross-item click and uses valid history grammar', () => {
  const sequences = generateListRandomSequences().sequences;
  for (const sequence of sequences) {
    assert.ok(sequence.actions.length >= 8 && sequence.actions.length <= 12);
    const first = sequence.actions[0];
    assert.equal(actionName(first), 'click');
    assert.equal(first.trusted, true);
    assert.equal(first.fixedOffset, true);
    assert.equal(first.initialItem, sequence.initialItem);
    assert.notEqual(first.targetItem, sequence.initialItem);
    assert.ok(Number.isFinite(first.offset));
    assert.deepEqual(sequence.requiredObservations, EDIT_REQUIRED_OBSERVATIONS);
    assert.ok(sequence.tags.includes(LIST_EDITING_TAG));
    const history = validateListRandomHistory(sequence.actions);
    assert.equal(history.valid, true, `${sequence.id}: ${history.errors.join('; ')}`);
    sequence.actions.forEach((action, index) => {
      if (actionName(action) === 'Redo') assert.equal(actionName(sequence.actions[index - 1]), 'Undo');
    });
  }
});

test('the 500 seeded lifecycle traces are deterministic, retained, and independently versioned', () => {
  const first = generateListLifecycleRandomSequences();
  const second = generateListLifecycleRandomSequences();
  const retained = readJson(LIFECYCLE_PATH);
  assert.deepEqual(first, second);
  assert.deepEqual(retained, first);
  assert.equal(first.seed, LIST_LIFECYCLE_SEED);
  assert.equal(first.count, LIST_LIFECYCLE_SEQUENCE_COUNT);
  assert.equal(first.actionsPerSequence, LIST_LIFECYCLE_ACTION_COUNT);
  assert.equal(first.corpusSha256, EXPECTED_LIFECYCLE_SHA256);
  assert.equal(first.motifCatalogSha256, EXPECTED_LIFECYCLE_MOTIF_SHA256);
  assert.equal(first.summary.totalActionCount, 4000);
  assert.equal(first.summary.actionTraceStepCount, 4000);
  const validation = validateListLifecycleRandomCorpus(first);
  assert.equal(validation.valid, true, validation.errors.join('\n'));

  const alternate = generateListLifecycleRandomSequences({ seed: 'lifecycle-test-alternate-seed' });
  assert.notEqual(alternate.corpusSha256, first.corpusSha256);
  const alternateValidation = validateListLifecycleRandomCorpus(alternate);
  assert.equal(alternateValidation.valid, true, alternateValidation.errors.join('\n'));
});

test('lifecycle motifs guarantee repeated, alternating, empty, nested, and focus/history coverage', () => {
  const document = generateListLifecycleRandomSequences();
  const summary = summarizeListLifecycleRandomSequences(document);
  assert.deepEqual(summary.motifs, LIST_LIFECYCLE_MOTIF_QUOTAS);
  assert.deepEqual(summary.modes, LIST_LIFECYCLE_MODE_QUOTAS);
  assert.deepEqual(summary.listKinds, LIST_LIFECYCLE_KIND_QUOTAS);
  assert.equal(summary.emptyItemSequenceCount, 300);
  assert.equal(summary.parentNestedBoundarySequenceCount, 300);
  assert.equal(summary.activeTransitionSequenceCount, 50);
  assert.equal(summary.historyReplaySequenceCount, 50);
  for (const [action, minimum] of Object.entries(LIST_LIFECYCLE_ACTION_MINIMUM_QUOTAS)) {
    assert.ok(summary.actions[action] >= minimum, `${action}: ${summary.actions[action]}`);
  }

  const sequences = document.sequences;
  const orderedParent = sequences.find(({ motifId }) => (
    motifId === 'parent-boundary-repeated-enter.ordered'
  ));
  const unorderedParent = sequences.find(({ motifId }) => (
    motifId === 'parent-boundary-repeated-enter.unordered'
  ));
  assert.equal(orderedParent.initialSource, [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '    1. Citrate',
    '    2. Isocitrate'
  ].join('\n'));
  assert.equal(unorderedParent.initialSource, [
    '- Glycolysis',
    '- Link reaction',
    '- TCA cycle',
    '    - Citrate',
    '    - Isocitrate'
  ].join('\n'));

  for (const sequence of sequences) {
    assert.equal(sequence.actions.length, LIST_LIFECYCLE_ACTION_COUNT);
    assert.equal(sequence.actionTracePolicy.captureAfterEveryAction, true);
    assert.equal(sequence.actionTracePolicy.compareAfterEveryAction, true);
    assert.equal(sequence.actionTracePolicy.expectedActionCount, sequence.actions.length);
    assert.ok(sequence.actionTracePolicy.requiredDimensions.includes(
      'presentation.list.lifecycleIntegrity'
    ));
    sequence.actions.forEach((action, index) => {
      assert.equal(action.traceIndex, index);
      assert.equal(action.captureAfterAction, true);
    });
    assert.deepEqual(sequence.requiredObservations, EDIT_REQUIRED_OBSERVATIONS);
    assert.equal(validateListRandomHistory(sequence.actions).valid, true, sequence.id);

    const names = sequence.actions.map(actionName);
    if (sequence.motifFamily.endsWith('repeated-enter')) {
      assert.deepEqual(names.slice(0, 3), ['Enter', 'Enter', 'Enter']);
    }
    if (sequence.motifFamily.endsWith('repeated-backspace')) {
      assert.deepEqual(names.slice(0, 3), ['Backspace', 'Backspace', 'Backspace']);
    }
    if (sequence.motifFamily.endsWith('repeated-delete')) {
      assert.deepEqual(names.slice(0, 3), ['Delete', 'Delete', 'Delete']);
    }
    if (sequence.motifFamily === 'parent-boundary-enter-backspace') {
      assert.deepEqual(names.slice(0, 4), ['Enter', 'Backspace', 'Enter', 'Backspace']);
    }
    if (sequence.motifFamily === 'parent-boundary-enter-delete') {
      assert.deepEqual(names.slice(0, 4), ['Enter', 'Delete', 'Enter', 'Delete']);
    }
    if (sequence.lifecycleCoverage.activeTransitions) {
      assert.equal(sequence.mode, 'live-preview');
      assert.deepEqual(names, ['blur', 'click', 'Enter', 'Undo', 'Redo', 'blur', 'click', 'Enter']);
    }
  }
});

test('CLI writes and checks all three corpora without touching prior corpus files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-list-corpus-test-'));
  try {
    const expanded = path.join(temporary, 'expanded.json');
    const random = path.join(temporary, 'random.json');
    const lifecycle = path.join(temporary, 'lifecycle.json');
    const cli = path.join(__dirname, 'listEditingScenariosCli.js');
    const generated = spawnSync(process.execPath, [
      cli,
      'generate',
      '--expanded-output', expanded,
      '--random-output', random,
      '--lifecycle-output', lifecycle,
      '--quiet'
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(readJson(expanded).corpusSha256, EXPECTED_EXPANDED_SHA256);
    assert.equal(readJson(random).corpusSha256, EXPECTED_RANDOM_SHA256);
    assert.equal(readJson(lifecycle).corpusSha256, EXPECTED_LIFECYCLE_SHA256);
    const checked = spawnSync(process.execPath, [
      cli,
      'check',
      '--expanded-output', expanded,
      '--random-output', random,
      '--lifecycle-output', lifecycle,
      '--quiet'
    ], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
