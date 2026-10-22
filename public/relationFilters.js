(function exposeRelationFilters(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.relationFiltersModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function asSet(values) {
    return values instanceof Set ? values : new Set(values || []);
  }

  function pageCategoryIds(page = {}) {
    return [...new Set([...(page.categoryIds || []), ...(page.categories || [])].filter(Boolean))];
  }

  function pageDescriptorIds(page = {}) {
    const ids = new Set(page.descriptorIds || []);
    for (const classIds of Object.values(page.descriptors || {})) {
      for (const id of classIds || []) if (id) ids.add(id);
    }
    return [...ids];
  }

  function categoryItemGroups(categoryConfig = {}) {
    const itemGroupById = new Map();
    const visit = (children, groupId) => {
      for (const child of children || []) {
        if (!child || typeof child !== 'object') continue;
        if (child.type === 'item' && child.id) itemGroupById.set(child.id, groupId);
        if (Array.isArray(child.children)) visit(child.children, groupId);
      }
    };
    for (const group of categoryConfig.groups || []) visit(group.children, group.id);
    return itemGroupById;
  }

  function descriptorIdsByGroup(descriptorGroups = {}, descriptorEntries = []) {
    const groups = descriptorGroups.groups || {};
    const direct = new Map(Object.keys(groups).map((id) => [id, new Set()]));
    const entryByMembershipKey = new Map();
    for (const entry of descriptorEntries || []) {
      const membershipKey = entry?.vocabularyEntryId || entry?.id;
      if (membershipKey && entry?.id) entryByMembershipKey.set(membershipKey, entry.id);
      if (entry?.id) entryByMembershipKey.set(entry.id, entry.id);
    }
    for (const [membershipKey, groupId] of Object.entries(
      descriptorGroups.descriptorParentByEntryId || {}
    )) {
      const descriptorId = entryByMembershipKey.get(membershipKey);
      if (descriptorId && direct.has(groupId)) direct.get(groupId).add(descriptorId);
    }

    const children = new Map(Object.keys(groups).map((id) => [id, []]));
    for (const group of Object.values(groups)) {
      if (group?.parentId && children.has(group.parentId)) children.get(group.parentId).push(group.id);
    }

    const recursive = new Map();
    const resolve = (groupId, visiting = new Set()) => {
      if (recursive.has(groupId)) return recursive.get(groupId);
      if (visiting.has(groupId) || !groups[groupId]) return new Set();
      const nextVisiting = new Set(visiting);
      nextVisiting.add(groupId);
      const ids = new Set(direct.get(groupId) || []);
      for (const childId of children.get(groupId) || []) {
        for (const descriptorId of resolve(childId, nextVisiting)) ids.add(descriptorId);
      }
      recursive.set(groupId, ids);
      return ids;
    };
    for (const groupId of Object.keys(groups)) resolve(groupId);
    return recursive;
  }

  function buildRelationFilterContext({
    relationInstances = [],
    pageIndex = { pages: [] },
    categoryConfig = {},
    descriptorGroups = {},
    descriptorEntries = []
  } = {}) {
    const pagesById = new Map((pageIndex.pages || []).map((page) => [page.id, page]));
    const counterpartPageIds = [...new Set(relationInstances
      .map((instance) => instance?.counterpartPageId)
      .filter(Boolean))];
    const categoriesByPageId = new Map();
    const descriptorsByPageId = new Map();
    for (const pageId of counterpartPageIds) {
      const page = pagesById.get(pageId) || {};
      categoriesByPageId.set(pageId, new Set(pageCategoryIds(page)));
      descriptorsByPageId.set(pageId, new Set(pageDescriptorIds(page)));
    }

    const recursiveDescriptorIds = descriptorIdsByGroup(descriptorGroups, descriptorEntries);
    const descriptorGroupCounts = new Map();
    for (const [groupId, descriptorIds] of recursiveDescriptorIds) {
      let count = 0;
      for (const pageId of counterpartPageIds) {
        const pageDescriptors = descriptorsByPageId.get(pageId) || new Set();
        if ([...descriptorIds].some((id) => pageDescriptors.has(id))) count += 1;
      }
      descriptorGroupCounts.set(groupId, count);
    }

    return {
      pagesById,
      counterpartPageIds,
      categoriesByPageId,
      descriptorsByPageId,
      categoryItemGroupById: categoryItemGroups(categoryConfig),
      descriptorIdsByGroup: recursiveDescriptorIds,
      descriptorGroupCounts
    };
  }

  function pageMatchesCategorySelection(pageId, context, selectedCategoryIds) {
    const selected = asSet(selectedCategoryIds);
    if (!selected.size) return true;
    const selectedByGroup = new Map();
    for (const categoryId of selected) {
      const groupId = context.categoryItemGroupById.get(categoryId) || `unknown:${categoryId}`;
      if (!selectedByGroup.has(groupId)) selectedByGroup.set(groupId, []);
      selectedByGroup.get(groupId).push(categoryId);
    }
    const pageCategories = context.categoriesByPageId.get(pageId) || new Set();
    return [...selectedByGroup.values()].every((categoryIds) => (
      categoryIds.some((categoryId) => pageCategories.has(categoryId))
    ));
  }

  function pageMatchesDescriptorSelection(pageId, context, selectedGroupIds) {
    const selected = asSet(selectedGroupIds);
    if (!selected.size) return true;
    const pageDescriptors = context.descriptorsByPageId.get(pageId) || new Set();
    return [...selected].every((groupId) => {
      const groupDescriptorIds = context.descriptorIdsByGroup.get(groupId) || new Set();
      return [...groupDescriptorIds].some((descriptorId) => pageDescriptors.has(descriptorId));
    });
  }

  function filterRelationInstances(relationInstances, context, selections = {}) {
    return (relationInstances || []).filter((instance) => {
      const pageId = instance?.counterpartPageId;
      return pageMatchesCategorySelection(pageId, context, selections.categoryIds)
        && pageMatchesDescriptorSelection(pageId, context, selections.descriptorGroupIds);
    });
  }

  return {
    buildRelationFilterContext,
    categoryItemGroups,
    descriptorIdsByGroup,
    filterRelationInstances,
    pageCategoryIds,
    pageDescriptorIds,
    pageMatchesCategorySelection,
    pageMatchesDescriptorSelection
  };
}));
