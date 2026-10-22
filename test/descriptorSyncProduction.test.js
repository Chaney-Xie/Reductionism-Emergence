const test = require('node:test');
const assert = require('node:assert/strict');

const { hashAutoSupports } = require('../descriptorSyncIndex');
const {
  evaluateDescriptorSyncIndex,
  expectedAutoSupportHash
} = require('../descriptorSyncPlanner');

function tupleKey(pageId, classId, entryId) {
  return `${pageId}|${classId}|${entryId}`;
}

function parseTupleKey(key) {
  const [pageId, classId, ...entryId] = key.split('|');
  return { pageId, classId, entryId: entryId.join('|') };
}

function originKey(origin) {
  return `${origin.ruleId}|${origin.fromPageId}|${origin.fromClassId}|${origin.linkTypeId}`;
}

// Frozen test-only reference for the accepted pre-coordinator propagation
// semantics. This intentionally owns no files, queues, cache, or production
// export; it exists only to guard retirement of the former production writer.
function evaluateRetiredSemantics(index, rules, linkTypes) {
  const opposites = new Map((linkTypes.linkTypes || []).map((item) => [item.id, item.opposite]));
  const enabledRules = (rules.rules || []).filter((rule) => rule.enabled !== false);
  const rulesBySourceClass = new Map();
  for (const rule of enabledRules) {
    const sourceClassId = rule.mode === 'read' ? rule.remoteClassId : rule.localClassId;
    const classRules = rulesBySourceClass.get(sourceClassId) || [];
    classRules.push(rule);
    rulesBySourceClass.set(sourceClassId, classRules);
  }

  const active = new Set();
  const queue = [];
  const expectedAuto = new Set();
  const supports = new Map();
  for (const [pageId, page] of Object.entries(index.pages || {})) {
    for (const [classId, state] of Object.entries(page.descriptors || {})) {
      for (const entryId of [...new Set(state.manual || [])].sort()) {
        const key = tupleKey(pageId, classId, entryId);
        if (active.has(key)) continue;
        active.add(key);
        queue.push({ pageId, classId, entryId });
      }
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    for (const rule of rulesBySourceClass.get(source.classId) || []) {
      const relationTypeId = rule.mode === 'write'
        ? rule.linkTypeId
        : opposites.get(rule.linkTypeId);
      const targetClassId = rule.mode === 'write' ? rule.remoteClassId : rule.localClassId;
      if (!relationTypeId || !targetClassId) continue;
      const counterparts = index.pages[source.pageId]?.relations?.[relationTypeId] || {};
      for (const [targetPageId, count] of Object.entries(counterparts)) {
        if (!Number.isInteger(count) || count <= 0 || !index.pages[targetPageId]) continue;
        const ignored = index.pages[targetPageId]?.descriptors?.[targetClassId]?.ignored || [];
        if (ignored.includes(source.entryId)) continue;
        const targetKey = tupleKey(targetPageId, targetClassId, source.entryId);
        const origin = {
          ruleId: rule.id,
          fromPageId: source.pageId,
          fromClassId: source.classId,
          linkTypeId: rule.linkTypeId
        };
        const targetSupports = supports.get(targetKey) || new Map();
        targetSupports.set(originKey(origin), origin);
        supports.set(targetKey, targetSupports);
        expectedAuto.add(targetKey);
        if (!active.has(targetKey)) {
          active.add(targetKey);
          queue.push({ pageId: targetPageId, classId: targetClassId, entryId: source.entryId });
        }
      }
    }
  }

  const pages = {};
  for (const key of [...expectedAuto].sort()) {
    const { pageId, classId, entryId } = parseTupleKey(key);
    pages[pageId] ||= {};
    pages[pageId][classId] ||= { auto: [], supports: {} };
    pages[pageId][classId].auto.push(entryId);
    pages[pageId][classId].supports[entryId] = [...supports.get(key).values()]
      .sort((left, right) => originKey(left).localeCompare(originKey(right)));
  }
  for (const page of Object.values(pages)) {
    for (const state of Object.values(page)) state.auto.sort();
  }
  return { pages, autoTupleKeys: [...expectedAuto].sort() };
}

function descriptorState({ manual = [], auto = [], ignored = [] } = {}) {
  return { manual, auto, ignored, autoSupportHash: hashAutoSupports([]) };
}

function page({ alpha = {}, beta = {}, relations = {} } = {}) {
  return {
    descriptors: {
      alpha: descriptorState(alpha),
      beta: descriptorState(beta)
    },
    relations
  };
}

test('only the canonical Descriptor metadata coordinator remains a production writer', () => {
  const server = require('../server');
  assert.equal(typeof server.createVaultServerContext, 'function');
  assert.equal(typeof server.startServer, 'function');
  assert.equal(server.runDescriptorSync, undefined);
  assert.equal(server.runQueueDescriptorSync, undefined);
  assert.equal(server.runLegacyDescriptorSync, undefined);
});

test('test-only retired evaluator matches the canonical planner corpus', () => {
  const linkTypes = {
    linkTypes: [
      { id: 'contains', opposite: 'contained_by' },
      { id: 'contained_by', opposite: 'contains' },
      { id: 'references', opposite: 'referenced_by' },
      { id: 'referenced_by', opposite: 'references' }
    ]
  };
  const rules = {
    rules: [
      {
        id: 'alpha-write-contains',
        enabled: true,
        localClassId: 'alpha',
        mode: 'write',
        linkTypeId: 'contains',
        remoteClassId: 'alpha'
      },
      {
        id: 'beta-read-references',
        enabled: true,
        localClassId: 'alpha',
        mode: 'read',
        linkTypeId: 'references',
        remoteClassId: 'beta'
      }
    ]
  };
  const index = {
    schemaVersion: 1,
    pages: {
      A: page({
        alpha: { manual: ['X', 'Y'] },
        relations: { contains: { B: 2, C: 1 }, references: { E: 1 } }
      }),
      B: page({
        alpha: { manual: ['X'], auto: ['Q'] },
        relations: { contained_by: { A: 2, D: 1 }, contains: { D: 1 } }
      }),
      C: page({
        alpha: { ignored: ['Y'] },
        relations: { contained_by: { A: 1 }, contains: { D: 1 } }
      }),
      D: page({
        alpha: { auto: ['Q'] },
        relations: { contained_by: { B: 1, C: 1 }, contains: { B: 1 } }
      }),
      E: page({
        beta: { manual: ['Z'] },
        relations: { referenced_by: { A: 1 } }
      })
    }
  };

  const retired = evaluateRetiredSemantics(index, rules, linkTypes);
  const canonical = evaluateDescriptorSyncIndex(index, rules, linkTypes);
  assert.deepEqual(canonical.autoTupleKeys, retired.autoTupleKeys);
  assert.deepEqual(canonical.pages, retired.pages);

  // Write/read, transitive propagation, and manual+auto coexistence.
  assert.ok(canonical.autoTupleKeys.includes('B|alpha|X'));
  assert.ok(canonical.autoTupleKeys.includes('D|alpha|Z'));
  assert.deepEqual(canonical.pages.A.alpha.supports.Z, [{
    ruleId: 'beta-read-references',
    fromPageId: 'E',
    fromClassId: 'beta',
    linkTypeId: 'references'
  }]);

  // Multiplicity produces one logical origin; independent paths produce two.
  assert.equal(canonical.pages.C.alpha.supports.X.length, 1);
  assert.deepEqual(canonical.pages.D.alpha.supports.X.map(originKey), [
    'alpha-write-contains|B|alpha|contains',
    'alpha-write-contains|C|alpha|contains'
  ]);

  // Ignore is tuple/class scoped, and auto-only cycles are not propagation seeds.
  assert.equal(canonical.autoTupleKeys.includes('C|alpha|Y'), false);
  assert.ok(canonical.autoTupleKeys.includes('D|alpha|Y'));
  assert.equal(canonical.autoTupleKeys.some((key) => key.endsWith('|Q')), false);

  const supportRecords = Object.entries(canonical.pages.D.alpha.supports)
    .flatMap(([entryId, origins]) => origins.map((origin) => `${entryId}|${originKey(origin)}`));
  assert.equal(
    expectedAutoSupportHash(canonical.pages.D.alpha),
    hashAutoSupports(supportRecords)
  );

  // Removing one relation support retains the independently derived tuple.
  const oneSupportIndex = structuredClone(index);
  delete oneSupportIndex.pages.C.relations.contains.D;
  delete oneSupportIndex.pages.D.relations.contained_by.C;
  const oneSupportRetired = evaluateRetiredSemantics(oneSupportIndex, rules, linkTypes);
  const oneSupportCanonical = evaluateDescriptorSyncIndex(oneSupportIndex, rules, linkTypes);
  assert.deepEqual(oneSupportCanonical.pages, oneSupportRetired.pages);
  assert.deepEqual(oneSupportCanonical.pages.D.alpha.supports.X.map(originKey), [
    'alpha-write-contains|B|alpha|contains'
  ]);
  assert.notEqual(
    expectedAutoSupportHash(oneSupportCanonical.pages.D.alpha),
    expectedAutoSupportHash(canonical.pages.D.alpha)
  );

  // A second independent support still cannot bypass a tuple-scoped ignore.
  const ignoredWithNewSupport = structuredClone(index);
  ignoredWithNewSupport.pages.F = page({
    alpha: { manual: ['Y'] },
    relations: { contains: { C: 1 } }
  });
  ignoredWithNewSupport.pages.C.relations.contained_by.F = 1;
  const ignoredRetired = evaluateRetiredSemantics(ignoredWithNewSupport, rules, linkTypes);
  const ignoredCanonical = evaluateDescriptorSyncIndex(ignoredWithNewSupport, rules, linkTypes);
  assert.deepEqual(ignoredCanonical.pages, ignoredRetired.pages);
  assert.equal(ignoredCanonical.autoTupleKeys.includes('C|alpha|Y'), false);

  // Remembered-manual provenance is canonical Page state, not a planner seed.
  const rememberedManualIndex = structuredClone(index);
  rememberedManualIndex.pages.C.descriptors.alpha.rememberedManual = ['Y'];
  assert.deepEqual(
    evaluateDescriptorSyncIndex(rememberedManualIndex, rules, linkTypes).pages,
    canonical.pages
  );

  // A deleted Page and its incident relations disappear without changing the
  // remaining independent support semantics.
  const pageDeletedIndex = structuredClone(index);
  delete pageDeletedIndex.pages.C;
  delete pageDeletedIndex.pages.A.relations.contains.C;
  delete pageDeletedIndex.pages.D.relations.contained_by.C;
  const pageDeletedRetired = evaluateRetiredSemantics(pageDeletedIndex, rules, linkTypes);
  const pageDeletedCanonical = evaluateDescriptorSyncIndex(pageDeletedIndex, rules, linkTypes);
  assert.deepEqual(pageDeletedCanonical.pages, pageDeletedRetired.pages);
  assert.equal(pageDeletedCanonical.autoTupleKeys.some((key) => key.startsWith('C|')), false);
  assert.deepEqual(pageDeletedCanonical.pages.D.alpha.supports.X.map(originKey), [
    'alpha-write-contains|B|alpha|contains'
  ]);

  // Descriptor definition/Vocabulary remap parity is ID-stable: once the
  // canonical mutation maps X to X2, both evaluators propagate only X2.
  const remappedIndex = structuredClone(index);
  for (const entry of Object.values(remappedIndex.pages)) {
    for (const state of Object.values(entry.descriptors)) {
      for (const key of ['manual', 'auto', 'ignored']) {
        state[key] = state[key].map((entryId) => entryId === 'X' ? 'X2' : entryId);
      }
    }
  }
  const remappedRetired = evaluateRetiredSemantics(remappedIndex, rules, linkTypes);
  const remappedCanonical = evaluateDescriptorSyncIndex(remappedIndex, rules, linkTypes);
  assert.deepEqual(remappedCanonical.pages, remappedRetired.pages);
  assert.ok(remappedCanonical.autoTupleKeys.includes('D|alpha|X2'));
  assert.equal(remappedCanonical.autoTupleKeys.some((key) => key.endsWith('|X')), false);

  // Definition deletion parity is represented after canonical cleanup: the
  // removed ID is absent from every seed/ignore and cannot reappear.
  const definitionDeletedIndex = structuredClone(index);
  for (const entry of Object.values(definitionDeletedIndex.pages)) {
    for (const state of Object.values(entry.descriptors)) {
      for (const key of ['manual', 'auto', 'ignored']) {
        state[key] = state[key].filter((entryId) => entryId !== 'Y');
      }
    }
  }
  const definitionDeletedRetired = evaluateRetiredSemantics(
    definitionDeletedIndex,
    rules,
    linkTypes
  );
  const definitionDeletedCanonical = evaluateDescriptorSyncIndex(
    definitionDeletedIndex,
    rules,
    linkTypes
  );
  assert.deepEqual(definitionDeletedCanonical.pages, definitionDeletedRetired.pages);
  assert.equal(definitionDeletedCanonical.autoTupleKeys.some((key) => key.endsWith('|Y')), false);
});
