const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const model = require('../public/structuredTextFrame');

test('one compatible canonical frame derives exact world edges', () => {
  assert.deepEqual(model.DEFAULT_TEXT_FRAME, {
    centerWorldX: 0,
    preferredWidth: 760
  });
  assert.deepEqual(model.normalizeTextFrame(null), model.DEFAULT_TEXT_FRAME);
  assert.deepEqual(model.normalizeTextFrame({
    centerWorldX: 125,
    preferredWidth: 1000
  }), {
    centerWorldX: 125,
    preferredWidth: 1000
  });
  assert.deepEqual(model.edgesForFrame({ centerWorldX: 125, preferredWidth: 1000 }), {
    centerWorldX: 125,
    preferredWidth: 1000,
    leftWorld: -375,
    rightWorld: 625,
    worldWidth: 1000
  });
  assert.deepEqual(model.frameFromEdges(-375, 625), {
    centerWorldX: 125,
    preferredWidth: 1000
  });
  assert.deepEqual(model.normalizeTextFrame({ centerWorldX: 9, preferredWidth: 1 }), {
    centerWorldX: 9,
    preferredWidth: model.MIN_FRAME_WIDTH
  });
  assert.deepEqual(model.normalizeTextFrame({ centerWorldX: -9, preferredWidth: 9999 }), {
    centerWorldX: -9,
    preferredWidth: model.MAX_FRAME_WIDTH
  });
});

test('full and partial validation preserve the current centre on width-only saves', () => {
  assert.equal(model.validateTextFrame(null).ok, false);
  assert.equal(model.validateTextFrame({ preferredWidth: 319 }).ok, false);
  assert.equal(model.validateTextFrame({ preferredWidth: 2401 }).ok, false);
  assert.equal(model.validateTextFrame({ preferredWidth: 760, centerWorldX: Infinity }).ok, false);
  assert.deepEqual(model.validateTextFrame({ preferredWidth: 760 }), {
    ok: true,
    textFrame: { centerWorldX: 0, preferredWidth: 760 }
  });
  const partial = model.validateTextFramePartial(
    { preferredWidth: 980 },
    { centerWorldX: 420, preferredWidth: 760 }
  );
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.value, { centerWorldX: 420, preferredWidth: 980 });
  assert.equal(model.validateTextFramePartial(
    { centerWorldX: Number.NaN },
    { centerWorldX: 420, preferredWidth: 760 }
  ).ok, false);
});

test('left and right boundary sessions hold the opposite world edge through limits and crossing', () => {
  const initial = { centerWorldX: 100, preferredWidth: 800 };
  const initialEdges = model.edgesForFrame(initial);

  const leftSession = model.beginBoundaryDrag(initial, 'left');
  for (const target of [-5000, -150, 5000]) {
    const next = model.updateBoundaryDrag(leftSession, target);
    const edges = model.edgesForFrame(next);
    assert.equal(edges.rightWorld, initialEdges.rightWorld);
    assert.ok(edges.worldWidth >= model.MIN_FRAME_WIDTH);
    assert.ok(edges.worldWidth <= model.MAX_FRAME_WIDTH);
  }

  const rightSession = model.beginBoundaryDrag(initial, 'right');
  for (const target of [-5000, 850, 5000]) {
    const next = model.updateBoundaryDrag(rightSession, target);
    const edges = model.edgesForFrame(next);
    assert.equal(edges.leftWorld, initialEdges.leftWorld);
    assert.ok(edges.worldWidth >= model.MIN_FRAME_WIDTH);
    assert.ok(edges.worldWidth <= model.MAX_FRAME_WIDTH);
  }

  assert.deepEqual(model.resizeBoundary(initial, 'left', -250), {
    centerWorldX: 125,
    preferredWidth: 750
  });
  assert.deepEqual(model.resizeBoundary(initial, 'right', 850), {
    centerWorldX: 275,
    preferredWidth: 1150
  });
});

function resize(oldViewport, newViewport, projectedFrame, movingEdge) {
  return model.resolveViewportResize({
    oldViewport,
    newViewport,
    projectedFrame,
    movingEdge
  });
}

