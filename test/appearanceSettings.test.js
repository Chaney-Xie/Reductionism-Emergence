const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const appearance = require('../public/appearanceSettings');
const {
  canonicalizeFontFamilies,
  createFontService,
  linuxFontFamilies,
  macFontFamilies
} = require('../desktop/fontService');

test('default appearance exactly matches the accepted Test Vault baseline', () => {
  assert.deepEqual(appearance.normalizeAppearanceSettings(null), {
    toolSurfaceColour: '#F7F5F1',
    toolBorderColour: '#C4C0B8',
    guideSurfaceColour: '#EEE8E0',
    guideSectionBrightnessAdjustment: 0.025,
    guideBorderBrightnessAdjustment: 0.14,
    canvasSurfaceColour: '#F2F0EB',
    canvasBorderColour: '#AEB6C1',
    accentColour: '#65778B',
    accentSoftOpacity: 0.18,
    accentStrongOpacity: 0.28,
    themeColour: '#597A5F',
    themeSoftOpacity: 0.1,
    blockAppearance: {
      colourful: false,
      colourfulBlock: {
        presets: [],
        lastUsedColour: '#6785A3'
      },
      monochrome: {
        colour: '#6785A3',
        opacity: { status1: 0, status2: 0.35, status3: 0.65 },
        borderWidth: 2
      }
    },
    markdownColours: {
      headingMode: 'unified',
      headings: { unified: null, h1: null, h2: null, h3: null, h4: null, h5: null, h6: null },
      text: {
        bold: null,
        italic: null,
        boldItalic: null,
        strikethroughText: null,
        strikethroughLine: null,
        underlineText: null,
        underlineLine: null,
        hyperlink: null
      },
      code: { background: null, border: null },
      symbols: { group1: null, group2: null }
    },
    fileTypography: { fontFamilies: ['system-ui'], fontSize: 14.4 },
    systemTypography: { fontFamilies: ['system-ui'] },
    pageTypography: { fontFamilies: ['system-ui'], fontSize: 16 }
  });
});

test('Colourful Block presets normalize under one owner and retain the global opacity map', () => {
  const normalized = appearance.normalizeAppearanceSettings({
    blockAppearance: {
      colourful: true,
      colourfulBlock: {
        presets: [
          { id: 'preset_first', colour: '#a1b2c3' },
          { id: 'preset_second', colour: 'D4E5F6' },
          { id: 'preset_duplicate', colour: '#A1B2C3' },
          { id: 'not valid', colour: '#010203' }
        ]
      },
      monochrome: {
        colour: '#123456',
        opacity: { status1: 0.1, status2: 0.4, status3: 0.8 },
        borderWidth: 3
      }
    }
  });
  assert.equal(normalized.blockAppearance.colourful, true);
  assert.deepEqual(normalized.blockAppearance.colourfulBlock, {
    presets: [
      { id: 'preset_first', colour: '#A1B2C3' },
      { id: 'preset_second', colour: '#D4E5F6' }
    ],
    lastUsedColour: '#123456'
  });
  assert.deepEqual(normalized.blockAppearance.monochrome.opacity, {
    status1: 0.1,
    status2: 0.4,
    status3: 0.8
  });
  assert.equal(appearance.validateAppearanceSettings(normalized).ok, true);

  const duplicate = structuredClone(normalized);
  duplicate.blockAppearance.colourfulBlock.presets.push({
    id: 'preset_third', colour: '#A1B2C3'
  });
  assert.deepEqual(appearance.validateAppearanceSettings(duplicate), {
    ok: false,
    error: 'Colour preset IDs and colours must be unique.'
  });

  const duplicateId = structuredClone(normalized);
  duplicateId.blockAppearance.colourfulBlock.presets.push({
    id: 'PRESET_FIRST', colour: '#010203'
  });
  assert.deepEqual(appearance.validateAppearanceSettings(duplicateId), {
    ok: false,
    error: 'Colour preset IDs and colours must be unique.'
  });

  const tooMany = structuredClone(normalized);
  tooMany.blockAppearance.colourfulBlock.presets = Array.from(
    { length: appearance.BLOCK_COLOUR_PRESET_LIMITS.maxPresets + 1 },
    (_, index) => ({
      id: `preset_${index}`,
      colour: `#${index.toString(16).padStart(6, '0')}`
    })
  );
  assert.deepEqual(appearance.validateAppearanceSettings(tooMany), {
    ok: false,
    error: 'Colourful Block has too many colour presets.'
  });

  const presetWithOpacity = structuredClone(normalized);
  presetWithOpacity.blockAppearance.colourfulBlock.presets[0].opacity = 0.5;
  assert.deepEqual(appearance.validateAppearanceSettings(presetWithOpacity), {
    ok: false,
    error: 'Colour presets may contain only an ID and colour.'
  });

  const duplicateEnabled = structuredClone(normalized);
  duplicateEnabled.blockAppearance.colourfulBlock.enabled = true;
  assert.deepEqual(appearance.validateAppearanceSettings(duplicateEnabled), {
    ok: false,
    error: 'Colourful Block settings contain an unsupported field.'
  });
});

