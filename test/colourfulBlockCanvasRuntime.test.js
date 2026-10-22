'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const appearanceSettingsModel = require('../public/appearanceSettings');
const {
  createColourfulCanvasHarness
} = require('./helpers/colourfulCanvasHarness');

const COLOURFUL_VARIABLE_NAMES = Object.freeze(
  [1, 2, 3].flatMap((status) => [
    `--block-colourful-status-${status}-fill-colour`,
    `--block-colourful-status-${status}-border-colour`
  ])
);

function appearance({
  colourful = true,
  presets = [],
  lastUsedColour = '#AA1122',
  monochromeColour = '#345678',
  opacity = { status1: 0.1, status2: 0.35, status3: 0.7 },
  borderWidth = 2
} = {}) {
  return appearanceSettingsModel.normalizeAppearanceSettings({
    blockAppearance: {
      colourful,
      colourfulBlock: { presets, lastUsedColour },
      monochrome: { colour: monochromeColour, opacity, borderWidth }
    }
  });
}

function blocks(api) {
  return JSON.parse(api.blocksJson());
}

function drawing(api) {
  const value = api.drawingJson();
  return value === 'null' ? null : JSON.parse(value);
}

function colourfulVariables(colour, settings) {
  return Object.fromEntries(Object.entries(
    appearanceSettingsModel.blockStatusColourVariables(
      colour,
      settings.blockAppearance.monochrome.opacity
    )
  ).map(([name, value]) => [
    name.replace('--block-status-', '--block-colourful-status-'),
    value
  ]));
}

function elementColourfulVariables(element) {
  return Object.fromEntries(COLOURFUL_VARIABLE_NAMES.map((name) => [
    name,
    element.style.getPropertyValue(name)
  ]).filter(([, value]) => value));
}

function block({
  id = 'block_existing',
  colour,
  x = 20,
  y = 20,
  width = 80,
  height = 60
} = {}) {
  return {
    id,
    objectId: 'object_colour_canvas',
    x,
    y,
    width,
    height,
    rotation: 0,
    links: [],
    ...(colour ? { colour } : {})
  };
}

function flatPalette(settings) {
  const { blockAppearance } = settings;
  return Object.freeze({
    colourful: blockAppearance.colourful,
    presets: Object.freeze(blockAppearance.colourfulBlock.presets.map((preset) => (
      Object.freeze({ ...preset })
    ))),
    lastUsedColour: blockAppearance.colourfulBlock.lastUsedColour,
    monochromeColour: blockAppearance.monochrome.colour,
    opacity: Object.freeze({ ...blockAppearance.monochrome.opacity }),
    borderWidth: blockAppearance.monochrome.borderWidth
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function draw(harness, {
  start = { clientX: 300, clientY: 210 },
  end = { clientX: 400, clientY: 290 },
  pointerId = 7
} = {}) {
  harness.api.pointerDown(harness.pointer({ pointerId, ...start }));
  harness.api.pointerMove(harness.pointer({ pointerId, ...end }));
  harness.api.finishDraw(harness.pointer({ pointerId, ...end }), true);
}

function measureQuickBar(harness, { width = 252, height = 32 } = {}) {
  const bar = harness.api.quickBar();
  assert.ok(bar);
  bar.offsetWidth = width;
  bar.offsetHeight = height;
  harness.api.positionQuickBar();
  return bar;
}

function assertQuickBarBelow(harness, blockId, gap = 8) {
  const areaRect = harness.canvasArea.getBoundingClientRect();
  const targetRect = harness.api.overlay(blockId).getBoundingClientRect();
  const bar = harness.api.quickBar();
  assert.equal(Number.parseFloat(bar.style.top), targetRect.bottom - areaRect.top + gap);
}

function parseCssDeclarations(body) {
  const declarations = {};
  let start = 0;
  let quote = '';
  let parentheses = 0;
  const consume = (end) => {
    const statement = body.slice(start, end).trim();
    const colon = statement.indexOf(':');
    if (colon > 0) {
      declarations[statement.slice(0, colon).trim()] = statement.slice(colon + 1).trim();
    }
  };
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === quote && body[index - 1] !== '\\') quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === ';' && parentheses === 0) {
      consume(index);
      start = index + 1;
    }
  }
  consume(body.length);
  return declarations;
}

function parseTopLevelCssRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    const prelude = css.slice(cursor, open).trim();
    let depth = 1;
    let quote = '';
    let close = open + 1;
    for (; close < css.length && depth; close += 1) {
      const character = css[close];
      if (quote) {
        if (character === quote && css[close - 1] !== '\\') quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    if (depth) throw new Error(`Unbalanced CSS block after ${prelude}`);
    if (prelude && !prelude.startsWith('@')) {
      rules.push({
        selectors: prelude.split(',').map((selector) => selector.trim()),
        declarations: parseCssDeclarations(css.slice(open + 1, close - 1))
      });
    }
    cursor = close;
  }
  return rules;
}

function declarationsFor(rules, selector) {
  const matching = rules.filter((rule) => rule.selectors.includes(selector));
  return matching.length
    ? Object.assign({}, ...matching.map((rule) => rule.declarations))
    : null;
}

