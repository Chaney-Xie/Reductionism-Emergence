'use strict';

const { digest } = require('./utils');
const { seededRandom } = require('./randomSequences');

const LIST_EDITING_TAG = 'list-editing-expanded';
const LIST_RANDOM_SEED = 'cogneuro-v0.3-list-editing-random-500-001';
const LIST_LIFECYCLE_SEED = 'cogneuro-v0.3-list-lifecycle-random-500-001';
const LIST_LIFECYCLE_SEQUENCE_COUNT = 500;
const LIST_LIFECYCLE_REPETITIONS_PER_MOTIF = 25;
const LIST_LIFECYCLE_ACTION_COUNT = 8;
const EDIT_REQUIRED_OBSERVATIONS = Object.freeze([
  'source',
  'selection',
  'physical',
  'semantic',
  'presentation'
]);
const READING_REQUIRED_OBSERVATIONS = Object.freeze([
  'source',
  'physical',
  'semantic',
  'presentation'
]);

const ARBITRARY_ORDERED_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'ordered-1-2-3',
    numbers: Object.freeze([1, 2, 3]),
    source: '1. A\n2. B\n3. C'
  }),
  Object.freeze({
    id: 'ordered-1-7-3',
    numbers: Object.freeze([1, 7, 3]),
    source: '1. A\n7. B\n3. C'
  }),
  Object.freeze({
    id: 'ordered-4-2-19',
    numbers: Object.freeze([4, 2, 19]),
    source: '4. A\n2. B\n19. C'
  }),
  Object.freeze({
    id: 'ordered-9-10-11',
    numbers: Object.freeze([9, 10, 11]),
    source: '9. A\n10. B\n11. C'
  }),
  Object.freeze({
    id: 'ordered-1-1-1',
    numbers: Object.freeze([1, 1, 1]),
    source: '1. A\n1. B\n1. C'
  }),
  Object.freeze({
    id: 'ordered-0-3-99',
    numbers: Object.freeze([0, 3, 99]),
    source: '0. A\n3. B\n99. C'
  })
]);

const JOIN_FAMILIES = Object.freeze([
  'list-to-list',
  'list-to-paragraph',
  'paragraph-to-list',
  'ordered-to-unordered',
  'unordered-to-ordered',
  'nested-list-to-parent-item',
  'list-to-blank-line-to-paragraph'
]);

const NESTED_STYLES = Object.freeze(['ordered', 'unordered', 'mixed']);
const NESTED_MATRIX_ACTIONS = Object.freeze([
  'activate',
  'Enter',
  'empty-Enter',
  'Backspace',
  'Delete',
  'Tab',
  'ShiftTab'
]);

const RANDOM_CATEGORY_QUOTAS = Object.freeze({
  ordered: 84,
  unordered: 84,
  mixed: 83,
  nested: 83,
  arbitrary: 83,
  continuation: 83
});
const RANDOM_MODE_QUOTAS = Object.freeze({
  source: 250,
  'live-preview': 250
});
const RANDOM_LENGTH_QUOTAS = Object.freeze({
  8: 100,
  9: 100,
  10: 100,
  11: 100,
  12: 100
});
const RANDOM_ACTION_MINIMUM_QUOTAS = Object.freeze({
  click: 500,
  type: 500,
  ArrowLeft: 40,
  ArrowRight: 40,
  Enter: 40,
  Backspace: 40,
  Delete: 40,
  Tab: 40,
  ShiftTab: 40,
  Undo: 40,
  Redo: 40
});
const LIST_LIFECYCLE_MODE_QUOTAS = Object.freeze({
  source: 250,
  'live-preview': 250
});
const LIST_LIFECYCLE_KIND_QUOTAS = Object.freeze({
  ordered: 250,
  unordered: 250
});
const LIST_LIFECYCLE_ACTION_MINIMUM_QUOTAS = Object.freeze({
  Enter: 450,
  Backspace: 550,
  Delete: 550,
  ArrowLeft: 900,
  ArrowRight: 900,
  click: 100,
  blur: 100,
  Undo: 50,
  Redo: 50
});

const EXPANDED_REQUIREMENT_MINIMUM_QUOTAS = Object.freeze({
  'arbitrary-numbering': 42,
  'active-transitions': 6,
  'ordered-enter': 18,
  'ordered-backspace': 20,
  'ordered-delete': 12,
  'unordered-markers': 45,
  'nested-depth': 117,
  'structural-joins': 28,
  'physical-line-semantics': 30
});

function increment(record, key, amount = 1) {
  const normalized = String(key);
  record[normalized] = (record[normalized] || 0) + amount;
}

function nthIndexOf(source, needle, occurrence = 0) {
  let index = -1;
  let from = 0;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    index = source.indexOf(needle, from);
    if (index < 0) return -1;
    from = index + Math.max(needle.length, 1);
  }
  return index;
}

function caretFixture(markedSource) {
  const first = markedSource.indexOf('|');
  const last = markedSource.lastIndexOf('|');
  if (first < 0 || first !== last) {
    throw new Error(`Caret fixture must contain exactly one |: ${markedSource}`);
  }
  return {
    source: `${markedSource.slice(0, first)}${markedSource.slice(first + 1)}`,
    offset: first,
    notation: markedSource
  };
}

function listItems(source) {
  const items = [];
  const expression = /^([ \t]*)(?:(\d+)([.)])|([-*+]))([ \t]+)/gm;
  let match;
  while ((match = expression.exec(source))) {
    const lineEnd = source.indexOf('\n', match.index);
    items.push({
      index: items.length + 1,
      lineStart: match.index,
      indent: match[1],
      marker: match[4] || `${match[2]}${match[3]}`,
      markerStart: match.index + match[1].length,
      markerEnd: match.index + match[1].length + (match[4] || `${match[2]}${match[3]}`).length,
      contentStart: match.index + match[0].length,
      contentEnd: lineEnd < 0 ? source.length : lineEnd
    });
  }
  return items;
}

function cloneActions(actions) {
  return actions.map((action) => ({ ...action }));
}

function keyboardAction(key, additions = {}) {
  return {
    id: additions.id || (additions.shiftKey ? `shift-${String(key).toLowerCase()}` : String(key).toLowerCase()),
    type: 'keyboard',
    key,
    ...additions
  };
}

function inspectAction() {
  return { id: 'inspect', type: 'inspect', editable: false };
}

function clickAction(offset, item) {
  return {
    id: 'trusted-click-item',
    type: 'click',
    command: 'click',
    offset,
    targetItem: item,
    trusted: true,
    fixedOffset: true
  };
}

function modeLabel(mode, active) {
  if (mode === 'live-preview') return active ? 'live-preview-active' : 'live-preview-inactive';
  return mode;
}

function makeScenario({
  id,
  fixtureId,
  syntaxFamily,
  source,
  mode,
  active,
  offset,
  boundaryName,
  notation,
  actions,
  requirements,
  coverage = {},
  tags = [],
  expectedInvariants
}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(`Scenario ${id} needs at least one action.`);
  }
  const reading = mode === 'reading';
  const copiedActions = cloneActions(actions);
  const action = copiedActions.length === 1
    ? { ...copiedActions[0] }
    : { id: 'sequence', type: 'sequence', steps: cloneActions(copiedActions) };
  const scenario = {
    id: `list-editing-expanded.${id}`,
    schemaVersion: 1,
    fixtureId,
    syntaxFamily,
    initialSource: source,
    mode,
    state: { active: Boolean(active) },
    boundary: {
      name: boundaryName,
      offset,
      ...(notation ? { notation } : {})
    },
    action,
    actions: copiedActions,
    requiredObservations: reading
      ? [...READING_REQUIRED_OBSERVATIONS]
      : [...EDIT_REQUIRED_OBSERVATIONS],
    tags: [...new Set([LIST_EDITING_TAG, ...requirements, ...tags])],
    coverage: {
      requirements: [...requirements],
      mode: modeLabel(mode, active),
      ...coverage
    },
    ...(expectedInvariants ? { expectedInvariants } : {})
  };
  if (!reading) {
    scenario.initialSelection = { anchor: offset, focus: offset };
  }
  return scenario;
}

function makeEditablePair({
  id,
  fixtureId,
  syntaxFamily,
  source,
  offset,
  boundaryName,
  notation,
  actions,
  requirements,
  coverage = {},
  tags = []
}) {
  const mutationId = `list-editing-expanded.${id}`;
  return [
    makeScenario({
      id: `${id}.source`,
      fixtureId,
      syntaxFamily,
      source,
      mode: 'source',
      active: true,
      offset,
      boundaryName,
      notation,
      actions,
      requirements,
      coverage: { ...coverage, mutationId },
      tags: ['list-mutation', ...tags]
    }),
    makeScenario({
      id: `${id}.live-preview-active`,
      fixtureId,
      syntaxFamily,
      source,
      mode: 'live-preview',
      active: true,
      offset,
      boundaryName,
      notation,
      actions,
      requirements,
      coverage: { ...coverage, mutationId },
      tags: ['list-mutation', ...tags]
    })
  ];
}

