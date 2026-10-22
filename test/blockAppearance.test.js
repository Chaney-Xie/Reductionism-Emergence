const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const appearance = require('../public/appearanceSettings');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'g'))].at(-1)?.[0] || '';
}

test('Block Appearance defaults use the Test Vault monochrome baseline and normalize values per Vault', () => {
  const migrated = appearance.normalizeAppearanceSettings(null);
  assert.equal(migrated.blockAppearance.colourful, false);
  assert.equal(migrated.blockAppearance.monochrome.colour, '#6785A3');
  assert.equal(migrated.blockAppearance.monochrome.opacity.status1, 0);
  assert.equal(migrated.blockAppearance.monochrome.borderWidth, 2);

  const settings = appearance.normalizeAppearanceSettings({
    blockAppearance: {
      colourful: false,
      monochrome: {
        colour: '#12abef',
        opacity: { status1: 0.1, status2: 0.4, status3: 0.9 },
        borderWidth: 3.5
      }
    }
  });
  assert.deepEqual(settings.blockAppearance, {
    colourful: false,
    colourfulBlock: {
      presets: [],
      lastUsedColour: '#12ABEF'
    },
    monochrome: {
      colour: '#12ABEF',
      opacity: { status1: 0.1, status2: 0.4, status3: 0.9 },
      borderWidth: 3.5
    }
  });
  assert.equal(appearance.validateAppearanceSettings(settings).ok, true);
  assert.equal(appearance.validateAppearanceSettings({
    ...settings,
    blockAppearance: {
      ...settings.blockAppearance,
      monochrome: { ...settings.blockAppearance.monochrome, borderWidth: -1 }
    }
  }).ok, false);
  assert.equal(appearance.validateAppearanceSettings({
    ...settings,
    blockAppearance: {
      ...settings.blockAppearance,
      monochrome: {
        ...settings.blockAppearance.monochrome,
        opacity: { ...settings.blockAppearance.monochrome.opacity, status2: 1.1 }
      }
    }
  }).ok, false);
});

test('Block Appearance emits only Block-specific live variables and the colourful mode attribute', () => {
  const variables = new Map();
  const root = {
    dataset: {},
    style: { setProperty: (key, value) => variables.set(key, value) }
  };
  appearance.applyAppearanceSettings(root, {
    blockAppearance: {
      colourful: false,
      monochrome: {
        colour: '#345678',
        opacity: { status1: 0, status2: 0.28, status3: 0.62 },
        borderWidth: 4.25
      }
    }
  });
  assert.equal(root.dataset.blockColourful, 'false');
  assert.equal(variables.get('--block-border-width'), '4.25px');
  assert.equal(variables.get('--block-status-1-fill-colour'), 'rgb(52 86 120 / 0)');
  assert.equal(variables.get('--block-status-1-border-colour'), 'rgb(52 86 120 / 0)');
  assert.equal(variables.get('--block-status-2-fill-colour'), 'rgb(52 86 120 / 0.28)');
  assert.equal(variables.get('--block-status-2-border-colour'), 'rgb(52 86 120 / 0.84)');
  assert.equal(variables.get('--block-status-3-fill-colour'), 'rgb(52 86 120 / 0.62)');
  assert.equal(variables.get('--block-status-3-border-colour'), 'rgb(52 86 120 / 1)');
  assert.equal(variables.has('--block-status-1-opacity'), false);
});