test('OFF omits Block colour and leaves monochrome variables untouched', async () => {
  const settings = appearance({
    colourful: false,
    monochromeColour: '#1A2B3C',
    opacity: { status1: 0.12, status2: 0.44, status3: 0.78 }
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const { api, document } = harness;
  const probe = document.createElement('button');
  probe.style.setProperty('--block-status-2-fill-colour', 'monochrome-sentinel');

  api.applyColourfulStyle(probe, { colour: '#D05B71' });
  assert.equal(
    probe.style.getPropertyValue('--block-status-2-fill-colour'),
    'monochrome-sentinel'
  );
  assert.deepEqual(elementColourfulVariables(probe), {});

  api.applyTransform();
  api.pointerDown(harness.pointer({ clientX: 150, clientY: 100 }));
  assert.equal(Object.hasOwn(drawing(api), 'colour'), false);
  assert.deepEqual(elementColourfulVariables(api.preview()), {});
  api.finishDraw(harness.pointer({ clientX: 230, clientY: 170 }), true);

  assert.equal(blocks(api).length, 1);
  assert.equal(Object.hasOwn(blocks(api)[0], 'colour'), false);
  assert.equal(api.quickTarget(), null);
  assert.equal(api.quickBar(), null);
  assert.equal(harness.undoManager.undoStack.length, 1);
});

test('ON snapshots colour at pointer-down for Preview and commit, with legacy fallback', async () => {
  const initial = appearance({
    lastUsedColour: '#AA1122',
    monochromeColour: '#345678',
    opacity: { status1: 0.08, status2: 0.31, status3: 0.66 }
  });
  const harness = await createColourfulCanvasHarness({ appearance: initial });
  const { api } = harness;
  const legacy = block({ id: 'block_legacy' });

  api.applyTransform();
  api.applySnapshot([legacy]);
  assert.deepEqual(
    elementColourfulVariables(api.overlay(legacy.id)),
    colourfulVariables('#345678', initial)
  );

  api.pointerDown(harness.pointer({ clientX: 300, clientY: 210 }));
  assert.equal(drawing(api).colour, '#AA1122');
  assert.deepEqual(
    elementColourfulVariables(api.preview()),
    colourfulVariables('#AA1122', initial)
  );

  const changedMidDraw = appearance({
    lastUsedColour: '#33CC44',
    monochromeColour: '#56789A',
    opacity: initial.blockAppearance.monochrome.opacity
  });
  api.setAppearance(changedMidDraw);
  api.runtime().refreshAppearance(changedMidDraw.blockAppearance);
  assert.equal(drawing(api).colour, '#AA1122');
  assert.deepEqual(
    elementColourfulVariables(api.preview()),
    colourfulVariables('#AA1122', changedMidDraw)
  );
  assert.deepEqual(
    elementColourfulVariables(api.overlay(legacy.id)),
    colourfulVariables('#56789A', changedMidDraw)
  );

  api.pointerMove(harness.pointer({ clientX: 400, clientY: 290 }));
  api.finishDraw(harness.pointer({ clientX: 400, clientY: 290 }), true);
  const created = blocks(api).find((item) => item.id !== legacy.id);
  assert.equal(created.colour, '#AA1122');
  assert.equal(api.preview(), null);
  assert.equal(api.quickTarget(), created.id);
  assert.deepEqual(
    elementColourfulVariables(api.overlay(created.id)),
    colourfulVariables('#AA1122', changedMidDraw)
  );
});

test('creation and Quick Bar recolour are independent Undo transactions', async () => {
  const settings = appearance({
    presets: [
      { id: 'preset_coral', colour: '#D05B71' },
      { id: 'preset_blue', colour: '#4C78A8' }
    ],
    lastUsedColour: '#AA1122'
  });
  const persisted = [];
  const controller = {
    snapshot: () => flatPalette(settings),
    persistQuickColour: async (colour) => {
      persisted.push(colour);
      return { colour, snapshot: flatPalette(settings) };
    }
  };
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: { blockColourPaletteController: controller }
  });
  harness.api.applyTransform();
  draw(harness);

  const createdId = blocks(harness.api)[0].id;
  assert.equal(blocks(harness.api)[0].colour, '#AA1122');
  assert.equal(harness.undoManager.undoStack.length, 1);
  const coral = harness.api.quickBar().querySelector(
    '[data-block-colour-preset-id="preset_coral"]'
  );
  await coral.dispatch('click');

  assert.deepEqual(persisted, ['#D05B71']);
  assert.equal(blocks(harness.api)[0].colour, '#D05B71');
  assert.equal(harness.undoManager.undoStack.length, 2);

  assert.equal(harness.undoManager.undo(), true);
  assert.equal(blocks(harness.api)[0].colour, '#AA1122');
  assert.equal(harness.api.quickTarget(), createdId);
  assert.equal(harness.undoManager.undo(), true);
  assert.deepEqual(blocks(harness.api), []);
  assert.equal(harness.api.quickTarget(), null);
  assert.equal(harness.api.quickBar(), null);

  assert.equal(harness.undoManager.redo(), true);
  assert.equal(blocks(harness.api)[0].colour, '#AA1122');
  assert.equal(harness.undoManager.redo(), true);
  assert.equal(blocks(harness.api)[0].colour, '#D05B71');
});

test('pending Quick Colour intent is sampled by the next draw before persistence settles', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_coral', colour: '#D05B71' }],
    lastUsedColour: '#AA1122'
  });
  const requests = [];
  const persistenceGate = deferred();
  const harness = await createColourfulCanvasHarness({
    appearance: settings
  });
  const palette = await harness.installVaultSettingsRuntime({
    request: async (url, options = {}) => {
      requests.push({ url, body: JSON.parse(options.body || '{}') });
      await persistenceGate.promise;
      return JSON.parse(options.body || '{}');
    }
  });
  harness.api.applyTransform();
  draw(harness);
  await harness.api.quickBar().querySelector(
    '[data-block-colour-preset-id="preset_coral"]'
  ).dispatch('click');
  assert.equal(palette.controller.snapshot().lastUsedColour, '#D05B71');

  draw(harness, {
    start: { clientX: 140, clientY: 80 },
    end: { clientX: 210, clientY: 140 },
    pointerId: 8
  });
  assert.deepEqual(blocks(harness.api).map((item) => item.colour), [
    '#D05B71',
    '#D05B71'
  ]);
  persistenceGate.resolve(settings);
  await palette.flush();
  assert.equal(palette.controller.snapshot().lastUsedColour, '#D05B71');
  assert.equal(requests.at(-1).url, '/api/appearance');
  assert.equal(
    requests.at(-1).body.blockAppearance.colourfulBlock.lastUsedColour,
    '#D05B71'
  );
});

test('rainbow revalidates its target before palette persistence', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }],
    lastUsedColour: '#AA1122'
  });
  let requestCount = 0;
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const palette = await harness.installVaultSettingsRuntime({
    request: async (_url, options = {}) => {
      requestCount += 1;
      return JSON.parse(options.body || '{}');
    }
  });
  const target = block({ id: 'block_picker_queue', colour: '#AA1122', x: 150, y: 100 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  assert.equal(harness.api.openQuickBar(target.id), true);
  await harness.api.quickBar().querySelector('[data-quick-colour-rainbow]').dispatch('click');
  assert.equal(palette.pickerOpen(), true);

  const save = palette.saveOpenPicker('#D05B71');
  await Promise.resolve();
  harness.api.applySnapshot([], null);
  await save;
  assert.equal(harness.api.quickTarget(), null);
  assert.equal(requestCount, 0);
  assert.equal(palette.controller.snapshot().lastUsedColour, '#AA1122');
  assert.equal(
    palette.controller.snapshot().presets.some((preset) => preset.colour === '#D05B71'),
    false
  );
  assert.equal(palette.pickerOpen(), true);
  assert.match(palette.pickerError(), /target Block is no longer available/i);
});