function addArbitraryOrderedScenarios(scenarios) {
  for (const fixture of ARBITRARY_ORDERED_FIXTURES) {
    const items = listItems(fixture.source);
    const base = {
      fixtureId: fixture.id,
      syntaxFamily: 'ordered-lists',
      source: fixture.source,
      requirements: ['arbitrary-numbering'],
      tags: ['ordered-numbering', 'arbitrary-source-numbers']
    };
    const snapshotCoverage = (snapshot, item = null) => ({
      marker: 'ordered',
      arbitraryFixture: fixture.id,
      sourceNumbers: [...fixture.numbers],
      snapshot,
      ...(item == null ? {} : { item })
    });
    scenarios.push(makeScenario({
      ...base,
      id: `arbitrary.${fixture.id}.source.inspect`,
      mode: 'source',
      active: true,
      offset: items[0].contentStart,
      boundaryName: 'item-1-content-start',
      actions: [inspectAction()],
      coverage: snapshotCoverage('source')
    }));
    scenarios.push(makeScenario({
      ...base,
      id: `arbitrary.${fixture.id}.live-preview-inactive.inspect`,
      mode: 'live-preview',
      active: false,
      offset: items[1].contentStart,
      boundaryName: 'item-2-content-start',
      actions: [inspectAction()],
      coverage: snapshotCoverage('live-preview-inactive')
    }));
    items.forEach((item, index) => {
      scenarios.push(makeScenario({
        ...base,
        id: `arbitrary.${fixture.id}.live-preview-active.item-${index + 1}.inspect`,
        mode: 'live-preview',
        active: true,
        offset: item.contentStart,
        boundaryName: `item-${index + 1}-content-start`,
        actions: [inspectAction()],
        coverage: snapshotCoverage('live-preview-active', index + 1)
      }));
    });
    scenarios.push(makeScenario({
      ...base,
      id: `arbitrary.${fixture.id}.reading.inspect`,
      mode: 'reading',
      active: false,
      offset: items[0].contentStart,
      boundaryName: 'reading-list',
      actions: [inspectAction()],
      coverage: snapshotCoverage('reading')
    }));
    scenarios.push(makeScenario({
      ...base,
      id: `arbitrary.${fixture.id}.live-preview.activation-sequence`,
      mode: 'live-preview',
      active: true,
      offset: items[0].contentStart,
      boundaryName: 'item-1-content-start',
      actions: [
        clickAction(items[1].contentStart, 2),
        clickAction(items[2].contentStart, 3),
        { id: 'blur-outside-editor', type: 'blur', target: 'outside-editor', trusted: true },
        clickAction(items[1].contentStart, 2)
      ],
      requirements: ['arbitrary-numbering', 'active-transitions'],
      coverage: {
        marker: 'ordered',
        arbitraryFixture: fixture.id,
        sourceNumbers: [...fixture.numbers],
        activationPath: [1, 2, 3, 'outside', 2]
      },
      tags: ['ordered-numbering', 'activation-without-edit'],
      expectedInvariants: {
        canonicalSourceUnchanged: fixture.source,
        noEditingActions: true,
        markerStableAcrossEveryAction: true
      }
    }));
  }
}

function addOrderedActionMatrix(scenarios) {
  const enterCases = [
    ['text-start', '1. |Alpha\n2. Beta', [keyboardAction('Enter')]],
    ['text-middle', '1. Al|pha\n2. Beta', [keyboardAction('Enter')]],
    ['text-end', '1. Alpha|\n2. Beta', [keyboardAction('Enter')]],
    ['empty-first', '1. |\n2. Beta', [keyboardAction('Enter')]],
    ['empty-second', '1. Alpha\n2. |', [keyboardAction('Enter')]],
    ['terminal', '1. Alpha|', [keyboardAction('Enter')]],
    ['repeated', '1. Alpha|', [keyboardAction('Enter'), keyboardAction('Enter')]],
    ['nested-depth-2', '1. Alpha\n   1. Beta|', [keyboardAction('Enter')]],
    ['nested-depth-3', '1. Alpha\n   1. Beta\n      1. Gamma|', [keyboardAction('Enter')]]
  ];
  for (const [position, marked, actions] of enterCases) {
    const caret = caretFixture(marked);
    const depth = position.endsWith('-3') ? 3 : position.endsWith('-2') ? 2 : 1;
    scenarios.push(...makeEditablePair({
      id: `ordered.enter.${position}`,
      fixtureId: `ordered-enter-${position}`,
      syntaxFamily: 'ordered-lists',
      ...caret,
      boundaryName: `ordered-enter-${position}`,
      actions,
      requirements: ['ordered-enter'],
      coverage: { marker: 'ordered', matrixAction: 'Enter', position, depth },
      tags: ['ordered-enter-matrix', ...(position === 'repeated' ? ['repeated-action'] : [])]
    }));
  }

  const backspaceCases = [
    ['before-number', '|1. Alpha'],
    ['after-number-before-dot', '1|. Alpha'],
    ['after-dot-before-space', '1.| Alpha'],
    ['after-space-before-text', '1. |Alpha'],
    ['text-middle', '1. A|lpha'],
    ['text-end', '1. Alpha|'],
    ['second-item-content-start', '1. Alpha\n2. |Beta'],
    ['second-item-line-start', '1. Alpha\n|2. Beta'],
    ['nested-content-start', '1. Alpha\n   1. |Beta'],
    ['repeated', '1. Alpha\n2. |Beta']
  ];
  for (const [position, marked] of backspaceCases) {
    const caret = caretFixture(marked);
    const repeated = position === 'repeated';
    scenarios.push(...makeEditablePair({
      id: `ordered.backspace.${position}`,
      fixtureId: `ordered-backspace-${position}`,
      syntaxFamily: 'ordered-lists',
      ...caret,
      boundaryName: `ordered-backspace-${position}`,
      actions: repeated
        ? [keyboardAction('Backspace'), keyboardAction('Backspace')]
        : [keyboardAction('Backspace')],
      requirements: ['ordered-backspace'],
      coverage: {
        marker: 'ordered',
        matrixAction: 'Backspace',
        position,
        depth: position === 'nested-content-start' ? 2 : 1
      },
      tags: ['ordered-backspace-matrix', ...(repeated ? ['repeated-action'] : [])]
    }));
  }

  const deleteCases = [
    ['digit', '|1. Alpha\n2. Beta'],
    ['dot', '1|. Alpha\n2. Beta'],
    ['space', '1.| Alpha\n2. Beta'],
    ['indent', '1. Alpha\n|   1. Beta'],
    ['empty', '1. Alpha\n2. |'],
    ['newline', '1. Alpha|\n2. Beta']
  ];
  for (const [position, marked] of deleteCases) {
    const caret = caretFixture(marked);
    scenarios.push(...makeEditablePair({
      id: `ordered.delete.${position}`,
      fixtureId: `ordered-delete-${position}`,
      syntaxFamily: 'ordered-lists',
      ...caret,
      boundaryName: `ordered-delete-${position}`,
      actions: [keyboardAction('Delete')],
      requirements: ['ordered-delete'],
      coverage: {
        marker: 'ordered',
        matrixAction: 'Delete',
        position,
        depth: position === 'indent' ? 2 : 1
      },
      tags: ['ordered-delete-matrix']
    }));
  }
}

function addUnorderedScenarios(scenarios) {
  const fixtures = [
    { id: 'unordered-dash', marker: '-', source: '- Alpha\n- Beta' },
    { id: 'unordered-star', marker: '*', source: '* Alpha\n* Beta' },
    { id: 'unordered-plus', marker: '+', source: '+ Alpha\n+ Beta' },
    { id: 'unordered-mixed-contiguous', marker: 'mixed', source: '- Alpha\n* Beta\n+ Gamma' }
  ];
  for (const fixture of fixtures) {
    const items = listItems(fixture.source);
    const base = {
      fixtureId: fixture.id,
      syntaxFamily: fixture.marker === 'mixed' ? 'mixed-lists' : 'unordered-lists',
      source: fixture.source,
      requirements: ['unordered-markers'],
      tags: ['unordered-marker-preservation', `raw-marker-${fixture.marker}`]
    };
    const snapshots = [
      { suffix: 'source', mode: 'source', active: true, item: 1 },
      { suffix: 'live-preview-inactive', mode: 'live-preview', active: false, item: 1 },
      ...items.map((item, index) => ({
        suffix: `live-preview-active.item-${index + 1}`,
        mode: 'live-preview',
        active: true,
        item: index + 1
      })),
      { suffix: 'reading', mode: 'reading', active: false, item: 1 }
    ];
    for (const snapshot of snapshots) {
      scenarios.push(makeScenario({
        ...base,
        id: `unordered.${fixture.id}.${snapshot.suffix}.inspect`,
        mode: snapshot.mode,
        active: snapshot.active,
        offset: items[snapshot.item - 1].contentStart,
        boundaryName: `item-${snapshot.item}-content-start`,
        actions: [inspectAction()],
        coverage: {
          marker: fixture.marker,
          unorderedFixture: fixture.id,
          snapshot: snapshot.suffix,
          item: snapshot.item
        }
      }));
    }
  }

  for (const marker of ['-', '*', '+']) {
    const escaped = marker;
    const cases = [
      ['continuation', `${escaped} Alpha|\n${escaped} Beta`, keyboardAction('Enter')],
      ['backspace', `${escaped} |Alpha\n${escaped} Beta`, keyboardAction('Backspace')],
      ['delete-newline', `${escaped} Alpha|\n${escaped} Beta`, keyboardAction('Delete')],
      ['empty-exit', `${escaped} |\n${escaped} Beta`, keyboardAction('Enter')],
      [
        'marker-byte-backspace',
        `${escaped}| Alpha\n${escaped} Beta`,
        keyboardAction('Backspace')
      ],
      [
        'marker-byte-delete',
        `|${escaped} Alpha\n${escaped} Beta`,
        keyboardAction('Delete')
      ]
    ];
    for (const [position, marked, action] of cases) {
      const caret = caretFixture(marked);
      scenarios.push(...makeEditablePair({
        id: `unordered.${marker === '*' ? 'star' : marker === '+' ? 'plus' : 'dash'}.${position}`,
        fixtureId: `unordered-${marker}-${position}`,
        syntaxFamily: 'unordered-lists',
        ...caret,
        boundaryName: `unordered-${position}`,
        actions: [action],
        requirements: ['unordered-markers'],
        coverage: {
          marker,
          matrixAction: action.key,
          position,
          depth: 1
        },
        tags: [
          'unordered-action-matrix',
          `raw-marker-${marker}`,
          ...(position.startsWith('marker-byte-') ? ['unordered-marker-byte-matrix'] : [])
        ]
      }));
    }
  }

  const mixedCases = [
    ['enter-item-1', '- Alpha|\n* Beta\n+ Gamma', keyboardAction('Enter'), 1],
    ['enter-item-2', '- Alpha\n* Beta|\n+ Gamma', keyboardAction('Enter'), 2],
    ['enter-item-3', '- Alpha\n* Beta\n+ Gamma|', keyboardAction('Enter'), 3],
    ['empty-exit-item-1', '- |\n* Beta\n+ Gamma', keyboardAction('Enter'), 1],
    ['empty-exit-item-2', '- Alpha\n* |\n+ Gamma', keyboardAction('Enter'), 2],
    ['empty-exit-item-3', '- Alpha\n* Beta\n+ |', keyboardAction('Enter'), 3],
    ['backspace-item-2', '- Alpha\n* |Beta\n+ Gamma', keyboardAction('Backspace'), 2],
    ['delete-newline-item-1', '- Alpha|\n* Beta\n+ Gamma', keyboardAction('Delete'), 1]
  ];
  for (const [position, marked, action, item] of mixedCases) {
    const caret = caretFixture(marked);
    scenarios.push(...makeEditablePair({
      id: `unordered.mixed.${position}`,
      fixtureId: `unordered-mixed-${position}`,
      syntaxFamily: 'mixed-lists',
      ...caret,
      boundaryName: `mixed-${position}`,
      actions: [action],
      requirements: ['unordered-markers'],
      coverage: {
        marker: 'mixed',
        matrixAction: action.key,
        position,
        item,
        depth: 1
      },
      tags: ['unordered-action-matrix', 'contiguous-mixed-raw-markers']
    }));
  }
}

