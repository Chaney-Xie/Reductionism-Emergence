'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createPaneRuntimeHarness,
  deferred
} = require('./helpers/paneRuntimeHarness');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFile(path.join(ROOT, relativePath), 'utf8');

function page(id, { blockId = `block-${id}`, info = `Info for ${id}` } = {}) {
  return {
    id,
    code: id,
    name: id,
    type: 'canvas',
    objects: [],
    blocks: [{
      id: blockId,
      objectId: `object-${id}`,
      x: 10,
      y: 15,
      width: 80,
      height: 60,
      rotation: 0,
      links: [],
      info
    }],
    highlightGroups: []
  };
}

function imageObject(id) {
  return {
    id,
    type: 'image',
    src: `assets/${id}.png`,
    displayable: true,
    visible: true,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    naturalWidth: 1600,
    naturalHeight: 1200
  };
}

test('PaneRuntime harness models exact runtime identity rather than reusable Pane id', async () => {
  const harness = await createPaneRuntimeHarness();
  const runtime = harness.left.runtime;
  const operation = harness.captureRuntimeOperation(runtime, {
    scope: 'identity-probe',
    pageId: runtime.currentPage.id,
    generation: 3
  });

  assert.equal(harness.runtimeOperationIsCurrent(operation), true);
  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  assert.equal(harness.runtimeOperationIsCurrent(operation), true,
    'becoming inactive must not invalidate work owned by a live runtime');

  const replacement = harness.replaceRuntimeWithSamePaneId(runtime);
  assert.equal(replacement.pane.id, runtime.paneId);
  assert.notEqual(replacement.runtime, runtime);
  assert.notEqual(replacement.runtime.runtimeId, runtime.runtimeId);
  assert.equal(harness.runtimeOperationIsCurrent(operation), false,
    'a new runtime with the same Pane id must not revive an old operation');
});

test('Canvas image sessions execute against the explicit runtime and accept inactive work', async () => {
  const requests = [];
  const harness = await createPaneRuntimeHarness({
    leftPage: page('page-shared'),
    rightPage: page('page-shared'),
    globals: {
      cneDesktop: {
        requestDisplayProxy(detail) {
          const request = deferred();
          requests.push({ detail, ...request });
          return request.promise;
        }
      }
    }
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'resetCanvasImageSession',
    'canvasImageState',
    'requestCanvasImageResolution'
  ]);
  const leftObject = imageObject('left-image');
  const rightObject = imageObject('right-image');
  const { left, right } = harness;
  left.runtime.canvasObjects = [leftObject];
  right.runtime.canvasObjects = [rightObject];
  api.resetCanvasImageSession(left.runtime, left.runtime.currentPage.id);
  api.resetCanvasImageSession(right.runtime, right.runtime.currentPage.id);

  const leftPending = api.requestCanvasImageResolution(left.runtime, leftObject, 900);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].detail.objectId, leftObject.id);
  assert.equal(requests[0].detail.pageId, left.runtime.currentPage.id);

  harness.setActiveWorkspacePane(right.runtime.paneId);
  requests[0].resolve({
    ok: true,
    fingerprint: 'left-fingerprint',
    generationPending: false
  });
  await leftPending;
  assert.equal(api.canvasImageState(left.runtime, leftObject).fingerprint, 'left-fingerprint');
  assert.equal(right.runtime.canvasImageVariantStates.has(leftObject.id), false);
  assert.equal(harness.activePaneRuntime(), right.runtime,
    'an inactive completion must not activate or overwrite another runtime');

  const rightPending = api.requestCanvasImageResolution(right.runtime, rightObject, 700);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  const staleState = api.canvasImageState(right.runtime, rightObject);
  const replacement = harness.replaceRuntimeWithSamePaneId(right.runtime, {
    page: page('page-replacement')
  });
  requests[1].resolve({
    ok: true,
    fingerprint: 'must-not-install',
    generationPending: false
  });
  await rightPending;

  assert.equal(staleState.fingerprint, null);
  assert.equal(replacement.runtime.canvasImageVariantStates.size, 0);
  assert.equal(harness.activePaneRuntime(), replacement.runtime);
});

test('Canvas resource URLs resolve from the owning runtime for same-Page and different-Page Panes', async () => {
  const sharedPage = page('page-shared-resource');
  const calls = [];
  const harness = await createPaneRuntimeHarness({
    leftPage: sharedPage,
    rightPage: sharedPage,
    globals: {
      cacheBustedSrc(runtime, object) {
        calls.push({ runtime, pageId: runtime.currentPage?.id, objectId: object.id });
        return `${runtime.currentPage?.id}/${object.src}`;
      }
    }
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['renderCanvas']);
  const leftImage = imageObject('left-resource');
  const rightImage = imageObject('right-resource');

  api.renderCanvas(harness.left.runtime, [leftImage], [], { fit: false });
  api.renderCanvas(harness.right.runtime, [rightImage], [], { fit: false });
  assert.deepEqual(calls.map(({ runtime, pageId, objectId }) => ({
    runtimeId: runtime.runtimeId,
    pageId,
    objectId
  })), [
    {
      runtimeId: harness.left.runtime.runtimeId,
      pageId: sharedPage.id,
      objectId: leftImage.id
    },
    {
      runtimeId: harness.right.runtime.runtimeId,
      pageId: sharedPage.id,
      objectId: rightImage.id
    }
  ]);

  const differentPage = page('page-different-resource');
  harness.right.runtime.currentPage = differentPage;
  harness.right.runtime.session.activeTab().currentPageId = differentPage.id;
  calls.length = 0;
  api.renderCanvas(harness.right.runtime, [rightImage], [], { fit: false });
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0].runtime, harness.right.runtime);
  assert.equal(calls[0].pageId, differentPage.id);
  assert.equal(harness.left.runtime.currentPage.id, sharedPage.id);
});

