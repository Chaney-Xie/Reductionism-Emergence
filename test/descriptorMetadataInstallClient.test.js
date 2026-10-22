const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const model = require('../public/descriptorMetadataInstall');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function snapshot(metadataRevision, overrides = {}) {
  const value = {
    metadataRevision,
    pageIndex: { metadataRevision, pages: [] },
    descriptorRegistry: { metadataRevision, version: 1, entries: [] },
    descriptorGroups: { version: 1, groups: {}, descriptorParentByEntryId: {} },
    vocabulary: { version: 1, entries: [] },
    ...overrides
  };
  if (!Object.hasOwn(overrides, 'pageMetadataProjection')) {
    const fullPagesById = new Map((value.pages || []).map((page) => [page.id, page]));
    value.pageMetadataProjection = {
      metadataRevision,
      pages: value.pageIndex.pages.map((entry) => {
        const page = fullPagesById.get(entry.id) || entry;
        return {
          id: entry.id,
          descriptors: page.descriptors || {},
          ignoredDescriptors: page.ignoredDescriptors || {},
          ignoredManualEntryIds: page.ignoredManualEntryIds || {},
          updatedAt: typeof page.updatedAt === 'string' ? page.updatedAt : null
        };
      })
    };
  }
  return value;
}

function changeSet(metadataRevision, overrides = {}) {
  const page = { id: `page_${metadataRevision}`, title: `Page ${metadataRevision}` };
  return snapshot(metadataRevision, {
    changedPageIds: [page.id],
    deletedPageIds: [],
    changedDomains: ['descriptors'],
    pages: [page],
    pageIndex: { metadataRevision, pages: [{ id: page.id, title: page.title }] },
    ...overrides
  });
}

function projectedPage(id, descriptors = {}, updatedAt = null, overrides = {}) {
  return {
    id,
    descriptors,
    ignoredDescriptors: {},
    ignoredManualEntryIds: {},
    updatedAt,
    ...overrides
  };
}

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `Missing ${startText}`);
  assert.notEqual(end, -1, `Missing ${endText}`);
  return source.slice(start, end);
}

test('revision installer applies a coherent snapshot once and rejects stale or duplicate deliveries', async () => {
  const applied = [];
  const installer = model.createRevisionInstaller({
    apply: async (value) => applied.push(value.metadataRevision)
  });

  assert.equal((await installer.install(snapshot(4))).applied, true);
  assert.equal((await installer.install(snapshot(4))).idempotent, true);
  assert.equal((await installer.install(snapshot(3))).stale, true);
  assert.equal((await installer.install(snapshot(5))).applied, true);
  assert.deepEqual(applied, [4, 5]);
  assert.equal(installer.currentRevision(), 5);
});

test('revision installer serializes concurrent deliveries before evaluating freshness', async () => {
  const applied = [];
  const installer = model.createRevisionInstaller({
    apply: async (value) => {
      await Promise.resolve();
      applied.push(value.metadataRevision);
    }
  });

  const higher = installer.install(snapshot(8));
  const lower = installer.install(snapshot(7));
  const [higherResult, lowerResult] = await Promise.all([higher, lower]);
  assert.equal(higherResult.applied, true);
  assert.equal(lowerResult.stale, true);
  assert.deepEqual(applied, [8]);
});

test('a delta received before startup waits for a complete snapshot baseline', async () => {
  const applied = [];
  const installer = model.createRevisionInstaller({
    apply: (value) => applied.push({ revision: value.metadataRevision, snapshot: value.snapshot })
  });
  let deltaSettled = false;
  const earlyDelta = installer.install(changeSet(11)).then((result) => {
    deltaSettled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(deltaSettled, false);
  assert.deepEqual(applied, []);

  const baseline = await installer.install(snapshot(11));
  const delta = await earlyDelta;
  assert.equal(baseline.applied, true);
  assert.equal(delta.idempotent, true);
  assert.deepEqual(applied, [{ revision: 11, snapshot: true }]);
  assert.equal(installer.currentRevision(), 11);
});

test('failed validation or application never advances the installed revision', async () => {
  let failOnce = true;
  const installer = model.createRevisionInstaller({
    apply: async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('apply failed');
      }
    }
  });

  await assert.rejects(installer.install(snapshot(2)), /apply failed/);
  assert.equal(installer.currentRevision(), null);
  assert.equal((await installer.install(snapshot(2))).applied, true);
  assert.equal(installer.currentRevision(), 2);

  await assert.rejects(installer.install(changeSet(3, {
    changedPageIds: ['missing'],
    pages: []
  })), /pages must exactly match changedPageIds/);
  assert.equal(installer.currentRevision(), 2);
});

test('validator rejects projection revisions that do not match the envelope revision', () => {
  assert.throws(() => model.validateMetadataChangeSet(snapshot(6, {
    pageIndex: { metadataRevision: 5, pages: [] }
  })), /pageIndex\.metadataRevision/);
  assert.throws(() => model.validateMetadataChangeSet(snapshot(6, {
    descriptorRegistry: { metadataRevision: 7, entries: [] }
  })), /descriptorRegistry\.metadataRevision/);
  assert.throws(() => model.validateMetadataChangeSet(snapshot(6, {
    pageMetadataProjection: { metadataRevision: 5, pages: [] }
  })), /pageMetadataProjection\.metadataRevision/);
});

test('validator requires a unique metadata-only cumulative Page projection', () => {
  assert.throws(() => model.validateMetadataChangeSet({
    ...snapshot(3),
    pageMetadataProjection: undefined
  }), /pageMetadataProjection/);
  const projectedPage = {
    id: 'page_a',
    descriptors: {},
    ignoredDescriptors: {},
    ignoredManualEntryIds: {},
    updatedAt: null
  };
  assert.throws(() => model.validateMetadataChangeSet(snapshot(3, {
    pageMetadataProjection: {
      metadataRevision: 3,
      pages: [projectedPage, { ...projectedPage }]
    }
  })), /duplicate Page ID page_a/);
  assert.throws(() => model.validateMetadataChangeSet(snapshot(3, {
    pageMetadataProjection: {
      metadataRevision: 3,
      pages: [{ ...projectedPage, markdownBody: 'must not cross the metadata boundary' }]
    }
  })), /metadata fields only/);
  assert.throws(() => model.validateMetadataChangeSet(snapshot(3, {
    pageIndex: { metadataRevision: 3, pages: [{ id: 'page_a' }] },
    pageMetadataProjection: { metadataRevision: 3, pages: [] }
  })), /exactly match pageIndex/);

  const pageA = { id: 'page_a', title: 'A' };
  const ghost = { id: 'page_ghost', title: 'Ghost' };
  assert.throws(() => model.validateMetadataChangeSet(changeSet(3, {
    changedPageIds: ['page_a'],
    pages: [pageA, ghost],
    pageIndex: {
      metadataRevision: 3,
      pages: [pageA, ghost]
    }
  })), /pages must exactly match changedPageIds/);
  assert.throws(() => model.validateMetadataChangeSet(changeSet(3, {
    changedPageIds: ['page_a'],
    deletedPageIds: ['page_a'],
    pages: [pageA],
    pageIndex: { metadataRevision: 3, pages: [pageA] }
  })), /pages must exactly match changedPageIds/);
  assert.throws(() => model.validateMetadataChangeSet(changeSet(3, {
    changedPageIds: ['page_a'],
    deletedPageIds: ['page_a'],
    pages: [],
    pageIndex: { metadataRevision: 3, pages: [pageA] }
  })), /deleted Page page_a remains in the cumulative projection/);
});

test('main and Dictionary windows can independently install the same revision', async () => {
  let mainCount = 0;
  let dictionaryCount = 0;
  const main = model.createRevisionInstaller({ apply: () => { mainCount += 1; } });
  const dictionary = model.createRevisionInstaller({ apply: () => { dictionaryCount += 1; } });
  await Promise.all([main.install(snapshot(9)), dictionary.install(snapshot(9))]);
  assert.equal(mainCount, 1);
  assert.equal(dictionaryCount, 1);
  assert.equal(main.currentRevision(), 9);
  assert.equal(dictionary.currentRevision(), 9);
});