const NESTED_DEFINITIONS = Object.freeze({
  ordered: Object.freeze({
    syntaxFamily: 'ordered-lists',
    marker: 'ordered',
    source: '1. A\n   1. B\n      1. C\n   2. D\n2. E',
    targets: Object.freeze({ 1: 'A', 2: 'B', 3: 'C' }),
    empty: Object.freeze({
      1: '1. |\n2. E',
      2: '1. A\n   1. |\n2. E',
      3: '1. A\n   1. B\n      1. |\n   2. D\n2. E'
    })
  }),
  unordered: Object.freeze({
    syntaxFamily: 'unordered-lists',
    marker: '-',
    source: '- A\n  - B\n    - C\n  - D\n- E',
    targets: Object.freeze({ 1: 'A', 2: 'B', 3: 'C' }),
    empty: Object.freeze({
      1: '- |\n- E',
      2: '- A\n  - |\n- E',
      3: '- A\n  - B\n    - |\n  - D\n- E'
    })
  }),
  mixed: Object.freeze({
    syntaxFamily: 'mixed-lists',
    marker: 'mixed',
    source: '1. A\n   - B\n     1. C\n   - D\n2. E',
    targets: Object.freeze({ 1: 'A', 2: 'B', 3: 'C' }),
    empty: Object.freeze({
      1: '1. |\n2. E',
      2: '1. A\n   - |\n2. E',
      3: '1. A\n   - B\n     1. |\n   - D\n2. E'
    })
  })
});

function addNestedScenarios(scenarios) {
  for (const style of NESTED_STYLES) {
    const definition = NESTED_DEFINITIONS[style];
    const initialOffset = definition.source.indexOf('E');
    for (const depth of [1, 2, 3]) {
      const target = definition.targets[depth];
      const textStart = definition.source.indexOf(target);
      const textEnd = textStart + target.length;
      scenarios.push(makeScenario({
        id: `nested.${style}.depth-${depth}.activate`,
        fixtureId: `nested-${style}-depth-${depth}`,
        syntaxFamily: definition.syntaxFamily,
        source: definition.source,
        mode: 'live-preview',
        active: true,
        offset: initialOffset,
        boundaryName: 'different-item-content',
        actions: [clickAction(textStart, depth)],
        requirements: ['nested-depth'],
        coverage: {
          marker: definition.marker,
          nestedStyle: style,
          depth,
          matrixAction: 'activate'
        },
        tags: ['nested-list-matrix', 'activation-without-edit'],
        expectedInvariants: {
          canonicalSourceUnchanged: definition.source,
          noEditingActions: true
        }
      }));

      const actionCases = [
        { name: 'Enter', offset: textEnd, actions: [keyboardAction('Enter')] },
        { name: 'Backspace', offset: textStart, actions: [keyboardAction('Backspace')] },
        { name: 'Delete', offset: textEnd, actions: [keyboardAction('Delete')] },
        { name: 'Tab', offset: textStart, actions: [keyboardAction('Tab')] },
        {
          name: 'ShiftTab',
          offset: textStart,
          actions: [keyboardAction('Tab', { id: 'shift-tab', shiftKey: true })]
        }
      ];
      for (const actionCase of actionCases) {
        scenarios.push(...makeEditablePair({
          id: `nested.${style}.depth-${depth}.${actionCase.name.toLowerCase()}`,
          fixtureId: `nested-${style}-depth-${depth}`,
          syntaxFamily: definition.syntaxFamily,
          source: definition.source,
          offset: actionCase.offset,
          boundaryName: `depth-${depth}-${actionCase.name.toLowerCase()}`,
          actions: actionCase.actions,
          requirements: ['nested-depth'],
          coverage: {
            marker: definition.marker,
            nestedStyle: style,
            depth,
            matrixAction: actionCase.name
          },
          tags: ['nested-list-matrix']
        }));
      }

      const empty = caretFixture(definition.empty[depth]);
      scenarios.push(...makeEditablePair({
        id: `nested.${style}.depth-${depth}.empty-enter`,
        fixtureId: `nested-${style}-depth-${depth}-empty`,
        syntaxFamily: definition.syntaxFamily,
        ...empty,
        boundaryName: `depth-${depth}-empty-item`,
        actions: [keyboardAction('Enter')],
        requirements: ['nested-depth'],
        coverage: {
          marker: definition.marker,
          nestedStyle: style,
          depth,
          matrixAction: 'empty-Enter'
        },
        tags: ['nested-list-matrix', 'empty-item-exit']
      }));
    }
  }
}

const JOIN_DEFINITIONS = Object.freeze([
  Object.freeze({
    family: 'list-to-list',
    syntaxFamily: 'ordered-lists',
    marker: 'ordered',
    forward: '1. Alpha|\n2. Beta',
    backward: '1. Alpha\n|2. Beta'
  }),
  Object.freeze({
    family: 'list-to-paragraph',
    syntaxFamily: 'unordered-lists',
    marker: '-',
    forward: '- Alpha|\nParagraph',
    backward: '- Alpha\n|Paragraph'
  }),
  Object.freeze({
    family: 'paragraph-to-list',
    syntaxFamily: 'unordered-lists',
    marker: '-',
    forward: 'Paragraph|\n- Beta',
    backward: 'Paragraph\n|- Beta'
  }),
  Object.freeze({
    family: 'ordered-to-unordered',
    syntaxFamily: 'mixed-lists',
    marker: 'mixed',
    forward: '1. Alpha|\n- Beta',
    backward: '1. Alpha\n|- Beta'
  }),
  Object.freeze({
    family: 'unordered-to-ordered',
    syntaxFamily: 'mixed-lists',
    marker: 'mixed',
    forward: '- Alpha|\n1. Beta',
    backward: '- Alpha\n|1. Beta'
  }),
  Object.freeze({
    family: 'nested-list-to-parent-item',
    syntaxFamily: 'ordered-lists',
    marker: 'ordered',
    forward: '1. Alpha\n   1. Child|\n2. Parent',
    backward: '1. Alpha\n   1. Child\n|2. Parent'
  }),
  Object.freeze({
    family: 'list-to-blank-line-to-paragraph',
    syntaxFamily: 'unordered-lists',
    marker: '-',
    forward: '- Alpha|\n\nParagraph',
    backward: '- Alpha\n\n|Paragraph'
  })
]);

function addJoinScenarios(scenarios) {
  for (const definition of JOIN_DEFINITIONS) {
    for (const direction of ['forward', 'backward']) {
      const caret = caretFixture(definition[direction]);
      const forward = direction === 'forward';
      scenarios.push(...makeEditablePair({
        id: `join.${definition.family}.${forward ? 'forward-delete' : 'backward-backspace'}`,
        fixtureId: `join-${definition.family}`,
        syntaxFamily: definition.syntaxFamily,
        ...caret,
        boundaryName: `${definition.family}-${direction}`,
        actions: [keyboardAction(forward ? 'Delete' : 'Backspace')],
        requirements: ['structural-joins'],
        coverage: {
          marker: definition.marker,
          joinFamily: definition.family,
          direction: forward ? 'forward-delete' : 'backward-backspace',
          matrixAction: forward ? 'Delete' : 'Backspace'
        },
        tags: ['structural-join-matrix']
      }));
    }
  }
}

const PHYSICAL_CONTINUATION_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'unordered-continuation-lines',
    syntaxFamily: 'unordered-lists',
    marker: '-',
    source: '- Alpha\n  continued alpha\n  still alpha\n- Beta',
    target: 'continued alpha',
    physicalLineRoles: Object.freeze(['item', 'continuation', 'continuation', 'item'])
  }),
  Object.freeze({
    id: 'ordered-continuation-with-child',
    syntaxFamily: 'ordered-lists',
    marker: 'ordered',
    source: '1. Alpha\n   continued alpha\n   1. Child\n2. Beta',
    target: 'continued alpha',
    physicalLineRoles: Object.freeze(['item', 'continuation', 'child-list-item', 'item'])
  }),
  Object.freeze({
    id: 'continuation-then-unrelated-paragraph',
    syntaxFamily: 'unordered-lists',
    marker: '-',
    source: '- Alpha\n  continued alpha\n\nOutside paragraph',
    target: 'continued alpha',
    physicalLineRoles: Object.freeze(['item', 'continuation', 'blank', 'paragraph'])
  })
]);

function addPhysicalContinuationScenarios(scenarios) {
  for (const fixture of PHYSICAL_CONTINUATION_FIXTURES) {
    const targetStart = fixture.source.indexOf(fixture.target);
    const targetEnd = targetStart + fixture.target.length;
    const coverage = {
      marker: fixture.marker,
      physicalFixture: fixture.id,
      physicalLineRoles: [...fixture.physicalLineRoles]
    };
    for (const snapshot of [
      { name: 'source', mode: 'source', active: true },
      { name: 'live-preview-inactive', mode: 'live-preview', active: false },
      { name: 'live-preview-active', mode: 'live-preview', active: true },
      { name: 'reading', mode: 'reading', active: false }
    ]) {
      scenarios.push(makeScenario({
        id: `physical.${fixture.id}.${snapshot.name}.inspect`,
        fixtureId: fixture.id,
        syntaxFamily: fixture.syntaxFamily,
        source: fixture.source,
        mode: snapshot.mode,
        active: snapshot.active,
        offset: targetStart,
        boundaryName: 'continuation-line-content-start',
        actions: [inspectAction()],
        requirements: ['physical-line-semantics'],
        coverage: { ...coverage, snapshot: snapshot.name },
        tags: ['physical-continuation-line']
      }));
    }
    for (const actionCase of [
      { name: 'enter', offset: targetEnd, action: keyboardAction('Enter') },
      { name: 'backspace', offset: targetStart, action: keyboardAction('Backspace') },
      { name: 'delete', offset: targetEnd, action: keyboardAction('Delete') }
    ]) {
      scenarios.push(...makeEditablePair({
        id: `physical.${fixture.id}.${actionCase.name}`,
        fixtureId: fixture.id,
        syntaxFamily: fixture.syntaxFamily,
        source: fixture.source,
        offset: actionCase.offset,
        boundaryName: `continuation-line-${actionCase.name}`,
        actions: [actionCase.action],
        requirements: ['physical-line-semantics'],
        coverage: {
          ...coverage,
          matrixAction: actionCase.action.key
        },
        tags: ['physical-continuation-line']
      }));
    }
  }
}

