(function exposeSidebarMembershipMoveAnimation(root, factory) {
  const disclosureMotion = typeof module === 'object' && module.exports
    ? require('./disclosureMotion')
    : root?.disclosureMotionModel;
  const api = factory(disclosureMotion);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.sidebarMembershipMoveAnimationModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (disclosureMotionModel) => {
  const ROOT_CONTAINER_ID = 'root';
  const SOURCE_DURATION_MS = 128;
  const PHASE_GAP_MS = 18;
  const TARGET_DURATION_MS = 168;
  const FALLBACK_GRACE_MS = 80;
  const DISCLOSURE_DURATION_MS = disclosureMotionModel?.DISCLOSURE_DURATION_MS || 176;
  const DRAG_POINTER_OFFSET_X = 14;
  const DRAG_POINTER_OFFSET_Y = 12;
  const LAYOUT_EASING = 'cubic-bezier(.2, .75, .25, 1)';
  const STYLE_KEYS = Object.freeze([
    'boxSizing',
    'height',
    'minHeight',
    'maxHeight',
    'marginTop',
    'marginBottom',
    'paddingTop',
    'paddingBottom',
    'borderTopWidth',
    'borderBottomWidth',
    'opacity',
    'overflow',
    'pointerEvents',
    'transform',
    'transformOrigin',
    'willChange'
  ]);

  function containerId(parentFolderId) {
    return parentFolderId ? `folder:${parentFolderId}` : ROOT_CONTAINER_ID;
  }

  function itemId(item) {
    if (!item || !['page', 'folder'].includes(item.type) || typeof item.id !== 'string') {
      return null;
    }
    return `${item.type}:${item.id}`;
  }

  function rowId(element) {
    if (element?.dataset?.sidebarMotionId) return element.dataset.sidebarMotionId;
    if (element?.dataset?.pageId) return `page:${element.dataset.pageId}`;
    if (element?.dataset?.folderId) return `folder:${element.dataset.folderId}`;
    return null;
  }

  function normalizeMoveDescriptors(items, destinationParentFolderId = null) {
    const destinationContainerId = containerId(destinationParentFolderId);
    const seen = new Set();
    const moves = [];
    for (const item of items || []) {
      const id = itemId(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const hasKnownSource = Object.hasOwn(item, 'sourceParentFolderId')
        && item.sourceParentFolderId !== undefined;
      const sourceContainerId = hasKnownSource
        ? containerId(item.sourceParentFolderId)
        : null;
      if (sourceContainerId === destinationContainerId) continue;
      moves.push(Object.freeze({
        id,
        type: item.type,
        itemId: item.id,
        sourceContainerId,
        destinationContainerId
      }));
    }
    return Object.freeze(moves);
  }

  function childElements(element) {
    return [...(element?.children || [])];
  }

  function walkDescendants(element, visit) {
    for (const child of childElements(element)) {
      visit(child);
      walkDescendants(child, visit);
    }
  }

  function hasClass(element, name) {
    return element?.classList?.contains?.(name) === true;
  }

  function elementContains(parent, candidate) {
    if (!parent || !candidate) return false;
    if (typeof parent.contains === 'function') return parent.contains(candidate);
    for (let current = candidate; current; current = current.parentElement) {
      if (current === parent) return true;
    }
    return false;
  }

  function visibleRect(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null;
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return rect;
  }

  function directRows(container) {
    return childElements(container).filter((element) => Boolean(rowId(element)));
  }

  function motionElementId(element) {
    if (element?.dataset?.sidebarMotionId) return element.dataset.sidebarMotionId;
    if (element?.dataset?.pageId) return `page:${element.dataset.pageId}`;
    if (hasClass(element, 'nav-folder-empty')) {
      for (let owner = element.parentElement; owner; owner = owner.parentElement) {
        if (hasClass(owner, 'nav-folder') && owner.dataset?.folderId) {
          return `hint:folder:${owner.dataset.folderId}`;
        }
      }
    }
    if (hasClass(element, 'nav-empty-state')) return 'hint:root';
    if (!element?.dataset?.folderId) return null;
    const ownsStableHeader = childElements(element).some(
      (child) => Boolean(child?.dataset?.sidebarMotionId)
    );
    return ownsStableHeader ? null : `folder:${element.dataset.folderId}`;
  }

  function motionLogicalId(element) {
    if (element?.dataset?.pageId) return `page:${element.dataset.pageId}`;
    if (element?.dataset?.folderId) return `folder:${element.dataset.folderId}`;
    const stableId = element?.dataset?.sidebarMotionId || '';
    if (stableId.startsWith('folder:') && !stableId.includes('/')) return stableId;
    return null;
  }

  function stableRowSnapshot(scope) {
    const snapshots = new Map();
    const occurrences = new Map();
    const collect = (element) => {
      const id = motionElementId(element);
      const rect = id ? visibleRect(element) : null;
      if (!id || !rect) return;
      const occurrence = occurrences.get(id) || 0;
      occurrences.set(id, occurrence + 1);
      const key = occurrence === 0 ? id : `${id}#${occurrence}`;
      snapshots.set(key, {
        id: key,
        stableId: id,
        logicalId: motionLogicalId(element),
        element,
        rect
      });
    };
    if (scope) {
      collect(scope);
      walkDescendants(scope, collect);
    }
    return snapshots;
  }

  function createCoordinator({
    root,
    documentRef = typeof document !== 'undefined' ? document : null,
    windowRef = typeof window !== 'undefined' ? window : null,
    onTrace = null,
    onInterrupt = null,
    activityClass = 'is-sidebar-membership-move-animating',
    visibilityClass = 'left-sidebar-collapsed',
    resolveDisclosureRegion = null,
    sourceDuration = SOURCE_DURATION_MS,
    phaseGap = PHASE_GAP_MS,
    targetDuration = TARGET_DURATION_MS
  } = {}) {
    let sequence = 0;
    let activeSession = null;

    const rootElement = () => (typeof root === 'function' ? root() : root) || null;
    const timerHost = windowRef || globalThis;
    const recordDisclosureTrace = typeof onTrace === 'function' ? (event) => {
      if (!Object.hasOwn(event?.details || {}, 'disclosureId')) return onTrace(event);
      const { disclosureId, ...details } = event.details;
      return onTrace({ ...event, details: { folderId: disclosureId, ...details } });
    } : null;
    const disclosureController = disclosureMotionModel?.createController?.({
      root: rootElement,
      documentRef,
      windowRef,
      onTrace: recordDisclosureTrace,
      activityClass,
      visibilityClass,
      resolveRegion: folderRegion,
      resolveStableId: motionElementId,
      nextSessionId: () => ++sequence,
      duration: DISCLOSURE_DURATION_MS,
      layoutDuration: targetDuration,
      easing: LAYOUT_EASING
    }) || null;

    function trace(session, phase, details = null) {
      if (typeof onTrace !== 'function') return;
      onTrace({
        sessionId: session?.id || null,
        phase,
        ...(details ? { details } : {})
      });
    }

    function prefersReducedMotion() {
      try {
        return windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
      } catch (_error) {
        return false;
      }
    }

    function makeSession(kind, extras = {}) {
      return {
        id: ++sequence,
        kind,
        animations: new Set(),
        animationElements: new Map(),
        animatedElements: new Set(),
        timers: new Map(),
        extractedRows: [],
        extractedElements: new Set(),
        bubble: null,
        cancelled: false,
        cleaned: false,
        render: null,
        rendered: false,
        renderRequired: false,
        visibilityObserver: null,
        resizeObserver: null,
        observedRootWidth: null,
        resizeObservationReady: false,
        resizeHandler: null,
        ...extras
      };
    }

    function installRender(session, render, { required = true } = {}) {
      if (!session || typeof render !== 'function') return false;
      if (!session.render) {
        session.render = () => {
          if (session.rendered) return false;
          session.rendered = true;
          render();
          return true;
        };
      }
      session.renderRequired = session.renderRequired || required;
      return true;
    }

    function invokeRender(session, phase = null) {
      if (!session?.render || session.rendered) return false;
      if (phase) trace(session, phase);
      return session.render();
    }

    function watchInterruptions(session) {
      const Observer = windowRef?.MutationObserver;
      if (Observer && documentRef?.body) {
        const initiallyCollapsed = documentRef.body.classList?.contains?.(
          visibilityClass
        ) === true;
        session.visibilityObserver = new Observer(() => {
          if (activeSession !== session) return;
          const collapsed = documentRef.body.classList?.contains?.(
            visibilityClass
          ) === true;
          if (collapsed !== initiallyCollapsed) interrupt(session, 'sidebar-visibility-change');
        });
        session.visibilityObserver.observe(documentRef.body, {
          attributes: true,
          attributeFilter: ['class']
        });
      }
      if (typeof windowRef?.addEventListener === 'function') {
        session.resizeHandler = () => {
          if (activeSession === session) interrupt(session, 'sidebar-resize');
        };
        windowRef.addEventListener('resize', session.resizeHandler, { passive: true });
      }
      const ResizeObserver = windowRef?.ResizeObserver;
      const observedRoot = rootElement();
      if (ResizeObserver && observedRoot && !session.resizeObserver) {
        session.resizeObserver = new ResizeObserver((entries) => {
          if (activeSession !== session) return;
          const entry = (entries || []).find((candidate) => candidate?.target === observedRoot)
            || entries?.[0]
            || null;
          const measuredWidth = Number(entry?.contentRect?.width);
          const width = Number.isFinite(measuredWidth)
            ? measuredWidth
            : Number(observedRoot.getBoundingClientRect?.().width);
          if (!Number.isFinite(width)) return;
          if (!session.resizeObservationReady) {
            session.resizeObservationReady = true;
            session.observedRootWidth = width;
            return;
          }
          const previousWidth = session.observedRootWidth;
          session.observedRootWidth = width;
          if (Number.isFinite(previousWidth) && Math.abs(width - previousWidth) > 0.5) {
            interrupt(session, 'sidebar-width-change');
          }
        });
        session.resizeObserver.observe(observedRoot);
      }
    }

    function containerMap() {
      const currentRoot = rootElement();
      const containers = new Map();
      if (!currentRoot) return containers;
      containers.set(ROOT_CONTAINER_ID, currentRoot);
      walkDescendants(currentRoot, (element) => {
        if (!hasClass(element, 'nav-folder-pages')) return;
        const id = element.dataset?.navigationContainerId;
        if (id) containers.set(id, element);
      });
      return containers;
    }

    function folderRow(folderId) {
      if (!folderId) return null;
      let match = null;
      walkDescendants(rootElement(), (element) => {
        if (!match && hasClass(element, 'nav-folder') && element.dataset?.folderId === folderId) {
          match = element;
        }
      });
      return match;
    }

    function folderButton(folderId) {
      const row = folderRow(folderId);
      if (!row) return null;
      let match = null;
      for (const child of childElements(row)) {
        if (hasClass(child, 'nav-folder-button')) {
          match = child;
          break;
        }
      }
      if (match) return match;
      walkDescendants(row, (element) => {
        if (!match && hasClass(element, 'nav-folder-button')) match = element;
      });
      return match;
    }

    function folderRegion(folderId) {
      if (typeof resolveDisclosureRegion === 'function') {
        return resolveDisclosureRegion(folderId, rootElement()) || null;
      }
      let match = null;
      walkDescendants(rootElement(), (element) => {
        if (match || !hasClass(element, 'nav-folder-pages')) return;
        if (element.dataset?.sidebarMotionRegion === folderId
          || element.dataset?.navigationContainerId === `folder:${folderId}`) {
          match = element;
        }
      });
      return match;
    }

    function clearTimer(session, timerId) {
      const finish = session?.timers?.get(timerId);
      if (!finish) return;
      timerHost?.clearTimeout?.(timerId);
      session.timers.delete(timerId);
      finish(false);
    }

    function delay(session, milliseconds) {
      if (!milliseconds || session.cancelled) return Promise.resolve(!session.cancelled);
      return new Promise((resolve) => {
        const timerId = timerHost.setTimeout(() => {
          session.timers.delete(timerId);
          resolve(!session.cancelled);
        }, milliseconds);
        session.timers.set(timerId, resolve);
      });
    }

    function startAnimation(session, element, keyframes, options) {
      if (session.cancelled || !element?.animate) return null;
      element.classList?.add?.('is-sidebar-membership-animated-row');
      let animation = null;
      try {
        animation = element.animate(keyframes, options);
      } catch (_error) {
        element.classList?.remove?.('is-sidebar-membership-animated-row');
        return null;
      }
      session.animations.add(animation);
      session.animationElements.set(animation, element);
      session.animatedElements.add(element);
      Promise.resolve(animation.finished).catch(() => {}).finally(() => {
        element.classList?.remove?.('is-sidebar-membership-animated-row');
        session.animatedElements.delete(element);
      });
      return animation;
    }

    async function waitForAnimations(session, animations, duration) {
      const running = animations.filter(Boolean);
      if (!running.length) return !session.cancelled;
      let fallbackTimer = 0;
      const fallback = new Promise((resolve) => {
        fallbackTimer = timerHost.setTimeout(() => {
          session.timers.delete(fallbackTimer);
          resolve(false);
        }, duration + FALLBACK_GRACE_MS);
        session.timers.set(fallbackTimer, resolve);
      });
      await Promise.race([
        Promise.allSettled(running.map((animation) => Promise.resolve(animation.finished))),
        fallback
      ]);
      if (fallbackTimer && session.timers.has(fallbackTimer)) clearTimer(session, fallbackTimer);
      return !session.cancelled;
    }

    function rememberInlineStyles(element) {
      const values = {};
      for (const key of STYLE_KEYS) values[key] = element?.style?.[key] ?? '';
      return values;
    }

    function restoreInlineStyles(record) {
      if (!record?.element?.style) return;
      for (const key of STYLE_KEYS) record.element.style[key] = record.inline[key];
      record.element.classList?.remove?.('is-sidebar-membership-exiting-row');
    }

    function measuredBox(element, rect) {
      const computed = windowRef?.getComputedStyle?.(element) || {};
      return {
        boxSizing: 'border-box',
        height: `${rect.height}px`,
        minHeight: '0px',
        maxHeight: `${rect.height}px`,
        marginTop: computed.marginTop || '0px',
        marginBottom: computed.marginBottom || '0px',
        paddingTop: computed.paddingTop || '0px',
        paddingBottom: computed.paddingBottom || '0px',
        borderTopWidth: computed.borderTopWidth || '0px',
        borderBottomWidth: computed.borderBottomWidth || '0px',
        opacity: computed.opacity || '1',
        transform: computed.transform && computed.transform !== 'none'
          ? computed.transform
          : 'translate3d(0, 0, 0)'
      };
    }

    function collapsedBox() {
      return {
        boxSizing: 'border-box',
        height: '0px',
        minHeight: '0px',
        maxHeight: '0px',
        marginTop: '0px',
        marginBottom: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
        opacity: '0',
        transform: 'translate3d(0, -3px, 0)'
      };
    }

    function applyExtractedState(record) {
      const { element } = record;
      if (!element?.style) return;
      element.style.boxSizing = 'border-box';
      element.style.height = '0px';
      element.style.minHeight = '0px';
      element.style.maxHeight = '0px';
      element.style.marginTop = '0px';
      element.style.marginBottom = '0px';
      element.style.paddingTop = '0px';
      element.style.paddingBottom = '0px';
      element.style.borderTopWidth = '0px';
      element.style.borderBottomWidth = '0px';
      element.style.opacity = '0';
      element.style.overflow = 'hidden';
      element.style.pointerEvents = 'none';
      element.style.transform = 'translate3d(0, -3px, 0)';
      element.style.transformOrigin = 'top';
      element.style.willChange = 'height, margin, padding, transform, opacity';
      element.classList?.add?.('is-sidebar-membership-exiting-row');
    }

    function extractRows(session, elements, { animate = true } = {}) {
      const animations = [];
      let visibleExits = 0;
      for (const element of elements) {
        if (!element || session.extractedElements.has(element)) continue;
        const rect = visibleRect(element);
        if (!rect) continue;
        const record = {
          element,
          rect,
          open: measuredBox(element, rect),
          inline: rememberInlineStyles(element)
        };
        session.extractedElements.add(element);
        session.extractedRows.push(record);
        applyExtractedState(record);
        visibleExits += 1;
        if (animate) {
          animations.push(startAnimation(session, element, [record.open, collapsedBox()], {
            duration: sourceDuration,
            easing: LAYOUT_EASING
          }));
        }
      }
      return { animations, visibleExits };
    }

    function settleExtractedRows(session) {
      for (const record of session.extractedRows) restoreInlineStyles(record);
      session.extractedRows.length = 0;
      session.extractedElements.clear();
    }

    function renderedAnimationFrames(session) {
      const frames = new Map();
      for (const element of new Set(session.animationElements.values())) {
        if (!session.extractedElements.has(element)) continue;
        const rect = element?.getBoundingClientRect?.();
        if (!rect || !Number.isFinite(rect.height)) continue;
        frames.set(element, measuredBox(element, rect));
      }
      return frames;
    }

    function preserveRenderedAnimationFrames(session) {
      for (const animation of session.animations) {
        if (!session.extractedElements.has(session.animationElements.get(animation))) continue;
        try { animation.commitStyles?.(); } catch (_error) {
          // A finished or detached effect may not expose a committable frame.
        }
      }
      // Sample after `commitStyles`: when available it exposes the exact live
      // effect as inline style; otherwise computed geometry still reflects the
      // running effect until cancellation.
      const frames = renderedAnimationFrames(session);
      // `commitStyles` is not universal. Freeze the sampled used box as a
      // deterministic fallback before cancelling effects so the next phase
      // starts at the live frame.
      for (const [element, frame] of frames) setInlineStyles(element, frame);
      return frames;
    }

    function cancelAnimations(session, { preserveCurrent = false } = {}) {
      const frames = preserveCurrent ? preserveRenderedAnimationFrames(session) : new Map();
      for (const animation of session.animations) {
        try { animation.cancel?.(); } catch (_error) { /* Presentation cleanup is best-effort. */ }
      }
      session.animations.clear();
      session.animationElements.clear();
      for (const element of session.animatedElements) {
        element.classList?.remove?.('is-sidebar-membership-animated-row');
      }
      session.animatedElements.clear();
      return frames;
    }

    function removeBubble(session) {
      if (!session?.bubble) return;
      session.bubble.remove?.();
      session.bubble = null;
    }

    function cleanup(session, { reason = 'complete', ensureRender = false } = {}) {
      if (!session) return;
      if (ensureRender && session.renderRequired && !session.rendered) {
        try { invokeRender(session, 'render'); } catch (error) {
          trace(session, 'render-error', { message: error?.message || String(error) });
        }
      }
      if (session.cleaned) return;
      session.cleaned = true;
      session.visibilityObserver?.disconnect?.();
      session.visibilityObserver = null;
      session.resizeObserver?.disconnect?.();
      session.resizeObserver = null;
      if (session.resizeHandler) {
        windowRef?.removeEventListener?.('resize', session.resizeHandler);
        session.resizeHandler = null;
      }
      for (const timerId of [...session.timers.keys()]) clearTimer(session, timerId);
      cancelAnimations(session);
      settleExtractedRows(session);
      removeBubble(session);
      documentRef?.body?.classList?.remove?.(activityClass);
      if (activeSession === session) activeSession = null;
      trace(session, 'cleanup', { reason });
    }

    function cancel(reason = 'interrupted') {
      const disclosureCancelled = disclosureController?.cancel(reason) === true;
      const session = activeSession;
      if (!session) return disclosureCancelled;
      session.cancelled = true;
      cleanup(session, { reason, ensureRender: true });
      return true;
    }

    function interrupt(session, reason) {
      if (!session || activeSession !== session) return false;
      if (session.kind === 'drag' && typeof onInterrupt === 'function') {
        try {
          if (onInterrupt({ session, reason }) === true) {
            trace(session, 'interruption-handoff', { reason });
            return true;
          }
        } catch (_error) {
          // Fall through to deterministic local cleanup if the app owner cannot respond.
        }
      }
      return cancel(reason);
    }

    function setInlineStyles(element, values) {
      if (!element?.style) return;
      for (const [key, value] of Object.entries(values)) element.style[key] = value;
    }

    function createDragBubble(session) {
      if (!documentRef?.createElement || !documentRef?.body?.append) return null;
      const count = session.extractPageIds.length;
      const name = session.primaryName || 'Untitled';
      const bubble = documentRef.createElement('div');
      bubble.className = 'sidebar-membership-drag-stack file-typography';
      bubble.dataset.sidebarMembershipDragStack = '';
      bubble.dataset.effectivePageCount = String(count);
      bubble.setAttribute?.('aria-hidden', 'true');
      setInlineStyles(bubble, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        zIndex: '2147483000',
        display: 'flex',
        alignItems: 'center',
        gap: '0.18rem',
        boxSizing: 'border-box',
        minWidth: '0px',
        maxWidth: 'min(18rem, calc(100vw - 24px))',
        padding: '0.36rem 0.55rem',
        border: '1px solid var(--border-tool)',
        borderRadius: '5px',
        color: 'var(--text-colour)',
        background: 'var(--surface-tool)',
        boxShadow: count > 1
          ? '2px 2px 0 var(--surface-tool), 3px 3px 0 var(--border-guide), 0 6px 16px rgba(30, 43, 58, .16)'
          : '0 6px 16px rgba(30, 43, 58, .16)',
        opacity: '0.98',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        willChange: 'transform, opacity',
        transform: 'translate3d(-9999px, -9999px, 0)'
      });
      const label = documentRef.createElement('span');
      label.className = 'sidebar-membership-drag-stack-name';
      label.textContent = name;
      setInlineStyles(label, {
        flex: '1 1 auto',
        minWidth: '0px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      });
      bubble.append(label);
      if (count > 1) {
        const suffix = documentRef.createElement('span');
        suffix.className = 'sidebar-membership-drag-stack-count';
        suffix.textContent = ` · ${count} files`;
        setInlineStyles(suffix, {
          flex: '0 0 auto',
          whiteSpace: 'nowrap'
        });
        bubble.append(suffix);
      }
      documentRef.body.append(bubble);
      session.bubble = bubble;
      return bubble;
    }

    function positionDragBubble(session, x, y) {
      const bubble = session?.bubble;
      if (!bubble?.style || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      session.pointer = { x, y };
      const rect = bubble.getBoundingClientRect?.() || { width: 0, height: 0 };
      const viewportWidth = Number.isFinite(windowRef?.innerWidth)
        ? windowRef.innerWidth
        : Number.POSITIVE_INFINITY;
      const viewportHeight = Number.isFinite(windowRef?.innerHeight)
        ? windowRef.innerHeight
        : Number.POSITIVE_INFINITY;
      const left = Math.max(8, Math.min(x + DRAG_POINTER_OFFSET_X,
        viewportWidth - (rect.width || 0) - 8));
      const top = Math.max(8, Math.min(y + DRAG_POINTER_OFFSET_Y,
        viewportHeight - (rect.height || 0) - 8));
      bubble.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      return true;
    }

    function effectiveDragRows(effectivePageIds, sourceElement = null) {
      const ids = new Set(effectivePageIds);
      if (sourceElement && ids.has(sourceElement.dataset?.pageId)
        && visibleRect(sourceElement)) {
        return [sourceElement];
      }
      const rows = [];
      const currentRoot = rootElement();
      const collect = (element) => {
        if (!ids.has(element?.dataset?.pageId)) return;
        if (visibleRect(element)) rows.push(element);
      };
      if (currentRoot) {
        collect(currentRoot);
        walkDescendants(currentRoot, collect);
      }
      return rows;
    }

    function owningContainerId(element) {
      const currentRoot = rootElement();
      for (let current = element?.parentElement; current; current = current.parentElement) {
        if (current.dataset?.navigationContainerId) {
          return current.dataset.navigationContainerId;
        }
        if (current === currentRoot) break;
      }
      return currentRoot && elementContains(currentRoot, element) ? ROOT_CONTAINER_ID : null;
    }

    function beginDrag({
      items = [],
      effectivePageIds = [],
      extractPageIds = effectivePageIds,
      deferredPageIds = [],
      primaryPageId = null,
      primaryName = 'Untitled',
      sourceElement = null,
      pointer = null
    } = {}) {
      if (activeSession || disclosureController?.active) cancel('superseded');
      const uniquePageIds = [];
      const seen = new Set();
      for (const candidate of effectivePageIds) {
        if (typeof candidate !== 'string' || seen.has(candidate)) continue;
        seen.add(candidate);
        uniquePageIds.push(candidate);
      }
      if (!uniquePageIds.length) {
        for (const item of items) {
          if (item?.type !== 'page' || typeof item.id !== 'string' || seen.has(item.id)) continue;
          seen.add(item.id);
          uniquePageIds.push(item.id);
        }
      }
      if (!uniquePageIds.length && typeof primaryPageId === 'string') {
        uniquePageIds.push(primaryPageId);
      }
      if (!uniquePageIds.length) return null;
      const effectiveSet = new Set(uniquePageIds);
      const uniqueExtractPageIds = [];
      const seenExtract = new Set();
      for (const candidate of extractPageIds || []) {
        if (typeof candidate !== 'string' || seenExtract.has(candidate)) continue;
        seenExtract.add(candidate);
        uniqueExtractPageIds.push(candidate);
        if (!effectiveSet.has(candidate)) {
          effectiveSet.add(candidate);
          uniquePageIds.push(candidate);
        }
      }
      if (!uniqueExtractPageIds.length) uniqueExtractPageIds.push(...uniquePageIds);
      const uniqueDeferredPageIds = [];
      const seenDeferred = new Set(uniqueExtractPageIds);
      for (const candidate of deferredPageIds || []) {
        if (typeof candidate !== 'string' || seenDeferred.has(candidate)) continue;
        seenDeferred.add(candidate);
        uniqueDeferredPageIds.push(candidate);
      }
      const session = makeSession('drag', {
        items: Object.freeze((items || []).map((item) => Object.freeze({ ...item }))),
        effectivePageIds: Object.freeze(uniquePageIds),
        extractPageIds: Object.freeze(uniqueExtractPageIds),
        deferredPageIds: Object.freeze(uniqueDeferredPageIds),
        primaryPageId,
        primaryName: typeof primaryName === 'string' && primaryName ? primaryName : 'Untitled',
        pointer: {
          x: Number(pointer?.x) || 0,
          y: Number(pointer?.y) || 0
        },
        destinationParentFolderId: null,
        destinationContainerId: ROOT_CONTAINER_ID
      });
      activeSession = session;
      documentRef?.body?.classList?.add?.(activityClass);
      watchInterruptions(session);
      createDragBubble(session);
      const extraction = extractRows(
        session,
        effectiveDragRows(uniqueExtractPageIds, sourceElement),
        { animate: !prefersReducedMotion() }
      );
      const canonicalContainers = new Map(session.items
        .filter((item) => item?.type === 'page')
        .map((item) => [item.id, containerId(item.sourceParentFolderId)]));
      session.persistentSourceStableIds = new Set(session.extractedRows
        .filter((record) => {
          const pageId = record.element?.dataset?.pageId;
          return canonicalContainers.has(pageId)
            && owningContainerId(record.element) !== canonicalContainers.get(pageId);
        })
        .map((record) => motionElementId(record.element))
        .filter(Boolean));
      trace(session, 'drag-begin', {
        primaryPageId,
        effectivePageCount: uniqueExtractPageIds.length,
        visibleExits: extraction.visibleExits
      });
      positionDragBubble(session, session.pointer.x, session.pointer.y);
      return session;
    }

    function updateDragPointer(session, x, y) {
      if (!session || session !== activeSession || session.kind !== 'drag' || session.cancelled) {
        return false;
      }
      return positionDragBubble(session, x, y);
    }

    async function restoreDrag(session, { reason = 'restore', animate = true } = {}) {
      if (!session || session !== activeSession || session.kind !== 'drag' || session.cancelled) {
        return false;
      }
      trace(session, 'drag-restore-start', { reason });
      const currentFrames = cancelAnimations(session, { preserveCurrent: true });
      const animations = [];
      const shouldAnimate = animate !== false && !prefersReducedMotion();
      for (const record of session.extractedRows) {
        const currentFrame = currentFrames.get(record.element) || collapsedBox();
        restoreInlineStyles(record);
        if (shouldAnimate) {
          animations.push(startAnimation(session, record.element, [currentFrame, record.open], {
            duration: targetDuration,
            easing: LAYOUT_EASING
          }));
        }
      }
      if (session.bubble && shouldAnimate) {
        animations.push(startAnimation(session, session.bubble, [
          { opacity: 0.98 },
          { opacity: 0 }
        ], { duration: Math.min(targetDuration, 120), easing: 'ease-out' }));
      }
      if (shouldAnimate) await waitForAnimations(session, animations, targetDuration);
      if (session.cancelled || activeSession !== session) return false;
      trace(session, 'drag-restore-complete', { reason });
      cleanup(session, { reason });
      return true;
    }

    function handoffDrag(session) {
      if (!session || session !== activeSession || session.kind !== 'drag') return false;
      trace(session, 'drag-handoff');
      removeBubble(session);
      Promise.resolve(restoreDrag(session, { reason: 'preview-handoff' })).catch(() => {
        if (activeSession === session) cleanup(session, { reason: 'preview-handoff-error' });
      });
      return true;
    }

    async function playDragCommitSourcePhase(session, pointerFrames = new Map()) {
      const animations = [];
      for (const record of session.extractedRows) {
        const currentFrame = pointerFrames.get(record.element);
        applyExtractedState(record);
        const currentHeight = Number.parseFloat(currentFrame?.height || '0');
        const currentOpacity = Number.parseFloat(currentFrame?.opacity || '0');
        if (!currentFrame || (currentHeight <= 0.5 && currentOpacity <= 0.02)) continue;
        animations.push(startAnimation(session, record.element, [currentFrame, collapsedBox()], {
          duration: sourceDuration,
          easing: LAYOUT_EASING
        }));
      }
      const rows = [];
      const containers = containerMap();
      const sourceContainerIds = new Set((session.moves || [])
        .map((move) => move.sourceContainerId)
        .filter(Boolean));
      for (const sourceContainerId of sourceContainerIds) {
        const container = containers.get(sourceContainerId);
        if (!container) continue;
        const moveIds = new Set((session.moves || [])
          .filter((move) => move.sourceContainerId === sourceContainerId)
          .map((move) => move.id));
        rows.push(...sourceRowsForMove(container, moveIds));
      }
      trace(session, 'drag-deferred-source-start', {
        pageIds: session.deferredPageIds
      });
      const extraction = extractRows(session, rows, {
        animate: !prefersReducedMotion()
      });
      animations.push(...extraction.animations);
      await waitForAnimations(session, animations, sourceDuration);
      trace(session, 'drag-deferred-source-complete', {
        visibleExits: extraction.visibleExits
      });
      return extraction.visibleExits > 0 || animations.some(Boolean);
    }

    function sourceRowsForMove(container, moveIds) {
      const rows = directRows(container);
      const selected = new Set(rows.filter((row) => moveIds.has(rowId(row))
        || moveIds.has(motionLogicalId(row))));
      const movedPageIds = new Set([...moveIds]
        .filter((id) => id.startsWith('page:'))
        .map((id) => id.slice('page:'.length)));
      for (const row of rows) {
        if (movedPageIds.has(row.dataset?.bindingFollowerOf)) selected.add(row);
      }
      return [...selected];
    }

    function normalizeMutationItems(items) {
      const normalized = [];
      const seen = new Set();
      for (const item of items || []) {
        const id = itemId(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        normalized.push(Object.freeze({ type: item.type, id: item.id, logicalId: id }));
      }
      return Object.freeze(normalized);
    }

    function mutationExitRows(items) {
      const folderElements = items
        .filter((item) => item.type === 'folder')
        .map((item) => folderRow(item.id))
        .filter(Boolean)
        .filter((element, index, elements) => !elements.some((candidate, candidateIndex) => (
          candidateIndex !== index && elementContains(candidate, element)
        )));
      const folderSet = new Set(folderElements);
      const pageIds = new Set(items
        .filter((item) => item.type === 'page')
        .map((item) => item.id));
      const pageElements = [];
      const collect = (element) => {
        if (!pageIds.has(element?.dataset?.pageId)) return;
        if ([...folderSet].some((folderElement) => elementContains(folderElement, element))) return;
        if (visibleRect(element)) pageElements.push(element);
      };
      const currentRoot = rootElement();
      if (currentRoot) {
        collect(currentRoot);
        walkDescendants(currentRoot, collect);
      }
      return [...folderElements, ...pageElements];
    }

    async function playSourcePhase(session, {
      rows = null,
      tracePrefix = 'source',
      traceDetails = null
    } = {}) {
      const sourceRows = Array.isArray(rows) ? rows : [];
      if (!Array.isArray(rows)) {
        const containers = containerMap();
        for (const sourceContainerId of session.sourceContainerIds) {
          const container = containers.get(sourceContainerId);
          if (!container) continue;
          const moveIds = new Set(session.moves
            .filter((move) => move.sourceContainerId === sourceContainerId)
            .map((move) => move.id));
          sourceRows.push(...sourceRowsForMove(container, moveIds));
        }
      }
      trace(session, `${tracePrefix}-start`, traceDetails || {
        sourceContainers: session.sourceContainerIds
      });
      const { animations, visibleExits } = extractRows(session, sourceRows);
      await waitForAnimations(session, animations, sourceDuration);
      trace(session, `${tracePrefix}-complete`, { visibleExits });
      return visibleExits > 0 || animations.some(Boolean);
    }

    function summaryFolderIds(session) {
      const ids = new Set();
      if (session.destinationParentFolderId) ids.add(session.destinationParentFolderId);
      for (const move of session.moves || []) {
        if (move.sourceContainerId?.startsWith('folder:')) {
          ids.add(move.sourceContainerId.slice('folder:'.length));
        }
      }
      return ids;
    }

    function movingLogicalIds(session) {
      const ids = new Set((session.moves || []).map((move) => move.id));
      for (const pageId of session.effectivePageIds || []) ids.add(`page:${pageId}`);
      for (const item of session.items || []) {
        const id = itemId(item);
        if (id) ids.add(id);
      }
      return ids;
    }

    function animateStableLayout(session, before, after, {
      enteringLogicalIds = new Set(),
      restoringStableIds = new Set(),
      suppressEntering = false,
      exclude = new Set(),
      excludeWithin = null,
      enteringContainer = null
    } = {}) {
      const animations = [];
      let enteringRows = 0;
      for (const [id, snapshot] of after) {
        const element = snapshot.element;
        if (exclude.has(element) || (excludeWithin && elementContains(excludeWithin, element))) {
          continue;
        }
        const previous = before.get(id);
        let ownerContainer = element;
        while (ownerContainer && !ownerContainer.dataset?.navigationContainerId) {
          ownerContainer = ownerContainer.parentElement;
        }
        const isDestinationEntry = !enteringContainer || ownerContainer === enteringContainer;
        const isMovedReplacement = isDestinationEntry
          && enteringLogicalIds.has(snapshot.logicalId)
          && (!previous || previous.element !== element);
        const isRestoredProjection = !previous
          && restoringStableIds.has(snapshot.stableId);
        if (isRestoredProjection || (!suppressEntering && (isMovedReplacement || (!previous
          && enteringLogicalIds.has(snapshot.logicalId))))) {
          enteringRows += 1;
          animations.push(startAnimation(session, element, [
            { opacity: 0, transform: 'translate3d(0, -5px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' }
          ], {
            duration: targetDuration,
            easing: LAYOUT_EASING
          }));
          continue;
        }
        if (!previous) continue;
        const deltaX = previous.rect.left - snapshot.rect.left;
        const deltaY = previous.rect.top - snapshot.rect.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
        animations.push(startAnimation(session, element, [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' }
        ], {
          duration: targetDuration,
          easing: LAYOUT_EASING
        }));
      }
      return { animations, enteringRows };
    }

    async function playTargetPhase(session, beforeTarget, {
      tracePrefix = 'target',
      traceDetails = undefined,
      enteringLogicalIds = undefined,
      restoringStableIds = undefined,
      suppressEntering = undefined,
      enteringContainer = undefined,
      exclude = undefined,
      summaryIds = undefined
    } = {}) {
      const destination = containerMap().get(session.destinationContainerId) || null;
      const afterTarget = stableRowSnapshot(rootElement());
      const excluded = exclude || new Set();
      if (exclude === undefined) {
        const destinationSummary = !destination && session.destinationParentFolderId
          ? folderButton(session.destinationParentFolderId)
          : null;
        if (destinationSummary) excluded.add(destinationSummary);
      }
      trace(session, `${tracePrefix}-start`, traceDetails === undefined ? {
        destinationContainer: session.destinationContainerId,
        targetVisible: Boolean(destination)
      } : traceDetails);
      const layout = animateStableLayout(session, beforeTarget, afterTarget, {
        enteringLogicalIds: enteringLogicalIds ?? movingLogicalIds(session),
        restoringStableIds: restoringStableIds
          ?? session.persistentSourceStableIds
          ?? new Set(),
        suppressEntering: suppressEntering ?? !destination,
        enteringContainer: enteringContainer === undefined ? destination : enteringContainer,
        exclude: excluded
      });
      const animations = [...layout.animations];
      for (const folderId of summaryIds ?? summaryFolderIds(session)) {
        const button = folderButton(folderId);
        if (!button) continue;
        animations.push(startAnimation(session, button, [
          { opacity: 0.72, transform: 'scale3d(.995, .995, 1)' },
          { opacity: 1, transform: 'scale3d(1, 1, 1)' }
        ], {
          duration: targetDuration,
          easing: 'ease-out'
        }));
      }
      await waitForAnimations(session, animations, targetDuration);
      trace(session, `${tracePrefix}-complete`, { enteringRows: layout.enteringRows });
    }

    function capture({ items, destinationParentFolderId = null } = {}) {
      if (activeSession || disclosureController?.active) cancel('superseded');
      const moves = normalizeMoveDescriptors(items, destinationParentFolderId);
      if (!moves.length) return null;
      const session = makeSession('move', {
        moves,
        items: Object.freeze((items || []).map((item) => Object.freeze({ ...item }))),
        sourceContainerIds: [...new Set(moves
          .map((move) => move.sourceContainerId)
          .filter(Boolean))],
        destinationParentFolderId: destinationParentFolderId || null,
        destinationContainerId: containerId(destinationParentFolderId)
      });
      trace(session, 'captured', {
        moves: moves.map((move) => move.id),
        destinationContainer: session.destinationContainerId
      });
      return session;
    }

    function captureMutation({ enteringItems = [], exitingItems = [] } = {}) {
      if (activeSession || disclosureController?.active) cancel('superseded-by-mutation');
      const entering = normalizeMutationItems(enteringItems);
      const exiting = normalizeMutationItems(exitingItems);
      if (!entering.length && !exiting.length) return null;
      const session = makeSession('mutation', { entering, exiting });
      trace(session, 'mutation-captured', {
        entering: entering.map((item) => item.logicalId),
        exiting: exiting.map((item) => item.logicalId)
      });
      return session;
    }

    async function playMutation(session, render) {
      if (!session || session.kind !== 'mutation' || typeof render !== 'function') return false;
      if ((activeSession && activeSession !== session) || disclosureController?.active) {
        cancel('superseded-by-mutation');
      }
      installRender(session, render, { required: true });
      if (session.cleaned || session.cancelled) {
        try { invokeRender(session, 'render'); } catch (_error) { return false; }
        return true;
      }
      activeSession = session;
      if (prefersReducedMotion() || !documentRef?.body || !rootElement()) {
        trace(session, 'reduced-motion-render');
        try { invokeRender(session); } finally {
          cleanup(session, { reason: 'reduced-motion' });
        }
        return true;
      }
      documentRef.body.classList?.add?.(activityClass);
      watchInterruptions(session);
      try {
        if (session.exiting.length) {
          await playSourcePhase(session, {
            rows: mutationExitRows(session.exiting),
            tracePrefix: 'mutation-source',
            traceDetails: {
              exiting: session.exiting.map((item) => item.logicalId)
            }
          });
          if (session.cancelled || activeSession !== session) return false;
        }
        const beforeTarget = stableRowSnapshot(rootElement());
        invokeRender(session, 'render');
        if (session.cancelled || activeSession !== session) return false;
        await playTargetPhase(session, beforeTarget, {
          tracePrefix: 'mutation-target',
          traceDetails: null,
          enteringLogicalIds: new Set(session.entering.map((item) => item.logicalId)),
          restoringStableIds: new Set(),
          suppressEntering: false,
          enteringContainer: null,
          exclude: new Set(),
          summaryIds: []
        });
        if (session.cancelled || activeSession !== session) return false;
        cleanup(session, { reason: 'complete' });
        return true;
      } catch (error) {
        try {
          invokeRender(session, session.rendered ? null : 'render');
        } finally {
          cleanup(session, { reason: 'animation-error' });
        }
        trace(session, 'animation-error', { message: error?.message || String(error) });
        return true;
      }
    }

    async function runMoveChoreography(session, sourcePhase) {
      const sourceAnimated = await sourcePhase();
      if (session.cancelled || activeSession !== session) return false;
      if (sourceAnimated && !(await delay(session, phaseGap))) return false;
      const beforeTarget = stableRowSnapshot(rootElement());
      invokeRender(session, 'render');
      if (session.cancelled || activeSession !== session) return false;
      await playTargetPhase(session, beforeTarget);
      if (session.cancelled || activeSession !== session) return false;
      cleanup(session, { reason: 'complete' });
      return true;
    }

    async function play(session, render) {
      if (!session || typeof render !== 'function') return false;
      if ((activeSession && activeSession !== session) || disclosureController?.active) {
        cancel('superseded');
      }
      installRender(session, render, { required: true });
      if (session.cleaned || session.cancelled) {
        try { invokeRender(session, 'render'); } catch (_error) { return false; }
        return true;
      }
      activeSession = session;
      if (prefersReducedMotion() || !documentRef?.body || !rootElement()) {
        trace(session, 'reduced-motion-render');
        try { invokeRender(session); } finally {
          cleanup(session, { reason: 'reduced-motion' });
        }
        return true;
      }
      documentRef.body.classList?.add?.(activityClass);
      watchInterruptions(session);
      try {
        return await runMoveChoreography(session, () => playSourcePhase(session));
      } catch (error) {
        try {
          invokeRender(session, session.rendered ? null : 'render');
        } finally {
          cleanup(session, { reason: 'animation-error' });
        }
        trace(session, 'animation-error', { message: error?.message || String(error) });
        return true;
      }
    }

    async function commitDrag(session, render, { destinationParentFolderId = null } = {}) {
      if (!session || typeof render !== 'function') return false;
      installRender(session, render, { required: true });
      if ((activeSession && activeSession !== session) || disclosureController?.active) {
        cancel('superseded-by-commit');
      }
      if (session.cleaned || session.cancelled) {
        try { invokeRender(session, 'render'); } catch (_error) { return false; }
        return true;
      }
      activeSession = session;
      session.destinationParentFolderId = destinationParentFolderId || null;
      session.destinationContainerId = containerId(destinationParentFolderId);
      session.moves = normalizeMoveDescriptors(session.items, destinationParentFolderId);
      const pointerFrames = cancelAnimations(session, { preserveCurrent: true });
      removeBubble(session);
      if (prefersReducedMotion() || !documentRef?.body || !rootElement()) {
        trace(session, 'reduced-motion-render');
        try { invokeRender(session); } finally {
          cleanup(session, { reason: 'reduced-motion' });
        }
        return true;
      }
      try {
        trace(session, 'drag-commit', {
          destinationContainer: session.destinationContainerId
        });
        return await runMoveChoreography(
          session,
          () => playDragCommitSourcePhase(session, pointerFrames)
        );
      } catch (error) {
        try {
          invokeRender(session, session.rendered ? null : 'render');
        } finally {
          cleanup(session, { reason: 'animation-error' });
        }
        trace(session, 'animation-error', { message: error?.message || String(error) });
        return true;
      }
    }

    async function playDisclosure({ folderId, expanding, render } = {}) {
      if (typeof render !== 'function') return false;
      if (activeSession) cancel('superseded-by-disclosure');
      if (disclosureController) {
        return disclosureController.play({
          disclosureId: folderId,
          expanding,
          render
        });
      }
      try { render(); } catch (_renderError) { return false; }
      return true;
    }

    return Object.freeze({
      beginDrag,
      cancel,
      capture,
      captureMutation,
      commitDrag,
      handoffDrag,
      play,
      playDisclosure,
      playMutation,
      restoreDrag,
      updateDragPointer,
      get active() { return activeSession !== null || disclosureController?.active === true; }
    });
  }

  return Object.freeze({
    DISCLOSURE_DURATION_MS,
    FALLBACK_GRACE_MS,
    PHASE_GAP_MS,
    ROOT_CONTAINER_ID,
    SOURCE_DURATION_MS,
    TARGET_DURATION_MS,
    containerId,
    createCoordinator,
    itemId,
    normalizeMoveDescriptors,
    rowId
  });
}));
