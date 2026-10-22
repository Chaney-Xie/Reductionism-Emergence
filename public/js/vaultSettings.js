/* Vault Settings modal shell, including its narrow Control and Appearance persistence clients. */
const vaultSettingsButton = document.querySelector('#vault-settings-button');
const vaultSwitcherButton = document.querySelector('#sidebar-project-name');
const vaultSwitcherName = vaultSwitcherButton?.querySelector('.vault-switch-name');
const vaultSettingsOverlay = document.querySelector('#vault-settings-overlay');
const vaultSettingsModal = document.querySelector('#vault-settings-modal');
const vaultSettingsCloseButton = document.querySelector('#vault-settings-close');
const vaultSettingsVaultNav = document.querySelector('#vault-settings-vault-nav');
const vaultSettingsControlNav = document.querySelector('#vault-settings-control-nav');
const vaultSettingsAppearanceNav = document.querySelector('#vault-settings-appearance-nav');
const vaultSettingsLinksNav = document.querySelector('#vault-settings-links-nav');
const vaultSettingsCategoryNav = document.querySelector('#vault-settings-category-nav');
const vaultSettingsVaultPanel = document.querySelector('#vault-settings-vault-panel');
const vaultSettingsCurrentName = document.querySelector('#vault-settings-current-name');
const vaultSettingsRenameButton = document.querySelector('#vault-settings-rename');
const vaultSettingsResetButton = document.querySelector('#vault-settings-reset');
const vaultSettingsRebuildNavigationButton = document.querySelector(
  '#vault-settings-rebuild-navigation'
);
const vaultDefaultPageType = document.querySelector('#vault-default-page-type');
const preserveSingleLineBreaksSwitch = document.querySelector(
  '#preserve-single-line-breaks-switch'
);
const vaultSettingsControlPanel = document.querySelector('#vault-settings-control-panel');
const vaultSettingsAppearancePanel = document.querySelector('#vault-settings-appearance-panel');
const vaultSettingsLinksPanel = document.querySelector('#vault-settings-links-panel');
const vaultSettingsCategoryPanel = document.querySelector('#vault-settings-category-panel');
const zoomSensitivitySlider = document.querySelector('#zoom-sensitivity-slider');
const zoomSensitivityValue = document.querySelector('#zoom-sensitivity-value');
const vaultSettingsLinks = document.querySelector('#vault-settings-links');
const vaultSettingsCategoryGroups = document.querySelector('#vault-settings-category-groups');
const vaultSettingsCategoryActions = document.querySelector('#vault-settings-category-actions');
const vaultSettingsCategoryCollapse = document.querySelector('#vault-settings-category-collapse');
const vaultSettingsCategoryStatus = document.querySelector('#vault-settings-category-status');
const vaultNameOverlay = document.querySelector('#vault-name-overlay');
const vaultNameModal = document.querySelector('#vault-name-modal');
const vaultNameTitle = document.querySelector('#vault-name-title');
const vaultNameFieldLabel = document.querySelector('#vault-name-field-label');
const vaultNameInput = document.querySelector('#vault-name-input');
const vaultNameError = document.querySelector('#vault-name-error');
const vaultNameCancel = document.querySelector('#vault-name-cancel');
const vaultNameConfirm = document.querySelector('#vault-name-confirm');
const guideSectionBrightness = document.querySelector('#guide-section-brightness');
const guideSectionBrightnessValue = document.querySelector('#guide-section-brightness-value');
const guideBorderBrightness = document.querySelector('#guide-border-brightness');
const guideBorderBrightnessValue = document.querySelector('#guide-border-brightness-value');
const blockColourfulSwitch = document.querySelector('#block-colourful-switch');
const blockColourfulControls = document.querySelector('#block-colourful-controls');
const blockColourNew = document.querySelector('#block-colour-new');
const blockColourPresets = document.querySelector('#block-colour-presets');
const blockMonochromeControls = document.querySelector('#block-monochrome-controls');
const blockSharedControls = document.querySelector('#block-shared-controls');
const blockBorderWidth = document.querySelector('#block-border-width');
const markdownHeadingColourMode = document.querySelector('#markdown-heading-colour-mode');
const markdownHeadingUnifiedRows = document.querySelector('[data-markdown-heading-unified-rows]');
const markdownHeadingLevelRows = document.querySelector('[data-markdown-heading-level-rows]');
const blockStatusOpacityControls = Object.freeze({
  status1: Object.freeze({
    slider: document.querySelector('#block-status-1-opacity'),
    input: document.querySelector('#block-status-1-opacity-value')
  }),
  status2: Object.freeze({
    slider: document.querySelector('#block-status-2-opacity'),
    input: document.querySelector('#block-status-2-opacity-value')
  }),
  status3: Object.freeze({
    slider: document.querySelector('#block-status-3-opacity'),
    input: document.querySelector('#block-status-3-opacity-value')
  })
});