test('both clients load one shared installer before their runtime scripts', () => {
  const index = read('public/index.html');
  const vocabularyHtml = read('public/vocabulary.html');
  assert.ok(index.indexOf('descriptorMetadataInstall.js') < index.indexOf('app.js?v='));
  assert.ok(vocabularyHtml.indexOf('descriptorMetadataInstall.js') < vocabularyHtml.indexOf('vocabulary.js'));
});

test('main startup adopts one passive descriptor metadata snapshot', () => {
  const bootstrap = read('public/js/appBootstrap.js');
  const start = sliceBetween(bootstrap, 'async function start()', '\nstart();');
  assert.match(start, /request\('\/api\/descriptor-metadata\/snapshot'\)/);
  assert.match(start, /await installDescriptorMetadataChangeSet\(descriptorMetadataSnapshot,[^]*?render: false/);
  for (const oldEndpoint of ['/api/page-index', '/api/descriptors', '/api/vocabulary', '/api/descriptor-groups']) {
    assert.doesNotMatch(start, new RegExp(`request\\('${oldEndpoint.replaceAll('/', '\\/')}'\\)`));
  }
});

test('main request installs before compatibility unwrapping generic Page POST responses', () => {
  const app = read('public/app.js');
  const requestSource = sliceBetween(app, 'async function request(url, options)', '\nfunction pageApiUrl');
  assert.ok(requestSource.indexOf('await installDescriptorMetadataChangeSet(body')
    < requestSource.indexOf('isGenericPageMutationRequest(url, options, body)'));
  assert.match(requestSource, /const installation = await installDescriptorMetadataChangeSet[\s\S]*?if \(installation\.applied\) publishDescriptorMetadataChangeSet\(body\)/);
  assert.match(requestSource, /body\.metadataChangeSet && genericPageMutationIsMetadataOnly\(options\)[^]*?canonicalPages\.get\(body\.page\.id\)[^]*?: body\.page/);
  const matcher = sliceBetween(app, 'function isGenericPageMutationRequest', '\nfunction metadataInstalledResponse');
  assert.match(matcher, /method === 'POST'/);
  assert.match(matcher, /\^\\\/api\\\/pages\\\/\[\^\/\]\+\$/);

  const guard = sliceBetween(app, 'async function revisionGuardedPageIndexResponse', '\nasync function installDescriptorMetadataChangeSet');
  assert.match(guard, /incomingRevision < installedRevision\) return pageIndex/);
  assert.match(guard, /incomingRevision === installedRevision\) return body/);
  assert.match(guard, /fetch\('\/api\/descriptor-metadata\/snapshot'\)/);
});

test('metadata command responses retain command fields without replaying stale document bodies', () => {
  const app = read('public/app.js');
  const source = sliceBetween(
    app,
    'function pageWithInstalledDescriptorMetadata',
    '\nasync function revisionGuardedPageIndexResponse'
  );
  const markdownCanonical = {
    id: 'markdown',
    type: 'markdown',
    title: 'Canonical title',
    markdownBody: 'newer saved body',
    blocks: [{ id: 'old_block' }],
    descriptors: { class_1: [{ entryId: 'descriptor_new' }] }
  };
  const hnCanonical = {
    id: 'cne',
    type: 'cne-text',
    cneText: { revision: 9, source: 'newer HN source' },
    blocks: []
  };
  const context = {
    canonicalPages: new Map([
      ['markdown', markdownCanonical],
      ['cne', hnCanonical]
    ]),
    markdownPageModel: {
      PAGE_TYPES: { MARKDOWN: 'markdown' },
      normalizePageType: (type) => type
    },
    pageIsHnText: (page) => page?.type === 'cne-text',
    pageIndex: { pages: [] },
    descriptorLibrary: { entries: [] },
    vocabularyLibrary: null,
    descriptorGroupsConfig: null,
    Object
  };
  vm.runInNewContext(`${source}\nglobalThis.responseMergeTest = pageWithInstalledDescriptorMetadata;`, context);

  const appliedRelationResponse = context.responseMergeTest({
    ...markdownCanonical,
    markdownBody: 'stale server body',
    blocks: [{ id: 'new_relation_block' }],
    descriptors: { class_1: [{ entryId: 'descriptor_stale' }] }
  }, { applied: true });
  assert.equal(appliedRelationResponse.markdownBody, 'newer saved body');
  assert.equal(appliedRelationResponse.blocks[0].id, 'new_relation_block');
  assert.equal(appliedRelationResponse.descriptors.class_1[0].entryId, 'descriptor_new');

  const appliedHnResponse = context.responseMergeTest({
    ...hnCanonical,
    cneText: { revision: 2, source: 'stale HN source' },
    blocks: [{ id: 'new_relation_block' }]
  }, { applied: true });
  assert.equal(appliedHnResponse.cneText.revision, 9);
  assert.equal(appliedHnResponse.blocks[0].id, 'new_relation_block');

  const staleResponse = context.responseMergeTest({
    ...markdownCanonical,
    markdownBody: 'stale server body',
    blocks: [{ id: 'stale_relation_block' }]
  }, { stale: true, applied: false });
  assert.notEqual(staleResponse, markdownCanonical);
  assert.equal(staleResponse.markdownBody, 'newer saved body');
  assert.equal(staleResponse.blocks[0].id, 'stale_relation_block');
  assert.equal(staleResponse.descriptors.class_1[0].entryId, 'descriptor_new');
});

test('raw page-index adoption ignores lower revisions and recovers higher revisions coherently', async () => {
  const app = read('public/app.js');
  const source = sliceBetween(
    app,
    'async function revisionGuardedPageIndexResponse',
    '\nasync function installDescriptorMetadataChangeSet'
  );
  const coherent = { metadataRevision: 5, pages: [{ id: 'coherent' }] };
  const installedSnapshots = [];
  const context = {
    pageIndex: coherent,
    currentDescriptorMetadataRevision: () => 5,
    installDescriptorMetadataChangeSet: async (snapshot) => {
      installedSnapshots.push(snapshot);
      context.pageIndex = snapshot.pageIndex;
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        metadataRevision: 7,
        pageMetadataProjection: {
          metadataRevision: 7,
          pages: [projectedPage('newer', { class_1: [{ entryId: 'descriptor_newer' }] })]
        },
        pageIndex: { metadataRevision: 7, pages: [{ id: 'newer' }] },
        descriptorRegistry: { metadataRevision: 7, entries: [] }
      })
    }),
    Number,
    String,
    Error
  };
  vm.runInNewContext(`${source}\nglobalThis.pageIndexGuardTest = revisionGuardedPageIndexResponse;`, context);

  const lower = await context.pageIndexGuardTest('/api/page-index', undefined, {
    metadataRevision: 4,
    pages: [{ id: 'stale' }]
  });
  assert.equal(lower, coherent);
  const equal = { metadataRevision: 5, pages: [{ id: 'same-revision-title-update' }] };
  assert.equal(await context.pageIndexGuardTest('/api/page-index', undefined, equal), equal);
  const higher = await context.pageIndexGuardTest('/api/page-index', undefined, {
    metadataRevision: 6,
    pages: [{ id: 'partial-newer' }]
  });
  assert.equal(installedSnapshots.length, 1);
  assert.equal(installedSnapshots[0].metadataRevision, 7);
  assert.equal(
    installedSnapshots[0].pageMetadataProjection.pages[0].descriptors.class_1[0].entryId,
    'descriptor_newer'
  );
  assert.equal(higher.metadataRevision, 7);
  assert.equal(higher.pages[0].id, 'newer');
});

