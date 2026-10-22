const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const vm = require('node:vm');
const zoomControls = require('../public/zoomControls');
const appearanceSettingsModel = require('../public/appearanceSettings');
const vaultAppearanceStoreModel = require('../public/vaultAppearanceStore');
const categoryNavigation = require('../public/categoryNavigation');
const pageTypesModel = require('../public/pageTypes');
const markdownPageModel = require('../public/markdownPage');
const textEditingModel = require('../public/textEditing');

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(value) { this.values.add(value); }
  toggle(value, active) {
    if (active) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value) || this.element.className.split(/\s+/).includes(value);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.dataset = {};
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
  }
  append(...children) {
    for (const child of children) {
      if (child && typeof child === 'object') child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = children.flatMap((child) => child?.isFragment ? child.children : [child]);
    for (const child of this.children) {
      if (child && typeof child === 'object') child.parentElement = this;
    }
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async dispatch(type, event = {}) {
    const supplied = {
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...event
    };
    for (const listener of this.listeners.get(type) || []) await listener(supplied);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const candidates = descendants(this);
    if (selector === '.forced-modal-body') {
      return candidates.filter((item) => item.classList?.contains('forced-modal-body'));
    }
    if (selector === '.category-checkbox input'
      || selector === '.category-checkbox input:checked') {
      const checkedOnly = selector.endsWith(':checked');
      return candidates.filter((item) => item.tagName === 'INPUT'
        && item.parentElement?.classList?.contains('category-checkbox')
        && (!checkedOnly || item.checked));
    }
    return [];
  }
  get options() { return this.children; }
  focus() {}
  select() { this.selected = true; }
}

function descendants(root) {
  const result = [];
  for (const child of root.children || []) {
    if (!child) continue;
    result.push(child, ...descendants(child));
  }
  return result;
}

function buttonsByText(root, text) {
  return descendants(root).filter((item) => item.tagName === 'BUTTON' && item.textContent === text);
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function controlSettingsHarness(bridge = null, {
  requestImpl = null,
  initialNavigation = { version: 3, folders: [], items: [] }
} = {}) {
  const documentListeners = new Map();
  const elements = new Map([
    ['#vault-settings-button', new FakeElement('button')],
    ['#vault-settings-overlay', new FakeElement('div')],
    ['#vault-settings-modal', new FakeElement('section')],
    ['#vault-settings-close', new FakeElement('button')],
    ['#vault-settings-vault-nav', new FakeElement('button')],
    ['#vault-settings-control-nav', new FakeElement('button')],
    ['#vault-settings-appearance-nav', new FakeElement('button')],
    ['#vault-settings-links-nav', new FakeElement('button')],
    ['#vault-settings-category-nav', new FakeElement('button')],
    ['#vault-settings-vault-panel', new FakeElement('div')],
    ['#vault-settings-control-panel', new FakeElement('div')],
    ['#vault-settings-appearance-panel', new FakeElement('div')],
    ['#vault-settings-links-panel', new FakeElement('div')],
    ['#vault-settings-category-panel', new FakeElement('div')],
    ['#zoom-sensitivity-slider', new FakeElement('input')],
    ['#zoom-sensitivity-value', new FakeElement('output')],
    ['#vault-default-page-type', new FakeElement('select')],
    ['#preserve-single-line-breaks-switch', new FakeElement('button')],
    ['#vault-settings-links', new FakeElement('div')],
    ['#vault-settings-category-groups', new FakeElement('div')],
    ['#vault-settings-category-actions', new FakeElement('div')],
    ['#vault-settings-category-collapse', new FakeElement('div')],
    ['#vault-settings-category-status', new FakeElement('p')],
    ['#vault-settings-rebuild-navigation', new FakeElement('button')],
    ['#vault-name-overlay', new FakeElement('div')],
    ['#vault-name-modal', new FakeElement('section')],
    ['#vault-name-title', new FakeElement('h2')],
    ['#vault-name-field-label', new FakeElement('span')],
    ['#vault-name-input', new FakeElement('input')],
    ['#vault-name-error', new FakeElement('p')],
    ['#vault-name-cancel', new FakeElement('button')],
    ['#vault-name-confirm', new FakeElement('button')]
  ]);
  elements.get('#vault-settings-vault-nav').textContent = 'Vault';
  elements.get('#vault-settings-control-nav').textContent = 'Preference';
  elements.get('#vault-settings-appearance-nav').textContent = 'Appearance';
  elements.get('#vault-settings-links-nav').textContent = 'Links';
  elements.get('#vault-settings-category-nav').textContent = 'Category';
  elements.get('#vault-settings-control-panel').hidden = true;
  elements.get('#vault-settings-appearance-panel').hidden = true;
  elements.get('#vault-settings-overlay').hidden = true;
  elements.get('#vault-name-overlay').hidden = true;
  elements.get('#vault-name-field-label').textContent = 'Vault name';
  elements.get('#vault-name-confirm').textContent = 'Confirm';
  elements.get('#zoom-sensitivity-slider').value = '1.0';
  elements.get('#preserve-single-line-breaks-switch').setAttribute('aria-checked', 'false');
  const documentRef = {
    querySelector: (selector) => elements.get(selector) || null,
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => {
      const fragment = new FakeElement('fragment');
      fragment.isFragment = true;
      return fragment;
    },
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = (documentListeners.get(type) || [])
        .filter((candidate) => candidate !== listener);
      if (listeners.length) documentListeners.set(type, listeners);
      else documentListeners.delete(type);
    },
    querySelectorAll() { return []; }
  };
  for (const element of elements.values()) {
    element.focus = () => { documentRef.activeElement = element; };
  }
  const tooltipModel = {
    createTooltip: () => ({ hide() {} }),
    createFolderNameCell: (folder, { documentRef: doc }) => {
      const cell = doc.createElement('span');
      cell.textContent = folder?.name || '';
      return cell;
    }
  };
  const calls = {
    requests: [],
    statuses: [],
    renders: {
      filterPanel: 0,
      rightCategoryFilter: 0,
      relations: 0,
      pageList: 0,
      page: 0
    }
  };
  const runtime = {
    paneId: 'pane_vault_settings_test',
    runtimeId: 'runtime_vault_settings_test',
    lifecycleEpoch: 1,
    disposed: false,
    currentPage: null,
    blockEditMode: false,
    pageEditMode: false
  };
  const context = {
    console,
    document: documentRef,
    window: bridge ? { cneDesktop: bridge } : {},
    folderWarningTooltip: tooltipModel,
    appearanceSettingsModel,
    appearanceSettings: appearanceSettingsModel.normalizeAppearanceSettings(null),
    categoryNavigation,
    pageTypesModel,
    markdownPageModel,
    textEditingModel,
    requestAnimationFrame: (callback) => callback(),
    categoryConfig: {
      groups: [{
        id: 'level', label: 'Level', children: [
          { type: 'item', id: 'single', label: 'SingleProcess' },
          { type: 'item', id: 'terminal', label: 'Terminal' }
        ]
      }],
      navigation: {
        enabledCategoryIds: ['single'],
        collapseUncategorisedPages: true,
        quantityStatistics: false
      }
    },
    zoomControls,
    zoomSensitivity: 1,
    navigation: initialNavigation,
    pageIndex: { pages: [] },
    pageList: { closest: () => null },
    selectedCategoryFilterIds: new Set(),
    selectedRightCategoryIds: new Set(),
    vaultPreferences: markdownPageModel.normalizeSettings(null),
    preferenceSaves: [],
    preferenceApplications: []
  };
  context.activePaneRuntime = () => runtime;
  context.livingPaneRuntimes = () => [runtime];
  context.runtimeIsLive = (candidate) => candidate === runtime && !candidate.disposed;
  context.captureRuntimeOperation = (candidate, detail = {}) => ({
    runtime: candidate,
    runtimeId: candidate?.runtimeId,
    lifecycleEpoch: candidate?.lifecycleEpoch,
    ...detail
  });
  context.runtimeOperationIsCurrent = (operation) => Boolean(
    operation?.runtime === runtime
    && operation.runtimeId === runtime.runtimeId
    && operation.lifecycleEpoch === runtime.lifecycleEpoch
    && !runtime.disposed
  );
  context.adoptCategoryCommandPages = (pages, { originRuntime } = {}) => {
    if (originRuntime) assert.strictEqual(originRuntime, runtime);
    for (const page of pages || []) {
      if (page?.id === runtime.currentPage?.id) runtime.currentPage = page;
    }
  };
  context.request = async (url, options = {}) => {
    calls.requests.push({ url, options });
    if (requestImpl) return requestImpl(url, options);
    throw new Error(`Unexpected request: ${url}`);
  };
  context.showRuntimeStatus = (ownerRuntime, ...args) => {
    assert.strictEqual(ownerRuntime, runtime);
    calls.statuses.push(args);
  };
  context.renderFilterPanel = () => { calls.renders.filterPanel += 1; };
  context.renderRightCategoryFilter = () => { calls.renders.rightCategoryFilter += 1; };
  context.renderRelations = () => { calls.renders.relations += 1; };
  context.renderPageList = () => { calls.renders.pageList += 1; };
  context.renderPage = () => { calls.renders.page += 1; };
  context.setRuntimeZoomSensitivity = (value) => {
    context.zoomSensitivity = zoomControls.normalizeZoomSensitivity(value);
    return context.zoomSensitivity;
  };
  context.applyVaultMarkdownPreferences = (value, options = {}) => {
    context.vaultPreferences = markdownPageModel.normalizeSettings(value);
    context.preferenceApplications.push({
      value: { ...context.vaultPreferences },
      options: { ...options }
    });
    return context.vaultPreferences;
  };
  context.queueVaultMarkdownPreferenceSave = async (changes) => {
    context.preferenceSaves.push({ ...changes });
    return markdownPageModel.normalizeSettings({
      ...context.vaultPreferences,
      ...changes
    });
  };
  let persistedAppearance = appearanceSettingsModel.normalizeAppearanceSettings(
    context.appearanceSettings
  );
  context.vaultAppearanceStore = vaultAppearanceStoreModel.createVaultAppearanceStore({
    model: appearanceSettingsModel,
    initialAppearance: context.appearanceSettings,
    persist: async (appearance) => {
      const saved = await context.request('/api/appearance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appearance)
      });
      persistedAppearance = appearanceSettingsModel.normalizeAppearanceSettings(saved);
      return saved;
    },
    refetch: async () => persistedAppearance
  });
  const source = await fs.readFile(path.join(__dirname, '../public/js/vaultSettings.js'), 'utf8');
  vm.runInNewContext(source, context);
  return {
    context,
    elements,
    calls,
    runtime,
    source,
    dispatchDocument(type, event) {
      for (const listener of [...(documentListeners.get(type) || [])]) listener(event);
    }
  };
}

