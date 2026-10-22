const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const vm = require('node:vm');
const navigationSort = require('../public/navigationSort');
const pageBindingProjection = require('../public/pageBindingProjection');
const pageTypesModel = require('../public/pageTypes');
const textEditingModel = require('../public/textEditing');
require('../public/markdownPage');

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  add(...names) { for (const name of names) this.values.add(name); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = { setProperty() {} };
    this.hidden = true;
    this.textContent = '';
    this.disabled = false;
    this.listeners = new Map();
    this.attributes = new Map();
    this.offsetWidth = 180;
    this.offsetHeight = 160;
    this.replaceChildrenCount = 0;
    this._className = '';
  }
  set className(value) {
    this._className = value;
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  append(...items) {
    for (const item of items) {
      if (item && typeof item === 'object') item.parentElement = this;
      this.children.push(item);
    }
  }
  replaceChildren(...items) {
    this.replaceChildrenCount += 1;
    for (const child of this.children) {
      if (child && typeof child === 'object') child.parentElement = null;
    }
    this.children = [];
    this.append(...items);
  }
  replaceWith(item) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    parent.children[index] = item;
    this.parentElement = null;
    item.parentElement = parent;
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }
  addEventListener(type, handler) {
    const previous = this.listeners.get(type);
    this.listeners.set(type, previous
      ? (event) => {
        previous(event);
        return handler(event);
      }
      : handler);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  blur() { this.listeners.get('blur')?.({ target: this }); }
  getBoundingClientRect() { return { left: 120, right: 150, top: 10, bottom: 40, width: 30, height: 30 }; }
  querySelectorAll(selector) {
    const matches = (item) => {
      if (selector === '[data-navigation-selection-key]') return Boolean(item.dataset?.navigationSelectionKey);
      if (selector === '.navigation-sort-option') return item.classList?.contains('navigation-sort-option');
      if (selector === '.page-link') return item.classList?.contains('page-link');
      if (selector === '.nav-page-type-badge') return item.classList?.contains('nav-page-type-badge');
      if (selector === '[data-navigation-indicator]') return Boolean(item.dataset?.navigationIndicator);
      if (selector === '[aria-checked="true"]') return item.getAttribute?.('aria-checked') === 'true';
      if (selector === '.navigation-menu-check') return item.classList?.contains('navigation-menu-check');
      if (selector.startsWith('[data-folder-rename-input=')) return Boolean(item.dataset?.folderRenameInput);
      if (selector.startsWith('[data-page-rename-input=')) return Boolean(item.dataset?.pageRenameInput);
      return false;
    };
    const result = [];
    const visit = (items) => {
      for (const item of items) {
        if (matches(item)) result.push(item);
        visit(item.children || []);
      }
    };
    visit(this.children);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(target) {
    return target === this || this.children.some((child) => child.contains?.(target));
  }
  closest(selector) {
    let element = this;
    while (element) {
      if (selector === '.nav-folder' && element.classList?.contains('nav-folder')) return element;
      if (selector === '.nav-folder-pages' && element.classList?.contains('nav-folder-pages')) return element;
      element = element.parentElement;
    }
    return null;
  }
}

async function navigationHarness() {
  const source = await fs.readFile(path.join(__dirname, '../public/js/navigation.js'), 'utf8');
  const sidebarMotionCalls = [];
  let sidebarMotionSessionId = 0;
  const sidebarMotionCoordinator = {
    cancel(reason) {
      sidebarMotionCalls.push({ method: 'cancel', reason });
      return false;
    },
    capture(options) {
      const session = { id: ++sidebarMotionSessionId, kind: 'captured' };
      sidebarMotionCalls.push({ method: 'capture', options, session });
      return session;
    },
    async play(session, render) {
      sidebarMotionCalls.push({ method: 'play', session });
      render();
      return true;
    },
    beginDrag(options) {
      const session = { id: ++sidebarMotionSessionId, kind: 'drag' };
      sidebarMotionCalls.push({ method: 'beginDrag', options, session });
      return session;
    },
    updateDragPointer(session, clientX, clientY) {
      sidebarMotionCalls.push({ method: 'updateDragPointer', session, clientX, clientY });
      return true;
    },
    async restoreDrag(session, options) {
      sidebarMotionCalls.push({ method: 'restoreDrag', session, options });
      return true;
    },
    handoffDrag(session) {
      sidebarMotionCalls.push({ method: 'handoffDrag', session });
      return true;
    },
    async commitDrag(session, render, options) {
      sidebarMotionCalls.push({ method: 'commitDrag', session, options });
      render();
      return true;
    },
    playDisclosure(options) {
      sidebarMotionCalls.push({ method: 'playDisclosure', options });
      options.render();
      return Promise.resolve(true);
    }
  };
  const pageList = new FakeElement('nav');
  const pageContextMenu = new FakeElement();
  const renamePageMenuItem = new FakeElement('button');
  const defaultPageMenuItem = new FakeElement('button');
  const defaultPageCheck = new FakeElement('span');
  defaultPageCheck.className = 'navigation-menu-check';
  defaultPageMenuItem.append(defaultPageCheck);
  const stickPageMenuItem = new FakeElement('button');
  const stickPageCheck = new FakeElement('span');
  stickPageCheck.className = 'navigation-menu-check';
  stickPageMenuItem.append(stickPageCheck);
  const folderContextMenu = new FakeElement();
  const renameFolderMenuItem = new FakeElement('button');
  const stickFolderMenuItem = new FakeElement('button');
  const stickFolderCheck = new FakeElement('span');
  stickFolderCheck.className = 'navigation-menu-check';
  stickFolderMenuItem.append(stickFolderCheck);
  const navigationMoveHint = new FakeElement();
  const navigationSortMenu = new FakeElement();
  const navigationSortButton = new FakeElement('button');
  const relationContextMenu = new FakeElement();
  let newPageClicks = 0;
  let newFolderClicks = 0;
  const nestedPageParents = [];
  const nestedFolderParents = [];
  const runtime = {
    paneId: 'pane_navigation_test',
    runtimeId: 'runtime_navigation_test',
    lifecycleEpoch: 1,
    disposed: false,
    currentPage: null,
    currentPageEntry: null,
    linkPickMode: null
  };
  const context = {
    console,
    textEditingModel,
    document: {
      createElement: (tagName) => new FakeElement(tagName),
      addEventListener() {},
      removeEventListener() {},
      body: new FakeElement('body')
    },
    window: {
      innerWidth: 1200,
      innerHeight: 800,
      nativeContextMenu: {
        available: () => true,
        open: async (_event, payload) => {
          context.lastNativeContextPayload = payload;
          return context.nextNativeContextCommand || null;
        }
      }
    },
    pageList,
    pageContextMenu,
    renamePageMenuItem,
    defaultPageMenuItem,
    stickPageMenuItem,
    folderContextMenu,
    renameFolderMenuItem,
    stickFolderMenuItem,
    navigationMoveHint,
    navigationMoveMode: null,
    navigationMoveHoverFolderElement: null,
    navigationSortMenu,
    navigationSortButton,
    relationContextMenu,
    newPageButton: { click: () => { newPageClicks += 1; } },
    newFolderButton: { click: () => { newFolderClicks += 1; } },
    createNewPage: async ({ runtime: ownerRuntime, parentFolderId } = {}) => {
      assert.strictEqual(ownerRuntime, runtime);
      nestedPageParents.push(parentFolderId || null);
    },
    createNewFolder: async ({ parentFolderId } = {}) => { nestedFolderParents.push(parentFolderId || null); },
    navigationSort,
    pageBindingProjection,
    pageTypesModel,
    sidebarMembershipMoveAnimationModel: {
      createCoordinator: () => sidebarMotionCoordinator
    },
    vaultPreferences: { defaultPageType: pageTypesModel.PAGE_TYPES.CANVAS },
    navigationSortMode: navigationSort.DEFAULT_SORT_MODE,
    navigationSortSaveQueue: Promise.resolve(),
    selectedNavigationItems: new Set(),
    navigationExplicitSelectionMode: false,
    navigationVisibleOrder: [],
    navigationSelectionAnchor: null,
    navigationSelectionAnchorIsImplicitCurrent: false,
    navigationDragData: null,
    pageContextTarget: null,
    pageContextParentFolderId: null,
    pageContextSynthetic: false,
    pageDeleteInProgress: false,
    folderContextTarget: null,
    folderDeleteInProgress: false,
    relationDeleteInProgress: false,
    folderRenameState: null,
    folderRenameSaveInProgress: false,
    pageRenameState: null,
    pageRenameSaveInProgress: false,
    pageIndex: { pages: [] },
    navigation: { version: 2, folders: [], items: [] },
    pageMatchesNavigationView: () => true,
    navigationViewRestricted: () => false,
    queueMicrotask: () => {},
    showRuntimeStatus() {},
    openPageFromSidebar: (pageId) => { context.loadedPageId = pageId; },
    beginSidebarPageDrag: (event, button, pageId) => {
      context.sidebarDragStart = { event, button, pageId };
    },
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    makeUniquePageTitle: (title) => title,
    renderPage: (page) => { context.renderedPage = page; },
    activePaneRuntime: () => runtime,
    runtimeIsLive: (candidate) => candidate === runtime && !candidate.disposed,
    captureRuntimeOperation: (candidate, detail = {}) => ({
      runtime: candidate,
      runtimeId: candidate?.runtimeId,
      lifecycleEpoch: candidate?.lifecycleEpoch,
      ...detail
    }),
    runtimeOperationIsCurrent: (operation) => Boolean(
      operation?.runtime === runtime
      && operation.runtimeId === runtime.runtimeId
      && operation.lifecycleEpoch === runtime.lifecycleEpoch
      && !runtime.disposed
    ),
    openPageMetaModal: (ownerRuntime, type, options) => {
      assert.strictEqual(ownerRuntime, runtime);
      context.openedPageMetaModal = { type, options };
    },
    deleteContextPage: (ownerRuntime, options) => {
      assert.strictEqual(ownerRuntime, runtime);
      context.deletedPageOptions = options;
    },
    request: async () => { throw new Error('unexpected request'); },
    setEditMenuOpen() {},
    closeAddLinkPopover() {},
    closeRelationContextMenu() {},
    closeResourceContextMenu() {},
    plural: (count, word) => `${count} ${word}`,
    CSS: { escape: (value) => value }
  };
  Object.defineProperties(context, {
    currentPage: {
      enumerable: true,
      configurable: true,
      get: () => runtime.currentPage,
      set: (value) => { runtime.currentPage = value; }
    },
    currentPageEntry: {
      enumerable: true,
      configurable: true,
      get: () => runtime.currentPageEntry,
      set: (value) => { runtime.currentPageEntry = value; }
    },
    linkPickMode: {
      enumerable: true,
      configurable: true,
      get: () => runtime.linkPickMode,
      set: (value) => { runtime.linkPickMode = value; }
    }
  });
  vm.runInNewContext(`${source}\nglobalThis.navigationTestApi = {
    clearNavigationSelection,
    updateNavigationSelectionVisuals,
    navigationDragItems,
    navigationPageDragDescriptor,
    beginSidebarPageNavigationDrag,
    updateSidebarPageNavigationDragPointer,
    restoreSidebarPageNavigationDrag,
    handoffSidebarPageNavigationDragToPreview,
    navigationSelectionGesture,
    currentVisiblePageSelectionKey,
    reconcileNavigationPageSelectionVisibility,
    openNavigationMoveMenu,
    performNavigationBatchMove,
    commitSidebarPageNavigationMembershipDrop,
    navigationFolderDestinationError,
    navigationRootDestinationError,
    sidebarPageNavigationPayload,
    rememberNavigationVisibleItem,
    selectNavigationItem,
    selectedNavigationMoveItems,
    selectedNavigationPageIds,
    closeNavigationMoveMenu,
    clearNavigationMoveTarget,
    showNavigationMoveTarget,
    applyNavigationSortMode,
    closeNavigationSortMenu,
    handleNavigationSortMenuKeyDown,
    openNavigationSortMenu,
    renderNavigationSortMenu,
    toggleNavigationSortMenu,
    navigationPageTypeBadge,
    startFolderRename,
    startPageRename,
    renameContextFolder,
    renameContextPage,
    saveFolderRename,
    savePageRename,
    cancelFolderRename,
    cancelPageRename,
    folderPages,
    renderPageList,
    toggleNavigationFolder,
    createPageListButton,
    renderFolderLabel,
    openPageContextMenu,
    openFolderContextMenu,
    rootNavigationEntries,
    folderNavigationEntries,
    pagesInSidebarOrder,
    projectNavigationPageUnits,
    manualFolderDefaultPage,
    navigationPageStickOnTop,
    navigationBindingFact,
    selectedUnboundBindingPageIds,
    openNavigationBindingMenu,
    navigationBindingTargetError,
    showNavigationBindingTarget,
    commitNavigationBindingTarget,
    stopPageBinding,
    setPageBindingLeader,
    toggleContextPageStickOnTop,
    openNavigationBackgroundContextMenu
  };`, context);
  return {
    context,
    source,
    api: context.navigationTestApi,
    pageList,
    navigationMoveHint,
    navigationSortMenu,
    navigationSortButton,
    newPageClicks: () => newPageClicks,
    newFolderClicks: () => newFolderClicks,
    nestedPageParents,
    nestedFolderParents,
    sidebarMotionCalls,
    sidebarMotionCoordinator,
    runtime
  };
}

function selectionRow(key) {
  const row = new FakeElement('button');
  row.dataset.navigationSelectionKey = key;
  return row;
}

test('right-clicking navigation background offers the existing new Page and Folder actions', async () => {
  const {
    context, pageList, newPageClicks, newFolderClicks
  } = await navigationHarness();
  context.selectedNavigationItems.add('page:page_1');

  context.nextNativeContextCommand = 'new-page';
  await pageList.listeners.get('contextmenu')({ target: pageList });
  assert.deepEqual(JSON.parse(JSON.stringify(context.lastNativeContextPayload)), {
    type: 'navigation-background', targetId: 'navigation-root'
  });
  assert.equal(newPageClicks(), 1);
  assert.equal(newFolderClicks(), 0);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_1']);

  context.nextNativeContextCommand = 'new-folder';
  await pageList.listeners.get('contextmenu')({ target: pageList });
  assert.equal(newPageClicks(), 1);
  assert.equal(newFolderClicks(), 1);

  const row = selectionRow('page:page_2');
  context.lastNativeContextPayload = null;
  await pageList.listeners.get('contextmenu')({ target: row });
  assert.equal(context.lastNativeContextPayload, null);
});

test('manual Folder context commands create new folders and pages inside the clicked folder', async () => {
  const { context, api, nestedPageParents, nestedFolderParents } = await navigationHarness();
  const folder = {
    id: 'folder_parent', label: 'Parent', type: 'manual', stickOnTop: false,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation.folders = [folder];
  const event = { metaKey: false, altKey: false, shiftKey: false };

  context.nextNativeContextCommand = 'new-folder-in-folder';
  await api.openFolderContextMenu(event, folder);
  assert.equal(context.lastNativeContextPayload.type, 'navigation-folder');
  assert.deepEqual(nestedFolderParents, ['folder_parent']);
  assert.deepEqual(nestedPageParents, []);

  context.nextNativeContextCommand = 'new-page-in-folder';
  await api.openFolderContextMenu(event, folder);
  assert.deepEqual(nestedFolderParents, ['folder_parent']);
  assert.deepEqual(nestedPageParents, ['folder_parent']);
});

test('navigation selection reuses Descriptor modifier, range, toggle, and drag semantics', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_1', 'page:page_2', 'folder:folder_a', 'folder:folder_b'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);

  api.selectNavigationItem(keys[0], { metaKey: true, altKey: false, shiftKey: false });
  api.selectNavigationItem(keys[1], { metaKey: true, altKey: false, shiftKey: false });
  assert.deepEqual([...context.selectedNavigationItems], keys.slice(0, 2));

  api.selectNavigationItem(keys[2], { metaKey: true, altKey: false, shiftKey: false });
  assert.deepEqual([...context.selectedNavigationItems], keys.slice(0, 3));
  api.selectNavigationItem(keys[1], { metaKey: true, altKey: false, shiftKey: false });
  assert.deepEqual([...context.selectedNavigationItems], [keys[0], keys[2]]);

  api.clearNavigationSelection();
  context.currentPage = { id: 'page_1', title: 'Page 1' };
  api.selectNavigationItem(keys[3], { metaKey: false, altKey: false, shiftKey: true });
  assert.deepEqual([...context.selectedNavigationItems], keys);
  assert.equal(pageList.children.every((row) => row.classList.contains('nav-selected')), true);

  assert.deepEqual(Array.from(
    api.navigationDragItems('page', 'page_2'),
    (item) => `${item.type}:${item.id}`
  ), keys);
  assert.deepEqual(JSON.parse(JSON.stringify(api.navigationDragItems('page', 'page_unselected'))), [
    { type: 'page', id: 'page_unselected' }
  ]);
  assert.equal(api.navigationSelectionGesture({}), false);
});

test('first Shift selection uses the visible current page as its real range anchor', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_1', 'page:page_2', 'page:page_3', 'folder:folder_a'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);
  context.currentPage = { id: 'page_1', title: 'Page 1' };

  assert.equal(context.selectedNavigationItems.size, 0);
  assert.equal(context.navigationSelectionAnchor, null);
  api.selectNavigationItem(keys[2], { shiftKey: true, metaKey: false, altKey: false });

  assert.deepEqual([...context.selectedNavigationItems], keys.slice(0, 3));
  assert.equal(context.navigationSelectionAnchor, keys[0]);
  assert.deepEqual(Array.from(api.selectedNavigationMoveItems(), (item) => item.id), [
    'page_1', 'page_2', 'page_3'
  ]);

  api.selectNavigationItem(keys[3], { shiftKey: true, metaKey: false, altKey: false });
  assert.deepEqual([...context.selectedNavigationItems], keys);
  assert.equal(context.navigationSelectionAnchor, keys[0]);
});