test('existing picker success persists one custom colour and records one Canvas recolour', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }],
    lastUsedColour: '#AA1122'
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const palette = await harness.installVaultSettingsRuntime();
  const target = block({ id: 'block_picker_success', colour: '#AA1122', x: 150, y: 100 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  assert.equal(harness.api.openQuickBar(target.id), true);
  await harness.api.quickBar().querySelector('[data-quick-colour-rainbow]').dispatch('click');

  await palette.saveOpenPicker('#D05B71');
  assert.equal(palette.pickerOpen(), false);
  assert.equal(palette.controller.snapshot().lastUsedColour, '#D05B71');
  assert.equal(
    palette.controller.snapshot().presets.some((preset) => preset.colour === '#D05B71'),
    true
  );
  assert.equal(blocks(harness.api)[0].colour, '#D05B71');
  assert.equal(harness.undoManager.undoStack.length, 1);
});

test('rainbow delegates to the existing picker facade and recolours through Canvas Undo', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }]
  });
  let pickerRequest = null;
  const controller = {
    snapshot: () => flatPalette(settings),
    persistQuickColour: async (colour) => ({ colour, snapshot: flatPalette(settings) }),
    openQuickColourPicker: (request) => {
      pickerRequest = request;
      return true;
    }
  };
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: { blockColourPaletteController: controller }
  });
  const target = block({ id: 'block_picker', colour: '#AA1122', x: 150, y: 100 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  assert.equal(harness.api.openQuickBar(target.id), true);
  await harness.api.quickBar().querySelector('[data-quick-colour-rainbow]').dispatch('click');

  assert.equal(pickerRequest.title, 'New Colour');
  assert.equal(pickerRequest.initialColour, '#AA1122');
  assert.equal(pickerRequest.validateTarget().id, target.id);
  pickerRequest.onPersisted({ colour: '#33CC44' });
  assert.equal(blocks(harness.api)[0].colour, '#33CC44');
  assert.equal(harness.undoManager.undoStack.length, 1);
  harness.api.applySnapshot([], null);
  assert.equal(pickerRequest.validateTarget(), null);
});

test('Quick Bar follows selected Block authority and editing lifecycle', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }]
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const target = block({ id: 'block_target', colour: '#AA1122', x: 150, y: 100 });
  const second = block({ id: 'block_second', x: 260, y: 150 });
  const outside = harness.document.createElement('aside');
  harness.document.body.append(outside);

  harness.api.applyTransform();
  harness.api.applySnapshot([target, second]);
  assert.equal(harness.api.quickTarget(), null);

  harness.api.select(target.id);
  assert.equal(harness.api.quickTarget(), target.id);
  assert.ok(harness.api.quickBar());
  assert.equal(harness.api.quickBarCount(), 1);

  // Outside toolbar input no longer creates an independent palette state.
  await harness.document.dispatch('pointerdown', { target: outside });
  assert.equal(harness.api.quickTarget(), target.id);
  const escape = await harness.document.dispatch('keydown', {
    key: 'Escape', target: harness.document.body
  });
  assert.equal(escape.defaultPrevented, false);
  assert.equal(harness.api.quickTarget(), target.id);

  harness.api.select(second.id);
  assert.equal(harness.api.quickTarget(), second.id);
  assert.equal(harness.api.quickBarCount(), 1);

  harness.api.select(null);
  assert.equal(harness.api.quickTarget(), null);
  assert.equal(harness.api.quickOverlay(), null);

  harness.api.select(target.id);
  harness.api.applySnapshot([], null);
  assert.equal(harness.api.quickTarget(), null);
  assert.equal(harness.api.quickOverlay(), null);

  harness.api.applySnapshot([target], target.id);
  assert.equal(harness.api.quickTarget(), target.id);
  const off = appearance({ colourful: false });
  harness.api.setAppearance(off);
  harness.api.runtime().refreshAppearance(off.blockAppearance);
  assert.equal(harness.api.quickTarget(), null);
  assert.deepEqual(elementColourfulVariables(harness.api.overlay(target.id)), {});

  harness.api.setAppearance(settings);
  harness.api.runtime().refreshAppearance(settings.blockAppearance);
  assert.equal(harness.api.quickTarget(), target.id);
  harness.api.cancel();
  assert.equal(harness.api.quickTarget(), null);
  assert.equal(harness.api.quickOverlay(), null);
});