test('Canvas camera, bounds, edit, Highlight, and Quick Colour state are runtime-isolated', async () => {
  const harness = await createPaneRuntimeHarness({
    leftPage: page('page-left-canvas', { blockId: 'block-left' }),
    rightPage: page('page-right-canvas', { blockId: 'block-right' })
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'fitCanvasToObjects',
    'screenToWorld',
    'canvasInteractionBlocks',
    'highlightMaskExclusionRegions',
    'quickColourState',
    'closeQuickColourBar'
  ]);
  const { left, right } = harness;
  const leftViewBefore = { ...left.runtime.canvasView };
  const leftStageBefore = left.runtime.dom.canvasStage.style.transform || '';
  const rightObject = {
    ...imageObject('right-object'),
    x: 100,
    y: 80,
    width: 200,
    height: 100
  };
  right.runtime.canvasObjects = [rightObject];

  api.fitCanvasToObjects(right.runtime, right.runtime.canvasObjects);
  assert.deepEqual(left.runtime.canvasView, leftViewBefore);
  assert.equal(left.runtime.canvasBounds, null);
  assert.equal(left.runtime.dom.canvasStage.style.transform || '', leftStageBefore);
  assert.deepEqual(
    {
      minX: right.runtime.canvasBounds.minX,
      minY: right.runtime.canvasBounds.minY,
      maxX: right.runtime.canvasBounds.maxX,
      maxY: right.runtime.canvasBounds.maxY
    },
    { minX: 100, minY: 80, maxX: 300, maxY: 180 }
  );

  right.runtime.canvasView = { scale: 2, offsetX: 40, offsetY: -20 };
  assert.deepEqual(
    { ...api.screenToWorld(right.runtime, 900, 260) },
    { x: 100, y: 120 }
  );
  assert.deepEqual(left.runtime.canvasView, leftViewBefore);

  left.runtime.blockEditMode = true;
  left.runtime.draftBlocks = [{ id: 'left-draft' }];
  right.runtime.blockEditMode = true;
  right.runtime.draftBlocks = [{ id: 'right-draft' }];
  assert.equal(api.canvasInteractionBlocks(left.runtime)[0].id, 'left-draft');
  assert.equal(api.canvasInteractionBlocks(right.runtime)[0].id, 'right-draft');
  right.runtime.pageEditMode = true;
  assert.deepEqual(Array.from(api.canvasInteractionBlocks(right.runtime)), []);
  assert.equal(api.canvasInteractionBlocks(left.runtime)[0].id, 'left-draft');

  left.runtime.canvasObjects = [{ id: 'object-left' }];
  left.runtime.activeHighlightBlockIds = new Set(['block-left']);
  const leftHighlight = api.highlightMaskExclusionRegions(
    left.runtime,
    [{
      id: 'block-left', objectId: 'object-left',
      x: 10, y: 15, width: 80, height: 60, rotation: 0
    }]
  );
  const rightHighlight = api.highlightMaskExclusionRegions(
    right.runtime,
    [{
      id: 'block-right', objectId: 'right-object',
      x: 20, y: 25, width: 50, height: 40, rotation: 0
    }],
    new Set()
  );
  assert.equal(leftHighlight.length, 1);
  assert.equal(leftHighlight[0].id, 'block-left');
  assert.deepEqual(Array.from(rightHighlight), []);

  const leftQuickColour = api.quickColourState(left.runtime);
  const rightQuickColour = api.quickColourState(right.runtime);
  let rightObserverDisconnected = false;
  let rightHostRemoved = false;
  Object.assign(leftQuickColour, {
    blockId: 'block-left',
    pageId: left.runtime.currentPage.id,
    manualPosition: { left: 11, top: 12 }
  });
  Object.assign(rightQuickColour, {
    blockId: 'block-right',
    pageId: right.runtime.currentPage.id,
    manualPosition: { left: 21, top: 22 },
    resizeObserver: { disconnect: () => { rightObserverDisconnected = true; } },
    overlayHost: { remove: () => { rightHostRemoved = true; } }
  });
  api.closeQuickColourBar(right.runtime);
  assert.equal(rightObserverDisconnected, true);
  assert.equal(rightHostRemoved, true);
  assert.equal(rightQuickColour.blockId, null);
  assert.equal(rightQuickColour.pageId, null);
  assert.equal(rightQuickColour.manualPosition, null);
  assert.equal(leftQuickColour.blockId, 'block-left');
  assert.equal(leftQuickColour.pageId, left.runtime.currentPage.id);
  assert.deepEqual(leftQuickColour.manualPosition, { left: 11, top: 12 });
});

test('an inactive Canvas transform updates only its Pane surface, not active-only chrome', async () => {
  const markdownRefreshes = [];
  const hnRefreshes = [];
  const harness = await createPaneRuntimeHarness({
    globals: {
      refreshMarkdownControlStrip: (runtime) => markdownRefreshes.push(runtime.runtimeId),
      refreshHnTextControlStrip: (runtime) => hnRefreshes.push(runtime.runtimeId)
    }
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['applyCanvasTransform']);
  harness.right.runtime.canvasView = { scale: 1.5, offsetX: 37, offsetY: -19 };

  api.applyCanvasTransform(harness.right.runtime);
  assert.equal(
    harness.right.runtime.dom.canvasStage.style.transform,
    'translate(37px, -19px) scale(1.5)'
  );
  assert.deepEqual(markdownRefreshes, []);
  assert.deepEqual(hnRefreshes, []);
  assert.deepEqual(harness.left.runtime.canvasView, { scale: 1, offsetX: 0, offsetY: 0 });

  api.applyCanvasTransform(harness.left.runtime);
  assert.deepEqual(markdownRefreshes, [harness.left.runtime.runtimeId]);
  assert.deepEqual(hnRefreshes, [harness.left.runtime.runtimeId]);
});

test('Info runtime tokens include exact runtime, session, Tab, Page, mount, and revision', async () => {
  const shared = page('page-info-shared', { blockId: 'block-shared' });
  const harness = await createPaneRuntimeHarness({ leftPage: shared, rightPage: shared });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelRuntimeState',
    'infoPanelRuntimeToken',
    'infoPanelRuntimeTokenIsCurrent'
  ]);
  const runtime = harness.left.runtime;
  api.ensureInfoPanelRuntimeState(runtime);
  runtime.infoPanelEditorRevision = 11;
  const token = api.infoPanelRuntimeToken(runtime, {
    kind: 'block',
    ownerId: 'block-shared',
    revision: 11,
    includeMount: true
  });

  assert.equal(token.runtime, runtime);
  assert.equal(token.runtimeId, runtime.runtimeId);
  assert.equal(token.lifecycleEpoch, runtime.lifecycleEpoch);
  assert.equal(token.session, runtime.session);
  assert.equal(token.tabId, runtime.session.activeTab().id);
  assert.equal(token.pageId, shared.id);
  assert.equal(token.mountGeneration, runtime.mounted.generation);
  assert.equal(api.infoPanelRuntimeTokenIsCurrent(token, {
    requireOwner: true,
    requireRevision: true,
    requireMount: true
  }), true);

  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  assert.equal(api.infoPanelRuntimeTokenIsCurrent(token, {
    requireOwner: true,
    requireRevision: true,
    requireMount: true
  }), true, 'inactive does not mean stale');

  runtime.infoPanelEditorRevision += 1;
  assert.equal(api.infoPanelRuntimeTokenIsCurrent(token, { requireRevision: true }), false);
  runtime.infoPanelEditorRevision = 11;
  runtime.mounted.generation += 1;
  assert.equal(api.infoPanelRuntimeTokenIsCurrent(token, { requireMount: true }), false);
  runtime.mounted.generation -= 1;

  harness.replaceRuntimeWithSamePaneId(runtime);
  assert.equal(api.infoPanelRuntimeTokenIsCurrent(token), false);
});

test('Info geometry and suspended editor state stay in their owning runtime and Tab', async () => {
  const shared = page('page-info-layout', { blockId: 'block-layout' });
  const harness = await createPaneRuntimeHarness({ leftPage: shared, rightPage: shared });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelRuntimeState',
    'ensureInfoPanelEntry',
    'infoPanelRuntimeToken',
    'infoPanelIdentityForRuntime',
    'commitInfoPanelGeometryToViewState',
    'preserveInfoPanelEditorForSuspension',
    'restoreInfoPanelEditorAfterSuspension'
  ]);
  const { left, right } = harness;
  api.ensureInfoPanelRuntimeState(left.runtime);
  api.ensureInfoPanelRuntimeState(right.runtime);
  const leftEntry = api.ensureInfoPanelEntry(left.runtime, 'block', 'block-layout');
  const rightEntry = api.ensureInfoPanelEntry(right.runtime, 'block', 'block-layout');
  const leftIdentity = api.infoPanelIdentityForRuntime(left.runtime, 'block', 'block-layout');

  assert.notEqual(leftEntry, rightEntry);
  assert.equal(api.commitInfoPanelGeometryToViewState(right.runtime, leftIdentity, {
    left: 91,
    top: 73,
    width: 360,
    height: 250
  }), null, 'a token from another runtime cannot mutate this Tab view state');
  assert.ok(api.commitInfoPanelGeometryToViewState(left.runtime, leftIdentity, {
    left: 91,
    top: 73,
    width: 360,
    height: 250
  }));
  assert.deepEqual(
    {
      x: leftEntry.x,
      y: leftEntry.y,
      width: leftEntry.width,
      height: leftEntry.height,
      autoPositioned: leftEntry.autoPositioned
    },
    { x: 91, y: 73, width: 360, height: 250, autoPositioned: false }
  );
  assert.deepEqual(
    { x: rightEntry.x, y: rightEntry.y, width: rightEntry.width, height: rightEntry.height },
    { x: 16, y: 16, width: 320, height: 220 }
  );

  left.runtime.infoPanelEditorRevision = 7;
  const editorRuntimeToken = api.infoPanelRuntimeToken(left.runtime, {
    kind: 'block',
    ownerId: 'block-layout',
    revision: 7,
    includeMount: true
  });
  left.runtime.infoPanelEditor = {
    runtime: left.runtime,
    tabId: left.runtime.session.activeTab().id,
    pageId: shared.id,
    kind: 'block',
    ownerId: 'block-layout',
    revision: 7,
    runtimeToken: editorRuntimeToken,
    draftText: 'stale',
    textarea: {
      value: 'left Pane draft',
      selectionStart: 5,
      selectionEnd: 9,
      selectionDirection: 'forward'
    }
  };
  assert.equal(api.preserveInfoPanelEditorForSuspension(left.runtime), true);
  assert.equal(left.runtime.infoPanelEditor, null);
  assert.equal(left.runtime.suspendedInfoPanelEditor.draftText, 'left Pane draft');
  assert.equal(right.runtime.infoPanelEditor, null);
  assert.equal(right.runtime.suspendedInfoPanelEditor, null);
  left.runtime.mounted.generation += 1;
  assert.equal(api.restoreInfoPanelEditorAfterSuspension(left.runtime), true);
  assert.equal(left.runtime.infoPanelEditor.runtimeToken.mountGeneration, 1,
    'a same-Page remount must preserve the logical editor token rather than rewriting it');
  assert.equal(left.runtime.infoPanelEditor.draftText, 'left Pane draft');
  assert.equal(right.runtime.infoPanelEditor, null);
});