function scenarioActions(scenario) {
  if (Array.isArray(scenario?.actions)) return scenario.actions;
  if (scenario?.action?.type === 'sequence') return scenario.action.steps || [];
  return scenario?.action ? [scenario.action] : [];
}

function actionName(action) {
  if (action?.type === 'click') return 'click';
  if (action?.type === 'blur') return 'blur';
  if (action?.type === 'inspect') return 'inspect';
  if (action?.type === 'input') return 'type';
  if (action?.key === 'Tab' && action.shiftKey) return 'ShiftTab';
  if (String(action?.key).toLowerCase() === 'z') {
    const modifiers = action.modifiers || [];
    return modifiers.includes('shift') || action.shiftKey ? 'Redo' : 'Undo';
  }
  return action?.key || action?.command || action?.type || 'unknown';
}

function summarizeListEditingScenarios(documentOrScenarios) {
  const scenarios = Array.isArray(documentOrScenarios)
    ? documentOrScenarios
    : documentOrScenarios?.scenarios || [];
  const summary = {
    scenarioCount: scenarios.length,
    fixtureCount: new Set(scenarios.map((scenario) => scenario.fixtureId)).size,
    modes: {},
    requirements: {},
    actions: {},
    markers: {},
    depths: {},
    joins: {},
    arbitraryFixtures: {},
    nestedMatrix: {},
    mutationPairs: {}
  };
  for (const scenario of scenarios) {
    increment(summary.modes, modeLabel(scenario.mode, scenario.state?.active));
    for (const requirement of scenario.coverage?.requirements || []) {
      increment(summary.requirements, requirement);
    }
    for (const action of scenarioActions(scenario)) increment(summary.actions, actionName(action));
    if (scenario.coverage?.marker) increment(summary.markers, scenario.coverage.marker);
    if (scenario.coverage?.depth != null) increment(summary.depths, scenario.coverage.depth);
    if (scenario.coverage?.joinFamily) {
      increment(summary.joins, `${scenario.coverage.joinFamily}.${scenario.coverage.direction}`);
    }
    if (scenario.coverage?.arbitraryFixture) {
      increment(summary.arbitraryFixtures, scenario.coverage.arbitraryFixture);
    }
    if (scenario.coverage?.nestedStyle && scenario.coverage?.matrixAction) {
      increment(summary.nestedMatrix, [
        scenario.coverage.nestedStyle,
        `depth-${scenario.coverage.depth}`,
        scenario.coverage.matrixAction
      ].join('.'));
    }
    if (scenario.coverage?.mutationId) increment(summary.mutationPairs, scenario.coverage.mutationId);
  }
  return summary;
}

function generateListEditingScenarios(options = {}) {
  const scenarios = [];
  addArbitraryOrderedScenarios(scenarios);
  addOrderedActionMatrix(scenarios);
  addUnorderedScenarios(scenarios);
  addNestedScenarios(scenarios);
  addJoinScenarios(scenarios);
  addPhysicalContinuationScenarios(scenarios);
  scenarios.sort((left, right) => left.id.localeCompare(right.id));
  const summary = summarizeListEditingScenarios(scenarios);
  return {
    schemaVersion: 1,
    kind: 'v0.3-list-editing-expanded',
    description: 'List-specific deterministic O1/V1 scenarios supplementing the generic v0.3 corpus.',
    generatedAt: options.generatedAt || null,
    deterministic: true,
    tag: LIST_EDITING_TAG,
    fixtureCount: summary.fixtureCount,
    scenarioCount: scenarios.length,
    corpusSha256: digest(scenarios),
    summary,
    scenarios
  };
}

function validateListEditingCorpus(document) {
  const scenarios = document?.scenarios;
  const errors = [];
  if (!Array.isArray(scenarios)) {
    return { valid: false, errors: ['document.scenarios must be an array'], summary: null };
  }
  const summary = summarizeListEditingScenarios(scenarios);
  const ids = new Set();
  const mutationModes = new Map();
  for (const scenario of scenarios) {
    if (!scenario?.id || ids.has(scenario.id)) errors.push(`duplicate or missing scenario id: ${scenario?.id}`);
    ids.add(scenario?.id);
    if (!scenario.tags?.includes(LIST_EDITING_TAG)) errors.push(`${scenario.id}: missing ${LIST_EDITING_TAG} tag`);
    const reading = scenario.mode === 'reading';
    const expected = reading ? READING_REQUIRED_OBSERVATIONS : EDIT_REQUIRED_OBSERVATIONS;
    if (JSON.stringify(scenario.requiredObservations) !== JSON.stringify(expected)) {
      errors.push(`${scenario.id}: requiredObservations do not match mode contract`);
    }
    if (reading && Object.hasOwn(scenario, 'initialSelection')) {
      errors.push(`${scenario.id}: Reading scenario must omit initialSelection`);
    }
    if (!reading && (!Number.isFinite(scenario.initialSelection?.anchor)
      || scenario.initialSelection.anchor !== scenario.initialSelection.focus)) {
      errors.push(`${scenario.id}: non-Reading scenario needs a collapsed exact selection`);
    }
    if (!scenarioActions(scenario).length) errors.push(`${scenario.id}: no actions`);
    if (scenario.coverage?.mutationId) {
      const values = mutationModes.get(scenario.coverage.mutationId) || [];
      values.push(modeLabel(scenario.mode, scenario.state?.active));
      mutationModes.set(scenario.coverage.mutationId, values);
    }
  }
  for (const [mutationId, modes] of mutationModes) {
    const sorted = [...modes].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(['live-preview-active', 'source'])) {
      errors.push(`${mutationId}: mutation modes were ${sorted.join(', ')}`);
    }
  }
  for (const fixture of ARBITRARY_ORDERED_FIXTURES) {
    const fixtureScenarios = scenarios.filter((scenario) => (
      scenario.coverage?.arbitraryFixture === fixture.id
    ));
    const expectedSnapshots = [
      'source',
      'live-preview-inactive',
      'reading'
    ];
    for (const snapshot of expectedSnapshots) {
      if (!fixtureScenarios.some((scenario) => scenario.coverage?.snapshot === snapshot)) {
        errors.push(`${fixture.id}: missing ${snapshot} snapshot`);
      }
    }
    for (const item of [1, 2, 3]) {
      if (!fixtureScenarios.some((scenario) => (
        scenario.coverage?.snapshot === 'live-preview-active'
          && scenario.coverage?.item === item
      ))) errors.push(`${fixture.id}: missing active item ${item} snapshot`);
    }
    const activation = fixtureScenarios.find((scenario) => scenario.coverage?.activationPath);
    if (!activation
      || JSON.stringify(activation.coverage.activationPath) !== JSON.stringify([1, 2, 3, 'outside', 2])) {
      errors.push(`${fixture.id}: missing exact activation path`);
    } else if (scenarioActions(activation).some((action) => !['click', 'blur'].includes(action.type))) {
      errors.push(`${fixture.id}: activation path contains an editing action`);
    }
  }
  for (const [requirement, minimum] of Object.entries(EXPANDED_REQUIREMENT_MINIMUM_QUOTAS)) {
    if ((summary.requirements[requirement] || 0) < minimum) {
      errors.push(`${requirement}: expected at least ${minimum}, saw ${summary.requirements[requirement] || 0}`);
    }
  }
  for (const marker of ['ordered', '-', '*', '+', 'mixed']) {
    if (!summary.markers[marker]) errors.push(`missing marker quota: ${marker}`);
  }
  for (const mode of ['source', 'live-preview-active', 'live-preview-inactive', 'reading']) {
    if (!summary.modes[mode]) errors.push(`missing mode quota: ${mode}`);
  }
  for (const depth of [1, 2, 3]) {
    if (!summary.depths[depth]) errors.push(`missing depth quota: ${depth}`);
  }
  for (const style of NESTED_STYLES) {
    for (const depth of [1, 2, 3]) {
      for (const action of NESTED_MATRIX_ACTIONS) {
        const key = `${style}.depth-${depth}.${action}`;
        if (!summary.nestedMatrix[key]) errors.push(`missing nested matrix cell: ${key}`);
      }
    }
  }
  for (const family of JOIN_FAMILIES) {
    for (const direction of ['forward-delete', 'backward-backspace']) {
      const key = `${family}.${direction}`;
      if ((summary.joins[key] || 0) < 2) errors.push(`missing join quota: ${key}`);
    }
  }
  for (const action of ['inspect', 'click', 'blur', 'Enter', 'Backspace', 'Delete', 'Tab', 'ShiftTab']) {
    if (!summary.actions[action]) errors.push(`missing deterministic action: ${action}`);
  }
  if (document.scenarioCount !== scenarios.length) errors.push('scenarioCount does not match scenarios.length');
  if (document.fixtureCount !== summary.fixtureCount) errors.push('fixtureCount does not match summary');
  if (document.corpusSha256 !== digest(scenarios)) errors.push('corpusSha256 does not match scenarios');
  if (!document.summary || typeof document.summary !== 'object') {
    errors.push('document.summary must be an object');
  } else if (digest(document.summary) !== digest(summary)) {
    errors.push('persisted summary does not match scenarios');
  }
  return { valid: errors.length === 0, errors, summary };
}

