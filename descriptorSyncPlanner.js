const { hashAutoSupports } = require('./descriptorSyncIndex');

function tupleKey(pageId, classId, entryId) {
  return `${pageId}|${classId}|${entryId}`;
}

function parseTupleKey(key) {
  const [pageId, classId, ...entryParts] = key.split('|');
  return { pageId, classId, entryId: entryParts.join('|') };
}

function originKey(origin) {
  return `${origin.ruleId}|${origin.fromPageId}|${origin.fromClassId}|${origin.linkTypeId}`;
}

function sortedUnique(items) {
  return [...new Set(items)].sort();
}

function linkTypeOpposites(linkTypes) {
  return new Map((linkTypes?.linkTypes || [])
    .filter((item) => item?.id && item?.opposite)
    .map((item) => [item.id, item.opposite]));
}

function descriptorState(index, pageId, classId) {
  return index?.pages?.[pageId]?.descriptors?.[classId] || null;
}

function isIgnored(index, pageId, classId, entryId, bypassIgnoreKey) {
  const key = tupleKey(pageId, classId, entryId);
  if (key === bypassIgnoreKey) return false;
  return (descriptorState(index, pageId, classId)?.ignored || []).includes(entryId);
}

function validateInputs(index, enabledRules, opposites) {
  const warnings = [];
  for (const [pageId, page] of Object.entries(index?.pages || {})) {
    for (const [classId, state] of Object.entries(page.descriptors || {})) {
      if (!state || !['manual', 'auto', 'ignored'].every((key) => Array.isArray(state[key]))) {
        warnings.push(`Invalid descriptor state shape: ${pageId}/${classId}.`);
        continue;
      }
      for (const entryId of state.manual) {
        if (state.ignored.includes(entryId)) {
          warnings.push(`Contradictory manual and ignored descriptor: ${tupleKey(pageId, classId, entryId)}.`);
        }
      }
    }
    for (const [linkTypeId, counterparts] of Object.entries(page.relations || {})) {
      if (!opposites.has(linkTypeId)) warnings.push(`Invalid relation link type: ${pageId}/${linkTypeId}.`);
      for (const [counterpartPageId, count] of Object.entries(counterparts || {})) {
        if (!index.pages?.[counterpartPageId]) {
          warnings.push(`Relation points to missing page: ${pageId}/${linkTypeId}/${counterpartPageId}.`);
        }
        if (!Number.isInteger(count) || count <= 0) {
          warnings.push(`Invalid relation count: ${pageId}/${linkTypeId}/${counterpartPageId}=${count}.`);
        }
      }
    }
  }
  for (const rule of enabledRules) {
    if (!opposites.has(rule.linkTypeId)) warnings.push(`Rule ${rule.id} uses invalid link type ${rule.linkTypeId}.`);
  }
  return warnings;
}

function collectDescriptorSyncScope(startPageIds, index, { fullProject = false } = {}) {
  const validPages = index?.pages || {};
  if (fullProject) return Object.keys(validPages).sort();
  const queue = [...new Set(startPageIds || [])].filter((pageId) => validPages[pageId]);
  const visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pageId = queue[cursor];
    if (visited.has(pageId)) continue;
    visited.add(pageId);
    for (const counterparts of Object.values(validPages[pageId]?.relations || {})) {
      for (const [counterpartPageId, count] of Object.entries(counterparts || {})) {
        if (Number.isInteger(count) && count > 0 && validPages[counterpartPageId]
          && !visited.has(counterpartPageId)) queue.push(counterpartPageId);
      }
    }
  }
  return [...visited].sort();
}