test('first Shift selection falls back to the clicked row when the current page is not visible', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_2', 'page:page_3'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);
  context.currentPage = { id: 'page_hidden', title: 'Hidden' };

  api.selectNavigationItem(keys[1], { shiftKey: true, metaKey: false, altKey: false });

  assert.deepEqual([...context.selectedNavigationItems], [keys[1]]);
  assert.equal(context.navigationSelectionAnchor, keys[1]);
});

test('first Command selection does not seed an active Page whose row is filtered out', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_f', 'page:page_g'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);
  context.currentPage = { id: 'page_c', title: 'Hidden current Page' };

  api.selectNavigationItem(keys[0], {
    shiftKey: false, metaKey: true, altKey: false
  });
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_f']);
  assert.equal(context.currentPage.id, 'page_c');
  assert.equal(pageList.children[0].classList.contains('nav-selected'), true);

  api.selectNavigationItem(keys[0], {
    shiftKey: false, metaKey: true, altKey: false
  });
  assert.deepEqual([...context.selectedNavigationItems], []);
  assert.equal(context.currentPage.id, 'page_c');
  assert.equal(pageList.children[0].classList.contains('nav-selected'), false);
});

test('projection changes prune hidden Page selection and anchors without resurrecting them', async () => {
  const { context, api, pageList } = await navigationHarness();
  const pages = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id: `page_${id}`, title: id.toUpperCase()
  }));
  let visibleIds = new Set(pages.map((page) => page.id));
  context.pageIndex = { pages };
  context.navigation = { version: 3, folders: [], items: pages.map((page) => page.id) };
  context.pageMatchesNavigationView = (page) => visibleIds.has(page.id);
  context.currentPage = pages[0];
  context.navigationExplicitSelectionMode = true;
  for (const pageId of ['page_b', 'page_c', 'page_d']) {
    context.selectedNavigationItems.add(`page:${pageId}`);
  }
  context.navigationSelectionAnchor = 'page:page_c';

  api.renderPageList();
  assert.deepEqual([...context.selectedNavigationItems], [
    'page:page_b', 'page:page_c', 'page:page_d'
  ]);

  visibleIds = new Set(['page_a', 'page_b', 'page_d', 'page_e']);
  api.renderPageList();

  assert.deepEqual([...context.selectedNavigationItems], ['page:page_b', 'page:page_d']);
  assert.equal(context.navigationSelectionAnchor, null);
  assert.equal(context.navigationSelectionAnchorIsImplicitCurrent, false);
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual(
    pageList.children.filter((row) => row.classList.contains('nav-selected'))
      .map((row) => row.dataset.pageId),
    ['page_b', 'page_d']
  );
  assert.deepEqual(
    Array.from(api.navigationPageDragDescriptor('page_b').items, (item) => item.id),
    ['page_b', 'page_d']
  );

  visibleIds = new Set(pages.map((page) => page.id));
  api.renderPageList();
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_b', 'page:page_d']);
  assert.equal(
    pageList.children.find((row) => row.dataset.pageId === 'page_c')
      .classList.contains('nav-selected'),
    false
  );
});

test('filtering every selected Page exits explicit mode without changing the open Page', async () => {
  const { context, api, pageList } = await navigationHarness();
  const pages = [
    { id: 'page_active', title: 'Active' },
    { id: 'page_b', title: 'B' },
    { id: 'page_c', title: 'C' }
  ];
  let visibleIds = new Set(pages.map((page) => page.id));
  context.pageIndex = { pages };
  context.navigation = { version: 3, folders: [], items: pages.map((page) => page.id) };
  context.pageMatchesNavigationView = (page) => visibleIds.has(page.id);
  context.currentPage = pages[0];
  context.navigationExplicitSelectionMode = true;
  context.selectedNavigationItems.add('page:page_b');
  context.selectedNavigationItems.add('page:page_c');
  context.navigationSelectionAnchor = 'page:page_b';
  context.navigationSelectionAnchorIsImplicitCurrent = true;

  api.renderPageList();
  visibleIds = new Set(['page_active']);
  api.renderPageList();

  assert.deepEqual([...context.selectedNavigationItems], []);
  assert.equal(context.navigationExplicitSelectionMode, false);
  assert.equal(context.navigationSelectionAnchor, null);
  assert.equal(context.navigationSelectionAnchorIsImplicitCurrent, false);
  assert.equal(context.currentPage.id, 'page_active');
  assert.equal(context.loadedPageId, undefined);
  assert.equal(pageList.children[0].classList.contains('active'), true);
  assert.equal(pageList.children[0].classList.contains('nav-selected'), false);
});

test('Page Shift ranges contain only visible Pages while Folder gestures remain unchanged', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_a', 'folder:folder_a', 'page:page_b'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);
  context.currentPage = { id: 'page_a', title: 'A' };

  api.selectNavigationItem('page:page_b', {
    shiftKey: true, metaKey: false, altKey: false
  });

  assert.deepEqual([...context.selectedNavigationItems], ['page:page_a', 'page:page_b']);
  assert.equal(context.navigationSelectionAnchor, 'page:page_a');

  api.clearNavigationSelection();
  api.selectNavigationItem('folder:folder_a', {
    shiftKey: true, metaKey: false, altKey: false
  });
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_a', 'folder:folder_a']);
});

test('active Page and explicit navigation selection remain independent across Command, render, ordinary click, and drag', async () => {
  const { context, api, pageList } = await navigationHarness();
  const pages = [
    { id: 'page_c', title: 'Current' },
    { id: 'page_f', title: 'Following' },
    { id: 'page_d', title: 'Different' }
  ];
  context.currentPage = pages[0];
  context.pageIndex = { pages };
  context.navigation = { version: 3, folders: [], items: pages.map((page) => page.id) };
  const rows = pages.map((page) => api.createPageListButton(page));
  pageList.replaceChildren(...rows);

  assert.equal(context.navigationExplicitSelectionMode, false);
  assert.deepEqual([...context.selectedNavigationItems], []);
  assert.equal(rows[0].classList.contains('active'), true);
  assert.equal(rows[0].classList.contains('nav-selected'), false);
  assert.equal(rows[1].classList.contains('active'), false);
  assert.equal(rows[1].classList.contains('nav-selected'), false);

  api.selectNavigationItem('page:page_f', {
    metaKey: true, altKey: false, shiftKey: false
  });
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_c', 'page:page_f']);
  assert.equal(rows[0].classList.contains('nav-selected'), true);
  assert.equal(rows[1].classList.contains('nav-selected'), true);

  api.selectNavigationItem('page:page_c', {
    metaKey: true, altKey: false, shiftKey: false
  });
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_f']);
  assert.equal(context.currentPage.id, 'page_c');
  assert.equal(rows[0].classList.contains('active'), false);
  assert.equal(rows[0].classList.contains('nav-selected'), false);
  assert.equal(rows[1].classList.contains('nav-selected'), true);

  api.selectNavigationItem('page:page_d', {
    metaKey: true, altKey: false, shiftKey: false
  });
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_f', 'page:page_d']);
  assert.equal(context.selectedNavigationItems.has('page:page_c'), false);

  const batch = api.navigationPageDragDescriptor('page_f');
  assert.equal(batch.explicitMultiSelection, true);
  assert.deepEqual([...batch.items].map((item) => item.id), ['page_f', 'page_d']);

  const single = api.navigationPageDragDescriptor('page_c');
  assert.equal(single.explicitMultiSelection, false);
  assert.deepEqual([...single.items].map((item) => item.id), ['page_c']);
  assert.equal(context.currentPage.id, 'page_c');
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_f', 'page:page_d']);
  assert.equal(rows[0].classList.contains('active'), false);
  assert.equal(rows[0].classList.contains('nav-selected'), false);

  api.selectNavigationItem('page:page_f', {
    metaKey: true, altKey: false, shiftKey: false
  });
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_d']);
  const rerenderedCurrent = api.createPageListButton(pages[0]);
  assert.equal(rerenderedCurrent.classList.contains('active'), false);
  assert.equal(rerenderedCurrent.classList.contains('nav-selected'), false);

  const ordinaryClick = {
    metaKey: false, altKey: false, shiftKey: false,
    preventDefault() {}, stopPropagation() {}
  };
  await rows[0].listeners.get('click')(ordinaryClick);
  assert.equal(context.navigationExplicitSelectionMode, false);
  assert.deepEqual([...context.selectedNavigationItems], []);
  assert.equal(context.loadedPageId, 'page_c');
  assert.equal(rows[0].classList.contains('active'), true);
  assert.equal(rows[0].classList.contains('nav-selected'), false);

  const normalSingle = api.navigationPageDragDescriptor('page_d');
  assert.equal(normalSingle.explicitMultiSelection, false);
  assert.deepEqual([...normalSingle.items].map((item) => item.id), ['page_d']);
  assert.equal(context.navigationExplicitSelectionMode, false);
  assert.deepEqual([...context.selectedNavigationItems], []);
  assert.equal(rows[0].classList.contains('active'), true);
  assert.equal(rows[0].classList.contains('nav-selected'), false);
  assert.equal(rows[2].classList.contains('active'), false);
  assert.equal(rows[2].classList.contains('nav-selected'), false);
});

test('first Shift selection seeds the active Page once and uses it as the stable range anchor', async () => {
  const { context, api, pageList } = await navigationHarness();
  const keys = ['page:page_c', 'page:page_d', 'page:page_e', 'page:page_f'];
  pageList.children = keys.map(selectionRow);
  for (const key of keys) api.rememberNavigationVisibleItem(key);
  context.currentPage = { id: 'page_c', title: 'Current' };

  api.selectNavigationItem(keys[3], {
    shiftKey: true, metaKey: false, altKey: false
  });
  assert.equal(context.navigationExplicitSelectionMode, true);
  assert.deepEqual([...context.selectedNavigationItems], keys);
  assert.equal(context.navigationSelectionAnchor, keys[0]);

  api.selectNavigationItem(keys[2], {
    shiftKey: true, metaKey: false, altKey: false
  });
  assert.deepEqual([...context.selectedNavigationItems], keys.slice(0, 3));
  assert.equal(context.navigationSelectionAnchor, keys[0]);
});