test('selected existing and legacy Blocks share one rainbow | presets toolbar that occludes Canvas input', async () => {
  const settings = appearance({
    presets: [
      { id: 'preset_coral', colour: '#D05B71' },
      { id: 'preset_blue', colour: '#4C78A8' }
    ]
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const selected = block({ id: 'block_saved', colour: '#AA1122', x: 150, y: 100 });
  const underneath = block({ id: 'block_legacy_underneath', x: 150, y: 168 });
  harness.api.applyTransform();
  harness.api.applySnapshot([selected, underneath]);

  const selectExisting = harness.pointer({
    pointerId: 19,
    clientX: 260,
    clientY: 160,
    target: harness.canvasArea
  });
  harness.api.pointerDown(selectExisting);
  harness.api.finishTransform(selectExisting, true);
  const bar = measureQuickBar(harness);
  const [rainbow, separator, presets] = bar.children;
  assert.equal(bar.children.length, 3);
  assert.equal(rainbow.dataset.quickColourRainbow, 'true');
  assert.equal(separator.dataset.quickColourSeparator, 'true');
  assert.equal(separator.getAttribute('aria-hidden'), 'true');
  assert.equal(presets.dataset.quickColourPresets, 'true');
  assert.equal(bar.textContent.trim(), '');
  assert.equal(bar.querySelectorAll('.vault-block-rainbow-circle').length, 1);
  assert.equal(presets.querySelectorAll('[data-block-colour-preset-id]').length, 2);
  assertQuickBarBelow(harness, selected.id);

  let canvasPointerDowns = 0;
  harness.canvasArea.addEventListener('pointerdown', () => {
    canvasPointerDowns += 1;
    harness.api.select(underneath.id);
  });
  await bar.dispatch('pointerdown', { button: 0, pointerId: 20, clientX: 260, clientY: 230 });
  await separator.dispatch('pointerdown', {
    button: 0, pointerId: 21, clientX: 270, clientY: 230
  });
  const preset = presets.querySelector('[data-block-colour-preset-id="preset_coral"]');
  await preset.dispatch('pointerdown', { button: 0, pointerId: 22, clientX: 280, clientY: 230 });
  await preset.dispatch('click');
  await rainbow.dispatch('pointerdown', {
    button: 0, pointerId: 23, clientX: 240, clientY: 230
  });
  await rainbow.dispatch('pointercancel', {
    button: 0, pointerId: 23, clientX: 240, clientY: 230
  });

  assert.equal(canvasPointerDowns, 0);
  assert.equal(harness.api.selected(), selected.id);
  assert.equal(harness.api.quickTarget(), selected.id);
  assert.equal(harness.api.quickBarCount(), 1);
  assert.equal(blocks(harness.api).find((item) => item.id === selected.id).colour, '#D05B71');

  harness.api.select(underneath.id);
  assert.equal(harness.api.quickTarget(), underneath.id);
  assert.equal(harness.api.quickBarCount(), 1);
  assertQuickBarBelow(harness, underneath.id);
});

test('sub-threshold Quick Bar colour clicks run once and refresh the active preset state', async () => {
  const settings = appearance({
    presets: [
      { id: 'preset_coral', colour: '#D05B71' },
      { id: 'preset_blue', colour: '#4C78A8' }
    ]
  });
  const persisted = [];
  let pickerOpenCount = 0;
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: {
      blockColourPaletteController: {
        snapshot: () => flatPalette(settings),
        persistQuickColour: async (colour) => {
          persisted.push(colour);
          return { colour, snapshot: flatPalette(settings) };
        },
        openQuickColourPicker: () => {
          pickerOpenCount += 1;
          return true;
        }
      }
    }
  });
  const target = block({
    id: 'block_quick_colour_clicks',
    colour: '#4c78a8',
    x: 150,
    y: 100
  });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  const bar = measureQuickBar(harness);
  const rainbow = bar.querySelector('[data-quick-colour-rainbow]');
  const coral = bar.querySelector('[data-block-colour-preset-id="preset_coral"]');
  const blue = bar.querySelector('[data-block-colour-preset-id="preset_blue"]');

  assert.equal(coral.getAttribute('aria-pressed'), 'false');
  assert.equal(blue.getAttribute('aria-pressed'), 'true');

  await rainbow.dispatch('pointerdown', {
    button: 0, pointerId: 24, clientX: 240, clientY: 230
  });
  await rainbow.dispatch('pointermove', {
    button: 0, pointerId: 24, clientX: 243, clientY: 230
  });
  assert.equal(bar.classList.contains('is-dragging'), false);
  await rainbow.dispatch('pointerup', {
    button: 0, pointerId: 24, clientX: 243, clientY: 230
  });
  await rainbow.dispatch('click');
  assert.equal(pickerOpenCount, 1, 'compatibility click must not open the picker twice');
  assert.deepEqual(persisted, []);
  assert.equal(harness.undoManager.undoStack.length, 0);

  await coral.dispatch('pointerdown', {
    button: 0, pointerId: 25, clientX: 280, clientY: 230
  });
  await coral.dispatch('pointermove', {
    button: 0, pointerId: 25, clientX: 283, clientY: 230
  });
  assert.equal(bar.classList.contains('is-dragging'), false);
  await coral.dispatch('pointerup', {
    button: 0, pointerId: 25, clientX: 283, clientY: 230
  });
  await coral.dispatch('click');

  assert.deepEqual(persisted, ['#D05B71']);
  assert.equal(blocks(harness.api)[0].colour, '#D05B71');
  assert.equal(harness.undoManager.undoStack.length, 1);
  assert.equal(coral.getAttribute('aria-pressed'), 'true');
  assert.equal(blue.getAttribute('aria-pressed'), 'false');
  assert.equal(pickerOpenCount, 1);
});

