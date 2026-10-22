(function exposeTabStripLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.tabStripLayoutModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const PREFERRED_TAB_WIDTH = 180;
  const MINIMUM_INACTIVE_TAB_WIDTH = 34;

  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function calculateTabSizing({
    availableWidth,
    tabCount,
    hasActiveTab = true,
    preferredTabWidth = PREFERRED_TAB_WIDTH,
    minimumInactiveTabWidth = MINIMUM_INACTIVE_TAB_WIDTH
  } = {}) {
    const available = finiteNonNegative(availableWidth);
    const count = Math.max(0, Math.floor(finiteNonNegative(tabCount)));
    const preferred = Math.max(1, finiteNonNegative(preferredTabWidth));
    const minimum = Math.min(preferred, Math.max(1, finiteNonNegative(minimumInactiveTabWidth)));
    const activeCount = hasActiveTab && count > 0 ? 1 : 0;
    const inactiveCount = count - activeCount;

    if (!count) {
      return {
        activeWidth: preferred,
        inactiveWidth: preferred,
        inactiveCount: 0,
        scrolling: false
      };
    }

    if (count * preferred <= available) {
      return {
        activeWidth: preferred,
        inactiveWidth: preferred,
        inactiveCount,
        scrolling: false
      };
    }

    if (!inactiveCount) {
      return {
        activeWidth: preferred,
        inactiveWidth: preferred,
        inactiveCount: 0,
        scrolling: preferred > available
      };
    }

    const remaining = Math.max(0, available - (activeCount * preferred));
    const equalInactiveWidth = Math.min(preferred, remaining / inactiveCount);
    if (equalInactiveWidth >= minimum) {
      return {
        activeWidth: preferred,
        inactiveWidth: equalInactiveWidth,
        inactiveCount,
        scrolling: false
      };
    }

    return {
      activeWidth: preferred,
      inactiveWidth: minimum,
      inactiveCount,
      scrolling: (activeCount * preferred) + (inactiveCount * minimum) > available
    };
  }

  function graphemes(value, locale) {
    const text = String(value ?? '');
    if (!text) return [];
    if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)]
        .map((part) => part.segment);
    }
    return Array.from(text);
  }

  function firstGrapheme(value, locale) {
    return graphemes(value, locale)[0] || '';
  }

  function firstGraphemes(value, count, locale) {
    const limit = Math.max(0, Math.floor(finiteNonNegative(count)));
    return graphemes(value, locale).slice(0, limit).join('');
  }

  function insertionIndexAtPoint(rects, clientX) {
    const slots = Array.isArray(rects) ? rects : [];
    const pointerX = Number(clientX);
    if (!Number.isFinite(pointerX)) return 0;
    for (let index = 0; index < slots.length; index += 1) {
      const left = Number(slots[index]?.left);
      const width = Number(slots[index]?.width);
      if (!Number.isFinite(left) || !Number.isFinite(width)) continue;
      if (pointerX < left + Math.max(0, width) / 2) return index;
    }
    return slots.length;
  }

  function reorderSequence(values, fromIndex, toIndex) {
    const items = Array.isArray(values) ? [...values] : [];
    if (!items.length) return items;
    const from = Math.min(items.length - 1, Math.max(0, Math.floor(finiteNonNegative(fromIndex))));
    const to = Math.min(items.length - 1, Math.max(0, Math.floor(finiteNonNegative(toIndex))));
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    return items;
  }

  function targetOffsets(slots, draggedId, insertionIndex) {
    if (!Array.isArray(slots) || !slots.length) return new Map();
    const fromIndex = slots.findIndex((slot) => slot?.id === draggedId);
    if (fromIndex < 0) return new Map();
    const rects = provisionalSlotRects(slots, draggedId, insertionIndex);
    const offsets = new Map();
    for (const slot of slots) {
      const left = Number(slot.left) || 0;
      const targetLeft = Number(rects.get(slot.id)?.left);
      offsets.set(slot.id, Number.isFinite(targetLeft) ? targetLeft - left : 0);
    }
    return offsets;
  }

  function detachedOffsets(slots, draggedId) {
    const offsets = new Map();
    if (!Array.isArray(slots) || !slots.length) return offsets;
    const fromIndex = slots.findIndex((slot) => slot?.id === draggedId);
    if (fromIndex < 0) return offsets;
    const width = Math.max(0, Number(slots[fromIndex]?.width) || 0);
    for (let index = 0; index < slots.length; index += 1) {
      offsets.set(slots[index].id, index > fromIndex ? -width : 0);
    }
    return offsets;
  }

  function provisionalSlotRects(slots, draggedId, insertionIndex) {
    if (!Array.isArray(slots) || !slots.length) return new Map();
    const fromIndex = slots.findIndex((slot) => slot?.id === draggedId);
    if (fromIndex < 0) return new Map();
    const ordered = reorderSequence(slots, fromIndex, insertionIndex);
    let cursor = Number(slots[0]?.left) || 0;
    const rects = new Map();
    for (const slot of ordered) {
      const width = Math.max(0, Number(slot.width) || 0);
      rects.set(slot.id, {
        left: cursor,
        right: cursor + width,
        width,
        center: cursor + (width / 2)
      });
      cursor += width;
    }
    return rects;
  }

  function nextInsertionIndex({
    slots,
    draggedId,
    insertionIndex,
    draggedLeft,
    previousDraggedLeft,
    tolerance = 1
  } = {}) {
    if (!Array.isArray(slots) || !slots.length) return 0;
    const dragged = slots.find((slot) => slot?.id === draggedId);
    if (!dragged) return 0;
    const stationary = slots.filter((slot) => slot?.id !== draggedId);
    let index = Math.min(stationary.length, Math.max(0, Number(insertionIndex) || 0));
    const left = Number(draggedLeft);
    const previous = Number(previousDraggedLeft);
    if (!Number.isFinite(left) || !Number.isFinite(previous)) return index;
    const epsilon = Math.max(0, Number(tolerance) || 0);
    const direction = left - previous;

    if (direction > 0) {
      while (index < stationary.length) {
        const rects = provisionalSlotRects(slots, draggedId, index);
        const candidate = rects.get(stationary[index].id);
        if (!candidate || left + dragged.width <= candidate.center + epsilon) break;
        index += 1;
      }
    } else if (direction < 0) {
      while (index > 0) {
        const rects = provisionalSlotRects(slots, draggedId, index);
        const candidate = rects.get(stationary[index - 1].id);
        if (!candidate || left >= candidate.center - epsilon) break;
        index -= 1;
      }
    }
    return index;
  }

  return {
    MINIMUM_INACTIVE_TAB_WIDTH,
    PREFERRED_TAB_WIDTH,
    calculateTabSizing,
    detachedOffsets,
    firstGrapheme,
    firstGraphemes,
    insertionIndexAtPoint,
    nextInsertionIndex,
    provisionalSlotRects,
    reorderSequence,
    targetOffsets
  };
}));