test('navigation selection keeps the existing hover colour and gives Folders no active-Page semantics', async () => {
  const { context, api, source } = await navigationHarness();
  context.currentPage = { id: 'folder_same_id', title: 'Page with matching id' };
  const wrapper = new FakeElement();
  api.renderFolderLabel({
    id: 'folder_same_id',
    label: 'Manual Folder',
    type: 'manual',
    collapsed: false,
    stickOnTop: false,
    source: { kind: 'manual', pageIds: [] },
    children: []
  }, wrapper);
  const folderButton = wrapper.children[0];
  assert.equal(folderButton.classList.contains('active'), false);
  assert.doesNotMatch(source, /folderButton\.classList\.toggle\(['"]active['"]/);

  const styles = await fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.match(styles, /\.page-link:hover\s*\{\s*background:\s*var\(--surface-guide-section\);\s*\}/);
  const selectedRule = styles.match(
    /\.page-link\.nav-selected,\s*\.nav-folder-button\.nav-selected\s*\{([^}]*)\}/
  )?.[1] || '';
  assert.match(selectedRule, /background:\s*var\(--surface-guide-section\);/);
  assert.doesNotMatch(selectedRule, /(?:^|;)\s*color\s*:/);

  const appSource = await fs.readFile(path.join(__dirname, '../public/app.js'), 'utf8');
  const activeRefreshes = appSource.match(
    /'active',\s*!navigationExplicitSelectionMode\s*&&\s*button\.dataset\.pageId\s*===/g
  ) || [];
  assert.equal(activeRefreshes.length, 2);
  assert.match(appSource, /function renderPage\([\s\S]{0,1600}?'active',\s*!navigationExplicitSelectionMode/);
  assert.match(appSource, /function refreshActivePaneWindowChrome\([\s\S]{0,2000}?'active',\s*!navigationExplicitSelectionMode/);
});

test('navigation Move enters silent target-pick mode and only valid folders show the pointer hint', async () => {
  const { context, api, navigationMoveHint } = await navigationHarness();
  const child = { id: 'folder_child', label: 'Child', type: 'manual', source: { kind: 'manual', pageIds: [] }, children: [] };
  const parent = { id: 'folder_parent', label: 'Parent', type: 'manual', source: { kind: 'manual', pageIds: [] }, children: [child] };
  const other = { id: 'folder_other', label: 'Other', type: 'manual', source: { kind: 'manual', pageIds: [] }, children: [] };
  context.navigation = { version: 2, folders: [parent, other], items: [] };
  context.selectedNavigationItems.add('folder:folder_parent');
  context.selectedNavigationItems.add('page:page_1');

  api.openNavigationMoveMenu();
  assert.equal(context.navigationMoveMode.items.length, 2);
  assert.equal(navigationMoveHint.hidden, true);
  assert.equal(navigationMoveHint.children.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(api.selectedNavigationMoveItems())), [
    { type: 'folder', id: 'folder_parent' },
    { type: 'page', id: 'page_1' }
  ]);

  const parentRow = new FakeElement();
  api.showNavigationMoveTarget(parentRow, parent, { clientX: 40, clientY: 50 });
  assert.equal(navigationMoveHint.hidden, true);
  const otherRow = new FakeElement();
  api.showNavigationMoveTarget(otherRow, other, { clientX: 40, clientY: 50 });
  assert.equal(navigationMoveHint.hidden, false);
  assert.equal(navigationMoveHint.textContent, 'Move “2 items” to “Other”');
  assert.equal(otherRow.classList.contains('is-move-pick-target'), true);

  api.closeNavigationMoveMenu();
  assert.equal(context.selectedNavigationItems.size, 2);
  assert.equal(context.navigationMoveMode, null);
  assert.equal(navigationMoveHint.hidden, true);
});

test('Bind to Leader reuses target mode, rejects invalid rows, and commits once to the atomic endpoint', async () => {
  const { context, api, navigationMoveHint } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' },
    { id: 'page_c', title: 'Charlie' },
    { id: 'page_d', title: 'Delta' }
  ];
  context.pageIndex = { pages };
  context.navigation = {
    version: 3,
    folders: [],
    items: ['page_a', 'page_b', 'page_c'],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_d'] }]
  };
  context.selectedNavigationItems.add('page:page_b');
  context.selectedNavigationItems.add('page:page_c');

  assert.equal(api.openNavigationBindingMenu(), true);
  assert.equal(context.navigationMoveMode.kind, 'bind-to-leader');
  assert.deepEqual(Array.from(context.navigationMoveMode.selectedPageIds), ['page_b', 'page_c']);

  const targetRow = new FakeElement('button');
  api.showNavigationBindingTarget(targetRow, pages[0], { clientX: 40, clientY: 50 });
  assert.equal(targetRow.classList.contains('is-binding-pick-target'), true);
  assert.equal(navigationMoveHint.textContent, 'Bind 2 Pages to Alpha');
  assert.equal(api.navigationBindingTargetError(pages[1]), 'A selected Page cannot be its own Leader.');
  assert.equal(api.navigationBindingTargetError(pages[3]), 'A Follower cannot be selected as Leader.');
  assert.equal(
    api.navigationBindingTargetError(pages[0], { synthetic: true }),
    'Choose a Page in its root or manual folder location.'
  );

  let requestCall = null;
  context.request = async (url, options) => {
    requestCall = { url, options };
    return {
      navigation: {
        version: 3, folders: [], items: ['page_a'],
        bindings: [{
          id: 'binding_1', leaderPageId: 'page_a',
          followerPageIds: ['page_d', 'page_b', 'page_c']
        }]
      }
    };
  };
  assert.equal(await api.commitNavigationBindingTarget(pages[0]), true);
  assert.equal(requestCall.url, '/api/navigation/bindings');
  assert.deepEqual(JSON.parse(requestCall.options.body), {
    selectedPageIds: ['page_b', 'page_c'], leaderPageId: 'page_a'
  });
  assert.equal(context.navigationMoveMode, null);
  assert.equal(context.selectedNavigationItems.size, 0);
});

test('Follower mutations use dedicated endpoints and follower placement movement is blocked in the UI', async () => {
  const { context, api } = await navigationHarness();
  context.pageIndex = { pages: [
    { id: 'page_a', title: 'Alpha' }, { id: 'page_b', title: 'Beta' }
  ] };
  context.navigation = {
    version: 3, folders: [], items: ['page_a'],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_b'] }]
  };
  const calls = [];
  context.request = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { navigation: context.navigation };
  };

  context.selectedNavigationItems.add('page:page_b');
  api.openNavigationMoveMenu();
  assert.equal(context.navigationMoveMode, null);

  assert.equal(await api.performNavigationBatchMove({
    items: [{ type: 'page', id: 'page_b' }]
  }, { parentFolderId: null }), false);
  assert.equal(calls.length, 0);

  await api.stopPageBinding('page_b');
  await api.setPageBindingLeader('page_b');
  assert.deepEqual(calls, [
    { url: '/api/navigation/bindings/stop', body: { followerPageId: 'page_b' } },
    { url: '/api/navigation/bindings/set-leader', body: { followerPageId: 'page_b' } }
  ]);
});

test('renderer sends authoritative-looking Binding role facts to the native Page menu', async () => {
  const { context, api } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' },
    { id: 'page_c', title: 'Charlie' }
  ];
  context.pageIndex = { pages };
  context.navigation = {
    version: 3, folders: [], items: ['page_a', 'page_c'],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_b'] }]
  };
  api.renderPageList();
  const event = {
    currentTarget: new FakeElement('button'),
    shiftKey: false, metaKey: false, altKey: false
  };

  await api.openPageContextMenu(event, pages[1]);
  assert.equal(context.lastNativeContextPayload.bindingRole, 'follower');
  assert.equal(context.lastNativeContextPayload.canStopBinding, true);
  assert.equal(context.lastNativeContextPayload.canSetBindingLeader, true);
  assert.equal(context.lastNativeContextPayload.canMoveNavigation, false);
  assert.equal(context.lastNativeContextPayload.canStickNavigation, false);
  assert.equal(context.lastNativeContextPayload.canBindToLeader, false);

  context.selectedNavigationItems.add('page:page_c');
  await api.openPageContextMenu(event, pages[1]);
  assert.equal(context.lastNativeContextPayload.selectedCount, 2);
  assert.equal(context.lastNativeContextPayload.canStickNavigation, false);
  assert.equal(context.lastNativeContextPayload.canStopBinding, false);

  await api.openPageContextMenu(event, pages[0]);
  assert.equal(context.lastNativeContextPayload.bindingRole, 'leader');
  assert.equal(context.lastNativeContextPayload.canStopBinding, false);
  assert.equal(context.lastNativeContextPayload.canBindToLeader, false);
  assert.equal(context.lastNativeContextPayload.canStickNavigation, true);

  await api.openPageContextMenu(event, pages[2]);
  assert.equal(context.lastNativeContextPayload.bindingRole, 'unbound');
  assert.equal(context.lastNativeContextPayload.canBindToLeader, true);
  assert.equal(context.lastNativeContextPayload.canMoveNavigation, true);
  assert.equal(context.lastNativeContextPayload.canStickNavigation, true);
});

test('root/manual projection paints real follower rows, preserves active/click identity, and flattens a hidden Leader', async () => {
  const { context, api, pageList } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' },
    { id: 'page_c', title: 'Charlie' },
    { id: 'page_z', title: 'Zulu' }
  ];
  context.pageIndex = { pages };
  context.currentPage = pages[1];
  context.navigation = {
    version: 3, folders: [], items: ['page_z', 'page_a'],
    bindings: [{
      id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_c', 'page_b']
    }]
  };
  api.renderPageList();

  assert.deepEqual(pageList.children.map((row) => row.dataset.pageId), [
    'page_a', 'page_b', 'page_c', 'page_z'
  ]);
  assert.equal(pageList.children[1].classList.contains('nav-binding-follower'), true);
  assert.equal(pageList.children[2].classList.contains('nav-binding-follower'), true);
  assert.equal(pageList.children[1].children[0].textContent, '↪');
  assert.equal(pageList.children[1].classList.contains('active'), true);
  assert.equal(pageList.children[0].classList.contains('active'), false);

  await pageList.children[1].listeners.get('click')({
    shiftKey: false, metaKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  });
  assert.equal(context.loadedPageId, 'page_b');
  const followerPointerEvent = { pointerId: 17 };
  pageList.children[1].listeners.get('pointerdown')(followerPointerEvent);
  assert.equal(context.sidebarDragStart.pageId, 'page_b');
  assert.equal(context.sidebarDragStart.button, pageList.children[1]);
  assert.equal(context.sidebarDragStart.event, followerPointerEvent);

  context.pageMatchesNavigationView = (page) => page.id !== 'page_a';
  api.renderPageList();
  assert.deepEqual(pageList.children.map((row) => row.dataset.pageId), [
    'page_b', 'page_c', 'page_z'
  ]);
  assert.equal(pageList.children.some((row) => row.classList.contains('nav-binding-follower')), false);
});

test('every sort mode positions groups by Leader and Followers by their own comparator keys', async () => {
  const { context, api, pageList } = await navigationHarness();
  const pages = [
    {
      id: 'page_a', title: 'Zulu',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z'
    },
    {
      id: 'page_b', title: 'Alpha',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z'
    },
    {
      id: 'page_c', title: 'Mike',
      createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
    },
    {
      id: 'page_d', title: 'Delta',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z'
    },
    {
      id: 'page_e', title: 'Echo',
      createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-02-04T00:00:00.000Z'
    },
    {
      id: 'page_f', title: 'Foxtrot',
      createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
    }
  ];
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const followerIdsByLeader = new Map([
    ['page_a', ['page_b', 'page_c']],
    ['page_d', ['page_e']]
  ]);
  context.pageIndex = { pages };
  context.navigation = {
    version: 3,
    folders: [],
    items: ['page_a', 'page_d', 'page_f'],
    bindings: [
      { id: 'binding_a', leaderPageId: 'page_a', followerPageIds: ['page_b', 'page_c'] },
      { id: 'binding_d', leaderPageId: 'page_d', followerPageIds: ['page_e'] }
    ]
  };

  for (const { value: mode } of navigationSort.SORT_OPTIONS) {
    context.navigationSortMode = mode;
    api.renderPageList();
    const expected = navigationSort.sortPages(
      ['page_a', 'page_d', 'page_f'].map((pageId) => pagesById.get(pageId)),
      mode
    ).flatMap((leader) => [
      leader.id,
      ...navigationSort.sortPages(
        (followerIdsByLeader.get(leader.id) || []).map((pageId) => pagesById.get(pageId)),
        mode
      ).map((page) => page.id)
    ]);
    assert.deepEqual(
      pageList.children.map((row) => row.dataset.pageId),
      expected,
      mode
    );
  }
});

