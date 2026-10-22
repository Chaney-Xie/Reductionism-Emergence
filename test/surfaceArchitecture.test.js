const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const appearance = require('../public/appearanceSettings');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('seven surface and border groups derive from validated vault Appearance values', () => {
  const settings = appearance.normalizeAppearanceSettings({
    toolSurfaceColour: '#F1F2F3',
    toolBorderColour: '#A1A2A3',
    guideSurfaceColour: '#E8E0D8',
    guideSectionBrightnessAdjustment: 0.05,
    guideBorderBrightnessAdjustment: 0.12,
    canvasSurfaceColour: '#FAFAF8',
    canvasBorderColour: '#777879'
  });
  const variables = appearance.cssVariablesForAppearance(settings);
  assert.equal(variables['--surface-tool'], '#F1F2F3');
  assert.equal(variables['--border-tool'], '#A1A2A3');
  assert.equal(variables['--surface-guide'], '#E8E0D8');
  assert.equal(variables['--surface-canvas'], '#FAFAF8');
  assert.equal(variables['--border-canvas'], '#777879');
  assert.notEqual(variables['--surface-guide-section'], variables['--surface-guide']);
  assert.notEqual(variables['--border-guide'], variables['--surface-guide-section']);
  const sectionChanged = appearance.cssVariablesForAppearance({
    ...settings,
    guideSectionBrightnessAdjustment: 0.2
  });
  assert.notEqual(sectionChanged['--surface-guide-section'], variables['--surface-guide-section']);
  assert.equal(sectionChanged['--border-guide'], variables['--border-guide']);
  const guideLineChanged = appearance.cssVariablesForAppearance({
    ...settings,
    guideBorderBrightnessAdjustment: 0.25
  });
  assert.equal(guideLineChanged['--surface-guide-section'], variables['--surface-guide-section']);
  assert.notEqual(guideLineChanged['--border-guide'], variables['--border-guide']);
  assert.equal(appearance.validateAppearanceSettings(settings).ok, true);
  assert.equal(appearance.validateAppearanceSettings({
    ...settings,
    guideBorderBrightnessAdjustment: 0.6
  }).ok, false);
});

test('Appearance exposes the five colour pickers and two Guide brightness controls above Accent and Theme', async () => {
  const [html, ui] = await Promise.all([
    read('public/index.html'),
    read('public/js/vaultSettings.js')
  ]);
  const labels = [
    'Colour', 'Tool area colour', 'Tool area border colour', 'Guide area colour',
    'Section brightness', 'Guide-line brightness', 'Canvas background colour',
    'Canvas border colour', 'Accent colour', 'Theme colour', 'Font'
  ];
  let prior = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > prior, `${label} must follow the previous Appearance control`);
    prior = index;
  }
  for (const key of [
    'toolSurfaceColour', 'toolBorderColour', 'guideSurfaceColour',
    'canvasSurfaceColour', 'canvasBorderColour', 'accentColour', 'themeColour'
  ]) {
    assert.match(html, new RegExp(`data-colour-select="${key}"`));
    assert.match(ui, new RegExp(`${key}:`));
  }
  assert.match(ui, /guideSectionBrightnessAdjustment/);
  assert.match(ui, /guideBorderBrightnessAdjustment/);
});

