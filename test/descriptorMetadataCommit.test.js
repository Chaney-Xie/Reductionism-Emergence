const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createDescriptorModel } = require('../server/descriptorModel');
const {
  createDescriptorMetadataCommit,
  metadataRevisionStatus,
  nextMetadataRevision
} = require('../server/descriptorMetadataCommit');
const {
  readJson,
  withJsonWriteTransaction,
  writeJsonAtomic
} = require('../server/jsonStore');

const createdAt = '2026-01-01T00:00:00.000Z';
const samples = {
  'descriptors.json': {
    version: 1,
    classes: [{ id: 'class_1', label: 'Class 1' }],
    groups: [{ id: 'ungrouped', label: 'Ungrouped', children: [] }],
    entries: []
  },
  'vocabulary.json': { version: 1, entries: [] }
};
const model = createDescriptorModel(samples);
const linkTypes = {
  linkTypes: [
    { id: 'contains', label: 'contain', opposite: 'contained_by' },
    { id: 'contained_by', label: 'contained by', opposite: 'contains' }
  ],
  defaultLinkTypeId: 'contains'
};
const rules = {
  rules: [{
    id: 'write-class-1',
    enabled: true,
    localClassId: 'class_1',
    mode: 'write',
    linkTypeId: 'contains',
    remoteClassId: 'class_1'
  }]
};

function descriptor(id) {
  return {
    id,
    display: id,
    vocabularyEntryId: `vocab_${id}`,
    groupId: 'ungrouped',
    createdAt,
    updatedAt: createdAt
  };
}

function vocabulary(id) {
  return { id: `vocab_${id}`, display: id, aliases: [] };
}

function page(id, { descriptors = [], ignored = [], remembered = [], targetPageId = null } = {}) {
  return {
    id,
    title: id,
    type: 'canvas',
    descriptors: { class_1: descriptors },
    ignoredDescriptors: {
      class_1: ignored.map((entryId) => ({ entryId, createdAt }))
    },
    ignoredManualEntryIds: { class_1: remembered },
    objects: [],
    maintenanceResources: [],
    blocks: targetPageId ? [{
      id: `block_${id}`,
      links: [{
        id: `link_${id}`,
        targetType: 'page',
        targetPageId,
        linkTypeId: 'contains',
        type: 'contains'
      }]
    }] : [],
    backlinks: [],
    highlightGroups: [],
    updatedAt: createdAt
  };
}

function memoryCommit(written) {
  return createDescriptorMetadataCommit({
    model,
    getOrCreateVocabularyEntry: model.getOrCreateVocabularyEntry,
    writePage: async (filePath, value) => { written.pages.set(filePath, value); },
    writePageIndex: async (value) => { written.pageIndex = value; },
    writeDescriptorSyncIndex: async (value) => { written.syncIndex = value; },
    writeDescriptorLibrary: async (value) => { written.descriptorRegistry = value; },
    writeVocabularyLibrary: async (value) => { written.vocabulary = value; }
  });
}

