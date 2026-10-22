const test = require('node:test');
const assert = require('node:assert/strict');

const hnTextModel = require('../public/hnText');
const {
  SELECTION_AFFINITIES,
  createPaneLocalState,
  createHnPageDocumentSession,
  createHnPageDocumentSessionRegistry
} = require('../public/js/hnPageDocumentSession');

function envelope(source = '', revision = 0) {
  return {
    schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
    revision,
    source,
    anchors: {}
  };
}

function legacyEnvelope(text = '', revision = 0) {
  return {
    schemaVersion: 1,
    revision,
    document: {
      type: 'doc',
      content: text ? [{
        type: 'paragraph',
        attrs: { id: 'legacy-paragraph' },
        content: [{ type: 'text', text }]
      }] : []
    }
  };
}

function createSaveRecorder({ initialRevision = 0 } = {}) {
  let revision = initialRevision;
  const calls = [];
  return {
    calls,
    save: async (payload) => {
      calls.push(structuredClone(payload));
      revision += 1;
      return { cneText: { ...payload.cneText, revision } };
    }
  };
}

function subscribeFakeView(session, viewId, paneState = createPaneLocalState(), options = {}) {
  const updates = [];
  let disposed = 0;
  const unsubscribe = session.subscribe(viewId, {
    paneState,
    ...(options.referenceId ? { referenceId: options.referenceId } : {}),
    updateState(snapshot, metadata) {
      updates.push({ snapshot, metadata });
    },
    onDispose() { disposed += 1; }
  });
  return { updates, paneState, unsubscribe, disposed: () => disposed };
}

test('supported legacy content migrates in memory and the first source edit persists schema 3', async () => {
  const recorder = createSaveRecorder({ initialRevision: 7 });
  const legacy = legacyEnvelope('Legacy', 7);
  const session = createHnPageDocumentSession({
    pageId: 'page_legacy',
    cneText: legacy,
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const view = subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');

  assert.deepEqual(session.currentEnvelope(), {
    schemaVersion: 3,
    revision: 7,
    source: 'Legacy',
    anchors: {}
  });
  assert.equal(session.currentSnapshot().legacyMigrated, true);
  assert.equal(session.currentSnapshot().legacySchemaVersion, 1);
  assert.equal(view.updates[0].metadata.reason, 'subscribe');
  assert.equal(recorder.calls.length, 0, 'mount-time migration must not write');
  assert.deepEqual(legacy, legacyEnvelope('Legacy', 7), 'load/migration is pure');

  session.applySourceTransaction('pane-a', { from: 6, to: 6, insert: '!' }, {
    sourceVersion: 0,
    inputType: 'insertText'
  });
  await session.flush();
  assert.equal(recorder.calls.length, 1);
  assert.deepEqual(recorder.calls[0], {
    pageId: 'page_legacy',
    baseRevision: 7,
    cneText: {
      schemaVersion: 3,
      revision: 7,
      source: 'Legacy!',
      anchors: {}
    }
  });
  assert.equal(session.revision, 8);
  assert.equal(session.currentSnapshot().legacyMigrated, false);
  await session.dispose({ flush: false });
});

test('unsupported legacy content mounts once as read-only diagnostic and is never saved', async () => {
  const recorder = createSaveRecorder({ initialRevision: 2 });
  const legacy = {
    schemaVersion: 2,
    revision: 2,
    document: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { id: 'legacy-link' },
        content: [{ type: 'text', text: 'unsafe', marks: [{ type: 'link' }] }]
      }]
    }
  };
  const session = createHnPageDocumentSession({
    pageId: 'page_unsupported',
    cneText: legacy,
    save: recorder.save
  });
  const view = subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');

  const snapshot = session.currentSnapshot();
  assert.equal(snapshot.source, null);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.migrationFailure.errors[0].code, 'mark-type');
  assert.deepEqual(snapshot.migrationFailure.legacyEnvelope, legacy);
  assert.deepEqual(session.currentEnvelope(), legacy);
  assert.equal(view.updates[0].snapshot.migrationFailure.error,
    snapshot.migrationFailure.error);
  assert.throws(() => session.applySourceTransaction(
    'pane-a',
    { from: 0, to: 0, insert: 'blocked' },
    { sourceVersion: 0 }
  ), (error) => error.code === 'HN_SESSION_UNSUPPORTED_LEGACY');
  assert.equal(session.undo('pane-a'), false);
  assert.deepEqual(await session.flush(), legacy);
  assert.equal(recorder.calls.length, 0);
  await session.dispose({ flush: false });
});