test('Vault owns one non-toggle Rebuild Navigation action using the canonical solid button family', async () => {
  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  const vaultPanel = html.match(
    /<div id="vault-settings-vault-panel"[\s\S]*?<div id="vault-settings-control-panel"/
  )?.[0] || '';
  const rebuildTags = vaultPanel.match(
    /<button id="vault-settings-rebuild-navigation"[\s\S]*?<\/button>/g
  ) || [];

  assert.equal(rebuildTags.length, 1);
  assert.match(
    vaultPanel,
    /<strong class="vault-settings-item-text">Navigation projection<\/strong>[\s\S]*?Rebuild derived navigation from current Pages and Category settings\.[\s\S]*?<button id="vault-settings-rebuild-navigation"\s+class="ui-solid-action ui-primary-action" type="button">Rebuild Navigation<\/button>/
  );
  assert.ok(
    vaultPanel.indexOf('id="vault-settings-reset"')
      < vaultPanel.indexOf('id="vault-settings-rebuild-navigation"')
  );
  assert.doesNotMatch(rebuildTags[0], /role="switch"|aria-checked=|aria-pressed=/);
});

test('Rebuild Navigation disables while pending then adopts the authoritative result through one Sidebar refresh', async () => {
  const gate = deferred();
  const previousNavigation = {
    version: 3,
    folders: [{ id: 'folder_category_old', label: 'Old projection' }],
    items: ['page_old']
  };
  const rebuiltNavigation = {
    version: 3,
    folders: [{ id: 'folder_category_new', label: 'New projection' }],
    items: ['page_new']
  };
  const { context, elements, calls } = await controlSettingsHarness(null, {
    initialNavigation: previousNavigation,
    requestImpl: () => gate.promise
  });
  const button = elements.get('#vault-settings-rebuild-navigation');

  const click = button.dispatch('click');
  assert.equal(button.disabled, true);
  assert.strictEqual(context.navigation, previousNavigation);
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].url, '/api/navigation/rebuild');
  assert.equal(calls.requests[0].options.method, 'POST');
  assert.deepEqual(calls.statuses, [['Rebuilding navigation…']]);
  assert.equal(calls.renders.pageList, 0);

  gate.resolve({ navigation: rebuiltNavigation });
  await click;

  assert.strictEqual(context.navigation, rebuiltNavigation);
  assert.equal(calls.renders.pageList, 1);
  assert.equal(calls.renders.filterPanel, 1);
  assert.equal(calls.renders.rightCategoryFilter, 1);
  assert.equal(calls.renders.relations, 1);
  assert.equal(calls.renders.page, 0);
  assert.deepEqual(calls.statuses, [
    ['Rebuilding navigation…'],
    ['Navigation rebuilt.', false, 1800]
  ]);
  assert.equal(button.disabled, false);
});

