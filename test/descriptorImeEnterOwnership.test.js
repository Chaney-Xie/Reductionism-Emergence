'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const textEditingModel = require('../public/textEditing');
const {
  CanvasFakeDocument,
  CanvasFakeElement
} = require('./helpers/colourfulCanvasHarness');

const ROOT = path.join(__dirname, '..');
const DESCRIPTOR_MODAL_SOURCE = fs.readFileSync(
  path.join(ROOT, 'public/js/descriptorModal.js'),
  'utf8'
);

function createDescriptorImeHarness() {
  const document = new CanvasFakeDocument();
  const requests = [];
  const adoptedPages = [];
  const renderedPageLists = [];
  const statuses = [];
  const undoEntries = [];
  let categoryInput = null;

  const runtime = {
    paneId: 'pane-descriptor-ime',
    runtimeId: 'runtime-descriptor-ime',
    disposed: false,
    blockEditMode: false,
    pageEditMode: false,
    currentPage: {
      id: 'page-descriptor-ime',
      categories: []
    }
  };
  const windowListeners = new Map();
  const window = {
    location: { origin: 'http://viewer.test' },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      windowListeners.set(type, listeners.filter((candidate) => candidate !== listener));
    },
    confirm: () => true,
    nativeContextMenu: null
  };

  const context = vm.createContext({
    console,
    document,
    window,
    HTMLInputElement: CanvasFakeElement,
    CSS: { escape: (value) => String(value) },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    dictionaryChannel: null,
    textEditingModel,
    descriptorLibrary: {
      classes: [{ id: 'class_1', label: 'Class 1' }],
      entries: []
    },
    vocabularyLibrary: { entries: [] },
    descriptorGroupsConfig: {
      version: 1,
      groups: {
        group_1: {
          id: 'group_1',
          name: 'Original Group',
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      },
      descriptorParentByEntryId: {}
    },
    originalDescriptorGroupsConfig: null,
    descriptorDraft: { class_1: [] },
    ignoredDescriptorDraft: { class_1: [] },
    ignoredManualEntryIdsDraft: { class_1: [] },
    descriptorDraftDirty: false,
    descriptorContextTarget: null,
    descriptorGroupContextTarget: null,
    descriptorGroupVisibleOrder: [],
    descriptorGroupSelectionAnchor: null,
    descriptorGroupRename: {
      groupId: 'group_1',
      previousName: 'Original Group',
      isNew: false,
      committing: false,
      beforeSnapshot: {
        groups: {
          version: 1,
          groups: {
            group_1: {
              id: 'group_1', name: 'Original Group', parentId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          },
          descriptorParentByEntryId: {}
        },
        descriptors: { class_1: [] },
        ignored: { class_1: [] },
        ignoredManual: { class_1: [] },
        dirty: false
      }
    },
    descriptorGroupMoveMode: null,
    descriptorGroupMoveHint: null,
    descriptorGroupMoveHoverNode: null,
    descriptorGroupDragSelection: null,
    descriptorBrowserRightWidth: 160,
    descriptorDividerDragCleanup: null,
    selectedDescriptorGroupItems: new Set(),
    expandedDescriptorGroupIds: new Set(),
    staleIgnoredDescriptorKeys: null,
    pageMetaModal: null,
    navigation: null,
    pendingDictionaryCommand: null,
    handledDictionaryEventIds: new Set(),
    dictionarySyncPromise: Promise.resolve(),
    activeUndoContext: null,
    descriptorMutation: {
      normalRemoval: () => ({ createIgnored: false, rememberManual: false }),
      restoreSource: () => 'manual',
      canExplicitlyExclude: () => false
    },
    descriptorGroupsModel: {
      membershipKey: (entry) => entry?.vocabularyEntryId || entry?.id || '',
      childGroupIds: () => [],
      normalizeMoveSelection: (_config, items) => items,
      moveSelection: () => ({ changed: false }),
      deleteGroup: (config) => ({ changed: false, config }),
      removeMemberships: (config) => ({ config }),
      remapMemberships: (config) => ({ config })
    },
    categoryBatch: {
      normalizeStableIds: (ids) => Array.isArray(ids) ? [...ids] : [],
      instructionPayload: () => ({})
    },
    undoManager: {
      record(entry) {
        undoEntries.push(entry);
        return true;
      },
      beginContext() {},
      commitContext() {},
      cancelContext() {}
    },
    activePaneRuntime: () => runtime,
    runtimeIsLive: (candidate) => candidate === runtime && !candidate.disposed,
    captureRuntimeOperation: (candidate, options = {}) => ({
      runtime: candidate,
      pageId: options.pageId || candidate?.currentPage?.id || null,
      scope: options.scope || ''
    }),
    runtimeOperationIsCurrent: (operation) => operation?.runtime === runtime,
    showRuntimeStatus: (_runtime, message, isError = false) => {
      statuses.push({ message, isError });
      return true;
    },
    renderCategoryEditor: () => {
      categoryInput = document.createElement('input');
      categoryInput.type = 'text';
      categoryInput.className = 'category-filter-input';
      return categoryInput;
    },
    selectedCategoryIdsFromModal: () => ['category_1'],
    pageApiUrl: (pageId) => `/api/pages/${pageId}`,
    request: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === '/api/navigation') return { folders: [], root: [] };
      return { ...runtime.currentPage, categories: ['category_1'] };
    },
    adoptCategoryCommandPages: (pages) => adoptedPages.push(pages),
    renderPageList: () => renderedPageLists.push(true),
    closeNavigationSortMenu() {},
    closeNavigationMoveMenu() {},
    closeAddLinkPopover() {},
    closePageContextMenu() {},
    closeFolderContextMenu() {},
    closeRelationContextMenu() {},
    closeResourceContextMenu() {},
    setEditMenuOpen() {},
    commitCanonicalPage() {},
    renderRelations() {},
    transactionalValuesEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    runDescriptorMetadataPresentation: (callback) => callback(),
    installDescriptorMetadataChangeSet: async () => ({ applied: true })
  });

  new vm.Script(DESCRIPTOR_MODAL_SOURCE, {
    filename: 'public/js/descriptorModal.js'
  }).runInContext(context);
  new vm.Script(`
    globalThis.__descriptorImeTest = Object.freeze({
      renderDescriptorGroupNode,
      renderDescriptorClassEditor,
      openPageMetaModal,
      state: () => ({
        groupName: descriptorGroupsConfig.groups.group_1?.name || null,
        groupRenameActive: Boolean(descriptorGroupRename),
        chips: (descriptorDraft?.class_1 || []).map((chip) => ({ ...chip })),
        draftDirty: descriptorDraftDirty,
        modalOpen: Boolean(pageMetaModal),
        modalElement: pageMetaModal?.modal || null
      })
    });
  `, { filename: 'test/descriptorImeEnterOwnership.inject.js' }).runInContext(context);

  textEditingModel.installImeCompositionOwnership(document);
  return {
    api: context.__descriptorImeTest,
    context,
    document,
    runtime,
    requests,
    adoptedPages,
    renderedPageLists,
    statuses,
    undoEntries,
    categoryInput: () => categoryInput
  };
}