test('Info pointer geometry ignores a stale mount token and never persists it', async () => {
  const ownerPage = page('page-info-pointer', { blockId: 'block-pointer' });
  const harness = await createPaneRuntimeHarness({ leftPage: ownerPage });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'infoPanelLayerForRuntime',
    'beginInfoPanelDrag',
    'scheduleInfoPanelGeometryFrame',
    'cancelInfoPanelGeometryGesture'
  ]);
  const runtime = harness.left.runtime;
  const entry = api.ensureInfoPanelEntry(runtime, 'block', 'block-pointer');
  const layer = api.infoPanelLayerForRuntime(runtime);
  layer.clientWidth = 620;
  layer.clientHeight = 480;
  const originalAreaQuery = runtime.dom.canvasArea.querySelector.bind(runtime.dom.canvasArea);
  runtime.dom.canvasArea.querySelector = (selector) => (
    selector === ':scope > .info-panel-layer' ? layer : originalAreaQuery(selector)
  );
  const panel = harness.document.createElement('section');
  panel.className = 'info-panel is-fixed';
  Object.assign(panel.style, {
    left: '16px',
    top: '16px',
    width: '320px',
    height: '220px'
  });
  const titlebar = harness.document.createElement('header');
  titlebar.className = 'info-panel-titlebar';
  panel.append(titlebar);
  layer.append(panel);
  let persisted = 0;
  const saveViewState = runtime.session.saveViewState;
  runtime.session.saveViewState = (...args) => {
    persisted += 1;
    return saveViewState(...args);
  };

  assert.equal(api.beginInfoPanelDrag({
    ...harness.pointer(runtime, {
      pointerId: 31,
      clientX: 30,
      clientY: 30,
      target: titlebar
    }),
    isPrimary: true
  }, runtime, entry, panel), true);
  const gesture = runtime.infoPanelGeometryGesture;
  assert.ok(gesture);
  api.scheduleInfoPanelGeometryFrame(gesture, harness.pointer(runtime, {
    pointerId: 31,
    clientX: 70,
    clientY: 85,
    target: titlebar
  }));
  harness.raf.flush(1);
  assert.equal(panel.style.transform, 'translate3d(40px, 55px, 0)');

  runtime.mounted.generation += 1;
  api.scheduleInfoPanelGeometryFrame(gesture, harness.pointer(runtime, {
    pointerId: 31,
    clientX: 140,
    clientY: 155,
    target: titlebar
  }));
  harness.raf.flush(1);
  assert.equal(panel.style.transform, 'translate3d(40px, 55px, 0)',
    'the detached mount cannot receive a later pointer frame');
  assert.equal(api.cancelInfoPanelGeometryGesture(runtime), true);
  assert.equal(runtime.infoPanelGeometryGesture, null);
  assert.equal(persisted, 0, 'stale geometry is never written to Tab view state');
  assert.deepEqual(
    { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
    { x: 16, y: 16, width: 320, height: 220 }
  );
});

test('a failed Info save restores its exact retry draft across a same-Page remount', async () => {
  const ownerPage = page('page-info-retry-remount', { blockId: 'block-retry-remount' });
  const request = deferred();
  let runtime = null;
  let canonicalPages = null;
  const harness = await createPaneRuntimeHarness({
    leftPage: ownerPage,
    globals: {
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      request: () => request.promise,
      commitCanonicalPage(saved) {
        canonicalPages.set(saved.id, saved);
        runtime.currentPage = saved;
        return saved;
      }
    }
  });
  runtime = harness.left.runtime;
  canonicalPages = harness.context.canonicalPages;
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'infoPanelRuntimeToken',
    'saveInfoPanelEditor'
  ]);
  api.ensureInfoPanelEntry(runtime, 'block', 'block-retry-remount');
  runtime.infoPanelEditorRevision = 4;
  runtime.infoPanelEditor = {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    paneId: runtime.paneId,
    tabId: runtime.session.activeTab().id,
    pageId: ownerPage.id,
    kind: 'block',
    ownerId: 'block-retry-remount',
    originalText: 'Info for page-info-retry-remount',
    draftText: 'Exact retry draft',
    selectionOffset: 6,
    revision: 4,
    runtimeToken: api.infoPanelRuntimeToken(runtime, {
      kind: 'block',
      ownerId: 'block-retry-remount',
      revision: 4,
      includeMount: true
    }),
    textarea: {
      value: 'Exact retry draft',
      selectionStart: 6,
      selectionEnd: 11,
      selectionDirection: 'forward'
    }
  };

  const saving = api.saveInfoPanelEditor(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.infoPanelEditor, null);
  runtime.mounted.generation += 1;
  request.reject(new Error('simulated retry failure'));
  const result = await saving;

  assert.equal(result.ok, false);
  assert.equal(runtime.infoPanelEditor?.draftText, 'Exact retry draft');
  assert.equal(runtime.infoPanelEditor?.selectionOffset, 6);
  assert.equal(runtime.infoPanelEditor?.runtimeToken.mountGeneration, 1,
    'retry ownership remains logical across a presentation-only remount');
  assert.equal(canonicalPages.get(ownerPage.id).blocks[0].info,
    'Info for page-info-retry-remount');
});

test('same-runtime Info rerender preserves the live draft and exact selection direction', async () => {
  const ownerPage = page('page-info-rerender', { blockId: 'block-rerender' });
  const harness = await createPaneRuntimeHarness({ leftPage: ownerPage });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'renderInfoPanelsForRuntime',
    'beginInfoPanelEditing'
  ]);
  const runtime = harness.left.runtime;
  api.ensureInfoPanelEntry(runtime, 'block', 'block-rerender');
  api.renderInfoPanelsForRuntime(runtime);
  assert.equal(api.beginInfoPanelEditing(runtime, 'block', 'block-rerender'), true);
  const originalTextarea = runtime.infoPanelEditor.textarea;
  originalTextarea.value = 'Live rerender draft';
  originalTextarea.selectionStart = 3;
  originalTextarea.selectionEnd = 12;
  originalTextarea.selectionDirection = 'backward';

  api.renderInfoPanelsForRuntime(runtime);
  const replacementTextarea = runtime.infoPanelEditor.textarea;
  assert.notEqual(replacementTextarea, originalTextarea);
  assert.equal(runtime.infoPanelEditor.draftText, 'Live rerender draft');
  assert.equal(runtime.infoPanelEditor.selectionOffset, 3);
  assert.equal(runtime.infoPanelEditor.selectionEnd, 12);
  assert.equal(runtime.infoPanelEditor.selectionDirection, 'backward');

  harness.raf.flush();
  assert.equal(replacementTextarea.value, 'Live rerender draft');
  assert.equal(replacementTextarea.selectionStart, 3);
  assert.equal(replacementTextarea.selectionEnd, 12);
  assert.equal(replacementTextarea.selectionDirection, 'backward');
});

