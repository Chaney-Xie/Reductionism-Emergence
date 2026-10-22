const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const appearance = require('../public/appearanceSettings');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Accent and Theme opacity variants derive only from their matching base colours', () => {
  const base = appearance.cssVariablesForAppearance({
    accentColour: '#123456', accentSoftOpacity: 0.12, accentStrongOpacity: 0.31,
    themeColour: '#ABCDEF', themeSoftOpacity: 0.09
  });
  assert.equal(base['--accent-soft'], 'rgb(18 52 86 / 0.12)');
  assert.equal(base['--accent-strong'], 'rgb(18 52 86 / 0.31)');
  assert.equal(base['--theme-soft'], 'rgb(171 205 239 / 0.09)');

  const softChanged = appearance.cssVariablesForAppearance({
    accentColour: '#123456', accentSoftOpacity: 0.2, accentStrongOpacity: 0.31,
    themeColour: '#ABCDEF', themeSoftOpacity: 0.09
  });
  assert.notEqual(softChanged['--accent-soft'], base['--accent-soft']);
  assert.equal(softChanged['--accent-strong'], base['--accent-strong']);
  assert.equal(softChanged['--theme-soft'], base['--theme-soft']);

  assert.equal(appearance.validateAppearanceSettings({
    ...appearance.normalizeAppearanceSettings(null),
    accentSoftOpacity: 0.4,
    accentStrongOpacity: 0.4
  }).ok, false);
});

test('navigation uses Guide section interaction states and one structural guide colour', async () => {
  const css = await read('public/styles.css');
  assert.match(rule(css, '.page-link:hover'), /var\(--surface-guide-section\)/);
  assert.match(rule(css, '.page-link.active'), /var\(--surface-guide-section\)/);
  assert.match(css, /\.page-link\.nav-selected,[\s\S]*?background: var\(--surface-guide-section\)/);
  assert.match(rule(css, '.nav-folder.is-drop-target > .nav-folder-button'), /var\(--surface-guide-section\)/);
  assert.match(css, /\.navigation-dragging \.page-link\.nav-selected,[\s\S]*?outline: 0;[\s\S]*?box-shadow: none/);
  assert.match(rule(css, '.nav-folder-pages'), /border-left: 1px solid var\(--structure-line-colour\)/);
});

test('Descriptor tokens and global tree use their assigned semantic colours', async () => {
  const [css, ui] = await Promise.all([
    read('public/styles.css'),
    read('public/js/descriptorModal.js')
  ]);
  assert.match(rule(css, '.descriptor-chip'), /background: var\(--accent-soft\)/);
  assert.match(rule(css, '.descriptor-chip.auto'), /background: var\(--theme-soft\)/);
  assert.match(rule(css, '.descriptor-chip.manual-auto'), /background: var\(--accent-soft\)/);
  assert.match(rule(css, '.descriptor-chip.read-only.descriptor-global-chip'), /background: transparent/);
  assert.match(css, /\n\.descriptor-global-chip \{\s*cursor: pointer;\s*\}/);
  assert.doesNotMatch(css, /\n\.descriptor-global-chip \{\s*cursor: context-menu;\s*\}/);
  assert.match(rule(css, '.descriptor-global-chip:hover'), /var\(--accent-soft\)/);
  assert.match(css, /\.descriptor-global-chip\.selected,[\s\S]*?background: var\(--accent-strong\)/);
  assert.match(rule(css, '.descriptor-group-row:hover'), /var\(--accent-soft\)/);
  assert.match(css, /\.descriptor-group-row\.selected,[\s\S]*?var\(--accent-strong\)/);
  assert.match(rule(css, '.descriptor-group-contents'), /border-left: 1px solid var\(--border-tool\)/);
  assert.match(ui, /setDescriptorGroupMoving\(true\)/);
});

