const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const bootstrapSource = fs.readFileSync(
  path.join(root, 'public', 'js', 'appBootstrap.js'),
  'utf8'
);
const stylesSource = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('Pane Stack uses the symmetric workspace model and live width observer', () => {
  assert.match(bootstrapSource, /initializeWorkspacePaneModel\(\);\s*initializeWorkspacePaneStackLayout\(\);/);
  assert.match(appSource, /new ResizeObserver\(\(\) =>/);
  const observerStart = appSource.indexOf('function initializeWorkspacePaneStackLayout');
  const observerEnd = appSource.indexOf('function ensureWorkspacePaneChromeLayer', observerStart);
  const observerSource = appSource.slice(observerStart, observerEnd);
  assert.match(observerSource, /new ResizeObserver\(\(\) => \{[\s\S]*?fitWorkspacePanesToAvailableWidth\(\);/);
  assert.doesNotMatch(observerSource, /requestAnimationFrame|workspacePaneLayoutFrame/);
  assert.match(appSource, /workspace\.fitToWidth\(availableWidth\)/);
  assert.match(appSource, /const structureChanged = beforeStructure !== workspacePaneStructureSignature\(\);[\s\S]*?if \(structureChanged\) renderWorkspacePaneStackState\(\);[\s\S]*?else \{[\s\S]*?applyWorkspacePaneGeometry\(\);/);
  assert.match(appSource, /const orderChanged = mountedElements\.length !== orderedElements\.length[\s\S]*?mountedElements\[index\] !== element[\s\S]*?if \(orderChanged\) workspacePaneRoot\.replaceChildren\(\.\.\.orderedElements\);/);
  assert.match(appSource, /pane\.element\.style\.flex = `0 0 \$\{width\}`/);
  assert.doesNotMatch(appSource, /workspace-pane-split/);
  assert.doesNotMatch(stylesSource, /workspace-pane-split/);
  assert.match(appSource, /function workspacePaneAvailableWidth\(\) \{[\s\S]*?const width = workspacePaneRoot\?\.getBoundingClientRect\(\)\.width;/);
  assert.doesNotMatch(appSource, /function workspacePaneAvailableWidth\(\) \{[\s\S]*?const width = workspacePaneRoot\?\.clientWidth;/);
  assert.doesNotMatch(appSource, /syncWorkspacePaneChromeInsets|--workspace-pane-left-inset|--workspace-pane-right-inset/);
  assert.doesNotMatch(stylesSource, /--workspace-pane-left-inset|--workspace-pane-right-inset/);
  assert.doesNotMatch(stylesSource, /\.page-area \{[^}]*padding-(?:left|right): var\(--workspace-pane/);
  assert.doesNotMatch(stylesSource, /\.pane-toolbar-area \{[^}]*padding-(?:left|right): var\(--workspace-pane/);
});

test('collapsed Panes replace Tab and Canvas chrome with one vertical spine', () => {
  assert.match(appSource, /if \(pane\.mode === 'collapsed'\) \{\s*region\.replaceChildren\(\);/);
  assert.match(appSource, /className = 'workspace-pane-collapsed-spine'/);
  assert.match(appSource, /top: tabAreaRect\.bottom/);
  assert.match(appSource, /--collapsed-pane-title-offset[\s\S]*?toolbarRect\.top - regionRect\.top/);
  assert.match(appSource, /top: regionRect\.top,[\s\S]*height: rootRect\.bottom - regionRect\.top/);
  assert.match(stylesSource, /\.workspace-pane-collapsed-title[\s\S]*writing-mode: vertical-rl/);
  assert.match(stylesSource, /\.workspace-pane-collapsed-spine[\s\S]*pointer-events: auto/);
  assert.match(stylesSource, /\.workspace-pane\.is-workspace-pane-collapsed > \.canvas-area \{\s*display: none/);
  assert.doesNotMatch(stylesSource, /\.workspace-pane-tab-region\.is-workspace-pane-collapsed::after/);
  assert.match(stylesSource, /\.workspace-pane-tab-region\.is-pane-reorder-source::after/);
  assert.match(stylesSource, /\.workspace-pane-reorder-slot-placeholder/);
  assert.match(stylesSource, /\.workspace-pane-collapsed-spine[\s\S]*background: var\(--surface-tool\)/);
});

test('divider drag delegates width policy to the shared Pane model', () => {
  assert.match(appSource, /workspace\.resizeAtDivider\(state\.dividerIndex, delta, \{\s*overdragState: state\.overdragState/);
  assert.match(appSource, /const pointerDelta = state\.lastClientX - state\.startClientX;/);
  assert.match(appSource, /const delta = pointerDelta - state\.appliedPointerDelta;/);
  assert.match(appSource, /appliedPointerDelta: 0/);
  assert.match(appSource, /collapseOverdrag: 0/);
  assert.match(appSource, /expansionOverdrag: 0/);
  assert.match(appSource, /originalLayout: workspace\.captureLayout\(\)/);
  assert.match(appSource, /if \(cancel\) workspace\.restoreLayout\(state\.originalLayout\)/);
  assert.match(appSource, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(appSource, /window\.addEventListener\('pointermove',[\s\S]*?capture: true,[\s\S]*?passive: false/);
  assert.match(appSource, /window\.addEventListener\('pointerup', handlePaneDividerPointerUp, true\)/);
  assert.match(appSource, /event\.pointerId !== paneDividerDragState\.pointerId/);
  assert.doesNotMatch(stylesSource, /\.workspace-pane-divider::before|\.workspace-pane-divider::after/);
});

test('divider drag keeps Tab nodes and their left-clipped title presentation stable', () => {
  assert.match(appSource, /preserveTabLeftAnchor: true,[\s\S]*?preserveTabTitlePresentation: true/);
  assert.match(appSource, /if \(!preserveTitlePresentation\) applyTabTitlePresentation\(element, title\)/);
  assert.match(appSource, /if \(!preserveLeftAnchor && \(ensureActiveVisible \|\| sizing\.scrolling\)\)/);
  assert.match(appSource, /const paneResizeActive = Boolean\(paneDividerDragState\);[\s\S]*?preserveLeftAnchor: paneResizeActive,[\s\S]*?preserveTitlePresentation: paneResizeActive/);
  assert.match(stylesSource, /body\.is-pane-divider-resizing \.viewer-tab-list \{\s*overflow-x: hidden;/);
  assert.match(stylesSource, /body\.is-pane-divider-resizing \.viewer-tab-title,[\s\S]*?body\.is-pane-divider-resizing \.viewer-tab\[data-title-compact='true'\] \.viewer-tab-title \{\s*text-align: left;/);
  assert.match(stylesSource, /\.viewer-tab-title \{[^}]*overflow: hidden;[^}]*text-align: left;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
});

test('every Pane owns its toolbar while global sidebar toggles stay outside Pane chrome', () => {
  assert.match(appSource, /back\.dataset\.paneRole = 'history-back'/);
  assert.match(appSource, /forward\.dataset\.paneRole = 'history-forward'/);
  assert.match(appSource, /titleDisplay\.dataset\.paneRole = 'page-title'/);
  assert.match(appSource, /edit\.dataset\.paneRole = 'edit'/);
  assert.match(appSource, /highlight\.dataset\.paneRole = 'highlight'/);
  assert.match(bootstrapSource, /function bindPaneToolbarInteractions\(pane\)/);
  assert.match(stylesSource, /\.pane-toolbar-area[\s\S]*grid-column: 2/);
  assert.match(stylesSource, /\.right-top-toolbar[\s\S]*grid-column: 3/);
  assert.match(stylesSource, /\.workspace-top-row[\s\S]*grid-column: 2/);
});

test('final-Tab close removes only a non-final Pane and Pane Edit menus escape toolbar clipping', () => {
  assert.match(appSource, /runtime\.session\.tabs\(\)\.length === 1 && workspace\.state\.panes\.length > 1/);
  assert.match(appSource, /workspace\.removePane\(pane\.id\)/);
  assert.match(appSource, /workspace\.fitToWidth\(availableWidth\)/);
  assert.match(appSource, /workspace\.expandPane\(paneId, availableWidth\)[\s\S]*?workspace\.fitToWidth\(availableWidth\)/);
  assert.match(appSource, /function setEditMenuOpen\(runtime, active\)[\s\S]*?runtime\.dom\.editBlockButton\.getBoundingClientRect\(\)/);
  assert.match(stylesSource, /\.edit-menu \{[\s\S]*?position: fixed/);
});

test('Pane and Page drag payloads remain explicitly distinct', () => {
  const collapsedPayloads = appSource.match(/sourceType: 'collapsed-pane'/g) || [];
  const pagePayloads = appSource.match(/sourceType: 'tab-page'/g) || [];
  assert.ok(collapsedPayloads.length >= 2);
  assert.ok(pagePayloads.length >= 2);
  const paneReorderStart = appSource.indexOf('function beginCollapsedPaneReorder');
  const paneReorderEnd = appSource.indexOf('function updateCollapsedPaneReorderVisual');
  const paneReorderSource = appSource.slice(paneReorderStart, paneReorderEnd);
  assert.doesNotMatch(paneReorderSource, /sharedPagePreview|renderTabPagePreview/);
  assert.match(paneReorderSource, /workspace-pane-reorder-preview/);
});