test('right-edge resize follows moving gap/clip, opposite gap/clip, then clipping/canvas', () => {
  const viewport = { left: 0, right: 1000 };

  assert.equal(resize(viewport, { left: 0, right: 800 }, {
    left: 200, right: 800
  }, 'right').requestedScreenShiftX, 0, 'A: consume right canvas first');
  assert.equal(resize(viewport, { left: 0, right: 700 }, {
    left: 200, right: 800
  }, 'right').requestedScreenShiftX, -100, 'A: then consume left canvas');
  assert.equal(resize(viewport, { left: 0, right: 400 }, {
    left: 200, right: 800
  }, 'right').requestedScreenShiftX, -200, 'A: then allow right clipping');

  assert.equal(resize(viewport, { left: 0, right: 1250 }, {
    left: -100, right: 1100
  }, 'right').requestedScreenShiftX, 100, 'B: restore right then left clipping');

  assert.equal(resize(viewport, { left: 0, right: 700 }, {
    left: -100, right: 800
  }, 'right').requestedScreenShiftX, 0,
  'C: left pre-clipping is not restored during right shrink');

  assert.equal(resize(viewport, { left: 0, right: 1100 }, {
    left: -100, right: 1100
  }, 'right').requestedScreenShiftX, 0, 'D: reveal right clipping first');
  assert.equal(resize(viewport, { left: 0, right: 1150 }, {
    left: -100, right: 1100
  }, 'right').requestedScreenShiftX, 50, 'D: then restore left clipping');
});

test('left-edge resize is the exact sign mirror of the right-edge policy', () => {
  const viewport = { left: 0, right: 1000 };

  assert.equal(resize(viewport, { left: 200, right: 1000 }, {
    left: 200, right: 800
  }, 'left').requestedScreenShiftX, 0, 'A mirror: consume left canvas first');
  assert.equal(resize(viewport, { left: 300, right: 1000 }, {
    left: 200, right: 800
  }, 'left').requestedScreenShiftX, 100, 'A mirror: then consume right canvas');
  assert.equal(resize(viewport, { left: 600, right: 1000 }, {
    left: 200, right: 800
  }, 'left').requestedScreenShiftX, 200, 'A mirror: then allow left clipping');

  assert.equal(resize(viewport, { left: -250, right: 1000 }, {
    left: -100, right: 1100
  }, 'left').requestedScreenShiftX, -100, 'B mirror: restore left then right clipping');

  assert.equal(resize(viewport, { left: 300, right: 1000 }, {
    left: 200, right: 1100
  }, 'left').requestedScreenShiftX, 0,
  'C mirror: right pre-clipping is not restored during left shrink');

  assert.equal(resize(viewport, { left: -100, right: 1000 }, {
    left: -100, right: 1100
  }, 'left').requestedScreenShiftX, 0, 'D mirror: reveal left clipping first');
  assert.equal(resize(viewport, { left: -150, right: 1000 }, {
    left: -100, right: 1100
  }, 'left').requestedScreenShiftX, -50, 'D mirror: then restore right clipping');
});

test('ambiguous, stationary, and fully offscreen resize observations preserve camera', () => {
  const oldViewport = { left: 0, right: 1000 };
  const frame = { left: 200, right: 800 };
  const ambiguous = resize(oldViewport, { left: 100, right: 900 }, frame, null);
  assert.equal(ambiguous.applicable, false);
  assert.equal(ambiguous.requestedScreenShiftX, 0);
  const stationary = resize(oldViewport, oldViewport, frame, 'right');
  assert.equal(stationary.applicable, false);
  assert.equal(stationary.intersectsBefore, true);
  const offscreen = resize(oldViewport, { left: 0, right: 800 }, {
    left: 1200, right: 1800
  }, 'right');
  assert.equal(offscreen.applicable, false);
  assert.equal(offscreen.intersectsBefore, false);
  assert.equal(offscreen.requestedScreenShiftX, 0);
});