const RANDOM_FIXTURES = Object.freeze({
  ordered: Object.freeze([
    Object.freeze({
      id: 'random-ordered-sequential',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 1,
      source: '1. Alpha\n2. Beta\n3. Gamma'
    }),
    Object.freeze({
      id: 'random-ordered-parenthesis',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 1,
      source: '1) Alpha\n2) Beta\n3) Gamma'
    })
  ]),
  unordered: Object.freeze([
    Object.freeze({ id: 'random-unordered-dash', syntaxFamily: 'unordered-lists', marker: '-', maximumDepth: 1, source: '- Alpha\n- Beta\n- Gamma' }),
    Object.freeze({ id: 'random-unordered-star', syntaxFamily: 'unordered-lists', marker: '*', maximumDepth: 1, source: '* Alpha\n* Beta\n* Gamma' }),
    Object.freeze({ id: 'random-unordered-plus', syntaxFamily: 'unordered-lists', marker: '+', maximumDepth: 1, source: '+ Alpha\n+ Beta\n+ Gamma' })
  ]),
  mixed: Object.freeze([
    Object.freeze({ id: 'random-mixed-raw-markers', syntaxFamily: 'mixed-lists', marker: 'mixed', maximumDepth: 1, source: '- Alpha\n* Beta\n+ Gamma' }),
    Object.freeze({ id: 'random-mixed-ordered-unordered', syntaxFamily: 'mixed-lists', marker: 'mixed', maximumDepth: 2, source: '1. Alpha\n   - Beta\n2. Gamma' })
  ]),
  nested: Object.freeze([
    Object.freeze({ id: 'random-nested-depth-1', syntaxFamily: 'ordered-lists', marker: 'ordered', maximumDepth: 1, source: '1. Alpha\n2. Beta\n3. Gamma' }),
    Object.freeze({ id: 'random-nested-depth-2', syntaxFamily: 'unordered-lists', marker: '-', maximumDepth: 2, source: '- Alpha\n  - Beta\n- Gamma' }),
    Object.freeze({ id: 'random-nested-depth-3', syntaxFamily: 'mixed-lists', marker: 'mixed', maximumDepth: 3, source: '1. Alpha\n   - Beta\n     1. Gamma\n2. Delta' })
  ]),
  arbitrary: Object.freeze(ARBITRARY_ORDERED_FIXTURES.map((fixture) => Object.freeze({
    id: `random-${fixture.id}`,
    syntaxFamily: 'ordered-lists',
    marker: 'ordered',
    maximumDepth: 1,
    source: fixture.source
  }))),
  continuation: Object.freeze([
    Object.freeze({ id: 'random-continuation-unordered', syntaxFamily: 'unordered-lists', marker: '-', maximumDepth: 1, source: '- Alpha\n  continued alpha\n- Beta\n- Gamma' }),
    Object.freeze({ id: 'random-continuation-ordered', syntaxFamily: 'ordered-lists', marker: 'ordered', maximumDepth: 2, source: '1. Alpha\n   continued alpha\n   1. Beta\n2. Gamma' }),
    Object.freeze({ id: 'random-continuation-mixed', syntaxFamily: 'mixed-lists', marker: 'mixed', maximumDepth: 2, source: '- Alpha\n  continued alpha\n  1. Beta\n- Gamma' })
  ])
});

function shuffled(random, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [result[index], result[replacement]] = [result[replacement], result[index]];
  }
  return result;
}

function randomInsertAction(random) {
  const texts = ['x', 'A', '1', '*', ' '];
  return {
    id: 'type-text',
    type: 'input',
    command: 'insertText',
    text: texts[Math.floor(random() * texts.length)],
    historyEffect: 'guaranteed-edit'
  };
}

function undoAction() {
  return {
    id: 'undo',
    type: 'keyboard',
    key: 'z',
    modifiers: ['platform-primary'],
    historyEffect: 'undo'
  };
}

function redoAction() {
  return {
    id: 'redo',
    type: 'keyboard',
    key: 'z',
    modifiers: ['platform-primary', 'shift'],
    historyEffect: 'redo'
  };
}

function randomPoolAction(name, random) {
  if (name === 'type') return randomInsertAction(random);
  if (name === 'Undo') return undoAction();
  if (name === 'Redo') return redoAction();
  const possibleEdit = ['Backspace', 'Delete', 'Tab', 'ShiftTab'].includes(name);
  const guaranteedEdit = name === 'Enter';
  return keyboardAction(name === 'ShiftTab' ? 'Tab' : name, {
    id: name === 'ShiftTab' ? 'shift-tab' : name.toLowerCase(),
    ...(name === 'ShiftTab' ? { shiftKey: true } : {}),
    historyEffect: guaranteedEdit ? 'guaranteed-edit' : possibleEdit ? 'possible-edit' : 'navigation'
  });
}

function applyHistoryEffect(state, action) {
  switch (action.historyEffect) {
    case 'guaranteed-edit':
      state.guaranteedUndoDepth += 1;
      state.redoArmed = false;
      break;
    case 'possible-edit':
      state.redoArmed = false;
      break;
    case 'undo':
      if (state.guaranteedUndoDepth <= 0) throw new Error('Undo requires a guaranteed prior edit.');
      state.guaranteedUndoDepth -= 1;
      state.redoArmed = true;
      break;
    case 'redo':
      if (!state.redoArmed) throw new Error('Redo must immediately follow a valid Undo.');
      state.guaranteedUndoDepth += 1;
      state.redoArmed = false;
      break;
    default:
      state.redoArmed = false;
  }
}

function validateListRandomHistory(actions) {
  const errors = [];
  const state = { guaranteedUndoDepth: 0, redoArmed: false };
  actions.forEach((action, index) => {
    try {
      applyHistoryEffect(state, action);
    } catch (error) {
      errors.push(`action ${index}: ${error.message}`);
      state.redoArmed = false;
    }
  });
  return { valid: errors.length === 0, errors };
}

function nextRandomHistoryAction(random, state, remainingSlots) {
  if (state.redoArmed) return redoAction();
  const choices = [
    'ArrowLeft',
    'ArrowRight',
    'type',
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'ShiftTab'
  ];
  if (state.guaranteedUndoDepth > 0 && remainingSlots >= 2) choices.push('Undo');
  return randomPoolAction(choices[Math.floor(random() * choices.length)], random);
}

function buildRandomQuotaSchedule(random) {
  const categories = [];
  for (const [category, count] of Object.entries(RANDOM_CATEGORY_QUOTAS)) {
    for (let index = 0; index < count; index += 1) categories.push(category);
  }
  const assigned = categories.map((category, index) => ({
    category,
    mode: index % 2 === 0 ? 'source' : 'live-preview'
  }));
  return shuffled(random, assigned);
}

function generateListRandomSequences(options = {}) {
  const seed = String(options.seed || LIST_RANDOM_SEED);
  const random = seededRandom(seed);
  const schedule = buildRandomQuotaSchedule(random);
  const categoryIndexes = Object.fromEntries(Object.keys(RANDOM_CATEGORY_QUOTAS).map((key) => [key, 0]));
  const primaryKinds = [
    'ArrowLeft',
    'ArrowRight',
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'ShiftTab',
    'Undo',
    'Redo'
  ];
  const sequences = schedule.map(({ category, mode }, index) => {
    const variants = RANDOM_FIXTURES[category];
    const fixtureIndex = categoryIndexes[category] % variants.length;
    categoryIndexes[category] += 1;
    const fixture = variants[fixtureIndex];
    const items = listItems(fixture.source);
    if (items.length < 2) throw new Error(`Random fixture ${fixture.id} needs two list items.`);
    const actionCount = 8 + (index % 5);
    const state = { guaranteedUndoDepth: 0, redoArmed: false };
    const actions = [
      {
        ...clickAction(items[1].contentStart, 2),
        id: 'trusted-click-another-initial-item',
        initialItem: 1,
        historyEffect: 'navigation'
      }
    ];
    applyHistoryEffect(state, actions[0]);
    const insert = randomInsertAction(random);
    actions.push(insert);
    applyHistoryEffect(state, insert);

    const primaryKind = primaryKinds[index % primaryKinds.length];
    if (primaryKind === 'Undo' || primaryKind === 'Redo') {
      const undo = undoAction();
      actions.push(undo);
      applyHistoryEffect(state, undo);
      const redo = redoAction();
      actions.push(redo);
      applyHistoryEffect(state, redo);
    } else {
      const primary = randomPoolAction(primaryKind, random);
      actions.push(primary);
      applyHistoryEffect(state, primary);
    }
    while (actions.length < actionCount) {
      const next = nextRandomHistoryAction(random, state, actionCount - actions.length);
      actions.push(next);
      applyHistoryEffect(state, next);
    }
    const historyValidation = validateListRandomHistory(actions);
    if (!historyValidation.valid) throw new Error(historyValidation.errors.join('; '));
    const payload = {
      profile: 'v0.3-list-random-500',
      seed,
      sequenceSeed: `${seed}:${index}`,
      index,
      fixtureId: fixture.id,
      fixtureVariant: fixtureIndex,
      category,
      syntaxFamily: fixture.syntaxFamily,
      marker: fixture.marker,
      maximumDepth: fixture.maximumDepth,
      initialSource: fixture.source,
      mode,
      state: { active: true },
      initialItem: 1,
      clickTargetItem: 2,
      initialSelection: {
        anchor: items[0].contentStart,
        focus: items[0].contentStart
      },
      actions,
      comparisonPolicy: { kind: 'fully-comparable', nonComparableDimensions: [] },
      requiredObservations: [...EDIT_REQUIRED_OBSERVATIONS],
      tags: [LIST_EDITING_TAG, 'list-random-500', `list-category-${category}`]
    };
    return {
      id: `list-random-500.${String(index).padStart(3, '0')}.${digest(payload).slice(0, 16)}`,
      schemaVersion: 1,
      ...payload
    };
  });
  const summary = summarizeListRandomSequences(sequences);
  return {
    schemaVersion: 1,
    kind: 'v0.3-list-random-500',
    profile: 'v0.3-list-random-500',
    deterministic: true,
    bounded: true,
    seed,
    count: sequences.length,
    minimumActions: 8,
    maximumActions: 12,
    quotas: {
      categories: { ...RANDOM_CATEGORY_QUOTAS },
      modes: { ...RANDOM_MODE_QUOTAS },
      actionLengths: { ...RANDOM_LENGTH_QUOTAS },
      minimumActions: { ...RANDOM_ACTION_MINIMUM_QUOTAS }
    },
    corpusSha256: digest(sequences),
    summary,
    sequences
  };
}