test('Dictionary inherits System typography and uses CSS hierarchy lines without pipe glyphs', async () => {
  const [html, css, ui] = await Promise.all([
    read('public/vocabulary.html'),
    read('public/vocabulary.css'),
    read('public/vocabulary.js')
  ]);
  assert.match(html, /body class="system-typography"/);
  assert.match(html, /appearanceSettings\.js/);
  assert.match(ui, /applyAppearanceSettings\?\.\(document\.documentElement/);
  assert.match(rule(css, 'body'), /font-family: var\(--font-system-family\)/);
  assert.match(rule(css, '.vocab-entry.is-highlighted'), /var\(--accent-soft\)/);
  assert.match(css, /\.vocab-entry\.is-highlighted > \.vocab-display-row,[\s\S]*?background: transparent/);
  assert.equal(rule(css, '.vocab-entry.is-highlighted:hover'), '');
  assert.equal(rule(css, '.vocab-entry:hover'), '');
  assert.match(css, /\.vocab-display-row:hover,[\s\S]*?\.vocab-alias-row:hover[\s\S]*?var\(--accent-strong\)/);
  assert.match(css, /\.vocab-index button:hover,[\s\S]*?var\(--accent-strong\)/);
  assert.doesNotMatch(css, /alias-context-menu/);
  assert.match(rule(css, '.vocab-entry.has-aliases::before'), /var\(--border-tool\)|var\(--structure-line-colour\)/);
  assert.doesNotMatch(ui, /textContent\s*=\s*['"]\|['"]/);
});

test('solid, outline, sidebar, and Relations roles remain distinct', async () => {
  const [css, actions, vocabulary] = await Promise.all([
    read('public/styles.css'),
    read('public/sharedControls.css'),
    read('public/vocabulary.css')
  ]);
  assert.match(actions, /:is\(\.ui-outline-action, \.ui-cancel-action\) \{[\s\S]*?border-color: var\(--control-border\);[\s\S]*?background: var\(--control-surface\)/);
  assert.match(actions, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):hover,[\s\S]*?background: var\(--control-surface-hover\)/);
  assert.match(actions, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):active,[\s\S]*?background: var\(--surface-guide-section\)/);
  assert.match(actions, /:is\(\.ui-solid-action, \.ui-primary-action\) \{[\s\S]*?background: var\(--theme-colour\)/);
  assert.doesNotMatch(css, /\.neutral-control\s*\{|\.vault-appearance-colour-row button\s*\{/);
  assert.doesNotMatch(vocabulary, /\.vocab-action-button \{[^}]*(?:font-size|font-weight|background|border):/);
  assert.match(actions, /\.ui-solid-action, \.ui-primary-action\):disabled[\s\S]*?var\(--theme-soft\)/);
  assert.match(css, /#left-sidebar-toggle\.is-active,[\s\S]*?background: transparent/);
  assert.match(css, /#left-sidebar-toggle:not\(:disabled\):hover,[\s\S]*?var\(--accent-strong\)/);
  assert.doesNotMatch(css, /\.sidebar-library-footer:hover/);
  assert.match(rule(css, '.sidebar-project-name:hover'), /var\(--accent-strong\)/);
  assert.match(css, /\.sidebar-library-button:hover,[\s\S]*?var\(--accent-strong\)/);
  assert.match(rule(css, '.relation-group-heading'), /background: transparent/);
  assert.match(css, /\.relation-group-heading:hover,[\s\S]*?background: transparent/);
  assert.match(css, /\.relation-button:hover,[\s\S]*?background: var\(--surface-guide-section\)/);
  assert.match(rule(css, '.vault-folder-name.is-unavailable'), /#ad3030/);
});

test('Appearance colour pickers expose atomic draft opacity controls', async () => {
  const ui = await read('public/js/vaultSettings.js');
  assert.match(ui, /accentSoftOpacity: currentSettings\.accentSoftOpacity/);
  assert.match(ui, /accentStrongOpacity: currentSettings\.accentStrongOpacity/);
  assert.match(ui, /themeSoftOpacity: currentSettings\.themeSoftOpacity/);
  assert.match(ui, /slider\.min = '0'/);
  assert.match(ui, /slider\.max = '100'/);
  assert.match(ui, /slider\.step = '1'/);
  assert.match(ui, /Accent soft opacity must be lower than Accent strong opacity/);
  assert.match(ui, /Object\.assign\(next, state\.opacityDraft\)/);
  assert.match(ui, /cancel\.addEventListener\('click', closeAppearanceColourPicker\)/);
});

test('Ignored shares the Theme action class from rest through pressed state', async () => {
  const [css, descriptorUi, vaultUi] = await Promise.all([
    read('public/sharedControls.css'),
    read('public/js/descriptorModal.js'),
    read('public/js/vaultSettings.js')
  ]);
  assert.match(descriptorUi, /addGroup\.className = 'descriptor-add-group-button ui-solid-action ui-primary-action'/);
  assert.match(descriptorUi, /ignoredButton\.className = 'descriptor-ignored-toggle ui-solid-action ui-primary-action'/);
  assert.match(descriptorUi, /saveButton\.className = 'ui-solid-action ui-primary-action'/);
  assert.doesNotMatch(descriptorUi, /descriptor-ignored-toggle[^'\n]*(?:ui-cancel-action|secondary|accent-action)/);
  assert.match(vaultUi, /add\.className = 'appearance-manage-action ui-solid-action ui-primary-action'/);

  const ignoredBase = rule(css, '.descriptor-ignored-toggle');
  assert.doesNotMatch(ignoredBase, /accent-|theme-colour/);
  assert.match(css, /:is\(\.ui-solid-action, \.ui-primary-action\) \{[\s\S]*?border-color: var\(--theme-colour\);[\s\S]*?color: var\(--theme-colour-contrast\);[\s\S]*?background: var\(--theme-colour\)/);
  assert.match(css, /\.ui-solid-action, \.ui-primary-action\):not\(:disabled\):hover,[\s\S]*?var\(--theme-colour-hover\)/);
  assert.match(css, /\.ui-solid-action, \.ui-primary-action\)\[aria-pressed='true'\]:not\(:disabled\)[\s\S]*?var\(--theme-colour-active\)/);

  const variables = appearance.cssVariablesForAppearance({ themeColour: '#547B69' });
  assert.equal(variables['--theme-colour-hover'], '#4C6F5F');
  assert.equal(variables['--theme-colour-active'], '#456556');
});
