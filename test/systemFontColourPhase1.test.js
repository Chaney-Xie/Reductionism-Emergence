const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

function lastRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'g'))].at(-1)?.[0] || '';
}

test('Phase 1 palette owns the authorized prompt and identity roles', async () => {
  const css = await read('public/styles.css');

  for (const [token, value] of [
    ['--system-text-colour', '#5E5E5E'],
    ['--system-text-level-1', '#000000'],
    ['--system-text-level-2', '#7D7D7D'],
    ['--system-text-level-3', '#979797'],
    ['--system-text-level-4', '#DADADA']
  ]) assert.match(css, new RegExp(`${token}: ${value}`));

  assert.match(rule(css, '.descriptor-search-input::placeholder'), /color: var\(--system-text-level-3\)/);
  assert.match(rule(css, '.nav-folder-empty'), /color: var\(--system-text-level-3\)/);
  assert.match(rule(css, '.nav-empty-state'), /color: var\(--system-text-level-3\)/);

  const rightEmpty = css.match(
    /\.right-sidebar :is\(\s*\.right-filter-empty,[\s\S]*?\.right-section-body > ul > \.muted\s*\)\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(rightEmpty, /color: var\(--system-text-level-3\)/);
  assert.match(rightEmpty, /font-family: var\(--font-system-family\)/);
  assert.match(rule(css, '.external-link-sidebar-popover .external-link-file-path.is-placeholder'), /color: var\(--system-text-level-3\)/);

  for (const selector of [
    '.nav-folder-dynamic-button',
    '.relation-group-heading',
    '.sidebar-project-name'
  ]) assert.match(rule(css, selector), /color: var\(--system-text-level-2\)/);
});

test('shared System text colour is limited to the authorized shell labels', async () => {
  const css = await read('public/styles.css');
  const rightTitles = rule(css, '.right-section-toggle > span:last-child');

  for (const selector of [
    '.vault-switch-name',
    '.filter-panel-header h3',
    '.nav-folder-dynamic-button .nav-folder-label-text',
    '.vault-settings-navigation-item'
  ]) assert.match(rule(css, selector), /color: var\(--system-text-colour\)/);
  assert.match(rightTitles, /color: var\(--system-text-colour\)/);

  assert.match(rule(css, '.right-section-header'), /color: #364251/);
  assert.match(rule(css, '.nav-folder-dynamic-button'), /color: var\(--system-text-level-2\)/);
  assert.match(rule(css, '.sidebar-project-name'), /color: var\(--system-text-level-2\)/);

  const vaultNavStates = css.match(
    /\.vault-settings-navigation-item:hover,[\s\S]*?\.vault-settings-navigation-item\.is-selected\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(vaultNavStates, /color: var\(--system-text-level-1\)/);
});

test('first-party menu text and canonical Add Link actions keep their assigned sizes and Phase 1 levels', async () => {
  const [css, shared] = await Promise.all([
    read('public/styles.css'),
    read('public/sharedControls.css')
  ]);
  assert.match(css, /--system-menu-text-size: 0\.85rem/);

  for (const selector of [
    '.navigation-sort-menu',
    '.edit-menu',
    '.highlight-menu',
    '.add-link-popover'
  ]) assert.match(rule(css, selector), /font-size: var\(--system-menu-text-size\)/);
  assert.match(lastRule(css, '.block-link-choice-popover'), /font-size: var\(--system-menu-text-size\)/);

  assert.match(rule(css, '.navigation-sort-menu'), /color: var\(--system-text-level-1\)/);
  assert.match(rule(css, '.edit-menu-item'), /color: var\(--system-text-level-1\)/);
  assert.match(rule(css, '.highlight-group-toggle'), /color: var\(--system-text-level-1\)/);
  assert.match(rule(css, '.add-link-popover'), /color: var\(--system-text-level-1\)/);

  assert.match(rule(css, '.navigation-sort-option:disabled'), /color: var\(--system-text-level-3\)/);
  assert.match(rule(css, '.edit-menu-item:disabled'), /color: var\(--system-text-level-3\)/);
  const highlightDisabled = css.match(/\.highlight-menu :is\(button, input\):disabled\s*\{[^}]*\}/)?.[0] || '';
  assert.match(highlightDisabled, /color: var\(--system-text-level-3\)/);
  assert.match(shared, /--ui-action-font-size: 0\.82rem/);
  assert.match(shared, /\.ui-outline-action, \.ui-cancel-action\):disabled[\s\S]*?color: #657184/);
  assert.doesNotMatch(css, /\.add-link-(?:row|actions) button[^\{]*\{/);
});

test('Right Sidebar actions and Vault Settings roles use their scoped state contracts', async () => {
  const [css, shared] = await Promise.all([
    read('public/styles.css'),
    read('public/sharedControls.css')
  ]);
  const action = rule(css, '.right-section-action');
  assert.match(action, /color: var\(--system-text-level-3\)/);
  assert.match(action, /background: transparent/);
  assert.match(action, /font-family: var\(--font-system-family\)/);
  assert.match(action, /font-size: var\(--right-sidebar-hint-font-size\)/);
  assert.match(css, /\.right-section-action:not\(:disabled\):is\([\s\S]*?color: var\(--system-text-level-2\)/);
  assert.match(rule(css, '.right-section-action:disabled'), /color: var\(--system-text-level-3\)/);
  assert.match(shared, /:not\(\.right-section-action\):not\(\.filter-clear-button\):is\(/);

  assert.match(rule(css, '.vault-settings-navigation-item'), /color: var\(--system-text-colour\)/);
  const vaultNavStates = css.match(
    /\.vault-settings-navigation-item:hover,[\s\S]*?\.vault-settings-navigation-item\.is-selected\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(vaultNavStates, /color: var\(--system-text-level-1\)/);
  assert.match(lastRule(css, '.vault-settings-navigation-item.is-selected'), /font-weight: 700/);

  assert.match(rule(css, '.vault-settings-description'), /color: var\(--system-text-level-3\)/);
  assert.match(rule(css, '.vault-settings-description'), /font-size: var\(--system-hint-text-size\)/);

  const labels = rule(css, '.vault-settings-item-text');
  assert.match(labels, /color: var\(--system-text-colour\)/);
  assert.match(labels, /font-weight: 400/);
  assert.match(labels, /font-size: var\(--vault-functional-label-font-size\)/);
  assert.match(css, /--vault-functional-label-font-size: 0\.9rem/);
});

test('all Viewer checkbox boxes use Group 1 and Group 1.1 surfaces without white', async () => {
  const css = await read('public/styles.css');
  const nativeCheckbox = rule(css, "input[type='checkbox']");
  assert.match(nativeCheckbox, /border: 1px solid var\(--border-tool\)/);
  assert.match(nativeCheckbox, /background: var\(--surface-tool\)/);
  assert.match(nativeCheckbox, /width: 13px/);
  assert.match(nativeCheckbox, /height: 13px/);

  for (const selector of [
    '.filter-checkbox-box',
    '.category-batch-state-box',
    '.vault-category-navigation-toggle'
  ]) {
    const checkbox = rule(css, selector);
    assert.match(checkbox, /border: 1px solid var\(--border-tool\)/);
    assert.match(checkbox, /background: var\(--surface-tool\)/);
    assert.doesNotMatch(checkbox, /(?:background|background-color):\s*(?:white|#fff(?:fff)?)/i);
  }

  assert.match(rule(css, "input[type='checkbox']:checked::after"), /opacity: 1/);
  assert.match(rule(css, "input[type='checkbox']:indeterminate::after"), /background: var\(--checkbox-mark-colour\)/);
  assert.match(rule(css, "input[type='checkbox']:disabled"), /opacity: 0\.55/);
  assert.match(rule(css, '.highlight-group-toggle input[type="checkbox"]'), /width: 14px[\s\S]*height: 14px/);
});

test('Category and Descriptor dialog hierarchy is normalized without generic-dialog spillover', async () => {
  const css = await read('public/styles.css');

  const titles = css.match(
    /\.forced-modal:is\(\[data-modal-type='category'\], \[data-modal-type='descriptor'\]\) > h2\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(titles, /color: var\(--system-text-level-1\)/);
  assert.match(titles, /font-weight: 700/);
  assert.doesNotMatch(titles, /font-size:/);

  const grouped = css.match(
    /\.forced-modal\[data-modal-type='descriptor'\][\s\S]*?\.descriptor-browser-pane\.grouped \.descriptor-browser-heading h3\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(grouped, /color: var\(--system-text-level-1\)/);
  assert.match(grouped, /font-size: var\(--descriptor-grouped-heading-font-size\)/);
  assert.match(grouped, /font-weight: 700/);

  const helper = css.match(
    /\.forced-modal:is\(\[data-modal-type='category'\], \[data-modal-type='descriptor'\]\) \.muted,[\s\S]*?\.descriptor-input-helper:not\(\.error\)\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(helper, /color: var\(--system-text-level-3\)/);
  assert.match(helper, /font-size: var\(--descriptor-text-font-size\)/);

  const descriptorText = css.match(
    /\.forced-modal\[data-modal-type='descriptor'\] \.descriptor-chip > span:first-child,[\s\S]*?\.descriptor-input\s*\{[^}]*\}/
  )?.[0] || '';
  assert.match(descriptorText, /color: var\(--system-text-level-1\)/);
  assert.match(descriptorText, /font-size: var\(--descriptor-text-font-size\)/);
  assert.match(rule(css, ".forced-modal[data-modal-type='descriptor'] .descriptor-class-editor h4"), /color: var\(--system-text-level-2\)[\s\S]*font-weight: 700/);
  assert.match(rule(css, '.descriptor-input-helper.error'), /color: #a33a3a/);
});
