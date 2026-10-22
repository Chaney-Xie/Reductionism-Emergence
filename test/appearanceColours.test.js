const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const appearance = require('../public/appearanceSettings');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('colour normalization, RGB/HEX/HSV synchronization, and contrast are deterministic', () => {
  assert.equal(appearance.normalizeHexColour(' a1b2c3 '), '#A1B2C3');
  assert.equal(appearance.normalizeHexColour('#ABCDEF'), '#ABCDEF');
  assert.equal(appearance.normalizeHexColour('#abcd'), '');
  assert.deepEqual(appearance.hexToRgb('#123456'), { r: 18, g: 52, b: 86 });
  assert.equal(appearance.rgbToHex(18, 52, 86), '#123456');
  assert.equal(appearance.rgbToHex(256, 0, 0), '');
  const hsv = appearance.rgbToHsv(44, 130, 201);
  const rgb = appearance.hsvToRgb(hsv.h, hsv.s, hsv.v);
  assert.deepEqual(rgb, { r: 44, g: 130, b: 201 });
  assert.equal(appearance.contrastColour('#111111'), '#FFFFFF');
  assert.equal(appearance.contrastColour('#F6F6F6'), '#1F2937');
});

test('invalid persisted colours fall back while explicit invalid saves are rejected', () => {
  const normalized = appearance.normalizeAppearanceSettings({
    accentColour: 'bad',
    themeColour: '#12345',
    fileTypography: { fontFamilies: ['system-ui'], fontSize: 14.4 },
    systemTypography: { fontFamilies: ['system-ui'] },
    pageTypography: { fontFamilies: ['system-ui'], fontSize: 16 }
  });
  assert.equal(normalized.accentColour, appearance.DEFAULT_APPEARANCE.accentColour);
  assert.equal(normalized.themeColour, appearance.DEFAULT_APPEARANCE.themeColour);
  assert.equal(appearance.validateAppearanceSettings({ ...normalized, accentColour: 'red' }).ok, false);
});

test('Appearance panel orders colour controls before Font with saved swatches', async () => {
  const html = await read('public/index.html');
  const appearance = html.match(
    /<div id="vault-settings-appearance-panel"[\s\S]*?<div id="vault-settings-links-panel"/
  )?.[0] || '';
  const accentIndex = appearance.indexOf('Accent colour');
  const themeIndex = appearance.indexOf('Theme colour');
  const dividerIndex = appearance.indexOf('vault-settings-section-divider');
  const fontIndex = appearance.indexOf('vault-settings-level-1-heading">Font');
  assert.ok(accentIndex >= 0 && accentIndex < themeIndex && themeIndex < dividerIndex && dividerIndex < fontIndex);
  assert.match(html, /id="accent-colour-swatch"/);
  assert.match(html, /id="theme-colour-swatch"/);
  assert.match(html, /data-colour-select="accentColour"/);
  assert.match(html, /data-colour-select="themeColour"/);
});

test('colour picker is draft-only, synchronized, and validates semantic opacity controls', async () => {
  const ui = await read('public/js/vaultSettings.js');
  assert.match(ui, /function openAppearanceColourPicker\(colourRequest\)/);
  assert.match(ui, /typeof colourRequest === 'string' \? colourRequest : null/);
  assert.match(ui, /Saturation and brightness/);
  assert.match(ui, /hue\.min = '0'[\s\S]*hue\.max = '360'/);
  assert.match(ui, /updateColourPickerFromHsv[\s\S]*rgbToHex/);
  assert.match(ui, /updateColourPickerFromRgb[\s\S]*RGB values must be integers from 0 to 255/);
  assert.match(ui, /updateColourPickerFromHex[\s\S]*six-digit HEX colour/);
  assert.match(ui, /appearanceColourState\.refs\.save\.disabled = Boolean\(message\)/);
  assert.match(ui, /setAppearanceColourValue\(next, state\.colourKey, state\.hex\)/);
  assert.match(ui, /Object\.assign\(next, state\.opacityDraft\)/);
  assert.match(ui, /Accent soft opacity/);
  assert.match(ui, /Accent strong opacity/);
  assert.match(ui, /Theme soft opacity/);
  assert.match(ui, /accentSoftOpacity >= state\.opacityDraft\.accentStrongOpacity/);
  assert.match(ui, /cancel\.addEventListener\('click', closeAppearanceColourPicker\)/);
  assert.match(ui, /close\.addEventListener\('click', closeAppearanceColourPicker\)/);
  assert.match(ui, /event\.target === overlay\) closeAppearanceColourPicker/);
  assert.match(ui, /event\.key === 'Escape'[\s\S]*closeAppearanceColourPicker/);
  assert.doesNotMatch(ui, /alpha|type = 'color'/i);
});

test('semantic colour variables style selection and primary actions without entering focus borders', async () => {
  const [css, actions] = await Promise.all([read('public/styles.css'), read('public/sharedControls.css')]);
  assert.match(css, /--accent-colour:/);
  assert.match(css, /--accent-soft:/);
  assert.match(css, /--accent-strong:/);
  assert.match(css, /--theme-colour:/);
  assert.match(css, /--theme-soft:/);
  assert.match(css, /\.page-link\.nav-selected,[\s\S]*background: var\(--surface-guide-section\)/);
  assert.match(css, /\.descriptor-global-chip\.selected,[\s\S]*var\(--accent-strong\)/);
  assert.match(actions, /:is\(\.ui-solid-action, \.ui-primary-action\)[\s\S]*background: var\(--theme-colour\)/);
  const focusRule = css.match(/:where\([\s\S]*?\):focus \{[\s\S]*?\}/)?.[0] || '';
  assert.match(focusRule, /box-shadow: inset 0 0 0 1px var\(--input-border-colour\)/);
  assert.doesNotMatch(focusRule, /accent-colour|theme-colour|orange/i);
  assert.match(css, /\.appearance-manage-error[\s\S]*color: #a33f3f/);
  assert.match(actions, /:is\(\.ui-outline-action, \.ui-cancel-action\)[\s\S]*background: var\(--control-surface\)/);
});

test('neutral input focus uses an inset normal-border ring without layout shift', async () => {
  const [css, vocabulary] = await Promise.all([read('public/styles.css'), read('public/vocabulary.css')]);
  assert.match(css, /--input-border-colour: var\(--control-border\)/);
  assert.match(css, /:focus \{[\s\S]*outline: 0;[\s\S]*box-shadow: inset/);
  assert.doesNotMatch(css.match(/:where\([\s\S]*?\):focus \{[\s\S]*?\}/)?.[0] || '', /border-width|border:\s*2px/);
  assert.match(vocabulary, /\.vocab-search:focus,[\s\S]*border-color: var\(--input-border-colour\);[\s\S]*box-shadow: inset/);
  assert.doesNotMatch(`${css}\n${vocabulary}`, /orange/i);
});
