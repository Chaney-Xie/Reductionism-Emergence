'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const structuredTextFrameModel = require('../public/structuredTextFrame');
const {
  createPaneRuntimeHarness,
  deferred
} = require('./helpers/paneRuntimeHarness');

const ROOT = path.join(__dirname, '..');
const START_FRAME = Object.freeze({ centerWorldX: 0, preferredWidth: 760 });

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function frameTuple(value) {
  return [value?.centerWorldX, value?.preferredWidth];
}

function pageFor(kind, id = `page-${kind}`) {
  return {
    id,
    code: id,
    name: id,
    title: id,
    type: kind === 'markdown' ? 'markdown' : 'cne-text',
    markdownBody: kind === 'markdown' ? '# Frame race' : undefined,
    cneText: kind === 'cne' ? { schemaVersion: 3, source: 'Frame race' } : undefined,
    textFrame: { ...START_FRAME },
    objects: [],
    blocks: [],
    highlightGroups: []
  };
}

async function createSaveRace(kind) {
  const page = pageFor(kind);
  const otherPanePage = clone(page);
  const statuses = [];
  const requests = [];
  const canonicalCommits = [];
  const availabilityUpdates = [];
  const harness = await createPaneRuntimeHarness({
    leftPage: page,
    rightPage: otherPanePage,
    globals: {
      structuredTextFrameModel,
      hnTextModel: { normalizeHnTextMode: (value) => value || 'edit' }
    }
  });
  const { context, document } = harness;
  context.Element = document.createElement('div').constructor;
  context.getComputedStyle = () => ({ paddingBottom: '128px' });
  context.pageIndex = { pages: [{ id: page.id, title: page.title }] };
  context.pageIsMarkdown = (candidate) => candidate?.type === 'markdown';
  context.pageIsHnText = (candidate) => candidate?.type === 'cne-text';
  context.pageApiUrl = (pageId) => `/api/pages/${pageId}`;
  context.renderPageList = () => {};
  context.showRuntimeStatus = (runtime, message, ...detail) => {
    statuses.push({ runtime, message, detail });
  };
  context.updateEditAvailability = (runtime) => availabilityUpdates.push(runtime);
  context.commitCanonicalPage = (savedPage, options = {}) => {
    canonicalCommits.push({ savedPage, options });
    context.canonicalPages.set(savedPage.id, savedPage);
    for (const runtime of harness.livingPaneRuntimes()) {
      if (runtime.session.activeTab()?.currentPageId === savedPage.id) {
        runtime.currentPage = savedPage;
      }
    }
    return savedPage;
  };
  context.request = (url, options = {}) => {
    if (url === '/api/page-index') {
      return Promise.resolve({ pages: [{ id: page.id, title: page.title }] });
    }
    const pending = deferred();
    const call = {
      url,
      options,
      payload: JSON.parse(options.body),
      pending
    };
    requests.push(call);
    return pending.promise;
  };

  const shellSource = fs.readFileSync(
    path.join(ROOT, 'public/js/structuredTextPageShell.js'),
    'utf8'
  );
  vm.runInContext(shellSource, context, { filename: 'structuredTextPageShell.js' });
  const shell = context.structuredTextPageShell;
  let presentedFrame = { ...START_FRAME };
  const renderStructuredPage = (options) => {
    if (options?.page?.textFrame) presentedFrame = clone(options.page.textFrame);
    return options?.stage || null;
  };
  context.renderMarkdownPageLayer = renderStructuredPage;
  context.renderHnTextPageLayer = renderStructuredPage;
  context.getMarkdownDocumentBounds = () => null;
  context.getHnTextDocumentBounds = () => null;
  context.destroyMarkdownPageLayer = () => false;
  context.destroyHnTextPageLayer = () => false;

  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'beginCanvasUndoContext',
    'updateDraftStructuredTextFrame',
    'savePageEdits'
  ]);
  const runtime = harness.left.runtime;
  runtime.pageEditMode = true;
  runtime.originalPageObjects = [];
  runtime.originalPageBlocks = [];
  runtime.originalPageTextFrame = { ...START_FRAME };
  runtime.draftPageObjects = [];
  runtime.draftPageBlocks = [];
  runtime.draftPageTextFrame = { ...START_FRAME };
  api.beginCanvasUndoContext(runtime, 'page-edit');

  const commits = [];
  const inputs = [];
  const boundary = shell.createFrameBoundary({
    frameEditor: {
      enabled: () => harness.runtimeIsLive(runtime)
        && runtime.pageEditMode
        && !runtime.pageEditSaveInProgress
        && runtime.currentPage?.id === page.id,
      getFrame: () => presentedFrame,
      getZoom: () => 1,
      setFrame: (nextFrame) => { presentedFrame = clone(nextFrame); },
      onInput: (nextFrame, detail) => {
        const accepted = api.updateDraftStructuredTextFrame(
          runtime, page.id, nextFrame, detail, { commit: false }
        );
        inputs.push({ frame: clone(nextFrame), detail: clone(detail), accepted });
        return accepted;
      },
      onCommit: (nextFrame, detail) => {
        const accepted = api.updateDraftStructuredTextFrame(
          runtime, page.id, nextFrame, detail, { commit: true }
        );
        commits.push({ frame: clone(nextFrame), detail: clone(detail), accepted });
        return accepted;
      },
      detail: () => ({
        pageId: page.id,
        paneId: runtime.paneId,
        tabId: runtime.session.activeTab()?.id || null
      })
    }
  });
  runtime.dom.canvasArea.append(boundary);

  return {
    kind,
    page,
    harness,
    context,
    shell,
    api,
    runtime,
    boundary,
    inputs,
    commits,
    requests,
    statuses,
    canonicalCommits,
    availabilityUpdates,
    presentedFrame: () => clone(presentedFrame)
  };
}

