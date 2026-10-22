const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('main window hides the native macOS title surface while preserving inset traffic lights', async () => {
  const main = await read('desktop/main.js');
  assert.match(main, /process\.platform === 'darwin'[\s\S]*?titleBarStyle: 'hiddenInset'/);
  assert.match(main, /trafficLightPosition: \{ x: 12, y: 10 \}/);
});

test('application chrome has the accepted two rows and keeps all three main panels below them', async () => {
  const html = await read('public/index.html');
  const rowOne = html.match(/<div class="app-topbar app-chrome-row-one">[\s\S]*?<\/div>\s*<div class="app-chrome-row-two">/)?.[0] || '';
  const rowTwo = html.match(/<div class="app-chrome-row-two">[\s\S]*?<div class="right-chrome-spacer"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(rowOne, /id="search-button"/);
  assert.match(rowOne, /id="filter-button"/);
  assert.match(rowOne, /id="left-sidebar-toggle"/);
  assert.match(rowOne, /id="top-tab-area" class="top-tab-area" aria-label="Page tabs"><\/div>/);
  assert.match(rowOne, /id="right-sidebar-toggle"/);
  assert.match(rowOne, /class="left-top-toolbar"[\s\S]*?id="search-button"[\s\S]*?id="filter-button"[\s\S]*?class="workspace-top-row"[\s\S]*?id="left-sidebar-toggle"[\s\S]*?id="top-tab-area"[\s\S]*?id="right-sidebar-toggle"/);
  const leftToolbar = rowOne.match(/<div class="left-top-toolbar"[\s\S]*?<\/div>/)?.[0] || '';
  const rightToolbar = rowOne.match(/<div class="right-top-toolbar"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(leftToolbar, /search-button[\s\S]*filter-button/);
  assert.doesNotMatch(leftToolbar, /sidebar-toggle/);
  assert.doesNotMatch(rightToolbar, /sidebar-toggle/);
  assert.doesNotMatch(rowOne, /id="new-page-button"|id="navigation-sort-button"/);
  assert.match(rowTwo, /id="new-page-button"[\s\S]*?id="new-folder-button"[\s\S]*?id="navigation-sort-button"/);
  assert.match(rowTwo, /id="pane-toolbar-area" class="pane-toolbar-area"/);
  assert.doesNotMatch(html, /id="project-name"|id="project-version"/);

  const chromeEnd = html.indexOf('</header>');
  const layoutStart = html.indexOf('<main class="layout">');
  const leftStart = html.indexOf('<aside class="sidebar left-sidebar">');
  const canvasStart = html.indexOf('<section class="page-area">');
  const rightStart = html.indexOf('<aside id="right-sidebar"');
  assert.ok(chromeEnd < layoutStart && layoutStart < leftStart && leftStart < canvasStart && canvasStart < rightStart);
  const pageArea = html.slice(canvasStart, rightStart);
  assert.doesNotMatch(pageArea, /class="pane-page-toolbar"/);
  assert.match(pageArea, /id="canvas-area"/);
});

test('top chrome row heights and main-layout offset use one shared structure', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /--topbar-height: 43px;/);
  assert.match(css, /--chrome-row-one-height: 36px;/);
  assert.match(css, /--top-chrome-height: calc\(var\(--chrome-row-one-height\) \+ var\(--topbar-height\)\);/);
  assert.match(css, /\.layout \{[^}]*height: calc\(100vh - var\(--top-chrome-height\)\);[^}]*min-height: calc\(100vh - var\(--top-chrome-height\)\);/);
  assert.match(css, /\.left-top-toolbar \{[^}]*padding: 0\.15rem 0\.55rem 0\.15rem 4\.75rem;/);
  assert.match(css, /\.app-topbar \{[^}]*-webkit-app-region: drag;/);
  assert.match(css, /--persistent-left-header-width: calc\(4\.75rem \+ 4rem \+ 0\.55rem\);/);
  assert.match(css, /\.app-topbar \{[^}]*grid-template-columns: var\(--active-left-header-width\) minmax\(0, 1fr\) var\(--active-right-sidebar-width\);/);
  assert.match(css, /\.workspace-top-row \{[^}]*grid-column: 2;[^}]*overflow: hidden;[^}]*-webkit-app-region: drag;/);
  assert.match(css, /body\.left-sidebar-collapsed \{[^}]*--active-left-header-width: var\(--persistent-left-header-width\);/);
  assert.match(css, /body\.left-sidebar-collapsed \.left-top-toolbar \{[^}]*border-right-color: transparent;/);
  assert.match(css, /\.workspace-sidebar-toggle-cell \{[^}]*flex: 0 0 36px;[^}]*box-shadow: inset 0 -1px 0 var\(--border-tool\);[^}]*-webkit-app-region: drag;/);
  assert.match(css, /\.workspace-sidebar-toggle-cell > \.workspace-sidebar-toggle \{[^}]*width: 30px;[^}]*height: 30px;[^}]*border-radius: 5px;[^}]*background: transparent;[^}]*-webkit-app-region: no-drag;/);
  assert.match(css, /\.top-icon-button,[\s\S]*?-webkit-app-region: no-drag;/);
  assert.match(css, /\.left-top-toolbar \{[^}]*border-right: 1px solid var\(--border-tool\);/);
  assert.match(css, /\.app-topbar::after \{[^}]*left: calc\(100% - var\(--active-right-sidebar-width\)\);[^}]*width: min\(1px, var\(--active-right-sidebar-width\)\);[^}]*background: var\(--border-tool\);/);
  assert.match(css, /\.app-topbar::before \{[^}]*right: 0;[^}]*bottom: 0;[^}]*width: var\(--active-right-sidebar-width\);[^}]*height: 1px;[^}]*background: var\(--border-tool\);/);
  assert.doesNotMatch(css, /--active-left-top-toolbar-width|--active-right-top-toolbar-width|workspace-top-left-controls/);
  assert.match(css, /body\.right-sidebar-collapsed \.app-topbar::after \{[^}]*opacity: 0;/);
});