test('Block status colour variables reuse global opacity for any concrete colour', () => {
  assert.deepEqual(
    appearance.blockStatusColourVariables('#123456', {
      status1: 0.1,
      status2: 0.25,
      status3: 0.75
    }),
    {
      '--block-status-1-fill-colour': 'rgb(18 52 86 / 0.1)',
      '--block-status-1-border-colour': 'rgb(18 52 86 / 0.3)',
      '--block-status-2-fill-colour': 'rgb(18 52 86 / 0.25)',
      '--block-status-2-border-colour': 'rgb(18 52 86 / 0.75)',
      '--block-status-3-fill-colour': 'rgb(18 52 86 / 0.75)',
      '--block-status-3-border-colour': 'rgb(18 52 86 / 1)'
    }
  );
});

test('Markdown colours normalize as nullable Vault roles and validate explicit values', () => {
  const normalized = appearance.normalizeAppearanceSettings({
    markdownColours: {
      headingMode: 'by-level',
      headings: { unified: '#010203', h1: '#aabbcc', h2: 'invalid' },
      text: {
        bold: '#112233',
        italic: null,
        boldItalic: '#445566',
        strikethroughText: '#778899',
        strikethroughLine: '#ABCDEF',
        underlineText: '#123456',
        underlineLine: '#654321',
        hyperlink: '#2468AC'
      },
      code: { background: '#DDEEFF', border: null },
      symbols: { group1: '#13579B', group2: '#FDB975' }
    }
  });
  assert.equal(normalized.markdownColours.headingMode, 'by-level');
  assert.equal(normalized.markdownColours.headings.h1, '#AABBCC');
  assert.equal(normalized.markdownColours.headings.h2, null);
  assert.equal(normalized.markdownColours.text.italic, null);
  assert.equal(normalized.markdownColours.code.border, null);
  assert.equal(appearance.validateAppearanceSettings(normalized).ok, true);

  const invalid = structuredClone(normalized);
  invalid.markdownColours.text.bold = 'red';
  assert.deepEqual(appearance.validateAppearanceSettings(invalid), {
    ok: false,
    error: 'Markdown colours must be unset or use six-digit HEX values.'
  });
  invalid.markdownColours.text.bold = null;
  invalid.markdownColours.headingMode = 'separate-ish';
  assert.deepEqual(appearance.validateAppearanceSettings(invalid), {
    ok: false,
    error: 'Heading colour mode must be Unified or By level.'
  });
});