test('failed Rebuild Navigation preserves the prior renderer state and performs no Sidebar refresh', async () => {
  const gate = deferred();
  const previousNavigation = {
    version: 3,
    folders: [{ id: 'folder_manual', source: { kind: 'manual', pageIds: ['page_1'] } }],
    items: []
  };
  const { context, elements, calls } = await controlSettingsHarness(null, {
    initialNavigation: previousNavigation,
    requestImpl: () => gate.promise
  });
  const button = elements.get('#vault-settings-rebuild-navigation');

  const click = button.dispatch('click');
  assert.equal(button.disabled, true);
  gate.reject(new Error('Projection rebuild failed safely.'));
  await click;

  assert.strictEqual(context.navigation, previousNavigation);
  assert.deepEqual(calls.renders, {
    filterPanel: 0,
    rightCategoryFilter: 0,
    relations: 0,
    pageList: 0,
    page: 0
  });
  assert.deepEqual(calls.statuses, [
    ['Rebuilding navigation…'],
    ['Projection rebuild failed safely.', true]
  ]);
  assert.equal(button.disabled, false);
});

test('read-only rows render Change/Set actions and removal mode toggles without affecting Default', async () => {
  const elements = new Map([
    ['#vault-settings-button', new FakeElement('button')],
    ['#vault-settings-overlay', new FakeElement('div')],
    ['#vault-settings-modal', new FakeElement('section')],
    ['#vault-settings-close', new FakeElement('button')],
    ['#vault-settings-links', new FakeElement('div')]
  ]);
  const documentRef = {
    querySelector: (selector) => elements.get(selector) || null,
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => {
      const fragment = new FakeElement('fragment');
      fragment.isFragment = true;
      return fragment;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const registry = {
    defaultFolderId: 'folder_001',
    folders: [
      { id: 'folder_001', name: 'Default', available: true },
      { id: 'folder_002', name: 'Read A', available: true },
      { id: 'folder_003', name: 'Read B', available: true }
    ]
  };
  const bridge = {
    isDesktop: true,
    getResourceFolders: async () => registry,
    selectDefaultFolder: async () => ({ ok: true, registry }),
    addReadOnlyFolder: async () => ({ ok: true, registry }),
    changeReadOnlyFolder: async () => ({ ok: true, registry }),
    removeReadOnlyFolder: async () => ({ ok: true, registry }),
    setDefaultFolder: async () => ({ ok: true, registry }),
    relinkFolder: async () => ({ ok: true, registry })
  };
  const tooltipModel = {
    createTooltip: () => ({ hide() {} }),
    createFolderNameCell: (folder, { documentRef: doc }) => {
      const cell = doc.createElement('span');
      cell.className = 'vault-folder-name';
      cell.textContent = folder?.name || '';
      return cell;
    }
  };
  const source = await fs.readFile(path.join(__dirname, '../public/js/vaultSettings.js'), 'utf8');
  const appearanceSettings = appearanceSettingsModel.normalizeAppearanceSettings(null);
  const context = {
    activePaneRuntime: () => null,
    document: documentRef,
    showRuntimeStatus() {},
    window: { cneDesktop: bridge },
    folderWarningTooltip: tooltipModel,
    appearanceSettingsModel,
    appearanceSettings
  };
  context.vaultAppearanceStore = vaultAppearanceStoreModel.createVaultAppearanceStore({
    model: appearanceSettingsModel,
    initialAppearance: appearanceSettings,
    persist: async (appearance) => appearance,
    refetch: async () => appearanceSettings
  });
  vm.runInNewContext(source, context);

  await elements.get('#vault-settings-button').dispatch('click');
  await settle();
  const links = elements.get('#vault-settings-links');
  assert.equal(buttonsByText(links, 'Change to').length, 3);
  const readOnlyRows = links.children.filter((item) => item.classList.contains('vault-folder-readonly-row'));
  assert.equal(readOnlyRows.slice(0, 2).every((row) => buttonsByText(row, 'Change to').length === 1), true);
  assert.equal(readOnlyRows[0].children[0].textContent, 'Read only:');
  assert.equal(descendants(readOnlyRows[0].children[1]).some((item) => item.textContent === 'Read A'), true);
  assert.equal(readOnlyRows[0].children[2].textContent, 'Set as default');
  assert.equal(readOnlyRows[0].children[3].textContent, 'Change to');
  assert.equal(readOnlyRows[1].children[0].textContent, '');
  assert.equal(buttonsByText(links, 'Set as default').length, 2);
  assert.equal(buttonsByText(links, 'Remove').length, 1);
  assert.equal(buttonsByText(links, 'Add new').length, 1);
  const addRow = readOnlyRows.at(-1);
  assert.equal(addRow.children[0].textContent, 'Remove');
  assert.equal(addRow.children[1].textContent, 'Add new');
  assert.equal(descendants(links).filter((item) => item.classList.contains('vault-folder-remove-trigger')).length, 0);

  await buttonsByText(links, 'Remove')[0].dispatch('click');
  const minusButtons = descendants(links)
    .filter((item) => item.classList.contains('vault-folder-remove-trigger'));
  assert.equal(minusButtons.length, 2);
  const defaultRow = links.children.find((item) => item.className === 'vault-folder-row');
  assert.equal(descendants(defaultRow).some((item) => item.classList.contains('vault-folder-remove-trigger')), false);

  await buttonsByText(links, 'Remove')[0].dispatch('click');
  assert.equal(descendants(links).filter((item) => item.classList.contains('vault-folder-remove-trigger')).length, 0);

  await buttonsByText(links, 'Remove')[0].dispatch('click');
  assert.equal(descendants(links).filter((item) => item.classList.contains('vault-folder-remove-trigger')).length, 2);
  await elements.get('#vault-settings-close').dispatch('click');
  await elements.get('#vault-settings-button').dispatch('click');
  await settle();
  assert.equal(descendants(links).filter((item) => item.classList.contains('vault-folder-remove-trigger')).length, 0);
});

test('Links read-only rows share label/name columns and use compact aligned actions', async () => {
  const [css, source] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8'),
    fs.readFile(path.join(__dirname, '../public/js/vaultSettings.js'), 'utf8')
  ]);
  assert.match(css, /\.vault-folder-row \{[^}]*grid-template-columns: 112px minmax\(0, 1fr\) 112px/);
  assert.match(css, /\.vault-folder-readonly-row \{[^}]*grid-template-columns: 112px minmax\(0, 1fr\) 112px 112px/);
  assert.match(css, /\.vault-folder-action \{[^}]*justify-self: end;[^}]*width: max-content/);
  assert.doesNotMatch(css, /\.vault-folder-action\.neutral-control\s*\{/);
  assert.match(source, /'ui-outline-action neutral-control'/);
  assert.match(css, /\.vault-folder-set-default-action \{[^}]*justify-self: end/);
  assert.match(source, /setDefaultButton,[\s\S]*changeButton/);
  assert.match(source, /readOnlyFolderRow\(folder, index === 0 \? 'Read only:' : ''\)/);
});

