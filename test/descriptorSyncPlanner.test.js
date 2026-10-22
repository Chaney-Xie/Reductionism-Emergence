const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDescriptorSyncScope,
  compareDescriptorSyncResults,
  evaluateDescriptorSyncIndex,
  expectedAutoSupportHash,
  findStaleIgnoredDescriptors
} = require('../descriptorSyncPlanner');

const classes = ['class_1', 'class_2', 'class_3'];
const linkTypes = {
  linkTypes: [
    { id: 'contains', opposite: 'contained_by' },
    { id: 'contained_by', opposite: 'contains' },
    { id: 'weak_contains', opposite: 'weak_contained_by' },
    { id: 'weak_contained_by', opposite: 'weak_contains' },
    { id: 'horizontal', opposite: 'horizontal' }
  ]
};

const baseRules = {
  rules: [
    { id: 'c1-write', enabled: true, localClassId: 'class_1', mode: 'write', linkTypeId: 'contains', remoteClassId: 'class_1' },
    { id: 'c2-write', enabled: true, localClassId: 'class_2', mode: 'write', linkTypeId: 'contains', remoteClassId: 'class_1' },
    { id: 'weak-write', enabled: true, localClassId: 'class_2', mode: 'write', linkTypeId: 'weak_contains', remoteClassId: 'class_3' },
    { id: 'c3-read', enabled: true, localClassId: 'class_3', mode: 'read', linkTypeId: 'contains', remoteClassId: 'class_2' },
    { id: 'horizontal-write', enabled: true, localClassId: 'class_2', mode: 'write', linkTypeId: 'horizontal', remoteClassId: 'class_3' }
  ]
};

function state({ manual = [], auto = [], ignored = [] } = {}) {
  return { manual, auto, ignored };
}

function page(descriptors = {}, relations = {}) {
  return {
    descriptors: Object.fromEntries(classes.map((classId) => [classId, state(descriptors[classId])])),
    relations
  };
}

function index(pages) {
  return { schemaVersion: 1, pages };
}

function auto(result, pageId, classId) {
  return result.pages[pageId]?.[classId]?.auto || [];
}

test('write propagation treats raw multiplicity as one logical edge', () => {
  const input = index({
    A: page({ class_1: { manual: ['X'] } }, { contains: { B: 5 } }),
    B: page({}, { contained_by: { A: 5 } })
  });
  const result = evaluateDescriptorSyncIndex(input, baseRules, linkTypes);
  assert.deepEqual(auto(result, 'B', 'class_1'), ['X']);
  assert.equal(result.stats.queueProcessedCount, 2);
  assert.equal(result.pages.B.class_1.supports.X.length, 1);
});

test('read, weak-contains, and horizontal rules use generic opposite mapping', () => {
  const input = index({
    A: page({}, {
      contains: { B: 1 },
      weak_contains: { C: 1 },
      horizontal: { D: 1 }
    }),
    B: page({ class_2: { manual: ['READ'] } }, { contained_by: { A: 1 } }),
    C: page({}, { weak_contained_by: { A: 1 } }),
    D: page({}, { horizontal: { A: 1 } }),
    W: page({ class_2: { manual: ['WEAK'] } }, { weak_contains: { C: 1 } }),
    H: page({ class_2: { manual: ['HORIZONTAL'] } }, { horizontal: { D: 1 } })
  });
  const result = evaluateDescriptorSyncIndex(input, baseRules, linkTypes);
  assert.deepEqual(auto(result, 'A', 'class_3'), ['READ']);
  assert.deepEqual(auto(result, 'C', 'class_3'), ['WEAK']);
  assert.deepEqual(auto(result, 'D', 'class_3'), ['HORIZONTAL']);
});

test('queue propagation is transitive and records all independent supports', () => {
  const input = index({
    S1: page({ class_1: { manual: ['X'] } }, { contains: { A: 1 } }),
    S2: page({ class_1: { manual: ['X'] } }, { contains: { A: 1 } }),
    A: page({ class_1: { manual: ['X'], auto: ['X'] } }, {
      contained_by: { S1: 1, S2: 1 },
      contains: { B: 1 }
    }),
    B: page({}, { contained_by: { A: 1 } })
  });
  const result = evaluateDescriptorSyncIndex(input, baseRules, linkTypes);
  assert.deepEqual(auto(result, 'A', 'class_1'), ['X']);
  assert.equal(result.pages.A.class_1.supports.X.length, 2);
  assert.deepEqual(auto(result, 'B', 'class_1'), ['X']);
  assert.equal(new Set(result.autoTupleKeys).size, result.autoTupleKeys.length);
});

