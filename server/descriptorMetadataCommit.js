const {
  rebuildDescriptorSyncIndex
} = require('../descriptorSyncIndex');
const {
  evaluateDescriptorSyncIndex
} = require('../descriptorSyncPlanner');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedMetadataRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function nextMetadataRevision(...resources) {
  const current = Math.max(0, ...resources.map((resource) => (
    normalizedMetadataRevision(resource?.metadataRevision)
  )));
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Descriptor metadata revision space is exhausted.');
  }
  return current + 1;
}

function metadataRevisionStatus(...resources) {
  const revisions = resources.map((resource) => (
    Number.isSafeInteger(resource?.metadataRevision) && resource.metadataRevision >= 0
      ? resource.metadataRevision
      : null
  ));
  const present = revisions.filter((revision) => revision !== null);
  return {
    coherent: present.length === resources.length && new Set(present).size === 1,
    metadataRevision: present.length && new Set(present).size === 1 ? present[0] : null,
    revisions
  };
}

function descriptorOriginKey(origin) {
  return `${origin.ruleId}|${origin.fromPageId}|${origin.fromClassId}|${origin.linkTypeId}`;
}

function descriptorRefSortKey(ref) {
  return `${ref.entryId}|${ref.source === 'auto' ? 'auto' : 'manual'}`;
}

function canonicalDescriptorGroups(descriptors, descriptorLibrary, model) {
  const normalized = model.normalizePageDescriptorGroups(descriptors, descriptorLibrary);
  const result = {};
  for (const descriptorClass of model.descriptorClasses(descriptorLibrary)) {
    result[descriptorClass.id] = (normalized[descriptorClass.id] || []).map((ref) => {
      const item = {
        entryId: ref.entryId,
        source: ref.source,
        status: ref.status || 'active',
        createdAt: ref.createdAt || null
      };
      if (ref.source === 'auto') {
        item.origins = model.normalizeDescriptorOrigins(ref.origins)
          .sort((left, right) => descriptorOriginKey(left).localeCompare(descriptorOriginKey(right)));
      }
      return item;
    }).sort((left, right) => descriptorRefSortKey(left).localeCompare(descriptorRefSortKey(right)));
  }
  return result;
}

function buildPageMetadataProjection({
  pageRecords,
  descriptorLibrary,
  model,
  metadataRevision
}) {
  return {
    metadataRevision,
    pages: [...pageRecords]
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([pageId, record]) => ({
        id: pageId,
        descriptors: model.normalizePageDescriptorGroups(
          record.page.descriptors,
          descriptorLibrary
        ),
        ignoredDescriptors: model.normalizeIgnoredDescriptors(
          record.page.ignoredDescriptors,
          descriptorLibrary
        ),
        ignoredManualEntryIds: model.normalizeIgnoredManualEntryIds(
          record.page.ignoredManualEntryIds,
          record.page.ignoredDescriptors,
          descriptorLibrary
        ),
        updatedAt: typeof record.page.updatedAt === 'string' ? record.page.updatedAt : null
      }))
  };
}

function descriptorUsageFromPages(pageRecords, descriptorLibrary, model) {
  const usedDescriptorIds = new Set();
  for (const { page } of pageRecords.values()) {
    const active = model.normalizePageDescriptorGroups(page.descriptors, descriptorLibrary);
    const ignored = model.normalizeIgnoredDescriptors(page.ignoredDescriptors, descriptorLibrary);
    const rememberedManual = model.normalizeIgnoredManualEntryIds(
      page.ignoredManualEntryIds,
      page.ignoredDescriptors,
      descriptorLibrary
    );
    for (const refs of Object.values(active)) {
      for (const ref of refs) usedDescriptorIds.add(ref.entryId);
    }
    for (const refs of Object.values(ignored)) {
      for (const ref of refs) usedDescriptorIds.add(ref.entryId);
    }
    for (const entryIds of Object.values(rememberedManual)) {
      for (const entryId of entryIds) usedDescriptorIds.add(entryId);
    }
  }
  return usedDescriptorIds;
}

