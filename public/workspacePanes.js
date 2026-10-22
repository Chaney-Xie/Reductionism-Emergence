(function exposeWorkspacePanes(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.workspacePanesModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_PANE_WIDTH = 720;
  const DEFAULT_PANE_MIN_WIDTH = 320;
  const DEFAULT_COLLAPSED_PANE_WIDTH = 36;
  const EPSILON = 0.000001;

  function finiteDimension(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function createWorkspace({
    createSession,
    createViewContext = () => ({}),
    createId = null,
    defaultWidth = DEFAULT_PANE_WIDTH,
    defaultMinWidth = DEFAULT_PANE_MIN_WIDTH,
    defaultCollapsedWidth = DEFAULT_COLLAPSED_PANE_WIDTH
  } = {}) {
    if (typeof createSession !== 'function') {
      throw new TypeError('createSession is required.');
    }
    let sequence = 0;
    const state = {
      panes: [],
      activePaneId: null
    };
    const nextId = () => createId?.() || `pane_${++sequence}`;

    function paneById(paneId) {
      return state.panes.find((pane) => pane.id === paneId) || null;
    }

    function activePane() {
      return paneById(state.activePaneId);
    }

    function addPane({
      id = null,
      session = null,
      width = defaultWidth,
      minWidth = defaultMinWidth,
      collapsedWidth = defaultCollapsedWidth,
      lastExpandedWidth = width,
      mode = 'expanded',
      viewContext = null,
      insertionIndex = null
    } = {}) {
      const paneId = typeof id === 'string' && id ? id : nextId();
      if (paneById(paneId)) throw new Error(`Pane already exists: ${paneId}`);
      const normalizedMinWidth = finiteDimension(minWidth, defaultMinWidth);
      const normalizedCollapsedWidth = Math.min(
        normalizedMinWidth,
        finiteDimension(collapsedWidth, defaultCollapsedWidth)
      );
      const normalizedMode = mode === 'collapsed' ? 'collapsed' : 'expanded';
      const normalizedExpandedWidth = Math.max(
        normalizedMinWidth,
        finiteDimension(lastExpandedWidth, finiteDimension(width, defaultWidth))
      );
      const pane = {
        id: paneId,
        session: session || createSession(),
        mode: normalizedMode,
        width: normalizedMode === 'collapsed'
          ? normalizedCollapsedWidth
          : Math.max(normalizedMinWidth, finiteDimension(width, defaultWidth)),
        minWidth: normalizedMinWidth,
        collapsedWidth: normalizedCollapsedWidth,
        lastExpandedWidth: normalizedExpandedWidth,
        viewContext: viewContext || createViewContext(paneId)
      };
      const index = Number.isInteger(insertionIndex)
        ? Math.min(state.panes.length, Math.max(0, insertionIndex))
        : state.panes.length;
      state.panes.splice(index, 0, pane);
      if (!state.activePaneId) state.activePaneId = pane.id;
      return pane;
    }

    function activatePane(paneId) {
      const pane = paneById(paneId);
      if (!pane) return null;
      state.activePaneId = pane.id;
      return pane;
    }

    function removePane(paneId) {
      if (state.panes.length <= 1) return null;
      const index = state.panes.findIndex((pane) => pane.id === paneId);
      if (index < 0) return null;
      const [pane] = state.panes.splice(index, 1);
      if (state.activePaneId === paneId) {
        // The item now at the removed index was the immediate right neighbour.
        // If there was none, fall back to the immediate left neighbour.
        state.activePaneId = state.panes[index]?.id
          || state.panes[index - 1]?.id
          || null;
      }
      if (state.panes.length === 1) {
        const survivor = state.panes[0];
        survivor.mode = 'expanded';
        survivor.width = Math.max(survivor.minWidth, survivor.lastExpandedWidth);
        survivor.lastExpandedWidth = survivor.width;
      }
      return { pane, activePane: activePane(), index };
    }

    function reset(paneOptions = {}) {
      state.panes.length = 0;
      state.activePaneId = null;
      return addPane(paneOptions);
    }

    function totalWidth() {
      return state.panes.reduce((total, pane) => total + pane.width, 0);
    }

    function expandedPanes(indices = null, excludedIds = new Set()) {
      const allowed = indices ? new Set(indices) : null;
      return state.panes.filter((pane, index) => (
        pane.mode === 'expanded'
        && !excludedIds.has(pane.id)
        && (!allowed || allowed.has(index))
      ));
    }

    function rememberExpandedWidth(pane) {
      if (pane?.mode !== 'expanded') return;
      pane.width = Math.max(pane.minWidth, pane.width);
      pane.lastExpandedWidth = pane.width;
    }

    function growExpanded(panes, amount) {
      let remaining = Math.max(0, Number(amount) || 0);
      if (remaining <= EPSILON || !panes.length) return 0;
      const weight = panes.reduce((total, pane) => total + Math.max(pane.width, 1), 0);
      for (let index = 0; index < panes.length; index += 1) {
        const pane = panes[index];
        const share = index === panes.length - 1
          ? remaining
          : amount * (Math.max(pane.width, 1) / weight);
        const growth = Math.max(0, Math.min(remaining, share));
        pane.width += growth;
        pane.lastExpandedWidth = pane.width;
        remaining -= growth;
      }
      return amount - remaining;
    }

    function shrinkExpanded(panes, amount) {
      const requested = Math.max(0, Number(amount) || 0);
      let remaining = requested;
      let eligible = panes.filter((pane) => (
        pane.mode === 'expanded' && pane.width > pane.minWidth + EPSILON
      ));
      while (remaining > EPSILON && eligible.length) {
        const weight = eligible.reduce((total, pane) => total + pane.width, 0);
        let consumed = 0;
        for (const pane of eligible) {
          const share = remaining * (pane.width / weight);
          const shrink = Math.min(share, pane.width - pane.minWidth);
          pane.width -= shrink;
          consumed += shrink;
        }
        if (consumed <= EPSILON) break;
        remaining -= consumed;
        eligible = eligible.filter((pane) => pane.width > pane.minWidth + EPSILON);
      }
      for (const pane of panes) rememberExpandedWidth(pane);
      return requested - remaining;
    }

    function collapsePane(paneOrId) {
      const pane = typeof paneOrId === 'string' ? paneById(paneOrId) : paneOrId;
      if (!pane || pane.mode === 'collapsed') return 0;
      const previousWidth = pane.width;
      pane.lastExpandedWidth = Math.max(pane.minWidth, previousWidth);
      pane.mode = 'collapsed';
      pane.width = pane.collapsedWidth;
      return Math.max(0, previousWidth - pane.width);
    }

    function collapseFromRight(amount, { excludedIds = new Set(), indices = null } = {}) {
      let remaining = Math.max(0, Number(amount) || 0);
      let released = 0;
      const allowed = indices ? new Set(indices) : null;
      for (let index = state.panes.length - 1; index >= 0 && remaining > EPSILON; index -= 1) {
        const pane = state.panes[index];
        if (pane.mode !== 'expanded' || excludedIds.has(pane.id)
          || (allowed && !allowed.has(index))) continue;
        const amountReleased = collapsePane(pane);
        released += amountReleased;
        remaining -= amountReleased;
      }
      return released;
    }

    function fitToWidth(availableWidth) {
      const available = Math.max(0, Number(availableWidth) || 0);
      let total = totalWidth();
      if (total > available + EPSILON) {
        const deficit = total - available;
        const shrunk = shrinkExpanded(expandedPanes(), deficit);
        let remaining = deficit - shrunk;
        if (remaining > EPSILON) collapseFromRight(remaining);
        total = totalWidth();
      }
      if (total < available - EPSILON) {
        growExpanded(expandedPanes(), available - total);
      }
      return totalWidth();
    }

    function captureLayout() {
      return state.panes.map((pane) => ({
        id: pane.id,
        mode: pane.mode,
        width: pane.width,
        lastExpandedWidth: pane.lastExpandedWidth
      }));
    }

    function restoreLayout(layout) {
      if (!Array.isArray(layout)) return false;
      const byId = new Map(layout.map((entry) => [entry.id, entry]));
      for (const pane of state.panes) {
        const entry = byId.get(pane.id);
        if (!entry) continue;
        pane.mode = entry.mode === 'collapsed' ? 'collapsed' : 'expanded';
        pane.width = pane.mode === 'collapsed'
          ? pane.collapsedWidth
          : Math.max(pane.minWidth, Number(entry.width) || pane.minWidth);
        pane.lastExpandedWidth = Math.max(
          pane.minWidth,
          Number(entry.lastExpandedWidth) || pane.width
        );
      }
      return true;
    }

    function dividerSideIndices(dividerIndex, side) {
      if (side === 'left') {
        return Array.from({ length: dividerIndex + 1 }, (_, index) => index);
      }
      return Array.from(
        { length: Math.max(0, state.panes.length - dividerIndex - 1) },
        (_, index) => dividerIndex + 1 + index
      );
    }

    function nearestExpanded(indices, side) {
      const ordered = side === 'left' ? [...indices].reverse() : [...indices];
      for (const index of ordered) {
        const pane = state.panes[index];
        if (pane?.mode === 'expanded') return pane;
      }
      return null;
    }

    function outermostExpanded(indices, side, excludedIds = new Set()) {
      const order = side === 'right' ? [...indices].reverse() : [...indices];
      for (const index of order) {
        const pane = state.panes[index];
        if (pane?.mode === 'expanded' && !excludedIds.has(pane.id)) return pane;
      }
      return null;
    }

    function dividerExpansionCandidate(dividerIndex, movement) {
      const index = movement > 0 ? dividerIndex : dividerIndex + 1;
      const pane = state.panes[index];
      return pane?.mode === 'collapsed' ? pane : null;
    }

    function clearExpansionOverdrag(overdragState) {
      if (!overdragState) return;
      overdragState.expansionPaneId = null;
      overdragState.expansionDirection = 0;
      overdragState.expansionOverdrag = 0;
      overdragState.expansionTriggerDistance = 0;
    }

    function protectExpandedPane(overdragState, paneId) {
      if (!overdragState || typeof paneId !== 'string') return;
      if (!Array.isArray(overdragState.protectedExpandedPaneIds)) {
        overdragState.protectedExpandedPaneIds = [];
      }
      if (!overdragState.protectedExpandedPaneIds.includes(paneId)) {
        overdragState.protectedExpandedPaneIds.push(paneId);
      }
    }

    function protectedExpandedPanes(overdragState) {
      return new Set(Array.isArray(overdragState?.protectedExpandedPaneIds)
        ? overdragState.protectedExpandedPaneIds
        : []);
    }

    function expandPaneFromDivider(pane, compressedIndices, compressSide, requiredWidth) {
      if (!pane || pane.mode !== 'collapsed') return false;
      const before = captureLayout();
      const compressed = compressDividerSide(
        compressedIndices,
        compressSide,
        requiredWidth,
        { allowCollapse: true }
      );
      if (compressed.released + EPSILON < requiredWidth) {
        restoreLayout(before);
        return false;
      }
      pane.mode = 'expanded';
      pane.width = pane.minWidth;
      pane.lastExpandedWidth = pane.minWidth;
      const surplus = Math.max(0, compressed.released - requiredWidth);
      if (surplus > EPSILON) {
        const receivers = expandedPanes(compressedIndices);
        if (receivers.length) growExpanded(receivers, surplus);
        else {
          pane.width += surplus;
          pane.lastExpandedWidth = pane.width;
        }
      }
      return true;
    }

    function compressDividerSide(indices, side, amount, { allowCollapse = true } = {}) {
      const requested = Math.max(0, Number(amount) || 0);
      let remaining = requested;
      let released = 0;
      const adjacent = nearestExpanded(indices, side);
      if (adjacent) {
        const shrink = Math.min(remaining, adjacent.width - adjacent.minWidth);
        adjacent.width -= shrink;
        rememberExpandedWidth(adjacent);
        remaining -= shrink;
        released += shrink;
      }
      if (remaining > EPSILON) {
        const others = expandedPanes(indices, new Set(adjacent ? [adjacent.id] : []));
        const shrunk = shrinkExpanded(others, remaining);
        remaining -= shrunk;
        released += shrunk;
      }
      if (allowCollapse && remaining > EPSILON) {
        const order = side === 'right' ? [...indices].reverse() : [...indices];
        for (const index of order) {
          if (remaining <= EPSILON) break;
          const pane = state.panes[index];
          if (pane?.mode !== 'expanded') continue;
          const amountReleased = collapsePane(pane);
          released += amountReleased;
          remaining -= amountReleased;
        }
      }
      return { released, unconsumed: Math.max(0, remaining) };
    }

    function resizeAtDivider(dividerIndex, delta, { overdragState = null } = {}) {
      if (!Number.isInteger(dividerIndex) || dividerIndex < 0
        || dividerIndex >= state.panes.length - 1) return 0;
      let movement = Number(delta) || 0;
      if (Math.abs(movement) <= EPSILON) return 0;
      let expansionApplied = 0;
      if (overdragState?.expansionPaneId) {
        const pendingDirection = Math.sign(overdragState.expansionDirection || 0);
        if (Math.sign(movement) !== pendingDirection) {
          const consumed = Math.min(
            Math.abs(movement),
            Math.max(0, overdragState.expansionOverdrag || 0)
          );
          overdragState.expansionOverdrag = Math.max(
            0,
            (overdragState.expansionOverdrag || 0) - consumed
          );
          const remainder = Math.abs(movement) - consumed;
          if (overdragState.expansionOverdrag <= EPSILON) clearExpansionOverdrag(overdragState);
          if (remainder <= EPSILON) return 0;
          movement = movement > 0 ? remainder : -remainder;
        }
      }
      const adjacentExpansionCandidate = overdragState
        ? dividerExpansionCandidate(dividerIndex, movement)
        : null;
      if (adjacentExpansionCandidate) {
        overdragState.compressSide = null;
        overdragState.collapseOverdrag = 0;
        overdragState.candidatePaneId = null;
        overdragState.triggerDistance = 0;
      }
      const requestedSide = movement > 0 ? 'right' : 'left';
      if (overdragState
        && overdragState.compressSide
        && overdragState.compressSide !== requestedSide
        && overdragState.collapseOverdrag > EPSILON) {
        const consumed = Math.min(Math.abs(movement), overdragState.collapseOverdrag);
        overdragState.collapseOverdrag -= consumed;
        const remainder = Math.abs(movement) - consumed;
        if (remainder <= EPSILON) return 0;
        movement = movement > 0 ? remainder : -remainder;
      }
      const compressSide = movement > 0 ? 'right' : 'left';
      const compressedIndices = dividerSideIndices(dividerIndex, compressSide);
      const expansionCandidate = adjacentExpansionCandidate;
      if (expansionCandidate) {
        const direction = Math.sign(movement);
        if (overdragState.expansionPaneId !== expansionCandidate.id
          || overdragState.expansionDirection !== direction) {
          clearExpansionOverdrag(overdragState);
          overdragState.expansionPaneId = expansionCandidate.id;
          overdragState.expansionDirection = direction;
          overdragState.expansionTriggerDistance = Math.max(
            EPSILON,
            expansionCandidate.minWidth - expansionCandidate.collapsedWidth
          );
        }
        overdragState.expansionOverdrag += Math.abs(movement);
        const trigger = overdragState.expansionTriggerDistance;
        if (overdragState.expansionOverdrag + EPSILON < trigger) return 0;
        const overflow = Math.max(0, overdragState.expansionOverdrag - trigger);
        if (!expandPaneFromDivider(
          expansionCandidate,
          compressedIndices,
          compressSide,
          trigger
        )) {
          overdragState.expansionOverdrag = trigger;
          return 0;
        }
        protectExpandedPane(overdragState, expansionCandidate.id);
        expansionApplied = trigger;
        clearExpansionOverdrag(overdragState);
        overdragState.compressSide = null;
        overdragState.collapseOverdrag = 0;
        overdragState.candidatePaneId = null;
        overdragState.triggerDistance = 0;
        if (overflow <= EPSILON) return direction * expansionApplied;
        movement = direction * overflow;
      }
      const activeCompressSide = movement > 0 ? 'right' : 'left';
      const activeGainSide = movement > 0 ? 'left' : 'right';
      const activeCompressedIndices = dividerSideIndices(dividerIndex, activeCompressSide);
      const activeGainingIndices = dividerSideIndices(dividerIndex, activeGainSide);
      const gainPane = nearestExpanded(activeGainingIndices, activeGainSide);
      if (!gainPane && !overdragState) return 0;
      if (overdragState && overdragState.compressSide !== activeCompressSide) {
        overdragState.compressSide = activeCompressSide;
        overdragState.collapseOverdrag = 0;
        overdragState.candidatePaneId = null;
        overdragState.triggerDistance = 0;
      }
      const compressed = compressDividerSide(
        activeCompressedIndices,
        activeCompressSide,
        Math.abs(movement),
        { allowCollapse: !overdragState }
      );
      let released = compressed.released;
      if (overdragState && compressed.unconsumed > EPSILON) {
        overdragState.collapseOverdrag += compressed.unconsumed;
        const protectedIds = protectedExpandedPanes(overdragState);
        let candidate = outermostExpanded(
          activeCompressedIndices,
          activeCompressSide,
          protectedIds
        );
        while (candidate) {
          const trigger = Math.max(EPSILON, candidate.width - candidate.collapsedWidth);
          overdragState.candidatePaneId = candidate.id;
          overdragState.triggerDistance = trigger;
          const calculatedWidth = candidate.width - overdragState.collapseOverdrag;
          if (calculatedWidth > candidate.collapsedWidth) break;
          const amountReleased = collapsePane(candidate);
          released += amountReleased;
          overdragState.collapseOverdrag = Math.max(
            0,
            overdragState.collapseOverdrag - trigger
          );
          candidate = outermostExpanded(
            activeCompressedIndices,
            activeCompressSide,
            protectedIds
          );
        }
        if (!candidate) {
          overdragState.candidatePaneId = null;
          overdragState.triggerDistance = 0;
        }
      }
      if (gainPane) {
        gainPane.width += released;
        rememberExpandedWidth(gainPane);
      }
      return movement > 0
        ? expansionApplied + released
        : -(expansionApplied + released);
    }

    function allocateProtectedExpandedPane(pane, availableWidth) {
      const available = Math.max(0, Number(availableWidth) || 0);
      let needed = Math.max(0, totalWidth() - available);
      const excluded = new Set([pane.id]);
      if (needed > EPSILON) {
        const shrunk = shrinkExpanded(expandedPanes(null, excluded), needed);
        needed -= shrunk;
      }
      if (needed > EPSILON) {
        const released = collapseFromRight(needed, { excludedIds: excluded });
        needed -= released;
      }
      if (needed > EPSILON) return false;
      const spare = Math.max(0, available - totalWidth());
      if (spare > EPSILON) growExpanded(expandedPanes(null, excluded), spare);
      return true;
    }

    function expandPane(paneId, availableWidth) {
      const pane = paneById(paneId);
      if (!pane || pane.mode !== 'collapsed') return false;
      const before = captureLayout();
      pane.mode = 'expanded';
      pane.width = pane.minWidth;
      pane.lastExpandedWidth = pane.minWidth;
      if (allocateProtectedExpandedPane(pane, availableWidth)) return true;
      restoreLayout(before);
      return false;
    }

    function addPaneAllocated(paneOptions = {}, availableWidth) {
      const before = captureLayout();
      const previousActivePaneId = state.activePaneId;
      const pane = addPane({
        ...paneOptions,
        mode: 'expanded',
        width: finiteDimension(paneOptions.minWidth, defaultMinWidth)
      });
      if (!allocateProtectedExpandedPane(pane, availableWidth)) {
        state.panes.splice(state.panes.indexOf(pane), 1);
        state.activePaneId = previousActivePaneId;
        restoreLayout(before);
        return null;
      }
      return pane;
    }

    function reorderPane(paneId, insertionIndex) {
      const fromIndex = state.panes.findIndex((pane) => pane.id === paneId);
      if (fromIndex < 0 || !Number.isInteger(insertionIndex)) return false;
      const [pane] = state.panes.splice(fromIndex, 1);
      const targetIndex = Math.min(state.panes.length, Math.max(0, insertionIndex));
      state.panes.splice(targetIndex, 0, pane);
      return true;
    }

    return Object.freeze({
      state,
      activePane,
      activatePane,
      addPane,
      addPaneAllocated,
      captureLayout,
      collapsePane,
      expandPane,
      fitToWidth,
      paneById,
      removePane,
      reorderPane,
      reset,
      resizeAtDivider,
      restoreLayout
    });
  }

  return Object.freeze({
    DEFAULT_COLLAPSED_PANE_WIDTH,
    DEFAULT_PANE_MIN_WIDTH,
    DEFAULT_PANE_WIDTH,
    createWorkspace
  });
}));
