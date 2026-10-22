const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pageTypesModel = require('../public/pageTypes');
const markdownPageModel = require('../public/markdownPage');
const hnTextModel = require('../public/hnText');

test('app preference application invalidates navigation only when the Vault default changes', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const applySource = appSource.slice(
    appSource.indexOf('function applyVaultMarkdownPreferences'),
    appSource.indexOf('function queueVaultMarkdownPreferenceIntent')
  );
  assert.match(applySource, /^function applyVaultMarkdownPreferences/);

  const context = vm.createContext({
    pageTypesModel,
    markdownPageModel,
    hnTextModel,
    vaultPreferences: {
      defaultPageType: pageTypesModel.PAGE_TYPES.CANVAS,
      lastMarkdownMode: markdownPageModel.MARKDOWN_MODES.LIVE_PREVIEW
    },
    pageIndex: { pages: [] },
    renderCount: 0,
    markdownRefreshCount: 0,
    stripRefreshCount: 0,
    hnStripRefreshCount: 0,
    renderPageList: () => { context.renderCount += 1; },
    refreshAllMarkdownPaneViews: () => { context.markdownRefreshCount += 1; },
    refreshAllHnTextPaneViews: () => {},
    activePaneRuntime: () => ({ id: 'active-runtime' }),
    refreshMarkdownControlStrip: () => { context.stripRefreshCount += 1; },
    refreshHnTextControlStrip: () => { context.hnStripRefreshCount += 1; }
  });
  vm.runInContext(`${applySource}\nglobalThis.applyPreferences = applyVaultMarkdownPreferences;`, context);

  context.applyPreferences({
    defaultPageType: pageTypesModel.PAGE_TYPES.CANVAS,
    lastMarkdownMode: markdownPageModel.MARKDOWN_MODES.SOURCE
  });
  assert.equal(context.renderCount, 0);
  assert.equal(context.markdownRefreshCount, 1);

  context.applyPreferences({
    defaultPageType: pageTypesModel.PAGE_TYPES.HN_TEXT,
    lastMarkdownMode: markdownPageModel.MARKDOWN_MODES.SOURCE
  }, { rerender: false });
  assert.equal(context.renderCount, 1);
  assert.equal(context.stripRefreshCount, 1);
  assert.equal(context.hnStripRefreshCount, 1);
  assert.equal(context.vaultPreferences.defaultPageType, pageTypesModel.PAGE_TYPES.HN_TEXT);

  context.applyPreferences({
    defaultPageType: pageTypesModel.PAGE_TYPES.HN_TEXT,
    lastMarkdownMode: markdownPageModel.MARKDOWN_MODES.READING
  });
  assert.equal(context.renderCount, 1);
  assert.equal(context.markdownRefreshCount, 2);

  context.pageIndex = null;
  context.applyPreferences({
    defaultPageType: pageTypesModel.PAGE_TYPES.MARKDOWN,
    lastMarkdownMode: markdownPageModel.MARKDOWN_MODES.READING
  });
  assert.equal(context.renderCount, 1);
  assert.equal(context.vaultPreferences.defaultPageType, pageTypesModel.PAGE_TYPES.MARKDOWN);
});