test('every Quick Bar region shares one drag threshold and dragging only moves the bar', async () => {
  const settings = appearance({
    presets: [
      { id: 'preset_coral', colour: '#D05B71' },
      { id: 'preset_blue', colour: '#4C78A8' }
    ]
  });
  const persisted = [];
  let pickerOpenCount = 0;
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: {
      blockColourPaletteController: {
        snapshot: () => flatPalette(settings),
        persistQuickColour: async (colour) => {
          persisted.push(colour);
          return { colour, snapshot: flatPalette(settings) };
        },
        openQuickColourPicker: () => {
          pickerOpenCount += 1;
          return true;
        }
      }
    }
  });
  const target = block({
    id: 'block_whole_quick_bar_drag',
    colour: '#AA1122',
    x: 150,
    y: 100
  });
  const underneath = block({
    id: 'block_under_quick_bar',
    colour: '#4C78A8',
    x: 150,
    y: 168
  });
  harness.api.applyTransform();
  harness.api.applySnapshot([target, underneath], target.id);
  const bar = measureQuickBar(harness);
  const rainbow = bar.querySelector('[data-quick-colour-rainbow]');
  const separator = bar.querySelector('[data-quick-colour-separator]');
  const presetStrip = bar.querySelector('[data-quick-colour-presets]');
  const preset = bar.querySelector('[data-block-colour-preset-id="preset_coral"]');
  const sourceBefore = harness.api.blocksJson();
  const viewBefore = harness.api.viewJson();
  let canvasInputCount = 0;
  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
    harness.canvasArea.addEventListener(eventName, () => {
      canvasInputCount += 1;
      harness.api.select(underneath.id);
    });
  }

  const origins = [
    ['pill background', bar],
    ['rainbow circle', rainbow],
    ['separator area', separator],
    ['preset strip area', presetStrip],
    ['preset circle', preset]
  ];
  for (const [label, origin] of origins) {
    const pointerId = 50 + origins.findIndex((entry) => entry[0] === label);
    const startX = 240 + pointerId;
    const startY = 230;
    const leftBefore = Number.parseFloat(bar.style.left);
    const topBefore = Number.parseFloat(bar.style.top);

    await origin.dispatch('pointerdown', {
      button: 0, pointerId, clientX: startX, clientY: startY
    });
    assert.equal(bar.hasPointerCapture(pointerId), true, `${label} should capture on the pill`);
    assert.equal(bar.classList.contains('is-dragging'), false, `${label} pointerdown`);

    await origin.dispatch('pointermove', {
      button: 0, pointerId, clientX: startX + 3, clientY: startY
    });
    assert.equal(bar.classList.contains('is-dragging'), false, `${label} below threshold`);
    assert.equal(Number.parseFloat(bar.style.left), leftBefore, `${label} below threshold left`);
    assert.equal(Number.parseFloat(bar.style.top), topBefore, `${label} below threshold top`);

    await origin.dispatch('pointermove', {
      button: 0, pointerId, clientX: startX + 4, clientY: startY
    });
    assert.equal(bar.classList.contains('is-dragging'), true, `${label} at threshold`);
    assert.equal(Number.parseFloat(bar.style.left), leftBefore + 4, `${label} drag left`);
    assert.equal(Number.parseFloat(bar.style.top), topBefore, `${label} drag top`);

    await origin.dispatch('pointermove', {
      button: 0, pointerId, clientX: startX + 9, clientY: startY + 6
    });
    assert.equal(Number.parseFloat(bar.style.left), leftBefore + 9, `${label} final left`);
    assert.equal(Number.parseFloat(bar.style.top), topBefore + 6, `${label} final top`);
    await origin.dispatch('pointerup', {
      button: 0, pointerId, clientX: startX + 9, clientY: startY + 6
    });
    assert.equal(bar.classList.contains('is-dragging'), false, `${label} pointerup`);
    assert.equal(bar.hasPointerCapture(pointerId), false, `${label} should release capture`);
    await origin.dispatch('click');

    assert.equal(harness.api.blocksJson(), sourceBefore, `${label} must not recolour or move a Block`);
    assert.equal(harness.api.viewJson(), viewBefore, `${label} must not pan Canvas`);
    assert.equal(harness.api.selected(), target.id, `${label} must preserve selection`);
    assert.equal(harness.undoManager.undoStack.length, 0, `${label} must not record Undo`);
    assert.equal(pickerOpenCount, 0, `${label} must not open the picker`);
    assert.deepEqual(persisted, [], `${label} must not persist a preset`);
  }

  const cancelPointerId = 70;
  const cancelLeft = Number.parseFloat(bar.style.left);
  const cancelTop = Number.parseFloat(bar.style.top);
  await presetStrip.dispatch('pointerdown', {
    button: 0, pointerId: cancelPointerId, clientX: 360, clientY: 250
  });
  await presetStrip.dispatch('pointermove', {
    button: 0, pointerId: cancelPointerId, clientX: 364, clientY: 250
  });
  assert.equal(bar.classList.contains('is-dragging'), true);
  assert.equal(Number.parseFloat(bar.style.left), cancelLeft + 4);
  assert.equal(Number.parseFloat(bar.style.top), cancelTop);
  await presetStrip.dispatch('pointercancel', {
    button: 0, pointerId: cancelPointerId, clientX: 364, clientY: 250
  });
  assert.equal(bar.classList.contains('is-dragging'), false);
  assert.equal(bar.hasPointerCapture(cancelPointerId), false);
  await presetStrip.dispatch('click');

  assert.equal(canvasInputCount, 0, 'Quick Bar input must remain occluded from Canvas');
  assert.equal(harness.api.blocksJson(), sourceBefore);
  assert.equal(harness.api.viewJson(), viewBefore);
  assert.equal(harness.api.selected(), target.id);
  assert.equal(harness.undoManager.undoStack.length, 0);
  assert.equal(pickerOpenCount, 0);
  assert.deepEqual(persisted, []);
  assert.notEqual(harness.api.quickManualPositionJson(), 'null');
});

