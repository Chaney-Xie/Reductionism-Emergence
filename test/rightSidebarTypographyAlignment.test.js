const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Right Sidebar exposes one scoped header, body, hint, and row rhythm contract', async () => {
  const css = await read('public/styles.css');
  const contract = css.match(
    /\.right-sidebar,\s*\.external-link-sidebar-popover\s*\{[^}]*\}/
  )?.[0] || '';

  assert.match(contract, /--right-sidebar-header-font-size: 0\.86rem/);
  assert.match(contract, /--right-sidebar-body-font-size: 0\.82rem/);
  assert.match(contract, /--right-sidebar-hint-font-size: var\(--system-hint-text-size\)/);
  assert.match(contract, /--right-sidebar-body-line-height: 1\.35/);
  assert.match(contract, /--right-sidebar-content-text-inset: 0rem/);
  assert.match(contract, /--right-sidebar-row-padding-block: 0\.2rem/);

  assert.match(rule(css, '.right-section-toggle'), /font-size: var\(--right-sidebar-header-font-size\)/);
  const body = rule(css, '.right-section-body');
  assert.match(body, /font-family: var\(--font-system-family\)/);
  assert.match(body, /font-size: var\(--right-sidebar-body-font-size\)/);
  assert.match(body, /line-height: var\(--right-sidebar-body-line-height\)/);
});

