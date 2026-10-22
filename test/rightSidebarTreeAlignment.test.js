const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Right Sidebar exposes one deterministic tree-slot contract', async () => {
  const css = await read('public/styles.css');
  const contract = rule(css, '.right-sidebar');

  assert.match(contract, /--right-tree-chevron-size: 0\.75rem/);
  assert.match(contract, /--right-tree-column-gap: 0\.25rem/);
  assert.match(contract, /--right-tree-checkbox-size: 13px/);
  assert.match(contract, /--right-tree-depth-step: 0\.75rem/);
  assert.match(contract, /--right-tree-text-start: calc\(var\(--right-tree-chevron-size\) \+ var\(--right-tree-column-gap\)\)/);
  assert.match(contract, /--right-relation-child-text-start: 1\.25rem/);

  const categoryHeading = rule(css, '.right-filter-group-heading');
  assert.match(categoryHeading, /display: grid/);
  assert.match(categoryHeading, /grid-template-columns: var\(--right-tree-chevron-size\) minmax\(0, 1fr\)/);
  assert.match(categoryHeading, /column-gap: var\(--right-tree-column-gap\)/);

  const categoryRow = rule(css, '.right-filter-checkbox');
  assert.match(categoryRow, /display: grid/);
  assert.match(categoryRow, /grid-template-columns: var\(--right-tree-checkbox-size\) minmax\(0, 1fr\)/);
  assert.match(categoryRow, /align-items: center/);
  assert.match(categoryRow, /var\(--right-filter-depth, 0\) \* var\(--right-tree-depth-step\)/);
  assert.doesNotMatch(categoryRow, /right-tree-text-start|right-tree-control-text-start/);

  const descriptorRow = rule(css, '.right-descriptor-filter-row');
  for (const column of [
    'var(--right-tree-chevron-size)',
    'var(--right-tree-checkbox-size)',
    'minmax(0, 1fr)',
    'auto'
  ]) assert.ok(descriptorRow.includes(column), `Descriptor row reserves ${column}`);
  assert.match(descriptorRow, /align-items: center/);
  assert.match(descriptorRow, /column-gap: var\(--right-tree-column-gap\)/);
});

test('all in-scope Right Sidebar chevrons use one size, x-origin, and Group 2.2 colour', async () => {
  const css = await read('public/styles.css');
  const scopedChevron = rule(css, '.right-sidebar .disclosure-chevron');
  assert.match(scopedChevron, /color: var\(--border-guide\)/);

  const descriptorDisclosure = rule(css, '.right-descriptor-disclosure');
  assert.match(descriptorDisclosure, /width: var\(--right-tree-chevron-size\)/);
  assert.match(descriptorDisclosure, /height: var\(--right-tree-chevron-size\)/);
  assert.match(descriptorDisclosure, /color: var\(--border-guide\)/);

  const descriptorChevron = rule(css, '.right-descriptor-disclosure .disclosure-chevron');
  assert.match(descriptorChevron, /flex-basis: var\(--right-tree-chevron-size\)/);
  assert.match(descriptorChevron, /width: var\(--right-tree-chevron-size\)/);

  const relationChevron = rule(css, '.relation-group-heading > .disclosure-chevron');
  assert.match(relationChevron, /margin-left: 0/);
  assert.match(relationChevron, /color: var\(--border-guide\)/);
  assert.doesNotMatch(`${descriptorDisclosure}\n${descriptorChevron}\n${relationChevron}`, /#6d7887|0\.7rem|-0\.375rem/);
});

test('Right Sidebar root rows align their first visible content without fake control slots', async () => {
  const css = await read('public/styles.css');
  const categoryRow = rule(css, '.right-filter-checkbox');
  assert.match(categoryRow, /padding-left: calc\(\s*var\(--right-filter-depth, 0\) \* var\(--right-tree-depth-step\)\s*\)/);
  assert.doesNotMatch(categoryRow, /right-tree-text-start|right-tree-control-text-start/);
  assert.match(rule(css, '#right-category-filter > .right-filter-empty'), /padding-left: 0/);
  assert.match(rule(css, '#right-descriptor-filter > .right-filter-empty'), /padding-left: 0/);
  assert.match(rule(css, '.relations-list > .muted'), /padding-left: 0/);

  const left = rule(css, '.left-sidebar');
  assert.match(left, /--nav-page-text-start: 1\.525rem/);
  assert.match(rule(css, '.nav-folder-pages > .nav-folder-empty'), /padding-left: var\(--nav-page-text-start\)/);
  assert.match(rule(css, '.nav-empty-state'), /padding: 0\.55rem 0\.7rem 0\.55rem var\(--nav-page-text-start\)/);
  assert.match(rule(css, '#filter-panel > .nav-folder-empty'), /padding-inline: 0/);
});

test('Relations uses a real guide and modest child indent without a fake chevron slot', async () => {
  const [css, sidebar] = await Promise.all([
    read('public/styles.css'),
    read('public/js/rightSidebar.js')
  ]);

  const heading = rule(css, '.relation-group-heading');
  assert.match(heading, /display: grid/);
  assert.match(heading, /grid-template-columns: var\(--right-tree-chevron-size\) minmax\(0, 1fr\)/);
  assert.match(heading, /padding: 0\.5em 0/);

  const rows = rule(css, '.relation-group-rows');
  assert.match(rows, /width: calc\(100% - var\(--right-tree-guide-x\)\)/);
  assert.match(rows, /margin: 0 0 0 var\(--right-tree-guide-x\)/);
  assert.match(rows, /var\(--right-relation-child-text-start\) - var\(--right-tree-guide-x\)/);
  assert.match(rows, /border-left: 1px solid var\(--border-guide\)/);
  assert.match(rule(css, '.relation-group-rows::before'), /content: none/);

  const renderGroupStart = sidebar.indexOf('function renderRelationGroup(');
  const renderGroupEnd = sidebar.indexOf('\nfunction ', renderGroupStart + 1);
  const renderGroup = sidebar.slice(renderGroupStart, renderGroupEnd);
  const childRows = renderGroup.slice(renderGroup.indexOf("rows.className = 'relation-group-rows'"));
  assert.match(childRows, /button\.className = 'relation-button file-typography'/);
  assert.doesNotMatch(childRows, /disclosure-chevron/);
  assert.doesNotMatch(rule(css, '.relation-button'), /grid-template-columns|::before|padding-left/);
});
