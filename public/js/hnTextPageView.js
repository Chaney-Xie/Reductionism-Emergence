(function initHnTextPageView(root) {
  'use strict';

  const shell = root.structuredTextPageShell;
  const stageStates = new WeakMap();
  const layerStates = new WeakMap();
  const liveStates = new Set();
  let mountSequence = 0;

  function sourceEditorRuntime() {
    return root.sourceCanonicalEditor || null;
  }

  function isHnTextPage(page) {
    return Boolean(page?.id && page.type === 'cne-text' && page.cneText);
  }

  function viewIdentity(options) {
    return `${options.paneId || 'pane'}:${options.tabId || 'tab'}:${options.page?.id || 'page'}`;
  }

  function normalizedMode(value) {
    return sourceEditorRuntime()?.normalizeMode?.(value) || (value === 'browser' ? 'browser' : 'edit');
  }

  function currentSessionSnapshot(session) {
    return session?.currentSnapshot?.() || null;
  }

  function sessionReadOnly(session, snapshot = currentSessionSnapshot(session)) {
    return snapshot?.readOnly === true || session?.saveStatus?.readOnly === true;
  }

  function publishSourceSnapshot(state, snapshot = currentSessionSnapshot(state.session), metadata = {}) {
    if (!snapshot) return;
    state.updateCount += 1;
    state.layer.dataset.hnRevision = String(snapshot.revision ?? state.session.revision ?? 0);
    state.layer.dataset.hnSourceVersion = String(snapshot.sourceVersion ?? 0);
    state.layer.dataset.hnUpdateCount = String(state.updateCount);
    state.layer.dataset.hnTransactionCount = String(
      state.controller?.diagnostics?.().transactionCount || 0
    );
    state.layer.dataset.hnMigrationFailure = String(Boolean(snapshot.migrationFailure));
    if (typeof state.onDocumentState === 'function') {
      state.onDocumentState({
        pageId: state.page.id,
        paneId: state.paneId,
        tabId: state.tabId,
        schemaVersion: snapshot.schemaVersion,
        revision: snapshot.revision,
        sourceVersion: snapshot.sourceVersion,
        source: snapshot.source,
        anchors: snapshot.anchors,
        readOnly: snapshot.readOnly === true,
        migrationFailure: snapshot.migrationFailure || null,
        reason: metadata.reason || null
      });
    }
  }

  function applySessionReadOnly(state, snapshot = currentSessionSnapshot(state.session)) {
    const locked = sessionReadOnly(state.session, snapshot);
    state.controller?.setPageEditMode?.(state.pageEditMode);
    const capabilities = state.controller?.capabilities?.() || {
      mode: state.mode,
      canEdit: state.mode === 'edit' && !locked && !state.pageEditMode,
      canNavigateAnchors: state.mode === 'browser',
      readOnly: state.mode !== 'edit' || locked || state.pageEditMode,
      sessionReadOnly: locked
    };
    state.layer.classList.toggle('is-hn-session-read-only', locked);
    state.layer.classList.toggle('is-page-edit-mode', state.pageEditMode);
    state.layer.classList.toggle('is-hn-edit-mode', state.mode === 'edit');
    state.layer.classList.toggle('is-hn-browser-mode', state.mode === 'browser');
    state.layer.dataset.hnMode = state.mode;
    state.layer.dataset.hnReadOnly = String(capabilities.readOnly);
    state.layer.dataset.hnSessionReadOnly = String(locked);
    state.layer.dataset.hnPageEditMode = String(state.pageEditMode);
    state.layer.dataset.hnCanEdit = String(capabilities.canEdit);
    state.layer.dataset.hnCanNavigateAnchors = String(capabilities.canNavigateAnchors);
    // Browser locks only body interaction. The shared Page title remains editable
    // unless the Page session or structural Page Edit mode owns the lock.
    shell.updateBoundTitle?.(state.titleElement, {
      editable: !locked && !state.pageEditMode
    });
    return capabilities;
  }

  function renderHnTextPageLayer(options = {}) {
    const sourceEditor = sourceEditorRuntime();
    if (!sourceEditor?.createSourceCanonicalEditor
      || !sourceEditor?.createHnBasicPresentationStrategy
      || !shell) {
      throw new Error('The canonical HN source editor is unavailable.');
    }
    if (!isHnTextPage(options.page) || !(options.stage instanceof Element)
      || !(options.area instanceof Element) || !options.session) return null;

    const identity = viewIdentity(options);
    let state = stageStates.get(options.stage);
    if (state && state.identity !== identity) {
      destroyHnTextPageLayer(options.stage);
      state = null;
    }

    const mode = normalizedMode(options.mode ?? options.cneTextMode);
    const shellState = shell.mount({
      stage: options.stage,
      area: options.area,
      pageId: options.page.id,
      paneId: options.paneId,
      tabId: options.tabId,
      textFrame: options.page.textFrame,
      pageEditMode: Boolean(options.pageEditMode),
      frameBoundaryInteractionEnabled: options.frameBoundaryInteractionEnabled,
      scale: options.zoom,
      offsetX: options.cameraOffsetX,
      offsetY: options.cameraOffsetY,
      objectBounds: options.objectBounds,
      onExtentChange: options.onDocumentExtentChange,
      onTextFrameInput: (frame, detail) => state?.onTextFrameInput?.(frame, {
        ...detail,
        page: state.page,
        paneId: state.paneId,
        tabId: state.tabId
      }),
      onTextFrameCommit: (frame, detail) => state?.onTextFrameCommit?.(frame, {
        ...detail,
        page: state.page,
        paneId: state.paneId,
        tabId: state.tabId
      }),
      boundTitle: {
        title: options.page.title,
        page: options.page,
        editable: !sessionReadOnly(options.session) && !options.pageEditMode,
        onCommit: options.onTitleCommit,
        onResolvedTitle: (title, canonicalPage) => {
          if (!state) return;
          state.page = {
            ...state.page,
            ...(canonicalPage?.id === state.page?.id ? canonicalPage : {}),
            title
          };
        }
      }
    });

    if (state) {
      state.page = options.page;
      state.mode = mode;
      state.pageEditMode = Boolean(options.pageEditMode);
      state.onTitleCommit = options.onTitleCommit;
      state.onDocumentState = options.onDocumentState;
      state.onTextFrameInput = options.onTextFrameInput;
      state.onTextFrameCommit = options.onTextFrameCommit;
      state.controller.setMode(mode, {
        pageEditMode: state.pageEditMode,
        restoreFocus: false
      });
      state.controller.refresh();
      applySessionReadOnly(state);
      return state.layer;
    }

    const layer = document.createElement('div');
    layer.className = 'hn-text-page-layer structured-text-page-body';
    layer.dataset.hnPageId = options.page.id;
    layer.dataset.hnPaneId = options.paneId || '';
    layer.dataset.hnTabId = options.tabId || '';
    const mountId = `hn_mount_${++mountSequence}`;
    layer.dataset.hnMountId = mountId;
    const editorHost = document.createElement('div');
    editorHost.className = 'hn-text-editor-host';
    const editorRoot = document.createElement('div');
    editorRoot.className = 'hn-source-editor';
    editorHost.append(editorRoot);
    layer.append(editorHost);
    shellState.surface.replaceChildren(shellState.title, layer);

    state = {
      identity,
      stage: options.stage,
      area: options.area,
      layer,
      titleElement: shellState.title,
      editorHost,
      editorRoot,
      controller: null,
      session: options.session,
      paneState: root.hnPageDocumentSessionModel?.createPaneLocalState?.() || null,
      viewId: identity,
      mountId,
      page: options.page,
      mode,
      pageEditMode: Boolean(options.pageEditMode),
      paneId: options.paneId || null,
      tabId: options.tabId || null,
      referenceId: options.referenceId || null,
      onDocumentState: options.onDocumentState,
      onTitleCommit: options.onTitleCommit,
      onTextFrameInput: options.onTextFrameInput,
      onTextFrameCommit: options.onTextFrameCommit,
      updateCount: 0,
      focusCount: 0,
      destroying: false
    };
    stageStates.set(options.stage, state);
    layerStates.set(layer, state);
    liveStates.add(state);

    const presentationStrategy = sourceEditor.createHnBasicPresentationStrategy();
    state.controller = sourceEditor.createSourceCanonicalEditor({
      root: editorRoot,
      session: state.session,
      viewId: state.viewId,
      referenceId: state.referenceId,
      paneState: state.paneState,
      presentationStrategy,
      mode: state.mode,
      pageEditMode: state.pageEditMode,
      ariaLabel: 'HN Text document',
      onSnapshot: (snapshot, metadata) => {
        if (state.destroying) return;
        publishSourceSnapshot(state, snapshot, metadata);
        applySessionReadOnly(state, snapshot);
      },
      onDispose: () => {
        if (!state.destroying && stageStates.get(state.stage) === state) {
          destroyHnTextPageLayer(state.stage);
        }
      }
    });
    state.paneState = state.session.paneStateForView?.(state.viewId) || state.paneState;
    editorRoot.addEventListener('focusin', () => {
      state.focusCount += 1;
      state.layer.dataset.hnFocusCount = String(state.focusCount);
    });
    applySessionReadOnly(state);
    return layer;
  }

  function resolve(target) {
    if (!target) return null;
    if (stageStates.has(target)) return stageStates.get(target);
    if (layerStates.has(target)) return layerStates.get(target);
    const layer = target.closest?.('.hn-text-page-layer');
    return layer ? layerStates.get(layer) || null : null;
  }

  function captureHnTextSelection(target) {
    const state = resolve(target);
    if (!state || state.destroying || state.session.focusedViewId !== state.viewId) return false;
    try {
      const selection = state.controller.captureSelection();
      return Boolean(selection && selection.anchor !== selection.focus);
    } catch {
      return false;
    }
  }

  function reassertHnTextSelection(target) {
    const state = resolve(target);
    if (!state || state.destroying || state.session.focusedViewId !== state.viewId) return false;
    try {
      return state.controller.reassertSelection() === true;
    } catch {
      return false;
    }
  }

  function commitFocusedHnTextEditor(target = null) {
    let state = resolve(target);
    if (target != null && !state) return false;
    if (!state) {
      state = [...liveStates].find((candidate) => (
        candidate.session.focusedViewId === candidate.viewId
        || candidate.controller?.ownsFocus?.()
      )) || null;
    }
    if (!state || state.destroying) return false;
    try {
      return state.controller.commit?.() === true;
    } catch {
      return false;
    }
  }

  function updateHnTextPageLayer(target, patch = {}) {
    const state = resolve(target);
    if (!state) return null;
    if (Object.hasOwn(patch, 'pageEditMode')) {
      state.pageEditMode = Boolean(patch.pageEditMode);
      shell.setPageEditMode?.(state.stage, state.pageEditMode);
      state.controller.setPageEditMode(state.pageEditMode);
    }
    if (Object.hasOwn(patch, 'mode') || Object.hasOwn(patch, 'cneTextMode')) {
      state.mode = normalizedMode(patch.mode ?? patch.cneTextMode);
      state.controller.setMode(state.mode, { restoreFocus: true });
    }
    if (patch.page && isHnTextPage(patch.page)) {
      state.page = patch.page;
      shell.setTextFrame(state.stage, patch.page.textFrame);
      shell.updateBoundTitle?.(state.titleElement, {
        title: patch.page.title,
        page: patch.page,
        pageId: patch.page.id,
        paneId: state.paneId,
        tabId: state.tabId,
        onCommit: state.onTitleCommit,
        editable: !sessionReadOnly(state.session) && !state.pageEditMode
      });
    }
    if (Object.hasOwn(patch, 'onDocumentState')) state.onDocumentState = patch.onDocumentState;
    if (Object.hasOwn(patch, 'onTextFrameInput')) state.onTextFrameInput = patch.onTextFrameInput;
    if (Object.hasOwn(patch, 'onTextFrameCommit')) state.onTextFrameCommit = patch.onTextFrameCommit;
    const cameraPatch = {};
    if (Object.hasOwn(patch, 'zoom')) cameraPatch.scale = patch.zoom;
    if (Object.hasOwn(patch, 'cameraOffsetX')) cameraPatch.offsetX = patch.cameraOffsetX;
    if (Object.hasOwn(patch, 'cameraOffsetY')) cameraPatch.offsetY = patch.cameraOffsetY;
    if (Object.keys(cameraPatch).length > 0) shell.setCamera(state.stage, cameraPatch);
    if (Object.hasOwn(patch, 'objectBounds')) shell.setObjectBounds(state.stage, patch.objectBounds);
    applySessionReadOnly(state);
    return state.layer;
  }

  function destroyHnTextPageLayer(target) {
    const state = resolve(target);
    if (!state || state.destroying) return false;
    state.destroying = true;
    state.controller?.destroy?.();
    layerStates.delete(state.layer);
    if (stageStates.get(state.stage) === state) stageStates.delete(state.stage);
    liveStates.delete(state);
    shell.destroy(state.stage);
    return true;
  }

  function getHnTextDocumentBounds(target) {
    const state = resolve(target);
    return shell.getDocumentBounds(state?.stage || target);
  }

  function hnTextPageOwnsPointer(target) {
    return Boolean(target instanceof Element && (
      target.closest?.('.hn-text-page-layer') || shell.ownsPointer(target)
    ));
  }

  function refreshPageSessionState(pageId) {
    let refreshed = 0;
    for (const state of liveStates) {
      if (state.page.id !== pageId) continue;
      state.controller.refresh();
      applySessionReadOnly(state);
      refreshed += 1;
    }
    return refreshed;
  }

  function diagnostics(target) {
    const state = resolve(target);
    if (!state) return null;
    const controller = state.controller?.diagnostics?.() || null;
    return Object.freeze({
      pageId: state.page.id,
      paneId: state.paneId,
      tabId: state.tabId,
      viewId: state.viewId,
      mountId: state.mountId,
      mode: state.mode,
      capabilities: controller?.capabilities || null,
      sourceVersion: controller?.sourceVersion ?? null,
      sourceLength: controller?.sourceLength ?? null,
      selection: controller?.selection || null,
      migrationFailure: controller?.migrationFailure || null,
      updateCount: state.updateCount,
      transactionCount: controller?.transactionCount || 0,
      focusCount: state.focusCount,
      compositionCount: controller?.compositionCount || 0,
      title: state.titleElement?.textContent || '',
      editorViewDestroyed: Boolean(controller?.destroyed),
      session: state.session.diagnostics?.() || {
        revision: state.session.revision,
        subscriberCount: state.session.subscriberCount,
        referenceCount: state.session.referenceCount,
        mountEpoch: state.session.mountEpoch,
        saveStatus: state.session.saveStatus
      }
    });
  }

  const api = Object.freeze({
    renderHnTextPageLayer,
    updateHnTextPageLayer,
    destroyHnTextPageLayer,
    getHnTextDocumentBounds,
    hnTextPageOwnsPointer,
    captureHnTextSelection,
    reassertHnTextSelection,
    commitFocusedHnTextEditor,
    refreshPageSessionState,
    diagnostics
  });
  root.hnTextPageView = api;
  root.pageIsHnText = isHnTextPage;
  root.renderHnTextPageLayer = renderHnTextPageLayer;
  root.updateHnTextPageLayer = updateHnTextPageLayer;
  root.destroyHnTextPageLayer = destroyHnTextPageLayer;
  root.getHnTextDocumentBounds = getHnTextDocumentBounds;
  root.hnTextPageOwnsPointer = hnTextPageOwnsPointer;
  root.commitFocusedHnTextEditor = commitFocusedHnTextEditor;
}(typeof globalThis !== 'undefined' ? globalThis : window));