test('native confirmation dialogs expose no destructive remove-anyway action', async () => {
  const source = await fs.readFile(path.join(__dirname, '../desktop/main.js'), 'utf8');
  assert.match(source, /buttons: \['Cancel', 'Change anyway'\]/);
  assert.match(source, /buttons: \['Cancel', 'Copy referenced files to default'\]/);
  assert.doesNotMatch(source, /Remove anyway|Delete external files/);
});

test('Vault, Preference, Appearance, Links, and Category retain order while zoom sensitivity updates immediately', async () => {
  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.indexOf('>Preference</button>') < html.indexOf('>Appearance</button>'));
  assert.doesNotMatch(html, />Control<\/button>/);
  assert.ok(html.indexOf('>Appearance</button>') < html.indexOf('>Links</button>'));
  assert.ok(html.indexOf('>Links</button>') < html.indexOf('>Category</button>'));
  assert.match(html, /id="zoom-sensitivity-slider"[\s\S]*min="0\.5" max="5\.0" step="0\.1" value="1\.0"/);
  assert.match(html, /Zoom sensitivity/);

  const saves = [];
  const registry = { defaultFolderId: null, folders: [] };
  const bridge = {
    isDesktop: true,
    getControlSettings: async () => ({ zoomSensitivity: 2.4 }),
    setZoomSensitivity: async (value) => { saves.push(value); return { ok: true, zoomSensitivity: value }; },
    getResourceFolders: async () => registry,
    selectDefaultFolder: async () => ({ ok: true, registry }),
    addReadOnlyFolder: async () => ({ ok: true, registry }),
    changeReadOnlyFolder: async () => ({ ok: true, registry }),
    removeReadOnlyFolder: async () => ({ ok: true, registry }),
    setDefaultFolder: async () => ({ ok: true, registry }),
    relinkFolder: async () => ({ ok: true, registry })
  };
  const { context, elements, dispatchDocument } = await controlSettingsHarness(bridge);
  await elements.get('#vault-settings-button').dispatch('click');
  assert.equal(elements.get('#vault-settings-appearance-panel').hidden, true);
  assert.equal(elements.get('#vault-settings-links-panel').hidden, true);
  await elements.get('#vault-settings-control-nav').dispatch('click');
  await settle();
  assert.equal(elements.get('#vault-settings-control-panel').hidden, false);
  assert.equal(elements.get('#vault-settings-links-panel').hidden, true);
  assert.equal(elements.get('#zoom-sensitivity-slider').value, '2.4');
  assert.equal(elements.get('#zoom-sensitivity-value').textContent, '2.4×');

  let arrowPrevented = false;
  dispatchDocument('keydown', {
    target: elements.get('#zoom-sensitivity-slider'),
    key: 'ArrowRight',
    preventDefault() { arrowPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
  assert.equal(arrowPrevented, false);

  elements.get('#zoom-sensitivity-slider').value = '3.2';
  await elements.get('#zoom-sensitivity-slider').dispatch('input');
  assert.equal(elements.get('#zoom-sensitivity-value').textContent, '3.2×');
  assert.equal(context.zoomSensitivity, 3.2);
  await settle();
  assert.deepEqual(saves, [3.2]);

  await elements.get('#vault-settings-links-nav').dispatch('click');
  assert.equal(elements.get('#vault-settings-links-panel').hidden, false);
  await elements.get('#vault-settings-category-nav').dispatch('click');
  assert.equal(elements.get('#vault-settings-category-panel').hidden, false);
  assert.equal(elements.get('#vault-settings-links-panel').hidden, true);
  assert.equal(descendants(elements.get('#vault-settings-category-groups'))
    .some((item) => item.textContent === 'SingleProcess'), true);
  assert.equal(buttonsByText(elements.get('#vault-settings-category-groups'), '−').length, 1);
  assert.equal(buttonsByText(elements.get('#vault-settings-category-actions'), 'Remove').length, 1);
  assert.equal(buttonsByText(elements.get('#vault-settings-category-actions'), 'New Group').length, 1);
});

test('Category item and group Rename reuse one modal, preserve stable selections, and keep one action column contract', async () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let categoryState = {
    groups: [{
      id: 'level', label: 'Level', children: [
        { type: 'item', id: 'single', label: 'SingleProcess' },
        { type: 'item', id: 'terminal', label: 'Terminal' }
      ]
    }],
    navigation: {
      enabledCategoryIds: ['single'],
      collapseUncategorisedPages: true,
      quantityStatistics: false
    }
  };
  const navigationState = {
    version: 3,
    folders: [{
      id: 'folder_category_single',
      label: 'SingleProcess',
      source: { kind: 'categoryAny', categoryIds: ['single'] }
    }],
    items: []
  };
  const { context, elements, calls, runtime, dispatchDocument } = await controlSettingsHarness(null, {
    initialNavigation: navigationState,
    requestImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      if (options.method === 'PATCH' && url === '/api/categories/items/terminal') {
        categoryState.groups[0].children[1].label = body.label;
        return { categoryConfig: clone(categoryState), navigation: clone(navigationState) };
      }
      if (options.method === 'PATCH' && url === '/api/categories/groups/level') {
        categoryState.groups[0].label = body.label;
        return { categoryConfig: clone(categoryState), navigation: clone(navigationState) };
      }
      if (options.method === 'POST'
        && ['/api/categories/groups/level/items', '/api/categories/groups'].includes(url)) {
        return { categoryConfig: clone(categoryState), navigation: clone(navigationState) };
      }
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
    }
  });

  const groupsRoot = elements.get('#vault-settings-category-groups');
  const actionsRoot = elements.get('#vault-settings-category-actions');
  const renameFor = (id) => descendants(groupsRoot).find((element) => (
    element.tagName === 'BUTTON' && element.dataset.categoryRenameId === id
  ));
  const itemRowFor = (id) => descendants(groupsRoot).find((element) => (
    element.classList?.contains('vault-category-item')
    && descendants(element).some((child) => child.dataset?.categoryRenameId === id)
  ));

  await elements.get('#vault-settings-button').dispatch('click');
  await elements.get('#vault-settings-category-nav').dispatch('click');

  let groupSection = groupsRoot.children[0];
  let groupHeader = groupSection.children[0];
  assert.equal(groupHeader.children[1].textContent, 'Add');
  assert.equal(groupHeader.children[2].textContent, 'Rename');
  assert.equal(buttonsByText(groupsRoot, 'Rename').length, 3);
  for (const button of buttonsByText(groupsRoot, 'Rename')) {
    assert.equal(button.classList.contains('vault-category-rename-action'), true);
    assert.equal(button.classList.contains('ui-outline-action'), true);
    assert.equal(button.classList.contains('neutral-control'), true);
    assert.equal(button.classList.contains('ui-solid-action'), false);
    assert.equal(button.classList.contains('ui-primary-action'), false);
  }
  for (const row of groupSection.children[1].children) {
    assert.equal(row.children.length, 2);
    assert.equal(row.children[1].textContent, 'Rename');
  }
  const newGroupButton = buttonsByText(actionsRoot, 'New Group')[0];
  assert.equal(newGroupButton.classList.contains('ui-solid-action'), true);
  assert.equal(buttonsByText(actionsRoot, 'Add new').length, 0);

  context.selectedCategoryFilterIds.add('single');
  context.selectedRightCategoryIds.add('terminal');
  const categoryModalBody = new FakeElement('div');
  categoryModalBody.className = 'forced-modal-body';
  const categoryModal = new FakeElement('section');
  categoryModal.append(categoryModalBody);
  const makeCategoryEditor = () => {
    const editor = new FakeElement('div');
    for (const item of categoryState.groups[0].children) {
      const label = new FakeElement('label');
      label.className = 'category-checkbox';
      const input = new FakeElement('input');
      input.value = item.id;
      input.checked = false;
      const text = new FakeElement('span');
      text.textContent = item.label;
      label.append(input, text);
      editor.append(label);
    }
    return editor;
  };
  categoryModalBody.append(makeCategoryEditor());
  categoryModalBody.querySelectorAll('.category-checkbox input')
    .find((input) => input.value === 'terminal').checked = true;
  context.renderCategoryEditor = makeCategoryEditor;
  context.pageMetaModal = {
    type: 'category',
    mode: 'single',
    runtime,
    categoryInstructions: new Map(),
    modal: categoryModal
  };

  await buttonsByText(actionsRoot, 'Remove')[0].dispatch('click');
  assert.equal(buttonsByText(groupsRoot, '−').length, 4);
  const terminalRowBefore = itemRowFor('terminal');
  const terminalToggleBefore = descendants(terminalRowBefore)
    .find((element) => element.classList?.contains('vault-category-navigation-toggle'));
  assert.equal(terminalToggleBefore.dataset.selected, 'false');
  const requestCountBeforeItemRename = calls.requests.length;
  await renameFor('terminal').dispatch('click');
  assert.equal(elements.get('#vault-name-overlay').hidden, false);
  assert.equal(elements.get('#vault-name-title').textContent, 'Rename Category');
  assert.equal(elements.get('#vault-name-field-label').textContent, 'Category name');
  assert.equal(elements.get('#vault-name-input').value, 'Terminal');
  assert.equal(elements.get('#vault-name-confirm').textContent, 'Save');
  elements.get('#vault-name-input').value = 'Terminal Runtime';
  let imePrevented = 0;
  let imeStopped = 0;
  dispatchDocument('keydown', {
    target: elements.get('#vault-name-input'),
    key: 'Enter', keyCode: 229, isComposing: true,
    preventDefault() { imePrevented += 1; },
    stopPropagation() { imeStopped += 1; },
    stopImmediatePropagation() { imeStopped += 1; }
  });
  assert.equal(imePrevented, 0);
  assert.equal(imeStopped, 0);
  assert.equal(calls.requests.length, requestCountBeforeItemRename);
  assert.equal(elements.get('#vault-name-overlay').hidden, false);

  dispatchDocument('keydown', {
    target: elements.get('#vault-name-input'),
    key: 'Enter', keyCode: 13, isComposing: false,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  });
  await settle();

  assert.equal(calls.requests.length, requestCountBeforeItemRename + 1);
  assert.equal(calls.requests.at(-1).url, '/api/categories/items/terminal');
  assert.equal(calls.requests.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.requests.at(-1).options.body), { label: 'Terminal Runtime' });
  assert.deepEqual(categoryState.groups[0].children.map(({ id }) => id), ['single', 'terminal']);
  assert.deepEqual(context.categoryConfig.navigation.enabledCategoryIds, ['single']);
  assert.deepEqual([...context.selectedCategoryFilterIds], ['single']);
  assert.deepEqual([...context.selectedRightCategoryIds], ['terminal']);
  assert.equal(elements.get('#vault-name-overlay').hidden, true);
  assert.equal(buttonsByText(groupsRoot, '−').length, 4, 'removal mode survives Rename');
  const terminalRowAfter = itemRowFor('terminal');
  assert.equal(descendants(terminalRowAfter).some((node) => node.textContent === 'Terminal Runtime'), true);
  const terminalToggleAfter = descendants(terminalRowAfter)
    .find((element) => element.classList?.contains('vault-category-navigation-toggle'));
  assert.equal(terminalToggleAfter.dataset.selected, 'false');
  const refreshedModalInputs = categoryModalBody.querySelectorAll('.category-checkbox input');
  assert.equal(refreshedModalInputs.find((input) => input.value === 'terminal').checked, true);
  assert.equal(descendants(categoryModalBody).some((node) => node.textContent === 'Terminal Runtime'), true);

  const requestCountBeforeCancel = calls.requests.length;
  await renameFor('single').dispatch('click');
  elements.get('#vault-name-input').value = 'Cancelled';
  await elements.get('#vault-name-cancel').dispatch('click');
  assert.equal(calls.requests.length, requestCountBeforeCancel);
  assert.equal(elements.get('#vault-name-overlay').hidden, true);
  assert.equal(descendants(groupsRoot).some((node) => node.textContent === 'SingleProcess'), true);

  await renameFor('single').dispatch('click');
  dispatchDocument('keydown', {
    target: elements.get('#vault-name-input'),
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
  assert.equal(calls.requests.length, requestCountBeforeCancel);
  assert.equal(elements.get('#vault-name-overlay').hidden, true);
  assert.equal(elements.get('#vault-settings-overlay').hidden, false);

  await renameFor('single').dispatch('click');
  elements.get('#vault-name-input').value = '   ';
  await elements.get('#vault-name-confirm').dispatch('click');
  assert.equal(calls.requests.length, requestCountBeforeCancel);
  assert.equal(elements.get('#vault-name-overlay').hidden, false);
  assert.equal(elements.get('#vault-name-error').textContent, 'A non-empty Category label is required.');
  await elements.get('#vault-name-cancel').dispatch('click');

  const groupChildrenBefore = clone(categoryState.groups[0].children);
  await renameFor('level').dispatch('click');
  elements.get('#vault-name-input').value = 'Execution Level';
  await elements.get('#vault-name-confirm').dispatch('click');
  assert.equal(calls.requests.at(-1).url, '/api/categories/groups/level');
  assert.equal(calls.requests.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.requests.at(-1).options.body), { label: 'Execution Level' });
  assert.equal(categoryState.groups[0].id, 'level');
  assert.deepEqual(categoryState.groups[0].children, groupChildrenBefore);
  assert.equal(descendants(groupsRoot).some((node) => node.textContent === 'Execution Level'), true);

  groupSection = groupsRoot.children[0];
  groupHeader = groupSection.children[0];
  await groupHeader.children[1].dispatch('click');
  assert.equal(calls.requests.at(-1).url, '/api/categories/groups/level/items');
  assert.equal(calls.requests.at(-1).options.method, 'POST');
  await buttonsByText(actionsRoot, 'New Group')[0].dispatch('click');
  assert.equal(calls.requests.at(-1).url, '/api/categories/groups');
  assert.equal(calls.requests.at(-1).options.method, 'POST');
});

