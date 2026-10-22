const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createTabSession } = require('../public/sessionTabs');

const projectRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFile(path.join(projectRoot, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} source boundary must exist`);
  return source.slice(start, end);
}

test('one Tab keeps browser-style Page history branching and Page-local view state', () => {
  let nextId = 0;
  const session = createTabSession({ createId: () => `tab-${++nextId}` });
  const tab = session.reset('A');
  session.saveViewState(tab.id, {
    panX: 11,
    panY: 17,
    zoom: 1.8,
    viewportInitialized: true,
    markdownStructuralFolds: [
      { kind: 'heading', physicalLineId: 'a-heading', lineIndex: 1, depth: 1 }
    ]
  });
  session.navigateActive('B', { mode: 'push' });
  session.saveViewState(tab.id, {
    panX: 31,
    panY: 47,
    zoom: 2.4,
    viewportInitialized: true
  });
  session.navigateActive('C', { mode: 'push' });

  const backToB = session.historyTarget(-1, () => true);
  session.navigateActive(backToB.pageId, {
    mode: 'back-forward',
    historyIndex: backToB.index
  });
  assert.equal(tab.viewState.zoom, 2.4);
  assert.equal(tab.viewState.panX, 31);
  session.navigateActive('D', { mode: 'push' });

  assert.deepEqual(tab.history, ['A', 'B', 'D']);
  assert.equal(tab.historyIndex, 2);
  assert.equal(session.historyTarget(1, () => true), null);

  const backAgain = session.historyTarget(-1, () => true);
  session.navigateActive(backAgain.pageId, {
    mode: 'back-forward',
    historyIndex: backAgain.index
  });
  const backToA = session.historyTarget(-1, () => true);
  session.navigateActive(backToA.pageId, {
    mode: 'back-forward',
    historyIndex: backToA.index
  });
  assert.equal(tab.currentPageId, 'A');
  assert.equal(tab.viewState.zoom, 1.8);
  assert.equal(tab.viewState.panX, 11);
  assert.deepEqual(tab.viewState.markdownStructuralFolds, [
    { kind: 'heading', physicalLineId: 'a-heading', lineIndex: 1, depth: 1 }
  ]);
});

test('new Tab creation and existing Tab activation never mutate either history', () => {
  let nextId = 0;
  const session = createTabSession({ createId: () => `tab-${++nextId}` });
  const source = session.reset('A');
  session.navigateActive('B', { mode: 'push' });
  const sourceHistory = [...source.history];
  const other = session.createTab('X');
  const otherHistory = [...other.history];

  session.activateTab(source.id);
  session.activateTab(other.id);
  session.activateTab(source.id);

  assert.deepEqual(source.history, sourceHistory);
  assert.deepEqual(other.history, otherHistory);
  assert.equal(source.historyIndex, 1);
  assert.equal(other.historyIndex, 0);
});

test('Tab reorder preserves a multi-Page history object, cursor, and Page view cache', () => {
  let nextId = 0;
  const session = createTabSession({ createId: () => `tab-${++nextId}` });
  const historyTab = session.reset('A');
  session.saveViewState(historyTab.id, { panX: 10, panY: 20, zoom: 1.5 });
  session.navigateActive('B', { mode: 'push' });
  session.saveViewState(historyTab.id, { panX: 30, panY: 40, zoom: 2.5 });
  session.navigateActive('C', { mode: 'push' });
  session.createTab('other');
  const historyReference = historyTab.history;
  const pageViewStatesReference = historyTab.pageViewStates;

  assert.equal(session.reorderTab(historyTab.id, 1), true);
  assert.equal(session.tabById(historyTab.id), historyTab);
  assert.equal(historyTab.history, historyReference);
  assert.equal(historyTab.pageViewStates, pageViewStatesReference);
  assert.deepEqual(historyTab.history, ['A', 'B', 'C']);
  assert.equal(historyTab.historyIndex, 2);
  assert.equal(historyTab.pageViewStates.A.zoom, 1.5);
  assert.equal(historyTab.pageViewStates.B.zoom, 2.5);
});

test('navigateCurrentTabToPage owns both normal pushes and history traversal', async () => {
  const app = await read('public/app.js');
  const ownerSource = sourceBetween(
    app,
    'async function navigateCurrentTabToPage',
    'async function switchToTab'
  );
  const calls = [];
  const statuses = [];
  const factory = new Function(
    'pageIndex',
    'showRuntimeStatus',
    'loadPage',
    `${ownerSource}\nreturn navigateCurrentTabToPage;`
  );
  const runtime = { paneId: 'pane-history-owner' };
  const navigate = factory(
    { pages: [{ id: 'A' }, { id: 'B' }] },
    (...args) => statuses.push(args),
    async (...args) => {
      calls.push({ owner: 'load', args });
      return true;
    }
  );

  assert.equal(await navigate(runtime, 'B'), true);
  assert.deepEqual(calls.shift(), {
    owner: 'load',
    args: [
      runtime,
      { id: 'B' },
      {
        showErrors: true,
        historyMode: 'push',
        historyIndex: null,
        preferCanonical: false,
        saveCurrentView: true
      }
    ]
  });

  assert.equal(await navigate(runtime, 'A', {
    navigationKind: 'history-traversal',
    historyIndex: 0,
    showErrors: false
  }), true);
  assert.deepEqual(calls.shift(), {
    owner: 'load',
    args: [
      runtime,
      { id: 'A' },
      {
        showErrors: false,
        historyMode: 'back-forward',
        historyIndex: 0,
        preferCanonical: false,
        saveCurrentView: true
      }
    ]
  });

  assert.equal(await navigate(runtime, 'B', {
    resolvedPageEntry: { id: 'B', title: 'B' },
    resolvedPage: { id: 'B', title: 'B', blocks: [] }
  }), true);
  assert.deepEqual(calls.shift(), {
    owner: 'load',
    args: [
      runtime,
      { id: 'B', title: 'B' },
      {
        showErrors: true,
        historyMode: 'push',
        historyIndex: null,
        preferCanonical: false,
        saveCurrentView: true,
        resolvedPage: { id: 'B', title: 'B', blocks: [] }
      }
    ]
  });

  assert.equal(await navigate(runtime, 'missing'), false);
  assert.deepEqual(statuses, [[runtime, 'Linked page is unavailable.', true, 2400]]);
  assert.equal(calls.length, 0);
  assert.equal(await navigate(runtime, 'A', {
    navigationKind: 'history-traversal',
    historyIndex: null
  }), false);
});

test('failed Page resolution leaves the current Tab session byte-for-byte unchanged', async () => {
  const app = await read('public/app.js');
  const ownerSource = sourceBetween(
    app,
    'async function navigateCurrentTabToPage',
    'async function switchToTab'
  );
  const session = createTabSession({ createId: () => 'tab-history' });
  const tab = session.reset('A');
  session.saveViewState(tab.id, { panX: 14, panY: 28, zoom: 1.9 });
  session.navigateActive('B', { mode: 'push' });
  session.saveViewState(tab.id, { panX: 41, panY: 52, zoom: 2.2 });
  const before = JSON.stringify(tab);
  let resolvePage = false;
  const factory = new Function(
    'pageIndex',
    'showRuntimeStatus',
    'loadPage',
    `${ownerSource}\nreturn navigateCurrentTabToPage;`
  );
  const navigate = factory(
    { pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] },
    () => {},
    async (ownerRuntime, entry, options) => {
      assert.strictEqual(ownerRuntime, runtime);
      if (!resolvePage) return false;
      return session.navigateActive(entry.id, {
        mode: options.historyMode,
        historyIndex: options.historyIndex
      });
    }
  );
  const runtime = { paneId: 'pane-failed-resolution' };

  assert.equal(await navigate(runtime, 'C'), false);
  assert.equal(JSON.stringify(tab), before);
  resolvePage = true;
  assert.equal(await navigate(runtime, 'C'), true);
  assert.deepEqual(tab.history, ['A', 'B', 'C']);
  assert.equal(tab.historyIndex, 2);
});

test('pre-resolved Page payloads retain the ordinary Page-load lifecycle', async () => {
  const app = await read('public/app.js');
  const loadSource = sourceBetween(
    app,
    'async function loadPage',
    'async function navigatePageHistory'
  );
  const ownerSource = sourceBetween(
    app,
    'async function navigateCurrentTabToPage',
    'async function switchToTab'
  );

  assert.ok(
    loadSource.indexOf('if (saveCurrentView) saveActiveTabViewState(runtime);')
      < loadSource.indexOf('const operation = captureRuntimeOperation(runtime'),
    'the source Tab view state is saved before the runtime operation is captured'
  );
  assert.ok(
    loadSource.indexOf('runtime.pageLoadSequence += 1')
      < loadSource.indexOf('const page = resolvedPage?.id === pageEntry.id'),
    'resolved payloads participate in the same PaneRuntime load-sequence gate'
  );
  assert.match(loadSource, /resolvedPage\?\.id === pageEntry\.id[\s\S]*?await request\(pageApiUrl\(pageEntry\.id\)\)/);
  assert.match(ownerSource, /loadPage\(runtime, targetPageEntry, \{[\s\S]*?resolvedPage\?\.id === targetPageId \? \{ resolvedPage \} : \{\}/);
  assert.doesNotMatch(ownerSource, /completePageOpen\(/);
});

test('history traversal cannot overwrite a newer push or an intervening Tab activation', async () => {
  const app = await read('public/app.js');
  const traversalSource = sourceBetween(
    app,
    'function capturePageHistoryTraversalOwner',
    'async function navigateCurrentTabToPage'
  );

  const createHarness = ({ tabs, activeTabRef, navigate }) => {
    const runtime = {
      paneId: 'pane-main',
      runtimeId: 'runtime-main',
      lifecycleEpoch: 1,
      disposed: false,
      currentPage: { id: activeTabRef.value.currentPageId },
      pageHistoryNavigationInProgress: false,
      pageLoadSequence: 0,
      session: null
    };
    const pane = { id: runtime.paneId, viewContext: runtime };
    runtime.session = {
      historyTarget(direction, pageExists, fromIndex = activeTabRef.value.historyIndex) {
        const tab = activeTabRef.value;
        const step = direction < 0 ? -1 : 1;
        for (let index = fromIndex + step;
          index >= 0 && index < tab.history.length;
          index += step) {
          if (pageExists(tab.history[index])) return { pageId: tab.history[index], index };
        }
        return null;
      }
    };
    let controller = null;
    const wrappedNavigate = async (ownerRuntime, ...args) => {
      assert.strictEqual(ownerRuntime, runtime);
      return navigate({ pane, runtime, controller }, ...args);
    };
    const factory = new Function(
      'pageIndex',
      'getWorkspacePane',
      'activeTab',
      'runtimeIsLive',
      'pageHistoryTarget',
      'pageHistoryEntryExists',
      'pageHistoryNavigationBlocked',
      'updatePageHistoryButtons',
      'navigateCurrentTabToPage',
      `${traversalSource}\nreturn { navigatePageHistory };`
    );
    const pageIndex = { pages: tabs.flatMap((tab) => tab.history).map((id) => ({ id })) };
    const pageExists = (pageId) => pageIndex.pages.some((page) => page.id === pageId);
    controller = factory(
      pageIndex,
      (paneId) => paneId === pane.id ? pane : null,
      (ownerRuntime) => ownerRuntime === runtime ? activeTabRef.value : null,
      (ownerRuntime) => ownerRuntime === runtime && !runtime.disposed,
      (ownerRuntime, direction, fromIndex) => ownerRuntime.session.historyTarget(
        direction, pageExists, fromIndex
      ),
      pageExists,
      () => false,
      () => {},
      wrappedNavigate
    );
    return { pane, runtime, controller };
  };

  {
    const sourceTab = {
      id: 'tab-source',
      currentPageId: 'C',
      history: ['A', 'B', 'C'],
      historyIndex: 2
    };
    const activeTabRef = { value: sourceTab };
    const calls = [];
    let releaseBack = null;
    const { runtime, controller } = createHarness({
      tabs: [sourceTab],
      activeTabRef,
      navigate: ({ runtime: ownerRuntime }, pageId) => {
        calls.push(pageId);
        ownerRuntime.pageLoadSequence += 1;
        return new Promise((resolve) => { releaseBack = resolve; });
      }
    });
    const pendingBack = controller.navigatePageHistory(runtime, -1);
    await Promise.resolve();
    sourceTab.history = ['A', 'B', 'C', 'D'];
    sourceTab.historyIndex = 3;
    sourceTab.currentPageId = 'D';
    runtime.pageLoadSequence += 1;
    releaseBack(false);

    assert.equal(await pendingBack, false);
    assert.deepEqual(calls, ['B']);
    assert.deepEqual(sourceTab.history, ['A', 'B', 'C', 'D']);
    assert.equal(sourceTab.historyIndex, 3);
    assert.equal(sourceTab.currentPageId, 'D');
  }

  {
    const sourceTab = {
      id: 'tab-source',
      currentPageId: 'C',
      history: ['A', 'B', 'C'],
      historyIndex: 2
    };
    const activatedTab = {
      id: 'tab-activated',
      currentPageId: 'Y',
      history: ['X', 'Y'],
      historyIndex: 1
    };
    const activeTabRef = { value: sourceTab };
    const calls = [];
    let releaseBack = null;
    const { runtime, controller } = createHarness({
      tabs: [sourceTab, activatedTab],
      activeTabRef,
      navigate: ({ runtime: ownerRuntime }, pageId) => {
        calls.push(pageId);
        ownerRuntime.pageLoadSequence += 1;
        return new Promise((resolve) => { releaseBack = resolve; });
      }
    });
    const activatedBefore = JSON.stringify(activatedTab);
    const pendingBack = controller.navigatePageHistory(runtime, -1);
    await Promise.resolve();
    activeTabRef.value = activatedTab;
    runtime.pageLoadSequence += 1;
    releaseBack(false);

    assert.equal(await pendingBack, false);
    assert.deepEqual(calls, ['B']);
    assert.equal(JSON.stringify(activatedTab), activatedBefore);
  }
});

test('history traversal still skips an unavailable entry while it retains ownership', async () => {
  const app = await read('public/app.js');
  const traversalSource = sourceBetween(
    app,
    'function capturePageHistoryTraversalOwner',
    'async function navigateCurrentTabToPage'
  );
  const tab = {
    id: 'tab-history',
    currentPageId: 'C',
    history: ['A', 'B', 'C'],
    historyIndex: 2
  };
  const runtime = {
    paneId: 'pane-main',
    runtimeId: 'runtime-main',
    lifecycleEpoch: 1,
    disposed: false,
    currentPage: { id: 'C' },
    pageHistoryNavigationInProgress: false,
    pageLoadSequence: 0,
    session: null
  };
  const pane = { id: runtime.paneId, viewContext: runtime };
  const pages = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const pageExists = (pageId) => pages.some((page) => page.id === pageId);
  runtime.session = {
    historyTarget(direction, exists, fromIndex = tab.historyIndex) {
      const step = direction < 0 ? -1 : 1;
      for (let index = fromIndex + step;
        index >= 0 && index < tab.history.length;
        index += step) {
        if (exists(tab.history[index])) return { pageId: tab.history[index], index };
      }
      return null;
    }
  };
  const calls = [];
  const factory = new Function(
    'pageIndex',
    'getWorkspacePane',
    'activeTab',
    'runtimeIsLive',
    'pageHistoryTarget',
    'pageHistoryEntryExists',
    'pageHistoryNavigationBlocked',
    'updatePageHistoryButtons',
    'navigateCurrentTabToPage',
    `${traversalSource}\nreturn navigatePageHistory;`
  );
  const navigate = factory(
    { pages },
    (paneId) => paneId === pane.id ? pane : null,
    (ownerRuntime) => ownerRuntime === runtime ? tab : null,
    (ownerRuntime) => ownerRuntime === runtime && !runtime.disposed,
    (ownerRuntime, direction, fromIndex) => ownerRuntime.session.historyTarget(
      direction, pageExists, fromIndex
    ),
    pageExists,
    () => false,
    () => {},
    async (ownerRuntime, pageId) => {
      assert.strictEqual(ownerRuntime, runtime);
      calls.push(pageId);
      ownerRuntime.pageLoadSequence += 1;
      return pageId === 'A';
    }
  );

  assert.equal(await navigate(runtime, -1), true);
  assert.deepEqual(calls, ['B', 'A']);
});

test('Sidebar gives existing-Tab activation priority and otherwise delegates same-Tab navigation', async () => {
  const app = await read('public/app.js');
  const sidebarSource = sourceBetween(
    app,
    'function openPageFromSidebar',
    'function disposeWorkspacePaneView'
  );
  const events = [];
  let active = { id: 'source-tab', currentPageId: null };
  let existing = { tab: { id: 'existing-tab', currentPageId: 'B' } };
  const runtime = {
    paneId: 'pane-sidebar-owner',
    linkPickMode: null,
    session: {
      createTab() { active = { id: 'new-empty-tab', currentPageId: null }; }
    }
  };
  const factory = new Function(
    'activePaneRuntime',
    'activeTab',
    'renderTabStrip',
    'workspaceTabForPage',
    'activateWorkspaceTab',
    'populateActiveEmptyTab',
    'navigateCurrentTabToPage',
    `${sidebarSource}\nreturn openPageFromSidebar;`
  );
  const openFromSidebar = factory(
    () => runtime,
    (ownerRuntime) => ownerRuntime === runtime ? active : null,
    () => events.push('render-tabs'),
    () => existing,
    (target) => { events.push(`activate:${target.tab.id}`); return true; },
    (ownerRuntime, pageId) => {
      assert.strictEqual(ownerRuntime, runtime);
      events.push(`populate:${pageId}`);
      return true;
    },
    (ownerRuntime, pageId) => {
      assert.strictEqual(ownerRuntime, runtime);
      events.push(`navigate:${pageId}`);
      return true;
    }
  );

  assert.equal(openFromSidebar('B'), true);
  assert.deepEqual(events, ['activate:existing-tab']);

  events.length = 0;
  existing = null;
  assert.equal(openFromSidebar('B'), true);
  assert.deepEqual(events, ['populate:B']);

  events.length = 0;
  active = { id: 'source-tab', currentPageId: 'A' };
  assert.equal(openFromSidebar('B'), true);
  assert.deepEqual(events, ['navigate:B']);
});

test('all production same-Tab Page-jump callers fan into the unified owner', async () => {
  const [app, navigation, rightSidebar, externalLinks] = await Promise.all([
    read('public/app.js'),
    read('public/js/navigation.js'),
    read('public/js/rightSidebar.js'),
    read('public/js/externalLinks.js')
  ]);
  const ownerStart = app.indexOf('async function navigateCurrentTabToPage');
  const ownerEnd = app.indexOf('async function switchToTab', ownerStart);
  assert.ok(ownerStart >= 0 && ownerEnd > ownerStart);
  const outsideOwner = app.slice(0, ownerStart) + app.slice(ownerEnd);
  assert.doesNotMatch(outsideOwner, /historyMode: 'push'/);
  assert.doesNotMatch(app, /navigateToPageId/);

  const traversalStart = app.indexOf('async function navigatePageHistory');
  assert.ok(traversalStart >= 0 && ownerStart > traversalStart);
  const traversal = app.slice(traversalStart, ownerStart);
  assert.match(traversal, /navigateCurrentTabToPage\(runtime, target\.pageId, \{/);
  assert.match(traversal, /navigationKind: 'history-traversal'/);
  assert.doesNotMatch(traversal, /loadPage\(/);

  const sidebar = sourceBetween(app, 'function openPageFromSidebar', 'function disposeWorkspacePaneView');
  assert.ok(
    sidebar.indexOf('workspaceTabForPage(pageId)')
      < sidebar.indexOf('active?.currentPageId === null')
  );
  assert.match(sidebar, /navigateCurrentTabToPage\(runtime, pageId, \{/);
  assert.doesNotMatch(sidebar, /historyMode:|loadPage\(/);

  assert.match(app, /target\.kind === 'page'\) navigateCurrentTabToPage\(runtime, target\.link\.targetPageId\)/);
  assert.match(externalLinks, /target\.kind === 'page'\) navigateCurrentTabToPage\(runtime, target\.link\.targetPageId\)/);
  assert.match(rightSidebar, /navigateCurrentTabToPage\(runtime, row\.pageId\)/);
  assert.match(app, /confirmAddLinkNewPage[\s\S]*?navigateCurrentTabToPage\(runtime, created\.page\.id, \{/);
  assert.match(app, /if \(!await navigateCurrentTabToPage\(runtime, fallbackPage\.id\)\) return/);
  assert.match(navigation, /clearNavigationSelection\(\);[\s\S]*?openPageFromSidebar\(page\.id\)/);
  assert.doesNotMatch(navigation, /else loadPage\(page\)/);

  assert.match(app, /async function loadPage\(runtime, pageEntry, \{[\s\S]*?historyMode = null/);
  assert.match(app, /function requirePageHistoryMode\(historyMode\)/);
});
