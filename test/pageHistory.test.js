const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Viewer uses one explicit-mode Page-opening lifecycle for toolbar and creation', async () => {
  const [html, app, bootstrap] = await Promise.all([
    read('public/index.html'), read('public/app.js'), read('public/js/appBootstrap.js')
  ]);
  assert.match(app, /back\.dataset\.paneRole = 'history-back'[\s\S]*?back\.disabled = true/);
  assert.match(app, /forward\.dataset\.paneRole = 'history-forward'[\s\S]*?forward\.disabled = true/);
  assert.doesNotMatch(html, /pageHistory\.js/);
  assert.match(html, /sessionTabs\.js\?v=pane-transfer-v01/);
  assert.match(app, /async function loadPage\(runtime, pageEntry, \{[\s\S]*?historyMode = null[\s\S]*?historyIndex = null[\s\S]*?requirePageHistoryMode\(historyMode\)/);
  assert.match(app, /completePageOpen\(runtime, pageEntry, page, \{ historyMode, historyIndex \}\)/);
  assert.match(app, /runtime\.session\.navigateActive\(pageId, \{ mode: historyMode, historyIndex \}\)/);
  assert.match(app, /activeTab\(runtime\)\?\.currentPageId === pageEntry\.id[\s\S]*?return true/);
  assert.match(app, /async function navigateCurrentTabToPage\(runtime, targetPageId, navigationContext = \{\}\)[\s\S]*?navigationKind === 'history-traversal'[\s\S]*?\{ historyMode: 'back-forward', historyIndex \}[\s\S]*?\{ historyMode: 'push', historyIndex: null \}[\s\S]*?loadPage\(runtime, targetPageEntry, \{[\s\S]*?resolvedPage\?\.id === targetPageId \? \{ resolvedPage \} : \{\}/);
  assert.match(app, /async function loadPage\(runtime, pageEntry, \{[\s\S]*?resolvedPage = null[\s\S]*?saveActiveTabViewState\(runtime\)[\s\S]*?runtime\.pageLoadSequence \+= 1[\s\S]*?resolvedPage\?\.id === pageEntry\.id/);
  assert.match(app, /navigateCurrentTabToPage\(runtime, created\.page\.id, \{[\s\S]*?resolvedPageEntry: created\.pageEntry,[\s\S]*?resolvedPage: created\.page/);
  assert.match(app, /runtime\.session\.createTab\(created\.page\.id\)/);
  assert.match(bootstrap, /historyMode: 'replace'[\s\S]*?saveCurrentView: false/);
  assert.match(bootstrap, /dom\.pageHistoryBackButton\?\.addEventListener\('click',[\s\S]*?navigatePageHistory\(runtime, -1\)/);
  assert.match(bootstrap, /dom\.pageHistoryForwardButton\?\.addEventListener\('click',[\s\S]*?navigatePageHistory\(runtime, 1\)/);
});

test('Page history shortcuts ignore repeats, editors, edit modes, and strong modal workflows', async () => {
  const app = await read('public/app.js');
  assert.match(app, /event\.repeat \|\| event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(app, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(app, /event\.metaKey[\s\S]*?event\.key === '\[' \|\| event\.key === '\]'/);
  assert.match(app, /event\.altKey[\s\S]*?event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(app, /input, textarea, select, \[contenteditable\]/);
  assert.match(app, /shortcut\.plain && \(runtime\.blockEditMode \|\| runtime\.pageEditMode[\s\S]*?runtime\.highlightEditDraft\)/);
  assert.match(app, /function pageHistoryNavigationBlocked\(runtime\)[\s\S]*?vaultSettingsOpen[\s\S]*?runtime\?\.linkPickMode[\s\S]*?navigationMoveMode/);
  assert.match(app, /navigatePageHistory\(runtime, direction\)[\s\S]*?pageHistoryNavigationBlocked\(runtime\)/);
  assert.match(app, /if \(!pageHistoryTarget\(runtime, shortcut\.direction\)\) return false;[\s\S]*?event\.preventDefault\(\)/);
});