test('Markdown CSS variables preserve defaults, derive Code border, and clear stale nullable roles', () => {
  const paletteBefore = appearance.codePaletteVariables('#EEE8E0');
  const custom = appearance.cssVariablesForAppearance({
    markdownColours: {
      headingMode: 'unified',
      headings: { unified: '#112233' },
      text: { bold: '#223344', strikethroughLine: '#334455' },
      code: { background: '#AABBCC', border: null },
      symbols: { group1: '#445566', group2: '#556677' }
    }
  });
  assert.equal(custom['--md-heading-color'], '#112233');
  assert.equal(custom['--md-heading-h1-color'], undefined);
  assert.equal(custom['--md-bold-color'], '#223344');
  assert.equal(custom['--md-code-background'], '#AABBCC');
  assert.equal(custom['--md-code-border'], 'color-mix(in srgb, #AABBCC 82%, black 18%)');
  assert.equal(custom['--md-symbol-group-1'], '#445566');
  assert.equal(custom['--code-keyword'], paletteBefore['--code-keyword']);

  const explicitBorder = appearance.cssVariablesForAppearance({
    markdownColours: {
      headingMode: 'by-level',
      headings: { h2: '#010203' },
      code: { background: '#AABBCC', border: '#102030' }
    }
  });
  assert.equal(explicitBorder['--md-heading-color'], undefined);
  assert.equal(explicitBorder['--md-heading-h2-color'], '#010203');
  assert.equal(explicitBorder['--md-code-border'], '#102030');

  const defaults = appearance.cssVariablesForAppearance(null);
  assert.equal(defaults['--md-code-background'], 'var(--surface-guide)');
  assert.equal(defaults['--md-code-border'], 'var(--border-guide)');
  assert.equal(defaults['--md-bold-color'], undefined);

  const values = new Map();
  const root = {
    style: {
      setProperty: (name, value) => values.set(name, value),
      removeProperty: (name) => values.delete(name)
    },
    dataset: {}
  };
  appearance.applyAppearanceSettings(root, {
    markdownColours: {
      headingMode: 'unified',
      headings: { unified: '#112233' },
      text: { bold: '#223344' }
    }
  });
  assert.equal(values.get('--md-heading-color'), '#112233');
  assert.equal(values.get('--md-bold-color'), '#223344');
  appearance.applyAppearanceSettings(root, null);
  assert.equal(values.has('--md-heading-color'), false);
  assert.equal(values.has('--md-bold-color'), false);
  assert.equal(values.get('--md-code-background'), 'var(--surface-guide)');
});

test('appearance normalization validates vault values without losing unavailable families', () => {
  const normalized = appearance.normalizeAppearanceSettings({
    accentColour: '#1a2b3c',
    accentSoftOpacity: 0.12,
    accentStrongOpacity: 0.32,
    themeColour: 'F0E1D2',
    themeSoftOpacity: 0.14,
    fileTypography: { fontFamilies: ['Missing Font', 'Songti SC'], fontSize: 17 },
    systemTypography: { fontFamilies: ['System UI Custom'] },
    pageTypography: { fontFamilies: ['Page Family'], fontSize: 22 }
  });
  assert.deepEqual(normalized.fileTypography.fontFamilies, ['Missing Font', 'Songti SC']);
  assert.equal(normalized.fileTypography.fontSize, 17);
  assert.equal(normalized.pageTypography.fontSize, 22);
  assert.equal(normalized.accentColour, '#1A2B3C');
  assert.equal(normalized.accentSoftOpacity, 0.12);
  assert.equal(normalized.accentStrongOpacity, 0.32);
  assert.equal(normalized.themeColour, '#F0E1D2');
  assert.equal(normalized.themeSoftOpacity, 0.14);
  assert.equal(appearance.validateAppearanceSettings(normalized).ok, true);

  const invalid = appearance.normalizeAppearanceSettings({
    accentColour: 'orange',
    accentSoftOpacity: 0.8,
    accentStrongOpacity: 0.2,
    themeColour: '#12345',
    themeSoftOpacity: Number.NaN,
    fileTypography: { fontFamilies: ['A', 'a'], fontSize: 100 },
    systemTypography: { fontFamilies: 'not-an-array' },
    pageTypography: { fontFamilies: ['Page'], fontSize: Number.NaN }
  });
  assert.deepEqual(invalid.fileTypography.fontFamilies, ['system-ui']);
  assert.equal(invalid.fileTypography.fontSize, 14.4);
  assert.deepEqual(invalid.systemTypography.fontFamilies, ['system-ui']);
  assert.equal(invalid.pageTypography.fontSize, 16);
  assert.equal(invalid.accentColour, appearance.DEFAULT_APPEARANCE.accentColour);
  assert.equal(invalid.accentSoftOpacity, appearance.DEFAULT_APPEARANCE.accentSoftOpacity);
  assert.equal(invalid.accentStrongOpacity, appearance.DEFAULT_APPEARANCE.accentStrongOpacity);
  assert.equal(invalid.themeColour, appearance.DEFAULT_APPEARANCE.themeColour);
  assert.equal(invalid.themeSoftOpacity, appearance.DEFAULT_APPEARANCE.themeSoftOpacity);
});