test('canonical metadata commit ignores stale projections and publishes one revision', async () => {
  const source = page('page_a', {
    descriptors: [{ entryId: 'X', source: 'manual', status: 'active', createdAt }],
    targetPageId: 'page_b'
  });
  const target = page('page_b', {
    descriptors: [{
      entryId: 'Z',
      source: 'auto',
      status: 'active',
      origins: [],
      createdAt
    }],
    ignored: ['Y'],
    remembered: ['Y']
  });
  const pageRecords = new Map([
    ['page_a', {
      filePath: '/pages/page_a.json', relativePath: 'pages/page_a.json', page: source
    }],
    ['page_b', {
      filePath: '/pages/page_b.json', relativePath: 'pages/page_b.json', page: target
    }]
  ]);
  const stalePageIndex = {
    metadataRevision: 20,
    pages: [
      {
        id: 'page_a', path: 'pages/wrong.json', descriptors: { class_1: [] }, descriptorIds: []
      },
      {
        id: 'page_stale', path: 'pages/page_stale.json', descriptors: {}, descriptorIds: []
      }
    ]
  };
  const staleSyncIndex = {
    schemaVersion: 1,
    metadataRevision: 19,
    pages: {
      page_a: {
        descriptors: { class_1: { manual: ['Z'], auto: [], ignored: [], autoSupportHash: 'stale' } },
        relations: {}
      }
    }
  };
  const descriptorLibrary = {
    ...samples['descriptors.json'],
    metadataRevision: 18,
    entries: ['X', 'Y', 'Z'].map(descriptor)
  };
  const vocabularyLibrary = {
    version: 1,
    entries: ['X', 'Y', 'Z'].map(vocabulary)
  };
  const written = { pages: new Map() };

  const result = await memoryCommit(written)({
    pageRecords,
    pageIndex: stalePageIndex,
    previousSyncIndex: staleSyncIndex,
    descriptorLibrary,
    vocabularyLibrary,
    descriptorSyncRules: rules,
    linkTypes,
    directChangedPageIds: ['page_a', 'page_deleted'],
    changedDomains: ['relations'],
    now: '2026-02-01T00:00:00.000Z'
  });

  assert.equal(result.metadataChangeSet.metadataRevision, 21);
  assert.equal(written.pageIndex.metadataRevision, 21);
  assert.equal(written.syncIndex.metadataRevision, 21);
  assert.equal(written.descriptorRegistry.metadataRevision, 21);
  assert.deepEqual(written.pageIndex.pages.map((entry) => entry.id), ['page_a', 'page_b']);
  assert.equal(written.pageIndex.pages[0].path, 'pages/page_a.json');
  assert.equal(written.pageIndex.pages[1].path, 'pages/page_b.json');
  assert.deepEqual(written.pageIndex.pages[0].descriptors.class_1, ['X']);
  assert.deepEqual(written.pageIndex.pages[1].descriptors.class_1, ['X']);
  assert.deepEqual(written.descriptorRegistry.entries.map((entry) => entry.id), ['X', 'Y']);
  assert.equal(written.pages.get('/pages/page_b.json').descriptors.class_1[0].entryId, 'X');
  assert.deepEqual(
    written.pages.get('/pages/page_b.json').descriptors.class_1[0].origins,
    [{
      ruleId: 'write-class-1',
      fromPageId: 'page_a',
      fromClassId: 'class_1',
      linkTypeId: 'contains'
    }]
  );
  assert.deepEqual(
    written.pages.get('/pages/page_b.json').ignoredManualEntryIds.class_1,
    ['Y'],
    'materialization preserves remembered-manual canonical provenance'
  );
  assert.deepEqual(result.metadataChangeSet.changedPageIds, [
    'page_a', 'page_b', 'page_deleted', 'page_stale'
  ]);
  assert.deepEqual(result.metadataChangeSet.deletedPageIds, ['page_deleted', 'page_stale']);
  assert.equal(target.descriptors.class_1[0].entryId, 'Z', 'input Page records remain untouched');
  assert.deepEqual(metadataRevisionStatus(
    written.pageIndex,
    written.syncIndex,
    written.descriptorRegistry
  ), { coherent: true, metadataRevision: 21, revisions: [21, 21, 21] });
  assert.equal(nextMetadataRevision(stalePageIndex, staleSyncIndex, descriptorLibrary), 21);
});

test('metadata revision exhaustion aborts instead of publishing an unsafe integer', () => {
  assert.throws(
    () => nextMetadataRevision({ metadataRevision: Number.MAX_SAFE_INTEGER }),
    /revision space is exhausted/
  );
});