async function beginChangedRightDrag(scenario, pointerId = 41) {
  const right = scenario.boundary.children[1];
  await right.dispatch('pointerdown', {
    button: 0,
    pointerId,
    clientX: 380
  });
  await right.dispatch('pointermove', {
    pointerId,
    clientX: 620
  });
  assert.deepEqual(frameTuple(scenario.presentedFrame()), [120, 1000]);
  assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
  return right;
}

function savedPageFor(scenario, request = scenario.requests.at(-1)) {
  return {
    ...clone(scenario.page),
    textFrame: clone(request.payload.textFrame)
  };
}

for (const kind of ['markdown', 'cne']) {
  test(`${kind} Save settles an active keyboard-time drag before payload capture`, async () => {
    const scenario = await createSaveRace(kind);
    const right = await beginChangedRightDrag(scenario);
    const cameraBefore = clone(scenario.runtime.canvasView);
    const siblingCameraBefore = clone(scenario.harness.right.runtime.canvasView);

    const pendingSave = scenario.api.savePageEdits(scenario.runtime);
    assert.equal(scenario.runtime.pageEditSaveInProgress, true);
    assert.equal(scenario.requests.length, 1);
    assert.deepEqual(frameTuple(scenario.requests[0].payload.textFrame), [120, 1000]);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
    assert.deepEqual(frameTuple(scenario.presentedFrame()), [120, 1000]);
    assert.deepEqual(frameTuple(
      scenario.harness.right.runtime.currentPage.textFrame
    ), frameTuple(START_FRAME), 'the sibling Pane stays canonical while Save is pending');
    assert.equal(scenario.commits.length, 1);
    assert.equal(scenario.commits[0].detail.settlement, 'page-edit-save');
    assert.equal(scenario.commits[0].accepted, true);
    assert.equal(scenario.context.undoManager.undoStack.length, 1);

    await right.dispatch('pointermove', { pointerId: 41, clientX: 900 });
    await right.dispatch('pointerup', { pointerId: 41, clientX: 900 });
    await right.dispatch('pointercancel', { pointerId: 41, clientX: 900 });
    await right.dispatch('lostpointercapture', { pointerId: 41 });
    assert.equal(scenario.commits.length, 1);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);

    const left = scenario.boundary.children[0];
    await left.dispatch('pointerdown', { button: 0, pointerId: 42, clientX: -380 });
    await left.dispatch('pointermove', { pointerId: 42, clientX: -600 });
    await left.dispatch('pointerup', { pointerId: 42, clientX: -600 });
    assert.equal(left.hasPointerCapture(42), false);
    assert.equal(scenario.commits.length, 1);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
    assert.deepEqual(scenario.runtime.canvasView, cameraBefore);

    const canonical = savedPageFor(scenario, scenario.requests[0]);
    scenario.requests[0].pending.resolve(canonical);
    await pendingSave;
    assert.equal(scenario.canonicalCommits.length, 1);
    assert.deepEqual(frameTuple(
      scenario.context.canonicalPages.get(scenario.page.id).textFrame
    ), [120, 1000]);
    assert.deepEqual(frameTuple(
      scenario.harness.right.runtime.currentPage.textFrame
    ), [120, 1000], 'canonical Page fanout reaches the sibling Pane');
    assert.equal(scenario.runtime.pageEditMode, false);
    assert.equal(scenario.runtime.pageEditSaveInProgress, false);
    assert.deepEqual(scenario.runtime.canvasView, cameraBefore);
    assert.deepEqual(scenario.harness.right.runtime.canvasView, siblingCameraBefore,
      'same-Page canonical fanout never copies the owning Pane camera');
  });

  test(`${kind} failed Save retains one settled draft with Undo, Redo, and retry`, async () => {
    const scenario = await createSaveRace(kind);
    const right = await beginChangedRightDrag(scenario, 51);
    const pendingFailure = scenario.api.savePageEdits(scenario.runtime);
    assert.equal(scenario.requests.length, 1);
    const firstPayload = clone(scenario.requests[0].payload.textFrame);
    scenario.requests[0].pending.reject(new Error('Injected frame save failure'));
    await pendingFailure;

    assert.equal(scenario.runtime.pageEditMode, true);
    assert.equal(scenario.runtime.pageEditSaveInProgress, false);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
    assert.deepEqual(frameTuple(scenario.presentedFrame()), [120, 1000]);
    assert.deepEqual(frameTuple(
      scenario.context.canonicalPages.get(scenario.page.id).textFrame
    ), frameTuple(START_FRAME));
    assert.equal(scenario.context.undoManager.undoStack.length, 1);
    assert.equal(scenario.commits.length, 1);
    assert.equal(scenario.statuses.some(({ message }) => (
      message === 'Injected frame save failure'
    )), true);

    const freshHandle = scenario.boundary.children[1];
    await freshHandle.dispatch('pointerdown', {
      button: 0,
      pointerId: 52,
      clientX: 620
    });
    assert.equal(freshHandle.hasPointerCapture(52), true,
      'failure releases the Save fence for a fresh boundary gesture');
    await freshHandle.dispatch('pointermove', { pointerId: 52, clientX: 650 });
    await freshHandle.dispatch('pointercancel', { pointerId: 52, clientX: 650 });
    assert.equal(freshHandle.hasPointerCapture(52), false);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
    assert.deepEqual(frameTuple(scenario.presentedFrame()), [120, 1000]);
    assert.equal(scenario.commits.length, 1,
      'the cancelled post-failure probe creates no second gesture commit');

    assert.equal(scenario.context.undoManager.undo(), true);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), frameTuple(START_FRAME));
    assert.deepEqual(frameTuple(scenario.presentedFrame()), frameTuple(START_FRAME));
    assert.equal(scenario.context.undoManager.redo(), true);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
    assert.deepEqual(frameTuple(scenario.presentedFrame()), [120, 1000]);
    assert.equal(scenario.context.undoManager.undoStack.length, 1);

    await right.dispatch('pointerup', { pointerId: 51, clientX: 620 });
    assert.equal(scenario.commits.length, 1,
      'the failed request cannot revive the retired gesture');

    const retry = scenario.api.savePageEdits(scenario.runtime);
    assert.equal(scenario.requests.length, 2);
    assert.deepEqual(scenario.requests[1].payload.textFrame, firstPayload);
    scenario.requests[1].pending.resolve(savedPageFor(scenario, scenario.requests[1]));
    await retry;
    assert.deepEqual(frameTuple(
      scenario.context.canonicalPages.get(scenario.page.id).textFrame
    ), [120, 1000]);
    assert.equal(scenario.runtime.pageEditMode, false);
  });

  test(`${kind} Save without an active drag fences new gestures and disposal stays stale-safe`, async () => {
    const scenario = await createSaveRace(kind);
    const pendingSave = scenario.api.savePageEdits(scenario.runtime);
    assert.equal(scenario.requests.length, 1);
    assert.deepEqual(frameTuple(scenario.requests[0].payload.textFrame), frameTuple(START_FRAME));

    const right = scenario.boundary.children[1];
    await right.dispatch('pointerdown', { button: 0, pointerId: 61, clientX: 380 });
    await right.dispatch('pointermove', { pointerId: 61, clientX: 700 });
    await right.dispatch('pointerup', { pointerId: 61, clientX: 700 });
    assert.equal(right.hasPointerCapture(61), false);
    assert.equal(scenario.inputs.length, 0);
    assert.equal(scenario.commits.length, 0);
    assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), frameTuple(START_FRAME));

    const availabilityBeforeDispose = scenario.availabilityUpdates.length;
    scenario.harness.disposeRuntime(scenario.runtime);
    scenario.requests[0].pending.resolve(savedPageFor(scenario, scenario.requests[0]));
    await pendingSave;
    assert.equal(scenario.availabilityUpdates.length, availabilityBeforeDispose,
      'a disposed runtime receives no Save-fence unlock callback');
    assert.equal(scenario.statuses.some(({ message }) => message === 'Saved'), false);
    await right.dispatch('pointerup', { pointerId: 61, clientX: 700 });
    assert.equal(scenario.commits.length, 0);
  });
}

