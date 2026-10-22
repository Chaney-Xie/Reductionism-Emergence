const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Colourful Block has one inline palette and one shared Style owner', async () => {
  const [html, css, ui] = await Promise.all([
    read('public/index.html'), read('public/styles.css'), read('public/js/vaultSettings.js')
  ]);
  const appearance = html.match(
    /<div id="vault-settings-appearance-panel"[\s\S]*?<div id="vault-settings-links-panel"/
  )?.[0] || '';
  assert.match(appearance, /id="block-colourful-switch"[\s\S]*role="switch"/);
  assert.doesNotMatch(appearance, /id="block-colourful-open"|>\s*Open\s*<\/button>/);
  assert.equal((html.match(/id="block-colourful-controls"/g) || []).length, 1);
  assert.equal((appearance.match(/id="block-colourful-controls"/g) || []).length, 1);
  assert.equal((appearance.match(/id="block-monochrome-controls"/g) || []).length, 1);
  assert.equal((appearance.match(/id="block-shared-controls"/g) || []).length, 1);
  assert.equal((appearance.match(/id="block-colour-presets"/g) || []).length, 1);
  assert.ok(appearance.indexOf('id="block-monochrome-controls"')
    < appearance.indexOf('id="block-colourful-controls"'));
  assert.ok(appearance.indexOf('id="block-colourful-controls"')
    < appearance.indexOf('id="block-shared-controls"'));

  const colourfulStart = appearance.indexOf('id="block-colourful-controls"');
  const sharedStart = appearance.indexOf('id="block-shared-controls"');
  const colourful = appearance.slice(colourfulStart, sharedStart);
  const shared = appearance.slice(sharedStart);
  const headerStart = colourful.indexOf('class="vault-block-colourful-header-row"');
  const presetRowStart = colourful.indexOf('class="vault-block-colourful-selection"');
  const header = colourful.slice(headerStart, presetRowStart);
  const presetRow = colourful.slice(presetRowStart);
  assert.ok(headerStart >= 0 && presetRowStart > headerStart);
  assert.match(colourful, />Preset Colour</);
  assert.match(colourful, /vault-block-rainbow-circle[\s\S]*>New Colour</);
  assert.match(colourful, /id="block-colour-presets"[^>]*role="list"/);
  assert.match(header, /vault-block-colourful-title[^>]*>Preset Colour</);
  assert.match(header, /id="block-colour-new"[\s\S]*vault-block-rainbow-circle[\s\S]*>New Colour</);
  assert.doesNotMatch(header, /id="block-colour-presets"/);
  assert.match(presetRow, /id="block-colour-presets"[^>]*role="list"/);
  assert.doesNotMatch(presetRow, /id="block-colour-new"|>New Colour</);
  assert.doesNotMatch(colourful, /Style [123]|Block Preview|block-border-width/);
  assert.equal((shared.match(/data-block-status-preview=/g) || []).length, 3);
  assert.equal((shared.match(/id="block-status-[123]-opacity"/g) || []).length, 3);
  assert.equal((shared.match(/id="block-status-[123]-opacity-value"/g) || []).length, 3);
  assert.equal((shared.match(/id="block-border-width"/g) || []).length, 1);
  assert.match(shared, /Style 1[\s\S]*Style 2[\s\S]*Style 3[\s\S]*Border Width/);

  assert.equal((html.match(/data-block-status-preview=/g) || []).length, 3);
  assert.doesNotMatch(html, /block-colourful-open|block-colourful-preview|data-block-colourful-preview|vault-block-colourful-style-labels|Block Preview/);
  assert.doesNotMatch(ui, /blockColourfulOpen|blockColourManagerState|openBlockColourManager|closeBlockColourManager|handleBlockColourManagerKeyDown/);
  assert.doesNotMatch(css, /block-colour-manager-(?:overlay|modal|body)/);
  const headerRule = css.match(/\.vault-block-colourful-header-row \{[^}]*\}/)?.[0] || '';
  assert.match(headerRule, /display: flex/);
  assert.match(headerRule, /align-items: center/);
  assert.match(headerRule, /justify-content: space-between/);
  assert.match(headerRule, /height: 1\.23rem/);
  assert.match(ui, /blockColourfulControls\.hidden = !blockAppearance\.colourful/);
  assert.match(ui, /blockMonochromeControls\.hidden = blockAppearance\.colourful/);
  assert.match(ui, /const blockSharedControls = document\.querySelector\('#block-shared-controls'\)/);
});