function summarizeListRandomSequences(documentOrSequences) {
  const sequences = Array.isArray(documentOrSequences)
    ? documentOrSequences
    : documentOrSequences?.sequences || [];
  const summary = {
    sequenceCount: sequences.length,
    totalActionCount: 0,
    categories: {},
    modes: {},
    actionLengths: {},
    actions: {},
    markers: {},
    depths: {},
    fixtures: {},
    categoryModes: {}
  };
  for (const sequence of sequences) {
    increment(summary.categories, sequence.category);
    increment(summary.modes, sequence.mode);
    increment(summary.actionLengths, sequence.actions?.length || 0);
    increment(summary.markers, sequence.marker);
    increment(summary.depths, sequence.maximumDepth);
    increment(summary.fixtures, sequence.fixtureId);
    increment(summary.categoryModes, `${sequence.category}.${sequence.mode}`);
    for (const action of sequence.actions || []) {
      increment(summary.actions, actionName(action));
      summary.totalActionCount += 1;
    }
  }
  return summary;
}

function validateListRandomCorpus(document) {
  const sequences = document?.sequences;
  const errors = [];
  if (!Array.isArray(sequences)) {
    return { valid: false, errors: ['document.sequences must be an array'], summary: null };
  }
  const summary = summarizeListRandomSequences(sequences);
  const ids = new Set();
  const allowed = new Set(Object.keys(RANDOM_ACTION_MINIMUM_QUOTAS));
  for (const sequence of sequences) {
    if (!sequence?.id || ids.has(sequence.id)) errors.push(`duplicate or missing sequence id: ${sequence?.id}`);
    ids.add(sequence?.id);
    if (sequence.seed !== document.seed || sequence.sequenceSeed !== `${document.seed}:${sequence.index}`) {
      errors.push(`${sequence.id}: seed was not persisted exactly`);
    }
    if (!Number.isSafeInteger(sequence.index)) errors.push(`${sequence.id}: missing integer index`);
    const actions = Array.isArray(sequence.actions) ? sequence.actions : [];
    if (!Array.isArray(sequence.actions)) errors.push(`${sequence.id}: actions must be an array`);
    if (actions.length < 8 || actions.length > 12) {
      errors.push(`${sequence.id}: action length outside 8-12`);
    }
    const first = actions[0];
    if (actionName(first) !== 'click' || first.trusted !== true || first.fixedOffset !== true
      || !Number.isFinite(first.offset) || first.targetItem === sequence.initialItem) {
      errors.push(`${sequence.id}: first action is not a trusted fixed-offset click to another item`);
    }
    if (JSON.stringify(sequence.requiredObservations) !== JSON.stringify(EDIT_REQUIRED_OBSERVATIONS)) {
      errors.push(`${sequence.id}: presentation is not required at every step`);
    }
    if (!sequence.tags?.includes(LIST_EDITING_TAG)) errors.push(`${sequence.id}: missing corpus tag`);
    const history = validateListRandomHistory(actions);
    if (!history.valid) errors.push(...history.errors.map((error) => `${sequence.id}: ${error}`));
    for (const action of actions) {
      const name = actionName(action);
      if (!allowed.has(name)) errors.push(`${sequence.id}: action outside bounded list pool: ${name}`);
    }
  }
  if (sequences.length !== 500 || document.count !== 500) errors.push('random corpus must contain exactly 500 sequences');
  for (const [category, quota] of Object.entries(RANDOM_CATEGORY_QUOTAS)) {
    if (summary.categories[category] !== quota) {
      errors.push(`${category}: expected exact category quota ${quota}, saw ${summary.categories[category] || 0}`);
    }
    for (const mode of Object.keys(RANDOM_MODE_QUOTAS)) {
      if (!summary.categoryModes[`${category}.${mode}`]) {
        errors.push(`${category}: missing ${mode} stratification`);
      }
    }
  }
  for (const [mode, quota] of Object.entries(RANDOM_MODE_QUOTAS)) {
    if (summary.modes[mode] !== quota) errors.push(`${mode}: expected mode quota ${quota}`);
  }
  for (const [length, quota] of Object.entries(RANDOM_LENGTH_QUOTAS)) {
    if (summary.actionLengths[length] !== quota) errors.push(`length ${length}: expected quota ${quota}`);
  }
  for (const [action, quota] of Object.entries(RANDOM_ACTION_MINIMUM_QUOTAS)) {
    if ((summary.actions[action] || 0) < quota) {
      errors.push(`${action}: expected minimum action quota ${quota}, saw ${summary.actions[action] || 0}`);
    }
  }
  for (const marker of ['ordered', '-', '*', '+', 'mixed']) {
    if (!summary.markers[marker]) errors.push(`random corpus missing marker ${marker}`);
  }
  for (const depth of [1, 2, 3]) {
    if (!summary.depths[depth]) errors.push(`random corpus missing maximum depth ${depth}`);
  }
  for (const fixture of ARBITRARY_ORDERED_FIXTURES) {
    if (!summary.fixtures[`random-${fixture.id}`]) errors.push(`random corpus missing arbitrary fixture ${fixture.id}`);
  }
  if (document.corpusSha256 !== digest(sequences)) errors.push('corpusSha256 does not match sequences');
  if (!document.summary || typeof document.summary !== 'object') {
    errors.push('document.summary must be an object');
  } else if (digest(document.summary) !== digest(summary)) {
    errors.push('persisted summary does not match sequences');
  }
  return { valid: errors.length === 0, errors, summary };
}

function makeLifecycleFixtureDefinition({
  id,
  syntaxFamily,
  marker,
  maximumDepth,
  markedSource,
  targetItem,
  boundaryName,
  emptyItem,
  parentNestedBoundary
}) {
  const caret = caretFixture(markedSource);
  return Object.freeze({
    id,
    syntaxFamily,
    marker,
    maximumDepth,
    source: caret.source,
    offset: caret.offset,
    notation: caret.notation,
    targetItem,
    boundaryName,
    emptyItem: Boolean(emptyItem),
    parentNestedBoundary: Boolean(parentNestedBoundary)
  });
}

const LIST_LIFECYCLE_FIXTURES = Object.freeze({
  ordered: Object.freeze({
    parentBoundary: makeLifecycleFixtureDefinition({
      id: 'lifecycle-ordered-parent-before-nested-list',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 2,
      markedSource: [
        '1. Glycolysis',
        '2. Link reaction',
        '3. TCA cycle|',
        '    1. Citrate',
        '    2. Isocitrate'
      ].join('\n'),
      targetItem: 3,
      boundaryName: 'parent-text-end-before-nested-list',
      emptyItem: false,
      parentNestedBoundary: true
    }),
    ownedEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-ordered-empty-parent-with-nested-list',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 2,
      markedSource: '1. A\n2. |\n    1. C\n    2. D',
      targetItem: 2,
      boundaryName: 'empty-parent-item-before-nested-list',
      emptyItem: true,
      parentNestedBoundary: true
    }),
    rootEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-ordered-root-empty-item',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 1,
      markedSource: '1. A\n2. |',
      targetItem: 2,
      boundaryName: 'terminal-root-empty-item',
      emptyItem: true,
      parentNestedBoundary: false
    }),
    nestedEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-ordered-nested-empty-item',
      syntaxFamily: 'ordered-lists',
      marker: 'ordered',
      maximumDepth: 2,
      markedSource: '1. A\n    1. |',
      targetItem: 2,
      boundaryName: 'terminal-nested-empty-item',
      emptyItem: true,
      parentNestedBoundary: false
    })
  }),
  unordered: Object.freeze({
    parentBoundary: makeLifecycleFixtureDefinition({
      id: 'lifecycle-unordered-parent-before-nested-list',
      syntaxFamily: 'unordered-lists',
      marker: '-',
      maximumDepth: 2,
      markedSource: [
        '- Glycolysis',
        '- Link reaction',
        '- TCA cycle|',
        '    - Citrate',
        '    - Isocitrate'
      ].join('\n'),
      targetItem: 3,
      boundaryName: 'parent-text-end-before-nested-list',
      emptyItem: false,
      parentNestedBoundary: true
    }),
    ownedEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-unordered-empty-parent-with-nested-list',
      syntaxFamily: 'unordered-lists',
      marker: '-',
      maximumDepth: 2,
      markedSource: '- A\n- |\n    - C\n    - D',
      targetItem: 2,
      boundaryName: 'empty-parent-item-before-nested-list',
      emptyItem: true,
      parentNestedBoundary: true
    }),
    rootEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-unordered-root-empty-item',
      syntaxFamily: 'unordered-lists',
      marker: '-',
      maximumDepth: 1,
      markedSource: '- A\n- |',
      targetItem: 2,
      boundaryName: 'terminal-root-empty-item',
      emptyItem: true,
      parentNestedBoundary: false
    }),
    nestedEmpty: makeLifecycleFixtureDefinition({
      id: 'lifecycle-unordered-nested-empty-item',
      syntaxFamily: 'unordered-lists',
      marker: '-',
      maximumDepth: 2,
      markedSource: '- A\n    - |',
      targetItem: 2,
      boundaryName: 'terminal-nested-empty-item',
      emptyItem: true,
      parentNestedBoundary: false
    })
  })
});

