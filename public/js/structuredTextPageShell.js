(function initStructuredTextPageShell(root) {
  'use strict';

  const frameModel = root.structuredTextFrameModel;
  if (!frameModel) {
    throw new Error('The structured text frame model must load before the shared Page shell.');
  }
  const DEFAULT_PREFERRED_WIDTH = frameModel.DEFAULT_TEXT_FRAME.preferredWidth;
  const MIN_FRAME_WIDTH = frameModel.MIN_FRAME_WIDTH;
  const MAX_FRAME_WIDTH = frameModel.MAX_FRAME_WIDTH;
  const DOCUMENT_BOTTOM_PADDING = 128;
  const MIN_DOCUMENT_HEIGHT = 480;
  const stageStates = new WeakMap();
  const boundaryDragStates = new WeakMap();
  const boundTitleStates = new WeakMap();
  const liveBoundTitles = new Set();

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizedObjectBounds(value) {
    if (!value || typeof value !== 'object') return null;
    const minX = Number(value.minX);
    const minY = Number(value.minY);
    const maxX = Number(value.maxX);
    const maxY = Number(value.maxY);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return {
      minX,
      minY,
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY)
    };
  }

  function element(tagName, className) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    return node;
  }

  function sameTextFrame(left, right) {
    const a = normalizeTextFrame(left);
    const b = normalizeTextFrame(right);
    return Math.abs(a.centerWorldX - b.centerWorldX) < 0.01
      && Math.abs(a.preferredWidth - b.preferredWidth) < 0.01;
  }

  function frameEditorEnabled(editor) {
    return typeof editor?.enabled === 'function'
      ? editor.enabled() === true
      : editor?.enabled === true;
  }

  function frameEditorDetail(editor, detail) {
    const context = typeof editor?.detail === 'function'
      ? editor.detail() : editor?.detail;
    return { ...(context && typeof context === 'object' ? context : {}), ...detail };
  }

  function finishFrameBoundaryDrag(editor, event, handle, cancelled, detailPatch = {}) {
    const active = boundaryDragStates.get(handle);
    if (!active || active.pointerId !== event.pointerId) return null;
    boundaryDragStates.delete(handle);
    handle.removeEventListener?.('pointermove', active.onPointerMove);
    handle.removeEventListener?.('pointerup', active.onPointerUp);
    handle.removeEventListener?.('pointercancel', active.onPointerCancel);
    handle.removeEventListener?.('lostpointercapture', active.onLostPointerCapture);
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const changed = !sameTextFrame(active.startFrame, active.currentFrame);
    if (cancelled || !changed) {
      const detail = frameEditorDetail(editor, {
        side: active.side,
        startFrame: { ...active.startFrame },
        cancelled: true,
        ...detailPatch
      });
      editor.setFrame?.({ ...active.startFrame }, detail);
      const inputResult = editor.onInput?.({ ...active.startFrame }, detail);
      const saveSettlementAccepted = detailPatch.settlement !== 'page-edit-save'
        || (inputResult !== false && inputResult !== undefined);
      return {
        settled: true,
        changed: false,
        committed: false,
        accepted: saveSettlementAccepted,
        frame: { ...active.startFrame }
      };
    }
    const detail = frameEditorDetail(editor, {
      side: active.side,
      startFrame: { ...active.startFrame },
      cancelled: false,
      ...detailPatch
    });
    const commitResult = editor.onCommit?.({ ...active.currentFrame }, detail);
    return {
      settled: true,
      changed: true,
      committed: commitResult !== false && commitResult !== undefined,
      accepted: commitResult !== false && commitResult !== undefined,
      frame: { ...active.currentFrame }
    };
  }

  function beginFrameBoundaryDrag(editor, side, event, handle) {
    const boundaryAlreadyOwnsGesture = [...(handle.parentElement?.children || [])]
      .some((candidate) => boundaryDragStates.has(candidate));
    if (!frameEditorEnabled(editor) || event.button !== 0 || boundaryAlreadyOwnsGesture) {
      return false;
    }
    const startFrame = normalizeTextFrame(editor.getFrame?.());
    const startEdges = frameModel.edgesForFrame(startFrame);
    const dragSession = frameModel.beginBoundaryDrag(startFrame, side);
    const pointerId = event.pointerId;
    const startClientX = finiteNumber(event.clientX, 0);
    const startEdgeWorldX = side === 'left' ? startEdges.leftWorld : startEdges.rightWorld;
    const active = {
      editor,
      pointerId,
      side,
      startClientX,
      startEdgeWorldX,
      startFrame,
      currentFrame: startFrame,
      dragSession,
      onPointerMove: null,
      onPointerUp: null,
      onPointerCancel: null,
      onLostPointerCapture: null
    };
    active.onPointerMove = (moveEvent) => {
      if (boundaryDragStates.get(handle) !== active
        || moveEvent.pointerId !== active.pointerId) return;
      if (!frameEditorEnabled(editor)) {
        finishFrameBoundaryDrag(editor, moveEvent, handle, true);
        return;
      }
      const zoom = Math.max(0.05, finiteNumber(editor.getZoom?.(), 1));
      const targetWorldX = active.startEdgeWorldX
        + ((finiteNumber(moveEvent.clientX, active.startClientX) - active.startClientX) / zoom);
      const nextFrame = frameModel.updateBoundaryDrag(active.dragSession, targetWorldX);
      active.currentFrame = nextFrame;
      const detail = frameEditorDetail(editor, {
        side: active.side,
        startFrame: { ...active.startFrame },
        cancelled: false
      });
      editor.setFrame?.({ ...nextFrame }, detail);
      editor.onInput?.({ ...nextFrame }, detail);
      moveEvent.preventDefault?.();
      moveEvent.stopPropagation?.();
    };
    active.onPointerUp = (upEvent) => finishFrameBoundaryDrag(
      editor,
      upEvent,
      handle,
      false
    );
    active.onPointerCancel = (cancelEvent) => finishFrameBoundaryDrag(
      editor,
      cancelEvent,
      handle,
      true
    );
    active.onLostPointerCapture = (lostEvent) => finishFrameBoundaryDrag(
      editor,
      lostEvent,
      handle,
      true
    );
    boundaryDragStates.set(handle, active);
    handle.addEventListener('pointermove', active.onPointerMove);
    handle.addEventListener('pointerup', active.onPointerUp);
    handle.addEventListener('pointercancel', active.onPointerCancel);
    handle.addEventListener('lostpointercapture', active.onLostPointerCapture);
    handle.setPointerCapture?.(pointerId);
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  function cancelFrameBoundaryDrags(boundary) {
    let cancelled = 0;
    for (const handle of boundary?.children || []) {
      const active = boundaryDragStates.get(handle);
      if (!active) continue;
      if (finishFrameBoundaryDrag(active.editor, {
        pointerId: active.pointerId
      }, handle, true)) cancelled += 1;
    }
    return cancelled;
  }

  function frameBoundaryForTarget(target) {
    if (!target) return null;
    if (target.classList?.contains?.('structured-text-page-boundary')) return target;
    const mounted = resolve(target);
    if (mounted?.boundary) return mounted.boundary;
    const boundaries = target.querySelectorAll?.('.structured-text-page-boundary');
    if (boundaries && boundaries.length !== 1) return null;
    return boundaries?.[0]
      || target.querySelector?.('.structured-text-page-boundary')
      || target.closest?.('.structured-text-page-boundary')
      || null;
  }

  function settleActiveBoundaryDragForSave(target) {
    const boundary = frameBoundaryForTarget(target);
    if (!boundary) {
      return Object.freeze({
        boundaryFound: false,
        settled: 0,
        changed: 0,
        committed: 0,
        accepted: false,
        frame: null
      });
    }
    const activeHandles = [...(boundary.children || [])]
      .filter((handle) => boundaryDragStates.has(handle));
    if (activeHandles.length > 1) {
      return Object.freeze({
        boundaryFound: true,
        settled: 0,
        changed: activeHandles.length,
        committed: 0,
        accepted: false,
        frame: null
      });
    }
    if (!activeHandles.length) {
      return Object.freeze({
        boundaryFound: true,
        settled: 0,
        changed: 0,
        committed: 0,
        accepted: true,
        frame: null
      });
    }
    const handle = activeHandles[0];
    const active = boundaryDragStates.get(handle);
    const result = finishFrameBoundaryDrag(active.editor, {
      pointerId: active.pointerId
    }, handle, false, {
      settlement: 'page-edit-save'
    });
    return Object.freeze({
      boundaryFound: true,
      settled: result?.settled ? 1 : 0,
      changed: result?.changed ? 1 : 0,
      committed: result?.committed ? 1 : 0,
      accepted: result?.accepted === true,
      frame: result?.frame ? Object.freeze({ ...result.frame }) : null
    });
  }

  function normalizeTextFrame(value) {
    return frameModel.normalizeTextFrame(value);
  }

  function presentationGeometry(state) {
    const textFrame = normalizeTextFrame(state.textFrame);
    const edges = frameModel.edgesForFrame(textFrame);
    state.textFrame = textFrame;
    return {
      ...edges,
      left: edges.leftWorld,
      right: edges.rightWorld
    };
  }

  function normalizeBoundTitleText(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ');
  }

  function moveBoundTitleCaretToEnd(title) {
    const selection = root.getSelection?.();
    if (!selection || !title?.isConnected || !document.createRange) return false;
    const range = document.createRange();
    range.selectNodeContents(title);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function selectBoundTitleContents(title) {
    const selection = root.getSelection?.();
    if (!selection || !title?.isConnected || !document.createRange) return false;
    const range = document.createRange();
    range.selectNodeContents(title);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function schedule(callback) {
    const enqueue = root.requestAnimationFrame || root.setTimeout;
    if (typeof enqueue === 'function') enqueue(callback);
    else callback();
  }

  function titleIsFocused(title) {
    return document.activeElement === title;
  }

  function canonicalTitleFromCommit(result, requestedTitle, previousTitle) {
    const canonical = typeof result === 'string'
      ? result.trim()
      : typeof result?.title === 'string'
        ? result.title.trim()
        : result === null
          ? previousTitle
          : requestedTitle;
    return canonical || previousTitle;
  }

  function updateBoundTitle(title, options = {}) {
    const state = boundTitleStates.get(title);
    if (!state) return null;
    if (Object.hasOwn(options, 'stage')) state.stage = options.stage || null;
    if (Object.hasOwn(options, 'page')) state.page = options.page || null;
    if (Object.hasOwn(options, 'pageId')) state.pageId = options.pageId || null;
    else if (options.page?.id) state.pageId = options.page.id;
    if (Object.hasOwn(options, 'paneId')) state.paneId = options.paneId || null;
    if (Object.hasOwn(options, 'tabId')) state.tabId = options.tabId || null;
    if (Object.hasOwn(options, 'onCommit')) {
      state.onCommit = typeof options.onCommit === 'function' ? options.onCommit : null;
    }
    if (Object.hasOwn(options, 'onPointerDown')) {
      state.onPointerDown = typeof options.onPointerDown === 'function'
        ? options.onPointerDown : null;
    }
    if (Object.hasOwn(options, 'onClick')) {
      state.onClick = typeof options.onClick === 'function' ? options.onClick : null;
    }
    if (Object.hasOwn(options, 'retainFocusOnBlur')) {
      state.retainFocusOnBlur = typeof options.retainFocusOnBlur === 'function'
        ? options.retainFocusOnBlur : null;
    }
    if (Object.hasOwn(options, 'onResolvedTitle')) {
      state.onResolvedTitle = typeof options.onResolvedTitle === 'function'
        ? options.onResolvedTitle : null;
    }
    const editable = options.editable !== false;
    state.editable = editable;
    if (editable) {
      title.contentEditable = 'plaintext-only';
      title.spellcheck = true;
      title.setAttribute('role', 'textbox');
      title.setAttribute('aria-label', 'Page title');
    } else {
      title.removeAttribute?.('contenteditable');
      title.removeAttribute?.('role');
      title.removeAttribute?.('aria-label');
    }
    const hasTitle = Object.hasOwn(options, 'title') || typeof options.page?.title === 'string';
    if (hasTitle) {
      const nextTitle = normalizeBoundTitleText(
        Object.hasOwn(options, 'title') ? options.title : options.page?.title
      ).trim() || 'Untitled';
      state.originalTitle = nextTitle;
      if (!titleIsFocused(title) && title.getAttribute?.('aria-busy') !== 'true') {
        title.textContent = nextTitle;
      }
    }
    return title;
  }

  function updateBoundTitles(pageId, title, options = {}) {
    const normalizedPageId = pageId || options.page?.id || null;
    const normalizedTitle = normalizeBoundTitleText(title).trim() || 'Untitled';
    let updated = 0;
    for (const boundTitle of [...liveBoundTitles]) {
      const state = boundTitleStates.get(boundTitle);
      if (!state || !boundTitle.isConnected) {
        liveBoundTitles.delete(boundTitle);
        continue;
      }
      if (state.pageId !== normalizedPageId) continue;
      state.originalTitle = normalizedTitle;
      if (options.page) state.page = options.page;
      const sourceStillOwnsCommit = boundTitle === options.source
        && normalizeBoundTitleText(boundTitle.textContent).trim() === options.sourceDraft;
      if (!titleIsFocused(boundTitle) || sourceStillOwnsCommit) {
        boundTitle.textContent = normalizedTitle;
      }
      state.onResolvedTitle?.(normalizedTitle, options.page || state.page);
      updated += 1;
    }
    return updated;
  }

  function createBoundTitle(options = {}) {
    const title = element('h1', 'structured-text-bound-title markdown-page-title');
    title.dataset.structuredTextRole = 'title';
    const state = {
      stage: null,
      page: null,
      pageId: null,
      paneId: null,
      tabId: null,
      originalTitle: 'Untitled',
      editable: true,
      cancelled: false,
      onCommit: null,
      onPointerDown: null,
      onClick: null,
      retainFocusOnBlur: null,
      onResolvedTitle: null
    };
    boundTitleStates.set(title, state);
    liveBoundTitles.add(title);
    title.addEventListener('pointerdown', (event) => {
      state.onPointerDown?.(event, title);
      event.stopPropagation?.();
    });
    title.addEventListener('click', (event) => {
      state.onClick?.(event, title);
      event.stopPropagation?.();
    });
    title.addEventListener('input', () => {
      const normalized = normalizeBoundTitleText(title.textContent);
      if (normalized === title.textContent) return;
      title.textContent = normalized;
      moveBoundTitleCaretToEnd(title);
    });
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter'
        && root.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, title)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        title.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        title.textContent = state.originalTitle;
        state.cancelled = true;
        title.blur();
      }
    });
    title.addEventListener('blur', async () => {
      if (state.retainFocusOnBlur?.(title)) {
        schedule(() => {
          if (state.retainFocusOnBlur?.(title) && title.isConnected) {
            title.focus({ preventScroll: true });
          }
        });
        return;
      }
      if (state.cancelled) {
        state.cancelled = false;
        return;
      }
      const nextTitle = normalizeBoundTitleText(title.textContent).trim();
      if (!nextTitle) {
        title.textContent = state.originalTitle;
        return;
      }
      title.textContent = nextTitle;
      if (nextTitle === state.originalTitle) return;
      title.setAttribute('aria-busy', 'true');
      try {
        const result = typeof state.onCommit === 'function'
          ? await state.onCommit({
            paneId: state.paneId,
            tabId: state.tabId,
            pageId: state.pageId,
            title: nextTitle,
            page: state.page,
            previousTitle: state.originalTitle
          })
          : nextTitle;
        const resolvedTitle = canonicalTitleFromCommit(
          result,
          nextTitle,
          state.originalTitle
        );
        updateBoundTitles(state.pageId, resolvedTitle, {
          page: typeof result === 'object' && result ? result : state.page,
          source: title,
          sourceDraft: nextTitle
        });
      } catch (_error) {
        const stillOwnsFailedCommit = normalizeBoundTitleText(title.textContent).trim()
          === nextTitle;
        if (!titleIsFocused(title) || stillOwnsFailedCommit) {
          title.textContent = state.originalTitle;
        }
      } finally {
        title.removeAttribute('aria-busy');
      }
    });
    updateBoundTitle(title, options);
    return title;
  }

  function destroyBoundTitle(title) {
    if (!boundTitleStates.has(title)) return false;
    liveBoundTitles.delete(title);
    boundTitleStates.delete(title);
    return true;
  }

  function focusBoundTitle(title, { selectAll = false } = {}) {
    const state = boundTitleStates.get(title);
    if (!state?.editable || !title?.isConnected) return false;
    title.focus({ preventScroll: true });
    return selectAll ? selectBoundTitleContents(title) : moveBoundTitleCaretToEnd(title);
  }

  function focusBoundTitleForStage(stage, options = {}) {
    for (const title of [...liveBoundTitles]) {
      const state = boundTitleStates.get(title);
      if (!state || !title.isConnected) {
        liveBoundTitles.delete(title);
        continue;
      }
      if (state.stage === stage) return focusBoundTitle(title, options);
    }
    return false;
  }

  function createFrameBoundary(options = {}) {
    const className = ['structured-text-page-boundary', options.className]
      .filter(Boolean)
      .join(' ');
    const boundary = element('div', className);
    boundary.setAttribute('aria-hidden', 'true');
    if (options.handles === true || options.frameEditor
      || typeof options.onHandlePointerDown === 'function') {
      ['left', 'right'].forEach((side) => {
        const handle = element('span', [
          'structured-text-page-frame-handle',
          options.handleClassName,
          `is-${side}`
        ].filter(Boolean).join(' '));
        handle.dataset.structuredTextFrameSide = side;
        if (options.handleDatasetName) handle.dataset[options.handleDatasetName] = side;
        if (options.frameEditor) {
          handle.addEventListener('pointerdown', (event) => (
            beginFrameBoundaryDrag(options.frameEditor, side, event, handle)
          ));
        } else if (typeof options.onHandlePointerDown === 'function') {
          handle.addEventListener('pointerdown', (event) => (
            options.onHandlePointerDown(side, event, handle)
          ));
        }
        boundary.append(handle);
      });
    }
    return boundary;
  }

  function calculateVisualFrameExtent(options = {}) {
    const documentTop = finiteNumber(options.documentTop, 0);
    const documentBottom = Math.max(
      documentTop,
      finiteNumber(options.documentBottom, documentTop)
    );
    const viewportHeight = Math.max(0, finiteNumber(options.viewportHeight, 0));
    const scale = Math.max(0.05, finiteNumber(options.scale, 1));
    const cameraOffsetY = finiteNumber(options.cameraOffsetY, 0);
    const viewportWorldBottom = Math.max(
      documentTop,
      (viewportHeight - cameraOffsetY) / scale
    );
    const bottom = Math.max(documentBottom, viewportWorldBottom);
    return {
      top: documentTop,
      bottom,
      height: Math.max(1, bottom - documentTop),
      documentBottom,
      viewportWorldBottom,
      viewportHeight,
      scale,
      cameraOffsetY
    };
  }

  function measuredContentBottom(state) {
    const surface = state.surface;
    if (!surface) return 0;
    const computed = typeof root.getComputedStyle === 'function'
      ? root.getComputedStyle(surface) : null;
    const bottomPadding = Math.max(
      0,
      finiteNumber(Number.parseFloat(computed?.paddingBottom), DOCUMENT_BOTTOM_PADDING)
    );
    const height = Math.max(
      finiteNumber(surface.scrollHeight, 0),
      finiteNumber(surface.offsetHeight, 0),
      MIN_DOCUMENT_HEIGHT
    );
    return Math.max(0, height - bottomPadding);
  }

  function updateExtent(state, { notify = true, force = false } = {}) {
    if (!state) return null;
    const geometry = presentationGeometry(state);
    const objects = normalizedObjectBounds(state.objectBounds);
    const measuredBottom = measuredContentBottom(state);
    const contentBottom = Math.max(0, state.explicitContentBottom === null
      ? measuredBottom
      : finiteNumber(state.explicitContentBottom, measuredBottom));
    const bottom = Math.max(
      MIN_DOCUMENT_HEIGHT,
      contentBottom,
      objects?.maxY || 0
    ) + DOCUMENT_BOTTOM_PADDING;
    const left = Math.min(geometry.left, objects?.minX ?? geometry.left);
    const right = Math.max(geometry.right, objects?.maxX ?? geometry.right);
    const semantic = {
      x: geometry.left,
      y: 0,
      left,
      top: 0,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom),
      frameLeft: geometry.left,
      frameRight: geometry.right,
      frameWidth: geometry.worldWidth,
      centerWorldX: geometry.centerWorldX,
      leftWorld: geometry.leftWorld,
      rightWorld: geometry.rightWorld,
      worldWidth: geometry.worldWidth,
      preferredWidth: geometry.preferredWidth,
      contentBottom,
      objectBottom: objects?.maxY || 0,
      bottomPadding: DOCUMENT_BOTTOM_PADDING
    };
    const areaRect = state.area?.getBoundingClientRect?.();
    const visual = calculateVisualFrameExtent({
      documentTop: semantic.top,
      documentBottom: semantic.bottom,
      viewportHeight: Math.max(
        0,
        finiteNumber(state.area?.clientHeight, finiteNumber(areaRect?.height, 0))
      ),
      scale: state.scale,
      cameraOffsetY: state.offsetY
    });
    const next = {
      ...semantic,
      visualFrameBottom: visual.bottom,
      visualFrameHeight: visual.height,
      viewportWorldBottom: visual.viewportWorldBottom,
      paneViewportHeight: visual.viewportHeight,
      scale: visual.scale,
      cameraOffsetY: visual.cameraOffsetY
    };
    const previous = state.bounds;
    state.bounds = next;
    state.extent.style.left = `${next.left}px`;
    state.extent.style.top = '0px';
    state.extent.style.width = `${next.width}px`;
    state.extent.style.height = `${next.height}px`;
    state.frame.style.left = `${geometry.left}px`;
    state.frame.style.width = `${geometry.worldWidth}px`;
    state.frame.style.minHeight = `${visual.height}px`;
    if (state.boundary) {
      state.boundary.style.height = `${visual.height}px`;
      state.boundary.dataset.visualFrameBottom = String(visual.bottom);
      state.boundary.dataset.documentBottom = String(semantic.bottom);
      state.boundary.dataset.viewportWorldBottom = String(visual.viewportWorldBottom);
    }
    state.frame.dataset.preferredWidth = String(geometry.preferredWidth);
    state.frame.dataset.worldWidth = String(geometry.worldWidth);
    state.frame.dataset.centerWorldX = String(geometry.centerWorldX);
    state.frame.dataset.leftWorld = String(geometry.leftWorld);
    state.frame.dataset.rightWorld = String(geometry.rightWorld);
    state.frame.dataset.visualFrameBottom = String(visual.bottom);
    state.frame.dataset.documentBottom = String(semantic.bottom);
    state.frame.dataset.viewportWorldBottom = String(visual.viewportWorldBottom);
    state.frame.dataset.paneViewportHeight = String(visual.viewportHeight);
    state.frame.dataset.contentBottom = String(semantic.contentBottom);
    state.frame.dataset.objectBottom = String(semantic.objectBottom);
    state.frame.dataset.documentBottomPadding = String(semantic.bottomPadding);
    const changed = !previous || [
      'left', 'right', 'top', 'bottom', 'frameWidth', 'visualFrameBottom'
    ]
      .some((key) => Math.abs(finiteNumber(previous?.[key], 0) - finiteNumber(next[key], 0)) >= 0.5);
    if (notify && (force || changed) && typeof state.onExtentChange === 'function') {
      state.onExtentChange({ ...next, pageId: state.pageId, paneId: state.paneId, tabId: state.tabId });
    }
    return next;
  }

  function applyCamera(state) {
    if (!state) return false;
    const scale = Math.max(0.05, finiteNumber(state.scale, 1));
    const offsetX = finiteNumber(state.offsetX, 0);
    const offsetY = finiteNumber(state.offsetY, 0);
    state.camera.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
    state.world.style.zoom = String(scale);
    state.camera.dataset.offsetX = String(offsetX);
    state.camera.dataset.offsetY = String(offsetY);
    state.world.dataset.zoom = String(scale);
    updateExtent(state);
    return true;
  }

  function observeSurface(state) {
    state.resizeObserver?.disconnect?.();
    if (typeof ResizeObserver !== 'function') return;
    state.resizeObserver = new ResizeObserver(() => {
      updateExtent(state, { force: true });
    });
    state.resizeObserver.observe(state.surface);
  }

  function mount(options = {}) {
    const { stage, area } = options;
    if (!(stage instanceof Element) || !(area instanceof Element)) return null;
    let state = stageStates.get(stage);
    const identityMatches = state
      && state.area === area
      && state.pageId === options.pageId
      && state.paneId === options.paneId
      && state.tabId === options.tabId;
    if (!identityMatches && state) {
      destroy(stage);
      state = null;
    }
    if (!state) {
      const camera = element('div', 'structured-text-page-camera-layer');
      const world = element('div', 'structured-text-page-world-layer');
      const extent = element('div', 'structured-text-page-document-extent');
      const frame = element('section', 'structured-text-page-frame');
      const surface = element('article', 'structured-text-page-surface');
      extent.setAttribute('aria-hidden', 'true');
      frame.dataset.pageId = options.pageId || '';
      frame.dataset.paneId = options.paneId || '';
      frame.dataset.tabId = options.tabId || '';
      state = {
        stage,
        area,
        camera,
        world,
        extent,
        frame,
        surface,
        boundary: null,
        title: null,
        pageId: options.pageId || null,
        paneId: options.paneId || null,
        tabId: options.tabId || null,
        textFrame: normalizeTextFrame(options.textFrame),
        pageEditMode: Boolean(options.pageEditMode),
        frameBoundaryInteractionEnabled: options.frameBoundaryInteractionEnabled,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        objectBounds: null,
        explicitContentBottom: null,
        bounds: null,
        resizeObserver: null,
        onExtentChange: null,
        onTextFrameInput: null,
        onTextFrameCommit: null
      };
      state.boundary = createFrameBoundary({
        handles: true,
        frameEditor: {
          enabled: () => state.pageEditMode && (
            typeof state.frameBoundaryInteractionEnabled === 'function'
              ? state.frameBoundaryInteractionEnabled() === true
              : state.frameBoundaryInteractionEnabled !== false
          ),
          getFrame: () => state.textFrame,
          getZoom: () => state.scale,
          setFrame: (nextFrame) => {
            state.textFrame = normalizeTextFrame(nextFrame);
            updateExtent(state, { force: true });
          },
          onInput: (nextFrame, detail) => state.onTextFrameInput?.(nextFrame, detail),
          onCommit: (nextFrame, detail) => state.onTextFrameCommit?.(nextFrame, detail),
          detail: () => ({
            pageId: state.pageId,
            paneId: state.paneId,
            tabId: state.tabId
          })
        }
      });
      frame.append(surface, state.boundary);
      world.append(extent, frame);
      camera.append(world);
      area.append(camera);
      stageStates.set(stage, state);
      observeSurface(state);
    } else if (!state.camera.isConnected) {
      area.append(state.camera);
    }
    const nextPageEditMode = Boolean(options.pageEditMode);
    if (state.pageEditMode && !nextPageEditMode) cancelFrameBoundaryDrags(state.boundary);
    state.pageEditMode = nextPageEditMode;
    state.frameBoundaryInteractionEnabled = options.frameBoundaryInteractionEnabled;
    if (Object.hasOwn(options, 'textFrame')) {
      state.textFrame = normalizeTextFrame(options.textFrame);
    }
    state.frame.classList.toggle?.('is-page-edit-mode', state.pageEditMode);
    state.frame.dataset.pageEditMode = String(state.pageEditMode);
    state.scale = Math.max(0.05, finiteNumber(options.scale, state.scale));
    state.offsetX = finiteNumber(options.offsetX, state.offsetX);
    state.offsetY = finiteNumber(options.offsetY, state.offsetY);
    state.objectBounds = normalizedObjectBounds(options.objectBounds);
    state.onExtentChange = typeof options.onExtentChange === 'function'
      ? options.onExtentChange : state.onExtentChange;
    state.onTextFrameInput = typeof options.onTextFrameInput === 'function'
      ? options.onTextFrameInput : null;
    state.onTextFrameCommit = typeof options.onTextFrameCommit === 'function'
      ? options.onTextFrameCommit : null;
    if (options.boundTitle) {
      const titleOptions = {
        ...options.boundTitle,
        stage,
        pageId: options.pageId,
        paneId: options.paneId,
        tabId: options.tabId
      };
      if (!state.title) state.title = createBoundTitle(titleOptions);
      else updateBoundTitle(state.title, titleOptions);
      if (state.surface.children[0] !== state.title) state.surface.prepend(state.title);
    }
    applyCamera(state);
    updateExtent(state, { force: true });
    return state;
  }

  function resolve(target) {
    if (!target) return null;
    if (stageStates.has(target)) return stageStates.get(target);
    if (target.stage && stageStates.get(target.stage) === target) return target;
    const stage = target.closest?.('.canvas-area')?.querySelector?.(':scope > .canvas-stage');
    return stage ? stageStates.get(stage) || null : null;
  }

  function setCamera(target, patch = {}) {
    const state = resolve(target);
    if (!state) return false;
    if (Object.hasOwn(patch, 'scale')) state.scale = Math.max(0.05, finiteNumber(patch.scale, 1));
    if (Object.hasOwn(patch, 'offsetX')) state.offsetX = finiteNumber(patch.offsetX, 0);
    if (Object.hasOwn(patch, 'offsetY')) state.offsetY = finiteNumber(patch.offsetY, 0);
    return applyCamera(state);
  }

  function setTextFrame(target, patch = {}) {
    const state = resolve(target);
    if (!state) return false;
    state.textFrame = normalizeTextFrame({ ...state.textFrame, ...patch });
    return Boolean(updateExtent(state, { force: true }));
  }

  function setPageEditMode(target, value) {
    const state = resolve(target);
    if (!state) return false;
    state.pageEditMode = Boolean(value);
    if (!state.pageEditMode) cancelFrameBoundaryDrags(state.boundary);
    state.frame.classList.toggle?.('is-page-edit-mode', state.pageEditMode);
    state.frame.dataset.pageEditMode = String(state.pageEditMode);
    return true;
  }

  function setObjectBounds(target, objectBounds) {
    const state = resolve(target);
    if (!state) return false;
    state.objectBounds = normalizedObjectBounds(objectBounds);
    return Boolean(updateExtent(state, { force: true }));
  }

  function setDocumentContentBottom(target, worldY) {
    const state = resolve(target);
    if (!state) return false;
    state.explicitContentBottom = worldY === null || worldY === undefined
      ? null
      : Number.isFinite(Number(worldY)) ? Number(worldY) : null;
    return Boolean(updateExtent(state));
  }

  function getDocumentBounds(target) {
    const state = resolve(target);
    if (!state) return null;
    return { ...(state.bounds || updateExtent(state, { notify: false })) };
  }

  function clampVerticalOffset(options = {}) {
    const scale = Math.max(0.05, finiteNumber(options.scale, 1));
    const viewportHeight = Math.max(0, finiteNumber(options.viewportHeight, 0));
    const documentTop = finiteNumber(options.documentTop, 0);
    const documentBottom = Math.max(documentTop, finiteNumber(options.documentBottom, documentTop));
    const topAligned = -documentTop * scale;
    const bottomAligned = viewportHeight - documentBottom * scale;
    if ((documentBottom - documentTop) * scale <= viewportHeight) return topAligned;
    return clamp(finiteNumber(options.offsetY, topAligned), bottomAligned, topAligned);
  }

  function ownsPointer(target) {
    return Boolean(target instanceof Element && target.closest('.structured-text-page-frame'));
  }

  function destroy(target) {
    const state = resolve(target);
    if (!state) return false;
    cancelFrameBoundaryDrags(state.boundary);
    state.resizeObserver?.disconnect?.();
    destroyBoundTitle(state.title);
    state.camera.remove();
    if (stageStates.get(state.stage) === state) stageStates.delete(state.stage);
    return true;
  }

  root.structuredTextPageShell = Object.freeze({
    DEFAULT_PREFERRED_WIDTH,
    MIN_FRAME_WIDTH,
    MAX_FRAME_WIDTH,
    normalizeTextFrame,
    edgesForTextFrame: frameModel.edgesForFrame,
    calculateVisualFrameExtent,
    createFrameBoundary,
    cancelFrameBoundaryDrags,
    settleActiveBoundaryDragForSave,
    createBoundTitle,
    updateBoundTitle,
    updateBoundTitles,
    destroyBoundTitle,
    focusBoundTitle,
    focusBoundTitleForStage,
    mount,
    setCamera,
    setTextFrame,
    setPageEditMode,
    setObjectBounds,
    setDocumentContentBottom,
    getDocumentBounds,
    clampVerticalOffset,
    ownsPointer,
    destroy
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