test('rainbow click opens the existing picker while drag moves only the temporary toolbar', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }]
  });
  let pickerOpenCount = 0;
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: {
      blockColourPaletteController: {
        snapshot: () => flatPalette(settings),
        persistQuickColour: async (colour) => ({ colour, snapshot: flatPalette(settings) }),
        openQuickColourPicker: () => {
          pickerOpenCount += 1;
          return true;
        }
      }
    }
  });
  const target = block({ id: 'block_drag_toolbar', colour: '#AA1122', x: 150, y: 100 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  const bar = measureQuickBar(harness);
  const rainbow = bar.querySelector('[data-quick-colour-rainbow]');
  const sourceBefore = harness.api.blocksJson();
  const viewBefore = harness.api.viewJson();

  await rainbow.dispatch('pointerdown', {
    button: 0, pointerId: 30, clientX: 240, clientY: 230
  });
  await rainbow.dispatch('pointermove', {
    button: 0, pointerId: 30, clientX: 242, clientY: 231
  });
  await rainbow.dispatch('pointerup', {
    button: 0, pointerId: 30, clientX: 242, clientY: 231
  });
  assert.equal(pickerOpenCount, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const defaultLeft = Number.parseFloat(bar.style.left);
  const defaultTop = Number.parseFloat(bar.style.top);
  await rainbow.dispatch('pointerdown', {
    button: 0, pointerId: 31, clientX: 240, clientY: 230
  });
  await rainbow.dispatch('pointermove', {
    button: 0, pointerId: 31, clientX: 264, clientY: 246
  });
  assert.equal(Number.parseFloat(bar.style.left), defaultLeft + 24);
  assert.equal(Number.parseFloat(bar.style.top), defaultTop + 16);
  assert.notEqual(harness.api.quickManualPositionJson(), 'null');
  await rainbow.dispatch('pointerup', {
    button: 0, pointerId: 31, clientX: 264, clientY: 246
  });
  await rainbow.dispatch('click');
  assert.equal(pickerOpenCount, 1);
  assert.equal(harness.api.blocksJson(), sourceBefore);
  assert.equal(harness.api.viewJson(), viewBefore);
  assert.equal(harness.api.selected(), target.id);

  const draggedLeft = Number.parseFloat(bar.style.left);
  const draggedTop = Number.parseFloat(bar.style.top);
  harness.api.setView({ offsetX: 30, offsetY: 20 });
  harness.api.applyTransform();
  assert.equal(Number.parseFloat(bar.style.left), draggedLeft + 30);
  assert.equal(Number.parseFloat(bar.style.top), draggedTop + 20);

  harness.api.select(null);
  assert.equal(harness.api.quickManualPositionJson(), 'null');
  harness.api.select(target.id);
  const resetBar = measureQuickBar(harness);
  assert.equal(harness.api.quickManualPositionJson(), 'null');
  assertQuickBarBelow(harness, target.id);
  assert.notEqual(Number.parseFloat(resetBar.style.left), draggedLeft + 30);
});

test('move, resize, and rotation hide the bar only for active transforms and restore below', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }]
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const target = block({ id: 'block_transform', colour: '#AA1122', x: 150, y: 100 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  let bar = measureQuickBar(harness);

  const rainbow = bar.querySelector('[data-quick-colour-rainbow]');
  await rainbow.dispatch('pointerdown', {
    button: 0, pointerId: 40, clientX: 240, clientY: 230
  });
  await rainbow.dispatch('pointermove', {
    button: 0, pointerId: 40, clientX: 255, clientY: 242
  });
  await rainbow.dispatch('pointerup', {
    button: 0, pointerId: 40, clientX: 255, clientY: 242
  });
  await rainbow.dispatch('click');
  assert.notEqual(harness.api.quickManualPositionJson(), 'null');

  const moveStart = harness.pointer({
    pointerId: 41,
    clientX: 270,
    clientY: 170,
    target: harness.canvasArea
  });
  harness.api.pointerDown(moveStart);
  assert.ok(harness.api.quickBar(), 'pending click-sized move keeps the bar visible');
  harness.api.pointerMove(harness.pointer({
    pointerId: 41,
    clientX: 272,
    clientY: 171,
    target: harness.canvasArea
  }));
  assert.ok(harness.api.quickBar(), 'sub-threshold move keeps the bar visible');
  const movedPointer = harness.pointer({
    pointerId: 41,
    clientX: 290,
    clientY: 185,
    target: harness.canvasArea
  });
  harness.api.pointerMove(movedPointer);
  assert.equal(harness.api.quickBar(), null);
  assert.equal(harness.api.quickTarget(), null);
  harness.api.finishTransform(movedPointer, true);
  bar = measureQuickBar(harness);
  assert.equal(harness.api.quickManualPositionJson(), 'null');
  assert.equal(harness.api.selected(), target.id);
  assertQuickBarBelow(harness, target.id);

  let controls = harness.canvasStage.querySelector(
    '.canvas-block-transform-controls[data-block-id="block_transform"]'
  );
  let resizeHandle = controls.querySelector('[data-block-resize-handle="e"]');
  const resizeStart = harness.pointer({
    pointerId: 42,
    clientX: 350,
    clientY: 185,
    target: resizeHandle
  });
  harness.api.pointerDown(resizeStart);
  assert.equal(harness.api.quickBar(), null, 'resize hides immediately');
  const resizeEnd = harness.pointer({
    pointerId: 42,
    clientX: 375,
    clientY: 185,
    target: resizeHandle
  });
  harness.api.pointerMove(resizeEnd);
  harness.api.finishTransform(resizeEnd, true);
  measureQuickBar(harness);
  assertQuickBarBelow(harness, target.id);

  controls = harness.canvasStage.querySelector(
    '.canvas-block-transform-controls[data-block-id="block_transform"]'
  );
  const rotationHandle = controls.querySelector('[data-block-rotation-handle]');
  const rotateStart = harness.pointer({
    pointerId: 43,
    clientX: 310,
    clientY: 120,
    target: rotationHandle
  });
  harness.api.pointerDown(rotateStart);
  assert.equal(harness.api.quickBar(), null, 'rotation hides immediately');
  const rotateEnd = harness.pointer({
    pointerId: 43,
    clientX: 345,
    clientY: 150,
    target: rotationHandle
  });
  harness.api.pointerMove(rotateEnd);
  harness.api.finishTransform(rotateEnd, true);
  measureQuickBar(harness);
  assertQuickBarBelow(harness, target.id);

  controls = harness.canvasStage.querySelector(
    '.canvas-block-transform-controls[data-block-id="block_transform"]'
  );
  resizeHandle = controls.querySelector('[data-block-resize-handle="w"]');
  const cancelStart = harness.pointer({
    pointerId: 44,
    clientX: 270,
    clientY: 185,
    target: resizeHandle
  });
  harness.api.pointerDown(cancelStart);
  assert.equal(harness.api.quickBar(), null);
  harness.api.finishTransform(cancelStart, false);
  measureQuickBar(harness);
  assertQuickBarBelow(harness, target.id);
  assert.equal(harness.api.quickBarCount(), 1);
});

test('more than eight presets stay in one horizontal strip and isolate wheel input', async () => {
  const presets = Array.from({ length: 10 }, (_value, index) => ({
    id: `preset_${index + 1}`,
    colour: `#${(0x100000 + index * 0x010101).toString(16).toUpperCase().padStart(6, '0')}`
  }));
  const settings = appearance({ presets });
  const harness = await createColourfulCanvasHarness({
    appearance: settings,
    globals: {
      blockColourPaletteController: {
        snapshot: () => flatPalette(settings),
        persistQuickColour: async (colour) => ({ colour, snapshot: flatPalette(settings) })
      }
    }
  });
  const target = block({ id: 'block_wheel', colour: '#AA1122', x: 160, y: 110 });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  assert.equal(harness.api.openQuickBar(target.id), true);

  const bar = harness.api.quickBar();
  const strip = bar.querySelector('[data-quick-colour-presets]');
  assert.equal(strip.querySelectorAll('[data-block-colour-preset-id]').length, 10);
  strip.clientWidth = 212;
  let canvasWheelEvents = 0;
  harness.canvasArea.addEventListener('wheel', () => { canvasWheelEvents += 1; });
  const lineWheel = await strip.dispatch('wheel', {
    deltaX: 2,
    deltaY: 3,
    deltaMode: 1
  });
  assert.equal(strip.scrollLeft, 48);
  assert.equal(lineWheel.defaultPrevented, true);
  assert.equal(lineWheel.immediatePropagationStopped, true);
  assert.equal(canvasWheelEvents, 0);

  await strip.dispatch('wheel', { deltaX: -5, deltaY: 2, deltaMode: 0 });
  assert.equal(strip.scrollLeft, 43);
  assert.equal(canvasWheelEvents, 0);

  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    let canvasGestures = 0;
    harness.canvasArea.addEventListener(eventName, () => { canvasGestures += 1; });
    const event = await strip.dispatch(eventName, { scale: 1.2 });
    assert.equal(event.defaultPrevented, true, `${eventName} should be prevented`);
    assert.equal(
      event.immediatePropagationStopped,
      true,
      `${eventName} should stop immediately`
    );
    assert.equal(canvasGestures, 0, `${eventName} must not reach Canvas`);
  }
});

