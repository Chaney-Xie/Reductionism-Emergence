const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rules(css, selector) {
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped(selector)}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1]);
}

test('retired Right Sidebar halo surfaces no longer participate in paint', async () => {
  const [css, sidebar] = await Promise.all([
    read('public/styles.css'),
    read('public/js/rightSidebar.js')
  ]);
  const resizer = rules(css, '.right-section-resizer')[0] || '';
  const hitTarget = rules(css, '.right-section-resizer::before')[0] || '';

  assert.doesNotMatch(css, /--right-section-divider-(?:before|after)-surface/);
  assert.doesNotMatch(css, /\.right-sidebar-section\.is-collapsed \+ \.right-section-resizer\s*\{/);
  assert.doesNotMatch(css, /\.right-section-resizer\.is-presenting-collapsing-body\s*\{/);
  assert.match(resizer, /flex: 0 0 2px/);
  assert.match(resizer, /background: var\(--right-section-divider-colour\)/);
  assert.match(hitTarget, /inset-block: -2px/);
  assert.match(hitTarget, /pointer-events: auto/);
  assert.doesNotMatch(sidebar, /is-presenting-collapsing-body/);
  assert.doesNotMatch(sidebar, /getBoundingClientRect\?\.\(\)\.height\) \|\| 6/);
});

test('retired Markdown aliases cannot be emitted by the current renderer', async () => {
  const [css, view] = await Promise.all([
    read('public/styles.css'),
    read('public/js/markdownPageView.js')
  ]);

  assert.doesNotMatch(css, /\.markdown-page-inline-highlight(?:[\s,{.:#])/);
  assert.doesNotMatch(css, /\.markdown-page-table-delimiter-row(?:[\s,{.:#])/);
  assert.doesNotMatch(view, /markdown-page-inline-highlight/);
  assert.doesNotMatch(view, /markdown-page-table-delimiter-row/);
  assert.match(view, /createElement\('tr', 'markdown-table-delimiter-row'\)/);
  assert.match(css, /\.markdown-table-delimiter-row,\s*\.markdown-source-block-gap\s*\{/);
});

test('shared semantic owners replace private or duplicated declarations without changing values', async () => {
  const [html, css, typography] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css'),
    read('public/typography.css')
  ]);

  assert.match(html, /<body class="system-typography">/);
  assert.match(typography, /\.system-typography \{[^}]*font-family: var\(--font-system-family\)/);
  assert.match(typography, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family: var\(--font-system-family\)/);
  for (const selector of [
    '.vault-settings-level-1-heading',
    '.vault-settings-level-2-heading',
    '.vault-settings-item-text',
    '.vault-settings-description'
  ]) assert.doesNotMatch(rules(css, selector)[0] || '', /font-family:/);
  assert.doesNotMatch(css, /\.vault-settings-content button\s*\{/);

  const searchRules = rules(css, '.descriptor-search-box');
  assert.equal(searchRules.length, 2);
  assert.doesNotMatch(searchRules[0], /--input-border-colour|background:/);
  assert.match(searchRules[1], /--input-border-colour: var\(--control-border\)/);
  assert.match(searchRules[1], /background: var\(--control-surface\)/);

  assert.doesNotMatch(css, /(?:^|\n)\.nav-folder \.nav-folder\s*\{/);
  assert.match(css, /\.nav-folder-manual-button \.nav-folder-disclosure-button,\s*\.nav-folder-dynamic-button \.nav-folder-disclosure-button\s*\{/);
});

test('Page Default Open paint has one current owner and keeps identical computed geometry', async () => {
  const css = await read('public/styles.css');
  const owner = rules(css, '.nav-page-status-indicator.nav-default-indicator')[0] || '';

  assert.doesNotMatch(css, /(?:^|\n)\.nav-default-indicator\s*\{/);
  assert.match(owner, /border: 0/);
  assert.match(owner, /border-radius: 50%/);
  assert.match(owner, /transform: translateY\(0\.5px\)/);
  assert.match(rules(css, '.nav-page-status-indicator.nav-default-indicator::before')[0] || '', /border: 1\.3px solid currentColor/);
});

test('untouched active stylesheets retain their central semantic owners', async () => {
  const [shared, typography, vocabulary] = await Promise.all([
    read('public/sharedControls.css'),
    read('public/typography.css'),
    read('public/vocabulary.css')
  ]);

  assert.match(shared, /\.ui-outline-action/);
  assert.match(shared, /\.ui-solid-action/);
  assert.match(typography, /--font-file-family/);
  assert.match(typography, /--font-system-family/);
  assert.match(typography, /--font-page-family/);
  assert.match(vocabulary, /\.vocab-app\s*\{/);
  assert.match(vocabulary, /\.vocab-display-row:hover/);
  assert.match(vocabulary, /\.vocab-index button\s*\{/);
});