test('Preference rows keep Zoom first and Default Page Type second, then save the Reading toggle through Vault preferences', async () => {
  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  const preference = html.match(
    /<div id="vault-settings-control-panel"[\s\S]*?<div id="vault-settings-appearance-panel"/
  )?.[0] || '';
  const zoomIndex = preference.indexOf('id="zoom-sensitivity-slider"');
  const pageTypeIndex = preference.indexOf('id="vault-default-page-type"');
  const lineBreakIndex = preference.indexOf('id="preserve-single-line-breaks-switch"');
  assert.ok(zoomIndex >= 0 && zoomIndex < pageTypeIndex);
  assert.ok(pageTypeIndex < lineBreakIndex);
  assert.equal((html.match(/id="vault-default-page-type"/g) || []).length, 1);
  assert.match(preference, /Preserve Single Line Breaks[\s\S]*role="switch" aria-checked="false"/);

  const { context, elements } = await controlSettingsHarness();
  await elements.get('#vault-settings-control-nav').dispatch('click');
  const toggle = elements.get('#preserve-single-line-breaks-switch');
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  await toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.deepEqual(context.preferenceSaves, [{ preserveSingleLineBreaks: true }]);
  assert.equal(context.vaultPreferences.preserveSingleLineBreaks, true);
  assert.equal(context.preferenceApplications.length, 2);
  assert.equal(context.preferenceApplications.every(({ options }) => options.rerender === false), true);
});