test('discarding a Page during an in-flight Info POST fences its late response', async () => {
  const ownerPage = page('page-info-delete-race', { blockId: 'block-delete-race' });
  const request = deferred();
  let runtime = null;
  let canonicalPages = null;
  const harness = await createPaneRuntimeHarness({
    leftPage: ownerPage,
    globals: {
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      request: () => request.promise,
      commitCanonicalPage(saved) {
        canonicalPages.set(saved.id, saved);
        runtime.currentPage = saved;
        return saved;
      }
    }
  });
  runtime = harness.left.runtime;
  canonicalPages = harness.context.canonicalPages;
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'infoPanelRuntimeToken',
    'saveInfoPanelEditor',
    'discardInfoPanelSavesForPage'
  ]);
  api.ensureInfoPanelEntry(runtime, 'block', 'block-delete-race');
  runtime.infoPanelEditorRevision = 1;
  runtime.infoPanelEditor = {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    paneId: runtime.paneId,
    tabId: runtime.session.activeTab().id,
    pageId: ownerPage.id,
    kind: 'block',
    ownerId: 'block-delete-race',
    originalText: 'Info for page-info-delete-race',
    draftText: 'Must never resurrect',
    revision: 1,
    runtimeToken: api.infoPanelRuntimeToken(runtime, {
      kind: 'block',
      ownerId: 'block-delete-race',
      revision: 1,
      includeMount: true
    }),
    textarea: { value: 'Must never resurrect', selectionStart: 4 }
  };

  const saving = api.saveInfoPanelEditor(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  canonicalPages.delete(ownerPage.id);
  assert.ok(api.discardInfoPanelSavesForPage(ownerPage.id) >= 1);
  request.resolve({
    ...ownerPage,
    blocks: [{ ...ownerPage.blocks[0], info: 'Must never resurrect' }]
  });
  const result = await saving;

  assert.equal(result.ok, true);
  assert.equal(result.discarded, true);
  assert.equal(canonicalPages.has(ownerPage.id), false,
    'a response from the deleted Page epoch must not reinstall canonical data');
  assert.equal(runtime.infoPanelEditor, null);
});

test('one inactive Info content click activates its runtime and opens one editor', async () => {
  const rightPage = page('page-info-inactive', { blockId: 'block-inactive' });
  const harness = await createPaneRuntimeHarness({ rightPage });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'renderInfoPanelsForRuntime'
  ]);
  const runtime = harness.right.runtime;
  api.ensureInfoPanelEntry(runtime, 'block', 'block-inactive');
  api.renderInfoPanelsForRuntime(runtime);
  assert.notEqual(harness.activePaneRuntime(), runtime);
  const content = runtime.dom.canvasArea.querySelector('.info-panel-content');
  assert.ok(content);

  await content.dispatch('click');

  assert.equal(harness.activePaneRuntime(), runtime);
  assert.equal(runtime.infoPanelEditor?.ownerId, 'block-inactive');
  assert.equal(runtime.infoPanelEditorRevision, 1,
    'the originating action must execute exactly once after activating its Pane');
});