test('drag and menu are wired to one batch endpoint and success clears selection with named feedback', async () => {
  const { context, source, api } = await navigationHarness();
  assert.match(source, /clearNavigationSelection\(\);[\s\S]*?openPageFromSidebar\(page\.id\)/);
  assert.match(source, /clearNavigationSelection\(\);\s*toggleNavigationFolder\(folder\);/);
  assert.match(source, /performNavigationBatchMove\(payload, \{ parentFolderId: targetFolder\.id \}\)/);
  assert.match(source, /function commitSidebarPageNavigationMembershipDrop[\s\S]*?performNavigationBatchMove\([\s\S]*?sidebarPageNavigationPayload\(descriptor\),[\s\S]*?parentFolderId: target\.parentFolderId \|\| null/);
  assert.match(source, /navigationContextSurface\.addEventListener\('drop'[\s\S]*?performNavigationBatchMove\(payload, \{ parentFolderId: null \}\)/);
  assert.match(source, /function navigationRootDropEventEligible[\s\S]*?#descriptor-search-panel, #filter-panel/);
  assert.match(source, /function updateSidebarPageNavigationMembershipTarget[\s\S]*?#descriptor-search-panel, #filter-panel[\s\S]*?return null/);
  assert.match(source, /navigationContextSurface\.addEventListener\('dragover'[\s\S]*?!navigationRootDropEventEligible\(event\)[\s\S]*?clearSidebarPageNavigationMembershipTarget\(\);[\s\S]*?return/);
  assert.match(source, /navigationContextSurface\.addEventListener\('drop'[\s\S]*?!navigationRootDropEventEligible\(event\)[\s\S]*?clearSidebarPageNavigationMembershipTarget\(\);[\s\S]*?return/);

  const target = {
    id: 'folder_target',
    label: 'Metabolism',
    type: 'manual',
    source: { kind: 'manual', pageIds: [] },
    children: []
  };
  context.navigation = { version: 2, folders: [target], items: [] };
  context.selectedNavigationItems.add('page:page_1');
  context.selectedNavigationItems.add('page:page_2');
  let requestCall = null;
  let feedback = '';
  context.request = async (url, options) => {
    requestCall = { url, options };
    return {
      navigation: { version: 2, folders: [], items: [] },
      movedItems: [{ type: 'page', id: 'page_1' }, { type: 'page', id: 'page_2' }],
      changed: true
    };
  };
  context.showRuntimeStatus = (ownerRuntime, message) => {
    assert.strictEqual(ownerRuntime, context.activePaneRuntime());
    feedback = message;
  };
  const completed = await api.performNavigationBatchMove({
    items: [{ type: 'page', id: 'page_1' }, { type: 'page', id: 'page_2' }]
  }, { parentFolderId: 'folder_target' });
  assert.equal(completed, true);
  assert.equal(requestCall.url, '/api/navigation/move');
  assert.deepEqual(JSON.parse(requestCall.options.body).items.map((item) => item.id), [
    'page_1', 'page_2'
  ]);
  assert.equal(context.selectedNavigationItems.size, 0);
  assert.equal(feedback, 'Moved 2 items to “Metabolism”');
});

test('custom Page drag adopts a 12-Page selection and commits one canonical container payload', async () => {
  const { context, api, sidebarMotionCalls } = await navigationHarness();
  const target = {
    id: 'folder_target',
    label: 'Target',
    type: 'manual',
    source: { kind: 'manual', pageIds: [] },
    children: []
  };
  const pages = Array.from({ length: 12 }, (_, index) => ({
    id: `page_${index + 1}`,
    title: index === 4 ? 'Name abcdefghijklmnopqrstuvwxyz' : `Page ${index + 1}`
  }));
  context.navigation = { version: 3, folders: [target], items: pages.map((page) => page.id) };
  context.pageIndex = { pages };
  for (const page of pages) context.selectedNavigationItems.add(`page:${page.id}`);
  const calls = [];
  context.request = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    calls.push({ url, body: requestBody });
    return {
      navigation: context.navigation,
      movedItems: requestBody.items,
      changed: true
    };
  };

  const before = JSON.stringify(context.navigation);
  for (const page of pages) api.rememberNavigationVisibleItem(`page:${page.id}`);
  const descriptor = api.beginSidebarPageNavigationDrag(
    api.navigationPageDragDescriptor('page_5'), 320, 180
  );
  assert.deepEqual([...descriptor.items].map((item) => item.id), pages.map((page) => page.id));
  assert.deepEqual([...descriptor.effectivePageIds], pages.map((page) => page.id));
  assert.deepEqual([...descriptor.extractPageIds], pages.map((page) => page.id));
  assert.deepEqual([...descriptor.deferredPageIds], []);
  assert.deepEqual([...descriptor.tabPageIds], pages.map((page) => page.id));
  assert.equal(descriptor.explicitMultiSelection, true);
  assert.equal(descriptor.primaryPageId, 'page_5');
  assert.equal(descriptor.primaryName, 'Name abcdefghijklmnopqrstuvwxyz');
  assert.equal(descriptor.spatialPreviewEligible, false);
  assert.equal(JSON.stringify(context.navigation), before, 'threshold extraction is presentation-only');
  assert.equal(calls.length, 0, 'beginning the drag does not commit membership');
  const begin = sidebarMotionCalls.find((call) => call.method === 'beginDrag');
  assert.deepEqual([...begin.options.effectivePageIds], pages.map((page) => page.id));
  assert.deepEqual([...begin.options.extractPageIds], pages.map((page) => page.id));
  assert.deepEqual([...begin.options.deferredPageIds], []);
  assert.deepEqual(JSON.parse(JSON.stringify(begin.options.pointer)), { x: 320, y: 180 });

  assert.equal(api.updateSidebarPageNavigationDragPointer(descriptor, 333, 194), true);
  assert.equal(await api.commitSidebarPageNavigationMembershipDrop(descriptor, {
    kind: 'folder', parentFolderId: 'folder_target', invalid: false
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/navigation/move');
  assert.deepEqual(calls[0].body, {
    items: pages.map((page) => ({ type: 'page', id: page.id })),
    destination: { parentFolderId: 'folder_target' }
  });
  assert.equal(Object.hasOwn(calls[0].body.destination, 'index'), false);
  assert.equal(Object.hasOwn(calls[0].body.destination, 'area'), false);
  assert.equal(sidebarMotionCalls.some((call) => (
    call.method === 'commitDrag' && call.session === descriptor.motionSession
  )), true);
});

test('explicit multi drag follows visible navigation order, independent of selection insertion order', async () => {
  const { context, api } = await navigationHarness();
  const pages = [
    { id: 'alpha', title: 'Alpha' },
    { id: 'beta', title: 'Beta' },
    { id: 'gamma', title: 'Gamma' },
    { id: 'delta', title: 'Delta' }
  ];
  context.pageIndex = { pages };
  context.navigation = { version: 3, folders: [], items: pages.map((page) => page.id) };
  for (const pageId of ['gamma', 'alpha', 'delta', 'beta']) {
    context.selectedNavigationItems.add(`page:${pageId}`);
  }
  for (const pageId of ['alpha', 'beta', 'gamma', 'delta']) {
    api.rememberNavigationVisibleItem(`page:${pageId}`);
  }

  const descriptor = api.navigationPageDragDescriptor('gamma');
  const visibleOrder = ['alpha', 'beta', 'gamma', 'delta'];
  assert.deepEqual([...descriptor.items].map((item) => item.id), visibleOrder);
  assert.deepEqual([...descriptor.extractPageIds], visibleOrder);
  assert.deepEqual([...descriptor.tabPageIds], visibleOrder);
  assert.equal(descriptor.explicitMultiSelection, true);
  assert.equal(descriptor.spatialPreviewEligible, false);
});

test('Page drag ignores selected Folders while preserving the explicit selection owner', async () => {
  const { context, api } = await navigationHarness();
  const pages = [
    { id: 'alpha', title: 'Alpha' },
    { id: 'beta', title: 'Beta' },
    { id: 'current', title: 'Current' }
  ];
  context.pageIndex = { pages };
  context.currentPage = pages[2];
  context.navigation = { version: 3, folders: [], items: pages.map((page) => page.id) };
  context.navigationExplicitSelectionMode = true;
  for (const key of ['page:beta', 'folder:manual', 'page:alpha']) {
    context.selectedNavigationItems.add(key);
  }
  for (const pageId of ['alpha', 'beta', 'current']) {
    api.rememberNavigationVisibleItem(`page:${pageId}`);
  }

  const pageBatch = api.navigationPageDragDescriptor('beta');
  assert.equal(pageBatch.explicitMultiSelection, true);
  assert.equal(pageBatch.spatialPreviewEligible, false);
  assert.deepEqual([...pageBatch.items].map((item) => item.id), ['alpha', 'beta']);
  assert.deepEqual([...context.selectedNavigationItems], [
    'page:beta', 'folder:manual', 'page:alpha'
  ]);
  assert.equal(context.navigationExplicitSelectionMode, true);

  context.selectedNavigationItems.clear();
  context.selectedNavigationItems.add('page:alpha');
  context.selectedNavigationItems.add('folder:manual');
  const onePage = api.navigationPageDragDescriptor('alpha');
  assert.equal(onePage.explicitMultiSelection, false);
  assert.equal(onePage.spatialPreviewEligible, true);
  assert.deepEqual(JSON.parse(JSON.stringify(onePage.items)), [
    { type: 'page', id: 'alpha' }
  ]);
  assert.deepEqual([...context.selectedNavigationItems], ['page:alpha', 'folder:manual']);
  assert.equal(context.navigationExplicitSelectionMode, true);
});

test('single Binding Leader defers Followers, while a single Follower stays independently spatial but canonically immovable', async () => {
  const { context, api, sidebarMotionCalls } = await navigationHarness();
  const pages = [
    { id: 'leader', title: 'Leader' },
    { id: 'follower_a', title: 'Follower A' },
    { id: 'follower_b', title: 'Follower B' }
  ];
  context.pageIndex = { pages };
  context.navigation = {
    version: 3,
    folders: [],
    items: ['leader'],
    bindings: [{
      id: 'binding_1',
      leaderPageId: 'leader',
      followerPageIds: ['follower_a', 'follower_b', 'follower_a']
    }]
  };
  context.selectedNavigationItems.add('page:leader');

  const before = JSON.stringify(context.navigation);
  const descriptor = api.beginSidebarPageNavigationDrag(
    api.navigationPageDragDescriptor('leader'), 100, 70
  );
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.items)), [
    { type: 'page', id: 'leader' }
  ]);
  assert.deepEqual([...descriptor.effectivePageIds], ['leader', 'follower_a', 'follower_b']);
  assert.deepEqual([...descriptor.extractPageIds], ['leader']);
  assert.deepEqual([...descriptor.deferredPageIds], ['follower_a', 'follower_b']);
  assert.deepEqual([...descriptor.tabPageIds], ['leader']);
  assert.equal(descriptor.explicitMultiSelection, false);
  assert.equal(descriptor.spatialPreviewEligible, true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.sidebarPageNavigationPayload(descriptor))), {
    items: [{ type: 'page', id: 'leader' }]
  });
  assert.equal(JSON.stringify(context.navigation), before);
  const leaderBegin = sidebarMotionCalls.find((call) => call.method === 'beginDrag');
  assert.deepEqual([...leaderBegin.options.extractPageIds], ['leader']);
  assert.deepEqual([...leaderBegin.options.deferredPageIds], ['follower_a', 'follower_b']);

  assert.equal(api.handoffSidebarPageNavigationDragToPreview(descriptor), true);
  assert.equal(sidebarMotionCalls.at(-1).method, 'handoffDrag');
  assert.equal(sidebarMotionCalls.at(-1).session, descriptor.motionSession);

  const single = api.navigationPageDragDescriptor('follower_a');
  assert.deepEqual(JSON.parse(JSON.stringify(single.items)), [
    { type: 'page', id: 'follower_a' }
  ]);
  assert.deepEqual([...single.effectivePageIds], ['follower_a']);
  assert.deepEqual([...single.extractPageIds], ['follower_a']);
  assert.deepEqual([...single.deferredPageIds], []);
  assert.deepEqual([...single.tabPageIds], ['follower_a']);
  assert.equal(single.explicitMultiSelection, false);
  assert.equal(single.spatialPreviewEligible, true);

  let requestCount = 0;
  let feedback = '';
  context.request = async () => {
    requestCount += 1;
    throw new Error('Follower rejection must not reach the move endpoint');
  };
  context.showRuntimeStatus = (ownerRuntime, message) => {
    assert.strictEqual(ownerRuntime, context.activePaneRuntime());
    feedback = message;
  };
  const followerDescriptor = api.beginSidebarPageNavigationDrag(
    api.navigationPageDragDescriptor('follower_a'), 110, 80
  );
  assert.equal(await api.commitSidebarPageNavigationMembershipDrop(followerDescriptor, {
    kind: 'folder', parentFolderId: 'target', invalid: false, error: null
  }), false);
  assert.equal(requestCount, 0);
  assert.equal(feedback, 'Stop Binding before moving a Follower independently.');
  assert.equal(sidebarMotionCalls.at(-1).method, 'restoreDrag');
  assert.equal(sidebarMotionCalls.at(-1).session, followerDescriptor.motionSession);
  assert.equal(sidebarMotionCalls.at(-1).options.reason, 'bound-follower-rejected');

  const restoreDescriptor = api.beginSidebarPageNavigationDrag(
    api.navigationPageDragDescriptor('leader'), 120, 90
  );
  assert.equal(await api.commitSidebarPageNavigationMembershipDrop(restoreDescriptor, {
    kind: 'folder', parentFolderId: 'missing', invalid: true, error: 'Invalid target'
  }), false);
  assert.equal(sidebarMotionCalls.at(-1).method, 'restoreDrag');
  assert.equal(sidebarMotionCalls.at(-1).options.reason, 'invalid-target');
  assert.equal(JSON.stringify(context.navigation), before);
});

test('navigation sort menu opens with grouped choices, checkmark, toggle, Escape, and immediate selection', async () => {
  const { api, context, navigationSortMenu, navigationSortButton } = await navigationHarness();
  api.openNavigationSortMenu();
  assert.equal(navigationSortMenu.hidden, false);
  assert.equal(navigationSortButton.getAttribute('aria-expanded'), 'true');
  const options = navigationSortMenu.children.filter((item) => (
    item.classList.contains('navigation-sort-option')
  ));
  assert.deepEqual(options.map((item) => item.children[1].textContent), [
    'File name (A to Z)',
    'File name (Z to A)',
    'Modified time (new to old)',
    'Modified time (old to new)',
    'Created time (new to old)',
    'Created time (old to new)'
  ]);
  assert.equal(navigationSortMenu.children.filter((item) => (
    item.classList.contains('navigation-sort-separator')
  )).length, 2);
  assert.equal(options[0].getAttribute('aria-checked'), 'true');
  assert.equal(options[0].children[0].textContent, '✓');

  api.toggleNavigationSortMenu();
  assert.equal(navigationSortMenu.hidden, true);
  api.toggleNavigationSortMenu();
  let prevented = false;
  api.handleNavigationSortMenuKeyDown({
    key: 'Escape',
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });
  assert.equal(prevented, true);
  assert.equal(navigationSortMenu.hidden, true);

  api.openNavigationSortMenu();
  const modifiedDescending = navigationSortMenu.children.find((item) => (
    item.dataset.sortMode === 'modified_desc'
  ));
  modifiedDescending.listeners.get('click')();
  assert.equal(context.navigationSortMode, 'modified_desc');
  assert.equal(navigationSortMenu.hidden, true);
});

test('sort changes rendered order only while preserving selection, current page, and expansion state', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folder = {
    id: 'folder_z', label: 'Folder Z', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.pageIndex = {
    pages: [
      { id: 'page_a', title: 'Page 2' },
      { id: 'page_b', title: 'Page 10' }
    ]
  };
  context.navigation = { version: 2, folders: [folder], items: ['page_b', 'page_a'] };
  context.currentPage = { id: 'page_b', title: 'Page 10' };
  context.selectedNavigationItems.add('page:page_b');
  const navigationBefore = JSON.stringify(context.navigation);

  api.applyNavigationSortMode('name_asc', { persist: false });
  assert.equal(JSON.stringify(context.navigation), navigationBefore);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_b']);
  assert.equal(context.currentPage.id, 'page_b');
  assert.equal(folder.collapsed, true);
  assert.deepEqual(
    pageList.children.map((item) => item.dataset.folderId || item.dataset.pageId),
    ['folder_z', 'page_a', 'page_b']
  );
  assert.deepEqual(
    pageList.children.filter((item) => item.dataset.pageId).map((item) => item.dataset.pageId),
    ['page_a', 'page_b']
  );
  const selectedRow = pageList.children.find((item) => item.dataset.pageId === 'page_b');
  assert.equal(selectedRow.classList.contains('nav-selected'), true);
});

test('root navigation sorts all Folders before sorting root Pages', async () => {
  const { api, context } = await navigationHarness();
  context.pageIndex = {
    pages: [
      { id: 'page_2', title: 'Page 2' },
      { id: 'page_10', title: 'Page 10' }
    ]
  };
  context.navigation = {
    version: 2,
    folders: [
      {
        id: 'folder_alpha', label: 'Alpha', type: 'manual', collapsed: true,
        source: { kind: 'manual', pageIds: [] }, children: []
      },
      {
        id: 'folder_uncategorised', label: 'Uncategory', type: 'system', collapsed: true,
        source: { kind: 'missingCategories' }, projectedPageIds: [], children: []
      },
      {
        id: 'folder_zulu', label: 'Zulu', type: 'manual', collapsed: true,
        source: { kind: 'manual', pageIds: [] }, children: []
      }
    ],
    items: ['page_2', 'page_10']
  };
  context.navigationSortMode = 'name_desc';
  assert.deepEqual(
    Array.from(api.rootNavigationEntries(), (entry) => entry.folder?.id || entry.page?.id),
    ['folder_uncategorised', 'folder_zulu', 'folder_alpha', 'page_10', 'page_2']
  );
});

test('each rendered directory level keeps folders before pages in every sort mode', async () => {
  const { api, context, pageList } = await navigationHarness();
  const child = {
    id: 'folder_child', label: 'Child', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  const parent = {
    id: 'folder_parent', label: 'Parent', type: 'manual', collapsed: false,
    source: { kind: 'manual', pageIds: ['page_inside'] }, children: [child]
  };
  context.pageIndex = {
    pages: [{
      id: 'page_inside', title: 'Inside', updatedAt: '2026-02-01T00:00:00.000Z'
    }]
  };
  context.navigation = { version: 2, folders: [parent], items: [] };
  api.applyNavigationSortMode('modified_desc', { persist: false });
  const parentRows = pageList.children[0].children[1].children;
  assert.equal(parentRows[0].dataset.folderId, 'folder_child');
  assert.equal(parentRows[1].dataset.pageId, 'page_inside');
});

test('successful expanded-folder moves render the canonical A-Z, Z-A, and date result', async () => {
  const pages = [
    { id: 'page_alpha', title: 'Alpha', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'page_beta', title: 'Beta', updatedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'page_gamma', title: 'Gamma', updatedAt: '2026-02-01T00:00:00.000Z' }
  ];
  const cases = [
    ['name_asc', ['page_alpha', 'page_beta', 'page_gamma']],
    ['name_desc', ['page_gamma', 'page_beta', 'page_alpha']],
    ['modified_desc', ['page_beta', 'page_gamma', 'page_alpha']]
  ];

  for (const [sortMode, expected] of cases) {
    const { api, context, pageList } = await navigationHarness();
    const folder = {
      id: 'folder_target', label: 'Target', type: 'manual', collapsed: false,
      source: { kind: 'manual', pageIds: ['page_alpha', 'page_gamma'] }, children: []
    };
    context.pageIndex = { pages };
    context.navigation = { version: 3, folders: [folder], items: ['page_beta'] };
    context.selectedNavigationItems.add('page:page_beta');
    let requestCount = 0;
    context.request = async () => {
      requestCount += 1;
      return {
        navigation: {
          version: 3,
          folders: [{
            ...folder,
            source: { kind: 'manual', pageIds: ['page_alpha', 'page_gamma', 'page_beta'] }
          }],
          items: []
        },
        movedItems: [{ type: 'page', id: 'page_beta' }],
        changed: true
      };
    };
    api.applyNavigationSortMode(sortMode, { persist: false });
    await api.performNavigationBatchMove({
      items: [{ type: 'page', id: 'page_beta' }]
    }, { parentFolderId: 'folder_target' });

    const target = pageList.children.find((item) => item.dataset.folderId === 'folder_target');
    assert.equal(requestCount, 1, sortMode);
    assert.equal(target.children[1].classList.contains('nav-folder-pages'), true, sortMode);
    assert.deepEqual(
      target.children[1].children.map((item) => item.dataset.pageId),
      expected,
      sortMode
    );
    assert.equal(context.selectedNavigationItems.size, 0, sortMode);
  }
});

test('folder rename keeps its current position while editing and relocates only after commit', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folderA = {
    id: 'folder_a', label: 'Alpha', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  const folderB = {
    id: 'folder_b', label: 'Zulu', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation = { version: 2, folders: [folderB, folderA], items: [] };
  api.applyNavigationSortMode('name_asc', { persist: false });
  api.startFolderRename(folderB);
  assert.deepEqual(pageList.children.map((item) => item.dataset.folderId), ['folder_a', 'folder_b']);
  const folderBRow = pageList.children.find((item) => item.dataset.folderId === 'folder_b');
  const editorButton = folderBRow.children.find((item) => (
    item.classList.contains('nav-folder-button')
  ));
  const input = pageList.querySelector('[data-folder-rename-input="folder_b"]');
  assert.equal(editorButton.classList.contains('nav-folder-renaming'), true);
  assert.equal(editorButton.children[0].classList.contains('nav-folder-disclosure-button'), true);
  assert.equal(editorButton.children[1], input);
  input.value = 'Aardvark';
  assert.deepEqual(pageList.children.map((item) => item.dataset.folderId), ['folder_a', 'folder_b']);

  context.request = async () => ({
    navigation: {
      version: 2,
      folders: [{ ...folderB, label: 'Aardvark' }, folderA],
      items: []
    }
  });
  await api.saveFolderRename(input);
  assert.deepEqual(pageList.children.map((item) => item.dataset.folderId), ['folder_b', 'folder_a']);
});

test('navigation rename keeps one editor DOM node and a local draft across unrelated renders', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folderA = {
    id: 'folder_a', label: 'Alpha', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  const folderB = {
    id: 'folder_b', label: 'Zulu', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation = { version: 2, folders: [folderB, folderA], items: [] };
  api.applyNavigationSortMode('name_asc', { persist: false });
  api.startFolderRename(folderB);

  const originalChildren = pageList.children;
  const originalInput = pageList.querySelector('[data-folder-rename-input="folder_b"]');
  originalInput.value = 'Aardvark';
  originalInput.listeners.get('input')({ target: originalInput });

  api.renderPageList();

  assert.equal(pageList.children, originalChildren);
  assert.equal(pageList.querySelector('[data-folder-rename-input="folder_b"]'), originalInput);
  assert.equal(context.folderRenameState.draft, 'Aardvark');
  assert.equal(folderB.label, 'Zulu');
  assert.deepEqual(pageList.children.map((item) => item.dataset.folderId), ['folder_a', 'folder_b']);
});

test('first rename keystroke cannot reparent the editor and queued renders flush once after commit', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folderA = {
    id: 'folder_a', label: 'Alpha', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  const folderB = {
    id: 'folder_b', label: 'Zulu', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation = { version: 2, folders: [folderB, folderA], items: [] };
  api.applyNavigationSortMode('name_asc', { persist: false });
  api.startFolderRename(folderB, { selectAll: true });

  const editorRow = pageList.children.find((item) => item.dataset.folderId === folderB.id);
  const editorParent = editorRow.parentElement;
  const editorIndex = editorParent.children.indexOf(editorRow);
  const input = pageList.querySelector('[data-folder-rename-input="folder_b"]');
  const replacementsBeforeTyping = pageList.replaceChildrenCount;

  input.value = 'Aardvark';
  input.listeners.get('input')({ target: input });
  api.renderPageList();
  api.renderPageList({ force: true });

  assert.equal(pageList.querySelector('[data-folder-rename-input="folder_b"]'), input);
  assert.equal(editorRow.parentElement, editorParent);
  assert.equal(editorParent.children.indexOf(editorRow), editorIndex);
  assert.equal(pageList.replaceChildrenCount, replacementsBeforeTyping);
  assert.equal(context.folderRenameState.draft, 'Aardvark');
  assert.equal(folderB.label, 'Zulu');

  context.request = async () => ({
    navigation: {
      version: 2,
      folders: [{ ...folderB, label: 'Aardvark' }, folderA],
      items: []
    }
  });
  await api.saveFolderRename(input);
  assert.equal(pageList.replaceChildrenCount, replacementsBeforeTyping + 1);
  assert.equal(pageList.querySelector('[data-folder-rename-input="folder_b"]'), null);
});

test('native Page Rename keeps its captured row and exact input node through the first character', async () => {
  const { api, context, pageList, source } = await navigationHarness();
  const pageA = { id: 'page_a', title: 'Alpha' };
  const pageB = { id: 'page_b', title: 'Zulu' };
  context.pageIndex = { pages: [pageA, pageB] };
  context.navigation = { version: 2, folders: [], items: [pageB.id, pageA.id] };
  api.applyNavigationSortMode('name_asc', { persist: false });
  const sourceRow = pageList.children.find((item) => item.dataset.pageId === pageB.id);
  const sourceParent = sourceRow.parentElement;
  const sourceIndex = sourceParent.children.indexOf(sourceRow);
  context.nextNativeContextCommand = 'rename-page';

  await api.openPageContextMenu({
    currentTarget: sourceRow,
    preventDefault() {},
    stopPropagation() {},
    shiftKey: false,
    metaKey: false,
    altKey: false
  }, pageB);

  const editorRow = sourceParent.children[sourceIndex];
  const input = pageList.querySelector('[data-page-rename-input="page_b"]');
  assert.ok(input);
  assert.equal(editorRow.parentElement, sourceParent);
  assert.equal(sourceParent.children.indexOf(editorRow), sourceIndex);

  input.value = 'Aardvark';
  input.listeners.get('input')({ target: input });
  api.renderPageList();

  assert.equal(pageList.querySelector('[data-page-rename-input="page_b"]'), input);
  assert.equal(editorRow.parentElement, sourceParent);
  assert.equal(sourceParent.children.indexOf(editorRow), sourceIndex);
  assert.equal(context.pageRenameState.draft, 'Aardvark');
  assert.equal(pageB.title, 'Zulu');
  assert.doesNotMatch(source, /TEMP_RENAME_DIAGNOSTIC|rename-diag|__renameDiagnostic/);
});

test('Page rename draft stays local and IME confirmation does not commit or recreate the editor', async () => {
  const { api, context, pageList } = await navigationHarness();
  const page = { id: 'page_one', title: 'Original' };
  context.pageIndex = { pages: [page] };
  context.navigation = { version: 2, folders: [], items: [page.id] };
  let requestCount = 0;
  context.request = async (url) => {
    requestCount += 1;
    if (url === '/api/page-index') return { pages: [{ ...page, title: '生物化学' }] };
    return { ...page, title: '生物化学' };
  };
  api.startPageRename(page);

  const input = pageList.querySelector('[data-page-rename-input="page_one"]');
  input.listeners.get('compositionstart')({ target: input });
  input.value = '生物化学';
  input.listeners.get('input')({ target: input });
  let prevented = 0;
  let stopped = 0;
  let blurCount = 0;
  const blur = input.blur.bind(input);
  input.blur = () => {
    blurCount += 1;
    blur();
  };
  input.listeners.get('keydown')({
    key: 'Enter', isComposing: false, keyCode: 13,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  });
  api.renderPageList();

  assert.equal(requestCount, 0);
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);
  assert.equal(blurCount, 0);
  assert.equal(context.pageRenameState.draft, '生物化学');
  assert.equal(context.pageRenameState.isComposing, true);
  assert.equal(page.title, 'Original');
  assert.equal(pageList.querySelector('[data-page-rename-input="page_one"]'), input);

  input.listeners.get('compositionend')({ target: input });
  assert.equal(requestCount, 0);
  assert.equal(context.pageRenameState.isComposing, false);

  input.listeners.get('keydown')({
    key: 'Enter', isComposing: false, keyCode: 13,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(blurCount, 1);
  assert.equal(requestCount, 2);
});

test('Escape discards a navigation rename draft without changing data or ordering', async () => {
  const { api, context, pageList } = await navigationHarness();
  const pageA = { id: 'page_a', title: 'Alpha' };
  const pageB = { id: 'page_b', title: 'Zulu' };
  context.pageIndex = { pages: [pageA, pageB] };
  context.navigation = { version: 2, folders: [], items: [pageB.id, pageA.id] };
  api.applyNavigationSortMode('name_asc', { persist: false });
  api.startPageRename(pageB);
  const input = pageList.querySelector('[data-page-rename-input="page_b"]');
  input.value = 'Aardvark';
  input.listeners.get('input')({ target: input });
  input.listeners.get('keydown')({
    key: 'Escape', isComposing: false, keyCode: 27,
    preventDefault() {}, stopPropagation() {}
  });

  assert.equal(context.pageRenameState, null);
  assert.equal(pageB.title, 'Zulu');
  assert.deepEqual(
    pageList.children.filter((item) => item.dataset.pageId).map((item) => item.dataset.pageId),
    ['page_a', 'page_b']
  );
});

test('Page and manual Folder labels act immediately and expose rename only through context actions', async () => {
  const { api, context, pageList, source } = await navigationHarness();
  const page = { id: 'page_one', title: 'One' };
  const folder = {
    id: 'folder_one', label: 'Folder', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.pageIndex = { pages: [page] };
  context.navigation = { version: 2, folders: [folder], items: ['page_one'] };
  context.request = async () => context.navigation;
  api.renderPageList();

  const pageRow = pageList.children.find((item) => item.dataset.pageId === page.id);
  const clickEvent = () => ({
    detail: 1, preventDefault() {}, stopPropagation() {},
    shiftKey: false, metaKey: false, altKey: false
  });
  pageRow.listeners.get('click')(clickEvent());
  assert.equal(context.loadedPageId, page.id);
  assert.equal(pageRow.listeners.has('dblclick'), false);

  context.loadedPageId = undefined;
  pageRow.listeners.get('click')({ ...clickEvent(), detail: 1 });
  pageRow.listeners.get('click')({ ...clickEvent(), detail: 2 });
  assert.equal(context.loadedPageId, page.id);
  assert.equal(context.pageRenameState, null);

  context.pageContextTarget = page;
  context.pageContextSynthetic = false;
  api.renameContextPage();
  assert.equal(context.pageRenameState.pageId, page.id);

  api.cancelPageRename();
  const folderRow = pageList.children.find((item) => item.dataset.folderId === folder.id);
  const nameButton = folderRow.children[0].children[1];
  nameButton.listeners.get('click')(clickEvent());
  assert.equal(folder.collapsed, false);
  assert.equal(nameButton.listeners.has('dblclick'), false);
  nameButton.listeners.get('click')({ ...clickEvent(), detail: 2 });
  assert.equal(folder.collapsed, true);
  assert.equal(context.folderRenameState, null);

  context.folderContextTarget = folder;
  api.renameContextFolder();
  assert.equal(context.folderRenameState.folderId, folder.id);

  assert.doesNotMatch(source, /NAVIGATION_LABEL_CLICK_DELAY|pendingSingleClick|bindNavigationLabelActivation/);
  const [html, nativeMenus] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/nativeContextMenu.js'), 'utf8')
  ]);
  assert.doesNotMatch(html, /page-context-menu|folder-context-menu/);
  assert.match(nativeMenus, /commandItem\('Rename', 'rename-page'/);
  assert.match(nativeMenus, /commandItem\('Rename', 'rename-folder'/);
});

test('Page Type badges are registry-driven row metadata for every Vault default', async () => {
  const { api, context } = await navigationHarness();
  const pages = [
    { id: 'page_canvas', title: 'Canvas page', type: pageTypesModel.PAGE_TYPES.CANVAS },
    {
      id: 'page_markdown',
      title: 'Name of pageeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      type: pageTypesModel.PAGE_TYPES.MARKDOWN
    },
    { id: 'page_cne', title: 'HN page', type: pageTypesModel.PAGE_TYPES.HN_TEXT }
  ];
  const expected = {
    [pageTypesModel.PAGE_TYPES.CANVAS]: [null, 'MD', 'HN'],
    [pageTypesModel.PAGE_TYPES.MARKDOWN]: ['CANVAS', null, 'HN'],
    [pageTypesModel.PAGE_TYPES.HN_TEXT]: ['CANVAS', 'MD', null]
  };
  const badgeFor = (row) => row.children.find((child) => (
    child.classList?.contains('nav-page-type-badge')
  )) || null;

  for (const [defaultPageType, expectedBadges] of Object.entries(expected)) {
    context.vaultPreferences = { defaultPageType };
    const rows = pages.map((page) => api.createPageListButton(page));
    assert.deepEqual(rows.map((row) => badgeFor(row)?.textContent || null), expectedBadges);
    for (const row of rows) {
      const badge = badgeFor(row);
      if (!badge) continue;
      assert.equal(row.children.at(-1), badge);
      assert.equal(badge.dataset.pageTypeBadge, badge.textContent);
      assert.equal(badge.classList.contains('system-typography'), true);
      assert.equal(badge.listeners.size, 0);
    }
  }

  context.vaultPreferences = { defaultPageType: pageTypesModel.PAGE_TYPES.MARKDOWN };
  const statusRow = api.createPageListButton(pages[0], '', {
    defaultPageId: pages[0].id,
    synthetic: false
  });
  assert.equal(statusRow.children[0].classList.contains('nav-page-status-gutter'), true);
  assert.equal(statusRow.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(statusRow.children[0].children[0].classList.contains('nav-page-status-group'), true);
  const statusIndicator = statusRow.children[0].children[0].children[0];
  assert.equal(statusIndicator.classList.contains('nav-page-status-indicator'), true);
  assert.equal(statusIndicator.getAttribute('aria-hidden'), 'true');
  assert.equal(statusIndicator.listeners.size, 0);
  assert.equal(statusRow.children[1].classList.contains('nav-page-label-text'), true);
  assert.equal(statusRow.children.at(-1).textContent, 'CANVAS');

  const followerRow = api.createPageListButton(pages[2], '', {
    bindingFollower: true,
    leaderPageId: pages[0].id
  });
  assert.equal(followerRow.children[0].classList.contains('nav-binding-follower-indicator'), true);
  assert.equal(followerRow.children[1].classList.contains('nav-page-label-text'), true);
  assert.equal(followerRow.children.at(-1).textContent, 'HN');

  context.navigation.pageStates = { page_cne: { stickOnTop: true } };
  const statusFollowerRow = api.createPageListButton(pages[2], '', {
    bindingFollower: true,
    leaderPageId: pages[0].id
  });
  assert.equal(statusFollowerRow.children[0].classList.contains('nav-page-status-gutter'), true);
  assert.equal(statusFollowerRow.children[1].classList.contains('nav-binding-follower-indicator'), true);
  assert.equal(statusFollowerRow.children[2].classList.contains('nav-page-label-text'), true);
  assert.equal(statusFollowerRow.children.at(-1).textContent, 'HN');

  const hnRow = api.createPageListButton(pages[2]);
  context.loadedPageId = null;
  hnRow.listeners.get('click')({
    target: badgeFor(hnRow),
    detail: 1,
    preventDefault() {},
    stopPropagation() {},
    shiftKey: false,
    metaKey: false,
    altKey: false
  });
  assert.equal(context.loadedPageId, pages[2].id);

  const unsupported = api.createPageListButton({
    id: 'page_future', title: 'Future', type: 'future-unregistered'
  });
  assert.equal(badgeFor(unsupported), null);
  const legacyCanvas = api.createPageListButton({ id: 'page_legacy', title: 'Legacy' });
  assert.equal(badgeFor(legacyCanvas).textContent, 'CANVAS');
  assert.deepEqual(pages.map(({ id, title, type }) => ({ id, title, type })), pages);
});

test('Page Type badges refresh during rename without remounting the input or draft', async () => {
  const { api, context, pageList } = await navigationHarness();
  const canvasPage = {
    id: 'page_canvas', title: 'Canvas', type: pageTypesModel.PAGE_TYPES.CANVAS
  };
  const markdownPage = {
    id: 'page_markdown', title: 'Markdown', type: pageTypesModel.PAGE_TYPES.MARKDOWN
  };
  context.pageIndex = { pages: [canvasPage, markdownPage] };
  context.navigation = {
    version: 2, folders: [], items: [canvasPage.id, markdownPage.id]
  };
  context.vaultPreferences = { defaultPageType: pageTypesModel.PAGE_TYPES.CANVAS };
  api.renderPageList();
  api.startPageRename(markdownPage);

  const editorRow = pageList.children.find((row) => row.dataset.pageId === markdownPage.id);
  const input = pageList.querySelector('[data-page-rename-input="page_markdown"]');
  const initialBadge = editorRow.querySelector('.nav-page-type-badge');
  assert.equal(initialBadge.textContent, 'MD');
  assert.equal(editorRow.children.at(-1), initialBadge);

  input.value = 'Markdown draft';
  input.listeners.get('input')({ target: input });
  input.listeners.get('compositionstart')({ target: input });
  context.vaultPreferences = { defaultPageType: pageTypesModel.PAGE_TYPES.MARKDOWN };
  api.renderPageList({ force: true });

  assert.equal(pageList.querySelector('[data-page-rename-input="page_markdown"]'), input);
  assert.equal(pageList.children.find((row) => row.dataset.pageId === markdownPage.id), editorRow);
  assert.equal(editorRow.querySelector('.nav-page-type-badge'), null);
  assert.equal(context.pageRenameState.draft, 'Markdown draft');
  assert.equal(context.pageRenameState.isComposing, true);
  const canvasRow = pageList.children.find((row) => row.dataset.pageId === canvasPage.id);
  assert.equal(canvasRow.querySelector('.nav-page-type-badge').textContent, 'CANVAS');

  context.vaultPreferences = { defaultPageType: pageTypesModel.PAGE_TYPES.HN_TEXT };
  api.renderPageList({ force: true });
  const refreshedBadge = editorRow.querySelector('.nav-page-type-badge');
  assert.equal(pageList.querySelector('[data-page-rename-input="page_markdown"]'), input);
  assert.equal(input.value, 'Markdown draft');
  assert.equal(refreshedBadge.textContent, 'MD');
  assert.equal(editorRow.children.at(-1), refreshedBadge);
});

test('Page rename replaces only the name slot and preserves status, Binding, and badge metadata', async () => {
  const { api, context, pageList } = await navigationHarness();
  const page = {
    id: 'page_metadata', title: 'Metadata', type: pageTypesModel.PAGE_TYPES.MARKDOWN
  };
  context.pageIndex = { pages: [page] };
  context.navigation = {
    version: 2,
    folders: [],
    items: [page.id],
    pageStates: { [page.id]: { stickOnTop: true } }
  };
  context.vaultPreferences = { defaultPageType: pageTypesModel.PAGE_TYPES.CANVAS };
  const sourceRow = api.createPageListButton(page, '', {
    bindingFollower: true,
    leaderPageId: 'page_leader',
    parentFolderId: 'folder_parent'
  });
  pageList.append(sourceRow);

  api.startPageRename(page, { sourceRow });

  const editorRow = pageList.children[0];
  const input = pageList.querySelector('[data-page-rename-input="page_metadata"]');
  const statusGutter = editorRow.children.find((child) => (
    child.classList.contains('nav-page-status-gutter')
  ));
  const follower = editorRow.children.find((child) => (
    child.classList.contains('nav-binding-follower-indicator')
  ));
  const badge = editorRow.querySelector('.nav-page-type-badge');
  assert.equal(editorRow.classList.contains('nav-page-renaming'), true);
  assert.equal(editorRow.dataset.bindingFollowerOf, 'page_leader');
  assert.ok(statusGutter);
  assert.ok(follower);
  assert.equal(editorRow.children.indexOf(input), editorRow.children.indexOf(follower) + 1);
  assert.equal(editorRow.children.at(-1), badge);
  assert.equal(badge.textContent, 'MD');
});

test('Folder rename replaces only the name control and keeps disclosure and pin slots', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folder = {
    id: 'folder_metadata', label: 'Folder', type: 'manual', collapsed: false,
    stickOnTop: true, source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation = { version: 2, folders: [folder], items: [] };
  api.renderPageList();
  api.startFolderRename(folder);

  const wrapper = pageList.children[0];
  const editorButton = wrapper.children.find((child) => (
    child.classList.contains('nav-folder-button')
  ));
  const input = pageList.querySelector('[data-folder-rename-input="folder_metadata"]');
  assert.equal(editorButton.classList.contains('nav-folder-renaming'), true);
  assert.equal(editorButton.children[0].classList.contains('nav-folder-disclosure-button'), true);
  assert.equal(editorButton.children[1], input);
  assert.equal(editorButton.children.at(-1).dataset.navigationIndicator, 'pinned');
});

test('Dynamic System Folders keep their existing non-renamable contract', async () => {
  const { api, context, pageList } = await navigationHarness();
  const folder = {
    id: 'folder_system', label: 'Uncategory', type: 'system', collapsed: true,
    source: { kind: 'category-unassigned' }, projectedPageIds: [], children: []
  };
  context.navigation = { version: 2, folders: [folder], items: [] };
  api.renderPageList();
  const originalRow = pageList.children[0];

  api.startFolderRename(folder);

  assert.equal(context.folderRenameState, null);
  assert.equal(pageList.children[0], originalRow);
  assert.equal(pageList.querySelector('[data-folder-rename-input="folder_system"]'), null);
});

test('navigation inline rename inputs inherit the row geometry and typography', async () => {
  const [css, navigationSource] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8'),
    fs.readFile(path.join(__dirname, '../public/js/navigation.js'), 'utf8')
  ]);
  assert.match(css, /\.page-link\.nav-page-renaming,[\s\S]*?\.nav-folder-button\.nav-folder-renaming \{[^}]*background: var\(--surface-guide-section\);[^}]*box-shadow: inset 0 0 0 2px var\(--border-guide\);/);
  assert.match(css, /\.nav-folder-rename-input,[\s\S]*?\.nav-page-rename-input \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*width: auto;[^}]*height: var\(--font-file-row-line-height\);[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*font: inherit;[^}]*line-height: inherit;[^}]*appearance: none;/);
  assert.match(css, /\.nav-folder-rename-input:focus,[\s\S]*?\.nav-page-rename-input:focus \{[^}]*outline: 0;[^}]*box-shadow: none;/);
  assert.doesNotMatch(css, /\.page-link\.nav-page-renaming \{[^}]*padding-block:\s*0/);
  assert.match(navigationSource, /nav-folder-label-text nav-folder-rename-input file-typography/);
  assert.match(navigationSource, /nav-page-label-text nav-page-rename-input file-typography/);
});

test('Page status gutter is Page-scoped, out of flow, and visible inside compensated clipping', async () => {
  const css = await fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
  const scrollRegion = css.match(/\.left-sidebar-scroll-region \{[^}]*\}/)?.[0] || '';
  const sizedScrollRegion = css.match(/\.left-sidebar > \.left-sidebar-scroll-region \{[^}]*\}/)?.[0] || '';
  const gutter = css.match(/\.nav-page-status-gutter \{[^}]*\}/)?.[0] || '';
  const group = css.match(/\.nav-page-status-group \{[^}]*\}/)?.[0] || '';
  const pageIndicator = css.match(/\.nav-page-status-group \.nav-row-indicator \{[^}]*\}/)?.[0] || '';
  const sharedIndicator = css.match(/(?:^|\n)\.nav-row-indicator \{[^}]*\}/)?.[0] || '';

  assert.match(scrollRegion, /margin: 1\.25rem 1\.25rem 0 0/);
  assert.match(scrollRegion, /padding-left: 1\.25rem/);
  assert.match(scrollRegion, /overflow-x: hidden/);
  assert.match(sizedScrollRegion, /width: calc\(var\(--left-sidebar-width\) - 1\.25rem - 1px\)/);
  assert.match(gutter, /position: relative/);
  assert.match(gutter, /flex: 0 0 0/);
  assert.match(gutter, /width: 0/);
  assert.match(gutter, /height: 0/);
  assert.match(gutter, /margin-right: -0\.4rem/);
  assert.match(group, /position: absolute/);
  assert.match(group, /right: 0\.465rem/);
  assert.match(group, /display: inline-flex/);
  assert.match(group, /gap: 0\.4rem/);
  assert.match(pageIndicator, /margin-left: 0/);
  assert.match(sharedIndicator, /margin-left: auto/);
});