test('one Page source publishes to every Pane while selections remain Pane-local', async () => {
  const recorder = createSaveRecorder();
  const session = createHnPageDocumentSession({
    pageId: 'page_shared',
    cneText: envelope('abcd'),
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const aState = createPaneLocalState({ selection: { anchor: 2, focus: 2 } });
  const bState = createPaneLocalState({ selection: {
    anchor: 4,
    focus: 4,
    anchorAffinity: SELECTION_AFFINITIES.AFTER,
    focusAffinity: SELECTION_AFFINITIES.AFTER
  } });
  const cState = createPaneLocalState({ selection: {
    anchor: 2,
    focus: 2,
    anchorAffinity: SELECTION_AFFINITIES.BEFORE,
    focusAffinity: SELECTION_AFFINITIES.BEFORE
  } });
  const a = subscribeFakeView(session, 'pane-a', aState);
  const b = subscribeFakeView(session, 'pane-b', bState);
  const c = subscribeFakeView(session, 'pane-c', cState);
  assert.equal(aState.selection.anchor, 2,
    'nonzero living-Tab selection survives construction before source is available');
  assert.equal(bState.selection.anchor, 4);

  session.setFocusedView('pane-a');
  const result = session.applySourceTransaction('pane-a', {
    from: 2,
    to: 2,
    insert: 'X'
  }, { sourceVersion: 0, inputType: 'insertText' });
  assert.equal(result.source, 'abXcd');
  assert.equal(session.currentSnapshot().source, 'abXcd');
  assert.equal(a.paneState.selection.anchor, 3);
  assert.equal(b.paneState.selection.anchor, 5);
  assert.equal(c.paneState.selection.anchor, 2,
    'before affinity remains on the near side of a remote insertion boundary');
  assert.equal(a.updates.at(-1).snapshot, b.updates.at(-1).snapshot);
  assert.equal(b.updates.at(-1).snapshot, c.updates.at(-1).snapshot);
  assert.equal(a.updates.at(-1).metadata.originViewId, 'pane-a');
  assert.deepEqual(a.updates.at(-1).metadata.transaction, { from: 2, to: 2, insert: 'X' });
  assert.equal(session.captureSelection('pane-b', { anchor: 1, focus: 1 }), false,
    'an inactive Pane cannot overwrite its mapped bookmark');

  assert.deepEqual(session.setFocusedView('pane-b'), {
    anchor: 5,
    focus: 5,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  assert.equal(session.clearFocusedView('pane-a'), false);
  const updatesBeforeBlur = a.updates.length;
  assert.equal(session.clearFocusedView('pane-b'), true);
  assert.equal(session.focusedViewId, null);
  assert.equal(b.paneState.focused, false);
  assert.equal(a.updates.length, updatesBeforeBlur + 1);
  assert.equal(a.updates.at(-1).metadata.reason, 'blur');
  assert.equal(session.clearFocusedView('pane-b'), false);
  assert.equal(session.selectionForView('pane-b').anchor, 5,
    'blur preserves Pane-local source selection');
  assert.throws(() => session.applySourceTransaction(
    'pane-b', { from: 5, to: 5, insert: '!' }, { sourceVersion: 1 }
  ), /inactive view/);
  await session.dispose({ flush: false });
});

test('source edits require an active view, exact core fields and current source version', async () => {
  const recorder = createSaveRecorder();
  const session = createHnPageDocumentSession({
    pageId: 'page_transactions',
    cneText: envelope('ab\ncd'),
    save: recorder.save,
    saveDelayMs: 60_000
  });
  subscribeFakeView(session, 'pane-a');
  subscribeFakeView(session, 'pane-b');
  session.setFocusedView('pane-a');

  assert.throws(() => session.applySourceTransaction(
    'pane-b', { from: 0, to: 0, insert: 'x' }, { sourceVersion: 0 }
  ), /inactive view/);
  assert.throws(() => session.applySourceTransaction(
    'pane-a', { from: 0, to: 0, insert: 'x', html: '<b>x</b>' }, { sourceVersion: 0 }
  ), /unsupported fields/);
  assert.throws(() => session.applySourceTransaction(
    'pane-a', { from: -1, to: 0, insert: 'x' }, { sourceVersion: 0 }
  ), /outside the canonical source/);
  assert.throws(() => session.applySourceTransaction(
    'pane-a', { from: 0, to: 0, insert: 'x' }, { sourceVersion: 9 }
  ), (error) => error.code === 'HN_SESSION_STALE_SOURCE'
    && error.expectedSourceVersion === 0
    && error.receivedSourceVersion === 9);

  session.applySourceTransaction('pane-a', { from: 1, to: 4, insert: '你\n🙂' }, {
    sourceVersion: 0,
    selection: { anchor: 5, focus: 1 },
    inputType: 'insertFromPaste'
  });
  assert.equal(session.currentEnvelope().source, 'a你\n🙂d');
  assert.deepEqual(session.selectionForView('pane-a'), {
    anchor: 5,
    focus: 1,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  }, 'backward numeric selection direction is preserved');
  assert.equal(session.currentSnapshot().sourceVersion, 1);
  await session.dispose({ flush: false });
});

test('Undo and Redo form one Page-wide source history across Pane origins', async () => {
  const recorder = createSaveRecorder();
  const session = createHnPageDocumentSession({
    pageId: 'page_history',
    cneText: envelope(),
    save: recorder.save,
    saveDelayMs: 60_000
  });
  subscribeFakeView(session, 'pane-a');
  subscribeFakeView(session, 'pane-b');

  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'A' }, {
    sourceVersion: 0
  });
  session.setFocusedView('pane-b');
  session.applySourceTransaction('pane-b', { from: 1, to: 1, insert: 'B' }, {
    sourceVersion: 1
  });
  assert.equal(session.source, 'AB');
  assert.deepEqual(session.historyDepth, { undo: 2, redo: 0 });

  assert.equal(session.undo('pane-b'), true);
  assert.equal(session.source, 'A');
  session.setFocusedView('pane-a');
  assert.equal(session.undo('pane-a'), true);
  assert.equal(session.source, '');
  assert.deepEqual(session.historyDepth, { undo: 0, redo: 2 });
  assert.equal(session.redo('pane-a'), true);
  assert.equal(session.source, 'A');
  session.setFocusedView('pane-b');
  assert.equal(session.redo('pane-b'), true);
  assert.equal(session.source, 'AB');
  assert.deepEqual(session.historyDepth, { undo: 2, redo: 0 });
  await session.dispose({ flush: false });
});

test('one IME composition ID coalesces provisional source updates into one Undo step', async () => {
  const recorder = createSaveRecorder();
  const session = createHnPageDocumentSession({
    pageId: 'page_ime',
    cneText: envelope(),
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const view = subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');
  const composition = { inputType: 'insertCompositionText', compositionId: 'ime-1' };

  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'n' }, {
    ...composition,
    sourceVersion: 0
  });
  session.applySourceTransaction('pane-a', { from: 0, to: 1, insert: 'ni' }, {
    ...composition,
    sourceVersion: 1
  });
  session.applySourceTransaction('pane-a', { from: 0, to: 2, insert: '你' }, {
    ...composition,
    sourceVersion: 2
  });
  assert.equal(session.source, '你');
  assert.deepEqual(session.historyDepth, { undo: 1, redo: 0 });
  assert.equal(view.updates.at(-1).metadata.compositionId, 'ime-1');
  assert.equal(view.updates.at(-1).metadata.inputType, 'insertCompositionText');

  assert.equal(session.undo('pane-a'), true);
  assert.equal(session.source, '');
  assert.equal(session.redo('pane-a'), true);
  assert.equal(session.source, '你');
  session.applySourceTransaction('pane-a', { from: 1, to: 1, insert: '好' }, {
    sourceVersion: 5,
    inputType: 'insertText'
  });
  assert.equal(session.source, '你好');
  assert.deepEqual(session.historyDepth, { undo: 2, redo: 0 });
  await session.dispose({ flush: false });
});

test('save queue coalesces pending edits into exact source payload and one revision step', async () => {
  const recorder = createSaveRecorder({ initialRevision: 7 });
  const changes = [];
  const persisted = [];
  const session = createHnPageDocumentSession({
    pageId: 'page_save',
    cneText: envelope('start', 7),
    save: recorder.save,
    saveDelayMs: 60_000,
    onSourceChange: (change) => changes.push(change),
    onPersisted: (result) => persisted.push(result)
  });
  subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'A' }, {
    sourceVersion: 0
  });
  session.applySourceTransaction('pane-a', { from: 1, to: 1, insert: 'B\n' }, {
    sourceVersion: 1,
    inputType: 'insertFromPaste'
  });
  const saved = await session.flush();

  assert.equal(recorder.calls.length, 1);
  assert.deepEqual(recorder.calls[0], {
    pageId: 'page_save',
    baseRevision: 7,
    cneText: {
      schemaVersion: 3,
      revision: 7,
      source: 'AB\nstart',
      anchors: {}
    }
  });
  assert.deepEqual(saved, {
    schemaVersion: 3,
    revision: 8,
    source: 'AB\nstart',
    anchors: {}
  });
  assert.equal(session.saveStatus.dirty, false);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].source, 'AB\nstart');
  assert.equal(persisted.length, 1);
  assert.equal(JSON.stringify(saved).includes('selection'), false);
  assert.equal(JSON.stringify(saved).includes('history'), false);
  assert.equal(JSON.stringify(saved).includes('document'), false);
  await session.dispose({ flush: false });
});