test('Pane-local leaf ownership has explicit runtime-first signatures and no legacy state stores', async () => {
  const [canvas, info] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/js/infoPanels.js')
  ]);

  for (const signature of [
    /function resetCanvasImageSession\(runtime, pageId\)/,
    /function canvasImageState\(runtime, object\)/,
    /function renderCanvas\(runtime, objects = \[\], blocks = \[\], \{ fit = true \} = \{\}\)/,
    /function applyCanvasTransform\(runtime\)/,
    /function refreshPaneMarkdownWorldBounds\(runtime,/,
    /function refreshPaneStructuredTextWorldBounds\(runtime,/,
    /function observeStructuredTextViewport\(runtime,/,
    /function screenToWorld\(runtime, clientX, clientY\)/,
    /function zoomAtPoint\(runtime, clientX, clientY, nextScale\)/,
    /function handleCanvasWheel\(runtime, event\)/,
    /function handleBlockPointerDown\(runtime, event\)/,
    /function handleBlockPointerMove\(runtime, event\)/,
    /function finishBlockDrawing\(runtime, event, shouldCommit\)/,
    /function finishBlockTransform\(runtime, event, shouldCommit = true\)/,
    /function handlePageObjectPointerDown\(runtime, event\)/,
    /function handlePageObjectPointerMove\(runtime, event\)/,
    /function finishPageObjectDrag\(runtime, event, shouldCommit = true\)/,
    /function handleCanvasTargetPointerDown\(runtime, event\)/,
    /function handleCanvasTargetPointerMove\(runtime, event\)/,
    /function handleCanvasTargetPointerUp\(runtime, event\)/,
    /function handleCanvasTargetClick\(runtime, event\)/,
    /function handleCanvasTargetContextMenu\(runtime, event\)/,
    /function quickColourState\(runtime\)/,
    /function closeQuickColourBar\(runtime\)/,
    /function applyQuickColourPreset\(runtime, preset\)/,
    /function enterBlockEditMode\(runtime\)/,
    /async function saveBlockEdits\(runtime\)/,
    /function cancelBlockEdits\(runtime\)/,
    /function enterPageEditMode\(runtime, \{ selectObjectId = null \} = \{\}\)/,
    /async function savePageEdits\(runtime\)/,
    /function cancelPageEdits\(runtime\)/
  ]) assert.match(canvas, signature);

  for (const signature of [
    /function ensureInfoPanelRuntimeState\(runtime\)/,
    /function infoPanelRuntimeToken\(runtime,/,
    /function infoPanelRuntimeTokenIsCurrent\(token,/,
    /function renderInfoPanelsForRuntime\(runtime\)/,
    /function suspendInfoPanelsForRuntime\(runtime\)/,
    /function resumeInfoPanelsForRuntime\(runtime\)/,
    /function prepareInfoPanelsForRuntimeContextChange\(runtime,/,
    /function disposeInfoPanelsForRuntime\(runtime\)/,
    /function syncHighlightInfoPanelsForRuntime\(runtime\)/,
    /function cancelInfoPanelGeometryGesture\(runtime,/,
    /function openBlockInfoEditor\(runtime, blockId\)/,
    /function openHighlightGroupInfoEditor\(runtime, groupId\)/,
    /function showTemporaryBlockInfo\(runtime, block\)/,
    /function hideTemporaryBlockInfo\(runtime\)/,
    /function pointerIsOverTemporaryInfoPanel\(runtime, clientX, clientY\)/,
    /function temporaryInfoHoverOwnsPoint\(runtime, blockId, relatedTarget, clientX, clientY\)/
  ]) assert.match(info, signature);

  assert.doesNotMatch(canvas,
    /^let (?:canvasObjects|canvasBounds|canvasView|canvasImageSessionPageId|canvasImageSessionGeneration|canvasImageVariantStates|canvasImageResolutionTimer|blockEditMode|blockVisualMode|originalBlocks|draftBlocks|blockDrawing|blockPreview|selectedBlockId|blockTransform|blockSaveInProgress|pageEditMode|originalPageObjects|originalPageBlocks|originalPageTextFrame|draftPageObjects|draftPageBlocks|draftPageTextFrame|selectedPageObjectId|pageObjectDrag|pageEditSaveInProgress|hoveredCanvasBlockId|activeHighlightGroupId|activeHighlightBlockIds|selectedHighlightBlockIds|highlightEditDraft|blockStateRequests|addLinkTarget|linkPickMode|addLinkInProgress|quickColour|quickColourBlockId|quickColourPageId|quickColourOverlayHost|quickColourBarResizeObserver|quickColourManualPosition|quickColourBarDrag|quickColourSuppressClickTimer|quickColourSuppressNextClick)\b/m);
  assert.doesNotMatch(info,
    /^let (?:infoPanelsSuspended|suspendedInfoPanelEditor|temporaryInfoBlockId|infoPanelEditor|infoPanelEditorRevision|infoPanelGeometryGesture|infoPanelFocusFrame|activeInfoPanelEditor|activeInfoPanelDragGesture|activeInfoPanelResizeGesture|preservedInfoPanelPaneId)\b/m);
  assert.match(canvas,
    /function refreshCanvasBlockAppearance\(blockAppearance = null\)[^]*?for \(const runtime of livingPaneRuntimes\(\)\)/);
  assert.match(info, /function renderInfoPanelsForPage\(pageId\)[^]*?livingPaneRuntimes\(\)/);
  assert.match(canvas, /captureRuntimeOperation\(runtime, \{[^]*?scope: 'canvas-image-resolution'/);
  assert.match(canvas, /runtimeOperationIsCurrent\(operation\)/);
  assert.match(info, /runtimeId: liveRuntime\.runtimeId[^]*?lifecycleEpoch: liveRuntime\.lifecycleEpoch[^]*?session: liveRuntime\.session/);
});

test('runtime consumers and conformance setup have no mutable active-Pane compatibility bridge', async () => {
  const productionPaths = [
    'public/app.js',
    'public/js/appBootstrap.js',
    'public/js/canvasBlocks.js',
    'public/js/infoPanels.js',
    'public/js/externalLinks.js',
    'public/js/descriptorModal.js',
    'public/js/navigation.js',
    'public/js/rightSidebar.js',
    'public/js/vaultSettings.js'
  ];
  const production = (await Promise.all(productionPaths.map(read))).join('\n');
  const conformance = await read('test/markdownConformance/runner/adapters/viewerV1.mjs');

  assert.doesNotMatch(production,
    /\b(?:captureRuntimeIntoPane|restoreRuntimeFromPane|getActivePaneSession|getActivePaneViewContext)\b/);
  assert.doesNotMatch(production, /\bshowStatus\s*\(/);
  assert.doesNotMatch(conformance, /\b(?:captureRuntimeIntoPane|restoreRuntimeFromPane)\b/);
  assert.match(conformance,
    /const runtime = activePaneRuntime\(\)[^]*?completePageOpen\(runtime, entry, saved/);
  assert.match(conformance,
    /runtime\.currentPage = commitCanonicalPage\(saved, \{ originRuntime: runtime \}\)[^]*?renderPage\(runtime, runtime\.currentPage, \{ installCanonical: false \}\)/);
});

test('bottom Markdown and HN zoom controls resolve one live runtime per click', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  const controls = [
    ['markdownZoomOutButton', 'zoomActiveMarkdownBy(runtime, 0.9)'],
    ['markdownZoomValueButton', 'resetActiveMarkdownZoom(runtime)'],
    ['markdownZoomInButton', 'zoomActiveMarkdownBy(runtime, 1.1)'],
    ['hnTextZoomOutButton', 'zoomActiveHnTextBy(runtime, 0.9)'],
    ['hnTextZoomValueButton', 'resetActiveHnTextZoom(runtime)'],
    ['hnTextZoomInButton', 'zoomActiveHnTextBy(runtime, 1.1)']
  ];

  for (const [control, invocation] of controls) {
    const start = bootstrap.indexOf(`${control}?.addEventListener('click'`);
    assert.notEqual(start, -1, `${control} click owner must exist`);
    const end = bootstrap.indexOf('\n});', start);
    assert.ok(end > start, `${control} click owner must be bounded`);
    const handler = bootstrap.slice(start, end + 4);
    assert.equal(
      (handler.match(/activePaneRuntime\(\)/g) || []).length,
      1,
      `${control} must resolve the active runtime exactly once at invocation`
    );
    assert.match(handler, /const runtime = activePaneRuntime\(\);/);
    assert.ok(handler.includes(`if (runtime) ${invocation};`),
      `${control} must pass the resolved runtime to ${invocation}`);
  }
});

test('one living Pane renders its Canvas without consulting a disposed sibling runtime', async () => {
  const ownerPage = page('page-one-pane');
  const object = imageObject('object-one-pane');
  ownerPage.objects = [object];
  const harness = await createPaneRuntimeHarness({ leftPage: ownerPage });
  harness.disposeRuntime(harness.right.runtime);
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['renderCanvas']);

  api.renderCanvas(harness.left.runtime, ownerPage.objects, ownerPage.blocks, { fit: false });

  assert.deepEqual(harness.livingPaneRuntimes(), [harness.left.runtime]);
  assert.deepEqual(harness.left.runtime.canvasObjects, [object]);
  assert.equal(
    harness.left.runtime.dom.canvasStage.querySelectorAll('.canvas-object-layer').length,
    1
  );
});

test('three living Panes retain distinct runtime identity, DOM, and camera presentation', async () => {
  const harness = await createPaneRuntimeHarness();
  const third = harness.addPaneRuntime({
    paneId: 'pane-third',
    runtimeId: 'runtime-third-1',
    page: page('page-third'),
    dom: { left: 1300, top: 40, width: 500, height: 480 }
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['applyCanvasTransform']);
  const runtimes = [harness.left.runtime, harness.right.runtime, third.runtime];
  const views = [
    { scale: 1, offsetX: 11, offsetY: 12 },
    { scale: 1.5, offsetX: 21, offsetY: 22 },
    { scale: 2, offsetX: 31, offsetY: 32 }
  ];

  runtimes.forEach((runtime, index) => {
    runtime.canvasView = { ...views[index] };
    api.applyCanvasTransform(runtime);
  });

  assert.equal(new Set(runtimes.map((runtime) => runtime.runtimeId)).size, 3);
  assert.equal(new Set(runtimes.map((runtime) => runtime.dom.canvasStage)).size, 3);
  assert.deepEqual(runtimes.map((runtime) => runtime.dom.canvasStage.style.transform), [
    'translate(11px, 12px) scale(1)',
    'translate(21px, 22px) scale(1.5)',
    'translate(31px, 32px) scale(2)'
  ]);
});

test('activate A to B to A changes only the active reference and never copies Pane state', async () => {
  const harness = await createPaneRuntimeHarness();
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['quickColourState']);
  const leftQuickColour = api.quickColourState(harness.left.runtime);
  const rightQuickColour = api.quickColourState(harness.right.runtime);
  harness.left.runtime.canvasView = { scale: 1.2, offsetX: 17, offsetY: -3 };
  harness.right.runtime.canvasView = { scale: 2.4, offsetX: -9, offsetY: 41 };
  leftQuickColour.blockId = 'block-left';
  rightQuickColour.blockId = 'block-right';

  assert.equal(harness.activePaneRuntime(), harness.left.runtime);
  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  assert.equal(harness.activePaneRuntime(), harness.right.runtime);
  harness.setActiveWorkspacePane(harness.left.runtime.paneId);

  assert.equal(harness.activePaneRuntime(), harness.left.runtime);
  assert.deepEqual(harness.left.runtime.canvasView, { scale: 1.2, offsetX: 17, offsetY: -3 });
  assert.deepEqual(harness.right.runtime.canvasView, { scale: 2.4, offsetX: -9, offsetY: 41 });
  assert.equal(leftQuickColour.blockId, 'block-left');
  assert.equal(rightQuickColour.blockId, 'block-right');
});

test('same Page in two Panes shares identity but not camera, bounds, or transient selection', async () => {
  const sharedPage = page('page-same-two-panes');
  const harness = await createPaneRuntimeHarness({ leftPage: sharedPage, rightPage: sharedPage });
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['screenToWorld']);
  harness.left.runtime.canvasView = { scale: 1, offsetX: 10, offsetY: 20 };
  harness.right.runtime.canvasView = { scale: 2, offsetX: 30, offsetY: 40 };
  harness.left.runtime.canvasBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  harness.right.runtime.canvasBounds = { minX: 20, minY: 30, maxX: 220, maxY: 230 };
  harness.left.runtime.selectedBlockId = 'block-left';
  harness.right.runtime.selectedBlockId = 'block-right';

  assert.equal(harness.left.runtime.currentPage, harness.right.runtime.currentPage);
  assert.notDeepEqual(
    { ...api.screenToWorld(harness.left.runtime, 100, 120) },
    { ...api.screenToWorld(harness.right.runtime, 100, 120) }
  );
  assert.notDeepEqual(harness.left.runtime.canvasBounds, harness.right.runtime.canvasBounds);
  assert.equal(harness.left.runtime.selectedBlockId, 'block-left');
  assert.equal(harness.right.runtime.selectedBlockId, 'block-right');
});

test('different Page runtimes reject crossed Info ownership tokens', async () => {
  const harness = await createPaneRuntimeHarness({
    leftPage: page('page-token-left', { blockId: 'block-token-left' }),
    rightPage: page('page-token-right', { blockId: 'block-token-right' })
  });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'infoPanelIdentityForRuntime',
    'commitInfoPanelGeometryToViewState'
  ]);
  const entry = api.ensureInfoPanelEntry(harness.right.runtime, 'block', 'block-token-right');
  const leftToken = api.infoPanelIdentityForRuntime(
    harness.left.runtime, 'block', 'block-token-left'
  );

  assert.equal(api.commitInfoPanelGeometryToViewState(
    harness.right.runtime,
    leftToken,
    { left: 90, top: 80, width: 360, height: 240 }
  ), null);
  assert.deepEqual(
    { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
    { x: 16, y: 16, width: 320, height: 220 }
  );
});

test('race C: inactive Info rendering preserves active focus, selection, and composition state', async () => {
  const sharedPage = page('page-focus-race', { blockId: 'block-focus-race' });
  const harness = await createPaneRuntimeHarness({ leftPage: sharedPage, rightPage: sharedPage });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'ensureInfoPanelEntry',
    'renderInfoPanelsForRuntime'
  ]);
  const editor = harness.document.createElement('textarea');
  editor.value = 'active composing source';
  editor.setSelectionRange(4, 13, 'backward');
  editor.dataset.compositionActive = 'true';
  harness.left.runtime.dom.paneElement.append(editor);
  editor.focus();
  api.ensureInfoPanelEntry(harness.right.runtime, 'block', 'block-focus-race');

  api.renderInfoPanelsForRuntime(harness.right.runtime);
  harness.raf.flush();

  assert.equal(harness.document.activeElement, editor);
  assert.equal(editor.value, 'active composing source');
  assert.equal(editor.selectionStart, 4);
  assert.equal(editor.selectionEnd, 13);
  assert.equal(editor.selectionDirection, 'backward');
  assert.equal(editor.dataset.compositionActive, 'true');
});

test('Pane-local viewport resizing refits only the requested runtime camera', async () => {
  const harness = await createPaneRuntimeHarness();
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['fitCanvasToObjects']);
  const object = { ...imageObject('resize-object'), width: 300, height: 200 };
  const leftBefore = { ...harness.left.runtime.canvasView };
  harness.right.runtime.dom.canvasArea.clientWidth = 420;
  harness.right.runtime.dom.canvasArea.clientHeight = 280;

  api.fitCanvasToObjects(harness.right.runtime, [object]);

  assert.deepEqual(harness.left.runtime.canvasView, leftBefore);
  assert.notDeepEqual(harness.right.runtime.canvasView, leftBefore);
  assert.match(harness.right.runtime.dom.canvasStage.style.transform, /^translate\(/);
});

test('Page pan and zoom are applied only to the runtime passed to the Canvas owner', async () => {
  const harness = await createPaneRuntimeHarness();
  const { api } = await harness.loadLeaf('canvasBlocks.js', ['zoomAtPoint']);
  const leftBefore = { ...harness.left.runtime.canvasView };
  harness.right.runtime.canvasObjects = [imageObject('zoom-object')];
  harness.right.runtime.canvasBounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  harness.right.runtime.canvasView = { scale: 1, offsetX: 15, offsetY: 25 };

  api.zoomAtPoint(harness.right.runtime, 900, 260, 2);

  assert.equal(harness.right.runtime.canvasView.scale, 2);
  assert.deepEqual(harness.left.runtime.canvasView, leftBefore);
  assert.match(harness.right.runtime.dom.canvasStage.style.transform, /scale\(2\)$/);
});

test('Page Edit lifecycle mutates only its explicit Canvas runtime', async () => {
  const rightPage = page('page-edit-right');
  rightPage.objects = [imageObject('page-edit-a'), {
    ...imageObject('page-edit-b'), x: 430
  }];
  const harness = await createPaneRuntimeHarness({ rightPage });
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'enterPageEditMode',
    'cancelPageEdits'
  ]);

  api.enterPageEditMode(harness.right.runtime, { selectObjectId: 'page-edit-b' });
  assert.equal(harness.right.runtime.pageEditMode, true);
  assert.equal(harness.right.runtime.selectedPageObjectId, 'page-edit-b');
  assert.equal(harness.right.runtime.draftPageObjects.length, 2);
  assert.equal(harness.left.runtime.pageEditMode, false);
  assert.equal(harness.left.runtime.draftPageObjects.length, 0);

  api.cancelPageEdits(harness.right.runtime);
  assert.equal(harness.right.runtime.pageEditMode, false);
  assert.equal(harness.right.runtime.draftPageObjects.length, 0);
  assert.equal(harness.left.runtime.pageEditMode, false);
});

test('Highlight presentation consumes only the explicit runtime membership state', async () => {
  const harness = await createPaneRuntimeHarness();
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'currentBlockPresentationInteraction'
  ]);
  const block = { id: 'block-shared-highlight' };
  harness.left.runtime.blockVisualMode = 'highlight-view';
  harness.right.runtime.blockVisualMode = 'highlight-view';
  harness.left.runtime.activeHighlightBlockIds = new Set([block.id]);
  harness.right.runtime.activeHighlightBlockIds = new Set();

  const leftState = api.currentBlockPresentationInteraction(harness.left.runtime, block);
  const rightState = api.currentBlockPresentationInteraction(harness.right.runtime, block);

  assert.deepEqual(
    { presentationState: leftState.presentationState, interactive: leftState.interactive },
    { presentationState: 1, interactive: true }
  );
  assert.deepEqual(
    { presentationState: rightState.presentationState, interactive: rightState.interactive },
    { presentationState: 0, interactive: false }
  );
});