test('Vault Appearance places complete monochrome Block controls between System Colour and Font', async () => {
  const [html, css, ui] = await Promise.all([
    read('public/index.html'), read('public/styles.css'), read('public/js/vaultSettings.js')
  ]);
  const appearanceMarkup = html.match(
    /<div id="vault-settings-appearance-panel"[\s\S]*?<div id="vault-settings-links-panel"/
  )?.[0] || '';
  assert.ok(appearanceMarkup.indexOf('System colour') < appearanceMarkup.indexOf('Block Colour'));
  assert.ok(appearanceMarkup.indexOf('Block Colour') < appearanceMarkup.indexOf('>Font<'));
  assert.match(appearanceMarkup, /id="block-colourful-switch"[\s\S]*?role="switch"/);
  assert.doesNotMatch(appearanceMarkup, /id="block-colourful-open"/);
  assert.equal((appearanceMarkup.match(/id="block-colourful-controls"/g) || []).length, 1);
  assert.equal((appearanceMarkup.match(/id="block-monochrome-controls"/g) || []).length, 1);
  assert.equal((appearanceMarkup.match(/id="block-shared-controls"/g) || []).length, 1);
  assert.ok(appearanceMarkup.indexOf('id="block-monochrome-controls"')
    < appearanceMarkup.indexOf('id="block-colourful-controls"'));
  assert.ok(appearanceMarkup.indexOf('id="block-colourful-controls"')
    < appearanceMarkup.indexOf('id="block-shared-controls"'));
  assert.equal((appearanceMarkup.match(/data-block-status-preview=/g) || []).length, 3);
  assert.equal((appearanceMarkup.match(/id="block-status-[123]-opacity"/g) || []).length, 3);
  assert.equal((appearanceMarkup.match(/id="block-status-[123]-opacity-value"/g) || []).length, 3);
  assert.match(appearanceMarkup, /Style 1[\s\S]*?Style 2[\s\S]*?Style 3/);
  assert.match(appearanceMarkup, /id="block-border-width"[\s\S]*?<span>px<\/span>/);
  assert.doesNotMatch(appearanceMarkup, /block-colourful-preview|data-block-colourful-preview|Block Preview/);
  assert.doesNotMatch(appearanceMarkup, /data-block-border-preset|vault-block-border-presets/);
  assert.match(css, /\.vault-block-colour-switch\s*\{[^}]*width: 34px;[^}]*height: 18px;[^}]*background: var\(--accent-colour\)/);
  assert.match(css, /\.vault-block-colour-switch\[aria-checked='true'\][\s\S]*?background: var\(--theme-colour\)/);
  assert.match(css, /\.vault-block-colour-switch-thumb\s*\{[^}]*background: var\(--surface-tool\)/);
  assert.match(css, /\.vault-block-opacity-control > input\[type='range'\][^}]*accent-color: var\(--theme-colour\)/);
  assert.match(ui, /blockColourfulControls\.hidden = !blockAppearance\.colourful/);
  assert.match(ui, /blockMonochromeControls\.hidden = blockAppearance\.colourful/);
  assert.match(ui, /renderBlockColourfulPreview\(settings\)[\s\S]*blockStatusOpacityControls/);
  assert.match(ui, /function updateBlockAppearance[\s\S]*?vaultAppearanceStore\.update/);
  assert.doesNotMatch(ui, /appearanceBlockSaveQueue|queueBlockAppearanceSave/);
});

test('monochrome CSS applies shared solid width with separate fill and stronger border alpha', async () => {
  const css = await read('public/styles.css');
  const monochromeGroup = css.match(
    /:root\[data-block-colourful='false'\] \.canvas-block-overlay\[data-state='1'\],[\s\S]*?\{[^}]*\}/
  )?.[0] || '';
  assert.match(monochromeGroup, /border-style: solid/);
  assert.match(monochromeGroup, /border-width: var\(--block-border-width\)/);
  assert.match(monochromeGroup, /box-shadow: none/);
  assert.doesNotMatch(monochromeGroup, /\bopacity\s*:/);
  for (const status of ['1', '2', '3']) {
    const rule = cssRule(
      css,
      `:root[data-block-colourful='false'] .canvas-block-overlay[data-state='${status}']`
    );
    assert.match(rule, new RegExp(`background-color: var\\(--block-status-${status}-fill-colour\\)`));
    assert.match(rule, new RegExp(`border-color: var\\(--block-status-${status}-border-colour\\)`));
    assert.doesNotMatch(rule, /\bopacity\s*:/);
    assert.doesNotMatch(rule, /pointer-events|visibility/);
  }
  const previewRule = cssRule(css, '.vault-block-status-preview');
  assert.match(previewRule, /box-sizing: border-box/);
  assert.match(previewRule, /height: 44px/);
  assert.doesNotMatch(previewRule, /\bopacity\s*:/);
  assert.doesNotMatch(css, /block-status-[123]-opacity/);
});

test('Block controls normalize typed values and reuse the existing colour picker with live rollback', async () => {
  const ui = await read('public/js/vaultSettings.js');
  assert.match(ui, /function normalizedBlockPercentage[\s\S]*?Math\.max\(0, Math\.min\(100, numeric\)\)/);
  assert.match(ui, /function normalizedBlockBorderWidth[\s\S]*?Number\.isFinite\(numeric\)[\s\S]*?Math\.max\(0, numeric\)/);
  assert.match(ui, /blockAppearance\.monochrome\.opacity\[status\] = percentage \/ 100/);
  assert.match(ui, /blockAppearance\.monochrome\.borderWidth = width/);
  assert.doesNotMatch(ui, /data-block-border-preset/);
  assert.match(ui, /blockMonochromeColour: 'Block colour'/);
  assert.match(ui, /setAppearanceColourValue\(previewSettings, state\.colourKey, state\.hex\)[\s\S]*?applyAppearanceSettings\(document\.documentElement, previewSettings\)/);
  assert.match(ui, /if \(state\.restoreOnClose\)[\s\S]*?applyAppearanceSettings\(document\.documentElement, appearanceSettings\)/);
  assert.doesNotMatch(ui, /currentPage\.(?:blocks|objects)\s*=|renderCanvas\(/);
});