test('ignore is class-scoped while the same entry remains active elsewhere', () => {
  const input = index({
    S: page({
      class_1: { manual: ['X'] },
      class_2: { manual: ['X'] },
      class_3: { manual: ['X'] }
    }, { contains: { A: 1 }, contained_by: { A: 1 } }),
    A: page({ class_1: { ignored: ['X'] } }, { contained_by: { S: 1 }, contains: { S: 1 } })
  });
  const result = evaluateDescriptorSyncIndex(input, baseRules, linkTypes);
  assert.deepEqual(auto(result, 'A', 'class_1'), []);
  assert.deepEqual(auto(result, 'A', 'class_3'), ['X']);
});

test('auto-only cycles disappear unless reached from a manual root', () => {
  const cycle = index({
    A: page({ class_1: { auto: ['X'] } }, { contains: { B: 1 }, contained_by: { B: 1 } }),
    B: page({ class_1: { auto: ['X'] } }, { contains: { A: 1 }, contained_by: { A: 1 } })
  });
  const unsupported = evaluateDescriptorSyncIndex(cycle, baseRules, linkTypes);
  assert.deepEqual(unsupported.autoTupleKeys, []);
  assert.deepEqual(compareDescriptorSyncResults(unsupported, cycle).unexpected, [
    'A|class_1|X', 'B|class_1|X'
  ]);

  const supported = structuredClone(cycle);
  supported.pages.S = page({ class_1: { manual: ['X'] } }, { contains: { A: 1 } });
  supported.pages.A.relations.contained_by.S = 1;
  assert.deepEqual(evaluateDescriptorSyncIndex(supported, baseRules, linkTypes).autoTupleKeys, [
    'A|class_1|X', 'B|class_1|X'
  ]);

  delete supported.pages.S;
  delete supported.pages.A.relations.contained_by.S;
  assert.deepEqual(evaluateDescriptorSyncIndex(supported, baseRules, linkTypes).autoTupleKeys, []);
});

test('disabled rules, missing pages, and invalid counts are handled safely', () => {
  const rules = { rules: [{ ...baseRules.rules[0], enabled: false }] };
  const input = index({
    A: page({ class_1: { manual: ['X'] } }, { contains: { B: 0, MISSING: 1 } }),
    B: page({}, { contained_by: { A: 0 } })
  });
  const result = evaluateDescriptorSyncIndex(input, rules, linkTypes);
  assert.deepEqual(result.autoTupleKeys, []);
  assert.ok(result.warnings.some((warning) => warning.includes('missing page')));
  assert.ok(result.warnings.some((warning) => warning.includes('Invalid relation count')));
});

test('stale ignored detection temporarily bypasses only the exact marker', () => {
  const withProvider = index({
    S: page({ class_1: { manual: ['X'] } }, { contains: { A: 1 } }),
    A: page({ class_1: { ignored: ['X'] }, class_2: { ignored: ['X'] } }, { contained_by: { S: 1 } })
  });
  assert.deepEqual(findStaleIgnoredDescriptors(withProvider, baseRules, linkTypes), [
    'A|class_2|X'
  ]);

  const withoutProvider = structuredClone(withProvider);
  withoutProvider.pages.S.descriptors.class_1.manual = [];
  assert.deepEqual(findStaleIgnoredDescriptors(withoutProvider, baseRules, linkTypes), [
    'A|class_1|X', 'A|class_2|X'
  ]);
});

test('manual and ignored contradiction is reported without mutating input', () => {
  const input = index({ A: page({ class_1: { manual: ['X'], ignored: ['X'] } }) });
  const before = JSON.stringify(input);
  const result = evaluateDescriptorSyncIndex(input, baseRules, linkTypes);
  assert.ok(result.warnings.some((warning) => warning.includes('Contradictory')));
  assert.equal(JSON.stringify(input), before);
});

test('scope collection unions split components from both former endpoints', () => {
  const split = index({
    A: page({}, { contains: { B: 1 } }),
    B: page({}, { contained_by: { A: 1 } }),
    C: page({}, { contains: { D: 1 } }),
    D: page({}, { contained_by: { C: 1 } })
  });
  assert.deepEqual(collectDescriptorSyncScope(['A', 'C'], split), ['A', 'B', 'C', 'D']);
  assert.deepEqual(collectDescriptorSyncScope(['A'], split), ['A', 'B']);
});

test('support hash changes when origins change while visible auto ids remain equal', () => {
  const oneSupport = {
    auto: ['X'],
    supports: { X: [{ ruleId: 'r', fromPageId: 'A', fromClassId: 'class_1', linkTypeId: 'contains' }] }
  };
  const twoSupports = {
    auto: ['X'],
    supports: { X: [
      ...oneSupport.supports.X,
      { ruleId: 'r', fromPageId: 'B', fromClassId: 'class_1', linkTypeId: 'contains' }
    ] }
  };
  assert.notEqual(expectedAutoSupportHash(oneSupport), expectedAutoSupportHash(twoSupports));
  assert.equal(expectedAutoSupportHash(twoSupports), expectedAutoSupportHash({
    auto: ['X'], supports: { X: [...twoSupports.supports.X].reverse() }
  }));
});