async function beginComposition(document, input) {
  input.focus();
  await document.dispatch('compositionstart', { target: input, data: '' });
}

async function settleComposition(document, input) {
  await document.dispatch('compositionend', { target: input, data: input.value });
  await document.dispatch('keyup', {
    target: input,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    isComposing: false
  });
}

test('Descriptor Group rename leaves the IME Enter native, then commits the next Enter once', async () => {
  const harness = createDescriptorImeHarness();
  const node = harness.api.renderDescriptorGroupNode('group_1');
  const input = node.querySelector('.descriptor-group-rename-input');
  assert.ok(input, 'the real group renderer must install its rename input');
  input.value = 'Renamed Group';

  await beginComposition(harness.document, input);
  const legacyProcessEnter = await input.dispatch('keydown', {
    key: 'Process', code: '', keyCode: 229, isComposing: false
  });
  assert.equal(legacyProcessEnter.defaultPrevented, false);
  assert.equal(legacyProcessEnter.cancelBubble, false,
    'the Chromium 229 compatibility signal returns before the rename propagation barrier');
  const imeEnter = await input.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(imeEnter.cancelBubble, false);
  assert.equal(harness.api.state().groupName, 'Original Group');
  assert.equal(harness.api.state().groupRenameActive, true);
  assert.equal(harness.undoEntries.length, 0);

  await settleComposition(harness.document, input);
  const ordinaryEnter = await input.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(ordinaryEnter.defaultPrevented, true);
  assert.equal(ordinaryEnter.cancelBubble, true);
  assert.equal(harness.api.state().groupName, 'Renamed Group');
  assert.equal(harness.api.state().groupRenameActive, false);
  assert.equal(harness.undoEntries.length, 1);
});