test('no-op automatic materialization preserves durable manual order across a restart', async () => {
  const orderedPage = page('page_ordered', {
    descriptors: [
      { entryId: 'B', source: 'manual', status: 'active', createdAt },
      { entryId: 'A', source: 'manual', status: 'active', createdAt }
    ]
  });
  const durableBytes = JSON.stringify(orderedPage);
  const pageRecords = new Map([['page_ordered', {
    filePath: '/pages/page_ordered.json',
    relativePath: 'pages/page_ordered.json',
    page: orderedPage
  }]]);
  const descriptorLibrary = {
    ...samples['descriptors.json'],
    metadataRevision: 7,
    entries: ['A', 'B'].map(descriptor)
  };
  const vocabularyLibrary = {
    version: 1,
    entries: ['A', 'B'].map(vocabulary)
  };
  const written = { pages: new Map() };
  const first = await memoryCommit(written)({
    pageRecords,
    pageIndex: {
      metadataRevision: 7,
      pages: [{ id: 'page_ordered', path: 'pages/page_ordered.json' }]
    },
    previousSyncIndex: { schemaVersion: 1, metadataRevision: 7, pages: {} },
    descriptorLibrary,
    vocabularyLibrary,
    descriptorSyncRules: { rules: [] },
    linkTypes,
    directChangedPageIds: ['page_ordered'],
    now: '2026-02-01T00:00:00.000Z'
  });

  assert.equal(written.pages.size, 0, 'a no-op planner must not rewrite the durable Page');
  assert.equal(JSON.stringify(orderedPage), durableBytes);
  assert.deepEqual(written.pageIndex.pages[0].descriptors.class_1, ['B', 'A']);
  assert.deepEqual(
    first.metadataChangeSet.pages[0].descriptors.class_1.map((ref) => ref.entryId),
    ['B', 'A']
  );

  const restartedWrites = { pages: new Map() };
  const restarted = await memoryCommit(restartedWrites)({
    pageRecords,
    pageIndex: written.pageIndex,
    previousSyncIndex: written.syncIndex,
    descriptorLibrary: written.descriptorRegistry,
    vocabularyLibrary,
    descriptorSyncRules: { rules: [] },
    linkTypes,
    directChangedPageIds: ['page_ordered'],
    now: '2026-02-02T00:00:00.000Z'
  });
  assert.equal(restartedWrites.pages.size, 0);
  assert.deepEqual(restartedWrites.pageIndex.pages[0].descriptors.class_1, ['B', 'A']);
  assert.deepEqual(
    restarted.metadataChangeSet.pages[0].descriptors.class_1.map((ref) => ref.entryId),
    ['B', 'A']
  );
});

test('automatic add and removal preserve raw normalized manual order', async () => {
  const sourceWithLink = page('page_source', {
    descriptors: [{ entryId: 'X', source: 'manual', status: 'active', createdAt }],
    targetPageId: 'page_ordered'
  });
  const orderedTarget = page('page_ordered', {
    descriptors: [
      { entryId: 'B', source: 'manual', status: 'active', createdAt },
      { entryId: 'A', source: 'manual', status: 'active', createdAt }
    ]
  });
  const descriptorLibrary = {
    ...samples['descriptors.json'],
    metadataRevision: 10,
    entries: ['A', 'B', 'X'].map(descriptor)
  };
  const vocabularyLibrary = {
    version: 1,
    entries: ['A', 'B', 'X'].map(vocabulary)
  };
  const pageIndex = {
    metadataRevision: 10,
    pages: [
      { id: 'page_source', path: 'pages/page_source.json' },
      { id: 'page_ordered', path: 'pages/page_ordered.json' }
    ]
  };
  const recordsWithLink = new Map([
    ['page_source', {
      filePath: '/pages/page_source.json',
      relativePath: 'pages/page_source.json',
      page: sourceWithLink
    }],
    ['page_ordered', {
      filePath: '/pages/page_ordered.json',
      relativePath: 'pages/page_ordered.json',
      page: orderedTarget
    }]
  ]);
  const addedWrites = { pages: new Map() };
  const added = await memoryCommit(addedWrites)({
    pageRecords: recordsWithLink,
    pageIndex,
    previousSyncIndex: { schemaVersion: 1, metadataRevision: 10, pages: {} },
    descriptorLibrary,
    vocabularyLibrary,
    descriptorSyncRules: rules,
    linkTypes,
    now: '2026-02-01T00:00:00.000Z'
  });
  const targetWithAuto = addedWrites.pages.get('/pages/page_ordered.json');
  assert.deepEqual(
    targetWithAuto.descriptors.class_1.filter((ref) => ref.source !== 'auto')
      .map((ref) => ref.entryId),
    ['B', 'A']
  );
  assert.deepEqual(
    targetWithAuto.descriptors.class_1.filter((ref) => ref.source === 'auto')
      .map((ref) => ref.entryId),
    ['X']
  );
  assert.deepEqual(
    added.pageIndex.pages.find((entry) => entry.id === 'page_ordered').descriptors.class_1,
    ['B', 'A', 'X']
  );
  assert.equal(
    added.pageIndex.pages.find((entry) => entry.id === 'page_ordered').updatedAt,
    targetWithAuto.updatedAt
  );

  const sourceWithoutLink = page('page_source', {
    descriptors: [{ entryId: 'X', source: 'manual', status: 'active', createdAt }]
  });
  const removedWrites = { pages: new Map() };
  await memoryCommit(removedWrites)({
    pageRecords: new Map([
      ['page_source', {
        filePath: '/pages/page_source.json',
        relativePath: 'pages/page_source.json',
        page: sourceWithoutLink
      }],
      ['page_ordered', {
        filePath: '/pages/page_ordered.json',
        relativePath: 'pages/page_ordered.json',
        page: targetWithAuto
      }]
    ]),
    pageIndex: addedWrites.pageIndex,
    previousSyncIndex: addedWrites.syncIndex,
    descriptorLibrary: addedWrites.descriptorRegistry,
    vocabularyLibrary,
    descriptorSyncRules: rules,
    linkTypes,
    now: '2026-02-02T00:00:00.000Z'
  });
  assert.deepEqual(
    removedWrites.pages.get('/pages/page_ordered.json').descriptors.class_1
      .map((ref) => ref.entryId),
    ['B', 'A']
  );
  assert.equal(
    removedWrites.pageIndex.pages.find((entry) => entry.id === 'page_ordered').updatedAt,
    removedWrites.pages.get('/pages/page_ordered.json').updatedAt
  );
});