test('edits arriving during a save serialize behind its acknowledgement', async () => {
  const pending = [];
  const calls = [];
  const session = createHnPageDocumentSession({
    pageId: 'page_serial',
    cneText: envelope(),
    saveDelayMs: 60_000,
    save(payload) {
      calls.push(structuredClone(payload));
      return new Promise((resolve) => pending.push(resolve));
    }
  });
  subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'A' }, {
    sourceVersion: 0
  });
  const flushing = session.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseRevision, 0);
  assert.equal(calls[0].cneText.source, 'A');

  session.applySourceTransaction('pane-a', { from: 1, to: 1, insert: 'B' }, {
    sourceVersion: 1
  });
  pending.shift()({ revision: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseRevision, 1);
  assert.equal(calls[1].cneText.source, 'AB');
  pending.shift()({ revision: 2 });
  await flushing;
  assert.equal(session.revision, 2);
  assert.equal(session.saveStatus.dirty, false);
  await session.dispose({ flush: false });
});

test('stale revision freezes source edits but retains local source and selection ownership', async () => {
  let attempts = 0;
  const stale = Object.assign(new Error('stale revision'), {
    status: 409,
    code: 'STALE_CNE_REVISION'
  });
  const session = createHnPageDocumentSession({
    pageId: 'page_stale',
    cneText: envelope(),
    saveDelayMs: 60_000,
    save: async () => {
      attempts += 1;
      throw stale;
    }
  });
  subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'local' }, {
    sourceVersion: 0
  });
  await assert.rejects(session.flush(), /stale revision/);

  assert.equal(session.source, 'local');
  assert.equal(session.revision, 0);
  assert.equal(session.saveStatus.dirty, true);
  assert.equal(session.saveStatus.conflicted, true);
  assert.equal(session.saveStatus.readOnly, true);
  assert.deepEqual(session.saveStatus.conflict, {
    code: 'STALE_CNE_REVISION',
    status: 409,
    message: 'stale revision'
  });
  assert.throws(() => session.applySourceTransaction(
    'pane-a', { from: 5, to: 5, insert: 'blocked' }, { sourceVersion: 1 }
  ), (error) => error.code === 'HN_SESSION_CONFLICTED');
  assert.equal(session.captureSelection('pane-a', { anchor: 2, focus: 4 }), true);
  assert.deepEqual(session.selectionForView('pane-a'), {
    anchor: 2,
    focus: 4,
    anchorAffinity: 'after',
    focusAffinity: 'after'
  });
  await assert.rejects(session.flush(), /stale revision/);
  assert.equal(attempts, 1);
  await session.dispose({ flush: false });
});

