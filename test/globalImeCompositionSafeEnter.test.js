'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const textEditingModel = require('../public/textEditing');
const { createPaneRuntimeHarness } = require('./helpers/paneRuntimeHarness');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFile(path.join(ROOT, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function compileSource(source, startMarker, endMarker, dependencies, returnExpression) {
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return new Function(
    ...names,
    `${sourceBetween(source, startMarker, endMarker)}\nreturn ${returnExpression};`
  )(...values);
}

function claimantRegion(source, ownerMarker, handlerMarker, span = 2400) {
  const owner = source.indexOf(ownerMarker);
  assert.notEqual(owner, -1, `missing Enter owner: ${ownerMarker}`);
  const handler = source.indexOf(handlerMarker, owner);
  assert.notEqual(handler, -1, `missing Enter handler after ${ownerMarker}: ${handlerMarker}`);
  return source.slice(handler, handler + span);
}

function assertSharedGuardBeforeEffect(source, claim) {
  const region = claimantRegion(
    source,
    claim.owner,
    claim.handler,
    claim.span
  );
  const guard = region.indexOf('isImeCompositionOwnedKeyEvent');
  const effect = region.indexOf(claim.effect, Math.max(0, guard));
  assert.notEqual(guard, -1, `${claim.name} must consume the shared IME predicate`);
  assert.notEqual(effect, -1, `${claim.name} effect marker is missing: ${claim.effect}`);
  assert.ok(guard < effect, `${claim.name} must guard before its Viewer Enter effect`);
  assert.doesNotMatch(
    region.slice(0, guard),
    /event\.(?:preventDefault|stopPropagation|stopImmediatePropagation)\s*\(/,
    `${claim.name} must not cancel native IME settlement before the shared guard`
  );
}

test('one shared composition owner is loaded before every browser claimant', async () => {
  const [model, index, vocabulary] = await Promise.all([
    read('public/textEditing.js'),
    read('public/index.html'),
    read('public/vocabulary.html')
  ]);
  assert.equal((model.match(/function isImeCompositionOwnedKeyEvent\s*\(/g) || []).length, 1);
  assert.match(model, /installImeCompositionOwnership\(root\.document\)/);
  assert.match(model, /compositionstart[\s\S]*compositionend[\s\S]*keydown[\s\S]*keyup/);
  assert.doesNotMatch(model, /setTimeout|Date\.now|navigator\.language|locale|Pinyin|Zhuyin|Han/);
  assert.match(index, /textEditing\.js\?v=text-editing-v03[\s\S]*app\.js/);
  assert.match(vocabulary, /textEditing\.js\?v=text-editing-v03[\s\S]*vocabulary\.js/);
});

test('all Viewer Enter claimants guard before command side effects', async () => {
  const files = Object.fromEntries(await Promise.all([
    'public/app.js',
    'public/vocabulary.js',
    'public/js/appBootstrap.js',
    'public/js/structuredTextPageShell.js',
    'public/js/navigation.js',
    'public/js/descriptorModal.js',
    'public/js/infoPanels.js',
    'public/js/externalLinks.js',
    'public/js/canvasBlocks.js',
    'public/js/vaultSettings.js',
    'public/js/sourceCanonicalEditor.js',
    'public/js/markdownPageView.js'
  ].map(async (file) => [file, await read(file)])));

  const claims = [
    { name: 'Highlight Group rename', file: 'public/app.js', owner: 'function beginHighlightGroupRename', handler: "input.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'Vocabulary rename', file: 'public/vocabulary.js', owner: 'function renderInlineEdit', handler: "input.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'Pane title', file: 'public/js/appBootstrap.js', owner: 'function bindPaneToolbarInteractions', handler: "dom.pageTitle?.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'global Add Link/Page Edit owner', file: 'public/js/appBootstrap.js', owner: "document.addEventListener('keydown', (event) => {", handler: "document.addEventListener('keydown', (event) => {", effect: 'event.preventDefault();', span: 4200 },
    { name: 'bound structured-text title', file: 'public/js/structuredTextPageShell.js', owner: 'function createBoundTitle', handler: "title.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'Navigation rename', file: 'public/js/navigation.js', owner: 'function bindStableNavigationRenameInput', handler: "input.addEventListener('keydown'", effect: 'event.stopPropagation();' },
    { name: 'Folder-delete confirmation', file: 'public/js/navigation.js', owner: 'function confirmFolderDelete', handler: 'const onKeyDown = (event) => {', effect: 'event.preventDefault();' },
    { name: 'Descriptor Group rename', file: 'public/js/descriptorModal.js', owner: 'function renderDescriptorGroupNode', handler: "input.addEventListener('keydown'", effect: 'event.stopPropagation();' },
    { name: 'Descriptor chip input', file: 'public/js/descriptorModal.js', owner: 'function renderDescriptorClassEditor', handler: "input.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'Page metadata modal', file: 'public/js/descriptorModal.js', owner: 'function openPageMetaModal', handler: 'const onKeyDown = (event) => {', effect: 'event.preventDefault();' },
    { name: 'Info text save', file: 'public/js/infoPanels.js', owner: 'function createInfoPanelElement', handler: "textarea.addEventListener('keydown'", effect: 'event.stopPropagation();' },
    { name: 'Info edit activation', file: 'public/js/infoPanels.js', owner: 'function createInfoPanelElement', handler: "content.addEventListener('keydown'", effect: 'event.preventDefault();', span: 4200 },
    { name: 'External Link confirmation', file: 'public/js/externalLinks.js', owner: "externalLinkSidebarPopover?.addEventListener('keydown'", handler: "externalLinkSidebarPopover?.addEventListener('keydown'", effect: 'event.preventDefault();' },
    { name: 'Quick Colour propagation barrier', file: 'public/js/canvasBlocks.js', owner: 'function buildQuickColourBar', handler: "bar.addEventListener('keydown'", effect: 'event.stopPropagation();', span: 4200 },
    { name: 'Appearance colour confirmation', file: 'public/js/vaultSettings.js', owner: 'function handleAppearanceColourKeyDown', handler: 'function handleAppearanceColourKeyDown', effect: 'event.stopPropagation();' },
    { name: 'Appearance manager confirmation', file: 'public/js/vaultSettings.js', owner: 'function handleAppearanceManageKeyDown', handler: 'function handleAppearanceManageKeyDown', effect: 'event.stopPropagation();' },
    { name: 'Vault/Category name confirmation', file: 'public/js/vaultSettings.js', owner: 'function handleVaultNameKeyDown', handler: 'function handleVaultNameKeyDown', effect: 'event.preventDefault();' },
    { name: 'Vault Settings capture owner', file: 'public/js/vaultSettings.js', owner: 'function handleVaultSettingsKeyDown', handler: 'function handleVaultSettingsKeyDown', effect: 'event.preventDefault();' },
    { name: 'HN beforeinput newline', file: 'public/js/sourceCanonicalEditor.js', owner: '_beforeInput(event) {', handler: '_beforeInput(event) {', effect: 'this._applyPresentationNewline' },
    { name: 'HN keydown newline/list command', file: 'public/js/sourceCanonicalEditor.js', owner: '_keydown(event) {', handler: '_keydown(event) {', effect: 'event.preventDefault?.();' },
    { name: 'Markdown beforeinput newline', file: 'public/js/markdownPageView.js', owner: "bodyRoot.addEventListener('beforeinput'", handler: "bodyRoot.addEventListener('beforeinput'", effect: 'event.preventDefault();', span: 4200 },
    { name: 'Markdown keydown newline/list/table command', file: 'public/js/markdownPageView.js', owner: "bodyRoot.addEventListener('keydown'", handler: 'if (!semanticModeEditable(state)) return;', effect: 'event.stopPropagation();', span: 4200 }
  ];
  for (const claim of claims) assertSharedGuardBeforeEffect(files[claim.file], claim);

  const globalHandler = claimantRegion(
    files['public/js/appBootstrap.js'],
    "document.addEventListener('keydown', (event) => {",
    "document.addEventListener('keydown', (event) => {",
    4200
  );
  assert.match(globalHandler, /event\.key === 'Enter' && addLinkPopover\.contains\(event\.target\)/,
    'sidebar search must not bubble into Add Link confirmation');
});

test('Pane title keeps the IME Enter native, then the next ordinary Enter saves once', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  const harness = await createPaneRuntimeHarness();
  const runtime = harness.left.runtime;
  const region = harness.document.createElement('div');
  region.dataset.workspacePaneId = runtime.paneId;
  const pageTitle = harness.document.createElement('input');
  runtime.dom = { toolbarRegion: region, pageTitle };
  const saves = [];
  const bindPaneToolbarInteractions = compileSource(
    bootstrap,
    'function bindPaneToolbarInteractions',
    'function bindWorkspacePaneInteractions',
    {
      runtimeForPane: (paneOrId) => {
        const pane = typeof paneOrId === 'string' ? harness.panes.get(paneOrId) : paneOrId;
        return pane?.viewContext || null;
      },
      runtimeIsLive: harness.runtimeIsLive,
      activePaneRuntime: harness.activePaneRuntime,
      setActiveWorkspacePane: harness.setActiveWorkspacePane,
      saveTitle: (owner) => saves.push(owner),
      globalThis: { textEditingModel }
    },
    'bindPaneToolbarInteractions'
  );
  bindPaneToolbarInteractions(harness.left.pane);
  pageTitle.focus();
  pageTitle.blur = () => pageTitle.dispatch('blur');

  const imeEnter = await pageTitle.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true
  });
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(imeEnter.cancelBubble, false);
  assert.deepEqual(saves, []);
  assert.strictEqual(harness.document.activeElement, pageTitle);

  const ordinaryEnter = await pageTitle.dispatch('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false
  });
  await Promise.resolve();
  assert.equal(ordinaryEnter.defaultPrevented, true);
  assert.deepEqual(saves, [runtime]);
});
