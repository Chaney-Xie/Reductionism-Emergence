const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FakeElement,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

const root = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(root, 'public/js/markdownPageView.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(root, 'public/js/canvasBlocks.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('Markdown presentation host is a sibling of the scaled Canvas Object stage', () => {
  const view = loadMarkdownPageViewInternals(['createMarkdownPresentationHost']);
  const area = new FakeElement({ tagName: 'main' });
  const stage = new FakeElement({ tagName: 'div' });
  stage.className = 'canvas-stage';
  area.append(stage);

  const host = view.createMarkdownPresentationHost(stage, area);
  assert.ok(host);
  assert.equal(host.cameraLayer.parentElement, area);
  assert.equal(host.worldLayer.parentElement, host.cameraLayer);
  assert.equal(stage.contains(host.cameraLayer), false);
  assert.equal(host.cameraLayer.className, 'markdown-page-camera-layer');
  assert.equal(host.worldLayer.className, 'markdown-page-world-layer');
});

test('Page zoom updates Markdown layout zoom and translation without rebuilding its DOM', () => {
  const view = loadMarkdownPageViewInternals(['applyMarkdownPresentationGeometry']);
  const cameraLayer = new FakeElement();
  const worldLayer = new FakeElement();
  const stableDocument = new FakeElement({ tagName: 'article' });
  worldLayer.append(stableDocument);
  const state = { cameraLayer, worldLayer, zoom: 1, cameraOffsetX: 0, cameraOffsetY: 0 };

  for (const zoom of [0.5, 0.67, 0.8, 1, 1.1, 1.5, 3]) {
    state.zoom = zoom;
    state.cameraOffsetX = 123.375 - zoom;
    state.cameraOffsetY = -41.625 + zoom;
    assert.equal(view.applyMarkdownPresentationGeometry(state), true);
    assert.equal(worldLayer.style.zoom, String(zoom));
    assert.equal(
      cameraLayer.style.transform,
      `translate3d(${state.cameraOffsetX}px, ${state.cameraOffsetY}px, 0)`
    );
    assert.equal(worldLayer.children[0], stableDocument);
  }
});

test('Markdown wrapping width and world edges stay invariant at every required zoom', () => {
  const view = loadMarkdownPageViewInternals(['applyLayerGeometry']);
  const layer = new FakeElement();
  const state = {
    layer,
    textFrame: { centerWorldX: 230, preferredWidth: 840 },
    zoom: 1
  };

  for (const zoom of [0.5, 0.67, 0.8, 1, 1.1, 1.5, 3]) {
    state.zoom = zoom;
    view.applyLayerGeometry(state);
    assert.equal(layer.style.width, '840px');
    assert.equal(layer.style.left, '-190px');
    assert.equal(layer.style.getPropertyValue('--markdown-document-width'), '840px');
    assert.equal(layer.dataset.leftWorld, '-190');
    assert.equal(layer.dataset.rightWorld, '650');
  }
});

test('Canvas Objects keep transform scaling while Markdown has translation plus CSS zoom', () => {
  assert.match(
    canvasSource,
    /stage\.style\.transform = `translate\(\$\{view\.offsetX\}px, \$\{view\.offsetY\}px\) scale\(\$\{view\.scale\}\)`/
  );
  assert.match(
    canvasSource,
    /updateMarkdownPageLayer\(stage, \{\s*zoom: view\.scale,\s*cameraOffsetX: view\.offsetX,\s*cameraOffsetY: view\.offsetY/
  );
  assert.match(
    viewSource,
    /state\.cameraLayer\.style\.transform = `translate3d\([^]*?state\.worldLayer\.style\.zoom = String\(zoom\)/
  );
  assert.match(
    viewSource,
    /const geometry = textFrameEdges\(state\.textFrame\);[^]*?state\.layer\.style\.left = `\$\{geometry\.leftWorld\}px`[^]*?--markdown-document-width[^]*?geometry\.worldWidth/
  );
  assert.doesNotMatch(declarations('.markdown-page-camera-layer'), /will-change\s*:/);
  assert.doesNotMatch(declarations('.markdown-page-world-layer'), /will-change\s*:/);
  assert.doesNotMatch(declarations('.markdown-page-layer'), /transform\s*:/);
});

test('Markdown and Canvas retain the same world-to-screen geometry at every approved zoom', () => {
  const cameraX = 317.25;
  const cameraY = -63.5;
  const worldPoints = [
    { x: -380, y: 0 },
    { x: -125.5, y: 240.25 },
    { x: 0, y: 512 },
    { x: 427.75, y: 900.5 }
  ];
  for (const zoom of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4]) {
    for (const point of worldPoints) {
      const canvasScreen = {
        x: cameraX + point.x * zoom,
        y: cameraY + point.y * zoom
      };
      const markdownScreen = {
        x: cameraX + point.x * zoom,
        y: cameraY + point.y * zoom
      };
      assert.deepEqual(markdownScreen, canvasScreen);
      assert.ok(Math.abs((markdownScreen.x - cameraX) / zoom - point.x) < 1e-9);
      assert.ok(Math.abs((markdownScreen.y - cameraY) / zoom - point.y) < 1e-9);
    }
  }
});

test('Markdown visual frame is Pane-local while semantic document extent stays content-derived', () => {
  const view = loadMarkdownPageViewInternals([
    'calculateMarkdownVisualFrameExtent',
    'updateMarkdownVisualFrameExtent'
  ]);
  const documentExtent = {
    top: 0,
    bottom: 608,
    height: 608,
    contentBottom: 230,
    objectBottom: 0,
    bottomPadding: 128
  };

  const scenarios = [
    {
      paneViewportHeight: 800,
      zoom: 1,
      cameraOffsetY: 0,
      expectedViewportBottom: 800,
      expectedVisualBottom: 800
    },
    {
      paneViewportHeight: 800,
      zoom: 0.5,
      cameraOffsetY: -40,
      expectedViewportBottom: 1680,
      expectedVisualBottom: 1680
    },
    {
      paneViewportHeight: 800,
      zoom: 2,
      cameraOffsetY: -304,
      expectedViewportBottom: 552,
      expectedVisualBottom: 608
    }
  ];

  for (const scenario of scenarios) {
    const visual = view.calculateMarkdownVisualFrameExtent({
      documentTop: documentExtent.top,
      documentBottom: documentExtent.bottom,
      viewportHeight: scenario.paneViewportHeight,
      scale: scenario.zoom,
      cameraOffsetY: scenario.cameraOffsetY
    });
    assert.equal(visual.documentBottom, 608);
    assert.equal(visual.viewportWorldBottom, scenario.expectedViewportBottom);
    assert.equal(visual.bottom, scenario.expectedVisualBottom);
  }

  const boundary = new FakeElement();
  const layer = new FakeElement();
  layer.style.height = '608px';
  const state = {
    area: { clientHeight: 800 },
    frameBoundary: boundary,
    layer,
    documentExtent,
    zoom: 0.5,
    cameraOffsetY: -40
  };
  const visual = view.updateMarkdownVisualFrameExtent(state);

  assert.equal(visual.bottom, 1680);
  assert.equal(boundary.style.height, '1680px');
  assert.equal(layer.style.height, '608px');
  assert.equal(boundary.dataset.documentBottom, '608');
  assert.equal(boundary.dataset.viewportWorldBottom, '1680');
  assert.equal(layer.dataset.visualFrameBottom, '1680');
});