test('main installer batches full Pages, tombstones, and deferred link invalidation', () => {
  const app = read('public/app.js');
  const apply = sliceBetween(app, 'function applyDescriptorMetadataChangeSet', '\nfunction commitCanonicalPage');
  assert.ok(apply.indexOf('pageIndex =') < apply.indexOf('commitCanonicalPage('));
  assert.ok(apply.indexOf('descriptorLibrary =') < apply.indexOf('commitCanonicalPage('));
  assert.ok(apply.indexOf('descriptorLibrary = stagedDescriptorLibrary')
    < apply.indexOf('dictionaryEventWithRecordedRemaps(rawPresentationEvent)'));
  assert.match(apply, /commitCanonicalPage\([^]*?invalidateLinkedPages: false,[^]*?linkedPageIdsToInvalidate,[^]*?preserveDocumentBody: true/);
  assert.ok(apply.indexOf('for (const targetPageId of linkedPageIdsToInvalidate)')
    > apply.indexOf('for (const page of stagedPages)'));
  assert.match(apply, /for \(const deletedPageId of cumulativeDeletedPageIds\)[^]*?discardPagePersistenceState\(deletedPageId\)/);
  assert.ok(apply.indexOf('discardPagePersistenceState(deletedPageId)')
    < apply.indexOf('notifyCanonicalPageDeleted(deletedPageId, changeSet, context)'));
  assert.match(apply, /for \(const runtime of livingPaneRuntimes\(\)\)[^]*?const activePageId = runtime\.session\.activeTab\(\)\?\.currentPageId[^]*?runtime\.currentPage = canonicalPages\.get\(activePageId\)/);

  const commit = sliceBetween(app, 'function commitCanonicalPage(page, options = {})', '\nfunction highlightBlockIds');
  assert.match(commit, /preserveDocumentBody[^]*?markdownBody: previous\.markdownBody \|\| ''/);
  assert.match(commit, /markdownSaveState[^]*?markdownBody: previous\.markdownBody \|\| ''/);
  assert.match(commit, /hnSession\.currentEnvelope\(\)/);
  assert.match(commit, /if \(invalidateLinkedPages\) canonicalPages\.delete\(targetPageId\)/);

  const renderPage = sliceBetween(app, 'function renderPage(runtime, page,', '\nfunction setEditMenuOpen');
  assert.match(renderPage, /runtime\.currentPage = installCanonical[^]*?commitCanonicalPage\(page, \{ originRuntime: runtime \}\)[^]*?page = runtime\.currentPage;/);
  assert.ok(renderPage.indexOf('page = runtime.currentPage;')
    < renderPage.indexOf('renderPageContent(runtime, page'));
});

test('main batch adoption preserves clean newer bodies and commits revision despite presentation failure', async () => {
  const app = read('public/app.js');
  const modal = read('public/js/descriptorModal.js');
  const source = sliceBetween(
    app,
    'function structuredTextFrameOnlyPageChange',
    '\nfunction highlightBlockIds'
  );
  const modalReconcileSource = sliceBetween(
    modal,
    'const DICTIONARY_REMAP_HISTORY_LIMIT',
    '\nfunction receiveDictionaryEvent'
  );
  const markdown = {
    id: 'markdown',
    type: 'markdown',
    title: 'Markdown',
    markdownBody: 'live draft',
    blocks: [{ id: 'block_a', links: [{ id: 'link_a', targetType: 'page', targetPageId: 'target' }] }],
    highlightGroups: []
  };
  const target = { id: 'target', type: 'canvas', title: 'Old target', blocks: [], highlightGroups: [] };
  const cne = { id: 'cne', type: 'cne-text', title: 'HN', cneText: { revision: 1 }, blocks: [], highlightGroups: [] };
  const deleted = { id: 'deleted', type: 'canvas', title: 'Deleted', blocks: [], highlightGroups: [] };
  const pane = {
    id: 'pane_a',
    session: { activeTab: () => ({ currentPageId: 'markdown' }) },
    viewContext: {
      paneId: 'pane_a',
      currentPage: markdown,
      currentPageEntry: null,
      dom: {}
    }
  };
  pane.viewContext.session = pane.session;
  const presentationWarnings = [];
  const discardedPageIds = [];
  const lifecycleEvents = [];
  const lifecycleOrder = [];
  const context = {
    canonicalPages: new Map(markdown.id ? [
      [markdown.id, markdown], [target.id, target], [cne.id, cne], [deleted.id, deleted]
    ] : []),
    markdownBodySaveStates: new Map(),
    hnPageDocumentSessionRegistry: {
      get: (pageId) => pageId === 'cne'
        ? { currentEnvelope: () => ({ revision: 9, text: 'live HN draft' }) }
        : null
    },
    workspace: { state: { activePaneId: 'pane_a', panes: [pane] } },
    pageIndex: null,
    descriptorLibrary: null,
    vocabularyLibrary: null,
    descriptorGroupsConfig: null,
    pageMetaModal: null,
    originalDescriptorGroupsConfig: null,
    staleIgnoredDescriptorKeys: null,
    descriptorDraft: null,
    ignoredDescriptorDraft: null,
    ignoredManualEntryIdsDraft: null,
    descriptorDraftDirty: false,
    descriptorGroupRename: null,
    descriptorGroupsModel: require('../public/descriptorGroups'),
    undoManager: require('../public/undoManager').createUndoManager(),
    descriptorChipKey: (chip) => chip.entryId || chip.vocabularyEntryId || chip.display,
    markdownPageModel: {
      PAGE_TYPES: { MARKDOWN: 'markdown' },
      normalizePageType: (type) => type
    },
    pageTypesModel: { pageTypeSupports: () => false },
    pageIsHnText: (page) => page?.type === 'cne-text',
    renderTabStrip() { throw new Error('injected render failure'); },
    livingPaneRuntimes: () => [pane.viewContext],
    activePaneRuntime: () => pane.viewContext,
    getWorkspacePane: (paneId) => paneId === pane.id ? pane : null,
    updateStructuredTextPageLayerForRuntime: () => true,
    setPaneInfoPanelsAvailable() {},
    updatePaneToolbarPresentation() {},
    refreshActivePaneWindowChrome() {},
    renderInfoPanelsForPage() {},
    pruneInfoPanelsForDeletedOwner() {},
    renderDescriptorSearchPanel() {},
    renderPageList() {},
    renderRelations() {},
    discardPagePersistenceState(pageId) {
      discardedPageIds.push(pageId);
      lifecycleOrder.push(`discard:${pageId}`);
      context.canonicalPages.delete(pageId);
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    dispatchEvent(event) {
      lifecycleEvents.push({
        type: event.type,
        detail: event.detail,
        canonicalPagePresent: context.canonicalPages.has(event.detail.pageId)
      });
      lifecycleOrder.push(`event:${event.detail.pageId}`);
      return true;
    },
    console: { warn: (...args) => presentationWarnings.push(args) },
    JSON,
    Date,
    Number,
    Map,
    Set
  };
  vm.runInNewContext(`${modalReconcileSource}\n${source}\nglobalThis.metadataBatchTestApi = {
    apply: applyDescriptorMetadataChangeSet,
    page: (pageId) => canonicalPages.get(pageId),
    current: () => activePaneRuntime()?.currentPage,
    vocabulary: () => vocabularyLibrary,
    groups: () => descriptorGroupsConfig,
    draft: () => descriptorDraft,
    ignored: () => ignoredDescriptorDraft,
    ignoredManual: () => ignoredManualEntryIdsDraft
  };`, context);

  context.pageIndex = {
    metadataRevision: 1,
    pages: [markdown, target, cne, deleted].map((page) => ({ id: page.id, title: page.title }))
  };
  const installer = model.createRevisionInstaller({
    apply: context.metadataBatchTestApi.apply,
    initialRevision: 1
  });
  const installation = await installer.install(changeSet(2, {
    changedPageIds: ['markdown', 'target', 'cne'],
    deletedPageIds: ['deleted'],
    changedDomains: ['descriptors', 'relations'],
    pageIndex: {
      metadataRevision: 2,
      pages: [
        { id: 'markdown', title: 'Markdown' },
        { id: 'target', title: 'New target' },
        { id: 'cne', title: 'HN' }
      ]
    },
    descriptorRegistry: { metadataRevision: 2, entries: [] },
    pages: [
      { ...markdown, markdownBody: 'server body', blocks: [] },
      { ...target, title: 'New target' },
      { ...cne, cneText: { revision: 2, text: 'server HN' } }
    ]
  }), { render: false });

  assert.equal(installation.applied, true);
  assert.equal(installer.currentRevision(), 2);
  assert.equal(presentationWarnings.length, 3);
  assert.equal(context.metadataBatchTestApi.page('markdown').markdownBody, 'live draft');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.metadataBatchTestApi.page('cne').cneText)),
    { revision: 9, text: 'live HN draft' }
  );
  assert.equal(context.metadataBatchTestApi.page('target').title, 'Old target');
  assert.equal(context.metadataBatchTestApi.page('deleted'), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(lifecycleEvents[0])), {
    type: 'canonical-page-deleted',
    detail: {
      pageId: 'deleted',
      source: 'descriptor-metadata',
      deliverySource: null,
      metadataRevision: 2
    },
    canonicalPagePresent: false
  });
  assert.ok(lifecycleOrder.indexOf('discard:deleted') < lifecycleOrder.indexOf('event:deleted'));
  assert.equal(context.metadataBatchTestApi.current().markdownBody, 'live draft');
  assert.equal(pane.viewContext.currentPage.markdownBody, 'live draft');

  const missedRevision = changeSet(3, {
    changedPageIds: ['target'],
    changedDomains: ['descriptors'],
    pages: [{
      ...target,
      descriptors: { class_1: [{ entryId: 'descriptor_from_r3' }] },
      updatedAt: '2026-09-14T12:03:00.000Z'
    }],
    pageIndex: {
      metadataRevision: 3,
      pages: [
        { id: 'markdown', title: 'Markdown' },
        { id: 'target', title: 'Old target', descriptors: { class_1: [{ entryId: 'descriptor_from_r3' }] } },
        { id: 'cne', title: 'HN' }
      ]
    }
  });
  const cumulativeRevision = changeSet(4, {
    changedPageIds: ['markdown'],
    changedDomains: ['descriptors'],
    pages: [{
      ...markdown,
      markdownBody: 'stale R4 body',
      descriptors: { class_1: [{ entryId: 'descriptor_from_r4' }] },
      updatedAt: '2026-09-14T12:04:00.000Z'
    }],
    pageMetadataProjection: {
      metadataRevision: 4,
      pages: [
        projectedPage('markdown', { class_1: [{ entryId: 'descriptor_from_r4' }] }, '2026-09-14T12:04:00.000Z'),
        projectedPage('target', { class_1: [{ entryId: 'descriptor_from_r3' }] }, '2026-09-14T12:03:00.000Z'),
        projectedPage('cne')
      ]
    },
    pageIndex: {
      metadataRevision: 4,
      pages: [
        { id: 'markdown', title: 'Markdown', descriptors: { class_1: [{ entryId: 'descriptor_from_r4' }] } },
        { id: 'target', title: 'Old target', descriptors: { class_1: [{ entryId: 'descriptor_from_r3' }] } },
        { id: 'cne', title: 'HN', descriptors: {} }
      ]
    },
    descriptorRegistry: {
      metadataRevision: 4,
      entries: [{ id: 'descriptor_from_r3' }, { id: 'descriptor_from_r4' }]
    },
    vocabulary: { version: 1, entries: [{ id: 'vocabulary_r4', display: 'R4' }] },
    descriptorGroups: {
      version: 1,
      groups: { group_r4: { id: 'group_r4', name: 'R4' } },
      descriptorParentByEntryId: {}
    }
  });
  const r4 = await installer.install(cumulativeRevision, {
    source: 'first-sender',
    render: false
  });
  const lateR3 = await installer.install(missedRevision, {
    source: 'second-sender',
    render: false
  });
  assert.equal(r4.applied, true);
  assert.equal(lateR3.stale, true);
  assert.equal(installer.currentRevision(), 4);
  assert.equal(
    context.metadataBatchTestApi.page('target').descriptors.class_1[0].entryId,
    'descriptor_from_r3'
  );
  assert.equal(
    context.metadataBatchTestApi.page('markdown').descriptors.class_1[0].entryId,
    'descriptor_from_r4'
  );
  assert.equal(context.metadataBatchTestApi.page('markdown').markdownBody, 'live draft');
  assert.equal(context.metadataBatchTestApi.vocabulary().entries[0].id, 'vocabulary_r4');
  assert.ok(context.metadataBatchTestApi.groups().groups.group_r4);

  const missedDeletion = changeSet(5, {
    changedPageIds: ['cne'],
    deletedPageIds: ['cne'],
    changedDomains: ['pages'],
    pages: [],
    pageIndex: {
      metadataRevision: 5,
      pages: [
        { id: 'markdown', title: 'Markdown' },
        { id: 'target', title: 'Old target' }
      ]
    }
  });
  const afterMissedDeletion = changeSet(6, {
    changedPageIds: ['markdown'],
    changedDomains: ['descriptors'],
    pages: [{
      ...markdown,
      descriptors: { class_1: [{ entryId: 'descriptor_from_r6' }] },
      updatedAt: '2026-09-14T12:06:00.000Z'
    }],
    pageIndex: {
      metadataRevision: 6,
      pages: [
        { id: 'markdown', title: 'Markdown', descriptors: { class_1: [{ entryId: 'descriptor_from_r6' }] } },
        { id: 'target', title: 'Old target', descriptors: { class_1: [{ entryId: 'descriptor_from_r3' }] } }
      ]
    },
    descriptorRegistry: {
      metadataRevision: 6,
      entries: [{ id: 'descriptor_from_r3' }, { id: 'descriptor_from_r6' }]
    },
    vocabulary: { version: 1, entries: [{ id: 'vocabulary_r6', display: 'R6' }] },
    descriptorGroups: {
      version: 1,
      groups: { group_r6: { id: 'group_r6', name: 'R6' } },
      descriptorParentByEntryId: {}
    }
  });
  assert.equal((await installer.install(afterMissedDeletion, {
    source: 'first-sender',
    render: false
  })).applied, true);
  assert.equal((await installer.install(afterMissedDeletion, {
    source: 'duplicate-sender',
    render: false
  })).idempotent, true);
  assert.equal((await installer.install(missedDeletion, {
    source: 'second-sender',
    render: false
  })).stale, true);
  assert.equal(context.metadataBatchTestApi.page('cne'), undefined);
  assert.ok(discardedPageIds.includes('cne'));
  assert.equal(lifecycleEvents.filter((event) => event.detail.pageId === 'cne').length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      lifecycleEvents.find((event) => event.detail.pageId === 'cne').detail
    )),
    {
      pageId: 'cne',
      source: 'descriptor-metadata',
      deliverySource: 'first-sender',
      metadataRevision: 6
    }
  );
  assert.ok(lifecycleOrder.indexOf('discard:cne') < lifecycleOrder.indexOf('event:cne'));
  assert.equal(context.metadataBatchTestApi.vocabulary().entries[0].id, 'vocabulary_r6');
  assert.ok(context.metadataBatchTestApi.groups().groups.group_r6);

  const recoveredSnapshot = snapshot(8, {
    pageMetadataProjection: {
      metadataRevision: 8,
      pages: [
        projectedPage('markdown', { class_1: [{ entryId: 'descriptor_from_r6' }] }, '2026-09-14T12:06:00.000Z'),
        projectedPage('target', { class_1: [{ entryId: 'descriptor_from_r8' }] }, '2026-09-14T12:08:00.000Z')
      ]
    },
    pageIndex: {
      metadataRevision: 8,
      pages: [
        { id: 'markdown', title: 'Markdown', descriptors: { class_1: [{ entryId: 'descriptor_from_r6' }] } },
        { id: 'target', title: 'Old target', descriptors: { class_1: [{ entryId: 'descriptor_from_r8' }] } }
      ]
    },
    descriptorRegistry: {
      metadataRevision: 8,
      entries: [{ id: 'descriptor_from_r6' }, { id: 'descriptor_from_r8' }]
    },
    vocabulary: { version: 1, entries: [{ id: 'vocabulary_r8', display: 'R8' }] },
    descriptorGroups: {
      version: 1,
      groups: { group_r8: { id: 'group_r8', name: 'R8' } },
      descriptorParentByEntryId: {}
    }
  });
  assert.equal((await installer.install(recoveredSnapshot, {
    source: 'page-index-revision-recovery',
    render: false
  })).applied, true);
  assert.equal(
    context.metadataBatchTestApi.page('target').descriptors.class_1[0].entryId,
    'descriptor_from_r8'
  );
  assert.equal(context.metadataBatchTestApi.vocabulary().entries[0].id, 'vocabulary_r8');
  assert.ok(context.metadataBatchTestApi.groups().groups.group_r8);

  context.descriptorLibrary = {
    metadataRevision: 8,
    entries: [{ id: 'descriptor_a', vocabularyEntryId: 'vocabulary_a', display: 'A' }]
  };
  context.vocabularyLibrary = {
    version: 1,
    entries: [{ id: 'vocabulary_a', display: 'A' }]
  };
  context.descriptorDraft = {
    class_1: [{ entryId: 'descriptor_a', display: 'A', source: 'manual' }]
  };
  context.ignoredDescriptorDraft = {
    class_1: [{ entryId: 'descriptor_a', display: 'A' }]
  };
  context.ignoredManualEntryIdsDraft = { class_1: ['descriptor_a'] };
  context.descriptorDraftDirty = true;
  context.pageMetaModal = { type: 'descriptor' };
  context.originalDescriptorGroupsConfig = {
    version: 1,
    groups: { group_a: { id: 'group_a', name: 'Committed', parentId: null } },
    descriptorParentByEntryId: { vocabulary_a: 'group_a' }
  };
  context.descriptorGroupsConfig = {
    version: 1,
    groups: { group_a: { id: 'group_a', name: 'Unsaved rename', parentId: null } },
    descriptorParentByEntryId: { vocabulary_a: 'group_a' }
  };
  context.undoManager.beginContext({
    id: 'descriptor-edit:markdown',
    type: 'descriptor-edit',
    ownerId: 'markdown'
  });
  context.undoManager.record({ undo() {}, redo() {} });
  const inOrderDictionaryMove = changeSet(9, {
    changedPageIds: ['target'],
    changedDomains: ['descriptors', 'vocabulary', 'descriptor-groups'],
    pages: [{ ...target, descriptors: { class_1: [{ entryId: 'descriptor_b' }] } }],
    pageIndex: {
      metadataRevision: 9,
      pages: [
        { id: 'markdown', title: 'Markdown' },
        { id: 'target', title: 'Old target', descriptors: { class_1: [{ entryId: 'descriptor_b' }] } }
      ]
    },
    descriptorRegistry: {
      metadataRevision: 9,
      entries: [{ id: 'descriptor_b', vocabularyEntryId: 'vocabulary_b', display: 'B' }]
    },
    vocabulary: { version: 1, entries: [{ id: 'vocabulary_b', display: 'B' }] },
    descriptorGroups: {
      version: 1,
      groups: { group_a: { id: 'group_a', name: 'Committed upstream', parentId: null } },
      descriptorParentByEntryId: { vocabulary_b: 'group_a' }
    }
  });
  assert.equal((await installer.install(inOrderDictionaryMove, {
    source: 'dictionary-event',
    event: {
      type: 'dictionary-data-changed',
      operation: 'move-display',
      descriptorIdRemap: { descriptor_a: 'descriptor_b' },
      vocabularyEntryIdRemap: { vocabulary_a: 'vocabulary_b' }
    },
    render: false
  })).applied, true);
  assert.equal(context.metadataBatchTestApi.draft().class_1[0].entryId, 'descriptor_b');
  assert.equal(context.metadataBatchTestApi.ignored().class_1[0].entryId, 'descriptor_b');
  assert.equal(context.metadataBatchTestApi.ignoredManual().class_1[0], 'descriptor_b');
  assert.equal(
    context.metadataBatchTestApi.groups().descriptorParentByEntryId.vocabulary_b,
    'group_a'
  );
  assert.equal(context.metadataBatchTestApi.groups().groups.group_a.name, 'Unsaved rename');
  assert.equal(context.undoManager.canUndo(), false);
});