let vaultSettingsOpen = false;
let vaultFolderState = null;
let vaultFolderActionInProgress = false;
let vaultFolderError = '';
let vaultFolderRemovalMode = false;
let vaultCategoryRemovalMode = false;
let vaultCategoryActionInProgress = false;
let vaultCategoryError = '';
let vaultSettingsSection = 'vault';
let zoomSensitivitySaveQueue = Promise.resolve();
let zoomSensitivityEditVersion = 0;
let appearanceManageState = null;
let appearanceColourState = null;
let blockColourfulPreviewColour = null;
let quickColourPresentationDraft = null;
let vaultDiscovery = null;
let vaultNameState = null;
let vaultChangeInProgress = false;
const APPEARANCE_COLOUR_LABELS = Object.freeze({
  toolSurfaceColour: 'Tool area colour',
  toolBorderColour: 'Tool area border colour',
  guideSurfaceColour: 'Guide area colour',
  canvasSurfaceColour: 'Canvas background colour',
  canvasBorderColour: 'Canvas border colour',
  accentColour: 'Accent colour',
  themeColour: 'Theme colour',
  blockMonochromeColour: 'Block colour',
  'markdownColours.headings.unified': 'Unified heading colour',
  'markdownColours.headings.h1': 'H1 colour',
  'markdownColours.headings.h2': 'H2 colour',
  'markdownColours.headings.h3': 'H3 colour',
  'markdownColours.headings.h4': 'H4 colour',
  'markdownColours.headings.h5': 'H5 colour',
  'markdownColours.headings.h6': 'H6 colour',
  'markdownColours.text.bold': 'Bold text',
  'markdownColours.text.italic': 'Italic text',
  'markdownColours.text.boldItalic': 'Bold Italic text',
  'markdownColours.text.strikethroughText': 'Strikethrough text',
  'markdownColours.text.strikethroughLine': 'Strikethrough line',
  'markdownColours.text.underlineText': 'Underline text',
  'markdownColours.text.underlineLine': 'Underline line',
  'markdownColours.text.hyperlink': 'Hyperlink text',
  'markdownColours.code.background': 'Code background',
  'markdownColours.code.border': 'Code border',
  'markdownColours.symbols.group1': 'Symbol Group 1 colour',
  'markdownColours.symbols.group2': 'Symbol Group 2 colour'
});
const MARKDOWN_COLOUR_VARIABLES = Object.freeze({
  'markdownColours.headings.unified': Object.freeze({ variable: '--md-heading-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h1': Object.freeze({ variable: '--md-heading-h1-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h2': Object.freeze({ variable: '--md-heading-h2-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h3': Object.freeze({ variable: '--md-heading-h3-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h4': Object.freeze({ variable: '--md-heading-h4-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h5': Object.freeze({ variable: '--md-heading-h5-color', fallback: '--sidebar-control-text' }),
  'markdownColours.headings.h6': Object.freeze({ variable: '--md-heading-h6-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.bold': Object.freeze({ variable: '--md-bold-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.italic': Object.freeze({ variable: '--md-italic-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.boldItalic': Object.freeze({ variable: '--md-bold-italic-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.strikethroughText': Object.freeze({ variable: '--md-strike-text-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.strikethroughLine': Object.freeze({ variable: '--md-strike-line-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.underlineText': Object.freeze({ variable: '--md-underline-text-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.underlineLine': Object.freeze({ variable: '--md-underline-line-color', fallback: '--sidebar-control-text' }),
  'markdownColours.text.hyperlink': Object.freeze({ variable: '--md-link-color', fallback: '--sidebar-control-text' }),
  'markdownColours.code.background': Object.freeze({ variable: '--md-code-background', fallback: '--surface-guide' }),
  'markdownColours.code.border': Object.freeze({ variable: '--md-code-border', fallback: '--border-guide' }),
  'markdownColours.symbols.group1': Object.freeze({ variable: '--md-symbol-group-1', fallback: '--sidebar-control-muted' }),
  'markdownColours.symbols.group2': Object.freeze({ variable: '--md-symbol-group-2', fallback: '--sidebar-control-muted' })
});
const APPEARANCE_GROUPS = Object.freeze({
  fileTypography: Object.freeze({ label: 'File font' }),
  systemTypography: Object.freeze({ label: 'System font' }),
  pageTypography: Object.freeze({ label: 'Page font' })
});
const vaultFolderTooltip = folderWarningTooltip.createTooltip({
  documentRef: document,
  windowRef: window,
  container: vaultSettingsModal
});

function desktopFolderSettingsAvailable() {
  const bridge = window.cneDesktop;
  return bridge?.isDesktop === true
    && typeof bridge.getResourceFolders === 'function'
    && typeof bridge.selectDefaultFolder === 'function'
    && typeof bridge.addReadOnlyFolder === 'function'
    && typeof bridge.changeReadOnlyFolder === 'function'
    && typeof bridge.removeReadOnlyFolder === 'function'
    && typeof bridge.setDefaultFolder === 'function'
    && typeof bridge.relinkFolder === 'function';
}

function desktopControlSettingsAvailable() {
  const bridge = window.cneDesktop;
  return bridge?.isDesktop === true
    && typeof bridge.getControlSettings === 'function'
    && typeof bridge.setZoomSensitivity === 'function';
}

function appearanceFontEnumerationAvailable() {
  const bridge = window.cneDesktop;
  return bridge?.isDesktop === true && typeof bridge.listSystemFontFamilies === 'function';
}

function copyAppearanceGroup(groupKey) {
  const normalized = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  return {
    fontFamilies: [...normalized[groupKey].fontFamilies],
    ...(appearanceSettingsModel.SIZE_LIMITS[groupKey]
      ? { fontSize: normalized[groupKey].fontSize }
      : {})
  };
}

function isMarkdownColourKey(colourKey) {
  return Object.hasOwn(MARKDOWN_COLOUR_VARIABLES, colourKey);
}

function markdownColourPath(colourKey) {
  return isMarkdownColourKey(colourKey) ? colourKey.split('.') : null;
}

function appearanceColourValue(settings, colourKey) {
  if (colourKey === 'blockMonochromeColour') {
    return settings.blockAppearance.monochrome.colour;
  }
  const path = markdownColourPath(colourKey);
  if (path) return path.reduce((value, key) => value?.[key], settings) ?? null;
  return settings[colourKey];
}

function setAppearanceColourValue(settings, colourKey, value) {
  if (colourKey === 'blockMonochromeColour') {
    settings.blockAppearance.monochrome.colour = value;
    return;
  }
  const path = markdownColourPath(colourKey);
  if (path) {
    const finalKey = path.pop();
    let owner = settings;
    for (const key of path) {
      if (!owner[key] || typeof owner[key] !== 'object') owner[key] = {};
      owner = owner[key];
    }
    owner[finalKey] = value;
    return;
  }
  settings[colourKey] = value;
}

function appearanceColourCssValue(settings, colourKey) {
  const stored = appearanceColourValue(settings, colourKey);
  if (stored) return stored;
  const role = MARKDOWN_COLOUR_VARIABLES[colourKey];
  return role ? `var(${role.variable}, var(${role.fallback}))` : '';
}

function resolvedAppearanceColourHex(settings, colourKey) {
  const stored = appearanceColourValue(settings, colourKey);
  if (stored) return stored;
  const cssValue = appearanceColourCssValue(settings, colourKey);
  if (cssValue && document.body && typeof getComputedStyle === 'function') {
    const probe = document.createElement('span');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.color = cssValue;
    document.body.append(probe);
    const match = getComputedStyle(probe).color.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    probe.remove();
    if (match) {
      return appearanceSettingsModel.rgbToHex(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
      );
    }
  }
  if (colourKey === 'markdownColours.code.background') return settings.guideSurfaceColour;
  if (colourKey === 'markdownColours.code.border') {
    return appearanceSettingsModel.reduceHexBrightness(
      settings.guideSurfaceColour,
      settings.guideBorderBrightnessAdjustment
    );
  }
  return colourKey.startsWith('markdownColours.symbols.') ? '#6F7B8A' : '#364251';
}

function renderMarkdownAppearanceControls(settings) {
  const mode = settings.markdownColours?.headingMode === 'by-level' ? 'by-level' : 'unified';
  if (markdownHeadingColourMode) markdownHeadingColourMode.value = mode;
  if (markdownHeadingUnifiedRows) {
    markdownHeadingUnifiedRows.hidden = mode !== 'unified';
    markdownHeadingUnifiedRows.style.display = mode === 'unified' ? '' : 'none';
  }
  if (markdownHeadingLevelRows) {
    markdownHeadingLevelRows.hidden = mode !== 'by-level';
    markdownHeadingLevelRows.style.display = mode === 'by-level' ? '' : 'none';
  }
}

function resetBlockColourfulPreview(settings = appearanceSettings) {
  const normalized = appearanceSettingsModel.normalizeAppearanceSettings(settings);
  blockColourfulPreviewColour = null;
  renderBlockColourfulPreview(normalized);
}

function renderBlockColourfulPreview(settings) {
  if (!blockSharedControls) return;
  const colour = appearanceSettingsModel.normalizeHexColour(blockColourfulPreviewColour);
  const variables = colour
    ? appearanceSettingsModel.blockStatusColourVariables(
        colour,
        settings.blockAppearance.monochrome.opacity
      )
    : null;
  for (const status of ['1', '2', '3']) {
    for (const role of ['fill', 'border']) {
      const property = `--block-status-${status}-${role}-colour`;
      if (variables) blockSharedControls.style.setProperty(property, variables[property]);
      else blockSharedControls.style.removeProperty(property);
    }
  }
}

function renderBlockColourPresets(settings) {
  if (!blockColourPresets) return;
  const fragment = document.createDocumentFragment();
  for (const preset of settings.blockAppearance.colourfulBlock.presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vault-block-colour-preset';
    button.dataset.blockColourPresetId = preset.id;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-label', `Edit preset ${preset.colour}`);
    button.title = preset.colour;
    button.style.setProperty('--block-preset-colour', preset.colour);
    button.addEventListener('click', () => openBlockColourPresetPicker(preset.id, button));
    button.addEventListener('contextmenu', (event) => (
      handleBlockColourPresetContextMenu(event, preset.id)
    ));
    fragment.append(button);
  }
  blockColourPresets.replaceChildren(fragment);
}

function renderBlockAppearanceControls(settings) {
  const blockAppearance = settings.blockAppearance;
  if (blockColourfulSwitch) {
    blockColourfulSwitch.setAttribute('aria-checked', String(blockAppearance.colourful));
  }
  if (blockColourfulControls) blockColourfulControls.hidden = !blockAppearance.colourful;
  if (blockMonochromeControls) blockMonochromeControls.hidden = blockAppearance.colourful;
  if (blockAppearance.colourful) renderBlockColourPresets(settings);
  renderBlockColourfulPreview(settings);
  for (const [status, control] of Object.entries(blockStatusOpacityControls)) {
    const percentage = Math.round(blockAppearance.monochrome.opacity[status] * 10000) / 100;
    if (control.slider) control.slider.value = String(percentage);
    if (control.input) control.input.value = String(percentage);
  }
  if (blockBorderWidth) blockBorderWidth.value = String(blockAppearance.monochrome.borderWidth);
}

function renderAppearanceColourRows(sourceAppearance = appearanceSettings) {
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(sourceAppearance);
  for (const swatch of document.querySelectorAll?.('[data-colour-swatch]') || []) {
    swatch.style.backgroundColor = appearanceColourCssValue(settings, swatch.dataset.colourSwatch);
  }
  const renderBrightness = (input, output, value) => {
    if (!input || !output) return;
    const percentage = Math.round(value * 100);
    input.value = String(percentage);
    output.value = `${percentage}%`;
    output.textContent = `${percentage}%`;
  };
  renderBrightness(
    guideSectionBrightness,
    guideSectionBrightnessValue,
    settings.guideSectionBrightnessAdjustment
  );
  renderBrightness(
    guideBorderBrightness,
    guideBorderBrightnessValue,
    settings.guideBorderBrightnessAdjustment
  );
  renderBlockAppearanceControls(settings);
  renderMarkdownAppearanceControls(settings);
  try {
    globalThis.colourfulBlockCanvasRuntime?.refreshAppearance(settings.blockAppearance);
  } catch (error) {
    console.error('[appearance:colourful-block-canvas-refresh]', error);
  }
}

vaultAppearanceStore.subscribe((snapshot) => {
  appearanceSettings = snapshot;
  appearanceSettingsModel.applyAppearanceSettings(document.documentElement, snapshot);
  renderAppearanceColourRows(appearanceSettings);
});
globalThis.flushVaultAppearanceSavesNow = () => vaultAppearanceStore.flush();

async function updateMarkdownHeadingColourMode() {
  if (!markdownHeadingColourMode) return;
  const runtime = activePaneRuntime();
  const headingMode = markdownHeadingColourMode.value === 'by-level'
    ? 'by-level'
    : 'unified';
  markdownHeadingColourMode.disabled = true;
  try {
    await vaultAppearanceStore.update((draft) => {
      draft.markdownColours.headingMode = headingMode;
    }, { label: 'markdown-heading-colour-mode' });
  } catch (error) {
    showRuntimeStatus(runtime, error.message || 'Markdown heading colours could not be saved.', true);
  } finally {
    markdownHeadingColourMode.disabled = false;
  }
}

function updateBlockAppearance(mutator) {
  try {
    vaultAppearanceStore.update((draft) => {
      mutator(draft.blockAppearance);
    }, { label: 'block-appearance' })
      .catch((error) => console.error('[appearance:block]', error));
    return true;
  } catch (error) {
    renderAppearanceColourRows();
    return false;
  }
}

function normalizedBlockPercentage(value) {
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric));
}

function updateBlockStatusOpacity(status, value) {
  const percentage = normalizedBlockPercentage(value);
  if (percentage === null) {
    renderAppearanceColourRows();
    return false;
  }
  return updateBlockAppearance((blockAppearance) => {
    blockAppearance.monochrome.opacity[status] = percentage / 100;
  });
}

function normalizedBlockBorderWidth(value) {
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
}

function updateBlockBorderWidth(value) {
  const width = normalizedBlockBorderWidth(value);
  if (width === null) {
    renderAppearanceColourRows();
    return false;
  }
  return updateBlockAppearance((blockAppearance) => {
    blockAppearance.monochrome.borderWidth = width;
  });
}

function blockColourPreset(settings, presetId) {
  return settings.blockAppearance.colourfulBlock.presets
    .find((preset) => preset.id === presetId) || null;
}

function createBlockColourPresetId(settings) {
  const existing = new Set(
    settings.blockAppearance.colourfulBlock.presets.map((preset) => preset.id)
  );
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    const id = `preset_${token}`.slice(0, 64);
    if (!existing.has(id)) return id;
  }
  return `preset_${Date.now().toString(36)}_${existing.size}`.slice(0, 64);
}

async function persistBlockAppearance(mutator) {
  return vaultAppearanceStore.update((draft) => {
    mutator(draft.blockAppearance);
  }, { label: 'block-appearance' });
}

async function addBlockColourPreset(colour) {
  const normalized = appearanceSettingsModel.normalizeHexColour(colour);
  if (!normalized) throw new Error('Enter a six-digit HEX colour.');
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  const presetId = createBlockColourPresetId(settings);
  return persistBlockAppearance((blockAppearance) => {
    const presets = blockAppearance.colourfulBlock.presets;
    const existing = presets.some((preset) => preset.colour === normalized);
    if (!existing && presets.length
      >= appearanceSettingsModel.BLOCK_COLOUR_PRESET_LIMITS.maxPresets) {
      throw new Error('The Colourful Block palette is full.');
    }
    blockAppearance.colourfulBlock.lastUsedColour = normalized;
    if (!existing) {
      blockAppearance.colourfulBlock.presets.push({ id: presetId, colour: normalized });
    }
  });
}

function reconcileGlobalBlockColourResult(runtime, result) {
  if (result.pageIndex) pageIndex = result.pageIndex;
  for (const savedPage of result.pages || []) {
    commitCanonicalPage(savedPage, { originRuntime: runtime });
  }
}

async function editBlockColourPreset(runtime, presetId, expectedColour, colour, {
  globalApply = false
} = {}) {
  const normalized = appearanceSettingsModel.normalizeHexColour(colour);
  if (!normalized) throw new Error('Enter a six-digit HEX colour.');
  if (globalApply && livingPaneRuntimes().some((candidate) => (
    candidate.blockEditMode || candidate.pageEditMode
  ))) {
    throw new Error('Save or cancel Page and Block edits before using Global Apply.');
  }
  const operation = captureRuntimeOperation(runtime, {
    scope: 'block-colour-preset-edit'
  });
  const result = await vaultAppearanceStore.transaction(
    () => request(
      `/api/appearance/block-colour-presets/${encodeURIComponent(presetId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedColour, colour: normalized, globalApply })
      }
    ),
    {
      label: globalApply ? 'block-preset-global-apply' : 'block-preset-edit',
      selectAppearance: (response) => response.appearance
    }
  );
  const originRuntime = runtimeOperationIsCurrent(operation) ? runtime : null;
  reconcileGlobalBlockColourResult(originRuntime, result);
  return result;
}

function openNewBlockColourPicker() {
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  openAppearanceColourPicker({
    title: 'New Colour',
    initialColour: settings.blockAppearance.colourfulBlock.lastUsedColour,
    returnFocus: blockColourNew,
    onSave: (colour) => addBlockColourPreset(colour)
  });
}

function openBlockColourPresetPicker(presetId, source) {
  const runtime = activePaneRuntime();
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  const preset = blockColourPreset(settings, presetId);
  if (!preset) return;
  openAppearanceColourPicker({
    title: 'Edit Preset Colour',
    initialColour: preset.colour,
    globalApply: true,
    globalApplyDisabled: livingPaneRuntimes().some((candidate) => (
      candidate.blockEditMode || candidate.pageEditMode
    )),
    returnFocus: () => blockColourPresets?.querySelector?.(
      `[data-block-colour-preset-id="${presetId}"]`
    ) || source,
    onSave: (colour, options) => editBlockColourPreset(
      runtime,
      presetId,
      preset.colour,
      colour,
      options
    )
  });
}

async function deleteBlockColourPreset(presetId) {
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  if (!blockColourPreset(settings, presetId)) return false;
  await persistBlockAppearance((blockAppearance) => {
    blockAppearance.colourfulBlock.presets = blockAppearance.colourfulBlock.presets
      .filter((preset) => preset.id !== presetId);
  });
  return true;
}

async function handleBlockColourPresetContextMenu(event, presetId) {
  if (!window.nativeContextMenu?.available?.()) return;
  const runtime = activePaneRuntime();
  const command = await window.nativeContextMenu.open(event, {
    type: 'block-colour-preset',
    targetId: presetId
  });
  const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  const preset = blockColourPreset(settings, presetId);
  if (!preset) return;
  if (command === 'preview-colour') {
    blockColourfulPreviewColour = preset.colour;
    renderBlockColourfulPreview(settings);
    return;
  }
  if (command === 'delete-colour') {
    try {
      const deleted = await deleteBlockColourPreset(presetId);
      if (deleted) {
        const nextPreset = blockColourPresets?.querySelector?.('.vault-block-colour-preset');
        (nextPreset || blockColourNew)?.focus?.();
      }
    } catch (error) {
      showRuntimeStatus(runtime, error.message || 'The colour preset could not be deleted.', true);
    }
  }
}

function updateAppearanceBrightness(key, input, output) {
  if (!input || !output) return;
  const percentage = Number(input.value);
  output.value = `${percentage}%`;
  output.textContent = `${percentage}%`;
  try {
    vaultAppearanceStore.update((draft) => {
      draft[key] = percentage / 100;
    }, { label: `brightness:${key}` })
    .catch((error) => console.error('[appearance:guide-brightness]', error));
  } catch (error) {
    renderAppearanceColourRows();
  }
}

function setAppearanceColourError(message = '') {
  if (!appearanceColourState) return;
  appearanceColourState.valid = !message;
  appearanceColourState.refs.error.textContent = message;
  appearanceColourState.refs.save.disabled = Boolean(message) || appearanceColourState.saving;
  if (appearanceColourState.refs.useDefault) {
    appearanceColourState.refs.useDefault.disabled = appearanceColourState.saving;
  }
  if (appearanceColourState.refs.globalApply) {
    appearanceColourState.refs.globalApply.disabled = appearanceColourState.saving
      || appearanceColourState.globalApplyDisabled;
  }
}

function validateAppearanceColourOpacity() {
  const state = appearanceColourState;
  if (!state) return false;
  if (!state.colourValid) {
    setAppearanceColourError(state.colourError || 'Enter a valid colour.');
    return false;
  }
  const values = Object.values(state.opacityDraft);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    setAppearanceColourError('Opacity must be between 0% and 100%.');
    return false;
  }
  if (state.colourKey === 'accentColour'
    && state.opacityDraft.accentSoftOpacity >= state.opacityDraft.accentStrongOpacity) {
    setAppearanceColourError('Accent soft opacity must be lower than Accent strong opacity.');
    return false;
  }
  setAppearanceColourError();
  return true;
}

function updateColourPickerFromHsv() {
  const state = appearanceColourState;
  if (!state) return;
  const rgb = appearanceSettingsModel.hsvToRgb(state.h, state.s, state.v);
  state.hex = appearanceSettingsModel.rgbToHex(rgb.r, rgb.g, rgb.b);
  state.refs.red.value = String(rgb.r);
  state.refs.green.value = String(rgb.g);
  state.refs.blue.value = String(rgb.b);
  state.refs.hex.value = state.hex;
  state.refs.hue.value = String(Math.round(state.h));
  state.refs.saturation.style.setProperty('--picker-hue', `hsl(${state.h} 100% 50%)`);
  state.refs.indicator.style.left = `${state.s * 100}%`;
  state.refs.indicator.style.top = `${(1 - state.v) * 100}%`;
  state.refs.preview.style.backgroundColor = state.hex;
  state.colourValid = true;
  state.colourError = '';
  if (state.previewAppearance) {
    const previewSettings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
    setAppearanceColourValue(previewSettings, state.colourKey, state.hex);
    appearanceSettingsModel.applyAppearanceSettings(document.documentElement, previewSettings);
  }
  state.onDraft?.(state.hex);
  validateAppearanceColourOpacity();
}

function updateColourPickerFromHex(value, { updateFields = true } = {}) {
  const state = appearanceColourState;
  if (!state) return false;
  const canonical = appearanceSettingsModel.normalizeHexColour(value);
  if (!canonical) {
    state.colourValid = false;
    state.colourError = 'Enter a six-digit HEX colour.';
    setAppearanceColourError(state.colourError);
    return false;
  }
  const rgb = appearanceSettingsModel.hexToRgb(canonical);
  const hsv = appearanceSettingsModel.rgbToHsv(rgb.r, rgb.g, rgb.b);
  Object.assign(state, hsv, { hex: canonical });
  if (updateFields) updateColourPickerFromHsv();
  return true;
}

function updateColourPickerFromRgb() {
  const state = appearanceColourState;
  if (!state) return;
  const values = [state.refs.red, state.refs.green, state.refs.blue].map((input) => Number(input.value));
  if (values.some((value, index) => !/^\d+$/.test([
    state.refs.red.value, state.refs.green.value, state.refs.blue.value
  ][index]) || !Number.isInteger(value) || value < 0 || value > 255)) {
    state.colourValid = false;
    state.colourError = 'RGB values must be integers from 0 to 255.';
    setAppearanceColourError(state.colourError);
    return;
  }
  updateColourPickerFromHex(appearanceSettingsModel.rgbToHex(...values));
}

function setColourFromSaturationPointer(event) {
  const state = appearanceColourState;
  if (!state) return;
  const rect = state.refs.saturation.getBoundingClientRect();
  state.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  state.v = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
  updateColourPickerFromHsv();
}

function closeAppearanceColourPicker() {
  const force = arguments[0]?.force === true;
  const state = appearanceColourState;
  if (!state) return;
  if (!force && state.saving && state.lockCloseWhileSaving) return;
  document.removeEventListener('keydown', handleAppearanceColourKeyDown, true);
  state.pointerCleanup?.();
  if (state.restoreOnClose) {
    appearanceSettingsModel.applyAppearanceSettings(document.documentElement, appearanceSettings);
  }
  state.blockedParent?.classList.remove('is-nested-blocked');
  state.blockedParent?.removeAttribute('aria-hidden');
  appearanceColourState = null;
  const returnFocus = typeof state.returnFocus === 'function'
    ? state.returnFocus()
    : state.returnFocus;
  returnFocus?.focus?.();
  state.refs.overlay.remove();
}

async function saveAppearanceColour() {
  const state = appearanceColourState;
  if (!state || !state.valid || state.saving) return;
  state.saving = true;
  state.refs.save.disabled = true;
  if (state.refs.useDefault) state.refs.useDefault.disabled = true;
  if (state.refs.globalApply) state.refs.globalApply.disabled = true;
  if (state.onSave) {
    try {
      await state.onSave(state.hex, {
        globalApply: state.refs.globalApply?.checked === true
      });
      state.restoreOnClose = false;
      closeAppearanceColourPicker({ force: true });
    } catch (error) {
      state.saving = false;
      setAppearanceColourError(error.message || 'The colour could not be saved.');
    }
    return;
  }
  const next = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  setAppearanceColourValue(next, state.colourKey, state.hex);
  Object.assign(next, state.opacityDraft);
  const validation = appearanceSettingsModel.validateAppearanceSettings(next);
  if (!validation.ok) {
    state.saving = false;
    setAppearanceColourError(validation.error);
    return;
  }
  const colourKey = state.colourKey;
  const colour = state.hex;
  const opacityDraft = { ...state.opacityDraft };
  try {
    await vaultAppearanceStore.update((draft) => {
      setAppearanceColourValue(draft, colourKey, colour);
      Object.assign(draft, opacityDraft);
    }, { label: `colour:${colourKey}` });
    state.restoreOnClose = false;
    closeAppearanceColourPicker();
  } catch (error) {
    state.saving = false;
    setAppearanceColourError(error.message || 'The colour could not be saved.');
  }
}

async function resetAppearanceColourToDefault() {
  const state = appearanceColourState;
  if (!state || !isMarkdownColourKey(state.colourKey) || state.saving) return;
  const next = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  setAppearanceColourValue(next, state.colourKey, null);
  const validation = appearanceSettingsModel.validateAppearanceSettings(next);
  if (!validation.ok) {
    setAppearanceColourError(validation.error);
    return;
  }
  state.saving = true;
  state.refs.save.disabled = true;
  state.refs.useDefault.disabled = true;
  const colourKey = state.colourKey;
  try {
    await vaultAppearanceStore.update((draft) => {
      setAppearanceColourValue(draft, colourKey, null);
    }, { label: `colour-default:${colourKey}` });
    state.restoreOnClose = false;
    closeAppearanceColourPicker();
  } catch (error) {
    state.saving = false;
    setAppearanceColourError(error.message || 'The default colour could not be restored.');
  }
}

function handleAppearanceColourKeyDown(event) {
  const state = appearanceColourState;
  if (!state) return;
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      event.target
    )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAppearanceColourPicker();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (document.activeElement === state.refs.useDefault) {
      resetAppearanceColourToDefault();
    } else if (state.valid) {
      saveAppearanceColour();
    }
    return;
  }
  if (event.key === 'Tab') {
    const focusable = [...state.refs.modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function openAppearanceColourPicker(colourRequest) {
  const genericRequest = colourRequest && typeof colourRequest === 'object'
    ? colourRequest : null;
  const colourKey = typeof colourRequest === 'string' ? colourRequest : null;
  const genericInitialColour = appearanceSettingsModel.normalizeHexColour(
    genericRequest?.initialColour
  );
  if ((!genericRequest && !APPEARANCE_COLOUR_LABELS[colourKey])
    || (genericRequest && (!genericInitialColour
      || typeof genericRequest.title !== 'string'
      || typeof genericRequest.onSave !== 'function'))
    || appearanceManageState || appearanceColourState) return;
  const label = genericRequest ? genericRequest.title.trim() : APPEARANCE_COLOUR_LABELS[colourKey];
  const currentSettings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  const current = genericRequest
    ? genericInitialColour
    : resolvedAppearanceColourHex(currentSettings, colourKey);
  const blockedParent = vaultSettingsModal;
  const initialRgb = appearanceSettingsModel.hexToRgb(current);
  const initialHsv = appearanceSettingsModel.rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b);
  const overlay = document.createElement('div');
  overlay.className = 'appearance-manage-overlay appearance-colour-overlay';
  const modal = document.createElement('section');
  modal.className = 'appearance-colour-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'appearance-colour-title');

  const header = document.createElement('header');
  header.className = 'appearance-manage-header';
  const title = document.createElement('h3');
  title.id = 'appearance-colour-title';
  title.textContent = label;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'appearance-manage-close';
  close.textContent = '×';
  close.setAttribute('aria-label', `Close ${label}`);
  header.append(title, close);

  const body = document.createElement('div');
  body.className = 'appearance-colour-body';
  const colourHeading = document.createElement('p');
  colourHeading.className = 'appearance-colour-section-label';
  colourHeading.textContent = 'Colour';
  const saturation = document.createElement('div');
  saturation.className = 'appearance-colour-saturation';
  saturation.tabIndex = 0;
  saturation.setAttribute('role', 'application');
  saturation.setAttribute('aria-label', 'Saturation and brightness');
  const indicator = document.createElement('span');
  indicator.className = 'appearance-colour-saturation-indicator';
  saturation.append(indicator);

  const hue = document.createElement('input');
  hue.type = 'range';
  hue.className = 'appearance-colour-hue';
  hue.min = '0';
  hue.max = '360';
  hue.step = '1';
  hue.setAttribute('aria-label', 'Hue');

  const values = document.createElement('div');
  values.className = 'appearance-colour-values';
  const makeField = (name, type = 'number') => {
    const labelElement = document.createElement('label');
    labelElement.textContent = name;
    const input = document.createElement('input');
    input.type = type;
    input.className = 'appearance-colour-value';
    if (type === 'number') {
      input.min = '0';
      input.max = '255';
      input.step = '1';
      input.inputMode = 'numeric';
    } else {
      input.maxLength = 7;
      input.spellcheck = false;
    }
    labelElement.append(input);
    values.append(labelElement);
    return input;
  };
  const red = makeField('R');
  const green = makeField('G');
  const blue = makeField('B');
  const hex = makeField('HEX', 'text');
  const previewRow = document.createElement('div');
  previewRow.className = 'appearance-colour-preview-row';
  const preview = document.createElement('span');
  preview.className = 'appearance-colour-preview';
  preview.setAttribute('aria-label', 'Draft colour');
  const error = document.createElement('p');
  error.className = 'appearance-manage-error';
  error.setAttribute('role', 'status');
  previewRow.append(preview, error);
  const globalApplyRow = genericRequest?.globalApply ? document.createElement('label') : null;
  const globalApply = globalApplyRow ? document.createElement('input') : null;
  if (globalApplyRow && globalApply) {
    globalApplyRow.className = 'appearance-colour-global-apply';
    globalApply.type = 'checkbox';
    globalApply.disabled = genericRequest.globalApplyDisabled === true;
    globalApply.setAttribute('aria-label', 'Global Apply');
    const globalApplyText = document.createElement('span');
    globalApplyText.textContent = 'Global Apply';
    globalApplyRow.append(globalApply, globalApplyText);
  }
  const opacityDraft = colourKey === 'accentColour'
    ? {
        accentSoftOpacity: currentSettings.accentSoftOpacity,
        accentStrongOpacity: currentSettings.accentStrongOpacity
      }
    : colourKey === 'themeColour'
      ? { themeSoftOpacity: currentSettings.themeSoftOpacity }
      : {};
  const opacityRows = document.createElement('div');
  opacityRows.className = 'appearance-colour-opacity-rows';
  const opacityControls = {};
  const addOpacityControl = (key, text) => {
    const row = document.createElement('label');
    row.className = 'appearance-colour-opacity-row';
    const name = document.createElement('span');
    name.textContent = text;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(opacityDraft[key] * 100));
    slider.setAttribute('aria-label', text);
    const output = document.createElement('output');
    output.value = `${slider.value}%`;
    output.textContent = `${slider.value}%`;
    row.append(name, slider, output);
    opacityRows.append(row);
    opacityControls[key] = { slider, output };
  };
  if (colourKey === 'accentColour') {
    addOpacityControl('accentSoftOpacity', 'Accent soft opacity');
    addOpacityControl('accentStrongOpacity', 'Accent strong opacity');
  } else if (colourKey === 'themeColour') {
    addOpacityControl('themeSoftOpacity', 'Theme soft opacity');
  }
  body.append(
    colourHeading,
    saturation,
    hue,
    values,
    previewRow,
    ...[globalApplyRow, opacityRows].filter(Boolean)
  );

  const footer = document.createElement('footer');
  footer.className = 'appearance-manage-footer';
  const useDefault = isMarkdownColourKey(colourKey) ? document.createElement('button') : null;
  if (useDefault) {
    useDefault.type = 'button';
    useDefault.className = 'appearance-manage-action ui-outline-action ui-cancel-action';
    useDefault.textContent = 'Use Default';
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'appearance-manage-action ui-outline-action ui-cancel-action';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'appearance-manage-action appearance-manage-save ui-solid-action ui-primary-action';
  save.textContent = 'Save';
  footer.append(...[useDefault, cancel, save].filter(Boolean));
  modal.append(header, body, footer);
  overlay.append(modal);

  appearanceColourState = {
    colourKey,
    onDraft: genericRequest?.onDraft || null,
    onSave: genericRequest?.onSave || null,
    returnFocus: genericRequest?.returnFocus
      || (() => document.querySelector?.(`[data-colour-select="${colourKey}"]`)),
    ...initialHsv,
    hex: current,
    valid: true,
    colourValid: true,
    colourError: '',
    saving: false,
    lockCloseWhileSaving: genericRequest?.lockCloseWhileSaving === true,
    pointerCleanup: null,
    previewAppearance: !genericRequest
      && (colourKey === 'blockMonochromeColour' || isMarkdownColourKey(colourKey)),
    restoreOnClose: !genericRequest
      && (colourKey === 'blockMonochromeColour' || isMarkdownColourKey(colourKey)),
    globalApplyDisabled: genericRequest?.globalApplyDisabled === true,
    blockedParent,
    opacityDraft,
    opacityControls,
    refs: {
      overlay, modal, saturation, indicator, hue, red, green, blue, hex, preview, error,
      save, useDefault, globalApply
    }
  };
  document.body.append(overlay);
  updateColourPickerFromHsv();

  for (const [key, control] of Object.entries(opacityControls)) {
    control.slider.addEventListener('input', () => {
      const percentage = Number(control.slider.value);
      appearanceColourState.opacityDraft[key] = percentage / 100;
      control.output.value = `${percentage}%`;
      control.output.textContent = `${percentage}%`;
      validateAppearanceColourOpacity();
    });
  }

  const beginSaturationDrag = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setColourFromSaturationPointer(event);
    const move = (moveEvent) => setColourFromSaturationPointer(moveEvent);
    const finish = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (appearanceColourState) appearanceColourState.pointerCleanup = null;
    };
    appearanceColourState.pointerCleanup = finish;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  };
  saturation.addEventListener('pointerdown', beginSaturationDrag);
  hue.addEventListener('input', () => {
    appearanceColourState.h = Number(hue.value) % 360;
    updateColourPickerFromHsv();
  });
  for (const input of [red, green, blue]) input.addEventListener('input', updateColourPickerFromRgb);
  hex.addEventListener('input', () => updateColourPickerFromHex(hex.value));
  close.addEventListener('click', closeAppearanceColourPicker);
  cancel.addEventListener('click', closeAppearanceColourPicker);
  useDefault?.addEventListener('click', resetAppearanceColourToDefault);
  save.addEventListener('click', saveAppearanceColour);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeAppearanceColourPicker();
  });
  modal.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.addEventListener('keydown', handleAppearanceColourKeyDown, true);
  saturation.focus();
  blockedParent?.classList.add('is-nested-blocked');
  blockedParent?.setAttribute('aria-hidden', 'true');
}

function clearAppearanceInsertionClasses() {
  for (const row of appearanceManageState?.refs.stack?.querySelectorAll?.('.appearance-font-stack-row') || []) {
    row.classList.remove('is-insert-before', 'is-insert-after');
  }
}

globalThis.blockColourPaletteController = (() => {
  function snapshot() {
    const settings = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
    const blockAppearance = settings.blockAppearance;
    const opacity = Object.freeze({ ...blockAppearance.monochrome.opacity });
    const presets = Object.freeze(blockAppearance.colourfulBlock.presets.map((preset) => (
      Object.freeze({ ...preset })
    )));
    return Object.freeze({
      colourful: blockAppearance.colourful,
      presets,
      lastUsedColour: quickColourPresentationDraft?.colour
        || blockAppearance.colourfulBlock.lastUsedColour,
      monochromeColour: blockAppearance.monochrome.colour,
      opacity,
      borderWidth: blockAppearance.monochrome.borderWidth
    });
  }

  async function persistQuickColour(value, { validateTarget = null } = {}) {
    const colour = appearanceSettingsModel.normalizeHexColour(value);
    if (!colour) {
      throw new Error('Enter a six-digit HEX colour.');
    }
    if (validateTarget && typeof validateTarget !== 'function') {
      throw new Error('The target Block could not be validated.');
    }
    const presentationDraft = Object.freeze({ colour });
    quickColourPresentationDraft = presentationDraft;
    try {
      await vaultAppearanceStore.flush();
      const target = validateTarget ? await validateTarget(colour) : true;
      if (!target) throw new Error('The target Block is no longer available.');
      await addBlockColourPreset(colour);
      return Object.freeze({
        colour,
        snapshot: snapshot(),
        target: target === true ? null : target
      });
    } finally {
      if (quickColourPresentationDraft === presentationDraft) {
        quickColourPresentationDraft = null;
      }
    }
  }

  function openQuickColourPicker({
    title = 'Quick Colour',
    initialColour = snapshot().lastUsedColour,
    returnFocus = null,
    validateTarget = null,
    onPersisted = null
  } = {}) {
    const colour = appearanceSettingsModel.normalizeHexColour(initialColour);
    const label = typeof title === 'string' ? title.trim() : '';
    if (!colour || !label || appearanceManageState || appearanceColourState
      || (validateTarget && typeof validateTarget !== 'function')
      || (onPersisted && typeof onPersisted !== 'function')) return false;

    openAppearanceColourPicker({
      title: label,
      initialColour: colour,
      returnFocus: returnFocus || (() => null),
      lockCloseWhileSaving: true,
      onSave: async (savedColour) => {
        const target = validateTarget ? await validateTarget(savedColour) : true;
        if (!target) throw new Error('The target Block is no longer available.');
        const result = await persistQuickColour(savedColour, { validateTarget });
        const currentTarget = validateTarget ? await validateTarget(savedColour) : target;
        if (!currentTarget) throw new Error('The target Block is no longer available.');
        onPersisted?.(result, currentTarget === true ? result.target : currentTarget);
      }
    });
    return appearanceColourState !== null;
  }

  return Object.freeze({
    snapshot,
    persistQuickColour,
    openQuickColourPicker
  });
})();

function appearanceFamilyIsAvailable(name) {
  if (appearanceSettingsModel.isGenericFamily(name)) return true;
  if (appearanceManageState?.enumerationStatus !== 'ready') return true;
  return appearanceManageState.availableMap.has(name.toLocaleLowerCase());
}

function setAppearanceManageError(message = '') {
  if (!appearanceManageState) return;
  appearanceManageState.error = message;
  appearanceManageState.refs.error.textContent = message;
}

function renderAppearanceFontStack() {
  const state = appearanceManageState;
  if (!state) return;
  const { stack } = state.refs;
  stack.replaceChildren();
  if (!state.draft.fontFamilies.length) {
    const empty = document.createElement('p');
    empty.className = 'appearance-font-stack-empty';
    empty.textContent = 'No preferred fonts. The safe application fallback will be used.';
    stack.append(empty);
    return;
  }

  state.draft.fontFamilies.forEach((name, index) => {
    const row = document.createElement('div');
    row.className = 'appearance-font-stack-row';
    row.draggable = true;
    row.dataset.fontIndex = String(index);

    const handle = document.createElement('span');
    handle.className = 'appearance-font-drag-handle';
    handle.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'appearance-font-name';
    label.textContent = name;
    if (!appearanceFamilyIsAvailable(name)) {
      const unavailable = document.createElement('span');
      unavailable.className = 'appearance-font-unavailable';
      unavailable.textContent = 'unavailable';
      label.append(unavailable);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'appearance-font-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.addEventListener('click', () => {
      state.draft.fontFamilies.splice(index, 1);
      setAppearanceManageError();
      renderAppearanceFontStack();
    });

    row.addEventListener('dragstart', (event) => {
      state.dragIndex = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', name);
    });
    row.addEventListener('dragover', (event) => {
      if (!Number.isInteger(state.dragIndex)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearAppearanceInsertionClasses();
      const rect = row.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      state.insertionIndex = index + (after ? 1 : 0);
      row.classList.add(after ? 'is-insert-after' : 'is-insert-before');
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      if (Number.isInteger(state.dragIndex) && Number.isInteger(state.insertionIndex)) {
        state.draft.fontFamilies = appearanceSettingsModel.reorderFontFamilies(
          state.draft.fontFamilies,
          state.dragIndex,
          state.insertionIndex
        );
      }
      state.dragIndex = null;
      state.insertionIndex = null;
      renderAppearanceFontStack();
    });
    row.addEventListener('dragend', () => {
      state.dragIndex = null;
      state.insertionIndex = null;
      clearAppearanceInsertionClasses();
    });
    row.append(handle, label, remove);
    stack.append(row);
  });
}

function closeAppearanceResults() {
  if (!appearanceManageState) return;
  const state = appearanceManageState;
  state.listOpen = false;
  state.activeResultIndex = -1;
  state.refs.results.hidden = true;
  state.refs.input.setAttribute('aria-expanded', 'false');
  state.refs.input.removeAttribute('aria-activedescendant');
}

function appearancePreviewFamily(name) {
  const escaped = String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}", var(--font-system-family), sans-serif`;
}

function positionAppearanceFontResults() {
  const state = appearanceManageState;
  if (!state || !state.listOpen || state.refs.results.hidden) return;
  const rect = state.refs.input.getBoundingClientRect();
  const viewportPadding = 8;
  const preferredHeight = Math.min(280, Math.max(160, window.innerHeight * 0.38));
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
  const roomAbove = rect.top - viewportPadding;
  const placeAbove = roomBelow < 180 && roomAbove > roomBelow;
  const availableHeight = Math.max(96, Math.min(preferredHeight, placeAbove ? roomAbove - 6 : roomBelow - 6));
  const width = Math.min(
    Math.max(160, rect.width / 2),
    window.innerWidth - viewportPadding * 2
  );
  const left = Math.max(
    viewportPadding,
    Math.min(rect.right - width, window.innerWidth - width - viewportPadding)
  );
  const top = placeAbove
    ? Math.max(viewportPadding, rect.top - availableHeight - 4)
    : Math.min(window.innerHeight - viewportPadding, rect.bottom + 4);
  Object.assign(state.refs.results.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.min(width, window.innerWidth - viewportPadding * 2)}px`,
    maxHeight: `${availableHeight}px`
  });
}

function selectAppearanceFontResult(index) {
  const state = appearanceManageState;
  const name = state?.filteredFonts?.[index];
  if (!state || !name) return;
  state.selectedFont = name;
  state.refs.input.value = name;
  state.refs.add.disabled = false;
  closeAppearanceResults();
  state.refs.input.focus();
  setAppearanceManageError();
}

function renderAppearanceFontResults({ open = true } = {}) {
  const state = appearanceManageState;
  if (!state) return;
  if (open) state.listOpen = true;
  if (!state.listOpen) return;
  const queryText = state.refs.input.value.trim().toLocaleLowerCase();
  const matches = state.availableFonts.filter((name) => (
    !queryText || name.toLocaleLowerCase().includes(queryText)
  ));
  state.filteredFonts = matches;
  if (state.activeResultIndex >= matches.length) state.activeResultIndex = matches.length - 1;
  state.refs.results.replaceChildren();
  for (const [index, name] of matches.entries()) {
    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'appearance-font-result';
    result.id = `appearance-font-result-${index}`;
    result.setAttribute('role', 'option');
    result.setAttribute('aria-selected', String(index === state.activeResultIndex));
    result.classList.toggle('is-active', index === state.activeResultIndex);
    result.style.fontFamily = appearancePreviewFamily(name);
    result.textContent = name;
    result.addEventListener('pointerdown', (event) => event.preventDefault());
    result.addEventListener('click', () => selectAppearanceFontResult(index));
    state.refs.results.append(result);
  }
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'appearance-font-results-empty';
    empty.textContent = state.enumerationStatus === 'loading' ? 'Loading installed fonts…' : 'No matching fonts';
    state.refs.results.append(empty);
  }
  state.refs.results.hidden = false;
  state.refs.input.setAttribute('aria-expanded', 'true');
  if (state.activeResultIndex >= 0) {
    state.refs.input.setAttribute('aria-activedescendant', `appearance-font-result-${state.activeResultIndex}`);
    state.refs.results.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  } else {
    state.refs.input.removeAttribute('aria-activedescendant');
  }
  requestAnimationFrame(positionAppearanceFontResults);
}

function addAppearanceFont() {
  const state = appearanceManageState;
  if (!state) return;
  const selectedName = state.selectedFont;
  if (!selectedName || state.refs.input.value !== selectedName) {
    state.selectedFont = null;
    state.refs.add.disabled = true;
    setAppearanceManageError('Select an installed font from the list.');
    return;
  }
  if (state.draft.fontFamilies.some((name) => name.localeCompare(selectedName, undefined, {
    sensitivity: 'base'
  }) === 0)) {
    setAppearanceManageError('That font is already in this stack.');
    return;
  }
  state.draft.fontFamilies.push(selectedName);
  state.selectedFont = null;
  state.refs.input.value = '';
  state.refs.add.disabled = true;
  closeAppearanceResults();
  setAppearanceManageError();
  renderAppearanceFontStack();
}

function closeAppearanceManager() {
  const state = appearanceManageState;
  if (!state) return;
  document.removeEventListener('keydown', handleAppearanceManageKeyDown, true);
  document.removeEventListener('pointerdown', handleAppearanceManagePointerDown, true);
  window.removeEventListener('resize', positionAppearanceFontResults);
  document.removeEventListener('scroll', positionAppearanceFontResults, true);
  state.refs.results.remove();
  state.refs.overlay.remove();
  vaultSettingsModal?.classList.remove('is-nested-blocked');
  vaultSettingsModal?.removeAttribute('aria-hidden');
  appearanceManageState = null;
  document.querySelector?.(`[data-appearance-manage="${state.groupKey}"]`)?.focus();
}

function handleAppearanceManagePointerDown(event) {
  const state = appearanceManageState;
  if (!state?.listOpen) return;
  if (event.target === state.refs.input || state.refs.results.contains(event.target)) return;
  closeAppearanceResults();
}

async function saveAppearanceManager() {
  const state = appearanceManageState;
  if (!state || state.saving) return;
  state.saving = true;
  state.refs.save.disabled = true;
  setAppearanceManageError();
  const next = appearanceSettingsModel.normalizeAppearanceSettings(appearanceSettings);
  next[state.groupKey] = {
    fontFamilies: [...state.draft.fontFamilies],
    ...(appearanceSettingsModel.SIZE_LIMITS[state.groupKey]
      ? { fontSize: Number(state.draft.fontSize) }
      : {})
  };
  const validation = appearanceSettingsModel.validateAppearanceSettings(next);
  if (!validation.ok) {
    state.saving = false;
    state.refs.save.disabled = false;
    setAppearanceManageError(validation.error);
    return;
  }
  const groupKey = state.groupKey;
  const groupDraft = {
    fontFamilies: [...state.draft.fontFamilies],
    ...(appearanceSettingsModel.SIZE_LIMITS[state.groupKey]
      ? { fontSize: Number(state.draft.fontSize) }
      : {})
  };
  try {
    await vaultAppearanceStore.update((draft) => {
      draft[groupKey] = groupDraft;
    }, { label: `typography:${groupKey}` });
    closeAppearanceManager();
  } catch (error) {
    state.saving = false;
    state.refs.save.disabled = false;
    setAppearanceManageError(error.message || 'Appearance settings could not be saved.');
  }
}

function handleAppearanceManageKeyDown(event) {
  const state = appearanceManageState;
  if (!state) return;
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      event.target
    )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  event.stopPropagation();
  event.stopImmediatePropagation();
  const inCombobox = event.target === state.refs.input;
  if (inCombobox && state.listOpen) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const lastIndex = state.filteredFonts.length - 1;
      state.activeResultIndex = lastIndex < 0
        ? -1
        : Math.max(0, Math.min(lastIndex, state.activeResultIndex < 0
          ? (direction > 0 ? 0 : lastIndex)
          : state.activeResultIndex + direction));
      renderAppearanceFontResults({ open: false });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (state.activeResultIndex >= 0) selectAppearanceFontResult(state.activeResultIndex);
      return;
    }
    if (event.key === 'Tab') closeAppearanceResults();
  }
  if (state.listOpen && event.key === 'Escape') {
    event.preventDefault();
    closeAppearanceResults();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAppearanceManager();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    saveAppearanceManager();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = [...appearanceManageState.refs.modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

async function loadAvailableAppearanceFonts(state) {
  if (!appearanceFontEnumerationAvailable()) {
    state.enumerationStatus = 'unavailable';
    return;
  }
  try {
    const response = await window.cneDesktop.listSystemFontFamilies();
    if (!appearanceManageState || appearanceManageState !== state) return;
    if (!response?.ok || !Array.isArray(response.fontFamilies)) throw new Error();
    const seen = new Set();
    state.availableFonts = response.fontFamilies
      .map((name) => typeof name === 'string' ? appearanceSettingsModel.cleanFamilyName(name) : '')
      .filter((name) => {
        if (!name || name.startsWith('.') || /[\u0000-\u001f\u007f]/.test(name)) return false;
        const key = name.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: 'base'
      }));
    state.availableMap = new Map(state.availableFonts.map((name) => [name.toLocaleLowerCase(), name]));
    state.enumerationStatus = state.availableFonts.length ? 'ready' : 'unavailable';
    renderAppearanceFontStack();
    if (state.listOpen) renderAppearanceFontResults({ open: false });
  } catch {
    if (appearanceManageState === state) state.enumerationStatus = 'unavailable';
  }
}

function openAppearanceManager(groupKey) {
  const group = APPEARANCE_GROUPS[groupKey];
  if (!group || appearanceManageState || appearanceColourState) return;
  const overlay = document.createElement('div');
  overlay.className = 'appearance-manage-overlay';

  const modal = document.createElement('section');
  modal.className = 'appearance-manage-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'appearance-manage-title');

  const header = document.createElement('header');
  header.className = 'appearance-manage-header';
  const title = document.createElement('h3');
  title.id = 'appearance-manage-title';
  title.textContent = `Manage ${group.label}`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'appearance-manage-close';
  close.textContent = '×';
  close.setAttribute('aria-label', `Close Manage ${group.label}`);
  header.append(title, close);

  const body = document.createElement('div');
  body.className = 'appearance-manage-body';
  const stack = document.createElement('div');
  stack.className = 'appearance-font-stack';
  stack.setAttribute('aria-label', 'Current font priority');

  const addRow = document.createElement('div');
  addRow.className = 'appearance-font-add';
  const inputLabel = document.createElement('label');
  inputLabel.setAttribute('for', 'appearance-font-input');
  inputLabel.textContent = 'Font name:';
  const input = document.createElement('input');
  input.id = 'appearance-font-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'appearance-font-results');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'appearance-manage-action ui-solid-action ui-primary-action';
  add.textContent = 'Add';
  add.disabled = true;
  const results = document.createElement('div');
  results.id = 'appearance-font-results';
  results.className = 'appearance-font-results';
  results.setAttribute('role', 'listbox');
  results.hidden = true;
  addRow.append(inputLabel, input, add);
  body.append(stack, addRow);

  const sizeLimits = appearanceSettingsModel.SIZE_LIMITS[groupKey];
  let sizeValue = null;
  let sizeSlider = null;
  if (sizeLimits) {
    const sizeRow = document.createElement('label');
    sizeRow.className = 'appearance-font-size-row';
    sizeRow.append(document.createTextNode('Font size:'));
    sizeValue = document.createElement('output');
    sizeValue.className = 'appearance-font-size-value';
    sizeRow.append(sizeValue, document.createTextNode('px'));
    sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = String(sizeLimits.min);
    sizeSlider.max = String(sizeLimits.max);
    sizeSlider.step = String(sizeLimits.step);
    sizeSlider.setAttribute('aria-label', `${group.label} size`);
    sizeRow.append(sizeSlider);
    body.append(sizeRow);
  }

  const error = document.createElement('p');
  error.className = 'appearance-manage-error';
  error.setAttribute('role', 'status');
  body.append(error);

  const footer = document.createElement('footer');
  footer.className = 'appearance-manage-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'appearance-manage-action ui-outline-action ui-cancel-action';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'appearance-manage-action appearance-manage-save ui-solid-action ui-primary-action';
  save.textContent = 'Save';
  footer.append(cancel, save);
  modal.append(header, body, footer);
  overlay.append(modal);
  document.body.append(overlay, results);

  const draft = copyAppearanceGroup(groupKey);
  appearanceManageState = {
    groupKey,
    draft,
    availableFonts: [],
    availableMap: new Map(),
    enumerationStatus: appearanceFontEnumerationAvailable() ? 'loading' : 'unavailable',
    saving: false,
    dragIndex: null,
    insertionIndex: null,
    listOpen: false,
    filteredFonts: [],
    activeResultIndex: -1,
    selectedFont: null,
    error: '',
    refs: { overlay, modal, stack, input, add, results, sizeValue, sizeSlider, error, save }
  };
  vaultSettingsModal?.classList.add('is-nested-blocked');
  vaultSettingsModal?.setAttribute('aria-hidden', 'true');
  renderAppearanceFontStack();
  if (sizeSlider) {
    sizeSlider.value = String(draft.fontSize);
    sizeValue.value = String(draft.fontSize);
    sizeValue.textContent = String(draft.fontSize);
    sizeSlider.addEventListener('input', () => {
      draft.fontSize = Number(sizeSlider.value);
      sizeValue.value = sizeSlider.value;
      sizeValue.textContent = sizeSlider.value;
    });
  }
  input.addEventListener('click', renderAppearanceFontResults);
  input.addEventListener('input', () => {
    appearanceManageState.selectedFont = null;
    add.disabled = true;
    appearanceManageState.activeResultIndex = -1;
    if (appearanceManageState.listOpen) renderAppearanceFontResults({ open: false });
  });
  add.addEventListener('click', addAppearanceFont);
  close.addEventListener('click', closeAppearanceManager);
  cancel.addEventListener('click', closeAppearanceManager);
  save.addEventListener('click', saveAppearanceManager);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeAppearanceManager();
  });
  modal.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.addEventListener('keydown', handleAppearanceManageKeyDown, true);
  document.addEventListener('pointerdown', handleAppearanceManagePointerDown, true);
  window.addEventListener('resize', positionAppearanceFontResults);
  document.addEventListener('scroll', positionAppearanceFontResults, true);
  input.focus();
  loadAvailableAppearanceFonts(appearanceManageState);
}

function renderZoomSensitivity(value = zoomSensitivity) {
  const normalized = setRuntimeZoomSensitivity(value);
  if (zoomSensitivitySlider) zoomSensitivitySlider.value = normalized.toFixed(1);
  if (zoomSensitivityValue) {
    zoomSensitivityValue.value = zoomControls.formatZoomSensitivity(normalized);
    zoomSensitivityValue.textContent = zoomControls.formatZoomSensitivity(normalized);
  }
  return normalized;
}

async function loadVaultControlSettings() {
  const fallback = renderZoomSensitivity(zoomSensitivity);
  const editVersion = zoomSensitivityEditVersion;
  if (!desktopControlSettingsAvailable()) return;
  try {
    const settings = await window.cneDesktop.getControlSettings();
    if (editVersion === zoomSensitivityEditVersion) {
      renderZoomSensitivity(settings?.zoomSensitivity);
    }
  } catch {
    if (editVersion === zoomSensitivityEditVersion) renderZoomSensitivity(fallback);
  }
}

function renderVaultPageTypePreference() {
  if (!vaultDefaultPageType) return;
  const selectedType = pageTypesModel.normalizeVaultDefaultPageType(
    vaultPreferences?.defaultPageType
  );
  const selectedValue = typeof selectedType === 'string' ? selectedType : '';
  vaultDefaultPageType.replaceChildren(...pageTypesModel.vaultDefaultPageTypes()
    .map(({ id, label }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      return option;
    }));
  if (![...vaultDefaultPageType.options].some(({ value }) => value === selectedValue)) {
    const unsupported = document.createElement('option');
    unsupported.value = selectedValue;
    unsupported.textContent = pageTypesModel.pageTypeLabel(selectedType);
    unsupported.disabled = true;
    vaultDefaultPageType.append(unsupported);
  }
  vaultDefaultPageType.value = selectedValue;
}

function renderPreserveSingleLineBreaksPreference() {
  if (!preserveSingleLineBreaksSwitch) return;
  const enabled = markdownPageModel.normalizePreserveSingleLineBreaks(
    vaultPreferences?.preserveSingleLineBreaks
  );
  preserveSingleLineBreaksSwitch.setAttribute('aria-checked', enabled ? 'true' : 'false');
}

async function saveVaultPageTypePreference() {
  if (!vaultDefaultPageType) return;
  const runtime = activePaneRuntime();
  const previous = vaultPreferences;
  const next = pageTypesModel.normalizeSettings({
    ...vaultPreferences,
    defaultPageType: vaultDefaultPageType.value
  });
  vaultDefaultPageType.disabled = true;
  try {
    const saved = await queueVaultMarkdownPreferenceSave({
      defaultPageType: next.defaultPageType
    });
    if (typeof applyVaultMarkdownPreferences === 'function') {
      applyVaultMarkdownPreferences({
        ...vaultPreferences,
        defaultPageType: saved.defaultPageType
      }, { rerender: false });
    } else {
      vaultPreferences = {
        ...pageTypesModel.normalizeSettings({
          ...vaultPreferences,
          defaultPageType: saved.defaultPageType
        }),
        ...markdownPageModel.normalizeSettings({
          ...vaultPreferences,
          defaultPageType: saved.defaultPageType
        })
      };
    }
    renderVaultPageTypePreference();
  } catch (error) {
    vaultPreferences = previous;
    renderVaultPageTypePreference();
    showRuntimeStatus(runtime, error.message || 'Default Page Type could not be saved.', true);
  } finally {
    vaultDefaultPageType.disabled = false;
  }
}

async function togglePreserveSingleLineBreaksPreference() {
  if (!preserveSingleLineBreaksSwitch || preserveSingleLineBreaksSwitch.disabled) return;
  const runtime = activePaneRuntime();
  const previous = markdownPageModel.normalizeSettings(vaultPreferences);
  const preserveSingleLineBreaks = !previous.preserveSingleLineBreaks;
  preserveSingleLineBreaksSwitch.disabled = true;
  try {
    if (typeof applyVaultMarkdownPreferences === 'function') {
      applyVaultMarkdownPreferences({
        ...vaultPreferences,
        preserveSingleLineBreaks
      }, { rerender: false });
    } else {
      vaultPreferences = markdownPageModel.normalizeSettings({
        ...vaultPreferences,
        preserveSingleLineBreaks
      });
    }
    renderPreserveSingleLineBreaksPreference();
    const saved = await queueVaultMarkdownPreferenceSave({ preserveSingleLineBreaks });
    if (typeof applyVaultMarkdownPreferences === 'function') {
      applyVaultMarkdownPreferences(saved, { rerender: false });
    } else {
      vaultPreferences = markdownPageModel.normalizeSettings(saved);
    }
  } catch (error) {
    if (typeof applyVaultMarkdownPreferences === 'function') {
      applyVaultMarkdownPreferences(previous, { rerender: false });
    } else {
      vaultPreferences = previous;
    }
    showRuntimeStatus(runtime, error.message || 'Preserve Single Line Breaks could not be saved.', true);
  } finally {
    renderPreserveSingleLineBreaksPreference();
    preserveSingleLineBreaksSwitch.disabled = false;
  }
}

function selectVaultSettingsSection(section) {
  vaultSettingsSection = ['vault', 'control', 'appearance', 'links', 'category'].includes(section)
    ? section
    : 'links';
  const vaultSelected = vaultSettingsSection === 'vault';
  const controlSelected = vaultSettingsSection === 'control';
  const appearanceSelected = vaultSettingsSection === 'appearance';
  const linksSelected = vaultSettingsSection === 'links';
  const categorySelected = vaultSettingsSection === 'category';
  vaultSettingsVaultNav?.classList.toggle('is-selected', vaultSelected);
  vaultSettingsControlNav?.classList.toggle('is-selected', controlSelected);
  vaultSettingsAppearanceNav?.classList.toggle('is-selected', appearanceSelected);
  vaultSettingsLinksNav?.classList.toggle('is-selected', linksSelected);
  vaultSettingsCategoryNav?.classList.toggle('is-selected', categorySelected);
  vaultSettingsVaultNav?.setAttribute('aria-current', vaultSelected ? 'page' : 'false');
  vaultSettingsControlNav?.setAttribute('aria-current', controlSelected ? 'page' : 'false');
  vaultSettingsAppearanceNav?.setAttribute('aria-current', appearanceSelected ? 'page' : 'false');
  vaultSettingsLinksNav?.setAttribute('aria-current', linksSelected ? 'page' : 'false');
  vaultSettingsCategoryNav?.setAttribute('aria-current', categorySelected ? 'page' : 'false');
  if (vaultSettingsVaultPanel) vaultSettingsVaultPanel.hidden = !vaultSelected;
  if (vaultSettingsControlPanel) vaultSettingsControlPanel.hidden = !controlSelected;
  if (vaultSettingsAppearancePanel) vaultSettingsAppearancePanel.hidden = !appearanceSelected;
  if (vaultSettingsLinksPanel) vaultSettingsLinksPanel.hidden = !linksSelected;
  if (vaultSettingsCategoryPanel) vaultSettingsCategoryPanel.hidden = !categorySelected;
  if (vaultSelected) {
    loadVaultManagementSettings();
  }
  if (controlSelected) {
    loadVaultControlSettings();
    renderVaultPageTypePreference();
    renderPreserveSingleLineBreaksPreference();
  }
  if (appearanceSelected) {
    renderAppearanceColourRows();
  }
  if (categorySelected) renderVaultCategorySettings();
}

function vaultManagementAvailable() {
  const bridge = window.cneDesktop;
  return Boolean(bridge?.getVaultInfo && bridge?.switchVault
    && bridge?.createVault && bridge?.renameVault);
}

async function loadVaultManagementSettings(runtime = activePaneRuntime()) {
  if (!vaultManagementAvailable()) return null;
  try {
    const info = await window.cneDesktop.getVaultInfo();
    if (!info?.ok) throw new Error(info?.error || 'Vault information could not be loaded.');
    vaultDiscovery = info;
    const current = info.vaults?.find((vault) => vault.vaultId === info.currentVaultId);
    const displayName = current?.displayName || info.projectName || project?.projectName || 'Vault';
    if (vaultSwitcherName) vaultSwitcherName.textContent = displayName;
    if (vaultSettingsCurrentName) vaultSettingsCurrentName.textContent = displayName;
    return info;
  } catch (error) {
    showRuntimeStatus(runtime, error.message || 'Vault information could not be loaded.', true);
    return null;
  }
}

function normalizeVaultNameDraft(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!name || name === '.' || name === '..' || /[\/:\0-\x1f\x7f]/.test(name)) {
    throw new Error('Vault names cannot be empty or contain “/”, “:”, or control characters.');
  }
  return name;
}

function isCategoryNameModalMode(mode = vaultNameState?.mode) {
  return mode === 'category-group' || mode === 'category-item';
}

function normalizeCategoryNameDraft(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label) throw new Error('A non-empty Category label is required.');
  return label;
}

function nameModalActionInProgress() {
  return vaultChangeInProgress
    || (isCategoryNameModalMode() && vaultCategoryActionInProgress);
}

function hasUnsavedVaultDraft() {
  return Boolean(livingPaneRuntimes().some((runtime) => (
    runtime.blockEditMode || runtime.pageEditMode || runtime.highlightEditDraft
  )) || pageMetaModal
    || appearanceManageState || appearanceColourState);
}

async function flushVaultSettingsWrites() {
  await Promise.all([
    zoomSensitivitySaveQueue.catch(() => {}),
    vaultAppearanceStore.flush(),
    globalThis.flushMarkdownPreferenceSavesNow?.() || Promise.resolve()
  ]);
}

async function prepareForVaultChange(actionLabel) {
  if (hasUnsavedVaultDraft()
    && !window.confirm(`Discard unsaved edits and ${actionLabel}?`)) return false;
  for (const runtime of livingPaneRuntimes()) {
    prepareInfoPanelsForRuntimeContextChange(runtime, { persistGesture: true });
    if (runtime.blockEditMode) cancelBlockEdits(runtime);
    if (runtime.pageEditMode) cancelPageEdits(runtime);
    if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  }
  if (pageMetaModal) closePageMetaModal();
  await flushVaultSettingsWrites();
  if (typeof flushWorkspaceStateNow === 'function') await flushWorkspaceStateNow();
  return true;
}

function closeVaultNameModal({ restoreFocus = true } = {}) {
  if (!vaultNameState) return;
  const source = vaultNameState.source;
  vaultNameState = null;
  vaultNameOverlay.hidden = true;
  vaultNameError.textContent = '';
  vaultNameInput.value = '';
  vaultNameInput.setAttribute('maxlength', '120');
  if (vaultNameFieldLabel) vaultNameFieldLabel.textContent = 'Vault name';
  vaultNameConfirm.textContent = 'Confirm';
  vaultNameConfirm.disabled = false;
  vaultNameCancel.disabled = false;
  document.removeEventListener('keydown', handleVaultNameKeyDown, true);
  if (restoreFocus) source?.focus?.();
}

function handleVaultNameKeyDown(event) {
  if (!vaultNameState) return;
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      event.target
    )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)
    && !['Enter', 'Escape'].includes(event.key)) return;
  if (event.key === 'Escape' && !nameModalActionInProgress()) {
    event.preventDefault();
    event.stopPropagation();
    closeVaultNameModal();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    confirmVaultNameModal();
  }
}

function openVaultNameModal(mode, {
  vaultId = null,
  categoryId = null,
  displayName = '',
  source = vaultSwitcherButton
} = {}) {
  const categoryMode = isCategoryNameModalMode(mode);
  if ((!categoryMode && !vaultManagementAvailable()) || nameModalActionInProgress()) return;
  vaultNameState = { mode, vaultId, categoryId, displayName, source };
  vaultNameTitle.textContent = mode === 'rename'
    ? 'Rename Vault'
    : mode === 'category-group'
      ? 'Rename Category Group'
      : mode === 'category-item'
        ? 'Rename Category'
        : 'Add New Vault';
  if (vaultNameFieldLabel) {
    vaultNameFieldLabel.textContent = mode === 'category-group'
      ? 'Group name'
      : mode === 'category-item'
        ? 'Category name'
        : 'Vault name';
  }
  vaultNameConfirm.textContent = categoryMode ? 'Save' : 'Confirm';
  if (categoryMode) vaultNameInput.removeAttribute('maxlength');
  else vaultNameInput.setAttribute('maxlength', '120');
  vaultNameInput.value = mode === 'add' ? '' : displayName;
  vaultNameError.textContent = '';
  vaultNameOverlay.hidden = false;
  document.addEventListener('keydown', handleVaultNameKeyDown, true);
  requestAnimationFrame(() => {
    vaultNameInput.focus();
    if (mode !== 'add') vaultNameInput.select();
  });
}

async function confirmVaultNameModal() {
  if (!vaultNameState || nameModalActionInProgress()) return;
  const runtime = activePaneRuntime();
  const state = { ...vaultNameState };
  const categoryMode = isCategoryNameModalMode(state.mode);
  let name;
  try {
    name = categoryMode
      ? normalizeCategoryNameDraft(vaultNameInput.value)
      : normalizeVaultNameDraft(vaultNameInput.value);
  } catch (error) {
    vaultNameError.textContent = error.message;
    vaultNameInput.focus();
    return;
  }
  if (categoryMode) {
    if (name === String(state.displayName || '').trim()) {
      closeVaultNameModal();
      return;
    }
    vaultNameConfirm.disabled = true;
    vaultNameCancel.disabled = true;
    vaultNameError.textContent = 'Renaming…';
    const resource = state.mode === 'category-group' ? 'groups' : 'items';
    const outcome = await runVaultCategoryAction(() => request(
      `/api/categories/${resource}/${encodeURIComponent(state.categoryId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: name })
      }
    ));
    if (!outcome?.ok) {
      vaultNameConfirm.disabled = false;
      vaultNameCancel.disabled = false;
      vaultNameError.textContent = outcome?.error?.message
        || 'The Category name could not be saved.';
      vaultNameInput.focus();
      return;
    }
    closeVaultNameModal({ restoreFocus: false });
    return;
  }
  if (state.mode === 'rename' && !await prepareForVaultChange('rename this Vault')) {
    vaultNameInput.focus();
    return;
  }
  vaultChangeInProgress = true;
  vaultNameConfirm.disabled = true;
  vaultNameCancel.disabled = true;
  vaultNameError.textContent = state.mode === 'rename' ? 'Renaming…' : 'Creating…';
  try {
    const result = state.mode === 'rename'
      ? await window.cneDesktop.renameVault(state.vaultId, name)
      : await window.cneDesktop.createVault(name);
    if (!result?.ok) throw new Error(result?.error || 'The Vault change failed.');
    if (result.restarting) {
      showRuntimeStatus(runtime, state.mode === 'rename' ? 'Restarting with renamed Vault…' : 'Opening new Vault…');
      return;
    }
    vaultChangeInProgress = false;
    closeVaultNameModal({ restoreFocus: false });
    await loadVaultManagementSettings(runtime);
  } catch (error) {
    vaultChangeInProgress = false;
    vaultNameConfirm.disabled = false;
    vaultNameCancel.disabled = false;
    vaultNameError.textContent = error.message || 'The Vault change failed.';
    showRuntimeStatus(runtime, vaultNameError.textContent, true);
    vaultNameInput.focus();
  }
}

async function switchToVault(vaultId, runtime = activePaneRuntime()) {
  if (vaultChangeInProgress || vaultId === vaultDiscovery?.currentVaultId) return;
  vaultChangeInProgress = true;
  showRuntimeStatus(runtime, 'Opening Vault…');
  try {
    const result = await window.cneDesktop.switchVault(vaultId);
    if (!result?.ok) throw new Error(result?.error || 'The selected Vault could not be opened.');
    vaultChangeInProgress = false;
  } catch (error) {
    vaultChangeInProgress = false;
    showRuntimeStatus(runtime, error.message || 'The selected Vault could not be opened.', true);
  }
}

async function resetCurrentVaultSettings() {
  if (vaultChangeInProgress || !vaultSettingsResetButton) return;
  if (!window.confirm(
    'Reset Page defaults, Preference, Appearance, Category navigation, and navigation sorting to defaults? Pages and resource locations will not be changed.'
  )) return;
  const runtime = activePaneRuntime();
  const runtimeOperation = captureRuntimeOperation(runtime, {
    scope: 'vault-settings-reset'
  });
  vaultChangeInProgress = true;
  vaultSettingsResetButton.disabled = true;
  try {
    const defaultAppearance = appearanceSettingsModel.normalizeAppearanceSettings(null);
    const [, categoryResult, sortResult, controlResult,
      savedVaultPreferences] = await Promise.all([
      vaultAppearanceStore.replace(defaultAppearance, { label: 'vault-settings-reset' }),
      request('/api/categories/navigation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryNavigation.DEFAULT_NAVIGATION_SETTINGS)
      }),
      typeof persistNavigationSortMode === 'function'
        && typeof desktopNavigationSortAvailable === 'function'
        && desktopNavigationSortAvailable()
        ? persistNavigationSortMode(navigationSort.DEFAULT_SORT_MODE, { reportErrors: false })
        : window.cneDesktop?.setNavigationSortMode
          ? window.cneDesktop.setNavigationSortMode(navigationSort.DEFAULT_SORT_MODE)
        : Promise.resolve({ ok: true, sortMode: navigationSort.DEFAULT_SORT_MODE }),
      window.cneDesktop?.setZoomSensitivity
        ? window.cneDesktop.setZoomSensitivity(1)
        : Promise.resolve({ ok: true, zoomSensitivity: 1 }),
      queueVaultMarkdownPreferenceSave({
        ...pageTypesModel.DEFAULT_SETTINGS,
        ...markdownPageModel.DEFAULT_SETTINGS
      })
    ]);
    if (!sortResult?.ok) throw new Error(sortResult?.error || 'Navigation sorting could not be reset.');
    if (!controlResult?.ok) throw new Error(controlResult?.error || 'Control settings could not be reset.');
    applyNavigationSortMode(sortResult.sortMode, { persist: false });
    renderZoomSensitivity(controlResult.zoomSensitivity);
    if (typeof applyVaultMarkdownPreferences === 'function') {
      applyVaultMarkdownPreferences(savedVaultPreferences);
    } else {
      vaultPreferences = {
        ...pageTypesModel.normalizeSettings(savedVaultPreferences),
        ...markdownPageModel.normalizeSettings(savedVaultPreferences)
      };
    }
    refreshCategoryDependentViews(
      runtimeOperationIsCurrent(runtimeOperation) ? runtime : null,
      categoryResult
    );
    renderVaultCategorySettings();
    renderVaultPageTypePreference();
    renderPreserveSingleLineBreaksPreference();
    showRuntimeStatus(runtime, 'Vault settings reset to defaults.');
  } catch (error) {
    showRuntimeStatus(runtime, error.message || 'Vault settings could not be reset.', true);
  } finally {
    vaultChangeInProgress = false;
    vaultSettingsResetButton.disabled = false;
  }
}

async function rebuildNavigationProjection() {
  if (vaultChangeInProgress || !vaultSettingsRebuildNavigationButton) return;
  const runtime = activePaneRuntime();
  vaultChangeInProgress = true;
  vaultSettingsRebuildNavigationButton.disabled = true;
  showRuntimeStatus(runtime, 'Rebuilding navigation…');
  const runtimeOperation = captureRuntimeOperation(runtime, {
    scope: 'navigation-projection-rebuild'
  });
  try {
    const result = await request('/api/navigation/rebuild', { method: 'POST' });
    refreshCategoryDependentViews(
      runtimeOperationIsCurrent(runtimeOperation) ? runtime : null,
      result || {}
    );
    showRuntimeStatus(runtime, 'Navigation rebuilt.', false, 1800);
  } catch (error) {
    showRuntimeStatus(runtime, error.message || 'Navigation could not be rebuilt.', true);
  } finally {
    vaultChangeInProgress = false;
    vaultSettingsRebuildNavigationButton.disabled = false;
  }
}

async function openVaultSwitcher(event) {
  if (!vaultManagementAvailable() || vaultChangeInProgress
    || !window.nativeContextMenu?.available?.()) return;
  const runtime = activePaneRuntime();
  const info = await loadVaultManagementSettings(runtime);
  if (!info) return;
  const command = await window.nativeContextMenu.open(event, {
    type: 'vault-switcher',
    targetId: info.currentVaultId,
    vaults: info.vaults
  });
  if (!command) return;
  if (command === 'add-new-vault') {
    openVaultNameModal('add', { source: vaultSwitcherButton });
    return;
  }
  if (command === 'open-vault-settings') {
    openVaultSettings();
    selectVaultSettingsSection('vault');
    return;
  }
  if (command.startsWith('switch-vault:')) {
    await switchToVault(command.slice('switch-vault:'.length), runtime);
  }
}

function updateZoomSensitivityFromSlider() {
  zoomSensitivityEditVersion += 1;
  const next = renderZoomSensitivity(Number(zoomSensitivitySlider.value));
  if (!desktopControlSettingsAvailable()) return;
  zoomSensitivitySaveQueue = zoomSensitivitySaveQueue
    .catch(() => {})
    .then(async () => {
      const result = await window.cneDesktop.setZoomSensitivity(next);
      if (!result?.ok) throw new Error(result?.error || 'Zoom sensitivity could not be saved.');
    })
    .catch((error) => console.error('[control:zoom-sensitivity]', error));
}

function folderNameCell(folder) {
  return folderWarningTooltip.createFolderNameCell(folder, {
    documentRef: document,
    tooltip: vaultFolderTooltip
  });
}

function folderActionButton(label, action, {
  disabled = false,
  selected = false,
  variant = 'neutral',
  layoutClass = ''
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `vault-folder-action ${variant === 'cancel' ? 'ui-outline-action ui-cancel-action' : (
    variant === 'theme' ? 'ui-solid-action ui-primary-action' : 'ui-outline-action neutral-control'
  )}${layoutClass ? ` ${layoutClass}` : ''}`;
  button.textContent = label;
  button.disabled = disabled || vaultFolderActionInProgress || !desktopFolderSettingsAvailable();
  button.classList.toggle('is-selected', selected);
  button.addEventListener('click', action);
  return button;
}

function readOnlyFolderRow(folder, label = '') {
  const row = document.createElement('div');
  row.className = 'vault-folder-row vault-folder-readonly-row';
  const labelCell = document.createElement('span');
  labelCell.className = 'vault-folder-label vault-settings-item-text';
  labelCell.textContent = label;
  const nameWrap = document.createElement('span');
  nameWrap.className = 'vault-folder-name-wrap';
  if (vaultFolderRemovalMode) {
    const removeTrigger = document.createElement('button');
    removeTrigger.type = 'button';
    removeTrigger.className = 'vault-folder-remove-trigger';
    removeTrigger.textContent = '−';
    removeTrigger.setAttribute('aria-label', `Remove ${folder.name} link`);
    removeTrigger.disabled = vaultFolderActionInProgress || !desktopFolderSettingsAvailable();
    removeTrigger.addEventListener('click', () => runVaultFolderAction(
      (bridge) => bridge.removeReadOnlyFolder(folder.id)
    ));
    nameWrap.append(removeTrigger);
  }
  nameWrap.append(folderNameCell(folder));
  const setDefaultButton = folderActionButton('Set as default', () => runVaultFolderAction(
      (bridge) => bridge.setDefaultFolder(folder.id)
    ), { disabled: !folder.available, layoutClass: 'vault-folder-set-default-action' });
  const changeButton = folderActionButton('Change to', () => runVaultFolderAction(
    (bridge) => bridge.changeReadOnlyFolder(folder.id)
  ), { layoutClass: 'vault-folder-change-action' });
  row.append(
    labelCell,
    nameWrap,
    setDefaultButton,
    changeButton
  );
  return row;
}

async function runVaultFolderAction(operation) {
  if (vaultFolderActionInProgress || !desktopFolderSettingsAvailable()) return;
  vaultFolderActionInProgress = true;
  vaultFolderError = '';
  renderVaultFolderSettings();
  try {
    const result = await operation(window.cneDesktop);
    if (result?.cancelled) return;
    if (!result?.ok) throw new Error(result?.error || 'The folder setting could not be saved.');
    vaultFolderState = result.registry || await window.cneDesktop.getResourceFolders();
  } catch (error) {
    vaultFolderError = error.message || 'The folder setting could not be saved.';
  } finally {
    vaultFolderActionInProgress = false;
    renderVaultFolderSettings();
  }
}

function folderRow(label, folder, actionLabel, action) {
  const row = document.createElement('div');
  row.className = 'vault-folder-row';
  const labelCell = document.createElement('span');
  labelCell.className = 'vault-folder-label vault-settings-item-text';
  labelCell.textContent = label;
  row.append(labelCell, folderNameCell(folder), folderActionButton(actionLabel, action, {
    layoutClass: 'vault-folder-change-action'
  }));
  return row;
}

function renderVaultFolderSettings() {
  if (!vaultSettingsLinks) return;
  vaultFolderTooltip.hide();
  const state = vaultFolderState || { defaultFolderId: null, folders: [] };
  const defaultFolder = state.folders.find((folder) => folder.id === state.defaultFolderId) || null;
  const readOnly = state.folders.filter((folder) => folder.id !== state.defaultFolderId);
  if (!readOnly.length) vaultFolderRemovalMode = false;
  const fragment = document.createDocumentFragment();

  const resourcesHeading = document.createElement('h3');
  resourcesHeading.className = 'vault-settings-level-1-heading';
  resourcesHeading.textContent = 'Resources Folder';
  fragment.append(resourcesHeading);

  fragment.append(folderRow(
    'Default folder:',
    defaultFolder,
    defaultFolder ? (defaultFolder.available ? 'Change to' : 'Relink') : 'Select',
    () => runVaultFolderAction((bridge) => (
      defaultFolder && !defaultFolder.available
        ? bridge.relinkFolder(defaultFolder.id)
        : bridge.selectDefaultFolder()
    ))
  ));

  const divider = document.createElement('div');
  divider.className = 'vault-settings-section-divider';
  divider.setAttribute('role', 'separator');
  fragment.append(divider);

  const linkTypesHeading = document.createElement('h3');
  linkTypesHeading.className = 'vault-settings-level-1-heading';
  linkTypesHeading.textContent = 'Link Types';
  fragment.append(linkTypesHeading);

  if (!readOnly.length) {
    const readOnlyHeading = document.createElement('div');
    readOnlyHeading.className = 'vault-folder-section-label vault-settings-item-text';
    readOnlyHeading.textContent = 'Read only:';
    fragment.append(readOnlyHeading);
  }

  for (const [index, folder] of readOnly.entries()) {
    fragment.append(readOnlyFolderRow(folder, index === 0 ? 'Read only:' : ''));
  }

  const addRow = document.createElement('div');
  addRow.className = 'vault-folder-row vault-folder-readonly-row vault-folder-add-row';
  addRow.append(
    folderActionButton('Remove', () => {
      vaultFolderRemovalMode = !vaultFolderRemovalMode;
      renderVaultFolderSettings();
    }, { disabled: !readOnly.length, selected: vaultFolderRemovalMode, variant: 'cancel' }),
    folderActionButton(
      'Add new',
      () => runVaultFolderAction((bridge) => bridge.addReadOnlyFolder()),
      { variant: 'theme' }
    ),
    document.createElement('span')
  );
  fragment.append(addRow);

  const status = document.createElement('p');
  status.className = 'vault-folder-status';
  if (!desktopFolderSettingsAvailable()) {
    status.textContent = 'Folder settings are available in the desktop app.';
  } else if (vaultFolderError) {
    status.textContent = vaultFolderError;
    status.classList.add('error');
  }
  fragment.append(status);
  vaultSettingsLinks.replaceChildren(fragment);
}

async function loadVaultFolderSettings() {
  vaultFolderState = null;
  vaultFolderError = '';
  renderVaultFolderSettings();
  if (!desktopFolderSettingsAvailable()) return;
  try {
    vaultFolderState = await window.cneDesktop.getResourceFolders();
  } catch (error) {
    vaultFolderState = { defaultFolderId: null, folders: [] };
    vaultFolderError = error.message || 'Folder settings could not be loaded.';
    renderVaultFolderSettings();
    return;
  }
  renderVaultFolderSettings();
}

function vaultCategoryItems(nodes, result = []) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'item') result.push(node);
    else vaultCategoryItems(node.children, result);
  }
  return result;
}

function renderNavigationAfterCategoryChange() {
  const scrollContainer = pageList?.closest?.('.left-sidebar-scroll-region');
  const scrollTop = scrollContainer?.scrollTop || 0;
  renderPageList();
  if (scrollContainer) scrollContainer.scrollTop = scrollTop;
}

function refreshCategoryDependentViews(runtime, result = {}) {
  categoryConfig = categoryNavigation.normalizeCategoryConfiguration(
    result.categoryConfig || categoryConfig
  );
  if (result.pageIndex) pageIndex = result.pageIndex;
  if (result.navigation) navigation = result.navigation;
  const validCategoryIds = new Set(
    categoryNavigation.categoryItemsInOrder(categoryConfig).map((item) => item.id)
  );
  for (const selectedSet of [selectedCategoryFilterIds, selectedRightCategoryIds]) {
    for (const categoryId of [...selectedSet]) {
      if (!validCategoryIds.has(categoryId)) selectedSet.delete(categoryId);
    }
  }
  adoptCategoryCommandPages(result.pages || [], { originRuntime: runtime });
  refreshOpenCategoryEditor();
  renderFilterPanel();
  const activeRuntime = activePaneRuntime();
  if (activeRuntime) {
    renderRightCategoryFilter(activeRuntime);
    renderRelations(
      activeRuntime,
      activeRuntime.currentPage || { blocks: [], backlinks: [] }
    );
  }
  renderNavigationAfterCategoryChange();
}

function refreshOpenCategoryEditor() {
  if (typeof pageMetaModal === 'undefined' || pageMetaModal?.type !== 'category'
    || typeof renderCategoryEditor !== 'function') return;
  const body = pageMetaModal.modal?.querySelector?.('.forced-modal-body');
  if (!body) return;
  const batch = pageMetaModal.mode === 'batch';
  const checkedIds = batch
    ? null
    : new Set([...body.querySelectorAll('.category-checkbox input:checked')]
      .map((input) => input.value));
  const editor = renderCategoryEditor(pageMetaModal.runtime, {
    batch,
    instructions: pageMetaModal.categoryInstructions
  });
  if (checkedIds) {
    for (const input of editor.querySelectorAll('.category-checkbox input')) {
      input.checked = checkedIds.has(input.value);
    }
  }
  body.replaceChildren(editor);
}

async function runVaultCategoryAction(operation) {
  if (vaultCategoryActionInProgress) return { ok: false, error: null };
  vaultCategoryActionInProgress = true;
  vaultCategoryError = '';
  renderVaultCategorySettings();
  const runtime = activePaneRuntime();
  const runtimeOperation = captureRuntimeOperation(runtime, {
    scope: 'vault-category-action'
  });
  let outcome;
  try {
    const result = await operation();
    const originRuntime = runtimeOperationIsCurrent(runtimeOperation) ? runtime : null;
    refreshCategoryDependentViews(originRuntime, result || {});
    outcome = { ok: true, result };
  } catch (error) {
    vaultCategoryError = error.message || 'Category settings could not be saved.';
    outcome = { ok: false, error };
  } finally {
    vaultCategoryActionInProgress = false;
    renderVaultCategorySettings();
  }
  return outcome;
}

function vaultCategoryActionButton(label, action, variant = 'neutral') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `vault-folder-action ${variant === 'theme' ? 'ui-solid-action ui-primary-action' : (
    variant === 'cancel' ? 'ui-outline-action ui-cancel-action' : 'ui-outline-action neutral-control'
  )}`;
  button.textContent = label;
  button.disabled = vaultCategoryActionInProgress;
  button.addEventListener('click', action);
  return button;
}

function vaultCategoryRenameButton(nodeType, node) {
  const button = vaultCategoryActionButton('Rename', () => openVaultNameModal(
    nodeType === 'group' ? 'category-group' : 'category-item',
    {
      categoryId: node.id,
      displayName: node.label || node.id,
      source: button
    }
  ));
  button.classList.add('vault-category-rename-action');
  button.dataset.categoryRenameKind = nodeType;
  button.dataset.categoryRenameId = node.id;
  button.setAttribute('aria-label', `Rename ${nodeType === 'group' ? 'Category group' : 'Category'} ${node.label || node.id}`);
  return button;
}

function patchVaultCategoryNavigation(patch) {
  return runVaultCategoryAction(() => request('/api/categories/navigation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  }));
}

function categoryRemovalTrigger(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vault-folder-remove-trigger';
  button.textContent = '−';
  button.setAttribute('aria-label', label);
  button.disabled = vaultCategoryActionInProgress;
  button.addEventListener('click', action);
  return button;
}

function removeVaultCategoryItem(item) {
  if (!window.confirm(`Remove Category “${item.label || item.id}” from this Vault?`)) return;
  runVaultCategoryAction(() => request(
    `/api/categories/items/${encodeURIComponent(item.id)}`,
    { method: 'DELETE' }
  ));
}

function removeVaultCategoryGroup(group) {
  if (!window.confirm(
    `Remove Category group “${group.label || group.id}” and all Categories inside it?`
  )) return;
  runVaultCategoryAction(() => request(
    `/api/categories/groups/${encodeURIComponent(group.id)}`,
    { method: 'DELETE' }
  ));
}

function renderVaultCategorySettings() {
  if (!vaultSettingsCategoryGroups || !vaultSettingsCategoryActions || !vaultSettingsCategoryCollapse) return;
  const config = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
  const enabledIds = new Set(config.navigation.enabledCategoryIds);
  const groupsFragment = document.createDocumentFragment();

  for (const group of config.groups) {
    const section = document.createElement('section');
    section.className = 'vault-category-group';
    const header = document.createElement('div');
    header.className = 'vault-category-group-header';
    const headerMain = document.createElement('div');
    headerMain.className = 'vault-category-row-main';
    const name = document.createElement('span');
    name.className = 'vault-category-group-name vault-settings-level-2-heading';
    name.textContent = group.label || group.id;
    if (vaultCategoryRemovalMode) {
      headerMain.append(categoryRemovalTrigger(
        `Remove Category group ${group.label || group.id}`,
        () => removeVaultCategoryGroup(group)
      ));
    }
    headerMain.append(name);
    const addButton = vaultCategoryActionButton('Add', () => runVaultCategoryAction(() => request(
      `/api/categories/groups/${encodeURIComponent(group.id)}/items`,
      { method: 'POST' }
    )), 'theme');
    addButton.classList.add('vault-category-add-action');
    header.append(headerMain, addButton, vaultCategoryRenameButton('group', group));
    section.append(header);

    const items = document.createElement('div');
    items.className = 'vault-category-items';
    for (const item of vaultCategoryItems(group.children)) {
      const row = document.createElement('div');
      row.className = 'vault-category-item';
      const rowMain = document.createElement('div');
      rowMain.className = 'vault-category-row-main';
      if (vaultCategoryRemovalMode) {
        rowMain.append(categoryRemovalTrigger(
          `Remove Category ${item.label || item.id}`,
          () => removeVaultCategoryItem(item)
        ));
      }
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'vault-category-navigation-toggle';
      toggle.dataset.selected = String(enabledIds.has(item.id));
      toggle.setAttribute('aria-pressed', String(enabledIds.has(item.id)));
      toggle.setAttribute('aria-label', `${enabledIds.has(item.id) ? 'Disable' : 'Enable'} ${item.label || item.id} navigation group`);
      toggle.textContent = enabledIds.has(item.id) ? '−' : '';
      toggle.disabled = vaultCategoryActionInProgress;
      toggle.addEventListener('click', () => {
        const nextEnabledIds = new Set(enabledIds);
        if (nextEnabledIds.has(item.id)) nextEnabledIds.delete(item.id);
        else nextEnabledIds.add(item.id);
        const orderedIds = categoryNavigation.categoryItemsInOrder(config)
          .map((candidate) => candidate.id)
          .filter((categoryId) => nextEnabledIds.has(categoryId));
        patchVaultCategoryNavigation({ enabledCategoryIds: orderedIds });
      });
      const label = document.createElement('span');
      label.className = 'vault-settings-item-text';
      label.textContent = item.label || item.id;
      rowMain.append(toggle, label);
      row.append(rowMain, vaultCategoryRenameButton('item', item));
      items.append(row);
    }
    section.append(items);
    groupsFragment.append(section);
  }
  vaultSettingsCategoryGroups.replaceChildren(groupsFragment);

  const removeButton = vaultCategoryActionButton('Remove', () => {
    vaultCategoryRemovalMode = !vaultCategoryRemovalMode;
    renderVaultCategorySettings();
  }, 'cancel');
  removeButton.classList.toggle('is-selected', vaultCategoryRemovalMode);
  const addGroupButton = vaultCategoryActionButton('New Group', () => runVaultCategoryAction(() => request(
    '/api/categories/groups',
    { method: 'POST' }
  )), 'theme');
  vaultSettingsCategoryActions.replaceChildren(removeButton, addGroupButton);

  const collapseUncategorised = document.createElement('label');
  collapseUncategorised.className = 'vault-category-setting-row';
  const collapseCheckbox = document.createElement('input');
  collapseCheckbox.type = 'checkbox';
  collapseCheckbox.checked = config.navigation.collapseUncategorisedPages;
  collapseCheckbox.disabled = vaultCategoryActionInProgress;
  collapseCheckbox.addEventListener('change', () => patchVaultCategoryNavigation({
    collapseUncategorisedPages: collapseCheckbox.checked
  }));
  const collapseLabel = document.createElement('span');
  collapseLabel.className = 'vault-settings-item-text';
  collapseLabel.textContent = 'Collapse uncategorised pages';
  collapseUncategorised.append(collapseLabel, collapseCheckbox);

  const statistics = document.createElement('label');
  statistics.className = 'vault-category-setting-row';
  const statisticsCheckbox = document.createElement('input');
  statisticsCheckbox.type = 'checkbox';
  statisticsCheckbox.checked = config.navigation.quantityStatistics;
  statisticsCheckbox.disabled = vaultCategoryActionInProgress;
  statisticsCheckbox.addEventListener('change', () => patchVaultCategoryNavigation({
    quantityStatistics: statisticsCheckbox.checked
  }));
  const statisticsLabel = document.createElement('span');
  statisticsLabel.className = 'vault-settings-item-text';
  statisticsLabel.textContent = 'Quantity statistics';
  statistics.append(statisticsLabel, statisticsCheckbox);
  vaultSettingsCategoryCollapse.replaceChildren(collapseUncategorised, statistics);

  if (vaultSettingsCategoryStatus) {
    vaultSettingsCategoryStatus.textContent = vaultCategoryError;
    vaultSettingsCategoryStatus.classList.toggle('error', Boolean(vaultCategoryError));
  }
}

function closeVaultSettings() {
  if (!vaultSettingsOpen) return;
  if (appearanceColourState) closeAppearanceColourPicker();
  if (appearanceManageState) closeAppearanceManager();
  vaultSettingsOpen = false;
  resetBlockColourfulPreview(appearanceSettings);
  vaultFolderRemovalMode = false;
  vaultCategoryRemovalMode = false;
  document.removeEventListener('keydown', handleVaultSettingsKeyDown, true);
  vaultSettingsOverlay.hidden = true;
  vaultSettingsButton?.focus();
}

function handleVaultSettingsKeyDown(event) {
  if (!vaultSettingsOpen) return;
  if (vaultNameState || appearanceManageState || appearanceColourState) return;
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      event.target
    )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;

  if (((event.target === zoomSensitivitySlider)
    && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
      .includes(event.key))
    || ((event.target === markdownHeadingColourMode)
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter']
        .includes(event.key))) return;

  if (event.key === 'Tab') {
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (event.key === 'Escape') closeVaultSettings();
}

function openVaultSettings() {
  if (vaultSettingsOpen) return;
  if (typeof closeNavigationSortMenu === 'function') closeNavigationSortMenu();
  if (typeof closeNavigationMoveMenu === 'function') closeNavigationMoveMenu();
  vaultSettingsOpen = true;
  resetBlockColourfulPreview(appearanceSettings);
  vaultFolderRemovalMode = false;
  vaultCategoryRemovalMode = false;
  selectVaultSettingsSection('vault');
  vaultSettingsOverlay.hidden = false;
  document.addEventListener('keydown', handleVaultSettingsKeyDown, true);
  vaultSettingsCloseButton.focus();
  loadVaultFolderSettings();
  renderVaultCategorySettings();
}

vaultSettingsButton?.addEventListener('click', openVaultSettings);
vaultSwitcherButton?.addEventListener('click', openVaultSwitcher);
vaultSettingsCloseButton?.addEventListener('click', closeVaultSettings);
vaultSettingsVaultNav?.addEventListener('click', () => selectVaultSettingsSection('vault'));
vaultSettingsControlNav?.addEventListener('click', () => selectVaultSettingsSection('control'));
vaultSettingsAppearanceNav?.addEventListener('click', () => selectVaultSettingsSection('appearance'));
vaultSettingsLinksNav?.addEventListener('click', () => selectVaultSettingsSection('links'));
vaultSettingsCategoryNav?.addEventListener('click', () => selectVaultSettingsSection('category'));
vaultSettingsRenameButton?.addEventListener('click', async () => {
  const runtime = activePaneRuntime();
  const info = vaultDiscovery || await loadVaultManagementSettings(runtime);
  const current = info?.vaults?.find((vault) => vault.vaultId === info.currentVaultId);
  if (!current) return showRuntimeStatus(runtime, 'Current Vault information is unavailable.', true);
  openVaultNameModal('rename', {
    vaultId: current.vaultId,
    displayName: current.displayName,
    source: vaultSettingsRenameButton
  });
});
vaultSettingsResetButton?.addEventListener('click', resetCurrentVaultSettings);
vaultSettingsRebuildNavigationButton?.addEventListener('click', rebuildNavigationProjection);
vaultDefaultPageType?.addEventListener('change', saveVaultPageTypePreference);
preserveSingleLineBreaksSwitch?.addEventListener(
  'click',
  togglePreserveSingleLineBreaksPreference
);
vaultNameCancel?.addEventListener('click', () => {
  if (!nameModalActionInProgress()) closeVaultNameModal();
});
vaultNameConfirm?.addEventListener('click', confirmVaultNameModal);
zoomSensitivitySlider?.addEventListener('input', updateZoomSensitivityFromSlider);
guideSectionBrightness?.addEventListener('input', () => updateAppearanceBrightness(
  'guideSectionBrightnessAdjustment',
  guideSectionBrightness,
  guideSectionBrightnessValue
));
guideBorderBrightness?.addEventListener('input', () => updateAppearanceBrightness(
  'guideBorderBrightnessAdjustment',
  guideBorderBrightness,
  guideBorderBrightnessValue
));
markdownHeadingColourMode?.addEventListener('change', updateMarkdownHeadingColourMode);
for (const button of document.querySelectorAll?.('[data-appearance-manage]') || []) {
  button.addEventListener('click', () => openAppearanceManager(button.dataset.appearanceManage));
}
for (const button of document.querySelectorAll?.('[data-colour-select]') || []) {
  button.addEventListener('click', () => openAppearanceColourPicker(button.dataset.colourSelect));
}
blockColourNew?.addEventListener('click', openNewBlockColourPicker);
blockColourfulSwitch?.addEventListener('click', () => {
  blockColourfulPreviewColour = null;
  const colourful = !appearanceSettings.blockAppearance.colourful;
  updateBlockAppearance((blockAppearance) => {
    blockAppearance.colourful = colourful;
  });
});
for (const [status, control] of Object.entries(blockStatusOpacityControls)) {
  control.slider?.addEventListener('input', () => updateBlockStatusOpacity(status, control.slider.value));
  control.input?.addEventListener('input', () => {
    if (control.input.value.trim()) updateBlockStatusOpacity(status, control.input.value);
  });
  control.input?.addEventListener('change', () => updateBlockStatusOpacity(status, control.input.value));
}
blockBorderWidth?.addEventListener('input', () => {
  if (blockBorderWidth.value.trim()) updateBlockBorderWidth(blockBorderWidth.value);
});
blockBorderWidth?.addEventListener('change', () => updateBlockBorderWidth(blockBorderWidth.value));

vaultSettingsOverlay?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
});

vaultSettingsModal?.addEventListener('click', (event) => {
  event.stopPropagation();
});