test('an unchanged active frame gesture settles without an Undo record', async () => {
  const scenario = await createSaveRace('markdown');
  const right = scenario.boundary.children[1];
  await right.dispatch('pointerdown', { button: 0, pointerId: 66, clientX: 380 });

  const pendingSave = scenario.api.savePageEdits(scenario.runtime);
  assert.equal(scenario.requests.length, 1);
  assert.equal(scenario.commits.length, 0);
  assert.equal(scenario.context.undoManager.undoStack.length, 0);
  assert.deepEqual(frameTuple(scenario.requests[0].payload.textFrame), frameTuple(START_FRAME));
  await right.dispatch('pointerup', { pointerId: 66, clientX: 380 });
  assert.equal(scenario.commits.length, 0);

  scenario.requests[0].pending.resolve(savedPageFor(scenario, scenario.requests[0]));
  await pendingSave;
  assert.equal(scenario.context.undoManager.undoStack.length, 0);
});

test('a sub-threshold accepted drag is restored exactly before Save snapshots the draft', async () => {
  const scenario = await createSaveRace('markdown');
  const right = scenario.boundary.children[1];
  await right.dispatch('pointerdown', { button: 0, pointerId: 67, clientX: 380 });
  await right.dispatch('pointermove', { pointerId: 67, clientX: 380.005 });
  assert.notDeepEqual(frameTuple(scenario.runtime.draftPageTextFrame), frameTuple(START_FRAME));

  const pendingSave = scenario.api.savePageEdits(scenario.runtime);
  assert.equal(scenario.requests.length, 1);
  assert.deepEqual(frameTuple(scenario.presentedFrame()), frameTuple(START_FRAME));
  assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), frameTuple(START_FRAME));
  assert.deepEqual(frameTuple(scenario.requests[0].payload.textFrame), frameTuple(START_FRAME));
  assert.equal(scenario.commits.length, 0);
  assert.equal(scenario.context.undoManager.undoStack.length, 0);
  assert.equal(scenario.inputs.at(-1).detail.settlement, 'page-edit-save');
  assert.equal(scenario.inputs.at(-1).accepted, true);

  await right.dispatch('pointerup', { pointerId: 67, clientX: 380.005 });
  assert.equal(scenario.commits.length, 0);
  scenario.requests[0].pending.resolve(savedPageFor(scenario, scenario.requests[0]));
  await pendingSave;
});

