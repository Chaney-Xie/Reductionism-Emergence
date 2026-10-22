/* Horizontal sidebar resizing. Width state intentionally remains session-local,
 * matching the existing expanded/collapsed sidebar state. */
const leftSidebarResizeHandle = document.querySelector('#left-sidebar-resize-handle');
const rightSidebarResizeHandle = document.querySelector('#right-sidebar-resize-handle');
const sidebarLayoutRoot = document.documentElement;

let activeSidebarResize = null;
let sidebarMotionActivationPending = false;
let sidebarViewportReconcileReleaseFrame = 0;

function sidebarIsOpen(side) {
  return side === 'right' ? rightSidebarOpen : leftSidebarOpen;
}

function sidebarRememberedWidth(side) {
  return side === 'right' ? rightSidebarExpandedWidth : leftSidebarExpandedWidth;
}

function setSidebarRememberedWidth(side, width) {
  if (side === 'right') rightSidebarExpandedWidth = width;
  else leftSidebarExpandedWidth = width;
}

function otherSidebarActiveWidth(side) {
  if (side === 'right') return leftSidebarOpen ? leftSidebarExpandedWidth : 0;
  return rightSidebarOpen ? rightSidebarExpandedWidth : 0;
}

function sidebarViewportWidth() {
  return window.innerWidth || document.documentElement.clientWidth;
}

function sidebarResizeHandle(side) {
  return side === 'right' ? rightSidebarResizeHandle : leftSidebarResizeHandle;
}

function applySidebarExpandedWidth(side, requestedWidth) {
  const width = sidebarResizeModel.clampExpandedWidth(requestedWidth, {
    viewportWidth: sidebarViewportWidth(),
    otherSidebarWidth: otherSidebarActiveWidth(side)
  });
  const property = side === 'right' ? '--right-sidebar-width' : '--left-sidebar-width';
  const handle = sidebarResizeHandle(side);

  setSidebarRememberedWidth(side, width);
  sidebarLayoutRoot.style.setProperty(property, `${width}px`);
  handle?.setAttribute('aria-valuemin', String(sidebarResizeModel.MIN_EXPANDED_WIDTH));
  handle?.setAttribute('aria-valuemax', String(sidebarResizeModel.maximumExpandedWidth(
    sidebarViewportWidth(),
    otherSidebarActiveWidth(side)
  )));
  handle?.setAttribute('aria-valuenow', String(width));
  if (typeof scheduleWorkspaceStateSave === 'function') scheduleWorkspaceStateSave();
  return width;
}

function restoreSidebarExpandedWidth(side) {
  return applySidebarExpandedWidth(side, sidebarRememberedWidth(side));
}

function enableSidebarMotionAfterRestore() {
  if (document.body.classList.contains('sidebar-motion-ready') || sidebarMotionActivationPending) {
    return;
  }
  sidebarMotionActivationPending = true;
  const scheduleFrame = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (callback) => callback();
  scheduleFrame(() => scheduleFrame(() => {
    sidebarMotionActivationPending = false;
    document.body.classList.add('sidebar-motion-ready');
  }));
}

function reconcileSidebarWidthsToViewport() {
  if (sidebarViewportReconcileReleaseFrame
    && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(sidebarViewportReconcileReleaseFrame);
    sidebarViewportReconcileReleaseFrame = 0;
  }
  document.body.classList.add('sidebar-viewport-reconciling');
  if (leftSidebarOpen) restoreSidebarExpandedWidth('left');
  if (rightSidebarOpen) restoreSidebarExpandedWidth('right');
  // A viewport resize is already an external geometry discontinuity. Commit
  // newly clamped endpoints in the same layout pass so an in-flight custom
  // property transition cannot temporarily push the opposite edge offscreen.
  void document.body.offsetWidth;
  if (typeof window.requestAnimationFrame !== 'function') {
    document.body.classList.remove('sidebar-viewport-reconciling');
    return;
  }
  sidebarViewportReconcileReleaseFrame = window.requestAnimationFrame(() => {
    sidebarViewportReconcileReleaseFrame = 0;
    document.body.classList.remove('sidebar-viewport-reconciling');
  });
}

function finishSidebarResize() {
  if (!activeSidebarResize) return;
  const { handle, pointerId } = activeSidebarResize;
  activeSidebarResize = null;

  window.removeEventListener('pointermove', handleSidebarResizePointerMove);
  window.removeEventListener('pointerup', finishSidebarResize);
  window.removeEventListener('pointercancel', finishSidebarResize);
  document.body.classList.remove('sidebar-horizontal-resizing');
  delete document.body.dataset.sidebarResizeSide;

  if (handle?.hasPointerCapture?.(pointerId)) {
    try {
      handle.releasePointerCapture(pointerId);
    } catch (_error) {
      // The browser may already have released capture after pointer cancellation.
    }
  }
}

function collapseSidebarFromResize(side) {
  finishSidebarResize();
  if (side === 'right') setRightSidebarOpen(false);
  else setLeftSidebarOpen(false);
}

function handleSidebarResizePointerMove(event) {
  if (!activeSidebarResize || event.pointerId !== activeSidebarResize.pointerId) return;
  event.preventDefault();

  const { side } = activeSidebarResize;
  const viewportWidth = sidebarViewportWidth();
  if (sidebarResizeModel.pointerReachedOuterEdge(side, event.clientX, viewportWidth)) {
    collapseSidebarFromResize(side);
    return;
  }

  applySidebarExpandedWidth(
    side,
    sidebarResizeModel.pointerWidth(side, event.clientX, viewportWidth)
  );
}

function startSidebarResize(side, event) {
  if (event.button !== 0 || !sidebarIsOpen(side)) return;
  event.preventDefault();

  finishSidebarResize();
  const handle = event.currentTarget;
  activeSidebarResize = { handle, pointerId: event.pointerId, side };
  document.body.classList.add('sidebar-horizontal-resizing');
  document.body.dataset.sidebarResizeSide = side;
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', handleSidebarResizePointerMove, { passive: false });
  window.addEventListener('pointerup', finishSidebarResize);
  window.addEventListener('pointercancel', finishSidebarResize);
}

leftSidebarResizeHandle?.addEventListener('pointerdown', (event) => {
  startSidebarResize('left', event);
});
rightSidebarResizeHandle?.addEventListener('pointerdown', (event) => {
  startSidebarResize('right', event);
});
// Resize events are delivered before the next paint. Reconcile immediately so
// an in-flight Sidebar target cannot survive into that paint and overrun the
// newly narrower viewport.
window.addEventListener('resize', reconcileSidebarWidthsToViewport);

restoreSidebarExpandedWidth('left');
restoreSidebarExpandedWidth('right');