test('Quick Bar stays below the selected Block at constant screen size without rotation clearance', async () => {
  const settings = appearance({
    presets: [{ id: 'preset_blue', colour: '#4C78A8' }]
  });
  const harness = await createColourfulCanvasHarness({ appearance: settings });
  const target = block({
    id: 'block_geometry',
    colour: '#AA1122',
    x: 200,
    y: 160,
    width: 100,
    height: 80
  });
  harness.api.applyTransform();
  harness.api.applySnapshot([target], target.id);
  const bar = measureQuickBar(harness);
  const controls = harness.canvasStage.querySelector(
    '.canvas-block-transform-controls[data-block-id="block_geometry"]'
  );
  assert.equal(bar.style.left, '124px');
  assert.equal(bar.style.top, '248px');
  assert.equal(bar.getBoundingClientRect().width, 252);
  assert.equal(controls.classList.contains('has-quick-colour-bar'), false);
  assert.equal(controls.style.getPropertyValue('--quick-colour-handle-clearance'), '');
  assertQuickBarBelow(harness, target.id);

  harness.api.setView({ scale: 0.5, offsetX: 0, offsetY: 0 });
  harness.api.applyTransform();
  assert.equal(bar.style.left, '8px');
  assert.equal(bar.style.top, '128px');
  assert.equal(bar.getBoundingClientRect().width, 252);
  assertQuickBarBelow(harness, target.id);

  harness.api.setView({ scale: 2, offsetX: 15, offsetY: 20 });
  harness.api.applyTransform();
  const targetRect = harness.api.overlay(target.id).getBoundingClientRect();
  assert.deepEqual(targetRect, {
    x: 515,
    y: 390,
    left: 515,
    top: 390,
    width: 200,
    height: 160,
    right: 715,
    bottom: 550
  });
  assert.equal(bar.style.left, '389px');
  assert.equal(bar.style.top, '508px');
  assert.equal(bar.getBoundingClientRect().width, 252);
  assertQuickBarBelow(harness, target.id);

  harness.api.setView({ scale: 1, offsetX: 0, offsetY: 0 });
  harness.api.applyTransform();
  const topEdgeTarget = block({
    id: 'block_top_edge',
    colour: '#AA1122',
    x: 200,
    y: 2,
    width: 100,
    height: 40
  });
  harness.api.applySnapshot([topEdgeTarget], topEdgeTarget.id);
  measureQuickBar(harness);
  assertQuickBarBelow(harness, topEdgeTarget.id);
  const topEdgeControls = harness.canvasStage.querySelector(
    '.canvas-block-transform-controls[data-block-id="block_top_edge"]'
  );
  assert.equal(topEdgeControls.classList.contains('has-quick-colour-bar'), false);
  assert.equal(
    topEdgeControls.style.getPropertyValue('--quick-colour-handle-clearance'),
    ''
  );

  const bottomEdgeTarget = block({
    id: 'block_bottom_edge',
    colour: '#AA1122',
    x: 200,
    y: 560,
    width: 100,
    height: 40
  });
  harness.api.applySnapshot([bottomEdgeTarget], bottomEdgeTarget.id);
  measureQuickBar(harness);
  assertQuickBarBelow(harness, bottomEdgeTarget.id);
  assert.equal(Number.parseFloat(harness.api.quickBar().style.top), 608);
});