test('a synchronous settlement rejection starts no HTTP write and releases the Save fence', async () => {
  const scenario = await createSaveRace('markdown');
  const right = await beginChangedRightDrag(scenario, 71);
  const realShell = scenario.context.structuredTextPageShell;
  scenario.context.structuredTextPageShell = Object.freeze({
    settleActiveBoundaryDragForSave(target) {
      const retired = realShell.settleActiveBoundaryDragForSave(target);
      return { ...retired, accepted: false };
    }
  });

  await scenario.api.savePageEdits(scenario.runtime);
  assert.equal(scenario.requests.length, 0);
  assert.equal(scenario.runtime.pageEditSaveInProgress, false);
  assert.equal(scenario.runtime.pageEditMode, true);
  assert.deepEqual(frameTuple(scenario.runtime.draftPageTextFrame), [120, 1000]);
  assert.equal(scenario.commits.length, 1);
  assert.equal(scenario.context.undoManager.undoStack.length, 1);
  await right.dispatch('pointerup', { pointerId: 71, clientX: 900 });
  await right.dispatch('lostpointercapture', { pointerId: 71 });
  assert.equal(scenario.commits.length, 1,
    'synchronous Save rejection cannot revive the retired boundary gesture');
  assert.equal(scenario.statuses.some(({ message }) => (
    message === 'The structured text frame gesture could not be settled for Save.'
  )), true);
});