const LIST_LIFECYCLE_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'parent-boundary-repeated-enter',
    fixture: 'parentBoundary',
    coreActions: Object.freeze(['Enter', 'Enter', 'Enter']),
    repeatedAction: 'Enter'
  }),
  Object.freeze({
    id: 'owned-empty-repeated-backspace',
    fixture: 'ownedEmpty',
    coreActions: Object.freeze(['Backspace', 'Backspace', 'Backspace']),
    repeatedAction: 'Backspace'
  }),
  Object.freeze({
    id: 'owned-empty-repeated-delete',
    fixture: 'ownedEmpty',
    coreActions: Object.freeze(['Delete', 'Delete', 'Delete']),
    repeatedAction: 'Delete'
  }),
  Object.freeze({
    id: 'parent-boundary-enter-backspace',
    fixture: 'parentBoundary',
    coreActions: Object.freeze(['Enter', 'Backspace', 'Enter', 'Backspace']),
    alternatingActions: Object.freeze(['Enter', 'Backspace'])
  }),
  Object.freeze({
    id: 'parent-boundary-enter-delete',
    fixture: 'parentBoundary',
    coreActions: Object.freeze(['Enter', 'Delete', 'Enter', 'Delete']),
    alternatingActions: Object.freeze(['Enter', 'Delete'])
  }),
  Object.freeze({
    id: 'root-empty-repeated-backspace',
    fixture: 'rootEmpty',
    coreActions: Object.freeze(['Backspace', 'Backspace', 'Backspace']),
    repeatedAction: 'Backspace'
  }),
  Object.freeze({
    id: 'root-empty-repeated-delete',
    fixture: 'rootEmpty',
    coreActions: Object.freeze(['Delete', 'Delete', 'Delete']),
    repeatedAction: 'Delete'
  }),
  Object.freeze({
    id: 'nested-empty-repeated-backspace',
    fixture: 'nestedEmpty',
    coreActions: Object.freeze(['Backspace', 'Backspace', 'Backspace']),
    repeatedAction: 'Backspace'
  }),
  Object.freeze({
    id: 'nested-empty-repeated-delete',
    fixture: 'nestedEmpty',
    coreActions: Object.freeze(['Delete', 'Delete', 'Delete']),
    repeatedAction: 'Delete'
  }),
  Object.freeze({
    id: 'active-inactive-enter-history',
    fixture: 'parentBoundary',
    coreActions: Object.freeze([
      'blur',
      'reactivate',
      'Enter',
      'Undo',
      'Redo',
      'blur',
      'reactivate',
      'Enter'
    ]),
    activeTransitions: true,
    historyReplay: true
  })
]);

const LIST_LIFECYCLE_MOTIFS = Object.freeze(LIST_LIFECYCLE_FAMILIES.flatMap(
  (family, familyIndex) => ['ordered', 'unordered'].map((listKind) => Object.freeze({
    id: `${family.id}.${listKind}`,
    family: family.id,
    familyIndex,
    listKind,
    fixture: family.fixture,
    coreActions: family.coreActions,
    repeatedAction: family.repeatedAction || null,
    alternatingActions: family.alternatingActions || null,
    activeTransitions: Boolean(family.activeTransitions),
    historyReplay: Boolean(family.historyReplay)
  }))
));

const LIST_LIFECYCLE_MOTIF_QUOTAS = Object.freeze(Object.fromEntries(
  LIST_LIFECYCLE_MOTIFS.map((motif) => [motif.id, LIST_LIFECYCLE_REPETITIONS_PER_MOTIF])
));

function lifecycleActionName(token) {
  if (token === 'reactivate') return 'click';
  return token;
}

function lifecycleActionFromToken(token, fixture) {
  if (token === 'blur') {
    return {
      id: 'blur-outside-editor',
      type: 'blur',
      target: 'outside-editor',
      trusted: true,
      historyEffect: 'navigation'
    };
  }
  if (token === 'reactivate') {
    return {
      ...clickAction(fixture.offset, fixture.targetItem),
      id: 'trusted-reactivate-lifecycle-boundary',
      historyEffect: 'navigation'
    };
  }
  if (token === 'Undo') return undoAction();
  if (token === 'Redo') return redoAction();
  if (token === 'Enter') {
    return keyboardAction('Enter', { historyEffect: 'guaranteed-edit' });
  }
  if (token === 'Backspace' || token === 'Delete') {
    return keyboardAction(token, { historyEffect: 'possible-edit' });
  }
  if (token === 'ArrowLeft' || token === 'ArrowRight') {
    return keyboardAction(token, { historyEffect: 'navigation' });
  }
  throw new Error(`Unsupported lifecycle action token: ${token}`);
}

function lifecycleMode(motif, repetition) {
  if (motif.activeTransitions) return 'live-preview';
  const sourceRepetitions = motif.familyIndex < 8 ? 14 : 13;
  return repetition < sourceRepetitions ? 'source' : 'live-preview';
}