test('race D: a gesture captured by Pane A survives unrelated Pane B rendering', async () => {
  const leftPage = page('page-pointer-a', { blockId: 'block-pointer-a' });
  const rightPage = page('page-pointer-b', { blockId: 'block-pointer-b' });
  const harness = await createPaneRuntimeHarness({ leftPage, rightPage });
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'beginBlockTransform',
    'renderCanvas',
    'updateBlockTransform'
  ]);
  const runtimeA = harness.left.runtime;
  runtimeA.canvasObjects = [imageObject('pointer-object-a')];
  runtimeA.blockEditMode = true;
  runtimeA.draftBlocks = [{ ...leftPage.blocks[0] }];
  const start = harness.pointer(runtimeA, {
    pointerId: 77,
    clientX: 80,
    clientY: 90
  });
  api.beginBlockTransform(runtimeA, start, runtimeA.draftBlocks[0], 'move');
  const owner = runtimeA.blockTransform;

  api.renderCanvas(harness.right.runtime, [], [], { fit: false });
  assert.equal(runtimeA.blockTransform, owner);
  assert.equal(runtimeA.dom.canvasArea.hasPointerCapture(77), true);

  assert.equal(api.updateBlockTransform(runtimeA, harness.pointer(runtimeA, {
    pointerId: 77,
    clientX: 100,
    clientY: 115
  })), true);
  assert.equal(runtimeA.blockTransform.operation.runtime, runtimeA);
  assert.equal(harness.right.runtime.blockTransform, null);
});

