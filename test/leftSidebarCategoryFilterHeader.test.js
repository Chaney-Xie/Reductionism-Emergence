const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
const sharedControls = fs.readFileSync(path.join(__dirname, '../public/sharedControls.css'), 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('Category Filter uses the compact Clear label without changing its clear-all action', () => {
  const panelStart = appSource.indexOf('function renderFilterPanel()');
  const panelEnd = appSource.indexOf('\nfunction ', panelStart + 1);
  const panelSource = appSource.slice(panelStart, panelEnd < 0 ? undefined : panelEnd);

  assert.match(panelSource, /title\.textContent = 'Category Filter';/);
  assert.match(panelSource, /clearButton\.textContent = 'Clear';/);
  assert.doesNotMatch(panelSource, /Clear all/);
  assert.match(
    panelSource,
    /clearButton\.addEventListener\('click', \(\) => \{\s*selectedCategoryFilterIds\.clear\(\);\s*renderFilterPanel\(\);\s*renderPageList\(\);\s*scheduleWorkspaceStateSave\(\);\s*\}\);/
  );
});

test('Category Filter header remains a full, non-truncated single row at minimum width', () => {
  const header = rule('.filter-panel-header');
  const title = rule('.filter-panel-header h3');
  const clear = rule('.filter-clear-button');

  assert.match(header, /display:\s*flex;/);
  assert.match(header, /align-items:\s*center;/);
  assert.match(header, /justify-content:\s*space-between;/);
  assert.match(header, /gap:\s*0\.5rem;/);
  assert.match(header, /min-width:\s*0;/);

  assert.match(title, /flex:\s*1 1 auto;/);
  assert.match(title, /min-width:\s*0;/);
  assert.match(title, /font-size:\s*0\.85rem;/);
  assert.match(title, /white-space:\s*nowrap;/);
  assert.doesNotMatch(title, /text-overflow|ellipsis|overflow:\s*hidden/);

  assert.match(clear, /flex:\s*0 0 auto;/);
  assert.match(clear, /width:\s*auto;/);
  assert.match(appSource, /clearButton\.className = 'filter-clear-button ui-outline-action'/);
  assert.match(sharedControls, /:not\(\.filter-clear-button\):is\(/);
  assert.doesNotMatch(sharedControls, /(?<!:not\()\.filter-clear-button[\s\S]*?min-width: var\(--ui-action-min-width\)/);
});

test('Category Filter compactness keeps sidebar minimum and card geometry frozen', () => {
  const panel = rule('.filter-panel');
  const clear = rule('.filter-clear-button');

  assert.match(styles, /--sidebar-default-width:\s*220px;/);
  assert.match(panel, /margin:\s*0 0 0\.9rem;/);
  assert.match(panel, /padding:\s*0\.75rem;/);
  assert.match(panel, /border:\s*1px solid var\(--sidebar-control-border\);/);
  assert.match(panel, /border-radius:\s*8px;/);
  assert.match(clear, /padding:\s*0\.25rem 0\.45rem;/);
  assert.match(clear, /border:\s*1px solid var\(--sidebar-control-border\);/);
  assert.match(clear, /border-radius:\s*5px;/);
  assert.match(clear, /color:\s*var\(--sidebar-control-muted\);/);
  assert.match(clear, /background:\s*var\(--sidebar-control-surface\);/);
  assert.match(clear, /cursor:\s*pointer;/);
  assert.match(clear, /font-size:\s*0\.78rem;/);
  assert.doesNotMatch(clear, /min-width|height:/);
  const disabled = rule('.filter-clear-button:disabled');
  assert.match(disabled, /cursor:\s*default;/);
  assert.match(disabled, /opacity:\s*0\.5;/);
  assert.match(sharedControls, /--ui-action-padding-inline: 0\.75rem/);
  assert.match(sharedControls, /--ui-action-radius: 6px/);
  assert.match(sharedControls, /--ui-action-font-size: 0\.82rem/);
});

test('Category Filter empty state shares the title left edge without changing global empty rows', () => {
  const globalEmpty = rule('.nav-folder-empty');
  const filterEmpty = rule('#filter-panel > .nav-folder-empty');
  const nestedEmpty = rule('.nav-folder-pages > .nav-folder-empty');
  const rootEmpty = rule('.nav-empty-state');

  assert.match(globalEmpty, /padding:\s*0\.4rem 0\.55rem;/);
  assert.match(filterEmpty, /padding-inline:\s*0;/);
  assert.match(nestedEmpty, /padding-left:\s*var\(--nav-page-text-start\);/);
  assert.match(rootEmpty, /padding:\s*0\.55rem 0\.7rem 0\.55rem var\(--nav-page-text-start\);/);
});