test('conversion lock is shared read-only state while flush and disposal remain available', async () => {
  const recorder = createSaveRecorder();
  const session = createHnPageDocumentSession({
    pageId: 'page_conversion',
    cneText: envelope(),
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const a = subscribeFakeView(session, 'pane-a');
  const b = subscribeFakeView(session, 'pane-b');
  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'pending' }, {
    sourceVersion: 0
  });

  assert.equal(session.setConversionLocked(true), true);
  assert.equal(session.saveStatus.readOnly, true);
  assert.equal(a.updates.at(-1).metadata.reason, 'conversion-lock');
  assert.equal(b.updates.at(-1).metadata.reason, 'conversion-lock');
  assert.throws(() => session.applySourceTransaction(
    'pane-a', { from: 7, to: 7, insert: 'blocked' }, { sourceVersion: 1 }
  ), (error) => error.code === 'HN_SESSION_CONVERSION_LOCKED');
  await session.flush();
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].cneText.source, 'pending');

  assert.equal(session.setConversionLocked(false), true);
  assert.equal(session.saveStatus.readOnly, false);
  session.applySourceTransaction('pane-a', { from: 7, to: 7, insert: '!' }, {
    sourceVersion: 1
  });
  assert.equal(session.source, 'pending!');
  await session.dispose({ flush: false });
});