function lifecycleActionTokens(motif, sequenceSeed) {
  const tokens = [...motif.coreActions];
  const random = seededRandom(sequenceSeed);
  while (tokens.length < LIST_LIFECYCLE_ACTION_COUNT) {
    tokens.push(random() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
  }
  if (tokens.length !== LIST_LIFECYCLE_ACTION_COUNT) {
    throw new Error(`${motif.id}: lifecycle motif exceeds ${LIST_LIFECYCLE_ACTION_COUNT} actions`);
  }
  return tokens;
}

function lifecycleMotifCatalog(sequences) {
  return LIST_LIFECYCLE_MOTIFS.map((motif) => {
    const matches = sequences.filter((sequence) => sequence.motifId === motif.id);
    return {
      id: motif.id,
      family: motif.family,
      listKind: motif.listKind,
      fixtureId: LIST_LIFECYCLE_FIXTURES[motif.listKind][motif.fixture].id,
      coreActions: motif.coreActions.map(lifecycleActionName),
      sequenceCount: matches.length,
      modes: matches.reduce((modes, sequence) => {
        increment(modes, sequence.mode);
        return modes;
      }, {}),
      repeatedAction: motif.repeatedAction,
      alternatingActions: motif.alternatingActions,
      activeTransitions: motif.activeTransitions,
      historyReplay: motif.historyReplay
    };
  });
}

function generateListLifecycleRandomSequences(options = {}) {
  const seed = String(options.seed || LIST_LIFECYCLE_SEED);
  const sequences = [];
  for (const motif of LIST_LIFECYCLE_MOTIFS) {
    const fixture = LIST_LIFECYCLE_FIXTURES[motif.listKind][motif.fixture];
    for (let repetition = 0; repetition < LIST_LIFECYCLE_REPETITIONS_PER_MOTIF; repetition += 1) {
      const index = sequences.length;
      const sequenceSeed = `${seed}:${motif.id}:${repetition}`;
      const tokens = lifecycleActionTokens(motif, sequenceSeed);
      const actions = tokens.map((token, traceIndex) => ({
        ...lifecycleActionFromToken(token, fixture),
        traceIndex,
        captureAfterAction: true,
        motifRole: traceIndex < motif.coreActions.length ? 'motif-core' : 'seeded-padding'
      }));
      const historyValidation = validateListRandomHistory(actions);
      if (!historyValidation.valid) {
        throw new Error(`${motif.id}: ${historyValidation.errors.join('; ')}`);
      }
      const payload = {
        profile: 'v0.3-list-lifecycle-random-500',
        seed,
        sequenceSeed,
        index,
        motifId: motif.id,
        motifFamily: motif.family,
        motifRepetition: repetition,
        fixtureId: fixture.id,
        boundaryKind: fixture.boundaryName,
        listKind: motif.listKind,
        syntaxFamily: fixture.syntaxFamily,
        marker: fixture.marker,
        maximumDepth: fixture.maximumDepth,
        initialSource: fixture.source,
        initialSelection: { anchor: fixture.offset, focus: fixture.offset },
        initialItem: fixture.targetItem,
        boundary: {
          name: fixture.boundaryName,
          offset: fixture.offset,
          notation: fixture.notation
        },
        mode: lifecycleMode(motif, repetition),
        state: { active: true },
        actions,
        actionTracePolicy: {
          required: true,
          captureAfterEveryAction: true,
          compareAfterEveryAction: true,
          expectedActionCount: actions.length,
          requiredDimensions: [
            'source',
            'selection',
            'physical',
            'semantic',
            'presentation.list',
            'presentation.list.focus',
            'presentation.list.lifecycleIntegrity'
          ]
        },
        lifecycleCoverage: {
          emptyItem: fixture.emptyItem,
          parentNestedBoundary: fixture.parentNestedBoundary,
          repeatedAction: motif.repeatedAction,
          alternatingActions: motif.alternatingActions,
          activeTransitions: motif.activeTransitions,
          historyReplay: motif.historyReplay
        },
        comparisonPolicy: { kind: 'fully-comparable', nonComparableDimensions: [] },
        requiredObservations: [...EDIT_REQUIRED_OBSERVATIONS],
        tags: [
          LIST_EDITING_TAG,
          'list-lifecycle-random-500',
          'empty-item-lifecycle',
          `${motif.listKind}-list-lifecycle`,
          `lifecycle-motif-${motif.family}`,
          ...(fixture.parentNestedBoundary ? ['parent-nested-boundary'] : []),
          ...(motif.activeTransitions ? ['active-inactive-transitions'] : [])
        ]
      };
      sequences.push({
        id: `list-lifecycle-random-500.${String(index).padStart(3, '0')}.${digest(payload).slice(0, 16)}`,
        schemaVersion: 1,
        ...payload
      });
    }
  }
  const summary = summarizeListLifecycleRandomSequences(sequences);
  const motifCatalog = lifecycleMotifCatalog(sequences);
  return {
    schemaVersion: 1,
    kind: 'v0.3-list-lifecycle-random-500',
    profile: 'v0.3-list-lifecycle-random-500',
    deterministic: true,
    bounded: true,
    seed,
    count: sequences.length,
    actionsPerSequence: LIST_LIFECYCLE_ACTION_COUNT,
    captureAfterEveryAction: true,
    quotas: {
      motifs: { ...LIST_LIFECYCLE_MOTIF_QUOTAS },
      modes: { ...LIST_LIFECYCLE_MODE_QUOTAS },
      listKinds: { ...LIST_LIFECYCLE_KIND_QUOTAS },
      minimumActions: { ...LIST_LIFECYCLE_ACTION_MINIMUM_QUOTAS }
    },
    motifCatalogSha256: digest(motifCatalog),
    motifCatalog,
    corpusSha256: digest(sequences),
    summary,
    sequences
  };
}

function summarizeListLifecycleRandomSequences(documentOrSequences) {
  const sequences = Array.isArray(documentOrSequences)
    ? documentOrSequences
    : documentOrSequences?.sequences || [];
  const summary = {
    sequenceCount: sequences.length,
    totalActionCount: 0,
    actionTraceStepCount: 0,
    motifs: {},
    families: {},
    modes: {},
    listKinds: {},
    actions: {},
    fixtures: {},
    boundaries: {},
    emptyItemSequenceCount: 0,
    parentNestedBoundarySequenceCount: 0,
    activeTransitionSequenceCount: 0,
    historyReplaySequenceCount: 0
  };
  for (const sequence of sequences) {
    increment(summary.motifs, sequence.motifId);
    increment(summary.families, sequence.motifFamily);
    increment(summary.modes, sequence.mode);
    increment(summary.listKinds, sequence.listKind);
    increment(summary.fixtures, sequence.fixtureId);
    increment(summary.boundaries, sequence.boundaryKind);
    if (sequence.lifecycleCoverage?.emptyItem) summary.emptyItemSequenceCount += 1;
    if (sequence.lifecycleCoverage?.parentNestedBoundary) {
      summary.parentNestedBoundarySequenceCount += 1;
    }
    if (sequence.lifecycleCoverage?.activeTransitions) {
      summary.activeTransitionSequenceCount += 1;
    }
    if (sequence.lifecycleCoverage?.historyReplay) summary.historyReplaySequenceCount += 1;
    for (const action of sequence.actions || []) {
      increment(summary.actions, actionName(action));
      summary.totalActionCount += 1;
      if (action.captureAfterAction === true) summary.actionTraceStepCount += 1;
    }
  }
  return summary;
}

function validateListLifecycleRandomCorpus(document) {
  const sequences = document?.sequences;
  const errors = [];
  if (!Array.isArray(sequences)) {
    return { valid: false, errors: ['document.sequences must be an array'], summary: null };
  }
  const summary = summarizeListLifecycleRandomSequences(sequences);
  const motifById = new Map(LIST_LIFECYCLE_MOTIFS.map((motif) => [motif.id, motif]));
  const ids = new Set();
  sequences.forEach((sequence, expectedIndex) => {
    if (!sequence?.id || ids.has(sequence.id)) {
      errors.push(`duplicate or missing sequence id: ${sequence?.id}`);
    }
    ids.add(sequence?.id);
    if (sequence.index !== expectedIndex) {
      errors.push(`${sequence.id}: expected sequential index ${expectedIndex}, saw ${sequence.index}`);
    }
    const motif = motifById.get(sequence.motifId);
    if (!motif) {
      errors.push(`${sequence.id}: unknown lifecycle motif ${sequence.motifId}`);
      return;
    }
    const fixture = LIST_LIFECYCLE_FIXTURES[motif.listKind][motif.fixture];
    const expectedSequenceSeed = `${document.seed}:${motif.id}:${sequence.motifRepetition}`;
    if (sequence.seed !== document.seed || sequence.sequenceSeed !== expectedSequenceSeed) {
      errors.push(`${sequence.id}: lifecycle seed was not persisted exactly`);
    }
    if (!Number.isSafeInteger(sequence.motifRepetition)
      || sequence.motifRepetition < 0
      || sequence.motifRepetition >= LIST_LIFECYCLE_REPETITIONS_PER_MOTIF) {
      errors.push(`${sequence.id}: invalid motif repetition`);
    }
    if (sequence.motifFamily !== motif.family || sequence.listKind !== motif.listKind) {
      errors.push(`${sequence.id}: motif family/list kind metadata mismatch`);
    }
    if (sequence.fixtureId !== fixture.id
      || sequence.initialSource !== fixture.source
      || sequence.boundary?.offset !== fixture.offset
      || sequence.boundary?.notation !== fixture.notation) {
      errors.push(`${sequence.id}: lifecycle fixture or boundary drifted`);
    }
    if (sequence.mode !== lifecycleMode(motif, sequence.motifRepetition)) {
      errors.push(`${sequence.id}: lifecycle mode schedule drifted`);
    }
    const actions = Array.isArray(sequence.actions) ? sequence.actions : [];
    if (actions.length !== LIST_LIFECYCLE_ACTION_COUNT) {
      errors.push(`${sequence.id}: expected ${LIST_LIFECYCLE_ACTION_COUNT} actions`);
    }
    const expectedTokens = lifecycleActionTokens(motif, expectedSequenceSeed);
    const expectedActionNames = expectedTokens.map(lifecycleActionName);
    const actualActionNames = actions.map(actionName);
    if (JSON.stringify(actualActionNames) !== JSON.stringify(expectedActionNames)) {
      errors.push(`${sequence.id}: lifecycle action motif or seeded padding drifted`);
    }
    actions.forEach((action, traceIndex) => {
      if (action.traceIndex !== traceIndex || action.captureAfterAction !== true) {
        errors.push(`${sequence.id}: action ${traceIndex} lacks per-action trace metadata`);
      }
      const expectedRole = traceIndex < motif.coreActions.length ? 'motif-core' : 'seeded-padding';
      if (action.motifRole !== expectedRole) {
        errors.push(`${sequence.id}: action ${traceIndex} has wrong motif role`);
      }
    });
    const trace = sequence.actionTracePolicy;
    if (trace?.required !== true
      || trace.captureAfterEveryAction !== true
      || trace.compareAfterEveryAction !== true
      || trace.expectedActionCount !== actions.length
      || !trace.requiredDimensions?.includes('presentation.list.lifecycleIntegrity')) {
      errors.push(`${sequence.id}: incomplete action-trace lifecycle policy`);
    }
    if (JSON.stringify(sequence.requiredObservations) !== JSON.stringify(EDIT_REQUIRED_OBSERVATIONS)) {
      errors.push(`${sequence.id}: full editable observations are not required`);
    }
    if (!sequence.tags?.includes(LIST_EDITING_TAG)
      || !sequence.tags?.includes('list-lifecycle-random-500')) {
      errors.push(`${sequence.id}: missing lifecycle corpus tags`);
    }
    const history = validateListRandomHistory(actions);
    if (!history.valid) errors.push(...history.errors.map((error) => `${sequence.id}: ${error}`));
  });

  if (document.kind !== 'v0.3-list-lifecycle-random-500'
    || document.profile !== 'v0.3-list-lifecycle-random-500') {
    errors.push('lifecycle corpus kind/profile mismatch');
  }
  if (sequences.length !== LIST_LIFECYCLE_SEQUENCE_COUNT
    || document.count !== LIST_LIFECYCLE_SEQUENCE_COUNT) {
    errors.push(`lifecycle corpus must contain exactly ${LIST_LIFECYCLE_SEQUENCE_COUNT} sequences`);
  }
  if (document.actionsPerSequence !== LIST_LIFECYCLE_ACTION_COUNT
    || document.captureAfterEveryAction !== true) {
    errors.push('lifecycle corpus must capture every action in each bounded trace');
  }
  for (const [motif, quota] of Object.entries(LIST_LIFECYCLE_MOTIF_QUOTAS)) {
    if (summary.motifs[motif] !== quota) {
      errors.push(`${motif}: expected motif quota ${quota}, saw ${summary.motifs[motif] || 0}`);
    }
  }
  for (const family of LIST_LIFECYCLE_FAMILIES) {
    const expected = LIST_LIFECYCLE_REPETITIONS_PER_MOTIF * 2;
    if (summary.families[family.id] !== expected) {
      errors.push(`${family.id}: expected family quota ${expected}`);
    }
  }
  for (const [mode, quota] of Object.entries(LIST_LIFECYCLE_MODE_QUOTAS)) {
    if (summary.modes[mode] !== quota) errors.push(`${mode}: expected lifecycle mode quota ${quota}`);
  }
  for (const [kind, quota] of Object.entries(LIST_LIFECYCLE_KIND_QUOTAS)) {
    if (summary.listKinds[kind] !== quota) errors.push(`${kind}: expected list-kind quota ${quota}`);
  }
  for (const [action, quota] of Object.entries(LIST_LIFECYCLE_ACTION_MINIMUM_QUOTAS)) {
    if ((summary.actions[action] || 0) < quota) {
      errors.push(`${action}: expected lifecycle minimum ${quota}, saw ${summary.actions[action] || 0}`);
    }
  }
  if (summary.totalActionCount !== LIST_LIFECYCLE_SEQUENCE_COUNT * LIST_LIFECYCLE_ACTION_COUNT
    || summary.actionTraceStepCount !== summary.totalActionCount) {
    errors.push('lifecycle corpus action-trace step count is incomplete');
  }
  if (summary.emptyItemSequenceCount !== 300) errors.push('expected 300 empty-item lifecycle sequences');
  if (summary.parentNestedBoundarySequenceCount !== 300) {
    errors.push('expected 300 parent/nested-boundary sequences');
  }
  if (summary.activeTransitionSequenceCount !== 50) {
    errors.push('expected 50 active/inactive transition sequences');
  }
  if (summary.historyReplaySequenceCount !== 50) {
    errors.push('expected 50 Undo/Redo lifecycle sequences');
  }
  const expectedCatalog = lifecycleMotifCatalog(sequences);
  if (document.motifCatalogSha256 !== digest(expectedCatalog)
    || digest(document.motifCatalog) !== digest(expectedCatalog)) {
    errors.push('persisted lifecycle motif catalog does not match sequences');
  }
  if (document.corpusSha256 !== digest(sequences)) {
    errors.push('lifecycle corpusSha256 does not match sequences');
  }
  if (!document.summary || digest(document.summary) !== digest(summary)) {
    errors.push('persisted lifecycle summary does not match sequences');
  }
  const regenerated = generateListLifecycleRandomSequences({ seed: document.seed });
  if (regenerated.corpusSha256 !== document.corpusSha256) {
    errors.push('lifecycle corpus is not the deterministic product of its persisted seed and motifs');
  }
  return { valid: errors.length === 0, errors, summary };
}

module.exports = Object.freeze({
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
  PHYSICAL_CONTINUATION_FIXTURES,
  RANDOM_ACTION_MINIMUM_QUOTAS,
  RANDOM_CATEGORY_QUOTAS,
  RANDOM_LENGTH_QUOTAS,
  RANDOM_MODE_QUOTAS,
  READING_REQUIRED_OBSERVATIONS,
  actionName,
  caretFixture,
  generateListEditingScenarios,
  generateListLifecycleRandomSequences,
  generateListRandomSequences,
  listItems,
  summarizeListEditingScenarios,
  summarizeListLifecycleRandomSequences,
  summarizeListRandomSequences,
  validateListEditingCorpus,
  validateListLifecycleRandomCorpus,
  validateListRandomCorpus,
  validateListRandomHistory
});