function reconcileDescriptorRegistry({
  descriptorLibrary,
  vocabularyLibrary,
  usedDescriptorIds,
  getOrCreateVocabularyEntry,
  now
}) {
  const descriptorRegistry = cloneJson(descriptorLibrary);
  const vocabulary = cloneJson(vocabularyLibrary);
  const registryIds = new Set((descriptorRegistry.entries || []).map((entry) => entry.id));
  const missingDescriptorIds = [...usedDescriptorIds]
    .filter((entryId) => !registryIds.has(entryId))
    .sort();
  if (missingDescriptorIds.length) {
    throw new Error(
      `Canonical Pages reference Descriptor IDs missing from the registry: ${missingDescriptorIds.join(', ')}.`
    );
  }
  const vocabularyById = new Map((vocabulary.entries || []).map((entry) => [entry.id, entry]));
  const entries = [];

  for (const entry of descriptorRegistry.entries || []) {
    if (!usedDescriptorIds.has(entry.id)) continue;
    let vocabularyEntry = entry.vocabularyEntryId
      ? vocabularyById.get(entry.vocabularyEntryId)
      : null;
    if (!vocabularyEntry) {
      vocabularyEntry = getOrCreateVocabularyEntry(vocabulary, entry.display, now);
      if (vocabularyEntry) vocabularyById.set(vocabularyEntry.id, vocabularyEntry);
    }
    if (!vocabularyEntry) continue;
    entries.push({
      ...entry,
      display: vocabularyEntry.display,
      vocabularyEntryId: vocabularyEntry.id,
      groupId: vocabularyEntry.groupId || entry.groupId || 'ungrouped'
    });
  }
  descriptorRegistry.entries = entries;
  return { descriptorRegistry, vocabulary };
}

async function buildSyncProjection(pageRecords, linkTypes, classIds, metadataRevision = null) {
  const pageIds = [...pageRecords.keys()].sort();
  const { index, stats } = await rebuildDescriptorSyncIndex({
    pageIndex: { pages: pageIds.map((id) => ({ id })) },
    readPage: async (entry) => pageRecords.get(entry.id)?.page || null,
    linkTypes,
    classIds
  });
  if (metadataRevision !== null) index.metadataRevision = metadataRevision;
  return { index, stats };
}

async function materializeAutomaticDescriptors({
  pageRecords,
  descriptorLibrary,
  descriptorSyncRules,
  linkTypes,
  model,
  now
}) {
  const classIds = model.descriptorClasses(descriptorLibrary).map((descriptorClass) => descriptorClass.id);
  const canonicalInput = await buildSyncProjection(pageRecords, linkTypes, classIds);
  const expected = evaluateDescriptorSyncIndex(
    canonicalInput.index,
    descriptorSyncRules,
    linkTypes,
    { scopePageIds: [...pageRecords.keys()].sort() }
  );
  const changedPageIds = [];

  for (const [pageId, record] of pageRecords) {
    const page = record.page;
    const orderedPrevious = model.normalizePageDescriptorGroups(
      page.descriptors,
      descriptorLibrary
    );
    const previous = canonicalDescriptorGroups(page.descriptors, descriptorLibrary, model);
    const next = model.emptyPageDescriptorGroups(descriptorLibrary);
    const previousAutoCreatedAt = new Map();

    for (const [classId, refs] of Object.entries(orderedPrevious)) {
      for (const ref of refs) {
        if (ref.source === 'auto') {
          previousAutoCreatedAt.set(`${classId}|${ref.entryId}`, ref.createdAt);
        } else {
          next[classId].push({ ...ref, source: 'manual' });
        }
      }
    }

    for (const classId of classIds) {
      const expectedClass = expected.pages?.[pageId]?.[classId] || { auto: [], supports: {} };
      for (const entryId of [...new Set(expectedClass.auto || [])].sort()) {
        next[classId].push({
          entryId,
          source: 'auto',
          status: 'active',
          origins: model.normalizeDescriptorOrigins(expectedClass.supports?.[entryId] || [])
            .sort((left, right) => descriptorOriginKey(left).localeCompare(descriptorOriginKey(right))),
          createdAt: previousAutoCreatedAt.get(`${classId}|${entryId}`) || now
        });
      }
    }

    const nextDescriptors = model.normalizePageDescriptorGroups(next, descriptorLibrary);
    if (JSON.stringify(previous) !== JSON.stringify(
      canonicalDescriptorGroups(nextDescriptors, descriptorLibrary, model)
    )) {
      page.descriptors = nextDescriptors;
      page.updatedAt = now;
      changedPageIds.push(pageId);
    }
  }

  return {
    changedPageIds,
    plannerStats: expected.stats,
    plannerWarnings: expected.warnings,
    inputStats: canonicalInput.stats
  };
}