test('dynamic folders use system-section styling while their pages retain File typography and membership', async () => {
  const { api, context, pageList } = await navigationHarness();
  const dynamicFolder = {
    id: 'folder_uncategorised',
    label: 'Uncategory',
    type: 'system',
    pinned: true,
    collapsed: false,
    source: { kind: 'missingCategories' },
    projectedPageIds: ['page_uncategorised'],
    children: []
  };
  context.pageIndex = {
    pages: [{ id: 'page_uncategorised', title: 'Stale index title', categories: ['ignored'] }]
  };
  context.navigation = {
    version: 3,
    folders: [dynamicFolder],
    items: [],
    dynamicProjection: {
      version: 1,
      pages: {
        page_uncategorised: { id: 'page_uncategorised', title: 'Projected title' }
      },
      folderPresentation: {}
    }
  };
  context.categoryConfig = { navigation: { quantityStatistics: true } };
  context.request = async () => context.navigation;
  api.renderPageList();

  const wrapper = pageList.children[0];
  const header = wrapper.children[0];
  const childPage = wrapper.children[1].children[0];
  assert.equal(wrapper.classList.contains('nav-folder-dynamic'), true);
  assert.equal(header.classList.contains('nav-folder-dynamic-button'), true);
  assert.equal(header.classList.contains('system-typography'), true);
  assert.equal(header.classList.contains('file-typography'), false);
  assert.equal(header.children[0].classList.contains('nav-folder-disclosure-button'), true);
  assert.equal(header.children[0].children[0].classList.contains('disclosure-chevron'), true);
  assert.equal(header.children[1].children[0].textContent, 'Uncategory (1)');
  assert.equal(childPage.classList.contains('page-link'), true);
  assert.equal(childPage.classList.contains('file-typography'), true);
  assert.deepEqual(api.folderPages(dynamicFolder).map((page) => page.id), ['page_uncategorised']);
  assert.equal(api.folderPages(dynamicFolder)[0].title, 'Projected title');

  await api.toggleNavigationFolder(dynamicFolder);
  assert.equal(dynamicFolder.collapsed, true);
  assert.deepEqual(api.folderPages(dynamicFolder).map((page) => page.id), ['page_uncategorised']);

  context.categoryConfig.navigation.quantityStatistics = false;
  dynamicFolder.collapsed = false;
  api.renderPageList();
  assert.equal(pageList.children[0].children[0].children[1].children[0].textContent, 'Uncategory');
});