test('live metadata merge owns only Descriptor fields, discovers membership, and keeps modified time monotonic', () => {
  const app = read('public/app.js');
  const source = sliceBetween(
    app,
    'function cloneDescriptorMetadataValue',
    '\nfunction descriptorGroupDraftIsDirty'
  );
  const localPage = {
    id: 'page_a',
    title: 'Newer local title',
    type: 'cne-text',
    code: 'local-code',
    categories: ['category_local'],
    categoryIds: ['category_local'],
    markdownBody: 'newer saved body',
    updatedAt: '2026-09-14T12:04:00.000Z',
    descriptors: { class_1: [{ entryId: 'descriptor_old' }] },
    descriptorIds: ['descriptor_old']
  };
  const deletedLocalRow = { id: 'page_deleted', title: 'Delete me', type: 'markdown' };
  const context = {
    pageIndex: {
      metadataRevision: 7,
      pages: [
        { ...localPage, markdownBody: undefined },
        deletedLocalRow
      ]
    },
    canonicalPages: new Map([['page_a', localPage]]),
    commitCanonicalPage(page) {
      context.canonicalPages.set(page.id, page);
      return page;
    },
    JSON,
    Date,
    Number,
    Map,
    Object
  };
  vm.runInNewContext(`${source}\nglobalThis.metadataOwnershipTest = {
    mergeIndex: pageIndexForDescriptorMetadataInstall,
    mergePage: pageForDescriptorMetadataInstall,
    adoptCategories: adoptCategoryCommandPages,
    index: () => pageIndex,
    page: (id) => canonicalPages.get(id)
  };`, context);

  const incomingExisting = {
    id: 'page_a',
    title: 'Older server title',
    type: 'markdown',
    code: 'older-code',
    categories: ['category_old'],
    categoryIds: ['category_old'],
    markdownBody: 'older server body',
    updatedAt: '2026-09-14T12:03:00.000Z',
    descriptors: { class_1: [{ entryId: 'descriptor_new' }] },
    descriptorIds: ['descriptor_new']
  };
  const incomingNew = {
    id: 'page_new',
    title: 'Discovered Page',
    type: 'markdown',
    categories: ['category_new'],
    updatedAt: '2026-09-14T12:05:00.000Z',
    descriptors: {}
  };
  const change = {
    snapshot: false,
    changedDomains: ['descriptors'],
    metadataRevision: 8
  };
  const mergedIndex = context.metadataOwnershipTest.mergeIndex({
    metadataRevision: 8,
    pages: [incomingExisting, incomingNew]
  }, change, { source: 'dictionary-event' });
  assert.deepEqual(mergedIndex.pages.map((page) => page.id), ['page_a', 'page_new']);
  assert.equal(mergedIndex.pages[0].title, 'Newer local title');
  assert.equal(mergedIndex.pages[0].type, 'cne-text');
  assert.deepEqual(mergedIndex.pages[0].categories, ['category_local']);
  assert.equal(mergedIndex.pages[0].updatedAt, '2026-09-14T12:04:00.000Z');
  assert.deepEqual(mergedIndex.pages[0].descriptorIds, ['descriptor_new']);
  assert.equal(mergedIndex.pages[1].title, 'Discovered Page');
  assert.equal(mergedIndex.pages.some((page) => page.id === 'page_deleted'), false);

  const authoritativeProjection = projectedPage(
    'page_a',
    { class_1: [{ entryId: 'descriptor_projection' }] },
    '2026-09-14T12:03:30.000Z',
    {
      ignoredDescriptors: { class_1: [{ entryId: 'ignored_projection' }] },
      ignoredManualEntryIds: { class_1: ['ignored_projection'] }
    }
  );
  const mergedPage = context.metadataOwnershipTest.mergePage(
    incomingExisting,
    authoritativeProjection
  );
  assert.equal(mergedPage.title, 'Newer local title');
  assert.equal(mergedPage.type, 'cne-text');
  assert.equal(mergedPage.markdownBody, 'newer saved body');
  assert.deepEqual(mergedPage.categories, ['category_local']);
  assert.equal(mergedPage.updatedAt, '2026-09-14T12:04:00.000Z');
  assert.equal(mergedPage.descriptors.class_1[0].entryId, 'descriptor_projection');
  assert.equal(mergedPage.ignoredDescriptors.class_1[0].entryId, 'ignored_projection');
  assert.equal(mergedPage.ignoredManualEntryIds.class_1[0], 'ignored_projection');

  const incomingWithoutDescriptorFields = { ...incomingExisting };
  delete incomingWithoutDescriptorFields.descriptors;
  const newerDescriptorPage = context.metadataOwnershipTest.mergePage(
    incomingWithoutDescriptorFields,
    projectedPage(
      'page_a',
      { class_1: [{ entryId: 'descriptor_projection_newer' }] },
      '2026-09-14T12:06:00.000Z'
    )
  );
  assert.equal(newerDescriptorPage.updatedAt, '2026-09-14T12:06:00.000Z');
  assert.equal(
    newerDescriptorPage.descriptors.class_1[0].entryId,
    'descriptor_projection_newer'
  );

  const discoveredPage = context.metadataOwnershipTest.mergePage(
    incomingNew,
    projectedPage('page_new', { class_1: [{ entryId: 'descriptor_discovered' }] })
  );
  assert.equal(discoveredPage.title, 'Discovered Page');
  assert.equal(discoveredPage.type, 'markdown');
  assert.equal(discoveredPage.descriptors.class_1[0].entryId, 'descriptor_discovered');
});

