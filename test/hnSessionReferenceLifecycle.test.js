const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

async function loadReconciliationHarness({ panes, canonicalPages, pageIndex, registry }) {
  const app = await fs.readFile(path.join(projectRoot, 'public/app.js'), 'utf8');
  const start = app.indexOf('function desiredHnSessionReferences');
  const end = app.indexOf('function scheduleHnSessionReferenceReconcile', start);
  assert.notEqual(start, -1, 'desired reference collector must exist');
  assert.notEqual(end, -1, 'reconciliation source boundary must exist');
  const source = app.slice(start, end);
  const errors = [];
  const factory = new Function(
    'workspace',
    'canonicalPages',
    'pageIndex',
    'pageTypesModel',
    'hnTabReferenceId',
    'retainedHnSessionReferences',
    'hnPageDocumentSessionRegistry',
    'handleHnSessionError',
    `let hnSessionReconcileScheduled = true;\n${source}\nreturn {\n`
      + '  desiredHnSessionReferences,\n'
      + '  reconcileHnSessionReferences,\n'
      + '  reconciliationScheduled: () => hnSessionReconcileScheduled\n'
      + '};'
  );
  const retained = new Map();
  const api = factory(
    { state: { panes } },
    canonicalPages,
    pageIndex,
    {
      PAGE_TYPES: { HN_TEXT: 'cne-text' },
      normalizePageType: (value) => value
    },
    (paneId, tabId) => `${paneId}:${tabId}`,
    retained,
    registry,
    (error) => errors.push(error)
  );
  return { ...api, retained, errors };
}

function pane(id, tabs) {
  return { id, session: { tabs: () => tabs } };
}

test('reconciliation retains a dormant duplicate Tab before releasing the mounted Tab', async () => {
  const events = [];
  const references = new Set(['pane-a:tab-a']);
  let disposed = false;
  const session = {
    retain(referenceId) {
      events.push(`retain:${referenceId}`);
      references.add(referenceId);
    }
  };
  const registry = {
    get(pageId) {
      events.push(`get:${pageId}`);
      return pageId === 'cne-page' ? session : null;
    },
    async release(pageId, referenceId) {
      events.push(`release:${referenceId}`);
      references.delete(referenceId);
      if (!references.size) disposed = true;
      return disposed;
    }
  };
  const harness = await loadReconciliationHarness({
    panes: [pane('pane-a', [
      { id: 'tab-a', currentPageId: 'canvas-page', history: ['canvas-page'] },
      { id: 'tab-b', currentPageId: 'cne-page', history: ['cne-page'] }
    ])],
    canonicalPages: new Map([
      ['cne-page', { id: 'cne-page', type: 'cne-text' }],
      ['canvas-page', { id: 'canvas-page', type: 'canvas' }]
    ]),
    pageIndex: { pages: [] },
    registry
  });
  harness.retained.set('cne-page', new Set(['pane-a:tab-a']));

  await harness.reconcileHnSessionReferences();

  assert.equal(harness.reconciliationScheduled(), false);
  assert.deepEqual(events, [
    'get:cne-page',
    'retain:pane-a:tab-b',
    'release:pane-a:tab-a'
  ]);
  assert.deepEqual([...references], ['pane-a:tab-b']);
  assert.deepEqual([...harness.retained.get('cne-page')], ['pane-a:tab-b']);
  assert.equal(disposed, false, 'the shared history must survive for the dormant duplicate Tab');
  assert.deepEqual(harness.errors, []);
});

test('Back/Forward history retains a Page but index-only HN metadata cannot create its session', async () => {
  const events = [];
  const registry = {
    get(pageId) {
      events.push(`get:${pageId}`);
      return null;
    },
    async release() {
      throw new Error('nothing was retained');
    },
    acquire() {
      throw new Error('reconciliation must not acquire from Page-index metadata');
    }
  };
  const harness = await loadReconciliationHarness({
    panes: [pane('pane-a', [
      {
        id: 'tab-history',
        currentPageId: 'canvas-page',
        history: ['indexed-cne', 'canvas-page'],
        pageViewStates: { orphaned: {} }
      }
    ])],
    canonicalPages: new Map([
      ['canvas-page', { id: 'canvas-page', type: 'canvas' }]
    ]),
    pageIndex: {
      pages: [
        { id: 'indexed-cne', type: 'cne-text' },
        { id: 'canvas-page', type: 'canvas' }
      ]
    },
    registry
  });

  const desired = harness.desiredHnSessionReferences();
  assert.deepEqual([...desired.keys()], ['indexed-cne']);
  assert.deepEqual([...desired.get('indexed-cne')], ['pane-a:tab-history']);

  await harness.reconcileHnSessionReferences();

  assert.deepEqual(events, ['get:indexed-cne']);
  assert.equal(harness.retained.size, 0);
  assert.deepEqual(harness.errors, []);
});

test('the unified runtime-owned navigation commit schedules session-reference reconciliation', async () => {
  const app = await fs.readFile(path.join(projectRoot, 'public/app.js'), 'utf8');
  const start = app.indexOf('function commitPageHistoryOpen(runtime, pageId');
  const end = app.indexOf('async function completePageOpen', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const navigationCommit = app.slice(start, end);
  assert.match(
    navigationCommit,
    /runtime\.session\.navigateActive\(pageId,[^]*?scheduleHnSessionReferenceReconcile\(\)/
  );
  assert.doesNotMatch(navigationCommit, /getActivePane|renderPageIntoInactivePane/);
});
