const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function styles() {
  return fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
}

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('current and multi-selected navigation states use Guide section colour', async () => {
  const css = await styles();
  assert.match(rule(css, '.page-link.active'), /background: var\(--surface-guide-section\)/);
  const selectedRule = css.match(/\.page-link\.nav-selected,[\s\S]*?\.nav-folder-button\.nav-selected\s*\{[^}]*\}/)?.[0] || '';
  assert.match(selectedRule, /background: var\(--surface-guide-section\)/);
  assert.match(selectedRule, /box-shadow: none/);
  assert.doesNotMatch(selectedRule, /accent-/);
});

test('navigation hover and persistent selection share Guide section colour', async () => {
  const css = await styles();
  const pageHover = rule(css, '.page-link:hover');
  const folderHover = rule(css, '.nav-folder-button:not(.nav-selected):hover');
  assert.match(pageHover, /var\(--surface-guide-section\)/);
  assert.match(folderHover, /var\(--surface-guide-section\)/);
  assert.doesNotMatch(`${pageHover}\n${folderHover}`, /accent-/);
});

test('navigation drop target uses Guide section while manual chips retain Accent', async () => {
  const css = await styles();
  const dropTarget = rule(css, '.nav-folder.is-drop-target > .nav-folder-button');
  assert.match(dropTarget, /background: var\(--surface-guide-section\)/);
  assert.match(dropTarget, /outline: 0/);
  const chip = rule(css, '.descriptor-chip');
  const manualAuto = rule(css, '.descriptor-chip.manual-auto');
  assert.match(chip, /background: var\(--accent-soft\)/);
  assert.match(chip, /border: 1px solid transparent/);
  assert.match(manualAuto, /background: var\(--accent-soft\)/);
});

test('Relations link-type headers are plain transparent disclosure headings', async () => {
  const css = await styles();
  const base = rule(css, '.relation-group-heading');
  const interactive = css.match(/\.relation-group-heading:hover,[\s\S]*?\.relation-group-heading:focus-visible\s*\{[^}]*\}/)?.[0] || '';
  assert.match(base, /border: 0/);
  assert.match(base, /border-radius: 0/);
  assert.match(base, /background: transparent/);
  assert.match(interactive, /background: transparent/);
  assert.doesNotMatch(`${base}\n${interactive}`, /accent-colour|#dbe8f8|#dfeaf6|#e7edf5|#e9eef7/i);
});

test('File navigation keeps live metrics while Relations use the shared sidebar row rhythm', async () => {
  const css = await styles();
  for (const selector of ['.page-link', '.nav-folder-manual-button']) {
    const row = rule(css, selector);
    assert.match(row, /font-file-row-padding-block/);
    assert.match(row, /font-file-row-line-height/);
  }
  assert.match(rule(css, '.relation-button'), /right-sidebar-row-padding-block/);
  assert.match(rule(css, '.relation-button'), /right-sidebar-content-text-inset/);
  assert.match(
    css,
    /\.nav-folder-manual-button \.nav-folder-disclosure-button,\s*\.nav-folder-dynamic-button \.nav-folder-disclosure-button\s*\{[^}]*height: var\(--font-file-row-line-height\)/
  );
  assert.match(css, /\.nav-folder-dynamic-button \{[^}]*padding: var\(--font-file-row-padding-block\) 0\.7rem/);
  assert.match(css, /\.nav-folder-dynamic-button \{[^}]*line-height: var\(--font-file-row-line-height\)/);
  assert.match(rule(css, '.relation-button:focus-visible'), /var\(--surface-guide-section\)/);
});

test('folder, relation, and Global Descriptor guide lines align to matching chevrons', async () => {
  const css = await styles();
  assert.match(rule(css, '.nav-folder-pages'), /margin-left: 0\.7rem[\s\S]*border-left: 1px solid var\(--structure-line-colour\)/);
  assert.match(rule(css, '.nav-folder-disclosure-button'), /margin-left: -0\.575rem/);
  assert.match(rule(css, '.nav-folder-disclosure'), /color: var\(--border-guide\)/);
  assert.match(css, /\.nav-folder-dynamic-button \{[^}]*padding: var\(--font-file-row-padding-block\) 0\.7rem/);
  assert.match(rule(css, '.nav-folder-dynamic-button .nav-folder-disclosure-button'), /height: var\(--font-file-row-line-height\)/);
  assert.match(rule(css, '.relation-group-rows'), /margin: 0 0 0 var\(--right-tree-guide-x\)[\s\S]*border-left: 1px solid var\(--border-guide\)/);
  assert.match(rule(css, '.relation-group-rows::before'), /content: none/);
  assert.match(rule(css, '.relation-group-heading > .disclosure-chevron'), /margin-left: 0[\s\S]*color: var\(--border-guide\)/);
  assert.match(rule(css, '.descriptor-group-contents'), /margin-left: 0\.705rem[\s\S]*border-left: 1px solid var\(--border-tool\)/);
  assert.match(rule(css, '.descriptor-group-disclosure'), /color: var\(--border-tool\)/);
});