test('Quick Bar CSS keeps equal controls, unclipped grey rings, and a stable drag border', async () => {
  const css = await fs.readFile(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const rules = parseTopLevelCssRules(css);
  const barRule = declarationsFor(rules, '.canvas-block-quick-colour-bar');
  const draggingRule = declarationsFor(rules, '.canvas-block-quick-colour-bar.is-dragging');
  const rainbowRule = declarationsFor(rules, '.canvas-block-quick-colour-rainbow');
  const rainbowCircleRule = declarationsFor(
    rules,
    '.canvas-block-quick-colour-rainbow .vault-block-rainbow-circle'
  );
  const presetRule = declarationsFor(
    rules,
    '.canvas-block-quick-colour-bar .vault-block-colour-preset'
  );
  const presetStripRule = declarationsFor(
    rules,
    '.canvas-block-quick-colour-presets.vault-block-colour-presets'
  );

  assert.equal(barRule.border, '1px solid var(--border-guide)');
  assert.equal(draggingRule['border-width'], undefined);
  assert.equal(draggingRule.cursor, 'grabbing');
  assert.equal(rainbowRule.width, '22px');
  assert.equal(rainbowRule.height, '22px');
  assert.equal(rainbowRule.flex, '0 0 22px');
  assert.equal(rainbowRule.padding, '0');
  assert.equal(rainbowCircleRule.width, '22px');
  assert.equal(rainbowCircleRule.height, '22px');
  assert.equal(presetRule.width, '22px');
  assert.equal(presetRule.height, '22px');
  assert.equal(presetStripRule.padding, '2px');
  assert.equal(presetStripRule['overflow-y'], 'hidden');
  assert.equal(rainbowCircleRule['border-color'], presetRule['border-color']);

  assert.equal(
    declarationsFor(rules, '.vault-block-rainbow-circle').outline,
    '1px solid #9aa6b4'
  );
  assert.equal(
    declarationsFor(rules, '.vault-block-colour-preset').outline,
    '1px solid #9aa6b4'
  );
  assert.equal(
    declarationsFor(rules, '.canvas-block-quick-colour-rainbow:focus-visible').outline,
    '0'
  );
  const ringSelectors = [
    '.canvas-block-quick-colour-rainbow:hover .vault-block-rainbow-circle',
    '.canvas-block-quick-colour-rainbow:focus-visible .vault-block-rainbow-circle',
    '.canvas-block-quick-colour-bar .vault-block-colour-preset:hover',
    '.canvas-block-quick-colour-bar .vault-block-colour-preset:focus-visible',
    ".canvas-block-quick-colour-bar .vault-block-colour-preset[aria-pressed='true']"
  ];
  const sharedRingRule = rules.find((rule) => (
    ringSelectors.every((selector) => rule.selectors.includes(selector))
  ));
  assert.ok(sharedRingRule, 'hover, focus, and current colour must share one ring rule');
  assert.deepEqual(sharedRingRule.declarations, {
    outline: '2px solid #9aa6b4',
    'outline-offset': '0'
  });
  assert.equal(
    rules.filter((rule) => ringSelectors.some((selector) => rule.selectors.includes(selector))).length,
    1,
    'selected plus hover must not stack independent indicators'
  );

  const quickBarCssStart = css.indexOf('.canvas-block-quick-colour-overlay');
  assert.notEqual(quickBarCssStart, -1);
  assert.doesNotMatch(
    css.slice(quickBarCssStart),
    /var\(--(?:theme|accent)-colour/,
    'Quick Bar rings must never use Theme or Accent Colour'
  );
});

test('public facade and parsed CSS retain mode namespaces, eight-item cap, and mono rules', async () => {
  const harness = await createColourfulCanvasHarness({ appearance: appearance() });
  const runtime = harness.api.runtime();
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(typeof runtime.refreshAppearance, 'function');
  assert.equal(typeof runtime.closeQuickColourBar, 'function');
  assert.equal(typeof runtime.quickTargetId, 'function');

  const css = await fs.readFile(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const rules = parseTopLevelCssRules(css);
  for (const status of [1, 2, 3]) {
    const trueSelector = `:root[data-block-colourful='true'] `
      + `.canvas-block-overlay[data-state='${status}']`;
    const falseSelector = `:root[data-block-colourful='false'] `
      + `.canvas-block-overlay[data-state='${status}']`;
    const trueMode = declarationsFor(rules, trueSelector);
    const falseMode = declarationsFor(rules, falseSelector);
    assert.equal(
      trueMode['border-color'],
      `var(--block-colourful-status-${status}-border-colour)`
    );
    assert.equal(
      trueMode['background-color'],
      `var(--block-colourful-status-${status}-fill-colour)`
    );
    assert.equal(falseMode['border-color'], `var(--block-status-${status}-border-colour)`);
    assert.equal(falseMode['background-color'], `var(--block-status-${status}-fill-colour)`);
  }
  const colourfulConsumers = rules.filter((rule) => Object.values(rule.declarations)
    .some((value) => value.includes('--block-colourful-status-')));
  assert.equal(colourfulConsumers.length, 3);
  assert.equal(colourfulConsumers.every((rule) => rule.selectors.every((selector) => (
    selector.startsWith(":root[data-block-colourful='true'] ")
  ))), true);

  assert.deepEqual(
    declarationsFor(rules, '.canvas-block-quick-colour-presets.vault-block-colour-presets'),
    {
      display: 'flex',
      'min-width': '0',
      'min-height': '22px',
      'max-inline-size': 'calc(178px + 2.8rem)',
      flex: '1 1 auto',
      'flex-wrap': 'nowrap',
      'align-items': 'center',
      gap: '0.4rem',
      padding: '2px',
      'overflow-x': 'auto',
      'overflow-y': 'hidden',
      'overscroll-behavior-inline': 'contain',
      'scrollbar-width': 'none'
    }
  );
  const presetRule = declarationsFor(
    rules,
    '.canvas-block-quick-colour-bar .vault-block-colour-preset'
  );
  assert.equal(presetRule.width, '22px');
  assert.equal(presetRule.height, '22px');
  const rainbowRule = declarationsFor(rules, '.canvas-block-quick-colour-rainbow');
  assert.equal(rainbowRule.cursor, 'grab');
  assert.equal(rainbowRule['touch-action'], 'none');
  const separatorRule = declarationsFor(rules, '.canvas-block-quick-colour-separator');
  assert.equal(separatorRule.width, '1px');
  assert.equal(separatorRule.height, '18px');
  assert.equal(separatorRule['pointer-events'], 'none');
  assert.equal(
    declarationsFor(
      rules,
      '.canvas-block-transform-controls.has-quick-colour-bar .canvas-block-rotation-handle'
    ),
    null
  );
  assert.equal(
    declarationsFor(
      rules,
      '.canvas-block-transform-controls.has-quick-colour-bar .canvas-block-rotation-handle::after'
    ),
    null
  );
  assert.doesNotMatch(css, /--quick-colour-handle-clearance|has-quick-colour-bar/);

  const vaultSettingsSource = await fs.readFile(
    path.join(__dirname, '..', 'public', 'js', 'vaultSettings.js'),
    'utf8'
  );
  assert.match(
    vaultSettingsSource,
    /if \(!force && state\.saving && state\.lockCloseWhileSaving\) return;/
  );
  assert.match(vaultSettingsSource, /lockCloseWhileSaving: true,/);
  assert.match(vaultSettingsSource, /closeAppearanceColourPicker\(\{ force: true \}\)/);
  assert.match(
    vaultSettingsSource,
    /lastUsedColour: quickColourPresentationDraft\?\.colour[\s\S]*blockAppearance\.colourfulBlock\.lastUsedColour/
  );
  assert.doesNotMatch(vaultSettingsSource, /quickColourPendingIntent|quickColourSaveQueue/);
  assert.match(
    vaultSettingsSource,
    /const target = validateTarget \? await validateTarget\(colour\) : true;[\s\S]*await addBlockColourPreset\(colour\)/
  );
  assert.match(
    vaultSettingsSource,
    /persistQuickColour\(savedColour, \{ validateTarget \}\)[\s\S]*const currentTarget = validateTarget \? await validateTarget\(savedColour\) : target/
  );
});