test('semantic CSS variables use ordered fallbacks and keep title sizing application-controlled', () => {
  const variables = new Map();
  const root = { style: { setProperty: (key, value) => variables.set(key, value) } };
  appearance.applyAppearanceSettings(root, {
    accentColour: '#204060',
    accentSoftOpacity: 0.11,
    accentStrongOpacity: 0.35,
    themeColour: '#F4F4F4',
    themeSoftOpacity: 0.09,
    fileTypography: { fontFamilies: ['Missing Font', 'Songti SC'], fontSize: 15 },
    systemTypography: { fontFamilies: [], },
    pageTypography: { fontFamilies: ['Times New Roman', 'serif'], fontSize: 19 }
  });
  assert.equal(variables.get('--font-file-family'), '"Missing Font", "Songti SC", sans-serif');
  assert.equal(variables.get('--font-file-size'), '15px');
  assert.equal(variables.get('--font-file-character-width'), '15px');
  assert.equal(variables.get('--font-file-row-padding-block'), '7.5px');
  assert.equal(variables.get('--font-file-row-line-height'), '18px');
  assert.equal(variables.get('--font-system-family'), 'sans-serif');
  assert.equal(variables.get('--font-page-family'), '"Times New Roman", serif');
  assert.equal(variables.get('--font-page-body-size'), '19px');
  assert.equal(variables.get('--accent-colour'), '#204060');
  assert.equal(variables.get('--accent-soft'), 'rgb(32 64 96 / 0.11)');
  assert.equal(variables.get('--accent-strong'), 'rgb(32 64 96 / 0.35)');
  assert.equal(variables.get('--theme-colour'), '#F4F4F4');
  assert.equal(variables.get('--theme-soft'), 'rgb(244 244 244 / 0.09)');
  assert.equal(variables.get('--theme-colour-contrast'), '#1F2937');
  assert.equal(variables.has('--font-page-title-size'), false);
});

test('File row metrics recalculate from the active font family and size', () => {
  const variables = new Map();
  const context = {
    font: '',
    measureText(text) {
      const wide = this.font.includes('Wide Family');
      return {
        width: text === 'M' ? (wide ? 18 : 7) : (wide ? 30 : 15),
        actualBoundingBoxAscent: wide ? 15 : 8,
        actualBoundingBoxDescent: wide ? 4 : 2
      };
    }
  };
  const root = {
    style: { setProperty: (key, value) => variables.set(key, value) },
    ownerDocument: {
      createElement: () => ({ getContext: () => context })
    }
  };

  appearance.applyAppearanceSettings(root, {
    fileTypography: { fontFamilies: ['Wide Family'], fontSize: 16 }
  });
  assert.equal(variables.get('--font-file-character-width'), '18px');
  assert.equal(variables.get('--font-file-row-padding-block'), '9px');
  assert.equal(variables.get('--font-file-row-line-height'), '20.28px');

  appearance.applyAppearanceSettings(root, {
    fileTypography: { fontFamilies: ['Narrow Family'], fontSize: 12 }
  });
  assert.equal(variables.get('--font-file-character-width'), '7px');
  assert.equal(variables.get('--font-file-row-padding-block'), '3.5px');
  assert.equal(variables.get('--font-file-row-line-height'), '14.4px');
});

test('File row line height preserves tall font ascenders instead of clipping their tops', () => {
  const settings = appearance.normalizeAppearanceSettings({
    fileTypography: { fontFamilies: ['Tall Ascender'], fontSize: 16 }
  });
  const variables = appearance.fileTypographyMetricVariables(settings, (text) => (
    text === 'M'
      ? { width: 12 }
      : {
        width: 80,
        actualBoundingBoxAscent: 19,
        actualBoundingBoxDescent: 4,
        fontBoundingBoxAscent: 21,
        fontBoundingBoxDescent: 5
      }
  ));
  assert.equal(variables['--font-file-row-line-height'], '26px');
  assert.equal(variables['--font-file-row-padding-block'], '6px');
});

