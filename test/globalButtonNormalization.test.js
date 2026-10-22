const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

function splitSelectorList(selectorList) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start));
  return selectors;
}

function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),>+~])\s*/g, '$1')
    .trim();
}

function canonicalActionSelectorArms(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((match) => splitSelectorList(match[1]))
    .map(normalizeSelector)
    .filter((selector) => selector.includes(':is(.ui-'));
}

test('one canonical owner defines exactly two action-button families', async () => {
  const css = await read('public/sharedControls.css');

  for (const [token, value] of [
    ['--ui-action-height', '30px'],
    ['--ui-action-min-width', '4rem'],
    ['--ui-action-padding-inline', '0.75rem'],
    ['--ui-action-radius', '6px'],
    ['--ui-action-font-size', '0.82rem']
  ]) assert.match(css, new RegExp(`${token}: ${value.replace('.', '\\.')}`));

  const exclusion = ':not(.right-section-action):not(.filter-clear-button)';
  const expectedSelectorArms = [
    `${exclusion}:is(.ui-outline-action,.ui-solid-action,.ui-cancel-action,.ui-primary-action)`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action)`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action):not(:disabled):hover`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action):not(:disabled):focus-visible`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action):not(:disabled):active`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action).active:not(:disabled)`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action)[aria-pressed='true']:not(:disabled)`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action)`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action):not(:disabled):hover`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action):not(:disabled):focus-visible`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action):not(:disabled):active`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action).active:not(:disabled)`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action)[aria-pressed='true']:not(:disabled)`,
    `${exclusion}:is(.ui-outline-action,.ui-cancel-action):disabled`,
    `${exclusion}:is(.ui-solid-action,.ui-primary-action):disabled`
  ];
  const selectorArms = canonicalActionSelectorArms(css);
  assert.equal(selectorArms.length, 15, 'canonical action contract has exactly 15 selector arms');
  assert.deepEqual(selectorArms, expectedSelectorArms);
  for (const selector of selectorArms) {
    assert.ok(
      selector.startsWith(`${exclusion}:is(`),
      `${selector} excludes Right Sidebar actions and compact Category Clear before the action family`
    );
  }

  const shared = css.match(/:is\(\s*\.ui-outline-action,[\s\S]*?\)\s*\{[^}]*\}/)?.[0] || '';
  for (const contract of [
    /height: var\(--ui-action-height\)/,
    /min-width: var\(--ui-action-min-width\)/,
    /padding: 0 var\(--ui-action-padding-inline\)/,
    /border-width: 1px/,
    /border-radius: var\(--ui-action-radius\)/,
    /font-size: var\(--ui-action-font-size\)/,
    /white-space: nowrap/
  ]) assert.match(shared, contract);

  const outline = rule(css, ':not(.right-section-action):not(.filter-clear-button):is(.ui-outline-action, .ui-cancel-action)');
  assert.match(outline, /border-color: var\(--control-border\)/);
  assert.match(outline, /background: var\(--control-surface\)/);
  assert.match(outline, /font-weight: 400/);

  const solid = rule(css, ':not(.right-section-action):not(.filter-clear-button):is(.ui-solid-action, .ui-primary-action)');
  assert.match(solid, /border-color: var\(--theme-colour\)/);
  assert.match(solid, /background: var\(--theme-colour\)/);
  assert.match(solid, /font-weight: 700/);

  assert.match(css, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):hover/);
  assert.match(css, /\.ui-solid-action, \.ui-primary-action\):not\(:disabled\):hover/);
  assert.match(css, /\.ui-outline-action, \.ui-cancel-action\):disabled/);
  assert.match(css, /\.ui-solid-action, \.ui-primary-action\):disabled/);
  assert.match(css, /:not\(\.right-section-action\):not\(\.filter-clear-button\):is\(/);
  assert.doesNotMatch(css, /ui-(?:secondary|tertiary|destructive)-action/);
});

test('all audited static action controls use an outline or solid primitive', async () => {
  const [html, vocabulary] = await Promise.all([
    read('public/index.html'),
    read('public/vocabulary.html')
  ]);

  for (const id of [
    'empty-tab-create-page', 'empty-tab-go-to-page', 'empty-tab-close',
    'add-link-new-page-button',
    'add-link-existing-page-button', 'add-link-others-button',
    'add-link-cancel-button', 'add-link-confirm-button',
    'external-link-sidebar-cancel', 'external-link-sidebar-confirm',
    'vault-settings-rename', 'vault-settings-reset', 'vault-settings-rebuild-navigation',
    'block-colour-new',
    'vault-name-cancel', 'vault-name-confirm'
  ]) {
    assert.match(
      html,
      new RegExp(`id="${id}"\\s+class="[^"]*ui-(?:outline|solid)-action`),
      `${id} uses a canonical action primitive`
    );
  }

  const selectButtons = html.match(/<button class="ui-outline-action"[^>]*data-colour-select=/g) || [];
  assert.equal(selectButtons.length, 27);
  assert.equal((html.match(/class="ui-solid-action ui-primary-action"[^>]*data-appearance-manage=/g) || []).length, 3);
  assert.match(vocabulary, /id="vocab-add-existing" class="vocab-action-button ui-outline-action"/);
  assert.match(vocabulary, /id="vocab-create-word" class="vocab-action-button ui-solid-action ui-primary-action"/);
  assert.match(html, /sharedControls\.css\?v=shared-actions-v02/);
  assert.match(vocabulary, /sharedControls\.css\?v=shared-actions-v02/);
});