test('ordinary content and empty states use their exact System/File font contracts', async () => {
  const css = await read('public/styles.css');
  const ordinary = css.match(
    /\.right-sidebar :where\(\s*\.right-filter-group-heading,[\s\S]*?\.external-link-row\s*\)\s*\{[^}]*\}/
  )?.[0] || '';

  for (const selector of [
    '.right-filter-group-heading',
    '.right-filter-checkbox',
    '.right-descriptor-filter-row',
    '.relation-group-heading',
    '.resource-item-button',
    '.relation-button',
    '.external-link-row'
  ]) assert.match(ordinary, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(ordinary, /font-size: var\(--right-sidebar-body-font-size\)/);
  assert.match(ordinary, /line-height: var\(--right-sidebar-body-line-height\)/);

  const fileContent = css.match(
    /\.right-sidebar :where\(\s*\.resource-item-button,[\s\S]*?\.external-link-row\s*\)\s*\{[^}]*\}/
  )?.[0] || '';
  for (const selector of ['.resource-item-button', '.relation-button', '.external-link-row']) {
    assert.match(fileContent, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(fileContent, /font-family: var\(--font-file-family\)/);
  assert.doesNotMatch(fileContent, /\.right-filter-empty|\.muted/);

  const emptyStates = css.match(
    /\.right-sidebar :is\(\s*\.right-filter-empty,[\s\S]*?\.right-section-body > ul > \.muted\s*\)\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(emptyStates, /font-family: var\(--font-system-family\)/);
  assert.match(emptyStates, /font-size: var\(--right-sidebar-hint-font-size\)/);
  assert.match(emptyStates, /line-height: var\(--right-sidebar-body-line-height\)/);

  for (const selector of [
    '.right-filter-group-heading',
    '.right-filter-checkbox',
    '.right-descriptor-filter-row',
    '.relation-group-heading',
    '.resource-item-meta',
    '.external-link-tooltip'
  ]) assert.doesNotMatch(rule(css, selector), /font-size:/);
});

test('plain resource, external-link, and relation names share the zero content inset', async () => {
  const [css, html, sidebar, externalLinks] = await Promise.all([
    read('public/styles.css'),
    read('public/index.html'),
    read('public/js/rightSidebar.js'),
    read('public/js/externalLinks.js')
  ]);

  const maintenanceList = rule(css, '.item-list');
  assert.match(maintenanceList, /padding: 0/);
  assert.match(maintenanceList, /list-style: none/);
  assert.doesNotMatch(maintenanceList, /padding-left|list-style:\s*(?:disc|circle|square)/);

  const externalList = rule(css, '.external-links-list');
  assert.match(externalList, /padding: 0\.35rem var\(--right-sidebar-content-text-inset\)/);
  assert.match(externalList, /list-style: none/);

  for (const selector of ['.resource-item-button', '.relation-button', '.external-link-row']) {
    const row = rule(css, selector);
    assert.match(row, /padding: var\(--right-sidebar-row-padding-block\) var\(--right-sidebar-content-text-inset\)/);
  }

  const relationRows = rule(css, '.relation-group-rows');
  assert.match(relationRows, /margin: 0 0 0 var\(--right-tree-guide-x\)/);
  assert.match(relationRows, /padding: 0 0 0 calc\(/);
  assert.match(relationRows, /border-left: 1px solid var\(--border-guide\)/);
  assert.match(relationRows, /list-style: none/);
  assert.match(rule(css, '.relation-group-rows::before'), /content: none/);

  assert.match(html, /id="resources-list" class="item-list"/);
  assert.match(sidebar, /item\.className = 'muted';[\s\S]*?item\.textContent = 'No maintenance files\.'/);
  assert.match(sidebar, /item\.className = 'muted';[\s\S]*?item\.textContent = 'No relations\.'/);
  assert.match(externalLinks, /empty\.className = 'muted';[\s\S]*?empty\.textContent = 'No external links\.'/);
  assert.doesNotMatch(`${sidebar}\n${externalLinks}`, /textContent = '(?:None|No matching relations)'/);
  assert.match(sidebar, /resource-item-button file-typography/);
  assert.match(sidebar, /relation-button file-typography/);
  assert.match(externalLinks, /external-link-row file-typography/);
  assert.doesNotMatch(`${css}\n${sidebar}\n${externalLinks}`, /•/);
});

test('secondary text and Right Sidebar text actions use the scoped hint size', async () => {
  const [css, externalLinks] = await Promise.all([
    read('public/styles.css'),
    read('public/js/externalLinks.js')
  ]);

  const hints = css.match(
    /\.right-sidebar :where\(\s*\.right-descriptor-filter-count,[\s\S]*?\.external-link-sidebar-popover :is\(input, textarea\)::placeholder\s*\{[^}]*\}/
  )?.[0] || '';
  for (const selector of [
    '.right-descriptor-filter-count',
    '.resource-item-meta',
    '.external-link-tooltip',
    '.external-link-or-label',
    '.external-link-editor-error',
    '::placeholder'
  ]) assert.ok(hints.includes(selector), `${selector} uses the shared hint contract`);
  assert.match(hints, /font-size: var\(--right-sidebar-hint-font-size\)/);
  assert.match(hints, /line-height: var\(--right-sidebar-body-line-height\)/);
  assert.match(rule(css, '.external-link-sidebar-popover .external-link-file-path.is-placeholder'), /color: var\(--system-text-level-3\)/);
  assert.match(rule(css, '.right-section-action'), /font-size: var\(--right-sidebar-hint-font-size\)/);
  assert.match(externalLinks, /fileButton\.classList\.toggle\('is-placeholder', !state\.displayPath\)/);
});

test('all section names retain the scoped contract and header actions remain lightweight text actions', async () => {
  const [css, shared, html] = await Promise.all([
    read('public/styles.css'),
    read('public/sharedControls.css'),
    read('public/index.html')
  ]);

  const sectionNames = rule(css, '.right-section-toggle > span:last-child');
  assert.match(sectionNames, /color: var\(--system-text-colour\)/);
  assert.doesNotMatch(css, /:is\(#right-category-filter-section, #right-descriptor-filter-section\)\s*\.right-section-toggle > span:last-child/);
  for (const name of ['Category', 'Descriptor', 'Relations', 'Maintenance', 'External Links']) {
    assert.match(html, new RegExp(`<span>${name}<\\/span>`));
  }

  const action = rule(css, '.right-section-action');
  assert.match(action, /appearance: none/);
  assert.match(action, /flex: 0 0 auto/);
  assert.match(action, /min-width: 0/);
  assert.match(action, /height: auto/);
  assert.match(action, /padding: 0/);
  assert.match(action, /border: 0/);
  assert.match(action, /border-radius: 0/);
  assert.match(action, /color: var\(--system-text-level-3\)/);
  assert.match(action, /background: transparent/);
  assert.match(action, /font-family: var\(--font-system-family\)/);
  assert.match(action, /font-size: var\(--right-sidebar-hint-font-size\)/);
  assert.match(action, /white-space: nowrap/);
  assert.match(
    shared,
    /:not\(\.right-section-action\):not\(\.filter-clear-button\):is\(/
  );
  assert.match(rule(css, '.right-section-action[hidden]'), /display: none/);
  const interactive = css.match(
    /\.right-section-action:not\(:disabled\):is\([\s\S]*?\.right-section-action\[aria-pressed='true'\]:not\(:disabled\)\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(interactive, /color: var\(--system-text-level-2\)/);
  assert.match(interactive, /background: transparent/);
  const disabled = rule(css, '.right-section-action:disabled');
  assert.match(disabled, /color: var\(--system-text-level-3\)/);
  assert.match(disabled, /opacity: 1/);
  assert.doesNotMatch(css, /\.add-file-button:disabled\s*\{[^}]*color:/);
  for (const id of ['right-category-clear', 'right-descriptor-clear', 'add-file-button', 'external-links-add-button']) {
    const className = html.match(new RegExp(`id="${id}" class="([^"]*)"`))?.[1] || '';
    assert.match(className, /(?:^|\s)right-section-action(?:\s|$)/);
    assert.doesNotMatch(className, /ui-(?:outline|solid|cancel|primary)-action/);
  }

  assert.match(rule(css, '.right-section-header'), /color: #364251/);
  assert.doesNotMatch(sectionNames, /disclosure|chevron/);
});

test('intentional Right Sidebar controls and icons remain present', async () => {
  const [html, sidebar] = await Promise.all([
    read('public/index.html'),
    read('public/js/rightSidebar.js')
  ]);

  assert.equal((html.match(/right-section-disclosure disclosure-chevron/g) || []).length, 5);
  assert.match(html, /id="add-file-button"[^>]*>Add File<\/button>/);
  assert.doesNotMatch(html, /Add File…/);
  assert.match(html, /id="external-links-add-button"[^>]*>Add<\/button>/);
  assert.match(sidebar, /input\.type = 'checkbox'/);
  assert.match(sidebar, /right-descriptor-disclosure/);
  assert.match(sidebar, /resource-reveal-button/);
  assert.match(sidebar, /relation-group-heading[\s\S]*?disclosure-chevron/);
});