test('draft font reorder preserves order and handles insertion indices', () => {
  assert.deepEqual(
    appearance.reorderFontFamilies(['A', 'B', 'C'], 0, 3),
    ['B', 'C', 'A']
  );
  assert.deepEqual(
    appearance.reorderFontFamilies(['A', 'B', 'C'], 2, 0),
    ['C', 'A', 'B']
  );
});

test('font service returns canonical family names only and caches enumeration', async () => {
  assert.deepEqual(canonicalizeFontFamilies([' Songti SC ', '.Hidden Family', 'Arial, Arial Bold', 'arial']), [
    'Arial', 'Arial Bold', 'Songti SC'
  ]);
  assert.deepEqual(linuxFontFamilies('Arial,Arial Bold\nSongti SC\nArial\n'), [
    'Arial', 'Arial Bold', 'Songti SC'
  ]);
  assert.deepEqual(macFontFamilies(JSON.stringify({
    SPFontsDataType: [
      { family: 'Songti SC', fullname: 'Songti SC Bold', path: '/must/not/leak' },
      { family_name: 'Arial', postscript_name: 'Arial-Italic' },
      { family: '.ADT Slab Numeric' }
    ]
  })), ['Arial', 'Songti SC']);
  let calls = 0;
  const service = createFontService({
    platform: 'linux',
    run: async () => {
      calls += 1;
      return { stdout: 'Arial\nSongti SC\n' };
    }
  });
  assert.deepEqual(await service.listFontFamilies(), ['Arial', 'Songti SC']);
  assert.deepEqual(await service.listFontFamilies(), ['Arial', 'Songti SC']);
  assert.equal(calls, 1);
});

test('Manage modal is draft-only until atomic save and supports all discard routes', async () => {
  const root = path.join(__dirname, '..');
  const [ui, html, css, server, preload, main, typography] = await Promise.all([
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'server/appServer.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/typography.css'), 'utf8')
  ]);
  assert.match(ui, /openAppearanceManager\(groupKey\)/);
  assert.match(ui, /appearanceManageState[\s\S]*draft/);
  assert.match(ui, /closeAppearanceManager\(\)[\s\S]*appearanceManageState = null/);
  assert.match(ui, /event\.key === 'Escape'[\s\S]*closeAppearanceManager/);
  assert.match(ui, /event\.target === overlay\) closeAppearanceManager/);
  assert.match(ui, /cancel\.addEventListener\('click', closeAppearanceManager\)/);
  assert.match(ui, /isImeCompositionOwnedKeyEvent[\s\S]*?event\.key === 'Enter'/);
  assert.match(ui, /appearanceSettingsModel\.reorderFontFamilies/);
  assert.match(ui, /already in this stack/);
  assert.match(ui, /Select an installed font from the list/);
  assert.match(ui, /sizeSlider\.type = 'range'/);
  assert.match(ui, /if \(sizeLimits\)/);
  assert.match(ui, /appearanceSettingsModel\.applyAppearanceSettings/);
  assert.match(server, /app\.put\('\/api\/appearance'/);
  assert.match(server, /writeJsonAtomic\(APPEARANCE_PATH, validation\.appearance\)/);
  assert.match(preload, /listSystemFontFamilies/);
  assert.match(main, /LIST_SYSTEM_FONTS/);
  assert.match(html, /data-appearance-manage="fileTypography"/);
  assert.match(html, /data-appearance-manage="systemTypography"/);
  assert.match(html, /data-appearance-manage="pageTypography"/);
  assert.match(css, /\.appearance-manage-overlay[\s\S]*z-index: 120/);
  assert.match(typography, /--font-page-title-size: calc\(var\(--font-page-body-size\) - 1\.6px\)/);
});

test('drawn disclosures share two strokes and never depend on literal glyphs', async () => {
  const css = await fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.doesNotMatch(css, /\.disclosure-chevron[\s\S]{0,500}content:\s*['"][>▶▼]['"]/);
  assert.match(css, /\.disclosure-chevron::before,[\s\S]*\.disclosure-chevron::after/);
  assert.match(css, /rotate\(40deg\)/);
  assert.match(css, /rotate\(-40deg\)/);
  assert.match(css, /\[aria-expanded="true"\] > \.disclosure-chevron[\s\S]*rotate\(90deg\)/);
});