test('Descriptor chip input creates nothing on the IME Enter, then creates one chip', async () => {
  const harness = createDescriptorImeHarness();
  const section = harness.api.renderDescriptorClassEditor({ id: 'class_1', label: 'Class 1' });
  const input = section.querySelector('.descriptor-input');
  assert.ok(input, 'the real descriptor editor must install its token input');
  input.value = 'Alpha';

  await beginComposition(harness.document, input);
  const imeEnter = await input.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(imeEnter.cancelBubble, false);
  assert.equal(input.value, 'Alpha');
  assert.deepEqual(harness.api.state().chips, []);
  assert.equal(harness.api.state().draftDirty, false);
  assert.equal(harness.undoEntries.length, 0);

  await settleComposition(harness.document, input);
  const ordinaryEnter = await input.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
  });
  assert.equal(ordinaryEnter.defaultPrevented, true);
  assert.equal(ordinaryEnter.cancelBubble, true);
  assert.equal(input.value, '');
  assert.equal(harness.api.state().chips.length, 1);
  assert.equal(harness.api.state().chips[0].display, 'Alpha');
  assert.equal(harness.api.state().chips[0].source, 'manual');
  assert.equal(harness.api.state().draftDirty, true);
  assert.equal(harness.undoEntries.length, 1);
});

test('Page metadata modal stays open on the IME Enter, then saves and closes once', async () => {
  const harness = createDescriptorImeHarness();
  harness.api.openPageMetaModal(harness.runtime, 'category');
  const input = harness.categoryInput();
  assert.ok(input, 'the real modal opener must mount its category body');
  assert.equal(harness.api.state().modalOpen, true);

  await beginComposition(harness.document, input);
  let imeStopCount = 0;
  const imeEnter = await harness.document.dispatch('keydown', {
    target: input,
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false,
    stopPropagation: () => { imeStopCount += 1; }
  });
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(imeEnter.immediatePropagationStopped, false);
  assert.equal(imeStopCount, 0);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.adoptedPages.length, 0);
  assert.equal(harness.renderedPageLists.length, 0);
  assert.equal(harness.api.state().modalOpen, true);

  await settleComposition(harness.document, input);
  let ordinaryStopCount = 0;
  const ordinaryEnter = await harness.document.dispatch('keydown', {
    target: input,
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false,
    stopPropagation: () => { ordinaryStopCount += 1; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ordinaryEnter.defaultPrevented, true);
  assert.equal(ordinaryStopCount, 1);
  assert.deepEqual(harness.requests.map((entry) => entry.url), [
    '/api/pages/page-descriptor-ime',
    '/api/navigation'
  ]);
  assert.equal(harness.adoptedPages.length, 1);
  assert.equal(harness.renderedPageLists.length, 1);
  assert.equal(harness.api.state().modalOpen, false);
  assert.equal(harness.statuses.filter((entry) => entry.message === 'Saved').length, 1);
});