function evaluateCore(index, rules, linkTypes, { bypassIgnoreKey = null, scopePageIds = null } = {}) {
  const startedAt = Date.now();
  const opposites = linkTypeOpposites(linkTypes);
  const enabledRules = (rules?.rules || rules || []).filter((rule) => rule?.enabled !== false);
  const rulesBySourceClass = new Map();
  for (const rule of enabledRules) {
    const sourceClassId = rule.mode === 'read' ? rule.remoteClassId : rule.localClassId;
    if (!rulesBySourceClass.has(sourceClassId)) rulesBySourceClass.set(sourceClassId, []);
    rulesBySourceClass.get(sourceClassId).push(rule);
  }

  const warnings = validateInputs(index, enabledRules, opposites);
  const scope = new Set(scopePageIds || Object.keys(index?.pages || {}));
  const active = new Set();
  const queue = [];
  const expectedAuto = new Set();
  const supports = new Map();
  let manualSeedCount = 0;
  let queueProcessedCount = 0;
  let ruleEvaluationCount = 0;
  let logicalEdgeVisitCount = 0;
  let supportOriginCount = 0;

  for (const [pageId, page] of Object.entries(index?.pages || {})) {
    if (!scope.has(pageId)) continue;
    for (const [classId, state] of Object.entries(page.descriptors || {})) {
      for (const entryId of sortedUnique(Array.isArray(state?.manual) ? state.manual : [])) {
        const key = tupleKey(pageId, classId, entryId);
        if (active.has(key)) continue;
        active.add(key);
        queue.push({ pageId, classId, entryId });
        manualSeedCount += 1;
      }
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    queueProcessedCount += 1;
    for (const rule of rulesBySourceClass.get(source.classId) || []) {
      ruleEvaluationCount += 1;
      if (!['write', 'read'].includes(rule.mode)) continue;
      const relationTypeId = rule.mode === 'write'
        ? rule.linkTypeId
        : opposites.get(rule.linkTypeId);
      if (!relationTypeId) continue;
      const targetClassId = rule.mode === 'write' ? rule.remoteClassId : rule.localClassId;
      const counterparts = index.pages?.[source.pageId]?.relations?.[relationTypeId] || {};
      for (const [targetPageId, count] of Object.entries(counterparts)) {
        if (!Number.isInteger(count) || count <= 0 || !index.pages?.[targetPageId]) continue;
        if (!scope.has(targetPageId)) {
          warnings.push(`Relation leaves descriptor sync scope: ${source.pageId}/${relationTypeId}/${targetPageId}.`);
          continue;
        }
        logicalEdgeVisitCount += 1;
        if (isIgnored(index, targetPageId, targetClassId, source.entryId, bypassIgnoreKey)) continue;
        const targetKey = tupleKey(targetPageId, targetClassId, source.entryId);
        const origin = {
          ruleId: rule.id,
          fromPageId: source.pageId,
          fromClassId: source.classId,
          linkTypeId: rule.linkTypeId
        };
        if (!supports.has(targetKey)) supports.set(targetKey, new Map());
        const targetSupports = supports.get(targetKey);
        const supportKey = originKey(origin);
        if (!targetSupports.has(supportKey)) {
          targetSupports.set(supportKey, origin);
          supportOriginCount += 1;
        }
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
    pages[pageId][classId].supports[entryId] = [...(supports.get(key)?.values() || [])]
      .sort((a, b) => originKey(a).localeCompare(originKey(b)));
  }
  for (const page of Object.values(pages)) {
    for (const state of Object.values(page)) state.auto.sort();
  }

  return {
    pages,
    autoTupleKeys: [...expectedAuto].sort(),
    stats: {
      indexPageCount: Object.keys(index?.pages || {}).length,
      scopePageCount: scope.size,
      manualSeedCount,
      derivedTupleCount: expectedAuto.size,
      queueProcessedCount,
      ruleEvaluationCount,
      logicalEdgeVisitCount,
      supportOriginCount,
      enabledRuleCount: enabledRules.length,
      elapsedMilliseconds: Date.now() - startedAt
    },
    warnings
  };
}

function evaluateDescriptorSyncIndex(index, rules, linkTypes, options = {}) {
  return evaluateCore(index, rules, linkTypes, options);
}

function expectedAutoSupportHash(classState) {
  const records = [];
  for (const entryId of classState?.auto || []) {
    for (const origin of classState?.supports?.[entryId] || []) {
      records.push([
        entryId,
        origin.ruleId,
        origin.fromPageId,
        origin.fromClassId,
        origin.linkTypeId
      ].join('|'));
    }
  }
  return hashAutoSupports(records);
}

function actualAutoTupleKeys(index) {
  const keys = [];
  for (const [pageId, page] of Object.entries(index?.pages || {})) {
    for (const [classId, state] of Object.entries(page.descriptors || {})) {
      for (const entryId of sortedUnique(Array.isArray(state?.auto) ? state.auto : [])) {
        keys.push(tupleKey(pageId, classId, entryId));
      }
    }
  }
  return keys.sort();
}

function compareDescriptorSyncResults(expected, actualIndex) {
  const expectedSet = new Set(expected?.autoTupleKeys || []);
  const actualSet = new Set(actualAutoTupleKeys(actualIndex));
  const missing = [...expectedSet].filter((key) => !actualSet.has(key)).sort();
  const unexpected = [...actualSet].filter((key) => !expectedSet.has(key)).sort();
  return {
    matches: !missing.length && !unexpected.length,
    missing,
    unexpected,
    differencePageIds: sortedUnique([...missing, ...unexpected].map((key) => parseTupleKey(key).pageId))
  };
}

function findStaleIgnoredDescriptors(index, rules, linkTypes) {
  const stale = [];
  for (const [pageId, page] of Object.entries(index?.pages || {})) {
    for (const [classId, state] of Object.entries(page.descriptors || {})) {
      for (const entryId of sortedUnique(Array.isArray(state?.ignored) ? state.ignored : [])) {
        const key = tupleKey(pageId, classId, entryId);
        const withoutThisIgnore = evaluateCore(index, rules, linkTypes, { bypassIgnoreKey: key });
        if (!withoutThisIgnore.autoTupleKeys.includes(key)) stale.push(key);
      }
    }
  }
  return stale.sort();
}

function validateQueueEvaluator(index, rules, linkTypes) {
  const expected = evaluateDescriptorSyncIndex(index, rules, linkTypes);
  const comparison = compareDescriptorSyncResults(expected, index);
  return {
    expected,
    comparison,
    staleIgnoredCandidates: findStaleIgnoredDescriptors(index, rules, linkTypes)
  };
}

module.exports = {
  collectDescriptorSyncScope,
  compareDescriptorSyncResults,
  evaluateDescriptorSyncIndex,
  expectedAutoSupportHash,
  findStaleIgnoredDescriptors,
  validateQueueEvaluator
};
