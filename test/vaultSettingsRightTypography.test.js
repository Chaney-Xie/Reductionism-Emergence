const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

function panel(html, startId, endId) {
  const start = html.indexOf(`id="${startId}"`);
  const end = endId ? html.indexOf(`id="${endId}"`, start) : html.length;
  return start >= 0 && end > start ? html.slice(start, end) : '';
}

function roleTexts(markup, roleClass) {
  const escaped = roleClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...markup.matchAll(new RegExp(
    `<(?:h[1-6]|span|div|strong)[^>]*class="[^"]*${escaped}[^"]*"[^>]*>([^<]+)<`,
    'g'
  ))].map((match) => match[1].trim());
}

test('Vault Settings right content exposes one five-role typography contract', async () => {
  const [html, css, typography, ui] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css'),
    read('public/typography.css'),
    read('public/js/vaultSettings.js')
  ]);

  for (const selector of [
    '.vault-settings-level-1-heading',
    '.vault-settings-level-2-heading',
    '.vault-settings-item-text',
    '.vault-settings-description'
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(rule(css, selector), /font-family:/);
  }
  assert.match(html, /<body class="system-typography">/);
  assert.match(typography, /\.system-typography \{[^}]*font-family: var\(--font-system-family\)/);
  assert.match(typography, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family: var\(--font-system-family\)/);
  assert.doesNotMatch(css, /\.vault-settings-content button\s*\{/);
  assert.match(css, /\.vault-settings-panel \{[^}]*max-width: 520px;[^}]*gap: 0\.7rem;/s);
  assert.match(css, /\.vault-settings-section-divider \{[^}]*background: var\(--border-tool\);/s);

  for (const retired of [
    'vault-appearance-title',
    'vault-appearance-divider',
    'vault-control-title',
    'vault-control-description',
    'vault-category-title',
    'vault-management-divider'
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${retired}(?:\\s|,|\\{)`));
  }

  assert.match(css, /\.vault-folder-status\.error \{[^}]*color: #ad3030;/s);
  assert.doesNotMatch(html, /vault-settings-navigation-item[^>]*vault-settings-(?:level|item|description)/);
  assert.match(ui, /status\.className = 'vault-folder-status'/);
});

test('Vault Settings right content owns the exact heading, item, unit, and description colours', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css')
  ]);

  const level1 = rule(css, '.vault-settings-level-1-heading');
  assert.match(level1, /color: var\(--system-text-level-1\)/);
  assert.match(level1, /font-weight: 700/);
  assert.match(level1, /font-size: 1rem/);
  assert.match(level1, /line-height: 1\.3/);

  const level2 = rule(css, '.vault-settings-level-2-heading');
  assert.match(level2, /color: var\(--system-text-colour\)/);
  assert.match(level2, /font-weight: 700/);
  assert.match(level2, /font-size: 0\.9rem/);
  assert.match(level2, /line-height: 1\.35/);

  const item = rule(css, '.vault-settings-item-text');
  assert.match(item, /color: var\(--system-text-colour\)/);
  assert.match(item, /font-weight: 400/);
  assert.match(item, /font-size: var\(--vault-functional-label-font-size\)/);
  assert.match(item, /line-height: 1\.35/);

  const description = rule(css, '.vault-settings-description');
  assert.match(description, /color: var\(--system-text-level-3\)/);
  assert.match(description, /font-weight: 400/);
  assert.match(description, /font-size: var\(--system-hint-text-size\)/);
  assert.match(description, /line-height: 1\.45/);

  const adjustments = css.match(
    /\.vault-settings-content :is\(\s*output,[\s\S]*?\.vault-block-border-input > span\s*\)\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(adjustments, /color: var\(--system-text-colour\)/);
  assert.match(adjustments, /font-weight: 400/);
  assert.match(html, /id="guide-section-brightness-value"[^>]*>3%<\/output>/);
  assert.match(html, /class="vault-block-percentage-input"[\s\S]*?<span aria-hidden="true">%<\/span>/);
  assert.match(html, /class="vault-block-border-input"[\s\S]*?<span>px<\/span>/);

  assert.doesNotMatch(rule(css, '.vault-settings-content button'), /color:|font-weight:/);
  assert.match(rule(css, '.vault-folder-status.error'), /color: #ad3030/);
  assert.match(rule(css, '.appearance-manage-error'), /color: #a33f3f/);
  assert.doesNotMatch(css, /\.vault-settings-navigation[^,{]*,\s*\.vault-settings-(?:level|item|description)/);
});

test('Level-1 sections and shared separators match the required page matrix', async () => {
  const [html, ui] = await Promise.all([
    read('public/index.html'),
    read('public/js/vaultSettings.js')
  ]);
  const preference = panel(html, 'vault-settings-control-panel', 'vault-settings-appearance-panel');
  const appearance = panel(html, 'vault-settings-appearance-panel', 'vault-settings-links-panel');
  const category = panel(html, 'vault-settings-category-panel', 'vault-name-overlay');

  assert.deepEqual(roleTexts(preference, 'vault-settings-level-1-heading'), ['Control', 'Page Setting']);
  assert.deepEqual(roleTexts(appearance, 'vault-settings-level-1-heading'), [
    'System Colour', 'Block Colour', 'Markdown Colour', 'Font'
  ]);
  assert.deepEqual(roleTexts(category, 'vault-settings-level-1-heading'), ['Category', 'Collapse Setting']);
  assert.match(ui, /resourcesHeading\.textContent = 'Resources Folder'/);
  assert.match(ui, /linkTypesHeading\.textContent = 'Link Types'/);

  assert.equal((preference.match(/vault-settings-section-divider/g) || []).length, 1);
  assert.equal((appearance.match(/vault-settings-section-divider/g) || []).length, 3);
  assert.equal((category.match(/vault-settings-section-divider/g) || []).length, 1);
  assert.equal((ui.match(/divider\.className = 'vault-settings-section-divider'/g) || []).length, 1);
});

test('only real subgroups use Level-2 and direct settings remain Items', async () => {
  const [html, ui] = await Promise.all([
    read('public/index.html'),
    read('public/js/vaultSettings.js')
  ]);
  const preference = panel(html, 'vault-settings-control-panel', 'vault-settings-appearance-panel');
  const appearance = panel(html, 'vault-settings-appearance-panel', 'vault-settings-links-panel');

  assert.deepEqual(roleTexts(appearance, 'vault-settings-level-2-heading'), [
    'Headings', 'Text Styles', 'Code', 'Source Symbols'
  ]);
  assert.match(ui, /vault-category-group-name vault-settings-level-2-heading/);
  assert.equal(roleTexts(preference, 'vault-settings-level-2-heading').length, 0);

  for (const label of [
    'Zoom Sensitivity', 'Default Page Type', 'Preserve Single Line Breaks',
    'Preset Colour', 'Style 1', 'Style 2', 'Style 3', 'Border Width',
    'File font', 'System font', 'Page font'
  ]) {
    assert.match(`${preference}\n${appearance}`, new RegExp(
      `class="[^"]*vault-settings-item-text[^"]*"[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`
    ));
  }
});
