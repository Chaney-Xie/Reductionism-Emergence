const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} source is available`);
  return source.slice(start, end);
}

test('Tab-strip empty pixels retain native drag ownership while interactive pixels are no-drag', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.top-tab-area \{[^}]*-webkit-app-region: drag;/);
  assert.match(css, /\.workspace-pane-tab-collection \{[^}]*-webkit-app-region: drag;/);
  assert.match(css, /\.workspace-pane-tab-region \{[^}]*-webkit-app-region: drag;/);
  assert.match(css, /\.viewer-tab-strip \{[\s\S]*?-webkit-app-region: drag;/);
  assert.match(css, /\.viewer-tab-list \{[\s\S]*?-webkit-app-region: drag;/);
  assert.match(css, /\.viewer-tab \{[^}]*-webkit-app-region: no-drag;/);
  assert.match(css, /\.viewer-tab-title,[\s\S]*?\.viewer-tab-close,[\s\S]*?\.viewer-tab-add,[\s\S]*?\.viewer-tab-menu \{[^}]*-webkit-app-region: no-drag;/);
  assert.match(css, /\.tab-page-preview \{[^}]*pointer-events: none;[^}]*-webkit-app-region: no-drag;/);
  assert.match(css, /\.workspace-pane-edge-drop-indicator \{[^}]*pointer-events: none;[^}]*-webkit-app-region: no-drag;/);
});

test('only real Tabs initiate reorder; the full-width list remains the empty native drag surface', async () => {
  const app = await read('public/app.js');
  const renderPaneTabStrip = functionSource(app, 'renderPaneTabStrip', 'renderTabStrip');
  assert.match(renderPaneTabStrip, /list\.className = 'viewer-tab-list'/);
  assert.match(renderPaneTabStrip, /list\.append\(plus\)/);
  assert.doesNotMatch(renderPaneTabStrip, /list\.addEventListener\(['"]pointerdown/);
  const createTabElement = functionSource(app, 'createTabElement', 'ensurePaneTabCollection');
  assert.match(createTabElement, /element\.addEventListener\('pointerdown',[\s\S]*?handleTabReorderPointerDown\(event, element\)/);
  assert.match(createTabElement, /close\.addEventListener\('pointerdown',[\s\S]*?event\.stopPropagation\(\)/);
});

test('desktop bridge does not bypass native tab-strip drag ownership', async () => {
  const preload = await read('desktop/preload.js');
  assert.doesNotMatch(preload, /setWindowPosition|moveWindowBy|beginWindowDrag|startWindowDrag/);
});