test('closing active and inactive Panes invalidates their exact operations without harming survivors', async () => {
  const harness = await createPaneRuntimeHarness();
  const leftOperation = harness.captureRuntimeOperation(harness.left.runtime, {
    scope: 'close-left', pageId: harness.left.runtime.currentPage.id
  });
  const rightOperation = harness.captureRuntimeOperation(harness.right.runtime, {
    scope: 'close-right', pageId: harness.right.runtime.currentPage.id
  });

  assert.equal(harness.disposeRuntime(harness.right.runtime), true);
  assert.equal(harness.runtimeOperationIsCurrent(rightOperation), false);
  assert.equal(harness.runtimeOperationIsCurrent(leftOperation), true);
  assert.equal(harness.activePaneRuntime(), harness.left.runtime);

  assert.equal(harness.disposeRuntime(harness.left.runtime), true);
  assert.equal(harness.runtimeOperationIsCurrent(leftOperation), false);
  assert.equal(harness.activePaneRuntime(), null);
});

test('two concurrent Canvas completions remain bound to different Pane runtimes', async () => {
  const requests = [];
  const harness = await createPaneRuntimeHarness({
    globals: {
      cneDesktop: {
        requestDisplayProxy(detail) {
          const request = deferred();
          requests.push({ detail, ...request });
          return request.promise;
        }
      }
    }
  });
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'resetCanvasImageSession',
    'canvasImageState',
    'requestCanvasImageResolution'
  ]);
  const leftObject = imageObject('concurrent-left');
  const rightObject = imageObject('concurrent-right');
  harness.left.runtime.canvasObjects = [leftObject];
  harness.right.runtime.canvasObjects = [rightObject];
  api.resetCanvasImageSession(harness.left.runtime, harness.left.runtime.currentPage.id);
  api.resetCanvasImageSession(harness.right.runtime, harness.right.runtime.currentPage.id);

  const leftPending = api.requestCanvasImageResolution(harness.left.runtime, leftObject, 800);
  const rightPending = api.requestCanvasImageResolution(harness.right.runtime, rightObject, 900);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true, fingerprint: 'right-complete', generationPending: false });
  requests[0].resolve({ ok: true, fingerprint: 'left-complete', generationPending: false });
  await Promise.all([leftPending, rightPending]);

  assert.equal(api.canvasImageState(harness.left.runtime, leftObject).fingerprint, 'left-complete');
  assert.equal(api.canvasImageState(harness.right.runtime, rightObject).fingerprint, 'right-complete');
  assert.equal(harness.left.runtime.canvasImageVariantStates.has(rightObject.id), false);
  assert.equal(harness.right.runtime.canvasImageVariantStates.has(leftObject.id), false);
});

test('race B: same-Page Info save fanout preserves the active Markdown editor and both views', async () => {
  const sharedPage = page('page-info-canonical-race', { blockId: 'block-canonical-race' });
  const response = deferred();
  let harness;
  const commits = [];
  const leftView = { panX: 11, panY: 12, zoom: 1.1 };
  const rightView = { panX: 21, panY: 22, zoom: 1.9 };
  harness = await createPaneRuntimeHarness({
    leftPage: sharedPage,
    rightPage: sharedPage,
    leftViewState: leftView,
    rightViewState: rightView,
    globals: {
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      request: () => response.promise,
      commitCanonicalPage(saved, options = {}) {
        commits.push({ saved, options });
        harness.context.canonicalPages.set(saved.id, saved);
        for (const runtime of harness.livingPaneRuntimes()) {
          if (runtime.currentPage?.id === saved.id) runtime.currentPage = saved;
        }
        if (!options.preserveDocumentBody) {
          for (const runtime of harness.livingPaneRuntimes()) {
            runtime.dom.canvasStage.querySelector('.markdown-page-layer')?.replaceChildren();
          }
        }
        return saved;
      }
    }
  });
  const { api } = await harness.loadLeaf('infoPanels.js', [
    'infoPanelRuntimeToken',
    'saveInfoPanelEditor'
  ]);
  const runtime = harness.left.runtime;
  runtime.infoPanelEditorRevision = 1;
  runtime.infoPanelEditor = {
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    paneId: runtime.paneId,
    tabId: runtime.session.activeTab().id,
    pageId: sharedPage.id,
    kind: 'block',
    ownerId: 'block-canonical-race',
    originalText: 'Info for page-info-canonical-race',
    draftText: 'Canonical response text',
    revision: 1,
    runtimeToken: api.infoPanelRuntimeToken(runtime, {
      kind: 'block', ownerId: 'block-canonical-race', revision: 1, includeMount: true
    }),
    textarea: { value: 'Canonical response text', selectionStart: 2 }
  };
  const leftViewBefore = JSON.parse(JSON.stringify(runtime.session.activeTab().viewState));
  const rightViewBefore = JSON.parse(JSON.stringify(
    harness.right.runtime.session.activeTab().viewState
  ));
  const markdownLayer = harness.document.createElement('div');
  markdownLayer.className = 'markdown-page-layer';
  const markdownEditor = harness.document.createElement('textarea');
  markdownEditor.value = 'active same-Page Markdown draft';
  markdownEditor.setSelectionRange(7, 21, 'backward');
  markdownEditor.dataset.compositionActive = 'true';
  markdownLayer.append(markdownEditor);
  harness.right.runtime.dom.canvasStage.append(markdownLayer);

  const saving = api.saveInfoPanelEditor(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  harness.setActiveWorkspacePane(harness.right.runtime.paneId);
  markdownEditor.focus();
  response.resolve({
    ...sharedPage,
    blocks: [{ ...sharedPage.blocks[0], info: 'Canonical response text' }]
  });
  const result = await saving;

  assert.equal(result.ok, true);
  assert.equal(harness.left.runtime.currentPage.blocks[0].info, 'Canonical response text');
  assert.equal(harness.right.runtime.currentPage.blocks[0].info, 'Canonical response text');
  assert.deepEqual(runtime.session.activeTab().viewState, leftViewBefore);
  assert.deepEqual(harness.right.runtime.session.activeTab().viewState, rightViewBefore);
  assert.equal(harness.activePaneRuntime(), harness.right.runtime);
  assert.ok(commits.length >= 2, 'optimistic and authoritative commits both execute');
  for (const commit of commits) {
    assert.strictEqual(commit.options.originRuntime, runtime);
    assert.equal(commit.options.preserveDocumentBody, true);
  }
  assert.strictEqual(
    harness.right.runtime.dom.canvasStage.querySelector('.markdown-page-layer'),
    markdownLayer
  );
  assert.strictEqual(markdownLayer.querySelector('textarea'), markdownEditor);
  assert.strictEqual(harness.document.activeElement, markdownEditor);
  assert.equal(markdownEditor.value, 'active same-Page Markdown draft');
  assert.equal(markdownEditor.selectionStart, 7);
  assert.equal(markdownEditor.selectionEnd, 21);
  assert.equal(markdownEditor.selectionDirection, 'backward');
  assert.equal(markdownEditor.dataset.compositionActive, 'true');
});

async function createCanvasSaveRace(kind) {
  const sourcePage = page(`page-${kind}-save-a`, { blockId: `block-${kind}-a` });
  sourcePage.objects = kind === 'page'
    ? [imageObject(`${kind}-object-a`), { ...imageObject(`${kind}-object-b`), x: 420 }]
    : [];
  const otherPage = page(`page-${kind}-save-b`, { blockId: `block-${kind}-b` });
  const response = deferred();
  const commits = [];
  const statuses = [];
  let harness;
  const savedPage = {
    ...sourcePage,
    blocks: sourcePage.blocks.map((block) => ({ ...block, info: 'saved block state' })),
    objects: sourcePage.objects.map((object) => ({ ...object, x: object.x + 10 }))
  };
  harness = await createPaneRuntimeHarness({
    leftPage: sourcePage,
    rightPage: page(`page-${kind}-activation-target`),
    globals: {
      pageIndex: {
        pages: [
          { id: sourcePage.id, title: sourcePage.title || sourcePage.name },
          { id: otherPage.id, title: otherPage.title || otherPage.name }
        ]
      },
      pageApiUrl: (pageId) => `/api/pages/${pageId}`,
      request(url) {
        if (url === '/api/page-index') {
          return Promise.resolve({
            pages: [
              { id: sourcePage.id, title: sourcePage.title || sourcePage.name },
              { id: otherPage.id, title: otherPage.title || otherPage.name }
            ]
          });
        }
        return response.promise;
      },
      commitCanonicalPage(saved, options = {}) {
        commits.push({ saved, options });
        harness.context.canonicalPages.set(saved.id, saved);
        for (const runtime of harness.livingPaneRuntimes()) {
          if (runtime.session.activeTab()?.currentPageId === saved.id) {
            runtime.currentPage = saved;
          }
        }
        return saved;
      },
      renderPageList() {},
      showRuntimeStatus(runtime, message, ...detail) {
        statuses.push({ runtime, message, detail });
      }
    }
  });
  harness.context.canonicalPages.set(otherPage.id, otherPage);
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    kind === 'block' ? 'saveBlockEdits' : 'savePageEdits'
  ]);
  const runtime = harness.left.runtime;
  if (kind === 'block') {
    runtime.blockEditMode = true;
    runtime.originalBlocks = sourcePage.blocks.map((block) => ({ ...block }));
    runtime.draftBlocks = savedPage.blocks.map((block) => ({ ...block }));
  } else {
    runtime.pageEditMode = true;
    runtime.originalPageObjects = sourcePage.objects.map((object) => ({ ...object }));
    runtime.originalPageBlocks = sourcePage.blocks.map((block) => ({ ...block }));
    runtime.draftPageObjects = savedPage.objects.map((object) => ({ ...object }));
    runtime.draftPageBlocks = savedPage.blocks.map((block) => ({ ...block }));
  }
  return {
    harness,
    runtime,
    otherPage,
    savedPage,
    response,
    commits,
    statuses,
    save: api[kind === 'block' ? 'saveBlockEdits' : 'savePageEdits']
  };
}