function canonicalPageIndexEntry(record, existingEntry, descriptorLibrary, model, now) {
  const page = record.page;
  const entry = existingEntry
    ? { ...existingEntry }
    : {
      id: page.id,
      type: page.type,
      title: page.title,
      code: Object.hasOwn(page, 'code') ? page.code : null,
      path: record.relativePath,
      categoryIds: Array.isArray(page.categoryIds)
        ? [...page.categoryIds]
        : Array.isArray(page.categories)
          ? page.categories.map((category) => (
            typeof category === 'string' ? category : category?.id
          )).filter((categoryId) => typeof categoryId === 'string')
          : [],
      thumbnail: page.thumbnail || null,
      createdAt: page.createdAt || now,
      updatedAt: page.updatedAt || now
    };
  entry.id = page.id;
  if (typeof record.relativePath === 'string') entry.path = record.relativePath;
  if (typeof page.updatedAt === 'string') entry.updatedAt = page.updatedAt;
  entry.descriptors = model.pageIndexDescriptorGroups(page.descriptors, descriptorLibrary);
  // Compatibility projection. `descriptors` is the nominated class-aware
  // owner; this flat alias remains until all read consumers migrate.
  entry.descriptorIds = model.flattenedDescriptorIds(page.descriptors, descriptorLibrary);
  return entry;
}

function updatePageIndexDescriptorProjection(pageIndex, pageRecords, descriptorLibrary, model, now) {
  const existingEntries = Array.isArray(pageIndex.pages) ? pageIndex.pages : [];
  const entriesById = new Map();
  for (const entry of existingEntries) {
    if (typeof entry?.id === 'string' && !entriesById.has(entry.id)) {
      entriesById.set(entry.id, entry);
    }
  }
  const canonicalPageIds = new Set(pageRecords.keys());
  const changedPageIds = [];
  const nextEntries = [];

  for (const entry of existingEntries) {
    if (typeof entry?.id !== 'string' || !canonicalPageIds.has(entry.id)) {
      if (typeof entry?.id === 'string') changedPageIds.push(entry.id);
      continue;
    }
    if (nextEntries.some((candidate) => candidate.id === entry.id)) {
      changedPageIds.push(entry.id);
      continue;
    }
    const record = pageRecords.get(entry.id);
    const nextEntry = canonicalPageIndexEntry(
      record,
      entriesById.get(entry.id),
      descriptorLibrary,
      model,
      now
    );
    if (JSON.stringify(entry) !== JSON.stringify(nextEntry)) changedPageIds.push(entry.id);
    nextEntries.push(nextEntry);
  }

  for (const [pageId, record] of [...pageRecords].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    if (entriesById.has(pageId)) continue;
    nextEntries.push(canonicalPageIndexEntry(
      record,
      null,
      descriptorLibrary,
      model,
      now
    ));
    changedPageIds.push(pageId);
  }

  pageIndex.pages = nextEntries;
  return [...new Set(changedPageIds)].sort();
}

function changedDomainsForCommit(input, automaticPageIds, projectionPageIds, registryChanged, vocabularyChanged) {
  const domains = new Set(input || []);
  domains.add('pageIndex');
  domains.add('descriptorRegistry');
  domains.add('descriptorSyncIndex');
  if (automaticPageIds.length) domains.add('pages');
  if (vocabularyChanged) domains.add('vocabulary');
  return [...domains].sort();
}

