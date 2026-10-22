(function initPageBindingProjection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pageBindingProjection = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function normalizedBindings(bindings) {
    return Array.isArray(bindings) ? bindings.filter((binding) => (
      binding
      && typeof binding.id === 'string'
      && typeof binding.leaderPageId === 'string'
      && Array.isArray(binding.followerPageIds)
    )) : [];
  }

  function buildBindingIndex(bindings) {
    const index = new Map();
    for (const binding of normalizedBindings(bindings)) {
      if (!index.has(binding.leaderPageId)) {
        index.set(binding.leaderPageId, { role: 'leader', binding });
      }
      for (const followerPageId of binding.followerPageIds) {
        if (typeof followerPageId !== 'string' || index.has(followerPageId)) continue;
        index.set(followerPageId, { role: 'follower', binding });
      }
    }
    return index;
  }

  function bindingFact(bindings, pageId) {
    const fact = buildBindingIndex(bindings).get(pageId);
    return fact || { role: 'unbound', binding: null };
  }

  function projectContainer({
    pageIds = [],
    pages = [],
    visiblePageIds = [],
    bindings = [],
    synthetic = false,
    comparePages = () => 0,
    sortMode
  } = {}) {
    const pagesById = new Map((pages || []).map((page) => [page?.id, page]));
    const visibleIds = visiblePageIds instanceof Set
      ? visiblePageIds
      : new Set(visiblePageIds || []);
    const bindingIndex = buildBindingIndex(bindings);
    const units = [];
    const seenTopLevelIds = new Set();

    const addOrdinary = (page) => {
      if (!page || seenTopLevelIds.has(page.id)) return;
      seenTopLevelIds.add(page.id);
      units.push({ page, visualRole: 'ordinary', followerPages: [] });
    };

    for (const pageId of pageIds || []) {
      const page = pagesById.get(pageId);
      if (!page) continue;

      if (synthetic) {
        if (visibleIds.has(pageId)) addOrdinary(page);
        continue;
      }

      const fact = bindingIndex.get(pageId);
      if (fact?.role === 'follower') continue;
      if (fact?.role !== 'leader') {
        if (visibleIds.has(pageId)) addOrdinary(page);
        continue;
      }

      const followerPages = fact.binding.followerPageIds
        .map((followerPageId) => pagesById.get(followerPageId))
        .filter((followerPage) => followerPage && visibleIds.has(followerPage.id))
        .sort((left, right) => comparePages(left, right, sortMode));

      if (visibleIds.has(pageId)) {
        if (seenTopLevelIds.has(pageId)) continue;
        seenTopLevelIds.add(pageId);
        units.push({ page, visualRole: 'leader', followerPages });
        continue;
      }

      for (const followerPage of followerPages) addOrdinary(followerPage);
    }

    return units;
  }

  return Object.freeze({
    bindingFact,
    buildBindingIndex,
    projectContainer
  });
}));
