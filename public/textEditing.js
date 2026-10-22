(function exposeTextEditing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.textEditingModel = api;
    api.installImeCompositionOwnership(root.document);
  }
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const NATIVE_EDIT_KEYS = new Set(['a', 'x', 'c', 'v', 'y', 'z']);
  const NATIVE_HISTORY_INPUT_TYPES = new Set([
    'email', 'number', 'password', 'search', 'tel', 'text', 'url'
  ]);
  const imeDocumentStates = new WeakMap();

  function elementFromTarget(target) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  }

  function isEditableTarget(target, activeElement = null) {
    const element = elementFromTarget(target) || elementFromTarget(activeElement);
    if (!element || typeof element.closest !== 'function') return false;
    const editable = element.closest('input, textarea, [contenteditable]');
    if (!editable) return false;
    if (editable.matches?.('[contenteditable="false"]')) return false;
    if (editable.hasAttribute?.('disabled')) return false;
    return true;
  }

  function editableSurface(target, activeElement = null) {
    const element = elementFromTarget(target) || elementFromTarget(activeElement);
    if (!element || typeof element.closest !== 'function') return null;
    const editable = element.closest('input, textarea, [contenteditable]');
    if (!editable || editable.matches?.('[contenteditable="false"]')
      || editable.hasAttribute?.('disabled')) return null;
    return editable;
  }

  function eventDocument(event, target = null, activeElement = null) {
    const element = elementFromTarget(event?.target)
      || elementFromTarget(target)
      || elementFromTarget(activeElement);
    return element?.ownerDocument || event?.view?.document || null;
  }

  function enterLikeKeyEvent(event) {
    if (!event) return false;
    const key = String(event.key || '');
    const code = String(event.code || '');
    return key === 'Enter' || code === 'Enter' || code === 'NumpadEnter'
      || event.keyCode === 13 || event.keyCode === 229;
  }

  function relatedEditableSurface(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    return Boolean(left.contains?.(right) || right.contains?.(left));
  }

  function installImeCompositionOwnership(documentRef) {
    if (!documentRef || typeof documentRef.addEventListener !== 'function') return null;
    const installed = imeDocumentStates.get(documentRef);
    if (installed) return installed.owner;

    const activeSurfaces = new WeakSet();
    const keypressSurfaces = new WeakSet();
    const ownedEvents = new WeakSet();
    const state = {
      activeSurfaces,
      keypressSurfaces,
      ownedEvents,
      heldEnterSurface: null,
      owner: null
    };
    const surfaceFor = (event) => editableSurface(
      event?.target,
      documentRef.activeElement
    );
    const onCompositionStart = (event) => {
      const surface = surfaceFor(event);
      if (surface) activeSurfaces.add(surface);
    };
    const onCompositionEnd = (event) => {
      const surface = surfaceFor(event);
      if (surface) activeSurfaces.delete(surface);
    };
    const onKeyDown = (event) => {
      const surface = surfaceFor(event);
      if (!surface) return;
      const owned = Boolean(event?.isComposing || event?.keyCode === 229
        || activeSurfaces.has(surface));
      if (owned && enterLikeKeyEvent(event)) {
        ownedEvents.add(event);
        if (state.heldEnterSurface && state.heldEnterSurface !== surface) {
          keypressSurfaces.delete(state.heldEnterSurface);
        }
        state.heldEnterSurface = surface;
        keypressSurfaces.add(surface);
      } else if (!owned) {
        // A later physical keypress is an exact lifecycle boundary if Chromium
        // omitted the preceding keyup while an editable surface was replaced.
        if (state.heldEnterSurface) keypressSurfaces.delete(state.heldEnterSurface);
        state.heldEnterSurface = null;
        keypressSurfaces.delete(surface);
      }
    };
    const onKeyUp = (event) => {
      if (!enterLikeKeyEvent(event)) return;
      const surface = surfaceFor(event);
      if (state.heldEnterSurface) keypressSurfaces.delete(state.heldEnterSurface);
      state.heldEnterSurface = null;
      if (surface) keypressSurfaces.delete(surface);
    };
    const onBlur = (event) => {
      const surface = editableSurface(event?.target);
      if (surface) activeSurfaces.delete(surface);
    };

    documentRef.addEventListener('compositionstart', onCompositionStart, true);
    documentRef.addEventListener('compositionend', onCompositionEnd, true);
    documentRef.addEventListener('keydown', onKeyDown, true);
    documentRef.addEventListener('keyup', onKeyUp, true);
    documentRef.addEventListener('blur', onBlur, true);

    const owner = Object.freeze({
      dispose() {
        documentRef.removeEventListener?.('compositionstart', onCompositionStart, true);
        documentRef.removeEventListener?.('compositionend', onCompositionEnd, true);
        documentRef.removeEventListener?.('keydown', onKeyDown, true);
        documentRef.removeEventListener?.('keyup', onKeyUp, true);
        documentRef.removeEventListener?.('blur', onBlur, true);
        state.heldEnterSurface = null;
        imeDocumentStates.delete(documentRef);
      }
    });
    state.owner = owner;
    imeDocumentStates.set(documentRef, state);
    return owner;
  }

  function isImeCompositionOwnedKeyEvent(
    event,
    target = null,
    activeElement = null,
    lifecycleActive = false
  ) {
    if (!event) return false;
    const inputType = String(event.inputType || '');
    if (inputType && inputType !== 'insertParagraph' && inputType !== 'insertLineBreak') {
      return false;
    }
    if (!inputType && !enterLikeKeyEvent(event)) return false;
    if (lifecycleActive) return true;
    const documentRef = eventDocument(event, target, activeElement);
    const state = documentRef ? imeDocumentStates.get(documentRef) : null;
    if (state?.ownedEvents.has(event)) return true;
    const surface = editableSurface(
      event.target || target,
      activeElement || documentRef?.activeElement
    );
    if (surface && (state?.activeSurfaces.has(surface)
      || state?.keypressSurfaces.has(surface)
      || relatedEditableSurface(surface, state?.heldEnterSurface))) return true;
    return Boolean(event.isComposing || event.keyCode === 229);
  }

  function isNativeEditingShortcut(event) {
    if (!event || (!event.metaKey && !event.ctrlKey) || event.altKey) return false;
    return NATIVE_EDIT_KEYS.has(String(event.key || '').toLowerCase());
  }

  function nativeHistoryDirection(event) {
    if (!event || event.isComposing || event.keyCode === 229
      || (!event.metaKey && !event.ctrlKey) || event.altKey) return null;
    const key = String(event.key || '').toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
    return null;
  }

  function nativeHistoryControl(target, activeElement = null) {
    const element = elementFromTarget(target) || elementFromTarget(activeElement);
    if (!element || typeof element.closest !== 'function') return null;
    const control = element.closest('input, textarea');
    if (!control || control.hasAttribute?.('disabled') || control.hasAttribute?.('readonly')) {
      return null;
    }
    if (String(control.tagName || '').toLowerCase() === 'textarea') return control;
    const type = String(control.type || control.getAttribute?.('type') || 'text').toLowerCase();
    return NATIVE_HISTORY_INPUT_TYPES.has(type) ? control : null;
  }

  function handleNativeInputHistoryShortcut(event, activeElement = null, execute = null) {
    const direction = nativeHistoryDirection(event);
    const control = direction ? nativeHistoryControl(event.target, activeElement) : null;
    if (!direction || !control) return false;
    event.preventDefault?.();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation?.();
    const run = typeof execute === 'function'
      ? execute
      : control.ownerDocument?.execCommand?.bind(control.ownerDocument);
    try {
      run?.(direction);
    } catch {
      // The shortcut is still consumed so Electron's menu role cannot blur the editor.
    }
    return true;
  }

  function shouldPreserveNativeEditing(event, activeElement = null) {
    if (!event) return false;
    if ((event.isComposing || event.keyCode === 229)
      && isEditableTarget(event.target, activeElement)) return true;
    if (isImeCompositionOwnedKeyEvent(event, event.target, activeElement)) {
      return isEditableTarget(event.target, activeElement);
    }
    return isNativeEditingShortcut(event) && isEditableTarget(event.target, activeElement);
  }

  return Object.freeze({
    isEditableTarget,
    installImeCompositionOwnership,
    isImeCompositionOwnedKeyEvent,
    isNativeEditingShortcut,
    nativeHistoryDirection,
    handleNativeInputHistoryShortcut,
    shouldPreserveNativeEditing
  });
}));
