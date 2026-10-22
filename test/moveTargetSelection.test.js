const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Descriptor Move is silent until a valid group target is hovered', async () => {
  const [ui, css] = await Promise.all([
    read('public/js/descriptorModal.js'),
    read('public/styles.css')
  ]);
  assert.match(ui, /function enterDescriptorGroupMoveMode\(\)[\s\S]*?descriptorGroupMoveMode = \{ items \};[\s\S]*?descriptor-move-target-pick-mode/);
  assert.doesNotMatch(ui, /renderDescriptorMoveHint|descriptor-move-hint/);
  assert.match(ui, /groupedScroll\.addEventListener\('pointermove',[\s\S]*?closest\?\.\('\.descriptor-group-node'\)[\s\S]*?showDescriptorGroupMoveTarget/);
  assert.match(ui, /descriptorGroupMoveHint\.textContent = `Move “\$\{source\}” to “\$\{destinationName\}”`/);
  assert.match(ui, /descriptorGroupMoveHint\.style\.left[\s\S]*?event\.clientX \+ 10/);
  assert.match(ui, /descriptorGroupMoveHint\.style\.top[\s\S]*?event\.clientY \+ 10/);
  assert.match(ui, /groupedScroll\.addEventListener\('click',[\s\S]*?performDescriptorGroupMove\(\{ kind: 'group', groupId \}\)/);
  assert.match(ui, /const onPointerDown = \(event\)[\s\S]*?groupedPane\?\.contains\(event\.target\)[\s\S]*?return;[\s\S]*?cancelDescriptorGroupMoveMode\(\)/);
  assert.match(ui, /const onWindowBlur[\s\S]*?cancelDescriptorGroupMoveMode\(\)/);
  assert.match(css, /\.forced-modal\.descriptor-move-target-pick-mode \.descriptor-group-row\.selected,[\s\S]*?background: var\(--surface-guide\)/);
  assert.match(css, /\.descriptor-group-node\.is-move-hover \{[^}]*background: var\(--surface-guide\)/);
  assert.match(css, /\.descriptor-move-follow-hint \{[^}]*position: fixed;[^}]*pointer-events: none/);
});

test('Navigation Move removes the destination menu and enters pointer target-pick mode', async () => {
  const [html, app, ui, bootstrap, css] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/js/navigation.js'),
    read('public/js/appBootstrap.js'),
    read('public/styles.css')
  ]);
  assert.doesNotMatch(html, /navigation-move-menu/);
  assert.match(html, /id="navigation-move-hint" class="navigation-move-follow-hint" hidden/);
  assert.doesNotMatch(app, /navigationContextPosition/);
  assert.match(ui, /function openNavigationMoveMenu\(\)[\s\S]*?navigationMoveMode = \{ items, sourceText: navigationMoveSourceText\(items\) \};[\s\S]*?navigation-move-target-pick-mode/);
  assert.doesNotMatch(ui, /addNavigationMoveDestination|Move to top level/);
  assert.match(ui, /showNavigationMoveTarget\(folderWrapper, folder, event\)/);
  assert.match(ui, /positionNavigationMoveHint\([\s\S]*?`Move “\$\{navigationMoveMode\.sourceText\}” to “\$\{folder\.label \|\| folder\.id\}”`/);
  assert.match(ui, /function openNavigationBindingMenu[\s\S]*?kind: 'bind-to-leader'[\s\S]*?navigation-binding-target-pick-mode/);
  assert.match(ui, /performNavigationBatchMove\(\{ items \}, \{ parentFolderId: folder\.id \}\)/);
  assert.match(bootstrap, /navigationMoveMode && !pageList\.contains\(event\.target\)[\s\S]*?closeNavigationMoveMenu\(\)/);
  assert.match(bootstrap, /event\.key === 'Escape'[\s\S]*?navigationMoveMode[\s\S]*?closeNavigationMoveMenu\(\)/);
  assert.match(bootstrap, /window\.addEventListener\('blur',[\s\S]*?closeNavigationMoveMenu\(\)/);
  assert.match(css, /\.nav-folder\.is-move-pick-target > \.nav-folder-button \{[^}]*background: var\(--surface-guide-section\)/);
  assert.match(css, /\.navigation-move-follow-hint \{[^}]*position: fixed;[^}]*pointer-events: none/);
});

test('Escape closes Binding target mode while cancelling an active edit', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  const startMarker = "document.addEventListener('keydown', (event) => {";
  const endMarker = "\n});\n\nwindow.addEventListener('blur'";
  const start = bootstrap.indexOf(startMarker);
  const end = bootstrap.indexOf(endMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  let keydownHandler = null;
  let targetModeCloseCount = 0;
  let editCancelCount = 0;
  const runtime = {
    dom: {},
    blockEditMode: true,
    pageEditMode: false,
    highlightEditDraft: null,
    selectedBlockId: null
  };
  const context = vm.createContext({
    document: {
      activeElement: null,
      addEventListener(type, handler) {
        if (type === 'keydown') keydownHandler = handler;
      }
    },
    handleApplicationUndoRedo: () => false,
    pageMetaModal: null,
    handlePageHistoryKeyDown: () => false,
    activePaneRuntime: () => runtime,
    addLinkPopover: { hidden: true },
    navigationMoveMode: { kind: 'bind-to-leader' },
    closeNavigationMoveMenu() {
      targetModeCloseCount += 1;
      context.navigationMoveMode = null;
    },
    cancelBlockEdits(owner) {
      assert.strictEqual(owner, runtime);
      editCancelCount += 1;
      owner.blockEditMode = false;
    }
  });
  vm.runInContext(bootstrap.slice(start, end + 4), context);
  assert.equal(typeof keydownHandler, 'function');

  let prevented = false;
  keydownHandler({
    key: 'Escape',
    metaKey: false,
    ctrlKey: false,
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(targetModeCloseCount, 1);
  assert.equal(editCancelCount, 1);
  assert.equal(context.navigationMoveMode, null);
  assert.equal(runtime.blockEditMode, false);
});