test('Appearance lists colour settings followed by the three typography groups', async () => {
  const root = path.join(__dirname, '..');
  const [html, preload, desktopSettings, settingsSource] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/desktopSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8')
  ]);
  const appearanceMarkup = html.match(
    /<div id="vault-settings-appearance-panel"[\s\S]*?<div id="vault-settings-links-panel"/
  )?.[0] || '';
  assert.match(appearanceMarkup, />Font</);
  assert.match(appearanceMarkup, />File font</);
  assert.match(appearanceMarkup, />System font</);
  assert.match(appearanceMarkup, />Page font</);
  assert.equal((appearanceMarkup.match(/>Manage<\/button>/g) || []).length, 3);
  assert.match(appearanceMarkup, />Accent colour</);
  assert.match(appearanceMarkup, />Theme colour</);
  assert.doesNotMatch(appearanceMarkup, /weight|line-height/i);
  assert.match(preload, /listSystemFontFamilies: \(\) => ipcRenderer\.invoke\('cne-desktop:list-system-fonts'\)/);
  assert.doesNotMatch(desktopSettings, /appearance|font.*setting|theme/i);
  assert.match(settingsSource, /Manage \$\{group\.label\}/);
  assert.match(settingsSource, /vaultAppearanceStore\.update/);
  assert.doesNotMatch(settingsSource, /request\('\/api\/appearance'[\s\S]*method: 'PUT'/);
  assert.match(html, /id="vault-settings-vault-nav" class="vault-settings-navigation-item is-selected"[\s\S]*?aria-current="page"/);
  assert.match(settingsSource, /let vaultSettingsSection = 'vault'/);
  assert.match(settingsSource, /function openVaultSettings\(\)[\s\S]*?selectVaultSettingsSection\('vault'\)/);

  const { elements } = await controlSettingsHarness();
  await elements.get('#vault-settings-button').dispatch('click');
  await elements.get('#vault-settings-appearance-nav').dispatch('click');
  assert.equal(elements.get('#vault-settings-appearance-panel').hidden, false);
  assert.equal(elements.get('#vault-settings-control-panel').hidden, true);
  assert.equal(elements.get('#vault-settings-links-panel').hidden, true);
  await elements.get('#vault-settings-control-nav').dispatch('click');
  assert.equal(elements.get('#vault-settings-control-panel').hidden, false);
  await elements.get('#vault-settings-links-nav').dispatch('click');
  assert.equal(elements.get('#vault-settings-links-panel').hidden, false);
});

test('Preference keeps Zoom at 1.0× and usable in standalone browser mode without a bridge', async () => {
  const { context, elements } = await controlSettingsHarness();
  await elements.get('#vault-settings-button').dispatch('click');
  await elements.get('#vault-settings-control-nav').dispatch('click');
  await settle();
  assert.equal(elements.get('#zoom-sensitivity-value').textContent, '1.0×');
  elements.get('#zoom-sensitivity-slider').value = '1.5';
  await elements.get('#zoom-sensitivity-slider').dispatch('input');
  assert.equal(context.zoomSensitivity, 1.5);
  assert.equal(elements.get('#zoom-sensitivity-value').textContent, '1.5×');
});
