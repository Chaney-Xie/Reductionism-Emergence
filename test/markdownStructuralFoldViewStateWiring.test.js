const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Markdown folding receives a cloned Pane/Tab-local view-state snapshot', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const renderStart = canvas.indexOf('renderMarkdownPageLayer({');
  const renderEnd = canvas.indexOf('const markdownBounds = getMarkdownDocumentBounds', renderStart);
  const renderOptions = canvas.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderOptions, /paneId: runtime\.paneId,/);
  assert.match(renderOptions, /tabId: ownerTab\?\.id,/);
  assert.match(
    renderOptions,
    /markdownStructuralFolds: Array\.isArray\(ownerTab\?\.viewState\?\.markdownStructuralFolds\)[^]*?ownerTab\.viewState\.markdownStructuralFolds\.map\(\(fold\) => \(\{ \.\.\.fold \}\)\)[^]*?: \[\],/
  );
});

test('fold changes persist only to the captured Pane/Tab Page owner and schedule workspace saving', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const callbackStart = canvas.indexOf('onFoldStateChange: (detail) => {');
  const callbackEnd = canvas.indexOf('onDocumentExtentChange:', callbackStart);
  const callback = canvas.slice(callbackStart, callbackEnd);

  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  assert.match(callback, /runtimeOperationIsCurrent\(renderOperation\)/);
  assert.match(callback, /runtime\.session\?\.tabById\?\.\(ownerTab\?\.id\)/);
  assert.match(callback, /if \(!liveTab \|\| liveTab\.currentPageId !== page\.id\) return;/);
  assert.match(callback, /detail\.folds\.map\(\(fold\) => \(\{ \.\.\.fold \}\)\)/);
  assert.match(
    callback,
    /runtime\.session\.saveViewState\(liveTab\.id, \{[^]*?\.\.\.liveTab\.viewState,[^]*?markdownStructuralFolds: folds[^]*?\}\);/
  );
  assert.match(
    callback,
    /if \(typeof scheduleWorkspaceStateSave === 'function'\) scheduleWorkspaceStateSave\(\);/
  );
  assert.doesNotMatch(callback, /\bactiveTab\s*\(/);
});

test('active-tab view-state capture retains folding descriptors without sharing them', async () => {
  const app = await read('public/app.js');
  const captureStart = app.indexOf('function captureActiveTabViewState(runtime)');
  const captureEnd = app.indexOf('function saveActiveTabViewState(runtime', captureStart);
  const capture = app.slice(captureStart, captureEnd);

  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  assert.match(
    capture,
    /markdownStructuralFolds: Array\.isArray\(tab\.viewState\.markdownStructuralFolds\)[^]*?tab\.viewState\.markdownStructuralFolds\.map\(\(fold\) => \(\{ \.\.\.fold \}\)\)[^]*?: \[\],/
  );
});