for (const kind of ['block', 'page']) {
  test(`${kind === 'block' ? 'Block' : 'Page Edit'} save survives activation-only changes`, async () => {
    const scenario = await createCanvasSaveRace(kind);
    const pending = scenario.save(scenario.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    scenario.harness.setActiveWorkspacePane(scenario.harness.right.runtime.paneId);
    scenario.response.resolve(scenario.savedPage);
    await pending;

    assert.equal(scenario.commits.length, 1);
    assert.strictEqual(scenario.commits[0].options.originRuntime, scenario.runtime);
    assert.strictEqual(
      scenario.harness.context.canonicalPages.get(scenario.savedPage.id),
      scenario.savedPage
    );
    assert.strictEqual(scenario.runtime.currentPage, scenario.savedPage);
    assert.equal(scenario.harness.activePaneRuntime(), scenario.harness.right.runtime);
    if (kind === 'block') {
      assert.equal(scenario.runtime.blockEditMode, false);
      assert.equal(scenario.runtime.draftBlocks.length, 0);
      assert.equal(scenario.runtime.blockSaveInProgress, false);
    } else {
      assert.equal(scenario.runtime.pageEditMode, false);
      assert.equal(scenario.runtime.draftPageObjects.length, 0);
      assert.equal(scenario.runtime.draftPageBlocks.length, 0);
      assert.equal(scenario.runtime.pageEditSaveInProgress, false);
    }
    assert.equal(
      scenario.statuses.some(({ runtime, message }) => (
        runtime === scenario.runtime && message === 'Saved'
      )),
      true
    );
  });

  test(`${kind === 'block' ? 'Block' : 'Page Edit'} save commits canonical A but cannot mutate same-Pane B`, async () => {
    const scenario = await createCanvasSaveRace(kind);
    const pending = scenario.save(scenario.runtime);
    await new Promise((resolve) => setImmediate(resolve));

    const pageBTab = scenario.runtime.session.createTab(scenario.otherPage.id);
    scenario.runtime.currentPage = scenario.otherPage;
    scenario.runtime.currentPageEntry = { id: scenario.otherPage.id };
    scenario.runtime.pageLoadSequence += 1;
    scenario.runtime.loadGeneration = scenario.runtime.pageLoadSequence;
    scenario.runtime.mounted = {
      tabId: pageBTab.id,
      pageId: scenario.otherPage.id,
      kind: scenario.otherPage.type,
      generation: scenario.runtime.mounted.generation + 1
    };
    if (kind === 'block') {
      scenario.runtime.blockEditMode = false;
      scenario.runtime.draftBlocks = [{ id: 'page-b-block-draft' }];
    } else {
      scenario.runtime.pageEditMode = false;
      scenario.runtime.draftPageObjects = [{ id: 'page-b-object-draft' }];
      scenario.runtime.draftPageBlocks = [{ id: 'page-b-block-draft' }];
    }
    const pageBEntry = scenario.runtime.currentPageEntry;
    const pageBMount = scenario.runtime.mounted;
    const statusCountBeforeResponse = scenario.statuses.length;

    scenario.response.resolve(scenario.savedPage);
    await pending;

    assert.equal(scenario.commits.length, 1,
      'the authoritative response must still enter canonical Page ownership');
    assert.strictEqual(
      scenario.harness.context.canonicalPages.get(scenario.savedPage.id),
      scenario.savedPage
    );
    assert.strictEqual(scenario.runtime.currentPage, scenario.otherPage);
    assert.strictEqual(scenario.runtime.currentPageEntry, pageBEntry);
    assert.strictEqual(scenario.runtime.mounted, pageBMount);
    if (kind === 'block') {
      assert.equal(scenario.runtime.blockEditMode, false);
      assert.deepEqual(scenario.runtime.draftBlocks, [{ id: 'page-b-block-draft' }]);
      assert.equal(scenario.runtime.blockSaveInProgress, false,
        'the live Pane owner must not retain a stranded in-flight flag');
    } else {
      assert.equal(scenario.runtime.pageEditMode, false);
      assert.deepEqual(scenario.runtime.draftPageObjects, [{ id: 'page-b-object-draft' }]);
      assert.deepEqual(scenario.runtime.draftPageBlocks, [{ id: 'page-b-block-draft' }]);
      assert.equal(scenario.runtime.pageEditSaveInProgress, false,
        'the live Pane owner must not retain a stranded in-flight flag');
    }
    assert.equal(
      scenario.statuses.slice(statusCountBeforeResponse)
        .some(({ message }) => message === 'Saved'),
      false,
      'a stale display token cannot paint success into Page B'
    );
  });
}
