const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function source(name) {
  return fs.readFile(path.join(__dirname, '..', name), 'utf8');
}

test('installed-font combobox requires a canonical selected result', async () => {
  const [ui, css] = await Promise.all([
    source('public/js/vaultSettings.js'),
    source('public/styles.css')
  ]);
  assert.doesNotMatch(ui, /input\.addEventListener\('focus', renderAppearanceFontResults\)/);
  assert.match(ui, /input\.addEventListener\('click', renderAppearanceFontResults\)/);
  assert.match(ui, /!queryText \|\| name\.toLocaleLowerCase\(\)\.includes\(queryText\)/);
  assert.match(ui, /selectedFont: null/);
  assert.match(ui, /add\.disabled = true/);
  assert.match(ui, /selectAppearanceFontResult\(index\)[\s\S]*state\.selectedFont = name[\s\S]*state\.refs\.add\.disabled = false/);
  assert.match(ui, /input\.addEventListener\('input',[\s\S]*selectedFont = null[\s\S]*add\.disabled = true/);
  assert.match(ui, /if \(!selectedName \|\| state\.refs\.input\.value !== selectedName\)/);
  assert.doesNotMatch(ui, /draft\.fontFamilies\.push\(canonicalName \|\| typedName\)/);
  assert.match(ui, /state\.draft\.fontFamilies\.push\(selectedName\)/);
  assert.match(ui, /state\.refs\.input\.value = ''[\s\S]*state\.refs\.add\.disabled = true/);
  assert.match(ui, /result\.style\.fontFamily = appearancePreviewFamily\(name\)/);
  assert.match(css, /\.appearance-font-result \{[\s\S]*min-height: 36px/);
});

test('font picker keyboard handling consumes selection keys before Manage shortcuts', async () => {
  const ui = await source('public/js/vaultSettings.js');
  assert.match(ui, /inCombobox && state\.listOpen[\s\S]*event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(ui, /event\.key === 'Enter'[\s\S]*selectAppearanceFontResult\(state\.activeResultIndex\)[\s\S]*return/);
  assert.match(ui, /event\.key === 'Escape'[\s\S]*closeAppearanceResults\(\)[\s\S]*return[\s\S]*event\.key === 'Escape'[\s\S]*closeAppearanceManager/);
  assert.match(ui, /event\.key === 'Tab'\) closeAppearanceResults\(\)/);
  assert.match(ui, /aria-activedescendant/);
});

test('font results stay closed until click and close on blank-area pointer input', async () => {
  const ui = await source('public/js/vaultSettings.js');
  assert.match(ui, /listOpen: false/);
  assert.match(ui, /input\.addEventListener\('click', renderAppearanceFontResults\)/);
  assert.doesNotMatch(ui, /input\.addEventListener\('focus', renderAppearanceFontResults\)/);
  assert.match(ui, /function handleAppearanceManagePointerDown\(event\)[\s\S]*!state\?\.listOpen[\s\S]*event\.target === state\.refs\.input[\s\S]*state\.refs\.results\.contains\(event\.target\)[\s\S]*closeAppearanceResults\(\)/);
  assert.match(ui, /document\.addEventListener\('pointerdown', handleAppearanceManagePointerDown, true\)/);
  assert.match(ui, /document\.removeEventListener\('pointerdown', handleAppearanceManagePointerDown, true\)/);
  assert.match(ui, /event\.target === overlay\) closeAppearanceManager\(\)/);
});

test('font results use a viewport overlay that can flip and is removed with the modal', async () => {
  const [ui, css] = await Promise.all([
    source('public/js/vaultSettings.js'),
    source('public/styles.css')
  ]);
  assert.match(ui, /document\.body\.append\(overlay, results\)/);
  assert.match(ui, /const placeAbove = roomBelow < 180 && roomAbove > roomBelow/);
  assert.match(ui, /window\.innerWidth - width - viewportPadding/);
  assert.match(ui, /Math\.max\(160, rect\.width \/ 2\)/);
  assert.match(ui, /Math\.min\(rect\.right - width, window\.innerWidth - width - viewportPadding\)/);
  assert.match(ui, /window\.addEventListener\('resize', positionAppearanceFontResults\)/);
  assert.match(ui, /state\.refs\.results\.remove\(\)/);
  assert.match(css, /\.appearance-font-results \{[\s\S]*position: fixed;[\s\S]*z-index: 130;[\s\S]*overflow: auto/);
  const modalRule = css.match(/\.appearance-manage-modal \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(modalRule, /width: min\(640px,/);
  assert.match(modalRule, /max-height: min\(740px/);
  assert.doesNotMatch(modalRule, /min-height:/);
});

test('right-sidebar actions live in headers and filter clears remain independent', async () => {
  const [html, ui, css] = await Promise.all([
    source('public/index.html'),
    source('public/js/rightSidebar.js'),
    source('public/styles.css')
  ]);
  assert.match(html, /<div class="right-section-header system-typography">[\s\S]*?<span>Maintenance<\/span>[\s\S]*?id="add-file-button"[\s\S]*?>Add File<\/button>/);
  assert.doesNotMatch(html, /id="add-file-control"/);
  assert.match(html, /<span>Category<\/span>[\s\S]*?id="right-category-clear"[^>]*hidden>Clear<\/button>/);
  assert.match(html, /<span>Descriptor<\/span>[\s\S]*?id="right-descriptor-clear"[^>]*hidden>Clear<\/button>/);
  assert.match(ui, /rightCategoryClear\.hidden = selectedRightCategoryIds\.size === 0/);
  assert.match(ui, /rightDescriptorClear\.hidden = selectedRightDescriptorGroupIds\.size === 0/);
  assert.match(ui, /function clearRightCategoryFilters\(\) \{[\s\S]*selectedRightCategoryIds\.clear\(\)/);
  assert.doesNotMatch(ui.match(/function clearRightCategoryFilters\(\)[\s\S]*?\n\}/)?.[0] || '', /selectedRightDescriptorGroupIds\.clear/);
  assert.match(ui, /function clearRightDescriptorFilters\(\) \{[\s\S]*selectedRightDescriptorGroupIds\.clear\(\)/);
  assert.doesNotMatch(ui.match(/function clearRightDescriptorFilters\(\)[\s\S]*?\n\}/)?.[0] || '', /selectedRightCategoryIds\.clear/);
  assert.doesNotMatch(ui, /renderRightFilterToolbar/);
  assert.doesNotMatch(css, /\.right-filter-toolbar/);
  assert.doesNotMatch(css, /\.add-file-control/);
});