test('Cases A-D and exact left mirrors are scale-equivariant at every required zoom', () => {
  const frame = { centerWorldX: 75, preferredWidth: 1000 };
  const canonical = structuredClone(frame);
  const cases = [
    ['right A', 'right', { left: 0, right: 1000 }, { left: 0, right: 700 },
      { left: 200, right: 800 }, -100],
    ['right B', 'right', { left: 0, right: 1000 }, { left: 0, right: 1250 },
      { left: -100, right: 1100 }, 100],
    ['right C', 'right', { left: 0, right: 1000 }, { left: 0, right: 700 },
      { left: -100, right: 800 }, 0],
    ['right D', 'right', { left: 0, right: 1000 }, { left: 0, right: 1150 },
      { left: -100, right: 1100 }, 50],
    ['left A', 'left', { left: 0, right: 1000 }, { left: 300, right: 1000 },
      { left: 200, right: 800 }, 100],
    ['left B', 'left', { left: 0, right: 1000 }, { left: -250, right: 1000 },
      { left: -100, right: 1100 }, -100],
    ['left C', 'left', { left: 0, right: 1000 }, { left: 300, right: 1000 },
      { left: 200, right: 1100 }, 0],
    ['left D', 'left', { left: 0, right: 1000 }, { left: -150, right: 1000 },
      { left: -100, right: 1100 }, -50]
  ];
  const scaled = (interval, zoom) => ({
    left: interval.left * zoom,
    right: interval.right * zoom
  });
  for (const zoom of [0.5, 0.67, 0.8, 1, 1.1, 1.5, 3]) {
    const projected = model.projectFrame(frame, { cameraX: 440, zoom });
    assert.equal(projected.worldWidth, 1000);
    assert.equal(projected.screenWidth, 1000 * zoom);
    assert.equal(projected.leftScreen, 440 + (75 - 500) * zoom);
    assert.equal(projected.rightScreen, 440 + (75 + 500) * zoom);
    for (const [label, movingEdge, oldViewport, newViewport, projectedFrame,
      expectedShift] of cases) {
      const correction = resize(
        scaled(oldViewport, zoom),
        scaled(newViewport, zoom),
        scaled(projectedFrame, zoom),
        movingEdge
      );
      assert.equal(correction.applicable, true, `${label} @ ${zoom}`);
      assert.ok(
        Math.abs(correction.requestedScreenShiftX - expectedShift * zoom) < 1e-9,
        `${label} @ ${zoom}`
      );
    }
    const zoomOnly = resize(
      { left: 0, right: 1000 },
      { left: 0, right: 1000 },
      projected,
      'right'
    );
    assert.equal(zoomOnly.applicable, false, `zoom-only @ ${zoom}`);
    assert.equal(zoomOnly.requestedScreenShiftX, 0, `zoom-only shift @ ${zoom}`);
    const offscreen = resize(
      { left: 0, right: 1000 },
      { left: 0, right: 900 },
      { left: 3000 * zoom, right: 3600 * zoom },
      'right'
    );
    assert.equal(offscreen.applicable, false, `fully offscreen @ ${zoom}`);
    assert.equal(offscreen.requestedScreenShiftX, 0, `fully offscreen shift @ ${zoom}`);
    assert.deepEqual(frame, canonical);
  }
});

test('legacy view geometry migrates once into camera screen offset and drops compression state', () => {
  const legacy = {
    panX: 25,
    panY: -10,
    zoom: 1.5,
    markdownFrameOffsetX: 40,
    markdownFrameWidth: 512,
    markdownFramePreferredWidth: 760,
    markdownFrameConstraintSide: 'right',
    neighbouringState: { keep: true }
  };
  const migrated = model.migrateLegacyFrameViewState(legacy);
  assert.equal(migrated.panX, 85);
  assert.equal(migrated.panY, -10);
  assert.deepEqual(migrated.neighbouringState, { keep: true });
  for (const field of model.LEGACY_VIEW_FRAME_FIELDS) {
    assert.equal(Object.hasOwn(migrated, field), false);
  }
  assert.equal(Object.hasOwn(migrated, 'textFrame'), false,
    'temporary rendered width never becomes canonical Page geometry');
  assert.deepEqual(model.migrateLegacyFrameViewState(migrated), migrated,
    'migration is idempotent after the old owner is removed');
  assert.equal(legacy.panX, 25, 'migration does not mutate the stored input object');

  const partiallyMigratedPageView = model.migrateLegacyFrameViewState({
    panX: 25,
    zoom: 1.5,
    markdownFrameOffsetX: 40
  }, {
    centerWorldX: -20,
    preferredWidth: 1000
  });
  assert.equal(partiallyMigratedPageView.panX, 115,
    'camera absorbs the legacy position relative to the Page canonical centre');
});

test('browser and CommonJS consumers expose the same pure owner', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'public', 'structuredTextFrame.js'),
    'utf8'
  ), context);
  const browser = JSON.parse(vm.runInContext(`JSON.stringify({
    frame: structuredTextFrameModel.normalizeTextFrame({ centerWorldX: 12, preferredWidth: 900 }),
    edges: structuredTextFrameModel.edgesForFrame({ centerWorldX: 12, preferredWidth: 900 })
  })`, context));
  assert.deepEqual(browser.frame, model.normalizeTextFrame({ centerWorldX: 12, preferredWidth: 900 }));
  assert.deepEqual(browser.edges, model.edgesForFrame({ centerWorldX: 12, preferredWidth: 900 }));
});