test('single and batch Category commands adopt only their own raw Category result', () => {
  const app = read('public/app.js');
  const modal = read('public/js/descriptorModal.js');
  const helper = sliceBetween(app, 'function adoptCategoryCommandPages', '\nfunction descriptorGroupDraftIsDirty');
  assert.match(helper, /merged\.categories = categories/);
  assert.match(helper, /merged\.categoryIds = categories\.map/);
  assert.match(helper, /preserveDocumentBody: true/);
  assert.doesNotMatch(
    sliceBetween(app, 'function pageIndexForDescriptorMetadataInstall', '\nfunction adoptCategoryCommandPages'),
    /categories|categoryIds/
  );
  assert.match(modal, /adoptCategoryCommandPages\(result\.pages \|\| \[\], \{\s*originRuntime: operationIsCurrent \? runtime : null\s*\}\)/);
  assert.match(modal, /adoptCategoryCommandPages\(\[savedPageResponse\], \{\s*originRuntime: operationIsCurrent \? runtime : null\s*\}\)/);

  const context = {
    pageIndex: {
      metadataRevision: 9,
      pages: [
        { id: 'page_a', title: 'Local title A', categories: ['old_a'], updatedAt: '2026-09-14T12:04:00.000Z' },
        { id: 'page_b', title: 'Local title B', categories: ['old_b'], updatedAt: '2026-09-14T12:04:00.000Z' }
      ]
    },
    canonicalPages: new Map([
      ['page_a', { id: 'page_a', title: 'Local title A', markdownBody: 'body A', categories: ['old_a'], updatedAt: '2026-09-14T12:04:00.000Z' }],
      ['page_b', { id: 'page_b', title: 'Local title B', markdownBody: 'body B', categories: ['old_b'], updatedAt: '2026-09-14T12:04:00.000Z' }]
    ]),
    cloneDescriptorMetadataValue: (value) => value == null ? value : JSON.parse(JSON.stringify(value)),
    monotonicPageUpdatedAt: (existingValue, incomingValue) => {
      const existingTime = Date.parse(existingValue || '');
      const incomingTime = Date.parse(incomingValue || '');
      return Number.isFinite(incomingTime) && incomingTime > existingTime
        ? incomingValue
        : existingValue;
    },
    commitCanonicalPage(page) {
      context.canonicalPages.set(page.id, page);
      return page;
    },
    JSON,
    Date,
    Number,
    Map,
    Object
  };
  vm.runInNewContext(`${helper}\nglobalThis.categoryCommandTest = {
    adopt: adoptCategoryCommandPages,
    index: () => pageIndex,
    page: (id) => canonicalPages.get(id)
  };`, context);
  const adopted = context.categoryCommandTest.adopt([
    { id: 'page_a', title: 'Stale title A', markdownBody: 'stale body A', categories: ['new_a'], updatedAt: '2026-09-14T12:05:00.000Z' },
    { id: 'page_b', title: 'Stale title B', markdownBody: 'stale body B', categories: ['new_b'], updatedAt: '2026-09-14T12:03:00.000Z' }
  ]);
  assert.equal(adopted.length, 2);
  assert.equal(context.categoryCommandTest.page('page_a').title, 'Local title A');
  assert.equal(context.categoryCommandTest.page('page_a').markdownBody, 'body A');
  assert.deepEqual(context.categoryCommandTest.page('page_a').categories, ['new_a']);
  assert.equal(Object.hasOwn(context.categoryCommandTest.page('page_a'), 'categoryIds'), false);
  assert.equal(context.categoryCommandTest.page('page_a').updatedAt, '2026-09-14T12:05:00.000Z');
  assert.deepEqual(context.categoryCommandTest.page('page_b').categories, ['new_b']);
  assert.equal(context.categoryCommandTest.page('page_b').updatedAt, '2026-09-14T12:04:00.000Z');
  assert.equal(context.categoryCommandTest.index().pages[0].title, 'Local title A');
  assert.deepEqual(context.categoryCommandTest.index().pages[0].categories, ['new_a']);
  assert.deepEqual(context.categoryCommandTest.index().pages[0].categoryIds, ['new_a']);
  assert.deepEqual(context.categoryCommandTest.index().pages[1].categories, ['new_b']);
  assert.deepEqual(context.categoryCommandTest.index().pages[1].categoryIds, ['new_b']);
});

