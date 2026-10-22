const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function readFiles() {
  const root = path.join(__dirname, '..');
  const names = [
    'public/typography.css',
    'public/styles.css',
    'public/index.html',
    'public/js/navigation.js',
    'public/js/rightSidebar.js',
    'public/js/descriptorModal.js',
    'public/app.js'
  ];
  const values = await Promise.all(names.map((name) => fs.readFile(path.join(root, name), 'utf8')));
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

test('File, System, and Page typography have central semantic control points', async () => {
  const files = await readFiles();
  const typography = files['public/typography.css'];
  const styles = files['public/styles.css'];
  const html = files['public/index.html'];
  const navigation = files['public/js/navigation.js'];
  const rightSidebar = files['public/js/rightSidebar.js'];

  for (const variable of [
    '--font-file-family',
    '--font-file-size',
    '--font-system-family',
    '--font-page-family',
    '--font-page-body-size',
    '--font-page-title-family',
    '--font-page-title-size'
  ]) assert.match(typography, new RegExp(variable));
  assert.match(typography, /\.file-typography \{[\s\S]*font-family: var\(--font-file-family\);[\s\S]*font-size: var\(--font-file-size\);/);
  assert.match(typography, /\.system-typography \{[\s\S]*font-family: var\(--font-system-family\);/);
  assert.match(typography, /\.page-title-typography \{[\s\S]*font-family: var\(--font-page-title-family\);[\s\S]*font-size: var\(--font-page-title-size\);/);

  assert.match(html, /<body class="system-typography">/);
  assert.match(files['public/app.js'], /titleDisplay\.className = 'page-title-display system-typography'/);
  assert.match(files['public/app.js'], /titleInput\.className = 'title-input system-typography'/);
  assert.doesNotMatch(files['public/app.js'], /titleInput\.className = 'title-input page-title-typography'/);
  assert.match(styles, /\.page-title-display \{[\s\S]*font-family: var\(--font-system-family\);[\s\S]*font-size: 14px;[\s\S]*font-weight: 400;/);
  assert.match(styles, /\.title-input \{[\s\S]*font-family: var\(--font-system-family\);[\s\S]*font-size: 14px;[\s\S]*font-weight: 400;/);

  assert.match(navigation, /page-link file-typography/);
  assert.match(navigation, /nav-folder-manual-button file-typography/);
  assert.match(navigation, /nav-folder-dynamic-button system-typography/);
  assert.match(rightSidebar, /resource-item-button file-typography/);
  assert.match(rightSidebar, /relation-button file-typography/);
  assert.match(styles, /\.nav-folder-manual-button \{[^}]*font-weight: 700;/);
  assert.match(styles, /\.page-link \{[\s\S]*font-weight: 400;/);
  assert.match(styles, /\.relation-button \{[\s\S]*font-weight: 400;/);
  assert.match(styles, /\.resource-item-button \{[\s\S]*font-weight: 400;/);
  assert.doesNotMatch(styles, /\.page-link\.in-folder\s*\{[^}]*font-size/);

  for (const systemUiId of [
    'descriptor-search-panel',
    'filter-panel',
    'vault-settings-overlay'
  ]) assert.match(html, new RegExp(`id="${systemUiId}"`));
  assert.match(files['public/app.js'], /status\.dataset\.paneRole = 'status'/);
  assert.match(html, /right-section-header system-typography/);
});

test('dynamic folder hierarchy is distinct but shares the System section scale', async () => {
  const files = await readFiles();
  const styles = files['public/styles.css'];
  const navigation = files['public/js/navigation.js'];
  assert.match(navigation, /function isDynamicNavigationFolder\(folder\)/);
  assert.match(navigation, /folder\?\.type === 'system' \|\| folder\?\.source\?\.kind !== 'manual'/);
  assert.match(navigation, /nav-folder-dynamic/);
  assert.match(styles, /\.nav-folder-dynamic-button \{[\s\S]*color: var\(--system-text-level-2\);[\s\S]*font-size: 0\.78rem;[\s\S]*font-weight: 700;/);
  assert.match(styles, /\.nav-folder-dynamic-button \{[\s\S]*padding: var\(--font-file-row-padding-block\) 0\.7rem;[\s\S]*line-height: var\(--font-file-row-line-height\);/);
  assert.match(navigation, /page-link file-typography/);
});

test('redundant navigation and right-filter labels are absent while controls remain', async () => {
  const files = await readFiles();
  const html = files['public/index.html'];
  const rightSidebar = files['public/js/rightSidebar.js'];
  assert.doesNotMatch(html, /<h2>Pages<\/h2>/);
  assert.doesNotMatch(rightSidebar, /'Descriptor groups'/);
  assert.doesNotMatch(rightSidebar, /'Categories'/);
  assert.match(html, /id="right-category-filter"/);
  assert.match(html, /id="right-descriptor-filter"/);
  assert.match(html, /id="right-category-clear"[\s\S]*>Clear<\/button>/);
  assert.match(html, /id="right-descriptor-clear"[\s\S]*>Clear<\/button>/);
  assert.match(rightSidebar, /input\.type = 'checkbox'/);
});

test('all affected disclosures use one hollow chevron and right headers place it first', async () => {
  const files = await readFiles();
  const affected = [
    files['public/index.html'],
    files['public/styles.css'],
    files['public/js/navigation.js'],
    files['public/js/rightSidebar.js'],
    files['public/js/descriptorModal.js'],
    files['public/app.js']
  ].join('\n');
  assert.doesNotMatch(affected, /[▸▾▶▼]/);
  assert.doesNotMatch(affected, /content:\s*['"]>['"]/);
  assert.match(files['public/styles.css'], /\.disclosure-chevron::before,[\s\S]*\.disclosure-chevron::after \{[\s\S]*background: currentColor/);
  assert.match(files['public/styles.css'], /\.disclosure-chevron::before \{[\s\S]*rotate\(40deg\)/);
  assert.match(files['public/styles.css'], /\.disclosure-chevron::after \{[\s\S]*rotate\(-40deg\)/);
  assert.match(files['public/styles.css'], /\[aria-expanded="true"\] > \.disclosure-chevron \{[\s\S]*rotate\(90deg\)/);
  assert.match(files['public/index.html'], /right-section-header system-typography[\s\S]*?<span class="right-section-disclosure disclosure-chevron"[\s\S]*?<span>Maintenance<\/span>/);
  assert.match(files['public/index.html'], /<span>Category<\/span>/);
  assert.match(files['public/index.html'], /<span>Descriptor<\/span>/);
  assert.match(files['public/index.html'], /<span>Relations<\/span>/);
  assert.match(files['public/js/navigation.js'], /nav-folder-disclosure disclosure-chevron/);
  assert.match(files['public/js/rightSidebar.js'], /heading\.setAttribute\('aria-expanded'/);
  assert.match(files['public/js/rightSidebar.js'], /collapsedRightSectionIds\.has\(sectionId\)[\s\S]*updateRightSidebarLayout\(\)/);
  assert.match(files['public/js/descriptorModal.js'], /descriptor-group-disclosure disclosure-chevron/);
});