test('a later revision carries the complete prior Page metadata and catalog state', async () => {
  const pageA = {
    ...page('page_a', {
      descriptors: [{ entryId: 'A', source: 'manual', status: 'active', createdAt }]
    }),
    markdownBody: 'must not enter metadata projection'
  };
  const pageB = { ...page('page_b'), cneText: { source: 'also excluded' } };
  const descriptorLibrary = {
    ...samples['descriptors.json'],
    metadataRevision: 30,
    entries: [descriptor('A')]
  };
  const vocabularyLibrary = { version: 1, entries: [vocabulary('A')] };
  const descriptorGroups = {
    version: 1,
    groups: { group_prior: { id: 'group_prior', label: 'Prior' } },
    descriptorParentByEntryId: { A: 'group_prior' }
  };
  const records = new Map([
    ['page_b', {
      filePath: '/pages/page_b.json', relativePath: 'pages/page_b.json', page: pageB
    }],
    ['page_a', {
      filePath: '/pages/page_a.json', relativePath: 'pages/page_a.json', page: pageA
    }]
  ]);
  const firstWrites = { pages: new Map() };
  const first = await memoryCommit(firstWrites)({
    pageRecords: records,
    pageIndex: { metadataRevision: 30, pages: [] },
    previousSyncIndex: { schemaVersion: 1, metadataRevision: 30, pages: {} },
    descriptorLibrary,
    vocabularyLibrary,
    descriptorGroups,
    descriptorSyncRules: { rules: [] },
    linkTypes,
    directChangedPageIds: ['page_a'],
    changedDomains: ['pages'],
    now: '2026-02-01T00:00:00.000Z'
  });
  const secondWrites = { pages: new Map() };
  const second = await memoryCommit(secondWrites)({
    pageRecords: records,
    pageIndex: firstWrites.pageIndex,
    previousSyncIndex: firstWrites.syncIndex,
    descriptorLibrary: firstWrites.descriptorRegistry,
    vocabularyLibrary,
    descriptorGroups,
    descriptorSyncRules: { rules: [] },
    linkTypes,
    directChangedPageIds: ['page_b'],
    changedDomains: ['categories'],
    now: '2026-02-02T00:00:00.000Z'
  });

  assert.equal(
    second.metadataChangeSet.pageMetadataProjection.metadataRevision,
    second.metadataChangeSet.metadataRevision
  );
  assert.deepEqual(
    second.metadataChangeSet.pageMetadataProjection.pages.map((entry) => entry.id),
    ['page_a', 'page_b']
  );
  assert.deepEqual(
    second.metadataChangeSet.pageMetadataProjection.pages[0].descriptors.class_1
      .map((ref) => ref.entryId),
    ['A']
  );
  assert.deepEqual(Object.keys(second.metadataChangeSet.pageMetadataProjection.pages[0]), [
    'id', 'descriptors', 'ignoredDescriptors', 'ignoredManualEntryIds', 'updatedAt'
  ]);
  assert.equal(Object.hasOwn(second.metadataChangeSet.pageMetadataProjection.pages[0], 'markdownBody'), false);
  assert.deepEqual(second.metadataChangeSet.vocabulary, vocabularyLibrary);
  assert.deepEqual(second.metadataChangeSet.descriptorGroups, descriptorGroups);
  assert.deepEqual(second.metadataChangeSet.pages.map((item) => item.id), ['page_b']);
  assert.ok(second.metadataChangeSet.metadataRevision > first.metadataChangeSet.metadataRevision);
});