test('named live surfaces and boundaries consume only their central group variables', async () => {
  const [css, vocabulary] = await Promise.all([
    read('public/styles.css'),
    read('public/vocabulary.css')
  ]);
  assert.match(css, /\.app-topbar[\s\S]*?background: var\(--page-topbar-bg\)[\s\S]*?var\(--border-tool\)/);
  assert.match(css, /\.left-sidebar,[\s\S]*?background: var\(--surface-guide\)/);
  assert.match(css, /\.right-section-header,[\s\S]*?background-color: var\(--surface-guide-section\)/);
  assert.match(css, /\.nav-folder-pages,[\s\S]*?border-color: var\(--border-guide\)/);
  assert.match(css, /\.canvas-area[\s\S]*?background-color: var\(--surface-canvas\)/);
  assert.match(css, /\.left-create-toolbar,[\s\S]*?\.right-sidebar \{[\s\S]*?border-color: var\(--border-tool\)/);
  assert.match(css, /\/\* Colour group 3\.1: Canvas boundaries \*\/[\s\S]*?\.pane-page-toolbar \{[^}]*border-color: var\(--border-canvas\)/);
  assert.match(css, /\.vault-settings-content[\s\S]*?background: var\(--surface-tool\)/);
  assert.match(vocabulary, /\.vocab-topbar[\s\S]*?var\(--surface-tool\)[\s\S]*?var\(--border-tool\)/);
  assert.match(vocabulary, /\.vocab-entry\.has-aliases::before[\s\S]*?var\(--structure-line-colour\)/);
  assert.match(vocabulary, /--structure-line-colour: var\(--border-tool\)/);
});

test('corrected Tool, Guide, Canvas, and interaction mappings stay scoped', async () => {
  const [css, vocabulary] = await Promise.all([
    read('public/styles.css'),
    read('public/vocabulary.css')
  ]);
  assert.match(css, /\.descriptor-search-box \{[\s\S]*?background: var\(--sidebar-control-bg\)/);
  assert.match(css, /\.filter-panel \{[\s\S]*?background: var\(--sidebar-control-bg\)/);
  assert.match(css, /\.right-section-body \{[^}]*background: var\(--surface-guide\)/);
  assert.doesNotMatch(css, /right-sidebar-section\[data-right-section=['"](?:category|descriptor)['"]\] \.right-section-body\s*\{[^}]*surface-tool/);
  assert.match(css, /\.app-topbar::after \{[^}]*left: calc\(100% - var\(--active-right-sidebar-width\)\);[^}]*width: min\(1px, var\(--active-right-sidebar-width\)\);[^}]*background: var\(--border-tool\)/);
  assert.match(css, /\.descriptor-group-contents \{[^}]*border-left: 1px solid var\(--border-tool\)/);
  assert.match(css, /#guide-section-brightness,[\s\S]*?#guide-border-brightness \{[^}]*accent-color: var\(--theme-colour\)/);
  assert.match(css, /\.vault-settings-navigation \{[^}]*padding: 0\.8rem 0/);
  assert.match(css, /\.vault-settings-navigation-item \{[^}]*border-radius: 0/);
  assert.match(css, /\.vault-settings-navigation-item:hover,[\s\S]*?\.vault-settings-navigation-item\.is-selected \{[^}]*background: var\(--surface-guide-section\)/);
  assert.doesNotMatch(css, /\.vault-appearance-brightness-row > span:first-child \{[^}]*padding-left:/);
  assert.match(css, /\.vault-settings-item-text \{[^}]*font-size: var\(--vault-functional-label-font-size\)/);
  assert.match(css, /\.vault-folder-action \{[^}]*justify-self: end;[^}]*width: max-content/);
  assert.doesNotMatch(css, /\.vault-folder-action\.neutral-control\s*\{/);
  assert.doesNotMatch(css, /page-context-menu|descriptor-context-menu/);
  assert.match(vocabulary, /\.vocab-app \{[^}]*background: var\(--surface-canvas\)/);
});

test('outline and solid controls have one canonical visual source with compatibility aliases', async () => {
  const [actions, descriptor, vault, html, vocabulary] = await Promise.all([
    read('public/sharedControls.css'),
    read('public/js/descriptorModal.js'),
    read('public/js/vaultSettings.js'),
    read('public/index.html'),
    read('public/vocabulary.html')
  ]);
  assert.match(actions, /:is\(\s*\.ui-outline-action,[\s\S]*?font-family:[\s\S]*?font-size:/);
  assert.match(actions, /:is\(\.ui-solid-action, \.ui-primary-action\)[\s\S]*?var\(--theme-colour\)/);
  assert.match(descriptor, /cancelButton\.className = 'ui-outline-action ui-cancel-action'/);
  assert.match(descriptor, /ignoredButton\.className = 'descriptor-ignored-toggle ui-solid-action ui-primary-action'/);
  assert.match(descriptor, /saveButton\.className = 'ui-solid-action ui-primary-action'/);
  assert.match(vault, /appearance-manage-action ui-outline-action ui-cancel-action/);
  assert.match(vault, /appearance-manage-action appearance-manage-save ui-solid-action ui-primary-action/);
  assert.match(vault, /variant === 'cancel' \? 'ui-outline-action ui-cancel-action'/);
  assert.match(vault, /variant === 'theme' \? 'ui-solid-action ui-primary-action'/);
  assert.match(html, /data-appearance-manage="fileTypography">Manage/);
  assert.match(html, /class="ui-solid-action ui-primary-action"[^>]*data-appearance-manage/);
  assert.match(vocabulary, /vocab-action-button ui-solid-action ui-primary-action[^>]*>Create word/);
});