test('Binding projects only in the canonical manual container and not in a dynamic Category occurrence', async () => {
  const { api, context, pageList } = await navigationHarness();
  const leader = {
    id: 'page_a', title: 'Alpha', type: pageTypesModel.PAGE_TYPES.MARKDOWN,
    categories: ['category_1']
  };
  const follower = {
    id: 'page_b', title: 'Beta', type: pageTypesModel.PAGE_TYPES.HN_TEXT,
    categories: ['category_1']
  };
  const dynamicFolder = {
    id: 'folder_category', label: 'Category', type: 'system', collapsed: false,
    source: { kind: 'categoryAny', categoryIds: ['category_1'] },
    projectedPageIds: ['page_a', 'page_b'], children: []
  };
  const manualFolder = {
    id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: false,
    source: { kind: 'manual', pageIds: ['page_a'] }, children: []
  };
  context.pageIndex = { pages: [leader, follower] };
  context.currentPage = follower;
  context.navigation = {
    version: 3, folders: [manualFolder, dynamicFolder], items: [],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_b'] }]
  };
  api.renderPageList();

  const dynamicRows = pageList.children
    .find((row) => row.dataset.folderId === dynamicFolder.id).children[1].children;
  assert.deepEqual(dynamicRows.map((row) => row.dataset.pageId), ['page_a', 'page_b']);
  assert.equal(dynamicRows.some((row) => row.classList.contains('nav-binding-follower')), false);

  const manualRows = pageList.children
    .find((row) => row.dataset.folderId === manualFolder.id).children[1].children;
  assert.deepEqual(manualRows.map((row) => row.dataset.pageId), ['page_a', 'page_b']);
  assert.equal(manualRows[1].classList.contains('nav-binding-follower'), true);
  assert.equal(dynamicRows[1].classList.contains('active'), true);
  assert.equal(manualRows[1].classList.contains('active'), true);
  const badgeText = (row) => row.children.find((child) => (
    child.classList?.contains('nav-page-type-badge')
  ))?.textContent || null;
  assert.deepEqual(dynamicRows.map(badgeText), ['MD', 'HN']);
  assert.deepEqual(manualRows.map(badgeText), ['MD', 'HN']);
  assert.equal(manualRows[1].children.at(-1).textContent, 'HN');
});

