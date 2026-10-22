const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('empty New Tab exposes only the three centred canonical actions', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css')
  ]);
  const state = html.match(/<div id="empty-tab-state"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(state, />Create New Page<\/button>[\s\S]*?>Go to Page<\/button>[\s\S]*?>Close<\/button>/);
  assert.doesNotMatch(state, /recent|illustration|onboarding/i);
  assert.match(css, /\.empty-tab-state \{[^}]*position: absolute[^}]*inset: 0[^}]*display: grid[^}]*place-items: center/);
  assert.match(css, /\.empty-tab-actions \{[^}]*display: grid[^}]*width: max-content[^}]*justify-items: center/);
  assert.match(state, /id="empty-tab-create-page" class="empty-tab-action ui-solid-action"/);
  assert.match(state, /id="empty-tab-go-to-page" class="empty-tab-action ui-outline-action"/);
  assert.match(state, /id="empty-tab-close" class="empty-tab-action ui-outline-action"/);
  assert.match(css, /\.empty-tab-action \{[^}]*-webkit-app-region: no-drag/);
  assert.doesNotMatch(css, /\.empty-tab-action \{[^}]*(?:border|background|font-size|padding):/);
});

test('Go to Page is only a Search-focus convenience and changes no filter state', async () => {
  const app = await read('public/app.js');
  const focusSearch = app.match(/function focusEmptyTabPageSearch\(runtime\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(focusSearch, /tab\.currentPageId !== null/);
  assert.match(focusSearch, /setLeftSidebarOpen\(true\)/);
  assert.match(focusSearch, /descriptorSearchOpen = true/);
  assert.match(focusSearch, /renderDescriptorSearchPanel\(\{ focus: true \}\)/);
  assert.doesNotMatch(focusSearch, /mode:|ownerTabId|descriptorSearchText\s*=|selectedCategoryFilterIds\.(?:clear|add|delete)|collapsed\s*=/);
  assert.doesNotMatch(app, /emptyTabPagePickMode|empty-tab-page-pick-mode/);
});

test('ordinary sidebar clicks reuse an existing Tab, otherwise fill or push in the active Tab', async () => {
  const [app, navigation] = await Promise.all([
    read('public/app.js'),
    read('public/js/navigation.js')
  ]);
  const populate = app.match(/async function populateActiveEmptyTab\(runtime, pageId\) \{[\s\S]*?\n\}/)?.[0] || '';
  const sidebar = app.match(/function openPageFromSidebar\(pageId\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(populate, /tab\.currentPageId !== null/);
  assert.match(populate, /navigateCurrentTabToPage\(runtime, pageId, \{/);
  assert.match(populate, /preferCanonical: true/);
  assert.match(populate, /saveCurrentView: false/);
  assert.doesNotMatch(populate, /historyMode:|loadPage\(/);
  assert.match(sidebar, /if \(!runtime \|\| runtime\.linkPickMode\) return false;[\s\S]*?if \(!active\)[\s\S]*?runtime\.session\.createTab\(null\)/);
  assert.match(sidebar, /workspaceTabForPage\(pageId\)[\s\S]*?activateWorkspaceTab\(existing\)/);
  assert.ok(
    sidebar.indexOf('workspaceTabForPage(pageId)')
      < sidebar.indexOf('active?.currentPageId === null')
  );
  assert.match(sidebar, /active\?\.currentPageId === null[\s\S]*?populateActiveEmptyTab\(runtime, pageId\)/);
  assert.match(sidebar, /navigateCurrentTabToPage\(runtime, pageId, \{/);
  assert.doesNotMatch(sidebar, /historyMode:|loadPage\(|openPageInNewTab/);
  assert.match(navigation, /if \(runtime\?\.linkPickMode\)[\s\S]*?selectLinkTargetPage\(runtime, page\)[\s\S]*?openPageFromSidebar\(page\.id\)/);
});

test('empty-state Create and Close reuse the existing application workflows', async () => {
  const [app, bootstrap] = await Promise.all([
    read('public/app.js'),
    read('public/js/appBootstrap.js')
  ]);
  assert.match(bootstrap, /function bindWorkspacePaneInteractions[\s\S]*?emptyTabCreatePageButton: create[\s\S]*?create\?\.addEventListener\('click'[\s\S]*?createNewPage\(\{ runtime \}\)/);
  assert.match(bootstrap, /emptyTabGoToPageButton: go[\s\S]*?go\?\.addEventListener\('click'[\s\S]*?focusEmptyTabPageSearch\(runtime\)/);
  assert.match(bootstrap, /emptyTabCloseButton: close[\s\S]*?close\?\.addEventListener\('click'[\s\S]*?closeTab\(tab\.id, runtime\.paneId\)/);
  assert.match(app, /const historyMode = activeTab\(runtime\)\?\.currentPageId \? 'preserve' : 'replace'/);
  assert.match(app, /if \(activeTab\(runtime\)\?\.currentPageId\) \{[\s\S]*?animateTabStripLayoutChange\(\(\) => runtime\.session\.createTab\(created\.page\.id\)\)/);
  assert.match(app, /showEmptyTabActions = activeTab\(runtime\)\?\.currentPageId === null/);
});
