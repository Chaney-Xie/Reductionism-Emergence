(function exposeDisclosureMotion(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.disclosureMotionModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DISCLOSURE_DURATION_MS = 176;
  const LAYOUT_DURATION_MS = 168;
  const FALLBACK_GRACE_MS = 80;
  const EASING = 'cubic-bezier(.2, .75, .25, 1)';
  const ANIMATED_ELEMENT_CLASS = 'is-disclosure-motion-animated-row';

  function childElements(element) {
    return [...(element?.children || [])];
  }

  function walkDescendants(element, visit) {
    for (const child of childElements(element)) {
      visit(child);
      walkDescendants(child, visit);
    }
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

  function defaultStableId(element) {
    return element?.dataset?.disclosureMotionId
      || element?.dataset?.sidebarMotionId
      || null;
  }

  function stableSnapshot(scope, resolveStableId = defaultStableId) {
    const snapshots = new Map();
    const occurrences = new Map();
    const collect = (element) => {
      const stableId = resolveStableId(element);
      const rect = stableId ? visibleRect(element) : null;
      if (!stableId || !rect) return;
      const occurrence = occurrences.get(stableId) || 0;
      occurrences.set(stableId, occurrence + 1);
      const id = occurrence === 0 ? stableId : `${stableId}#${occurrence}`;
      snapshots.set(id, { id, stableId, element, rect });
    };
    if (scope) {
      collect(scope);
      walkDescendants(scope, collect);
    }
    return snapshots;
  }

  function createController({
    root,
    documentRef = typeof document !== 'undefined' ? document : null,
    windowRef = typeof window !== 'undefined' ? window : null,
    onTrace = null,
    activityClass = 'is-disclosure-motion-animating',
    visibilityClass = null,
    resolveRegion = null,
    resolveStableId = defaultStableId,
    nextSessionId = null,
    duration = DISCLOSURE_DURATION_MS,
    layoutDuration = LAYOUT_DURATION_MS,
    easing = EASING
  } = {}) {
    let sequence = 0;
    let activeSession = null;

    const rootElement = () => (typeof root === 'function' ? root() : root) || null;
    const timerHost = windowRef || globalThis;

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

    function makeSession(disclosureId, expanding) {
      return {
        id: typeof nextSessionId === 'function' ? nextSessionId() : ++sequence,
        disclosureId,
        expanding: expanding === true,
        animations: new Set(),
        animatedElements: new Set(),
        timers: new Map(),
        cancelled: false,
        cleaned: false,
        render: null,
        rendered: false,
        renderRequired: false,
        visibilityObserver: null,
        resizeObserver: null,
        observedRootWidth: null,
        resizeObservationReady: false,
        resizeHandler: null
      };
    }

    function installRender(session, render) {
      session.render = () => {
        if (session.rendered) return false;
        session.rendered = true;
        render();
        return true;
      };
      session.renderRequired = true;
    }

    function invokeRender(session, phase = null) {
      if (!session?.render || session.rendered) return false;
      if (phase) trace(session, phase);
      return session.render();
    }

    function clearTimer(session, timerId) {
      const finish = session?.timers?.get(timerId);
      if (!finish) return;
      timerHost?.clearTimeout?.(timerId);
      session.timers.delete(timerId);
      finish(false);
    }

    function startAnimation(session, element, keyframes, options) {
      if (session.cancelled || !element?.animate) return null;
      element.classList?.add?.(ANIMATED_ELEMENT_CLASS);
      let animation = null;
      try {
        animation = element.animate(keyframes, options);
      } catch (_error) {
        element.classList?.remove?.(ANIMATED_ELEMENT_CLASS);
        return null;
      }
      session.animations.add(animation);
      session.animatedElements.add(element);
      Promise.resolve(animation.finished).catch(() => {}).finally(() => {
        element.classList?.remove?.(ANIMATED_ELEMENT_CLASS);
        session.animatedElements.delete(element);
      });
      return animation;
    }

    async function waitForAnimations(session, animations) {
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

    function cancelAnimations(session) {
      for (const animation of session.animations) {
        try { animation.cancel?.(); } catch (_error) { /* Presentation cleanup is best-effort. */ }
      }
      session.animations.clear();
      for (const element of session.animatedElements) {
        element.classList?.remove?.(ANIMATED_ELEMENT_CLASS);
      }
      session.animatedElements.clear();
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
      documentRef?.body?.classList?.remove?.(activityClass);
      if (activeSession === session) activeSession = null;
      trace(session, 'cleanup', { reason });
    }

    function cancel(reason = 'interrupted') {
      const session = activeSession;
      if (!session) return false;
      session.cancelled = true;
      cleanup(session, { reason, ensureRender: true });
      return true;
    }

    function interrupt(session, reason) {
      if (!session || activeSession !== session) return false;
      return cancel(reason);
    }

    function watchInterruptions(session) {
      const Observer = windowRef?.MutationObserver;
      if (Observer && documentRef?.body && visibilityClass) {
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

    function resolvedRegion(disclosureId) {
      if (typeof resolveRegion !== 'function') return null;
      return resolveRegion(disclosureId, rootElement()) || null;
    }

    function animateStableLayout(session, before, after, excludedRegion) {
      const animations = [];
      for (const [id, snapshot] of after) {
        const element = snapshot.element;
        if (excludedRegion && elementContains(excludedRegion, element)) continue;
        const previous = before.get(id);
        if (!previous) continue;
        const deltaX = previous.rect.left - snapshot.rect.left;
        const deltaY = previous.rect.top - snapshot.rect.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
        animations.push(startAnimation(session, element, [{
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`
        }, {
          transform: 'translate3d(0, 0, 0)'
        }], {
          duration: layoutDuration,
          easing
        }));
      }
      return animations;
    }

    async function play({ disclosureId, expanding, render } = {}) {
      if (typeof render !== 'function') return false;
      let session = null;
      try {
        if (activeSession) cancel('superseded-by-disclosure');
        session = makeSession(disclosureId, expanding);
        installRender(session, render);
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
        trace(session, 'disclosure-start', {
          disclosureId,
          expanding: session.expanding
        });
        if (session.expanding) {
          const before = stableSnapshot(rootElement(), resolveStableId);
          invokeRender(session, 'render');
          if (session.cancelled || activeSession !== session) return false;
          const region = resolvedRegion(disclosureId);
          const after = stableSnapshot(rootElement(), resolveStableId);
          const animations = animateStableLayout(session, before, after, region);
          if (region) {
            animations.push(startAnimation(session, region, [{
              clipPath: 'inset(0 0 100% 0)',
              opacity: 0,
              transform: 'translate3d(0, -4px, 0)'
            }, {
              clipPath: 'inset(0 0 0 0)',
              opacity: 1,
              transform: 'translate3d(0, 0, 0)'
            }], {
              duration,
              easing
            }));
          }
          await waitForAnimations(session, animations);
        } else {
          const region = resolvedRegion(disclosureId);
          const rect = visibleRect(region);
          const animations = [];
          if (region && rect) {
            const computed = windowRef?.getComputedStyle?.(region) || {};
            animations.push(startAnimation(session, region, [{
              boxSizing: 'border-box',
              height: `${rect.height}px`,
              marginTop: computed.marginTop || '0px',
              paddingTop: computed.paddingTop || '0px',
              paddingBottom: computed.paddingBottom || '0px',
              clipPath: 'inset(0 0 0 0)',
              opacity: 1
            }, {
              boxSizing: 'border-box',
              height: '0px',
              marginTop: '0px',
              paddingTop: '0px',
              paddingBottom: '0px',
              clipPath: 'inset(0 0 100% 0)',
              opacity: 0
            }], {
              duration,
              easing,
              fill: 'both'
            }));
          }
          await waitForAnimations(session, animations);
          invokeRender(session, 'render');
        }
        if (session.cancelled || activeSession !== session) return false;
        trace(session, 'disclosure-complete', {
          disclosureId,
          expanding: session.expanding
        });
        cleanup(session, { reason: 'complete' });
        return true;
      } catch (error) {
        if (session) {
          try {
            invokeRender(session, session.rendered ? null : 'render');
          } catch (_renderError) { /* The visual promise must remain non-rejecting. */ }
          trace(session, 'animation-error', { message: error?.message || String(error) });
          cleanup(session, { reason: 'animation-error' });
        } else {
          try { render(); } catch (_renderError) { /* Keep disclosure visual-only. */ }
        }
        return false;
      }
    }

    function destroy(reason = 'owner-destroyed') {
      return cancel(reason);
    }

    return Object.freeze({
      cancel,
      destroy,
      play,
      get active() { return activeSession !== null; }
    });
  }

  return Object.freeze({
    ANIMATED_ELEMENT_CLASS,
    DISCLOSURE_DURATION_MS,
    EASING,
    FALLBACK_GRACE_MS,
    LAYOUT_DURATION_MS,
    createController
  });
}));