test('Colourful palette reuses the generalized picker and exposes Global Apply only for preset edits', async () => {
  const ui = await read('public/js/vaultSettings.js');
  assert.equal((ui.match(/function openAppearanceColourPicker\(/g) || []).length, 1);
  assert.match(ui, /function openNewBlockColourPicker[\s\S]*openAppearanceColourPicker\(\{[\s\S]*title: 'New Colour'[\s\S]*onSave: \(colour\) => addBlockColourPreset\(colour\)/);
  const newPicker = ui.match(/function openNewBlockColourPicker[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(newPicker, /globalApply/);
  assert.match(ui, /function addBlockColourPreset[\s\S]*blockAppearance\.colourfulBlock\.lastUsedColour = normalized/);
  assert.match(ui, /if \(!existing\)[\s\S]*presets\.push\(\{ id: presetId, colour: normalized \}\)/);
  assert.match(ui, /function openBlockColourPresetPicker[\s\S]*globalApply: true[\s\S]*editBlockColourPreset/);
  assert.match(ui, /const globalApplyRow = genericRequest\?\.globalApply \? document\.createElement\('label'\) : null/);
  assert.match(ui, /globalApplyText\.textContent = 'Global Apply'/);
});

test('the toggle swaps only the inline colour-selection row and resets transient Preview', async () => {
  const ui = await read('public/js/vaultSettings.js');
  const toggleStart = ui.indexOf("blockColourfulSwitch?.addEventListener('click'");
  const toggleEnd = ui.indexOf('\nfor (const [status, control]', toggleStart);
  const toggle = ui.slice(toggleStart, toggleEnd);
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart);
  assert.match(toggle, /const colourful = !appearanceSettings\.blockAppearance\.colourful/);
  assert.match(toggle, /blockAppearance\.colourful = colourful/);
  assert.match(toggle, /blockColourfulPreviewColour = null[\s\S]*updateBlockAppearance/);
  assert.doesNotMatch(toggle, /append|overlay|modal|Open/);
  assert.match(ui, /function openVaultSettings\(\)[\s\S]*resetBlockColourfulPreview\(appearanceSettings\)/);
  assert.match(ui, /function closeVaultSettings\(\)[\s\S]*resetBlockColourfulPreview\(appearanceSettings\)/);
  assert.match(ui, /function resetBlockColourfulPreview[\s\S]*blockColourfulPreviewColour = null[\s\S]*renderBlockColourfulPreview\(normalized\)/);
  assert.match(ui, /const deleted = await deleteBlockColourPreset\(presetId\)[\s\S]*\(nextPreset \|\| blockColourNew\)\?\.focus\?\.\(\)/);
});

test('the one generalized picker blocks and restores Vault Settings directly', async () => {
  const ui = await read('public/js/vaultSettings.js');
  assert.equal((ui.match(/function openAppearanceColourPicker\(/g) || []).length, 1);
  assert.match(ui, /const blockedParent = vaultSettingsModal/);
  assert.doesNotMatch(ui, /blockColourManagerState\?\.refs\.modal/);
  assert.match(ui, /appearanceColourState = \{[\s\S]*blockedParent,[\s\S]*refs:/);
  assert.match(ui, /blockedParent\?\.classList\.add\('is-nested-blocked'\)/);
  assert.match(ui, /state\.blockedParent\?\.classList\.remove\('is-nested-blocked'\)/);
  assert.match(ui, /state\.blockedParent\?\.removeAttribute\('aria-hidden'\)/);
  const picker = ui.match(
    /function openAppearanceColourPicker\(colourRequest\)[\s\S]*?\n\}\n\nfunction clearAppearanceInsertionClasses/
  )?.[0] || '';
  assert.ok(picker.indexOf('saturation.focus()')
    < picker.indexOf("blockedParent?.classList.add('is-nested-blocked')"));
  const closePicker = ui.match(
    /function closeAppearanceColourPicker\(\)[\s\S]*?\n\}/
  )?.[0] || '';
  assert.ok(closePicker.indexOf("state.blockedParent?.removeAttribute('aria-hidden')")
    < closePicker.indexOf('state.refs.overlay.remove()'));
  assert.ok(closePicker.indexOf('returnFocus?.focus?.()')
    < closePicker.indexOf('state.refs.overlay.remove()'));
});

test('one shared preview trio retains opacity and border ownership in both modes', async () => {
  const [html, ui, model] = await Promise.all([
    read('public/index.html'), read('public/js/vaultSettings.js'), read('public/appearanceSettings.js')
  ]);
  const previewStart = ui.indexOf('function resetBlockColourfulPreview');
  const previewEnd = ui.indexOf('\nfunction renderBlockColourPresets', previewStart);
  const renderStart = ui.indexOf('function renderBlockAppearanceControls');
  const renderEnd = ui.indexOf('\nfunction renderAppearanceColourRows', renderStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const previewSource = ui.slice(previewStart, previewEnd);
  const renderSource = ui.slice(renderStart, renderEnd);

  assert.match(previewSource, /blockSharedControls\.style\.setProperty/);
  assert.match(previewSource, /blockSharedControls\.style\.removeProperty/);
  assert.match(previewSource, /settings\.blockAppearance\.monochrome\.opacity/);
  assert.doesNotMatch(previewSource, /lastUsedColour|\.presets|currentPage|currentBlock/);
  assert.match(ui, /command === 'preview-colour'[\s\S]*blockColourfulPreviewColour = preset\.colour[\s\S]*renderBlockColourfulPreview/);
  assert.match(ui, /command === 'delete-colour'[\s\S]*deleteBlockColourPreset/);
  assert.match(ui, /blockAppearance\.colourfulBlock\.presets = blockAppearance\.colourfulBlock\.presets[\s\S]*\.filter/);
  assert.ok(html.indexOf('id="block-shared-controls"') > html.indexOf('id="block-colourful-controls"'));
  assert.match(model, /colourfulKeys\.some\(\(key\) => !\['presets', 'lastUsedColour'\]\.includes\(key\)\)/);
  assert.match(model, /Object\.keys\(preset\)\.some\(\(key\) => !\['id', 'colour'\]\.includes\(key\)\)/);
  assert.equal((html.match(/data-block-status-preview=/g) || []).length, 3);

  const appearanceModel = require('../public/appearanceSettings');
  const variables = new Map();
  const sharedOwner = {
    style: {
      setProperty: (name, value) => variables.set(name, value),
      removeProperty: (name) => variables.delete(name)
    }
  };
  const switchOwner = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const monochromeOwner = { hidden: false };
  const colourfulOwner = { hidden: true };
  const borderOwner = { value: '' };
  const opacityOwners = Object.fromEntries(['status1', 'status2', 'status3'].map((status) => [
    status, { slider: { value: '' }, input: { value: '' } }
  ]));
  let presetRenders = 0;
  const context = {
    appearanceSettingsModel: appearanceModel,
    blockColourfulPreviewColour: null,
    blockSharedControls: sharedOwner,
    blockColourfulSwitch: switchOwner,
    blockColourfulControls: colourfulOwner,
    blockMonochromeControls: monochromeOwner,
    blockStatusOpacityControls: opacityOwners,
    blockBorderWidth: borderOwner,
    renderBlockColourPresets: () => { presetRenders += 1; }
  };
  vm.runInNewContext(`${previewSource}\n${renderSource}`, context);
  const settings = appearanceModel.normalizeAppearanceSettings({
    blockAppearance: {
      colourful: false,
      colourfulBlock: {
        presets: [{ id: 'preset_coral', colour: '#D05B71' }],
        lastUsedColour: '#8E5FD2'
      },
      monochrome: {
        colour: '#345678',
        opacity: { status1: 0.12, status2: 0.48, status3: 0.82 },
        borderWidth: 3
      }
    }
  });
  context.renderBlockAppearanceControls(settings);
  assert.equal(switchOwner.attributes['aria-checked'], 'false');
  assert.equal(monochromeOwner.hidden, false);
  assert.equal(colourfulOwner.hidden, true);
  assert.equal(presetRenders, 0);
  assert.deepEqual(Object.values(opacityOwners).map(({ slider }) => slider.value), ['12', '48', '82']);
  assert.deepEqual(Object.values(opacityOwners).map(({ input }) => input.value), ['12', '48', '82']);
  assert.equal(borderOwner.value, '3');

  settings.blockAppearance.colourful = true;
  context.renderBlockAppearanceControls(settings);
  assert.equal(switchOwner.attributes['aria-checked'], 'true');
  assert.equal(monochromeOwner.hidden, true);
  assert.equal(colourfulOwner.hidden, false);
  assert.equal(presetRenders, 1);
  assert.equal(context.blockSharedControls, sharedOwner);
  assert.equal(context.blockStatusOpacityControls, opacityOwners);
  assert.equal(context.blockBorderWidth, borderOwner);
  assert.deepEqual(Object.values(opacityOwners).map(({ slider }) => slider.value), ['12', '48', '82']);
  assert.equal(borderOwner.value, '3');

  context.blockColourfulPreviewColour = '#D05B71';
  context.renderBlockColourfulPreview(settings);
  const expected = appearanceModel.blockStatusColourVariables(
    '#D05B71', settings.blockAppearance.monochrome.opacity
  );
  assert.deepEqual(Object.fromEntries(variables), expected);
  context.resetBlockColourfulPreview(settings);
  assert.equal(context.blockColourfulPreviewColour, null);
  assert.equal(variables.size, 0);
});

test('preset context menu targets the stable preset and previews through the shared owner', async () => {
  const [ui, native] = await Promise.all([
    read('public/js/vaultSettings.js'), read('desktop/nativeContextMenu.js')
  ]);
  assert.match(ui, /type: 'block-colour-preset',[\s\S]*targetId: presetId/);
  assert.match(ui, /const command = await window\.nativeContextMenu\.open[\s\S]*const preset = blockColourPreset\(settings, presetId\)/);
  assert.match(native, /commandItem\('Delete Colour', 'delete-colour', onCommand\)/);
  assert.match(native, /commandItem\('Preview', 'preview-colour', onCommand\)/);

  const start = ui.indexOf('async function handleBlockColourPresetContextMenu');
  const end = ui.indexOf('\nfunction updateAppearanceBrightness', start);
  assert.ok(start >= 0 && end > start);
  const settings = {
    blockAppearance: {
      colourfulBlock: { presets: [{ id: 'preset_blue', colour: '#4C78A8' }] },
      monochrome: { colour: '#345678', opacity: { status1: 0.12, status2: 0.48, status3: 0.82 } }
    }
  };
  const calls = [];
  const rendered = [];
  const runtime = { paneId: 'pane_colourful_preset_context' };
  const context = {
    activePaneRuntime: () => runtime,
    window: {
      nativeContextMenu: {
        available: () => true,
        open: async (event, request) => {
          calls.push({ event, request });
          return 'preview-colour';
        }
      }
    },
    appearanceSettings: settings,
    appearanceSettingsModel: { normalizeAppearanceSettings: (value) => value },
    blockColourPreset: (value, presetId) => value.blockAppearance.colourfulBlock.presets
      .find((preset) => preset.id === presetId),
    blockColourfulPreviewColour: null,
    renderBlockColourfulPreview: (value) => rendered.push(value),
    deleteBlockColourPreset: async () => true,
    blockColourPresets: null,
    blockColourNew: null,
    showRuntimeStatus: (ownerRuntime) => assert.strictEqual(ownerRuntime, runtime)
  };
  vm.runInNewContext(ui.slice(start, end), context);
  const event = { type: 'contextmenu' };
  await context.handleBlockColourPresetContextMenu(event, 'preset_blue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, event);
  assert.equal(JSON.stringify(calls[0].request), JSON.stringify({
    type: 'block-colour-preset', targetId: 'preset_blue'
  }));
  assert.equal(context.blockColourfulPreviewColour, '#4C78A8');
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0], settings);
});