test('a canonical Page reference missing from the Descriptor registry aborts before publication', async () => {
  const written = { pages: new Map() };
  const commit = memoryCommit(written);
  await assert.rejects(commit({
    pageRecords: new Map([['page_missing_descriptor', {
      filePath: '/pages/page_missing_descriptor.json',
      relativePath: 'pages/page_missing_descriptor.json',
      page: page('page_missing_descriptor', {
        descriptors: [{
          entryId: 'MISSING', source: 'manual', status: 'active', createdAt
        }]
      })
    }]]),
    pageIndex: { metadataRevision: 3, pages: [] },
    previousSyncIndex: { schemaVersion: 1, metadataRevision: 3, pages: {} },
    descriptorLibrary: { ...samples['descriptors.json'], metadataRevision: 3 },
    vocabularyLibrary: samples['vocabulary.json'],
    descriptorSyncRules: { rules: [] },
    linkTypes,
    now: '2026-02-01T00:00:00.000Z'
  }), /Descriptor IDs missing from the registry: MISSING/);
  assert.equal(written.pages.size, 0);
  assert.equal(written.pageIndex, undefined);
  assert.equal(written.descriptorRegistry, undefined);
  assert.equal(written.syncIndex, undefined);
});

test('failure after Page, pageIndex, and registry writes rolls every resource back', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'descriptor-metadata-commit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pageAPath = path.join(root, 'page_a.json');
  const pageBPath = path.join(root, 'page_b.json');
  const pageIndexPath = path.join(root, 'pageIndex.json');
  const registryPath = path.join(root, 'descriptors.json');
  const vocabularyPath = path.join(root, 'vocabulary.json');
  const syncPath = path.join(root, 'descriptorSyncIndex.json');
  const source = page('page_a', {
    descriptors: [{ entryId: 'X', source: 'manual', status: 'active', createdAt }],
    targetPageId: 'page_b'
  });
  const target = page('page_b');
  const pageIndex = {
    metadataRevision: 4,
    pages: [
      { id: 'page_a', descriptors: { class_1: ['X'] }, descriptorIds: ['X'] },
      { id: 'page_b', descriptors: { class_1: [] }, descriptorIds: [] }
    ]
  };
  const descriptorLibrary = {
    ...samples['descriptors.json'], metadataRevision: 4, entries: [descriptor('X')]
  };
  const vocabularyLibrary = { version: 1, entries: [vocabulary('X')] };
  const syncIndex = { schemaVersion: 1, metadataRevision: 4, pages: {} };
  const initial = new Map([
    [pageAPath, source],
    [pageBPath, target],
    [pageIndexPath, pageIndex],
    [registryPath, descriptorLibrary],
    [vocabularyPath, vocabularyLibrary],
    [syncPath, syncIndex]
  ]);
  for (const [filePath, value] of initial) await writeJsonAtomic(filePath, value);
  const bytesBefore = new Map(await Promise.all([...initial.keys()].map(async (filePath) => (
    [filePath, await fs.readFile(filePath, 'utf8')]
  ))));

  const commit = createDescriptorMetadataCommit({
    model,
    getOrCreateVocabularyEntry: model.getOrCreateVocabularyEntry,
    withTransaction: withJsonWriteTransaction,
    writePage: writeJsonAtomic,
    writePageIndex: (value) => writeJsonAtomic(pageIndexPath, value),
    writeDescriptorLibrary: (value) => writeJsonAtomic(registryPath, value),
    writeVocabularyLibrary: (value) => writeJsonAtomic(vocabularyPath, value),
    writeDescriptorSyncIndex: async () => {
      throw Object.assign(new Error('injected sync projection failure'), { code: 'EIO' });
    }
  });

  await assert.rejects(commit({
    pageRecords: new Map([
      ['page_a', { filePath: pageAPath, page: source }],
      ['page_b', { filePath: pageBPath, page: target }]
    ]),
    pageIndex,
    previousSyncIndex: syncIndex,
    descriptorLibrary,
    vocabularyLibrary,
    descriptorSyncRules: rules,
    linkTypes,
    now: '2026-02-01T00:00:00.000Z'
  }), /injected sync projection failure/);

  for (const [filePath, bytes] of bytesBefore) {
    assert.equal(await fs.readFile(filePath, 'utf8'), bytes, `${path.basename(filePath)} rolled back`);
  }
  assert.deepEqual(await readJson(syncPath), syncIndex);
});
