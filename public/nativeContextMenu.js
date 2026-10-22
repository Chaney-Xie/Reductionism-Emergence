(function exposeNativeContextMenu(globalObject) {
  const TEXT_INPUT_TYPES = new Set([
    'email', 'number', 'password', 'search', 'tel', 'text', 'url'
  ]);
  const CONTEXT_DESCRIPTOR_MAX_AGE_MS = 2000;
  const hnTextContextEvents = new WeakSet();
  let latestTextContext = null;
  let nextLookUpSelectionToken = 1;
  let activeLookUpSelection = null;

  function available() {
    return typeof globalObject.cneDesktop?.showContextMenu === 'function';
  }

  async function open(event, context) {
    if (!available()) return null;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    try {
      const result = await globalObject.cneDesktop.showContextMenu(context);
      return typeof result?.commandId === 'string' ? result.commandId : null;
    } catch (error) {
      console.error('[native-context-menu]', error);
      return null;
    }
  }

  function elementFromTarget(target) {
    if (!target) return null;
    return target.nodeType === 1 ? target : target.parentElement || null;
  }

  function textControlForTarget(target) {
    const element = elementFromTarget(target);
    const control = element?.closest?.('input, textarea');
    if (!control) return null;
    const tag = String(control.tagName || '').toLowerCase();
    if (tag === 'textarea') return control;
    const type = String(control.type || control.getAttribute?.('type') || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type) ? control : null;
  }

  function controlIsEditable(control) {
    return Boolean(control
      && !control.hasAttribute?.('disabled')
      && !control.hasAttribute?.('readonly'));
  }

  function controlHasSelection(control) {
    if (!control || !Number.isInteger(control.selectionStart)
      || !Number.isInteger(control.selectionEnd)) return false;
    return control.selectionStart !== control.selectionEnd;
  }

  function contentEditableOwner(target) {
    const element = elementFromTarget(target);
    const owner = element?.closest?.('[contenteditable]');
    if (!owner) return null;
    const value = String(owner.getAttribute?.('contenteditable') || '').toLowerCase();
    return {
      element: owner,
      editable: value !== 'false' && !owner.hasAttribute?.('disabled')
    };
  }

  function caretPointFromClient(x, y) {
    const documentObject = globalObject.document;
    if (!documentObject || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (typeof documentObject.caretPositionFromPoint === 'function') {
      const position = documentObject.caretPositionFromPoint(x, y);
      if (position?.offsetNode) return { node: position.offsetNode, offset: position.offset };
    }
    if (typeof documentObject.caretRangeFromPoint === 'function') {
      const range = documentObject.caretRangeFromPoint(x, y);
      if (range?.startContainer) {
        return { node: range.startContainer, offset: range.startOffset };
      }
    }
    return null;
  }

  function rangeContainsPoint(range, point) {
    if (!range || !point?.node) return false;
    try {
      if (typeof range.isPointInRange === 'function'
        && range.isPointInRange(point.node, point.offset)) return true;
    } catch {
      // Fall through to visual range rectangles.
    }
    return false;
  }

  function rectangleContainsPoint(rectangle, x, y) {
    if (!rectangle || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tolerance = 1;
    return x >= rectangle.left - tolerance && x <= rectangle.right + tolerance
      && y >= rectangle.top - tolerance && y <= rectangle.bottom + tolerance;
  }

  function rangeIntersectsElement(range, element) {
    if (!range || !element) return false;
    try {
      return typeof range.intersectsNode === 'function' && range.intersectsNode(element);
    } catch {
      return false;
    }
  }

  function browserSelectionOwnsContext(target, x, y, { keyboard = false } = {}) {
    const selection = globalObject.getSelection?.();
    const element = elementFromTarget(target);
    if (!selection || selection.isCollapsed || selection.rangeCount < 1
      || String(selection).length === 0 || !element) return false;
    const point = keyboard ? null : caretPointFromClient(x, y);
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt?.(index);
      if (!range || !rangeIntersectsElement(range, element)) continue;
      if (keyboard) return true;
      const rectangles = Array.from(range.getClientRects?.() || []);
      if (rectangles.some((rectangle) => rectangleContainsPoint(rectangle, x, y))) return true;
      // Chromium may snap caretPositionFromPoint() from table padding or the
      // unselected part of a block to the nearest selected caret. A real
      // selection has visual rectangles, so those rectangles are the exact
      // pointer-ownership contract. The caret fallback is reserved for
      // platform ranges that expose no geometry at all.
      if (rectangles.length === 0 && rangeContainsPoint(range, point)) return true;
    }
    return false;
  }

  function markdownCapabilities(target) {
    const describe = globalObject.markdownPageView?.textContextMenuCapabilities;
    if (typeof describe !== 'function') return null;
    try {
      const capabilities = describe(target);
      return capabilities && typeof capabilities === 'object' ? capabilities : null;
    } catch {
      return null;
    }
  }

  function classifyTextContext(target, facts = {}) {
    const element = elementFromTarget(target);
    if (!element) return { textOwned: false };
    const control = textControlForTarget(element);
    const contentEditable = contentEditableOwner(element);
    const editable = control
      ? controlIsEditable(control)
      : contentEditable?.editable === true;
    const keyboard = facts.menuSourceType === 'keyboard';
    const selected = controlHasSelection(control)
      || browserSelectionOwnsContext(element, facts.x, facts.y, { keyboard });
    const markdownTableCell = element.closest?.('[data-markdown-editable-table-cell]');
    const tableStructuralRegion = Boolean(
      markdownTableCell && element === markdownTableCell && !selected
    );
    const textOwned = !tableStructuralRegion && (editable || selected);
    if (!textOwned) return { textOwned: false };

    const markdownBody = element.closest?.('.markdown-page-body');
    const hnEditor = element.closest?.('.hn-source-editor');
    const owner = markdownBody
      ? 'markdown'
      : hnEditor
        ? 'cne'
        : editable
          ? 'ordinary'
          : 'read-only';
    const descriptor = { textOwned: true, owner, editable };
    if (owner === 'markdown') {
      const capabilities = markdownCapabilities(element);
      for (const name of ['editable', 'canCut', 'canCopy', 'canPaste']) {
        if (typeof capabilities?.[name] === 'boolean') descriptor[name] = capabilities[name];
      }
    }
    return descriptor;
  }

  function contextEventFacts(event) {
    const x = Number.isFinite(event?.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event?.clientY) ? event.clientY : 0;
    const pointerContext = event?.button === 2
      || (event?.button === 0 && event?.ctrlKey === true)
      || x !== 0
      || y !== 0;
    return {
      x,
      y,
      menuSourceType: pointerContext ? 'mouse' : 'keyboard'
    };
  }

  function connected(value) {
    return Boolean(value
      && value.isConnected !== false
      && (!value.ownerDocument || value.ownerDocument === globalObject.document));
  }

  function browserRangeSelectionContract(target) {
    const selection = globalObject.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount < 1
      || !selection.anchorNode || !selection.focusNode) return null;
    const anchorNode = selection.anchorNode;
    const anchorOffset = selection.anchorOffset;
    const focusNode = selection.focusNode;
    const focusOffset = selection.focusOffset;
    const orderedRange = selection.getRangeAt?.(0)?.cloneRange?.() || null;
    const focusOwner = elementFromTarget(target)
      ?.closest?.('[contenteditable],.markdown-page-body') || null;
    return Object.freeze({
      restore() {
        if (!connected(anchorNode) || !connected(focusNode)) return false;
        focusOwner?.focus?.({ preventScroll: true });
        const current = globalObject.getSelection?.();
        if (!current) return false;
        try {
          if (typeof current.setBaseAndExtent === 'function') {
            current.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
          } else if (typeof current.collapse === 'function'
            && typeof current.extend === 'function') {
            current.removeAllRanges?.();
            current.collapse(anchorNode, anchorOffset);
            current.extend(focusNode, focusOffset);
          } else {
            const range = orderedRange?.cloneRange?.()
              || globalObject.document?.createRange?.();
            if (!range) return false;
            if (!orderedRange) {
              range.setStart(anchorNode, anchorOffset);
              range.setEnd(focusNode, focusOffset);
            }
            current.removeAllRanges();
            current.addRange(range);
          }
        } catch {
          return false;
        }
        return current.isCollapsed === false;
      }
    });
  }

  function lookUpSelectionContract(target, descriptor) {
    if (!descriptor?.textOwned) return null;
    const element = elementFromTarget(target);
    if (!element) return null;
    const control = textControlForTarget(element);
    if (controlHasSelection(control)) {
      const start = control.selectionStart;
      const end = control.selectionEnd;
      const direction = control.selectionDirection || 'none';
      return Object.freeze({
        restore() {
          if (!connected(control) || typeof control.setSelectionRange !== 'function') return false;
          control.focus?.({ preventScroll: true });
          try {
            control.setSelectionRange(start, end, direction);
          } catch {
            return false;
          }
          return control.selectionStart === start && control.selectionEnd === end;
        }
      });
    }
    if (descriptor.owner === 'cne') {
      const claim = globalObject.hnTextPageView?.captureHnTextSelection;
      const restore = globalObject.hnTextPageView?.reassertHnTextSelection;
      if (typeof claim !== 'function' || typeof restore !== 'function') return null;
      return Object.freeze({
        claim() {
          return connected(element) && claim(element) === true;
        },
        restore() {
          return connected(element) && restore(element) === true;
        }
      });
    }
    const markdownBody = element.closest?.('.markdown-page-body');
    const captureMarkdown = globalObject.markdownPageView?.editableSelection;
    const restoreMarkdown = globalObject.markdownPageView?.restoreEditableSelection;
    if (markdownBody && typeof captureMarkdown === 'function'
      && typeof restoreMarkdown === 'function') {
      const selection = captureMarkdown(markdownBody);
      if (selection && selection.anchor?.offset !== selection.focus?.offset) {
        return Object.freeze({
          restore() {
            if (!connected(markdownBody)) return false;
            markdownBody.focus?.({ preventScroll: true });
            return restoreMarkdown(markdownBody, selection) === true;
          }
        });
      }
    }
    return browserRangeSelectionContract(element);
  }

  function releaseActiveLookUpSelection(token = null) {
    if (!activeLookUpSelection
      || (token !== null && activeLookUpSelection.token !== token)) return false;
    const releasedToken = activeLookUpSelection.token;
    if (activeLookUpSelection.expiryTimer !== null) {
      globalObject.clearTimeout?.(activeLookUpSelection.expiryTimer);
    }
    activeLookUpSelection = null;
    if (latestTextContext?.descriptor?.lookUpSelectionToken === releasedToken) {
      const { lookUpSelectionToken, ...retiredDescriptor } = latestTextContext.descriptor;
      latestTextContext.descriptor = retiredDescriptor;
    }
    return true;
  }

  function rememberLookUpSelection(target, descriptor) {
    releaseActiveLookUpSelection();
    const contract = lookUpSelectionContract(target, descriptor);
    if (!contract) return descriptor;
    const token = nextLookUpSelectionToken;
    nextLookUpSelectionToken = token >= Number.MAX_SAFE_INTEGER ? 1 : token + 1;
    const expiryTimer = typeof globalObject.setTimeout === 'function'
      ? globalObject.setTimeout(() => {
          if (activeLookUpSelection?.token === token
            && activeLookUpSelection.state === 'offered') {
            releaseActiveLookUpSelection(token);
          }
        }, CONTEXT_DESCRIPTOR_MAX_AGE_MS)
      : null;
    activeLookUpSelection = { token, contract, state: 'offered', expiryTimer };
    return { ...descriptor, lookUpSelectionToken: token };
  }

  function claimLookUpSelection(token) {
    if (!Number.isSafeInteger(token) || token < 1
      || activeLookUpSelection?.token !== token
      || activeLookUpSelection.state !== 'offered') return false;
    try {
      if (typeof activeLookUpSelection.contract.claim === 'function'
        && activeLookUpSelection.contract.claim() !== true) {
        releaseActiveLookUpSelection(token);
        return false;
      }
    } catch {
      releaseActiveLookUpSelection(token);
      return false;
    }
    activeLookUpSelection.state = 'claimed';
    if (activeLookUpSelection.expiryTimer !== null) {
      globalObject.clearTimeout?.(activeLookUpSelection.expiryTimer);
      activeLookUpSelection.expiryTimer = null;
    }
    if (latestTextContext?.descriptor?.lookUpSelectionToken === token) {
      const { lookUpSelectionToken, ...retiredDescriptor } = latestTextContext.descriptor;
      latestTextContext.descriptor = retiredDescriptor;
    }
    return true;
  }

  function restoreLookUpSelection(token) {
    if (!Number.isSafeInteger(token) || token < 1
      || activeLookUpSelection?.token !== token
      || activeLookUpSelection.state !== 'claimed') return false;
    const contract = activeLookUpSelection.contract;
    releaseActiveLookUpSelection(token);
    try {
      return contract.restore() === true;
    } catch {
      return false;
    }
  }

  function releaseLookUpSelection(token) {
    return Number.isSafeInteger(token) && token > 0
      ? releaseActiveLookUpSelection(token)
      : false;
  }

  function rememberTextContext(event, descriptor) {
    const facts = contextEventFacts(event);
    const retainedDescriptor = rememberLookUpSelection(event?.target, descriptor);
    latestTextContext = {
      createdAt: Date.now(),
      x: facts.x,
      y: facts.y,
      menuSourceType: facts.menuSourceType,
      descriptor: retainedDescriptor
    };
  }

  function recentDescriptorForFacts(facts) {
    if (!latestTextContext) return null;
    if (Date.now() - latestTextContext.createdAt > CONTEXT_DESCRIPTOR_MAX_AGE_MS) {
      if (activeLookUpSelection?.state !== 'claimed') releaseActiveLookUpSelection();
      latestTextContext = null;
      return null;
    }
    if (facts.menuSourceType === 'keyboard' || latestTextContext.menuSourceType === 'keyboard') {
      return latestTextContext.descriptor;
    }
    const x = Number.isFinite(facts.x) ? facts.x : 0;
    const y = Number.isFinite(facts.y) ? facts.y : 0;
    return Math.abs(latestTextContext.x - x) <= 3
      && Math.abs(latestTextContext.y - y) <= 3
      ? latestTextContext.descriptor
      : null;
  }

  function describeTextContextMenu(facts = {}) {
    const recent = recentDescriptorForFacts(facts);
    if (recent) return recent;
    const documentObject = globalObject.document;
    const target = Number.isFinite(facts.x) && Number.isFinite(facts.y)
      ? documentObject?.elementFromPoint?.(facts.x, facts.y)
      : null;
    return classifyTextContext(target || documentObject?.activeElement, facts);
  }

  function ownsTextContextEvent(event) {
    return Boolean(event && hnTextContextEvents.has(event));
  }

  globalObject.addEventListener?.('pagehide', () => {
    latestTextContext = null;
    releaseActiveLookUpSelection();
  });

  globalObject.document?.addEventListener?.('contextmenu', (event) => {
    const facts = contextEventFacts(event);
    const descriptor = classifyTextContext(event.target, facts);
    rememberTextContext(event, descriptor);
    if (descriptor.suppress) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }
    if (!descriptor.textOwned) return;
    if (descriptor.owner === 'cne') {
      // Settle the source editor's pending composition before Chromium builds
      // its native clipboard roles. The canonical source session remains the
      // only mutation owner; the enclosing Canvas domain menu yields.
      globalObject.hnTextPageView?.commitFocusedHnTextEditor?.(event.target);
      hnTextContextEvents.add(event);
      return;
    }
    event.stopImmediatePropagation?.();
  }, true);

  globalObject.nativeContextMenu = Object.freeze({
    available,
    open,
    classifyTextContext,
    describeTextContextMenu,
    claimLookUpSelection,
    restoreLookUpSelection,
    releaseLookUpSelection,
    ownsTextContextEvent
  });
})(window);