function createDescriptorMetadataCommit({
  model,
  getOrCreateVocabularyEntry,
  writePage,
  writePageIndex,
  writeDescriptorSyncIndex,
  writeDescriptorLibrary,
  writeVocabularyLibrary,
  withTransaction = async (callback) => callback()
}) {
  if (!model || typeof model.normalizePageDescriptorGroups !== 'function') {
    throw new TypeError('Descriptor metadata commit requires Descriptor model helpers.');
  }

  return async function executeDescriptorMetadataCommit({
    pageRecords,
    pageIndex,
    previousSyncIndex = null,
    descriptorLibrary,
    vocabularyLibrary,
    descriptorGroups = null,
    descriptorSyncRules,
    linkTypes,
    directChangedPageIds = [],
    changedDomains = [],
    includeVocabulary = false,
    includeDescriptorGroups = false,
    materializeAutomatic = true,
    now = new Date().toISOString()
  }) {
    return withTransaction(async () => {
      const workingPages = new Map([...pageRecords].map(([pageId, record]) => [pageId, {
        ...record,
        page: cloneJson(record.page)
      }]));
      const workingPageIndex = cloneJson(pageIndex);
      const workingDescriptorLibrary = cloneJson(descriptorLibrary);
      const workingVocabularyLibrary = cloneJson(vocabularyLibrary);
      const automatic = materializeAutomatic
      ? await materializeAutomaticDescriptors({
        pageRecords: workingPages,
        descriptorLibrary: workingDescriptorLibrary,
        descriptorSyncRules,
        linkTypes,
        model,
        now
      })
      : { changedPageIds: [], plannerStats: null, plannerWarnings: [], inputStats: null };
      const projectionPageIds = updatePageIndexDescriptorProjection(
        workingPageIndex,
        workingPages,
        workingDescriptorLibrary,
        model,
        now
      );
      const usedDescriptorIds = descriptorUsageFromPages(
        workingPages,
        workingDescriptorLibrary,
        model
      );
      const reconciled = reconcileDescriptorRegistry({
        descriptorLibrary: workingDescriptorLibrary,
        vocabularyLibrary: workingVocabularyLibrary,
        usedDescriptorIds,
        getOrCreateVocabularyEntry,
        now
      });
      const registryChanged = JSON.stringify(reconciled.descriptorRegistry)
        !== JSON.stringify(descriptorLibrary);
      const vocabularyChanged = JSON.stringify(reconciled.vocabulary)
        !== JSON.stringify(vocabularyLibrary);
      const metadataRevision = nextMetadataRevision(
        pageIndex,
        previousSyncIndex,
        descriptorLibrary
      );
      workingPageIndex.metadataRevision = metadataRevision;
      reconciled.descriptorRegistry.metadataRevision = metadataRevision;
      const classIds = model.descriptorClasses(reconciled.descriptorRegistry)
        .map((descriptorClass) => descriptorClass.id);
      const syncProjection = await buildSyncProjection(
        workingPages,
        linkTypes,
        classIds,
        metadataRevision
      );
      const pageMetadataProjection = buildPageMetadataProjection({
        pageRecords: workingPages,
        descriptorLibrary: reconciled.descriptorRegistry,
        model,
        metadataRevision
      });
      const changedPageIds = [...new Set([
        ...directChangedPageIds,
        ...automatic.changedPageIds,
        ...projectionPageIds
      ])].sort();
      const deletedPageIds = [...new Set([
        ...directChangedPageIds,
        ...projectionPageIds
      ])]
        .filter((pageId) => !workingPages.has(pageId))
        .sort();

      for (const pageId of automatic.changedPageIds) {
        const record = workingPages.get(pageId);
        await writePage(record.filePath, record.page);
      }
      await writePageIndex(workingPageIndex);
      if (vocabularyChanged) await writeVocabularyLibrary(reconciled.vocabulary);
      await writeDescriptorLibrary(reconciled.descriptorRegistry);
      await writeDescriptorSyncIndex(syncProjection.index);

      const responsePages = changedPageIds
        .filter((pageId) => workingPages.has(pageId))
        .map((pageId) => cloneJson(workingPages.get(pageId).page));
      const commitDomains = changedDomainsForCommit(
        changedDomains,
        automatic.changedPageIds,
        projectionPageIds,
        registryChanged,
        vocabularyChanged
      );
      return {
        affectedPageIds: automatic.changedPageIds,
        pageIndex: workingPageIndex,
        componentPageIds: [...workingPages.keys()].sort(),
        scopePageCount: workingPages.size,
        engine: 'canonical',
        metadataChangeSet: {
          metadataRevision,
          changedPageIds,
          deletedPageIds,
          changedDomains: commitDomains,
          pages: responsePages,
          pageMetadataProjection,
          pageIndex: cloneJson(workingPageIndex),
          descriptorRegistry: cloneJson(reconciled.descriptorRegistry),
          vocabulary: cloneJson(reconciled.vocabulary),
          descriptorGroups: cloneJson(descriptorGroups)
        },
        diagnostics: {
          descriptorSync: {
            ...automatic.plannerStats,
            warnings: automatic.plannerWarnings,
            projection: syncProjection.stats
          }
        }
      };
    });
  };
}

module.exports = {
  buildPageMetadataProjection,
  buildSyncProjection,
  canonicalDescriptorGroups,
  createDescriptorMetadataCommit,
  descriptorUsageFromPages,
  materializeAutomaticDescriptors,
  metadataRevisionStatus,
  nextMetadataRevision,
  normalizedMetadataRevision,
  reconcileDescriptorRegistry,
  updatePageIndexDescriptorProjection
};