test('second chrome row mirrors Guide side regions around the Canvas-coloured title toolbar', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.app-chrome-row-two \{[^}]*grid-template-columns: var\(--active-left-sidebar-width\) minmax\(0, 1fr\) var\(--active-right-sidebar-width\);/);
  assert.match(css, /\.left-create-toolbar \{[^}]*justify-content: center;[^}]*width: 100%;[^}]*box-shadow: inset -1px 0 0 var\(--border-tool\);/);
  assert.match(css, /\.right-chrome-spacer \{[^}]*width: 100%;[^}]*box-shadow: inset 1px 0 0 var\(--border-tool\);/);
  assert.match(css, /body\.left-sidebar-collapsed \.left-create-toolbar,[\s\S]*?body\.right-sidebar-collapsed \.right-chrome-spacer,[\s\S]*?body\.right-sidebar-collapsed \.sidebar-resize-handle-right \{[^}]*visibility: hidden;/);
  assert.match(css, /\.pane-page-toolbar \{[^}]*border-bottom: 0;[^}]*background: var\(--surface-canvas\);/);
  assert.match(css, /\.app-topbar \{[^}]*border-bottom: 0;/);
  assert.match(css, /\.left-top-toolbar \{[^}]*border-bottom: 1px solid var\(--border-tool\);/);
  assert.match(css, /\.viewer-tab-strip \{[\s\S]*?background-image: linear-gradient\([\s\S]*?var\(--border-tool\) calc\(100% - 1px\)/);
  assert.match(css, /\.left-create-toolbar::after \{[^}]*right: 1\.25rem;[^}]*left: 1\.25rem;[^}]*background: var\(--border-guide\);/);
  assert.match(css, /\.pane-page-toolbar::after \{[^}]*right: 0;[^}]*left: 0;[^}]*background: var\(--border-canvas\);/);
  assert.match(css, /\.right-chrome-spacer::after \{[^}]*right: 0;[^}]*left: 0;[^}]*background: var\(--border-guide\);/);
  assert.doesNotMatch(css, /\.app-chrome-row-two::after/);
});
