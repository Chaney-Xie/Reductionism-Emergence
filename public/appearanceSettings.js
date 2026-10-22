(function initAppearanceSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.appearanceSettingsModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const GROUP_KEYS = Object.freeze(['fileTypography', 'systemTypography', 'pageTypography']);
  const GENERIC_FAMILIES = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji',
    'math', 'fangsong', '-apple-system'
  ]);
  const BLOCK_COLOUR_PRESET_LIMITS = Object.freeze({ maxPresets: 64, maxIdLength: 64 });
  const DEFAULT_BLOCK_APPEARANCE = Object.freeze({
    colourful: false,
    colourfulBlock: Object.freeze({
      presets: Object.freeze([]),
      lastUsedColour: '#6785A3'
    }),
    monochrome: Object.freeze({
      colour: '#6785A3',
      opacity: Object.freeze({ status1: 0, status2: 0.35, status3: 0.65 }),
      borderWidth: 2
    })
  });
  const DEFAULT_MARKDOWN_COLOURS = Object.freeze({
    headingMode: 'unified',
    headings: Object.freeze({
      unified: null,
      h1: null,
      h2: null,
      h3: null,
      h4: null,
      h5: null,
      h6: null
    }),
    text: Object.freeze({
      bold: null,
      italic: null,
      boldItalic: null,
      strikethroughText: null,
      strikethroughLine: null,
      underlineText: null,
      underlineLine: null,
      hyperlink: null
    }),
    code: Object.freeze({ background: null, border: null }),
    symbols: Object.freeze({ group1: null, group2: null })
  });
  const MARKDOWN_COLOUR_PATHS = Object.freeze([
    Object.freeze(['headings', 'unified']),
    ...[1, 2, 3, 4, 5, 6].map((level) => Object.freeze(['headings', `h${level}`])),
    ...[
      'bold', 'italic', 'boldItalic', 'strikethroughText', 'strikethroughLine',
      'underlineText', 'underlineLine', 'hyperlink'
    ].map((key) => Object.freeze(['text', key])),
    Object.freeze(['code', 'background']),
    Object.freeze(['code', 'border']),
    Object.freeze(['symbols', 'group1']),
    Object.freeze(['symbols', 'group2'])
  ]);
  const OPTIONAL_MARKDOWN_CSS_VARIABLES = Object.freeze([
    '--md-heading-color',
    '--md-heading-h1-color',
    '--md-heading-h2-color',
    '--md-heading-h3-color',
    '--md-heading-h4-color',
    '--md-heading-h5-color',
    '--md-heading-h6-color',
    '--md-bold-color',
    '--md-italic-color',
    '--md-bold-italic-color',
    '--md-strike-text-color',
    '--md-strike-line-color',
    '--md-underline-text-color',
    '--md-underline-line-color',
    '--md-link-color',
    '--md-symbol-group-1',
    '--md-symbol-group-2'
  ]);
  const DEFAULT_APPEARANCE = Object.freeze({
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
    blockAppearance: DEFAULT_BLOCK_APPEARANCE,
    markdownColours: DEFAULT_MARKDOWN_COLOURS,
    fileTypography: Object.freeze({ fontFamilies: Object.freeze(['system-ui']), fontSize: 14.4 }),
    systemTypography: Object.freeze({ fontFamilies: Object.freeze(['system-ui']) }),
    pageTypography: Object.freeze({ fontFamilies: Object.freeze(['system-ui']), fontSize: 16 })
  });
  const CODE_PALETTE = Object.freeze({
    '--code-fg': '#D4D4D4',
    '--code-muted': '#808080',
    '--code-comment': '#6A9955',
    '--code-keyword': '#C586C0',
    '--code-control': '#C586C0',
    '--code-string': '#CE9178',
    '--code-number': '#B5CEA8',
    '--code-function': '#DCDCAA',
    '--code-variable': '#9CDCFE',
    '--code-type': '#4EC9B0',
    '--code-class': '#4EC9B0',
    '--code-property': '#9CDCFE',
    '--code-constant': '#4FC1FF',
    '--code-tag': '#569CD6',
    '--code-attribute': '#9CDCFE',
    '--code-regexp': '#D16969',
    '--code-operator': '#D4D4D4',
    '--code-punctuation': '#D4D4D4',
    '--code-invalid': '#F44747'
  });
  const SIZE_LIMITS = Object.freeze({
    fileTypography: Object.freeze({ min: 10, max: 24, step: 0.1 }),
    pageTypography: Object.freeze({ min: 10, max: 32, step: 1 })
  });
  const fileTypographyMetricGenerations = new WeakMap();

  function cloneDefaults() {
    return {
      toolSurfaceColour: DEFAULT_APPEARANCE.toolSurfaceColour,
      toolBorderColour: DEFAULT_APPEARANCE.toolBorderColour,
      guideSurfaceColour: DEFAULT_APPEARANCE.guideSurfaceColour,
      guideSectionBrightnessAdjustment: DEFAULT_APPEARANCE.guideSectionBrightnessAdjustment,
      guideBorderBrightnessAdjustment: DEFAULT_APPEARANCE.guideBorderBrightnessAdjustment,
      canvasSurfaceColour: DEFAULT_APPEARANCE.canvasSurfaceColour,
      canvasBorderColour: DEFAULT_APPEARANCE.canvasBorderColour,
      accentColour: DEFAULT_APPEARANCE.accentColour,
      accentSoftOpacity: DEFAULT_APPEARANCE.accentSoftOpacity,
      accentStrongOpacity: DEFAULT_APPEARANCE.accentStrongOpacity,
      themeColour: DEFAULT_APPEARANCE.themeColour,
      themeSoftOpacity: DEFAULT_APPEARANCE.themeSoftOpacity,
      blockAppearance: {
        colourful: DEFAULT_BLOCK_APPEARANCE.colourful,
        colourfulBlock: {
          presets: [],
          lastUsedColour: DEFAULT_BLOCK_APPEARANCE.colourfulBlock.lastUsedColour
        },
        monochrome: {
          colour: DEFAULT_BLOCK_APPEARANCE.monochrome.colour,
          opacity: { ...DEFAULT_BLOCK_APPEARANCE.monochrome.opacity },
          borderWidth: DEFAULT_BLOCK_APPEARANCE.monochrome.borderWidth
        }
      },
      markdownColours: {
        headingMode: DEFAULT_MARKDOWN_COLOURS.headingMode,
        headings: { ...DEFAULT_MARKDOWN_COLOURS.headings },
        text: { ...DEFAULT_MARKDOWN_COLOURS.text },
        code: { ...DEFAULT_MARKDOWN_COLOURS.code },
        symbols: { ...DEFAULT_MARKDOWN_COLOURS.symbols }
      },
      fileTypography: { fontFamilies: [...DEFAULT_APPEARANCE.fileTypography.fontFamilies], fontSize: 14.4 },
      systemTypography: { fontFamilies: [...DEFAULT_APPEARANCE.systemTypography.fontFamilies] },
      pageTypography: { fontFamilies: [...DEFAULT_APPEARANCE.pageTypography.fontFamilies], fontSize: 16 }
    };
  }

  function normalizeHexColour(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const hex = value.trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : fallback;
  }

  function normalizeBlockColourPresetId(value) {
    if (typeof value !== 'string') return '';
    const id = value.trim();
    return id.length <= BLOCK_COLOUR_PRESET_LIMITS.maxIdLength
      && /^[a-z0-9_-]+$/i.test(id) ? id : '';
  }

  function normalizeBlockColourPresets(value) {
    if (!Array.isArray(value)) return [];
    const presets = [];
    const seenIds = new Set();
    const seenColours = new Set();
    for (const candidate of value.slice(0, BLOCK_COLOUR_PRESET_LIMITS.maxPresets)) {
      const id = normalizeBlockColourPresetId(candidate?.id);
      const colour = normalizeHexColour(candidate?.colour);
      const idKey = id.toLocaleLowerCase();
      if (!id || !colour || seenIds.has(idKey) || seenColours.has(colour)) continue;
      seenIds.add(idKey);
      seenColours.add(colour);
      presets.push({ id, colour });
    }
    return presets;
  }

  function normalizeOptionalColour(value) {
    return normalizeHexColour(value) || null;
  }

  function hexToRgb(value) {
    const hex = normalizeHexColour(value);
    if (!hex) return null;
    return {
      r: Number.parseInt(hex.slice(1, 3), 16),
      g: Number.parseInt(hex.slice(3, 5), 16),
      b: Number.parseInt(hex.slice(5, 7), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const values = [r, g, b];
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return '';
    return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  function rgbToHsv(r, g, b) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    let h = 0;
    if (delta) {
      if (maximum === red) h = 60 * (((green - blue) / delta) % 6);
      else if (maximum === green) h = 60 * ((blue - red) / delta + 2);
      else h = 60 * ((red - green) / delta + 4);
    }
    if (h < 0) h += 360;
    return { h, s: maximum ? delta / maximum : 0, v: maximum };
  }

  function hsvToRgb(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const saturation = Math.max(0, Math.min(1, Number(s)));
    const value = Math.max(0, Math.min(1, Number(v)));
    const chroma = value * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    const pairs = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
    const [red, green, blue] = pairs[Math.min(5, Math.floor(segment))];
    const match = value - chroma;
    return {
      r: Math.round((red + match) * 255),
      g: Math.round((green + match) * 255),
      b: Math.round((blue + match) * 255)
    };
  }

  function mixHexColours(foreground, background, foregroundWeight) {
    const front = hexToRgb(foreground);
    const back = hexToRgb(background);
    const weight = Math.max(0, Math.min(1, foregroundWeight));
    if (!front || !back) return background;
    return rgbToHex(
      Math.round(front.r * weight + back.r * (1 - weight)),
      Math.round(front.g * weight + back.g * (1 - weight)),
      Math.round(front.b * weight + back.b * (1 - weight))
    );
  }

  function contrastColour(value) {
    const rgb = hexToRgb(value);
    if (!rgb) return '#FFFFFF';
    const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    const whiteContrast = 1.05 / (luminance + 0.05);
    const darkContrast = (luminance + 0.05) / 0.05;
    return whiteContrast >= darkContrast ? '#FFFFFF' : '#1F2937';
  }

  function relativeLuminance(value) {
    const rgb = hexToRgb(value);
    if (!rgb) return 0;
    const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function colourContrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function rgbToHsl(r, g, b) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    const lightness = (maximum + minimum) / 2;
    if (!delta) return { h: 0, s: 0, l: lightness };
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
    if (hue < 0) hue += 360;
    return { h: hue, s: saturation, l: lightness };
  }

  function hslToRgb(h, s, l) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const saturation = Math.max(0, Math.min(1, Number(s)));
    const lightness = Math.max(0, Math.min(1, Number(l)));
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    const pairs = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
    const [red, green, blue] = pairs[Math.min(5, Math.floor(segment))];
    const match = lightness - chroma / 2;
    return {
      r: Math.round((red + match) * 255),
      g: Math.round((green + match) * 255),
      b: Math.round((blue + match) * 255)
    };
  }

  function readableCodeColour(value, background, minimumContrast = 4.5) {
    const foreground = normalizeHexColour(value);
    const surface = normalizeHexColour(background);
    if (!foreground || !surface || colourContrastRatio(foreground, surface) >= minimumContrast) {
      return foreground || value;
    }
    const rgb = hexToRgb(foreground);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    for (let step = 1; step <= 1000; step += 1) {
      const distance = step / 1000;
      const candidates = [hsl.l - distance, hsl.l + distance]
        .filter((lightness) => lightness >= 0 && lightness <= 1)
        .map((lightness) => {
          const candidateRgb = hslToRgb(hsl.h, hsl.s, lightness);
          return rgbToHex(candidateRgb.r, candidateRgb.g, candidateRgb.b);
        });
      const readable = candidates.find(
        (candidate) => colourContrastRatio(candidate, surface) >= minimumContrast
      );
      if (readable) return readable;
    }
    return contrastColour(surface);
  }

  function codePaletteVariables(background) {
    const surface = normalizeHexColour(background, DEFAULT_APPEARANCE.guideSurfaceColour);
    return Object.fromEntries(Object.entries(CODE_PALETTE).map(([name, value]) => [
      name,
      readableCodeColour(value, surface, name === '--code-muted' ? 3.5 : 4.5)
    ]));
  }

  function cleanFamilyName(value) {
    if (typeof value !== 'string') return '';
    const name = value.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return '';
    return name;
  }

  function normalizedFamilyList(value, fallback) {
    if (!Array.isArray(value) || value.length > 32) return [...fallback];
    const result = [];
    const seen = new Set();
    for (const rawName of value) {
      const name = cleanFamilyName(rawName);
      if (!name) return [...fallback];
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return [...fallback];
      seen.add(key);
      result.push(name);
    }
    return result;
  }

  function familyListIsValid(value) {
    if (!Array.isArray(value) || value.length > 32) return false;
    const seen = new Set();
    for (const rawName of value) {
      const name = cleanFamilyName(rawName);
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }

  function normalizedSize(value, groupKey) {
    const limits = SIZE_LIMITS[groupKey];
    const fallback = DEFAULT_APPEARANCE[groupKey].fontSize;
    return typeof value === 'number' && Number.isFinite(value)
      && value >= limits.min && value <= limits.max ? value : fallback;
  }

  function normalizedOpacity(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value : fallback;
  }

  function cssAlpha(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
  }

  function normalizedBrightnessAdjustment(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.5
      ? value : fallback;
  }

  function reduceHexBrightness(value, adjustment) {
    const rgb = hexToRgb(value);
    if (!rgb) return value;
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const reduced = hsvToRgb(hsv.h, hsv.s, Math.max(0, hsv.v - adjustment));
    return rgbToHex(reduced.r, reduced.g, reduced.b);
  }

  function normalizeAppearanceSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = cloneDefaults();
    for (const colourKey of [
      'toolSurfaceColour', 'toolBorderColour', 'guideSurfaceColour',
      'canvasSurfaceColour', 'canvasBorderColour'
    ]) {
      normalized[colourKey] = normalizeHexColour(source[colourKey], DEFAULT_APPEARANCE[colourKey]);
    }
    normalized.guideSectionBrightnessAdjustment = normalizedBrightnessAdjustment(
      source.guideSectionBrightnessAdjustment,
      DEFAULT_APPEARANCE.guideSectionBrightnessAdjustment
    );
    normalized.guideBorderBrightnessAdjustment = normalizedBrightnessAdjustment(
      source.guideBorderBrightnessAdjustment,
      DEFAULT_APPEARANCE.guideBorderBrightnessAdjustment
    );
    normalized.accentColour = normalizeHexColour(source.accentColour, DEFAULT_APPEARANCE.accentColour);
    normalized.accentSoftOpacity = normalizedOpacity(
      source.accentSoftOpacity,
      DEFAULT_APPEARANCE.accentSoftOpacity
    );
    normalized.accentStrongOpacity = normalizedOpacity(
      source.accentStrongOpacity,
      DEFAULT_APPEARANCE.accentStrongOpacity
    );
    if (normalized.accentSoftOpacity >= normalized.accentStrongOpacity) {
      normalized.accentSoftOpacity = DEFAULT_APPEARANCE.accentSoftOpacity;
      normalized.accentStrongOpacity = DEFAULT_APPEARANCE.accentStrongOpacity;
    }
    normalized.themeColour = normalizeHexColour(source.themeColour, DEFAULT_APPEARANCE.themeColour);
    normalized.themeSoftOpacity = normalizedOpacity(
      source.themeSoftOpacity,
      DEFAULT_APPEARANCE.themeSoftOpacity
    );
    const blockAppearance = source.blockAppearance && typeof source.blockAppearance === 'object'
      ? source.blockAppearance : {};
    const monochrome = blockAppearance.monochrome && typeof blockAppearance.monochrome === 'object'
      ? blockAppearance.monochrome : {};
    const opacity = monochrome.opacity && typeof monochrome.opacity === 'object'
      ? monochrome.opacity : {};
    normalized.blockAppearance.colourful = typeof blockAppearance.colourful === 'boolean'
      ? blockAppearance.colourful : DEFAULT_BLOCK_APPEARANCE.colourful;
    normalized.blockAppearance.monochrome.colour = normalizeHexColour(
      monochrome.colour,
      DEFAULT_BLOCK_APPEARANCE.monochrome.colour
    );
    for (const status of ['status1', 'status2', 'status3']) {
      normalized.blockAppearance.monochrome.opacity[status] = normalizedOpacity(
        opacity[status],
        DEFAULT_BLOCK_APPEARANCE.monochrome.opacity[status]
      );
    }
    normalized.blockAppearance.monochrome.borderWidth = typeof monochrome.borderWidth === 'number'
      && Number.isFinite(monochrome.borderWidth) && monochrome.borderWidth >= 0
      ? monochrome.borderWidth : DEFAULT_BLOCK_APPEARANCE.monochrome.borderWidth;
    const colourfulBlock = blockAppearance.colourfulBlock
      && typeof blockAppearance.colourfulBlock === 'object'
      && !Array.isArray(blockAppearance.colourfulBlock)
      ? blockAppearance.colourfulBlock : {};
    normalized.blockAppearance.colourfulBlock.presets = normalizeBlockColourPresets(
      colourfulBlock.presets
    );
    normalized.blockAppearance.colourfulBlock.lastUsedColour = normalizeHexColour(
      colourfulBlock.lastUsedColour,
      normalized.blockAppearance.monochrome.colour
    );
    const markdownColours = source.markdownColours && typeof source.markdownColours === 'object'
      ? source.markdownColours : {};
    normalized.markdownColours.headingMode = markdownColours.headingMode === 'by-level'
      ? 'by-level' : 'unified';
    for (const [groupKey, colourKey] of MARKDOWN_COLOUR_PATHS) {
      normalized.markdownColours[groupKey][colourKey] = normalizeOptionalColour(
        markdownColours[groupKey]?.[colourKey]
      );
    }
    for (const groupKey of GROUP_KEYS) {
      const group = source[groupKey] && typeof source[groupKey] === 'object'
        ? source[groupKey] : {};
      normalized[groupKey].fontFamilies = normalizedFamilyList(
        group.fontFamilies,
        DEFAULT_APPEARANCE[groupKey].fontFamilies
      );
      if (SIZE_LIMITS[groupKey]) normalized[groupKey].fontSize = normalizedSize(group.fontSize, groupKey);
    }
    return normalized;
  }

  function validateAppearanceSettings(value) {
    if (!value || typeof value !== 'object') {
      return { ok: false, error: 'Appearance settings are required.' };
    }
    for (const colourKey of [
      'toolSurfaceColour', 'toolBorderColour', 'guideSurfaceColour',
      'canvasSurfaceColour', 'canvasBorderColour', 'accentColour', 'themeColour'
    ]) {
      if (value[colourKey] !== undefined && !normalizeHexColour(value[colourKey])) {
        return { ok: false, error: 'Colours must use six-digit HEX values.' };
      }
    }
    for (const brightnessKey of [
      'guideSectionBrightnessAdjustment', 'guideBorderBrightnessAdjustment'
    ]) {
      const adjustment = value[brightnessKey];
      if (adjustment !== undefined && (typeof adjustment !== 'number'
        || !Number.isFinite(adjustment) || adjustment < 0 || adjustment > 0.5)) {
        return { ok: false, error: 'Guide brightness adjustments must be between 0% and 50%.' };
      }
    }
    for (const opacityKey of ['accentSoftOpacity', 'accentStrongOpacity', 'themeSoftOpacity']) {
      const opacity = value[opacityKey];
      if (opacity !== undefined && (typeof opacity !== 'number' || !Number.isFinite(opacity)
        || opacity < 0 || opacity > 1)) {
        return { ok: false, error: 'Opacity must be between 0% and 100%.' };
      }
    }
    const accentSoftOpacity = value.accentSoftOpacity ?? DEFAULT_APPEARANCE.accentSoftOpacity;
    const accentStrongOpacity = value.accentStrongOpacity ?? DEFAULT_APPEARANCE.accentStrongOpacity;
    if (accentSoftOpacity >= accentStrongOpacity) {
      return { ok: false, error: 'Accent soft opacity must be lower than Accent strong opacity.' };
    }
    if (value.blockAppearance !== undefined) {
      const blockAppearance = value.blockAppearance;
      const monochrome = blockAppearance?.monochrome;
      const opacity = monochrome?.opacity;
      if (!blockAppearance || typeof blockAppearance !== 'object'
        || typeof blockAppearance.colourful !== 'boolean') {
        return { ok: false, error: 'Colourful Block must be on or off.' };
      }
      if (!monochrome || typeof monochrome !== 'object'
        || !normalizeHexColour(monochrome.colour)) {
        return { ok: false, error: 'Block colour must use a six-digit HEX value.' };
      }
      const colourfulBlock = blockAppearance.colourfulBlock;
      if (colourfulBlock !== undefined) {
        if (!colourfulBlock || typeof colourfulBlock !== 'object'
          || Array.isArray(colourfulBlock)) {
          return { ok: false, error: 'Colourful Block settings must be an object.' };
        }
        const colourfulKeys = Object.keys(colourfulBlock);
        if (colourfulKeys.some((key) => !['presets', 'lastUsedColour'].includes(key))) {
          return { ok: false, error: 'Colourful Block settings contain an unsupported field.' };
        }
        if (colourfulBlock.presets !== undefined) {
          if (!Array.isArray(colourfulBlock.presets)
            || colourfulBlock.presets.length > BLOCK_COLOUR_PRESET_LIMITS.maxPresets) {
            return { ok: false, error: 'Colourful Block has too many colour presets.' };
          }
          const ids = new Set();
          const colours = new Set();
          for (const preset of colourfulBlock.presets) {
            if (!preset || typeof preset !== 'object' || Array.isArray(preset)
              || Object.keys(preset).some((key) => !['id', 'colour'].includes(key))) {
              return { ok: false, error: 'Colour presets may contain only an ID and colour.' };
            }
            const id = normalizeBlockColourPresetId(preset.id);
            const colour = normalizeHexColour(preset.colour);
            const idKey = id.toLocaleLowerCase();
            if (!id || !colour) {
              return { ok: false, error: 'Colour presets require a stable ID and six-digit HEX colour.' };
            }
            if (ids.has(idKey) || colours.has(colour)) {
              return { ok: false, error: 'Colour preset IDs and colours must be unique.' };
            }
            ids.add(idKey);
            colours.add(colour);
          }
        }
        if (colourfulBlock.lastUsedColour !== undefined
          && !normalizeHexColour(colourfulBlock.lastUsedColour)) {
          return { ok: false, error: 'Last used Block colour must use a six-digit HEX value.' };
        }
      }
      if (!opacity || typeof opacity !== 'object'
        || ['status1', 'status2', 'status3'].some((status) => (
          typeof opacity[status] !== 'number' || !Number.isFinite(opacity[status])
          || opacity[status] < 0 || opacity[status] > 1
        ))) {
        return { ok: false, error: 'Block opacity must be between 0% and 100%.' };
      }
      if (typeof monochrome.borderWidth !== 'number'
        || !Number.isFinite(monochrome.borderWidth) || monochrome.borderWidth < 0) {
        return { ok: false, error: 'Block border width must be a finite non-negative number.' };
      }
    }
    if (value.markdownColours !== undefined) {
      const markdownColours = value.markdownColours;
      if (!markdownColours || typeof markdownColours !== 'object'
        || !['unified', 'by-level'].includes(markdownColours.headingMode)) {
        return { ok: false, error: 'Heading colour mode must be Unified or By level.' };
      }
      for (const [groupKey, colourKey] of MARKDOWN_COLOUR_PATHS) {
        const group = markdownColours[groupKey];
        const colour = group?.[colourKey];
        if (!group || typeof group !== 'object'
          || (colour !== null && colour !== undefined && !normalizeHexColour(colour))) {
          return { ok: false, error: 'Markdown colours must be unset or use six-digit HEX values.' };
        }
      }
    }
    for (const groupKey of GROUP_KEYS) {
      const group = value[groupKey];
      if (!group || typeof group !== 'object' || !Array.isArray(group.fontFamilies)) {
        return { ok: false, error: 'Every font group needs an ordered font list.' };
      }
      if (!familyListIsValid(group.fontFamilies)) {
        return { ok: false, error: 'A font list contains an invalid or duplicate family name.' };
      }
      if (SIZE_LIMITS[groupKey]) {
        const size = group.fontSize;
        const { min, max } = SIZE_LIMITS[groupKey];
        if (typeof size !== 'number' || !Number.isFinite(size) || size < min || size > max) {
          return { ok: false, error: `Font size must be between ${min} and ${max} px.` };
        }
      }
    }
    return { ok: true, appearance: normalizeAppearanceSettings(value) };
  }

  function quotedCssFamily(name) {
    const lower = name.toLocaleLowerCase();
    if (GENERIC_FAMILIES.has(lower)) return name;
    return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function fontStackCss(fontFamilies) {
    const families = normalizedFamilyList(fontFamilies, []);
    const hasGeneric = families.some((name) => GENERIC_FAMILIES.has(name.toLocaleLowerCase()));
    const result = families.map(quotedCssFamily);
    if (!hasGeneric) result.push('sans-serif');
    return result.join(', ') || 'sans-serif';
  }

  function metricPixels(value) {
    return `${Math.round(value * 1000) / 1000}px`;
  }

  function fileTypographyMetricVariables(settings, measureText) {
    const fontSize = settings.fileTypography.fontSize;
    let characterWidth = fontSize;
    let textHeight = fontSize * 1.2;
    if (typeof measureText === 'function') {
      const widthMetrics = measureText('M');
      const heightMetrics = measureText('HÁÉÅgjpq国');
      if (Number.isFinite(widthMetrics?.width) && widthMetrics.width > 0) {
        characterWidth = widthMetrics.width;
      }
      const actualHeight = Number(heightMetrics?.actualBoundingBoxAscent)
        + Number(heightMetrics?.actualBoundingBoxDescent);
      const fontBoxHeight = Number(heightMetrics?.fontBoundingBoxAscent)
        + Number(heightMetrics?.fontBoundingBoxDescent);
      const bufferedActualHeight = Number.isFinite(actualHeight) && actualHeight > 0
        ? actualHeight + fontSize * 0.08
        : 0;
      textHeight = Math.max(
        textHeight,
        Number.isFinite(fontBoxHeight) && fontBoxHeight > 0 ? fontBoxHeight : 0,
        bufferedActualHeight
      );
    }
    return {
      '--font-file-character-width': metricPixels(characterWidth),
      '--font-file-row-padding-block': metricPixels(characterWidth / 2),
      '--font-file-row-line-height': metricPixels(textHeight)
    };
  }

  function updateFileTypographyMetrics(rootElement, settings) {
    const documentRef = rootElement?.ownerDocument;
    if (!documentRef?.createElement || !rootElement?.style?.setProperty) return;
    const generation = (fileTypographyMetricGenerations.get(rootElement) || 0) + 1;
    fileTypographyMetricGenerations.set(rootElement, generation);
    const measureAndApply = () => {
      if (fileTypographyMetricGenerations.get(rootElement) !== generation) return;
      try {
        const context = documentRef.createElement('canvas').getContext?.('2d');
        if (!context) return;
        context.font = `400 ${settings.fileTypography.fontSize}px ${fontStackCss(settings.fileTypography.fontFamilies)}`;
        const variables = fileTypographyMetricVariables(
          settings,
          (text) => context.measureText(text)
        );
        for (const [name, cssValue] of Object.entries(variables)) {
          rootElement.style.setProperty(name, cssValue);
        }
      } catch {
        // The size-derived fallback variables remain valid when canvas metrics are unavailable.
      }
    };
    measureAndApply();
    documentRef.fonts?.ready?.then(measureAndApply)?.catch?.(() => {});
  }

  function cssVariablesForAppearance(value) {
    const settings = normalizeAppearanceSettings(value);
    const accentRgb = hexToRgb(settings.accentColour);
    const themeRgb = hexToRgb(settings.themeColour);
    const blockStatusVariables = blockStatusColourVariables(
      settings.blockAppearance.monochrome.colour,
      settings.blockAppearance.monochrome.opacity
    );
    const markdownVariables = {};
    const markdownColours = settings.markdownColours;
    if (markdownColours.headingMode === 'unified') {
      if (markdownColours.headings.unified) {
        markdownVariables['--md-heading-color'] = markdownColours.headings.unified;
      }
    } else {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const colour = markdownColours.headings[`h${level}`];
        if (colour) markdownVariables[`--md-heading-h${level}-color`] = colour;
      }
    }
    const markdownTextVariables = {
      bold: '--md-bold-color',
      italic: '--md-italic-color',
      boldItalic: '--md-bold-italic-color',
      strikethroughText: '--md-strike-text-color',
      strikethroughLine: '--md-strike-line-color',
      underlineText: '--md-underline-text-color',
      underlineLine: '--md-underline-line-color',
      hyperlink: '--md-link-color'
    };
    for (const [colourKey, variableName] of Object.entries(markdownTextVariables)) {
      const colour = markdownColours.text[colourKey];
      if (colour) markdownVariables[variableName] = colour;
    }
    if (markdownColours.symbols.group1) {
      markdownVariables['--md-symbol-group-1'] = markdownColours.symbols.group1;
    }
    if (markdownColours.symbols.group2) {
      markdownVariables['--md-symbol-group-2'] = markdownColours.symbols.group2;
    }
    markdownVariables['--md-code-background'] = markdownColours.code.background
      || 'var(--surface-guide)';
    markdownVariables['--md-code-border'] = markdownColours.code.border
      || (markdownColours.code.background
        ? `color-mix(in srgb, ${markdownColours.code.background} 82%, black 18%)`
        : 'var(--border-guide)');
    return {
      '--surface-tool': settings.toolSurfaceColour,
      '--border-tool': settings.toolBorderColour,
      '--surface-guide': settings.guideSurfaceColour,
      ...codePaletteVariables(settings.guideSurfaceColour),
      '--surface-guide-section': reduceHexBrightness(
        settings.guideSurfaceColour,
        settings.guideSectionBrightnessAdjustment
      ),
      '--border-guide': reduceHexBrightness(
        settings.guideSurfaceColour,
        settings.guideBorderBrightnessAdjustment
      ),
      '--surface-canvas': settings.canvasSurfaceColour,
      '--border-canvas': settings.canvasBorderColour,
      '--accent-colour': settings.accentColour,
      '--accent-soft': `rgb(${accentRgb.r} ${accentRgb.g} ${accentRgb.b} / ${settings.accentSoftOpacity})`,
      '--accent-strong': `rgb(${accentRgb.r} ${accentRgb.g} ${accentRgb.b} / ${settings.accentStrongOpacity})`,
      '--accent-colour-pressed': mixHexColours(settings.accentColour, '#000000', 0.82),
      '--accent-colour-contrast': contrastColour(settings.accentColour),
      '--theme-colour': settings.themeColour,
      '--theme-soft': `rgb(${themeRgb.r} ${themeRgb.g} ${themeRgb.b} / ${settings.themeSoftOpacity})`,
      '--theme-colour-hover': mixHexColours(settings.themeColour, '#000000', 0.9),
      '--theme-colour-active': mixHexColours(settings.themeColour, '#000000', 0.82),
      '--theme-colour-contrast': contrastColour(settings.themeColour),
      '--block-border-width': `${settings.blockAppearance.monochrome.borderWidth}px`,
      ...blockStatusVariables,
      ...markdownVariables,
      '--font-file-family': fontStackCss(settings.fileTypography.fontFamilies),
      '--font-file-size': `${settings.fileTypography.fontSize}px`,
      ...fileTypographyMetricVariables(settings),
      '--font-system-family': fontStackCss(settings.systemTypography.fontFamilies),
      '--font-page-family': fontStackCss(settings.pageTypography.fontFamilies),
      '--font-page-body-size': `${settings.pageTypography.fontSize}px`
    };
  }

  function blockStatusColourVariables(concreteColour, opacity = {}) {
    const colour = normalizeHexColour(concreteColour, DEFAULT_BLOCK_APPEARANCE.monochrome.colour);
    const blockRgb = hexToRgb(colour);
    const blockRgbChannels = `${blockRgb.r} ${blockRgb.g} ${blockRgb.b}`;
    const variables = {};
    for (const status of [1, 2, 3]) {
      const key = `status${status}`;
      const fillAlpha = cssAlpha(normalizedOpacity(
        opacity?.[key],
        DEFAULT_BLOCK_APPEARANCE.monochrome.opacity[key]
      ));
      const borderAlpha = cssAlpha(fillAlpha * 3);
      variables[`--block-status-${status}-fill-colour`] =
        `rgb(${blockRgbChannels} / ${fillAlpha})`;
      variables[`--block-status-${status}-border-colour`] =
        `rgb(${blockRgbChannels} / ${borderAlpha})`;
    }
    return variables;
  }

  function applyAppearanceSettings(rootElement, value) {
    const settings = normalizeAppearanceSettings(value);
    const variables = cssVariablesForAppearance(settings);
    if (rootElement?.style?.setProperty) {
      for (const name of OPTIONAL_MARKDOWN_CSS_VARIABLES) {
        if (rootElement.style.removeProperty) rootElement.style.removeProperty(name);
        else rootElement.style.setProperty(name, '');
      }
      for (const [name, cssValue] of Object.entries(variables)) {
        rootElement.style.setProperty(name, cssValue);
      }
      if (rootElement.dataset) {
        rootElement.dataset.blockColourful = String(settings.blockAppearance.colourful);
      } else {
        rootElement.setAttribute?.('data-block-colourful', String(settings.blockAppearance.colourful));
      }
      updateFileTypographyMetrics(rootElement, settings);
    }
    return settings;
  }

  function reorderFontFamilies(fontFamilies, fromIndex, insertionIndex) {
    const result = [...fontFamilies];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(insertionIndex)
      || fromIndex < 0 || fromIndex >= result.length
      || insertionIndex < 0 || insertionIndex > result.length) return result;
    const [moved] = result.splice(fromIndex, 1);
    const targetIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
    result.splice(targetIndex, 0, moved);
    return result;
  }

  function isGenericFamily(name) {
    return GENERIC_FAMILIES.has(cleanFamilyName(name).toLocaleLowerCase());
  }

  return {
    BLOCK_COLOUR_PRESET_LIMITS,
    DEFAULT_APPEARANCE,
    DEFAULT_BLOCK_APPEARANCE,
    DEFAULT_MARKDOWN_COLOURS,
    CODE_PALETTE,
    GROUP_KEYS,
    MARKDOWN_COLOUR_PATHS,
    OPTIONAL_MARKDOWN_CSS_VARIABLES,
    SIZE_LIMITS,
    applyAppearanceSettings,
    blockStatusColourVariables,
    cleanFamilyName,
    codePaletteVariables,
    colourContrastRatio,
    contrastColour,
    cssVariablesForAppearance,
    fileTypographyMetricVariables,
    fontStackCss,
    hexToRgb,
    hsvToRgb,
    isGenericFamily,
    normalizeHexColour,
    normalizeBlockColourPresetId,
    normalizeBlockColourPresets,
    normalizedBrightnessAdjustment,
    normalizedOpacity,
    normalizeAppearanceSettings,
    reduceHexBrightness,
    reorderFontFamilies,
    rgbToHex,
    rgbToHsv,
    validateAppearanceSettings
  };
}));