test('restricted navigation keeps a manual container when only a hidden Leader\'s Follower matches', async () => {
  const { api, context, pageList } = await navigationHarness();
  const leader = { id: 'page_a', title: 'Alpha' };
  const follower = { id: 'page_b', title: 'Beta' };
  const folder = {
    id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: ['page_a'] }, children: []
  };
  context.pageIndex = { pages: [leader, follower] };
  context.navigation = {
    version: 3, folders: [folder], items: [],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_b'] }]
  };
  context.pageMatchesNavigationView = (page) => page.id === follower.id;
  context.navigationViewRestricted = () => true;
  api.renderPageList();

  assert.equal(pageList.children.length, 1);
  assert.equal(pageList.children[0].dataset.folderId, folder.id);
  const rows = pageList.children[0].children[1].children;
  assert.deepEqual(rows.map((row) => row.dataset.pageId), ['page_b']);
  assert.equal(rows[0].classList.contains('nav-binding-follower'), false);
  assert.equal(folder.collapsed, true);
});

test('startup Page candidates follow rendered default/Binding/child-folder order', async () => {
  const { api, context } = await navigationHarness();
  const leader = { id: 'page_a', title: 'Alpha' };
  const follower = { id: 'page_b', title: 'Beta' };
  const childPage = { id: 'page_c', title: 'Charlie' };
  const child = {
    id: 'folder_child', label: 'Child', type: 'manual', collapsed: false,
    defaultPageId: null, source: { kind: 'manual', pageIds: ['page_c'] }, children: []
  };
  const parent = {
    id: 'folder_parent', label: 'Parent', type: 'manual', collapsed: false,
    defaultPageId: 'page_a', source: { kind: 'manual', pageIds: ['page_a'] },
    children: [child]
  };
  context.pageIndex = { pages: [leader, follower, childPage] };
  context.navigation = {
    version: 3, folders: [parent], items: [],
    bindings: [{ id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_b'] }]
  };

  assert.deepEqual(
    Array.from(api.pagesInSidebarOrder(), (page) => page.id),
    ['page_a', 'page_b', 'page_c']
  );
});

test('Uncategory always renders while its dedicated setting controls only the duplicate root Page', async () => {
  const { api, context, pageList } = await navigationHarness();
  const page = { id: 'page_uncategorised', title: 'Loose page', categories: [], categoryIds: [] };
  const uncategory = {
    id: 'folder_uncategorised', label: 'Uncategory', type: 'system', pinned: true,
    collapsed: false, excludeFromRoot: false,
    source: { kind: 'missingCategories' }, projectedPageIds: [page.id], children: []
  };
  context.pageIndex = { pages: [page] };
  context.categoryConfig = {
    navigation: { collapseUncategorisedPages: false, quantityStatistics: false }
  };
  context.navigation = { version: 2, folders: [uncategory], items: [page.id] };
  api.renderPageList();
  assert.equal(pageList.children.some((child) => child.classList.contains('nav-folder')), true);
  assert.equal(pageList.querySelectorAll('.page-link').length, 2);
  assert.deepEqual(
    pageList.children.map((child) => child.dataset.folderId || child.dataset.pageId),
    [uncategory.id, page.id]
  );

  context.categoryConfig.navigation.collapseUncategorisedPages = true;
  uncategory.excludeFromRoot = true;
  context.navigation.items = [];
  api.renderPageList();
  assert.equal(pageList.children.some((child) => child.classList.contains('nav-folder')), true);
  assert.equal(pageList.querySelectorAll('.page-link').length, 1);
  assert.equal(pageList.querySelectorAll('.page-link')[0].dataset.pageId, page.id);
});

test('Add Link target-pick rendering preserves every Folder collapse state', async () => {
  const { api, context, pageList } = await navigationHarness();
  const manualFolder = {
    id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: ['page_target'] }, children: []
  };
  const categoryFolder = {
    id: 'folder_category', label: 'Category', type: 'system', collapsed: true,
    source: { kind: 'categoryAny', categoryIds: ['category_1'] },
    projectedPageIds: ['page_target'], children: []
  };
  const uncategoryFolder = {
    id: 'folder_uncategorised', label: 'Uncategory', type: 'system', collapsed: true,
    source: { kind: 'missingCategories' }, projectedPageIds: ['page_loose'], children: []
  };
  context.pageIndex = {
    pages: [
      { id: 'page_target', title: 'Target', categories: ['category_1'] },
      { id: 'page_loose', title: 'Loose', categories: [] }
    ]
  };
  context.navigation = {
    version: 2,
    folders: [uncategoryFolder, categoryFolder, manualFolder],
    items: []
  };
  context.linkPickMode = { active: true, sourcePageId: 'page_source', sourceBlockId: 'block_1' };
  context.navigationViewRestricted = () => Boolean(context.linkPickMode);
  api.renderPageList();

  assert.deepEqual(
    [uncategoryFolder, categoryFolder, manualFolder].map((folder) => folder.collapsed),
    [true, true, true]
  );
  const pickFolders = pageList.children.filter((row) => row.classList.contains('nav-folder'));
  assert.equal(pickFolders.length, 3);
  assert.equal(pickFolders.every((row) => row.children.length === 1), true);
  assert.equal(pageList.querySelector('.nav-empty-state'), null);

  context.linkPickMode = null;
  api.renderPageList();
  assert.deepEqual(
    [uncategoryFolder, categoryFolder, manualFolder].map((folder) => folder.collapsed),
    [true, true, true]
  );
  assert.equal(
    pageList.children
      .filter((row) => row.classList.contains('nav-folder'))
      .every((row) => row.children.length === 1),
    true
  );
});

test('rapid Folder disclosure keeps the latest intent and routes both transitions through one coordinator', async () => {
  const { context, api, sidebarMotionCalls } = await navigationHarness();
  const folder = {
    id: 'folder_toggle', label: 'Toggle', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.navigation = { version: 3, folders: [folder], items: [] };
  const pending = [];
  context.request = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));

  const expanding = api.toggleNavigationFolder(folder);
  assert.equal(folder.collapsed, false);
  const collapsing = api.toggleNavigationFolder(folder);
  assert.equal(folder.collapsed, true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pending.length, 1, 'per-Folder writes are serialized in gesture order');

  const latestNavigation = {
    version: 3,
    folders: [{ ...folder, collapsed: true }],
    items: []
  };
  pending[0].resolve({
    version: 3,
    folders: [{ ...folder, collapsed: false }],
    items: []
  });
  await expanding;
  await Promise.resolve();
  assert.equal(pending.length, 2);
  pending[1].resolve(latestNavigation);
  await collapsing;

  assert.equal(context.navigation, latestNavigation, 'a stale expand response cannot overwrite collapse');
  assert.deepEqual(
    sidebarMotionCalls
      .filter((call) => call.method === 'playDisclosure')
      .map((call) => call.options.expanding),
    [true, false]
  );
});

