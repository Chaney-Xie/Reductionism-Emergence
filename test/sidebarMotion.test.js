'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

function fakeElement() {
  return {
    inert: false,
    classList: new FakeClassList(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  };
}

async function sidebarStateHarness() {
  const source = await read('public/app.js');
  const start = source.indexOf('function setSidebarCollapsed');
  const end = source.indexOf('function renderDescriptorSearchPanel', start);
  assert.ok(start >= 0 && end > start, 'Sidebar state primitive must remain extractable');

  const body = { classList: new FakeClassList() };
  const leftSidebar = fakeElement();
  const leftCreateToolbar = fakeElement();
  const rightSidebar = fakeElement();
  const rightChromeSpacer = fakeElement();
  const leftSidebarToggle = fakeElement();
  const rightSidebarToggle = fakeElement();
  const events = [];
  const runtime = { id: 'runtime-active' };
  const context = {
    document: { body },
    leftSidebar,
    leftCreateToolbar,
    rightSidebar,
    rightChromeSpacer,
    leftSidebarToggle,
    rightSidebarToggle,
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    activePaneRuntime: () => runtime,
    clearExternalLinkBlockHover: (owner) => {
      assert.equal(owner, runtime);
      events.push('clear-right-hover');
    },
    clearNavigationSelection: () => events.push('clear-left-selection'),
    closeNavigationMoveMenu: () => events.push('close-left-move'),
    closeNavigationSortMenu: () => events.push('close-left-sort'),
    restoreSidebarExpandedWidth: (side) => events.push(`restore-${side}`),
    scheduleWorkspaceStateSave: () => events.push('save'),
    updateRightSidebarLayout: () => events.push('layout-right'),
    requestAnimationFrame: (callback) => callback()
  };

  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.sidebarStateTestApi = {
    setSidebarCollapsed,
    setLeftSidebarOpen,
    setRightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar
  };`, context);

  return { api: context.sidebarStateTestApi, body, context, events, roots: {
    leftSidebar,
    leftCreateToolbar,
    rightSidebar,
    rightChromeSpacer,
    leftSidebarToggle,
    rightSidebarToggle
  } };
}

test('one shared Sidebar primitive commits independent canonical targets and inert semantics', async () => {
  const harness = await sidebarStateHarness();
  const { api, body, context, events, roots } = harness;

  assert.equal(api.setLeftSidebarOpen(false), false);
  assert.equal(context.leftSidebarOpen, false);
  assert.equal(context.rightSidebarOpen, true);
  assert.equal(body.classList.contains('left-sidebar-collapsed'), true);
  assert.equal(roots.leftSidebar.inert, true);
  assert.equal(roots.leftCreateToolbar.inert, true);
  assert.equal(roots.leftSidebarToggle.attributes.get('aria-pressed'), 'false');
  assert.deepEqual(events.slice(0, 4), [
    'clear-left-selection', 'close-left-move', 'close-left-sort', 'save'
  ]);

  api.setRightSidebarOpen(false);
  assert.equal(context.leftSidebarOpen, false);
  assert.equal(context.rightSidebarOpen, false);
  assert.equal(body.classList.contains('right-sidebar-collapsed'), true);
  assert.equal(roots.rightSidebar.inert, true);
  assert.equal(roots.rightChromeSpacer.inert, true);
  assert.equal(roots.rightSidebarToggle.attributes.get('aria-pressed'), 'false');

  api.setLeftSidebarOpen(true);
  api.setRightSidebarOpen(true);
  assert.equal(context.leftSidebarOpen, true);
  assert.equal(context.rightSidebarOpen, true);
  assert.equal(roots.leftSidebar.inert, false);
  assert.equal(roots.rightSidebar.inert, false);
  assert.ok(events.includes('restore-left'));
  assert.ok(events.includes('restore-right'));
  assert.ok(events.includes('layout-right'));

  const reopenEvents = events.length;
  api.setLeftSidebarOpen(false);
  api.setRightSidebarOpen(true);
  assert.deepEqual(events.slice(reopenEvents).filter((event) => event.startsWith('restore-')), [
    'restore-right'
  ]);
  const pairEvents = events.length;
  api.setLeftSidebarOpen(true);
  assert.deepEqual(events.slice(pairEvents).filter((event) => event.startsWith('restore-')), [
    'restore-left',
    'restore-right'
  ]);
});

test('rapid requests resolve to the latest target without queued animation lifecycle state', async () => {
  const harness = await sidebarStateHarness();
  const { api, body, context } = harness;

  api.setLeftSidebarOpen(false);
  api.setRightSidebarOpen(false);
  api.setLeftSidebarOpen(true);
  api.setRightSidebarOpen(true);
  api.setLeftSidebarOpen(false);
  api.setRightSidebarOpen(true);

  assert.equal(context.leftSidebarOpen, false);
  assert.equal(context.rightSidebarOpen, true);
  assert.equal(body.classList.contains('left-sidebar-collapsed'), true);
  assert.equal(body.classList.contains('right-sidebar-collapsed'), false);

  const source = await read('public/app.js');
  const primitive = source.slice(
    source.indexOf('function setSidebarCollapsed'),
    source.indexOf('function renderDescriptorSearchPanel')
  );
  assert.doesNotMatch(primitive, /transitionend|setTimeout|animationFrame|animating|progress/);
});

test('typed active lengths drive all real grids and keep each side interruption-safe', async () => {
  const css = await read('public/styles.css');

  for (const property of [
    '--active-left-sidebar-width',
    '--active-right-sidebar-width',
    '--active-left-header-width',
    '--viewer-tab-start-inset'
  ]) {
    assert.match(css, new RegExp(`@property ${property.replaceAll('-', '\\-')} \\{[^}]*syntax: '<length>';[^}]*inherits: true;`));
  }
  assert.match(css, /--sidebar-motion-duration: 170ms;/);
  assert.match(css, /--sidebar-motion-easing: cubic-bezier\(0\.2, 0\.75, 0\.25, 1\);/);
  assert.match(css, /body\.sidebar-motion-ready \{[^}]*--active-left-sidebar-width[^}]*--active-left-header-width[^}]*--viewer-tab-start-inset[^}]*--active-right-sidebar-width/);
  assert.match(css, /body\[data-sidebar-resize-side='left'\] \{[^}]*--left-sidebar-motion-duration: 0ms;/);
  assert.match(css, /body\[data-sidebar-resize-side='right'\] \{[^}]*--right-sidebar-motion-duration: 0ms;/);
  assert.match(css, /body\.sidebar-viewport-reconciling \{[^}]*--left-sidebar-motion-duration: 0ms;[^}]*--right-sidebar-motion-duration: 0ms;/);
  assert.match(css, /\.app-topbar \{[^}]*grid-template-columns: var\(--active-left-header-width\)[^}]*var\(--active-right-sidebar-width\);/);
  assert.match(css, /\.app-chrome-row-two \{[^}]*grid-template-columns: var\(--active-left-sidebar-width\)[^}]*var\(--active-right-sidebar-width\);/);
  assert.match(css, /\.layout \{[^}]*grid-template-columns: var\(--active-left-sidebar-width\)[^}]*var\(--active-right-sidebar-width\);/);
});

test('outer panels clip fixed expanded-width children and retire visibility only at the endpoint', async () => {
  const css = await read('public/styles.css');

  assert.match(css, /\.sidebar \{[^}]*width: 100%;[^}]*padding: 1\.25rem;/);
  assert.match(css, /\.left-sidebar \{[^}]*min-width: 0;[^}]*padding: 0;[^}]*overflow: hidden;[^}]*border-right: 0;/);
  assert.match(css, /\.right-sidebar \{[^}]*min-width: 0;[^}]*padding: 0;[^}]*overflow: hidden;[^}]*border-left: 0;/);
  assert.match(css, /\.left-sidebar::after,[\s\S]*?\.right-sidebar::before \{[^}]*width: 1px;[^}]*background: var\(--border-tool\);/);
  assert.match(css, /\.left-sidebar > \.left-sidebar-scroll-region \{[^}]*width: calc\(var\(--left-sidebar-width\) - 1\.25rem - 1px\);[^}]*min-width: calc\(var\(--left-sidebar-width\) - 1\.25rem - 1px\);[^}]*max-width: calc\(var\(--left-sidebar-width\) - 1\.25rem - 1px\);/);
  assert.match(css, /\.right-sidebar-view \{[^}]*align-self: flex-end;[^}]*width: calc\(var\(--right-sidebar-width\) - 1px\);[^}]*overflow: hidden;/);
  assert.match(css, /\.left-create-toolbar \{[^}]*width: 100%;[^}]*padding: 0\.25rem min\(0\.55rem, calc\(var\(--active-left-sidebar-width\) \/ 2\)\);[^}]*overflow: hidden;/);
  assert.match(css, /\.right-top-toolbar \{[^}]*min-width: 0;[^}]*padding: 0\.15rem min\(0\.55rem, calc\(var\(--active-right-sidebar-width\) \/ 2\)\);[^}]*border-left: 0;[^}]*box-shadow: inset 1px 0 0 var\(--border-tool\);[^}]*overflow: hidden;/);
  assert.match(css, /\.app-topbar::after \{[^}]*left: calc\(100% - var\(--active-right-sidebar-width\)\);[^}]*width: min\(1px, var\(--active-right-sidebar-width\)\);/);
  assert.match(css, /\.sidebar-resize-handle-left \{[^}]*left: max\(var\(--active-left-sidebar-width\), 4\.5px\);/);
  assert.match(css, /\.sidebar-resize-handle-right \{[^}]*right: max\(var\(--active-right-sidebar-width\), 4\.5px\);/);
  assert.doesNotMatch(css, /body\.left-sidebar-collapsed \.left-sidebar,\s*body\.right-sidebar-collapsed \.right-sidebar \{[^}]*display:\s*none/);
  assert.match(css, /body\.sidebar-motion-ready\.left-sidebar-collapsed \.left-create-toolbar,[\s\S]*?transition-delay: var\(--left-sidebar-motion-duration\);/);
  assert.match(css, /body\.sidebar-motion-ready\.right-sidebar-collapsed \.right-chrome-spacer,[\s\S]*?transition-delay: var\(--right-sidebar-motion-duration\);/);
  assert.match(css, /body\.left-sidebar-collapsed \.left-create-toolbar,[\s\S]*?visibility: hidden;[^}]*pointer-events: none;/);
});

test('startup installs restored endpoints before motion and resize retargets existing width owners', async () => {
  const [app, bootstrap, resize, workspaceUi, workspaceModel] = await Promise.all([
    read('public/app.js'),
    read('public/js/appBootstrap.js'),
    read('public/js/sidebarResize.js'),
    read('public/js/workspaceState.js'),
    read('public/workspaceState.js')
  ]);
  const startup = bootstrap.slice(bootstrap.indexOf('async function start()'));
  const restore = startup.indexOf('restoreWorkspaceState(savedWorkspaceState)');
  const left = startup.indexOf('setLeftSidebarOpen(leftSidebarOpen)');
  const right = startup.indexOf('setRightSidebarOpen(rightSidebarOpen)');
  const arm = startup.indexOf('enableSidebarMotionAfterRestore()');
  assert.ok(restore >= 0 && restore < left && left < right && right < arm);
  assert.match(resize, /function enableSidebarMotionAfterRestore\(\)[\s\S]*?requestAnimationFrame[\s\S]*?classList\.add\('sidebar-motion-ready'\)/);
  assert.match(resize, /window\.addEventListener\('resize', reconcileSidebarWidthsToViewport\)/);
  assert.doesNotMatch(resize, /scheduleSidebarViewportReconciliation|sidebarViewportResizeFrame/);
  assert.match(resize, /function reconcileSidebarWidthsToViewport\(\) \{[\s\S]*?leftSidebarOpen[\s\S]*?restoreSidebarExpandedWidth\('left'\)[\s\S]*?rightSidebarOpen[\s\S]*?restoreSidebarExpandedWidth\('right'\)/);
  assert.match(resize, /sidebar-viewport-reconciling[\s\S]*?document\.body\.offsetWidth[\s\S]*?classList\.remove\('sidebar-viewport-reconciling'\)/);
  const paneObserver = app.slice(
    app.indexOf('function initializeWorkspacePaneStackLayout'),
    app.indexOf('function ensureWorkspacePaneChromeLayer')
  );
  assert.match(app, /function workspacePaneAvailableWidth\(\) \{[\s\S]*?getBoundingClientRect\(\)\.width/);
  assert.doesNotMatch(app, /function workspacePaneAvailableWidth\(\) \{[\s\S]*?\.clientWidth/);
  assert.match(app, /function workspacePaneStructureSignature\(\)[\s\S]*?pane\.id[\s\S]*?pane\.mode/);
  assert.match(app, /const structureChanged = beforeStructure !== workspacePaneStructureSignature\(\);[\s\S]*?if \(structureChanged\) renderWorkspacePaneStackState\(\);[\s\S]*?else \{[\s\S]*?applyWorkspacePaneGeometry\(\);/);
  assert.match(app, /const orderChanged = mountedElements\.length !== orderedElements\.length[\s\S]*?if \(orderChanged\) workspacePaneRoot\.replaceChildren/);
  assert.match(paneObserver, /new ResizeObserver\(\(\) => \{[\s\S]*?fitWorkspacePanesToAvailableWidth\(\);/);
  assert.doesNotMatch(paneObserver, /requestAnimationFrame|workspacePaneLayoutFrame/);
  assert.doesNotMatch(`${workspaceUi}\n${workspaceModel}`, /sidebarMotion|animationProgress|transitionProgress/);
});

test('pointer Sidebar toggles preserve the active Page editor selection', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  assert.match(bootstrap, /function preservePageEditorSelectionForSidebarToggle\(event\) \{\s*if \(event\.button === 0\) event\.preventDefault\(\);\s*\}/);
  assert.match(bootstrap, /leftSidebarToggle\?\.addEventListener\('mousedown', preservePageEditorSelectionForSidebarToggle\);/);
  assert.match(bootstrap, /rightSidebarToggle\?\.addEventListener\('mousedown', preservePageEditorSelectionForSidebarToggle\);/);
  assert.match(bootstrap, /leftSidebarToggle\?\.addEventListener\('pointerdown', preservePageEditorSelectionForSidebarToggle\);/);
  assert.match(bootstrap, /rightSidebarToggle\?\.addEventListener\('pointerdown', preservePageEditorSelectionForSidebarToggle\);/);
  assert.match(bootstrap, /leftSidebarToggle\?\.addEventListener\('click', toggleLeftSidebar\);/);
  assert.match(bootstrap, /rightSidebarToggle\?\.addEventListener\('click', toggleRightSidebar\);/);
  assert.doesNotMatch(bootstrap, /sidebarToggleEditorSnapshot/);
});

test('reduced motion resolves the scoped Sidebar duration directly to zero', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--sidebar-motion-duration: 0ms;/);
});
