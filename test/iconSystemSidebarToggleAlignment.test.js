const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const sidebarToggleAssets = new Map([
  ['sidebar-collapsed-right.svg', 'f3e91a68e44b5048723613d722abd1c9ee12dad87f7fc83988779d849ad7593f'],
  ['sidebar-collapsed-left.svg', '885ada47e0e5a53f6fc4e2ee4136a40228febe54af1377ca83d3234a41f7c919'],
  ['sidebar-expanded-left.svg', '9c025856efa6a90f39e7637f58b305804575bbcae1bb88b2b408828b6a81ed6c'],
  ['sidebar-expanded-right.svg', '989b2b36d54eb24558d310e789efc57d3be4e3c582b273f71b4ce6b81adf11ad']
]);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

function buttonMarkup(id) {
  return html.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || '';
}

function symbolMarkup(id) {
  return html.match(new RegExp(`<symbol id="viewer-icon-${id}"[\\s\\S]*?<\\/symbol>`))?.[0] || '';
}

function referencePathData(id) {
  return symbolMarkup(id).match(/\sd="([^"]+)"/)?.[1] || '';
}

test('regular chrome controls use one 18px SVG frame while Page status icons stay out of scope', () => {
  assert.match(rule('.viewer-chrome-icon'), /width: 18px;[\s\S]*height: 18px;/);
  assert.match(rule('.viewer-chrome-icon'), /fill: none;/);
  assert.match(rule('.viewer-chrome-icon'), /stroke-width: 1\.35;/);
  assert.match(rule('.viewer-chrome-icon'), /stroke: currentColor;/);

  for (const [id, symbol] of [
    ['search-button', 'search'],
    ['filter-button', 'filter'],
    ['new-page-button', 'new-page'],
    ['new-folder-button', 'new-folder'],
    ['navigation-sort-button', 'sort'],
    ['right-sidebar-links-view-button', 'link'],
    ['right-sidebar-resources-view-button', 'resources'],
    ['vault-settings-button', 'settings'],
    ['vocabulary-library-button', 'library']
  ]) {
    assert.match(buttonMarkup(id), new RegExp(`viewer-icon-${symbol}`), `${id} must use ${symbol}`);
  }

  assert.match(app, /back\.append\(createViewerChromeIcon\('back', 'viewer-history-back-icon'\)\)/);
  assert.match(app, /forward\.append\(createViewerChromeIcon\('forward', 'viewer-history-forward-icon'\)\)/);
  assert.match(app, /edit\.append\(createViewerChromeIcon\('edit'\)\)/);
  assert.match(app, /highlight\.append\(createViewerChromeIcon\('highlight'\)\)/);
  assert.match(app, /dom\.editBlockButton\.replaceChildren\(createViewerChromeIcon\(pageEditing \? 'check' : 'edit'\)\)/);
  assert.match(app, /dom\.highlightButton\.replaceChildren\(createViewerChromeIcon\(highlightEditing \? 'check' : 'highlight'\)\)/);
  assert.match(app, /close\.append\(createViewerChromeIcon\('close'\)\)/);
  assert.match(app, /plus\.append\(createViewerChromeIcon\('add'\)\)/);
  assert.match(app, /createViewerChromeIcon\('tab-menu', 'viewer-tab-menu-chevron'\)/);
  assert.doesNotMatch(html, />[☰◧⚙📖＋□↕]<\/button>/u);
  assert.doesNotMatch(app, /(?:back|forward|edit|highlight|close|plus|editBlockButton|highlightButton)\.textContent\s*=\s*['"][←→✎▤✓×+]['"]/u);

  assert.doesNotMatch(rule('.nav-page-status-indicator'), /viewer-chrome-icon/);
  assert.doesNotMatch(html, /viewer-icon-(?:pin|default)/);
});

test('annotated chrome icons use System Colour 2 while history and Tab close retain their scoped states', () => {
  assert.match(css, /--system-text-colour: #5E5E5E;/);
  assert.match(css, /--system-text-level-2: #7D7D7D;/);
  assert.match(css, /--system-text-level-3: #979797;/);
  for (const selector of [
    '.top-icon-button',
    '.sidebar-library-button',
    '.toolbar-button'
  ]) {
    assert.match(rule(selector), /color: var\(--system-text-level-2\);/, selector);
  }
  assert.match(css, /\.viewer-tab-add,\s*\.viewer-tab-menu\s*\{[^}]*color: var\(--system-text-level-2\);/);
  assert.match(rule('.viewer-tab-close'), /color: var\(--system-text-colour\);/);
  assert.match(rule('.descriptor-search-icon'), /color: var\(--system-text-level-2\);/);
  assert.match(rule(".toolbar-button[data-pane-role='history-back']"), /color: var\(--system-text-level-3\);/);
  assert.match(rule(".toolbar-button[data-pane-role='history-forward']"), /color: var\(--system-text-level-3\);/);
  assert.match(css, /\.toolbar-button\[data-pane-role='history-back'\]:not\(:disabled\):is\(:hover, :focus-visible, :active\),\s*\.toolbar-button\[data-pane-role='history-forward'\]:not\(:disabled\):is\(:hover, :focus-visible, :active\)\s*\{[^}]*color: var\(--system-text-level-2\);/);
  assert.match(css, /\.viewer-tab-close:hover,\s*\.viewer-tab-close:focus-visible\s*\{[^}]*color: var\(--system-text-colour\);/);

  const sprite = html.match(/<svg class="viewer-icon-sprite"[\s\S]*?<\/svg>/)?.[0] || '';
  const referenceShapes = sprite.match(/class="viewer-reference-icon-shape" fill="currentColor" fill-rule="evenodd" stroke="none"/g) || [];
  assert.equal(referenceShapes.length, 10, 'the supplied silhouettes are direct filled contour traces');
  assert.doesNotMatch(html, /viewer-sidebar-toggle-direction|viewer-sidebar-toggle-icon is-right/);
});

test('the requested controls use the supplied reference silhouettes', () => {
  const expectedPathHashes = new Map([
    ['search', '8a11c844e9ebd3b419bb774f30363b221480a5cbfef308071b458c56db112c16'],
    ['filter', 'd0a6cf610cd20c73323d59585b01c5888c5f18926d66266a6a94ce847d320823'],
    ['new-page', 'b5a09fca677da890d178190d2e510704c9ef813cc74ed0d05e88be50e557dee7'],
    ['new-folder', '9b0e08545fd3d0e5cdd1373cb82007f4481e644b34e20779bfd1bcfee9afd4df'],
    ['edit', '61f35e7151dc5ab2ec338109ee67b344112bb1a7808a310172d9f6e19cf59cf3'],
    ['settings', '8788f367b560b7edfc6a02bbeada89aadb1d372cb7851dec3b39ae6dd074db2f'],
    ['library', '3099a7484d2bbf32dd66062b6364d3c5b960d31d58ad457ebeca9a1c1a82ce1d'],
    ['highlight', '3d30ea122ef17fa9f14958531c8980cd57ad3e29c4f4e12ccc602316aab057fa'],
    ['link', '6483eb3b9f81b1e76a1fffaf54d2b943fee72bf2a0a1449d94636a48b0ac96f8'],
    ['resources', '17abaada812885b300f298807eb2ddea7e93c3160f32ebdc0294f445895f71ba']
  ]);
  for (const [id, expectedHash] of expectedPathHashes) {
    const markup = symbolMarkup(id);
    const data = referencePathData(id);
    assert.match(markup, /class="viewer-reference-icon-shape" fill="currentColor" fill-rule="evenodd" stroke="none"/);
    assert.ok(data.length > 18_000, `${id} must retain the unsimplified PNG contour`);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), expectedHash, id);
  }

  assert.match(app, /createViewerChromeIcon\('search', 'descriptor-search-icon'\)/);
  assert.doesNotMatch(app, /icon\.textContent = '⌕'/u);
});

test('sidebar toggle states use the four exact supplied SVG assets in one fixed frame', () => {
  const left = buttonMarkup('left-sidebar-toggle');
  const right = buttonMarkup('right-sidebar-toggle');
  assert.match(left, /src="sidebar-expanded-left\.svg"/);
  assert.match(left, /src="sidebar-collapsed-left\.svg"/);
  assert.match(right, /src="sidebar-expanded-right\.svg"/);
  assert.match(right, /src="sidebar-collapsed-right\.svg"/);
  for (const [file, expectedHash] of sidebarToggleAssets) {
    const source = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    assert.match(source, /viewBox="0 0 24 24" width="24" height="24" fill="none"/);
    assert.match(source, /stroke="#7D7D7D" stroke-width="1\.55"/);
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), expectedHash, file);
  }
  assert.match(rule('.viewer-sidebar-toggle-icon.is-collapsed'), /display: none;/);
  assert.match(css, /body\.left-sidebar-collapsed #left-sidebar-toggle \.viewer-sidebar-toggle-icon\.is-expanded,\s*body\.right-sidebar-collapsed #right-sidebar-toggle \.viewer-sidebar-toggle-icon\.is-expanded\s*\{[^}]*display: none;/);
  assert.match(css, /body\.left-sidebar-collapsed #left-sidebar-toggle \.viewer-sidebar-toggle-icon\.is-collapsed,\s*body\.right-sidebar-collapsed #right-sidebar-toggle \.viewer-sidebar-toggle-icon\.is-collapsed\s*\{[^}]*display: block;/);
  assert.doesNotMatch(css, /viewer-sidebar-toggle-icon\.is-right|viewer-sidebar-toggle-direction/);
});

test('Page toolbar button columns mirror around the Pane and align with Tab and Sidebar controls', () => {
  const paneWidth = 840;
  const back = 18;
  const forward = 54;
  const edit = 786;
  const highlight = 822;
  assert.equal(back + highlight, paneWidth);
  assert.equal(forward + edit, paneWidth);
  assert.equal(edit, 786, 'Edit aligns to the Tab-menu centre');
  assert.equal(highlight, 822, 'Highlight aligns to the right Sidebar-toggle centre');

  assert.match(rule(".toolbar-button[data-pane-role='history-back']"), /left: -9\.8px;/);
  assert.match(rule(".toolbar-button[data-pane-role='history-forward']"), /left: -9\.4px;/);
  assert.match(rule('.edit-menu-container'), /left: 9\.4px;/);
  assert.match(rule('.highlight-menu-container'), /left: 9\.8px;/);
  assert.match(css, /\.toolbar-button\[data-pane-role='history-back'\] \.viewer-history-back-icon,\s*\.toolbar-button\[data-pane-role='history-forward'\] \.viewer-history-forward-icon,\s*\.toolbar-button\[data-pane-role='edit'\] \.viewer-chrome-icon,\s*\.toolbar-button\[data-pane-role='highlight'\] \.viewer-chrome-icon\s*\{[^}]*translateX\(2px\)/);
});

test('left Sidebar upper and lower rule extents retain the same 1.25rem hover boundary', () => {
  assert.match(rule('.left-create-toolbar::after'), /right: 1\.25rem;[\s\S]*left: 1\.25rem;/);
  assert.match(rule('.sidebar-library-footer'), /margin: 0\.75rem 1\.25rem 1\.25rem;/);
  assert.match(rule('.left-sidebar > .sidebar-library-footer'), /width: calc\(var\(--left-sidebar-width\) - 2\.5rem - 1px\);/);
  assert.match(rule('.sidebar-project-name:hover'), /background: var\(--accent-strong\);/);
});

test('Tab menu, Sidebar toggle, Edit, Highlight, Links, and Resources retain one SVG frame family', () => {
  assert.match(html, /id="viewer-icon-tab-menu" viewBox="0 0 18 18"/);
  assert.match(html, /id="viewer-icon-link" viewBox="0 0 18 18"/);
  assert.match(html, /id="viewer-icon-resources" viewBox="0 0 18 18"/);
  assert.match(rule('.viewer-chrome-icon'), /width: 18px;[\s\S]*height: 18px;[\s\S]*stroke: currentColor;[\s\S]*stroke-width: 1\.35;/);
  assert.match(css, /\.viewer-tab-add,\s*\.viewer-tab-menu\s*\{[^}]*color: var\(--system-text-level-2\);/);
  assert.match(css, /\.top-tab-area\s*\{[^}]*padding-top: 0;/);
  assert.match(css, /\.viewer-tab-strip\s*\{[^}]*height: var\(--chrome-row-one-height\);[^}]*overflow: hidden;/);
  assert.doesNotMatch(css, /\.viewer-tab-strip\s*\{[^}]*top:/);
  assert.match(css, /\.viewer-tab-list\s*\{[^}]*align-self: stretch;[^}]*height: 100%;/);
  assert.match(css, /\.viewer-tab\s*\{[^}]*align-self: flex-end;[^}]*height: calc\(var\(--chrome-row-one-height\) - var\(--tab-title-strip-height\)\);/);
  assert.match(css, /\.viewer-tab-add\s*\{[^}]*align-self: center;[^}]*height: 30px;/);
  assert.match(css, /\.viewer-tab-menu\s*\{[^}]*align-self: center;[^}]*height: 30px;/);
  assert.doesNotMatch(css, /\.viewer-tab-menu\s*\{[^}]*top: -2\.5px;/);
  assert.match(css, /\.viewer-tab-menu::before\s*\{[^}]*width: 30px;[^}]*height: 30px;/);
  assert.match(css, /\.viewer-tab-add::before\s*\{[^}]*width: 30px;[^}]*height: 30px;/);
});

test('scoped icon hover highlights share one centred 30px frame including Vault and history controls', () => {
  assert.match(rule('.top-icon-button'), /width: 30px;[\s\S]*min-height: 30px;[\s\S]*border-radius: 5px;/);
  assert.match(rule('.sidebar-library-button'), /width: 30px;[\s\S]*min-height: 30px;[\s\S]*border-radius: 5px;/);
  assert.match(css, /\.sidebar-library-button:hover,\s*\.sidebar-library-button:focus-visible\s*\{[^}]*background: var\(--accent-strong\);/);
  assert.match(css, /\.toolbar-button:not\(:disabled\):hover,\s*\.toolbar-button:not\(:disabled\):focus-visible\s*\{[^}]*background: var\(--accent-strong\);/);
  assert.doesNotMatch(css, /history-(?:back|forward)[^}]*hover:not\(:focus-visible\)[^}]*background: transparent/);
});