test('failed Folder persistence rolls optimistic disclosure back through the same visual owner', async () => {
  const { context, api, sidebarMotionCalls } = await navigationHarness();
  const folder = {
    id: 'folder_rollback', label: 'Rollback', type: 'manual', collapsed: true,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  const navigation = { version: 4, folders: [folder], items: [] };
  const statuses = [];
  context.navigation = navigation;
  context.request = async () => { throw new Error('collapsed state rejected'); };
  context.showRuntimeStatus = (ownerRuntime, message, isError) => {
    assert.strictEqual(ownerRuntime, context.activePaneRuntime());
    statuses.push({ message, isError });
  };

  await api.toggleNavigationFolder(folder);

  assert.equal(folder.collapsed, true);
  assert.equal(context.navigation, navigation);
  assert.deepEqual(
    sidebarMotionCalls
      .filter((call) => call.method === 'playDisclosure')
      .map((call) => call.options.expanding),
    [true, false]
  );
  assert.deepEqual(statuses, [{ message: 'collapsed state rejected', isError: true }]);
});

test('manual folders render default, pinned, and ordinary tiers with independent indicators', async () => {
  const { api, context, pageList } = await navigationHarness();
  const parent = {
    id: 'folder_parent', label: 'Parent', type: 'manual', collapsed: false,
    defaultPageId: 'page_default', stickOnTop: false,
    source: { kind: 'manual', pageIds: ['page_ordinary', 'page_pinned', 'page_default'] },
    children: [
      {
        id: 'folder_ordinary', label: 'Zulu', type: 'manual', collapsed: true,
        stickOnTop: false, source: { kind: 'manual', pageIds: [] }, children: []
      },
      {
        id: 'folder_pinned', label: 'Alpha', type: 'manual', collapsed: true,
        stickOnTop: true, source: { kind: 'manual', pageIds: [] }, children: []
      }
    ]
  };
  context.pageIndex = {
    pages: [
      { id: 'page_default', title: 'Default' },
      { id: 'page_pinned', title: 'Pinned' },
      { id: 'page_ordinary', title: 'Ordinary' }
    ]
  };
  context.navigation = {
    version: 2,
    folders: [parent],
    items: [],
    pageStates: {
      page_default: { stickOnTop: true },
      page_pinned: { stickOnTop: true }
    }
  };
  context.request = async () => context.navigation;
  api.renderPageList();
  const wrapper = pageList.children[0];
  const entries = wrapper.children[1].children;
  assert.deepEqual(entries.map((item) => item.dataset.pageId || item.dataset.folderId), [
    'page_default', 'folder_pinned', 'page_pinned', 'folder_ordinary', 'page_ordinary'
  ]);
  const defaultIndicators = entries[0].querySelectorAll('[data-navigation-indicator]');
  const pinnedIndicators = entries[2].querySelectorAll('[data-navigation-indicator]');
  const defaultIndicator = defaultIndicators[0];
  const pinnedIndicator = pinnedIndicators[0];
  assert.equal(defaultIndicator.dataset.navigationIndicator, 'default');
  assert.equal(pinnedIndicator.dataset.navigationIndicator, 'pinned');
  assert.equal(defaultIndicators.length, 1);
  assert.equal(entries[0].children[0].classList.contains('nav-page-status-gutter'), true);
  assert.equal(entries[2].children[0].classList.contains('nav-page-status-gutter'), true);
  assert.equal(entries[0].children[1].classList.contains('nav-page-label-text'), true);

  const folderHeader = wrapper.children[0];
  const disclosureButton = folderHeader.children[0];
  const nameButton = folderHeader.children[1];
  await nameButton.listeners.get('click')({
    preventDefault() {}, stopPropagation() {}, detail: 1, shiftKey: false, metaKey: false, altKey: false
  });
  assert.equal(context.loadedPageId, undefined);
  assert.equal(parent.collapsed, true);
  await disclosureButton.listeners.get('click')({ preventDefault() {}, stopPropagation() {} });
  assert.equal(parent.collapsed, false);
  assert.equal(context.loadedPageId, undefined);
});

test('state context actions appear only for normal manual navigation entries', async () => {
  const { api, context } = await navigationHarness();
  const page = { id: 'page_1', title: 'One' };
  const folder = {
    id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: false,
    defaultPageId: 'page_1', stickOnTop: true,
    source: { kind: 'manual', pageIds: ['page_1'] }, children: []
  };
  context.pageIndex = { pages: [page] };
  context.navigation = {
    version: 2,
    folders: [folder],
    items: [],
    pageStates: { page_1: { stickOnTop: true } }
  };
  const event = {
    preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 30,
    shiftKey: false, metaKey: false, altKey: false
  };
  await api.openPageContextMenu(event, page, { parentFolderId: folder.id, synthetic: false });
  assert.equal(context.lastNativeContextPayload.type, 'navigation-page');
  assert.equal(context.lastNativeContextPayload.canSetDefault, true);
  assert.equal(context.lastNativeContextPayload.isDefault, true);
  assert.equal(context.lastNativeContextPayload.isPinned, true);

  await api.openPageContextMenu(event, page, { parentFolderId: 'folder_dynamic', synthetic: true });
  assert.equal(context.lastNativeContextPayload.synthetic, true);
  assert.equal(context.lastNativeContextPayload.canSetDefault, false);
  assert.match((await fs.readFile(path.join(__dirname, '../public/js/navigation.js'), 'utf8')),
    /if \(folder\.type !== 'manual' \|\| folder\.source\?\.kind !== 'manual'\) return/);
});

test('native multi-Page context action captures only selected Page IDs for batch Category editing', async () => {
  const { api, context } = await navigationHarness();
  const pageA = { id: 'page_a', title: 'Alpha' };
  const pageB = { id: 'page_b', title: 'Beta' };
  context.pageIndex = { pages: [pageA, pageB] };
  context.navigation = { version: 2, folders: [], items: [pageA.id, pageB.id] };
  api.renderPageList();
  context.selectedNavigationItems.add('page:page_a');
  context.selectedNavigationItems.add('folder:folder_ignored');
  context.selectedNavigationItems.add('page:page_b');
  context.nextNativeContextCommand = 'edit-page-categories';

  await api.openPageContextMenu({
    currentTarget: new FakeElement('button'),
    preventDefault() {}, stopPropagation() {},
    shiftKey: false, metaKey: false, altKey: false
  }, pageA);

  assert.equal(context.lastNativeContextPayload.selectedCount, 3);
  assert.equal(context.lastNativeContextPayload.selectedPageCount, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.openedPageMetaModal)),
    { type: 'category', options: { pageIds: ['page_a', 'page_b'] } }
  );
  assert.deepEqual([...context.selectedNavigationItems], [
    'page:page_a', 'folder:folder_ignored', 'page:page_b'
  ]);
});

test('right-click Page context keeps a selected Page batch and replaces it for an unselected Page', async () => {
  const { api, context } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' },
    { id: 'page_c', title: 'Gamma' }
  ];
  context.pageIndex = { pages };
  context.navigation = { version: 2, folders: [], items: pages.map((page) => page.id) };
  api.renderPageList();
  context.selectedNavigationItems.add('page:page_a');
  context.selectedNavigationItems.add('page:page_b');
  const event = {
    currentTarget: new FakeElement('button'),
    preventDefault() {}, stopPropagation() {},
    shiftKey: false, metaKey: false, altKey: false
  };

  await api.openPageContextMenu(event, pages[0]);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_a', 'page:page_b']);
  assert.equal(context.lastNativeContextPayload.selectedCount, 2);

  await api.openPageContextMenu(event, pages[2]);
  assert.deepEqual([...context.selectedNavigationItems], ['page:page_c']);
  assert.equal(context.lastNativeContextPayload.selectedCount, 1);
});

test('native selected-Page Delete and Stick on Top actions receive every selected Page', async () => {
  const { api, context } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' }
  ];
  context.pageIndex = { pages };
  context.navigation = {
    version: 2,
    folders: [],
    items: pages.map((page) => page.id),
    pageStates: {}
  };
  api.renderPageList();
  context.selectedNavigationItems.add('page:page_a');
  context.selectedNavigationItems.add('page:page_b');
  const event = {
    currentTarget: new FakeElement('button'),
    preventDefault() {}, stopPropagation() {},
    shiftKey: false, metaKey: false, altKey: false
  };

  context.nextNativeContextCommand = 'delete-page';
  await api.openPageContextMenu(event, pages[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.deletedPageOptions)), {
    pageIds: ['page_a', 'page_b'],
    navigationItems: [
      { type: 'page', id: 'page_a' },
      { type: 'page', id: 'page_b' }
    ]
  });

  const requests = [];
  context.nextNativeContextCommand = 'toggle-stick-page';
  context.request = async (url, options) => {
    requests.push({ url, enabled: JSON.parse(options.body).enabled });
    const pageId = url.split('/').at(-2);
    context.navigation.pageStates[pageId] = { stickOnTop: true };
    return { navigation: context.navigation };
  };
  await api.openPageContextMenu(event, pages[0]);
  assert.deepEqual(requests, [
    { url: '/api/navigation/pages/page_a/stick-on-top', enabled: true },
    { url: '/api/navigation/pages/page_b/stick-on-top', enabled: true }
  ]);
});

test('native mixed Page and Folder Delete and Stick actions retain the complete selection', async () => {
  const { api, context } = await navigationHarness();
  const pages = [
    { id: 'page_a', title: 'Alpha' },
    { id: 'page_b', title: 'Beta' }
  ];
  const folder = {
    id: 'folder_a', label: 'Folder A', type: 'manual', stickOnTop: false,
    source: { kind: 'manual', pageIds: [] }, children: []
  };
  context.pageIndex = { pages };
  context.navigation = {
    version: 2,
    folders: [folder],
    items: pages.map((page) => page.id),
    pageStates: {}
  };
  api.renderPageList();
  for (const key of ['page:page_a', 'folder:folder_a', 'page:page_b']) {
    context.selectedNavigationItems.add(key);
  }
  const event = {
    currentTarget: new FakeElement('button'),
    preventDefault() {}, stopPropagation() {},
    shiftKey: false, metaKey: false, altKey: false
  };

  context.nextNativeContextCommand = 'delete-page';
  await api.openPageContextMenu(event, pages[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.deletedPageOptions)), {
    pageIds: ['page_a', 'page_b'],
    navigationItems: [
      { type: 'page', id: 'page_a' },
      { type: 'folder', id: 'folder_a' },
      { type: 'page', id: 'page_b' }
    ]
  });

  const requests = [];
  context.nextNativeContextCommand = 'toggle-stick-folder';
  context.request = async (url, options) => {
    requests.push({ url, enabled: JSON.parse(options.body).enabled });
    if (url.includes('/pages/')) {
      const pageId = url.split('/').at(-2);
      context.navigation.pageStates[pageId] = { stickOnTop: true };
    } else {
      folder.stickOnTop = true;
    }
    return { navigation: context.navigation };
  };
  await api.openFolderContextMenu(event, folder);
  assert.deepEqual(requests, [
    { url: '/api/navigation/pages/page_a/stick-on-top', enabled: true },
    { url: '/api/navigation/folders/folder_a/stick-on-top', enabled: true },
    { url: '/api/navigation/pages/page_b/stick-on-top', enabled: true }
  ]);

  context.nextNativeContextCommand = 'delete-folder';
  await api.openFolderContextMenu(event, folder);
  assert.deepEqual(JSON.parse(JSON.stringify(context.deletedPageOptions)), {
    pageIds: ['page_a', 'page_b'],
    navigationItems: [
      { type: 'page', id: 'page_a' },
      { type: 'folder', id: 'folder_a' },
      { type: 'page', id: 'page_b' }
    ]
  });
});

test('sort toolbar wiring closes on outside pointer, sidebar collapse, and strong modals', async () => {
  const root = path.join(__dirname, '..');
  const [html, bootstrap, app, vaultSettings, descriptorModal, styles] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/descriptorModal.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8')
  ]);
  assert.match(html, /id="navigation-sort-button"[\s\S]*aria-haspopup="menu"/);
  assert.match(html, /id="navigation-sort-menu"[\s\S]*role="menu"/);
  assert.match(bootstrap, /navigationSortButton\?\.addEventListener\('click', toggleNavigationSortMenu\)/);
  assert.match(bootstrap, /!navigationSortMenu\.contains\(event\.target\)[\s\S]*closeNavigationSortMenu\(\)/);
  assert.match(app, /!open && !isRight[\s\S]*closeNavigationSortMenu\(\)/);
  assert.match(vaultSettings, /function openVaultSettings\(\)[\s\S]*closeNavigationSortMenu\(\)/);
  assert.match(descriptorModal, /function openPageMetaModal\(runtime, type, options = \{\}\)[\s\S]*closeNavigationSortMenu\(\)/);
  assert.match(styles, /\.navigation-sort-menu \{[\s\S]*position: fixed;[\s\S]*z-index: 70;/);
  assert.match(styles, /\.nav-folder-button \{[\s\S]*background: transparent;/);
});