test('Descriptor Save sends Page metadata and changed groups as one Page command', () => {
  const modal = read('public/js/descriptorModal.js');
  const save = sliceBetween(modal, 'async function savePageMetaModal()', '\nfunction openPageMetaModal');
  const descriptorBranch = save.slice(0, save.indexOf("if (modalOwner.type !== 'category')"));
  assert.equal((descriptorBranch.match(/request\(pageApiUrl\(pageId\)/g) || []).length, 1);
  assert.match(descriptorBranch, /descriptors: descriptorDraft/);
  assert.match(descriptorBranch, /ignoredDescriptors: ignoredDescriptorDraft/);
  assert.match(descriptorBranch, /ignoredManualEntryIds: ignoredManualEntryIdsDraft/);
  assert.match(descriptorBranch, /descriptorGroupsChanged \? \{ descriptorGroups: descriptorGroupsConfig \}/);
  assert.doesNotMatch(descriptorBranch, /\/api\/(?:descriptor-groups|descriptors|vocabulary|page-index)/);
  assert.doesNotMatch(modal, /function saveDescriptorGroupsConfig/);
});

test('Dictionary mutations and events carry self-contained revisioned change sets', () => {
  const vocabulary = read('public/vocabulary.js');
  assert.match(vocabulary, /request\('\/api\/descriptor-metadata\/snapshot'\)/);
  assert.match(vocabulary, /metadataChangeSet: change\.metadataChangeSet \|\| null/);
  assert.match(vocabulary, /metadataChangeSet: result\.metadataChangeSet/);
  assert.match(vocabulary, /metadataChangeSet: moved\.metadataChangeSet/);
  assert.match(vocabulary, /metadataChangeSet: deleted\.metadataChangeSet/);
  assert.doesNotMatch(
    sliceBetween(vocabulary, 'async function deleteDisplayWord()', '\nasync function deleteContextVocabularyItem'),
    /request\('\/api\/descriptors'\)/
  );

  const dictionaryReceiver = sliceBetween(
    vocabulary,
    'function receiveDictionaryDataChanged',
    '\nconst initialDictionaryCommandText'
  );
  assert.match(dictionaryReceiver, /descriptorMetadataInstaller\.install\(event\.metadataChangeSet/);
  assert.match(dictionaryReceiver, /if \(result\.applied && libraryReady\) render\(\)/);
  assert.match(dictionaryReceiver, /window\.addEventListener\('message'/);

  const modal = read('public/js/descriptorModal.js');
  const receiver = sliceBetween(modal, 'async function applyDictionaryDataChanged', '\ndictionaryChannel?.addEventListener');
  assert.match(receiver, /installDescriptorMetadataChangeSet\(event\.metadataChangeSet/);
  for (const endpoint of ['/api/vocabulary', '/api/descriptors', '/api/descriptor-groups', '/api/page-index']) {
    assert.doesNotMatch(receiver, new RegExp(endpoint.replaceAll('/', '\\/')));
  }

  const app = read('public/app.js');
  const apply = sliceBetween(app, 'function applyDescriptorMetadataChangeSet', '\nfunction commitCanonicalPage');
  assert.match(apply, /context\.source === 'dictionary-event'[\s\S]*?dictionaryEventWithRecordedRemaps\(rawPresentationEvent\)/);
  assert.match(apply, /reconcileDescriptorModalDraftsFromDictionaryEvent\(presentationEvent\)/);
  const staleReceiver = sliceBetween(
    modal,
    'async function applyDictionaryDataChanged',
    '\nfunction receiveDictionaryEvent'
  );
  assert.match(staleReceiver, /if \(result\.stale\)/);
  assert.doesNotMatch(staleReceiver, /result\.idempotent/);
  assert.match(staleReceiver, /dictionaryEventWithRecordedRemaps\(event\)/);
  assert.match(staleReceiver, /reconcileDescriptorModalDraftsFromDictionaryEvent\(reconciledEvent\)/);
});

test('a stale R+1 Dictionary remap composes with accepted R+2 without ghost IDs', async () => {
  const modal = read('public/js/descriptorModal.js');
  const source = sliceBetween(
    modal,
    'const DICTIONARY_REMAP_HISTORY_LIMIT',
    '\nfunction receiveDictionaryEvent'
  );
  const undo = require('../public/undoManager').createUndoManager();
  undo.beginContext({ id: 'descriptor-edit:page_a', type: 'descriptor-edit', ownerId: 'page_a' });
  let staleSnapshotRestored = false;
  undo.record({
    undo: () => { staleSnapshotRestored = true; },
    redo: () => { staleSnapshotRestored = true; }
  });
  const context = {
    descriptorDraft: {
      class_1: [{ entryId: 'descriptor_a', display: 'A', source: 'manual' }]
    },
    ignoredDescriptorDraft: { class_1: [{ entryId: 'descriptor_a', display: 'A' }] },
    ignoredManualEntryIdsDraft: { class_1: ['descriptor_a'] },
    descriptorLibrary: {
      entries: [
        { id: 'descriptor_c', vocabularyEntryId: 'vocabulary_c', display: 'C' },
        { id: 'descriptor_keep', vocabularyEntryId: 'vocabulary_keep', display: 'Keep' }
      ]
    },
    vocabularyLibrary: {
      entries: [
        { id: 'vocabulary_c', display: 'C' },
        { id: 'vocabulary_keep', display: 'Keep' }
      ]
    },
    descriptorGroupsConfig: {
      version: 1,
      groups: {
        group_a: {
          id: 'group_a', name: 'Unsaved local rename', parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
        },
        group_keep: {
          id: 'group_keep', name: 'Keep', parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
        }
      },
      descriptorParentByEntryId: {
        vocabulary_a: 'group_a',
        descriptor_a: 'group_a',
        vocabulary_keep: 'group_keep',
        deleted_ghost: 'group_keep'
      }
    },
    pageMetaModal: { type: 'descriptor' },
    descriptorGroupRename: { beforeSnapshot: { groups: { stale: true } } },
    descriptorGroupsModel: require('../public/descriptorGroups'),
    undoManager: undo,
    descriptorChipKey: (chip) => chip.entryId || chip.vocabularyEntryId || chip.display,
    cloneDescriptorUndoSnapshot: () => ({
      groups: JSON.parse(JSON.stringify(context.descriptorGroupsConfig)),
      descriptors: JSON.parse(JSON.stringify(context.descriptorDraft))
    }),
    installResults: [
      { applied: false, stale: true, revision: 2 },
      { applied: false, idempotent: true, revision: 2 }
    ],
    installDescriptorMetadataChangeSet: async () => context.installResults.shift(),
    runDescriptorMetadataPresentation: (callback) => callback(),
    rerenderDescriptorEditor: () => { context.rerenderCount += 1; },
    rerenderCount: 0,
    JSON,
    Map,
    Set,
    Object
  };
  vm.runInNewContext(`${source}\nglobalThis.rebaseDraftTest = async (event) => {
    const applied = await applyDictionaryDataChanged(event);
    return {
      applied,
      descriptors: descriptorDraft,
      ignored: ignoredDescriptorDraft,
      ignoredManual: ignoredManualEntryIdsDraft,
      groups: descriptorGroupsConfig,
      renameBefore: descriptorGroupRename.beforeSnapshot
    };
  };
  globalThis.applyAcceptedDictionaryRemapTest = (event) => {
    const reconciledEvent = dictionaryEventWithRecordedRemaps(event);
    reconcileDescriptorModalDraftsFromDictionaryEvent(reconciledEvent);
    return {
      descriptors: descriptorDraft,
      ignored: ignoredDescriptorDraft,
      ignoredManual: ignoredManualEntryIdsDraft,
      groups: descriptorGroupsConfig,
      descriptorHistory: dictionaryRemapHistoryRecord(descriptorDictionaryRemapHistory),
      vocabularyHistory: dictionaryRemapHistoryRecord(vocabularyDictionaryRemapHistory)
    };
  };`, context);

  const afterAcceptedR2 = context.applyAcceptedDictionaryRemapTest({
    type: 'dictionary-data-changed',
    eventId: 'dictionary_r2_first',
    operation: 'move-display',
    descriptorEntryIds: ['descriptor_b'],
    vocabularyEntryIds: ['vocabulary_b'],
    descriptorIdRemap: { descriptor_b: 'descriptor_c' },
    vocabularyEntryIdRemap: { vocabulary_b: 'vocabulary_c' },
    metadataChangeSet: changeSet(2)
  });
  assert.equal(afterAcceptedR2.descriptors.class_1[0].entryId, 'descriptor_a');
  assert.equal(afterAcceptedR2.ignored.class_1[0].entryId, 'descriptor_a');
  assert.equal(afterAcceptedR2.ignoredManual.class_1[0], 'descriptor_a');
  assert.equal(afterAcceptedR2.groups.descriptorParentByEntryId.descriptor_a, 'group_a');
  assert.equal(afterAcceptedR2.descriptorHistory.descriptor_b, 'descriptor_c');
  assert.equal(afterAcceptedR2.vocabularyHistory.vocabulary_b, 'vocabulary_c');

  undo.record({
    undo: () => { staleSnapshotRestored = true; },
    redo: () => { staleSnapshotRestored = true; }
  });

  const savePayload = await context.rebaseDraftTest({
    type: 'dictionary-data-changed',
    eventId: 'dictionary_r1_after_r2',
    operation: 'move-display',
    descriptorEntryIds: ['descriptor_a', 'deleted_ghost'],
    vocabularyEntryIds: ['vocabulary_a'],
    descriptorIdRemap: { descriptor_a: 'descriptor_b' },
    vocabularyEntryIdRemap: { vocabulary_a: 'vocabulary_b' },
    metadataChangeSet: changeSet(1)
  });
  assert.equal(savePayload.applied, false);
  const serialized = JSON.stringify(savePayload);
  assert.doesNotMatch(serialized, /descriptor_a|descriptor_b|vocabulary_a|vocabulary_b|deleted_ghost/);
  assert.match(serialized, /descriptor_c/);
  assert.equal(savePayload.groups.groups.group_a.name, 'Unsaved local rename');
  assert.equal(savePayload.groups.descriptorParentByEntryId.vocabulary_c, 'group_a');
  assert.equal(savePayload.groups.descriptorParentByEntryId.vocabulary_keep, 'group_keep');
  assert.equal(savePayload.descriptors.class_1[0].entryId, 'descriptor_c');
  assert.equal(savePayload.ignored.class_1[0].entryId, 'descriptor_c');
  assert.equal(savePayload.ignoredManual.class_1[0], 'descriptor_c');
  assert.equal(undo.canUndo(), false);
  assert.equal(undo.undo(), false);
  assert.equal(undo.redo(), false);
  assert.equal(staleSnapshotRestored, false);
  assert.doesNotMatch(
    JSON.stringify(savePayload.renameBefore),
    /descriptor_a|descriptor_b|vocabulary_a|vocabulary_b/
  );
  assert.equal(context.rerenderCount, 1);

  let equalRevisionUndoRan = false;
  undo.record({
    undo: () => { equalRevisionUndoRan = true; },
    redo: () => { equalRevisionUndoRan = true; }
  });
  const equalDelivery = await context.rebaseDraftTest({
    type: 'dictionary-data-changed',
    eventId: 'different_event_same_r2',
    operation: 'move-display',
    descriptorIdRemap: { descriptor_c: 'descriptor_keep' },
    vocabularyEntryIdRemap: { vocabulary_c: 'vocabulary_keep' },
    metadataChangeSet: changeSet(2)
  });
  assert.equal(equalDelivery.applied, false);
  assert.equal(equalDelivery.descriptors.class_1[0].entryId, 'descriptor_c');
  assert.equal(context.rerenderCount, 1);
  assert.equal(undo.canUndo(), true);
  assert.equal(undo.undo(), true);
  assert.equal(equalRevisionUndoRan, true);

  const cycleGuard = context.applyAcceptedDictionaryRemapTest({
    type: 'dictionary-data-changed',
    eventId: 'cycle_guard',
    operation: 'move-display',
    descriptorIdRemap: { descriptor_c: 'descriptor_a' },
    vocabularyEntryIdRemap: { vocabulary_c: 'vocabulary_a' },
    metadataChangeSet: changeSet(3)
  });
  assert.equal(cycleGuard.descriptorHistory.descriptor_a, 'descriptor_c');
  assert.equal(cycleGuard.descriptorHistory.descriptor_b, 'descriptor_c');
  assert.equal(cycleGuard.descriptorHistory.descriptor_c, undefined);
  assert.equal(cycleGuard.vocabularyHistory.vocabulary_c, undefined);

  context.descriptorLibrary.entries.push({
    id: 'descriptor_a',
    vocabularyEntryId: 'vocabulary_a',
    display: 'Recreated A'
  });
  context.vocabularyLibrary.entries.push({ id: 'vocabulary_a', display: 'Recreated A' });
  context.descriptorDraft = {
    class_1: [{ entryId: 'descriptor_a', display: 'Recreated A', source: 'manual' }]
  };
  context.ignoredDescriptorDraft = {
    class_1: [{ entryId: 'descriptor_a', display: 'Recreated A' }]
  };
  context.ignoredManualEntryIdsDraft = { class_1: ['descriptor_a'] };
  context.descriptorGroupsConfig.descriptorParentByEntryId = {
    vocabulary_a: 'group_a',
    vocabulary_keep: 'group_keep'
  };
  const afterIdReuse = context.applyAcceptedDictionaryRemapTest({
    type: 'dictionary-data-changed',
    eventId: 'unrelated_after_id_reuse',
    operation: 'create-word',
    descriptorIdRemap: {},
    vocabularyEntryIdRemap: {},
    metadataChangeSet: changeSet(4)
  });
  assert.equal(afterIdReuse.descriptors.class_1[0].entryId, 'descriptor_a');
  assert.equal(afterIdReuse.ignored.class_1[0].entryId, 'descriptor_a');
  assert.equal(afterIdReuse.ignoredManual.class_1[0], 'descriptor_a');
  assert.equal(afterIdReuse.groups.descriptorParentByEntryId.vocabulary_a, 'group_a');
  assert.equal(afterIdReuse.descriptorHistory.descriptor_a, undefined);
  assert.equal(afterIdReuse.vocabularyHistory.vocabulary_a, undefined);
});

test('a main-window mutation publishes one self-contained revision for Dictionary adoption', async () => {
  const app = read('public/app.js');
  const publishSource = sliceBetween(
    app,
    'function publishDescriptorMetadataChangeSet',
    '\nasync function request'
  );
  let published = null;
  const context = {
    dictionaryChannel: { postMessage: (event) => { published = event; } },
    dictionaryWindow: null,
    window: { location: { origin: 'http://viewer.test' } },
    Date,
    Math
  };
  vm.runInNewContext(`${publishSource}\nglobalThis.publishTest = publishDescriptorMetadataChangeSet;`, context);

  const mainChangeSet = changeSet(4, {
    vocabulary: { version: 1, entries: [{ id: 'vocab_new', display: 'New word', aliases: [] }] },
    descriptorRegistry: {
      metadataRevision: 4,
      entries: [{ id: 'descriptor_new', display: 'New word' }]
    }
  });
  context.publishTest({
    operation: 'descriptor-save',
    descriptorEntryIds: ['descriptor_new'],
    vocabularyEntryIds: ['vocab_new'],
    metadataChangeSet: mainChangeSet
  });
  assert.equal(published.type, 'dictionary-data-changed');
  assert.equal(published.metadataChangeSet, mainChangeSet);

  let dictionaryVocabulary = null;
  let dictionaryRegistry = null;
  const dictionaryInstaller = model.createRevisionInstaller({
    apply: (installed) => {
      dictionaryVocabulary = installed.vocabulary || dictionaryVocabulary;
      dictionaryRegistry = installed.descriptorRegistry;
    }
  });
  await dictionaryInstaller.install(snapshot(3));
  const installed = await dictionaryInstaller.install(published.metadataChangeSet);
  assert.equal(installed.applied, true);
  assert.equal(dictionaryInstaller.currentRevision(), 4);
  assert.equal(dictionaryVocabulary.entries[0].id, 'vocab_new');
  assert.equal(dictionaryRegistry.entries[0].id, 'descriptor_new');
});

test('stale ignored-Descriptor evaluation is accepted only at the requested installed revision', () => {
  const modal = read('public/js/descriptorModal.js');
  const refresh = sliceBetween(modal, 'async function refreshStaleIgnoredDescriptors()', '\nfunction reconcileDescriptorDraftFromDictionaryEvent');
  assert.match(refresh, /const requestedRevision = currentDescriptorMetadataRevision\(\)/);
  assert.match(refresh, /evaluation\.metadataRevision !== requestedRevision/);
  assert.match(refresh, /currentDescriptorMetadataRevision\(\) !== requestedRevision/);
  assert.ok(refresh.indexOf('evaluation.metadataRevision !== requestedRevision')
    < refresh.indexOf('staleIgnoredDescriptorKeys ='));
});