test('dynamic action controls migrate without changing their event ownership', async () => {
  const [app, descriptor, vault, navigation, links, vocabulary] = await Promise.all([
    read('public/app.js'),
    read('public/js/descriptorModal.js'),
    read('public/js/vaultSettings.js'),
    read('public/js/navigation.js'),
    read('public/js/externalLinks.js'),
    read('public/vocabulary.js')
  ]);

  assert.match(app, /clearButton\.className = 'filter-clear-button ui-outline-action'/);
  assert.match(app, /selectedCategoryFilterIds\.clear\(\);\s*renderFilterPanel\(\);\s*renderPageList\(\)/);
  assert.match(app, /empty-tab-action \$\{action === 'create-page' \? 'ui-solid-action' : 'ui-outline-action'\}/);
  assert.match(descriptor, /descriptor-add-group-button ui-solid-action ui-primary-action/);
  assert.match(descriptor, /descriptor-ignored-toggle ui-solid-action ui-primary-action/);
  assert.match(descriptor, /cancelButton\.className = 'ui-outline-action ui-cancel-action'/);
  assert.match(descriptor, /saveButton\.className = 'ui-solid-action ui-primary-action'/);
  assert.match(vault, /appearance-manage-action ui-outline-action ui-cancel-action/g);
  assert.match(vault, /appearance-manage-action(?: appearance-manage-save)? ui-solid-action ui-primary-action/g);
  assert.match(vault, /variant === 'theme' \? 'ui-solid-action ui-primary-action'/);
  assert.match(vault, /'ui-outline-action neutral-control'/);
  assert.match(navigation, /cancelButton\.className = 'ui-outline-action ui-cancel-action'/);
  assert.match(navigation, /deleteButton\.className = 'ui-solid-action'/);
  assert.match(links, /external-link-file-path ui-outline-action/);
  assert.match(links, /external-link-mode-action ui-outline-action/);
  assert.match(vocabulary, /vocab-add-here ui-outline-action/);
});

test('local component CSS owns layout only after primitive migration', async () => {
  const [css, vocabulary] = await Promise.all([
    read('public/styles.css'),
    read('public/vocabulary.css')
  ]);
  const forbidden = /(?:^|;)\s*(?:height|min-height|min-width|padding|border(?:-\w+)?|border-radius|color|background|font(?:-\w+)?|line-height|cursor)\s*:/;
  for (const selector of [
    '.external-link-file-path',
    '.vault-block-colour-new', '.vault-folder-action',
    '.descriptor-add-group-button', '.empty-tab-action'
  ]) assert.doesNotMatch(rule(css, selector), forbidden, `${selector} is layout-only`);
  assert.match(rule(css, '.filter-clear-button'), /padding: 0\.25rem 0\.45rem/);
  assert.match(rule(css, '.filter-clear-button'), /border: 1px solid var\(--sidebar-control-border\)/);
  assert.match(rule(css, '.filter-clear-button'), /font-size: 0\.78rem/);
  assert.doesNotMatch(css, /\.add-link-(?:row|actions) button[^\{]*\{/);
  assert.doesNotMatch(css, /\.vault-appearance-colour-row button[^\{]*\{/);
  assert.doesNotMatch(css, /\.descriptor-ignored-toggle\s*\{/);
  assert.doesNotMatch(css, /\.forced-modal-actions button\s*\{/);
  assert.doesNotMatch(vocabulary, /\.vocab-action-button\s*\{[^}]*?(?:padding|border|font|background|color):/);
  assert.equal(rule(vocabulary, '.vocab-add-here'), '.vocab-add-here {\n  display: none;\n}');
});

test('wording is shortened only where meaning remains unambiguous', async () => {
  const [html, vocabulary] = await Promise.all([
    read('public/index.html'),
    read('public/vocabulary.js')
  ]);
  assert.match(html, /id="vault-settings-rename"[^>]*>Rename<\/button>/);
  assert.doesNotMatch(html, /id="vault-settings-rename"[^>]*>Rename Vault<\/button>/);
  assert.match(vocabulary, /button\.textContent = 'Add here'/);
  assert.match(vocabulary, /`Add "\$\{word\}" to "\$\{entry\.display\}"`/);
});

test('excluded icon, toggle, menu, palette, and list-row controls remain outside action families', async () => {
  const [html, app, vault, navigation, links] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/js/vaultSettings.js'),
    read('public/js/navigation.js'),
    read('public/js/externalLinks.js')
  ]);
  for (const className of [
    'right-section-toggle', 'vault-block-colour-switch',
    'vault-settings-navigation-item', 'vault-block-colour-preset'
  ]) {
    const fragment = html.match(new RegExp(`class="[^"]*${className}[^"]*"`))?.[0] || '';
    assert.doesNotMatch(fragment, /ui-(?:outline|solid)-action/);
  }
  for (const id of [
    'right-category-clear', 'right-descriptor-clear',
    'add-file-button', 'external-links-add-button'
  ]) {
    const className = html.match(new RegExp(`id="${id}" class="([^"]*)"`))?.[1] || '';
    assert.match(className, /(?:^|\s)right-section-action(?:\s|$)/);
    assert.doesNotMatch(className, /ui-(?:outline|solid|cancel|primary)-action/);
  }
  assert.match(app, /clearButton\.className = 'descriptor-search-clear'/);
  assert.match(app, /more\.className = 'highlight-group-more'/);
  assert.match(vault, /close\.className = 'appearance-manage-close'/);
  assert.match(vault, /remove\.className = 'appearance-font-remove'/);
  assert.match(navigation, /button\.className = 'navigation-sort-option'/);
  assert.match(links, /button\.className = 'block-link-choice-row'/);
});