test('registry retains one Page session, preserves live history and disposes after final reference', async () => {
  const recorder = createSaveRecorder();
  const registry = createHnPageDocumentSessionRegistry({
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const pageId = 'page_registry';
  const first = registry.acquire(pageId, envelope(), { referenceId: 'pane-a:tab-a' });
  const same = registry.acquire(pageId, envelope('ignored'), { referenceId: 'pane-b:tab-b' });
  assert.equal(same, first);
  assert.equal(first.referenceCount, 2);
  const viewIdA = `pane-a:tab-a:${pageId}`;
  const viewIdB = `pane-b:tab-b:${pageId}`;
  const a = subscribeFakeView(first, viewIdA, createPaneLocalState(), {
    referenceId: 'pane-a:tab-a'
  });
  const b = subscribeFakeView(first, viewIdB, createPaneLocalState(), {
    referenceId: 'pane-b:tab-b'
  });
  first.setFocusedView(viewIdA);
  first.applySourceTransaction(viewIdA, { from: 0, to: 0, insert: 'shared' }, {
    sourceVersion: 0
  });
  a.unsubscribe();
  b.unsubscribe();
  assert.equal(first.retainedPaneStateCount, 2);

  assert.equal(await registry.release(pageId, 'pane-a:tab-a'), false);
  assert.equal(first.paneStateForView(viewIdA), null);
  assert.ok(first.paneStateForView(viewIdB));
  assert.equal(await registry.release(pageId, 'pane-b:tab-b'), true);
  assert.equal(registry.get(pageId), null);
  assert.equal(first.disposed, true);
  assert.equal(recorder.calls.length, 1);

  const fresh = registry.acquire(pageId, {
    ...recorder.calls[0].cneText,
    revision: 1
  }, { referenceId: 'pane-c:tab-c' });
  assert.notEqual(fresh, first);
  assert.equal(fresh.source, 'shared');
  assert.deepEqual(fresh.historyDepth, { undo: 0, redo: 0 },
    'Undo history is live-session state and is not persisted');
  assert.equal(await registry.release(pageId, 'pane-c:tab-c'), true);
});

test('registry discard cancels pending deleted-Page source without saving', async () => {
  const recorder = createSaveRecorder();
  const registry = createHnPageDocumentSessionRegistry({
    save: recorder.save,
    saveDelayMs: 60_000
  });
  const session = registry.acquire('page_deleted', envelope(), { referenceId: 'tab-a' });
  const view = subscribeFakeView(session, 'pane-a');
  session.setFocusedView('pane-a');
  session.applySourceTransaction('pane-a', {
    from: 0,
    to: 0,
    insert: 'must not resurrect'
  }, { sourceVersion: 0 });

  assert.equal(await registry.discard('page_deleted'), true);
  assert.equal(registry.get('page_deleted'), null);
  assert.equal(session.disposed, true);
  assert.equal(view.disposed(), 1);
  assert.equal(recorder.calls.length, 0);
  assert.equal(await registry.discard('page_deleted'), false);
});

test('invalid current envelopes are rejected before a source session is created', () => {
  const recorder = createSaveRecorder();
  assert.throws(() => createHnPageDocumentSession({
    pageId: 'invalid',
    cneText: {
      schemaVersion: 3,
      revision: 0,
      source: '',
      anchors: { notYetSupported: { from: 0 } }
    },
    save: recorder.save
  }), /anchor entries/);
  assert.throws(() => createHnPageDocumentSession({
    pageId: 'future',
    cneText: {
      schemaVersion: 4,
      revision: 0,
      source: '',
      anchors: {}
    },
    save: recorder.save
  }), /Unsupported persisted/);
});
