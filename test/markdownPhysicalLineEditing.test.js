const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const repairGate = require(
  './markdownConformance/scenarios/v0.3ValidRandomTargetedRepairGate.json'
);

function repairCase(category) {
  const scenario = repairGate.sequences.find((entry) => entry.repairCategory === category);
  assert.ok(scenario, `missing targeted repair case: ${category}`);
  return scenario;
}

const indentationCases = [
  {
    category: 'list-structural-root-tab',
    direction: 'indent',
    affectedLineIndices: [0],
    indentUnit: '    '
  },
  {
    category: 'list-structural-child-shift-tab',
    direction: 'outdent',
    affectedLineIndices: [2],
    indentUnit: '  '
  },
  {
    category: 'list-structural-task-continuation-tab',
    direction: 'indent',
    affectedLineIndices: [4],
    indentUnit: '    '
  }
];

for (const gate of indentationCases) {
  test(`O1 targeted ${gate.category} is one exact physical-line edit`, () => {
    const scenario = repairCase(gate.category);
    const expected = scenario.repairMetadata.expectedO1;
    const result = markdown.applyMarkdownIndentation(
      scenario.initialSource,
      scenario.initialSelection,
      gate.direction
    );

    assert.equal(result.source, expected.source);
    assert.deepEqual(result.selection, expected.selection);
    assert.deepEqual(result.affectedLineIndices, gate.affectedLineIndices);
    assert.equal(result.indentUnit, gate.indentUnit);
    assert.equal(result.editKind, 'lines');
  });
}

const deletionCases = [
  {
    category: 'backspace-marker-separator',
    editKind: 'list-separator'
  },
  {
    category: 'backspace-indentation-tab-stop',
    editKind: 'indentation-tab-stop'
  }
];

for (const gate of deletionCases) {
  test(`O1 targeted ${gate.category} restores exact source and caret`, () => {
    const scenario = repairCase(gate.category);
    const expected = scenario.repairMetadata.expectedO1;
    const result = markdown.applyMarkdownStructuralDeletion(
      scenario.initialSource,
      scenario.initialSelection,
      'backward'
    );

    assert.equal(result.source, expected.source);
    assert.deepEqual(result.selection, expected.selection);
    assert.equal(result.editKind, gate.editKind);
  });
}

test('O1 1.13.7 list content separators are byte edits while marker-only roots stay structural', () => {
  for (const marker of ['-', '+', '*']) {
    const content = `${marker} item`;
    const separator = markdown.applyMarkdownStructuralDeletion(
      content,
      { anchor: 2, focus: 2 },
      'backward'
    );
    assert.equal(separator.source, `${marker}item`);
    assert.deepEqual(separator.selection, { anchor: 1, focus: 1 });
    assert.equal(separator.editKind, 'list-separator');

    const markerOnly = markdown.applyMarkdownStructuralDeletion(
      `${marker} `,
      { anchor: 2, focus: 2 },
      'backward'
    );
    assert.equal(markerOnly.source, '');
    assert.equal(markerOnly.editKind, 'list-marker');
  }

  const ordered = '1. Parent\n\t1. Child';
  const childStart = ordered.indexOf('Child');
  const separator = markdown.applyMarkdownStructuralDeletion(
    ordered,
    { anchor: childStart, focus: childStart },
    'backward'
  );
  // Nested ordered items now share the physical separator-byte transaction
  // already used by unordered items; marker-only Enter remains structural.
  assert.equal(separator.source, '1. Parent\n\t1.Child');
  assert.deepEqual(separator.selection, { anchor: childStart - 1, focus: childStart - 1 });
  assert.equal(separator.editKind, 'list-separator');
});

test('leading-whitespace Backspace deletes to the previous four-column stop', () => {
  for (const sample of [
    { source: '  continuation', caret: 2, expected: 'continuation', nextCaret: 0 },
    { source: '     continuation', caret: 5, expected: '    continuation', nextCaret: 4 },
    { source: '\tcontinuation', caret: 1, expected: 'continuation', nextCaret: 0 }
  ]) {
    const result = markdown.applyMarkdownStructuralDeletion(
      sample.source,
      { anchor: sample.caret, focus: sample.caret },
      'backward'
    );
    assert.equal(result.source, sample.expected);
    assert.deepEqual(result.selection, {
      anchor: sample.nextCaret,
      focus: sample.nextCaret
    });
    assert.equal(result.editKind, 'indentation-tab-stop');
  }
});
