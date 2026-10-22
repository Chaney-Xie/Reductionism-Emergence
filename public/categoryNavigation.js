(function initCategoryNavigation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.categoryNavigation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_NAVIGATION_SETTINGS = Object.freeze({
    enabledCategoryIds: Object.freeze([]),
    collapseUncategorisedPages: true,
    quantityStatistics: false
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function categoryItemsInOrder(config) {
    const items = [];
    const visit = (nodes) => {
      for (const node of nodes || []) {
        if (!node || typeof node !== 'object') continue;
        if (node.type === 'item' && typeof node.id === 'string') items.push(node);
        else visit(node.children);
      }
    };
    visit(config?.groups);
    return items;
  }

  function categoryGroupIds(config) {
    const ids = new Set();
    const visit = (nodes) => {
      for (const node of nodes || []) {
        if (!node || typeof node !== 'object' || node.type === 'item') continue;
        if (typeof node.id === 'string') ids.add(node.id);
        visit(node.children);
      }
    };
    visit(config?.groups);
    return ids;
  }

  function normalizeCategoryConfiguration(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const groups = Array.isArray(source.groups) ? clone(source.groups) : [];
    const itemIds = new Set(categoryItemsInOrder({ groups }).map((item) => item.id));
    const rawNavigation = source.navigation && typeof source.navigation === 'object'
      ? source.navigation
      : {};
    const requestedEnabledIds = new Set();
    for (const categoryId of rawNavigation.enabledCategoryIds || []) {
      if (typeof categoryId === 'string' && itemIds.has(categoryId)) requestedEnabledIds.add(categoryId);
    }
    const enabledCategoryIds = categoryItemsInOrder({ groups })
      .map((item) => item.id)
      .filter((categoryId) => requestedEnabledIds.has(categoryId));
    return {
      ...clone(source),
      groups,
      navigation: {
        enabledCategoryIds,
        collapseUncategorisedPages: rawNavigation.collapseUncategorisedPages !== false,
        quantityStatistics: rawNavigation.quantityStatistics === true
      }
    };
  }

  function dynamicFolderId(categoryId) {
    return `folder_category_${categoryId}`;
  }

  function uniqueLabel(labels, baseLabel) {
    const used = new Set((labels || []).map((label) => String(label || '').trim().toLocaleLowerCase()));
    if (!used.has(baseLabel.toLocaleLowerCase())) return baseLabel;
    for (let number = 1; number < 10000; number += 1) {
      const candidate = `${baseLabel} | ${number}`;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `${baseLabel} ${Date.now()}`;
  }

  return {
    DEFAULT_NAVIGATION_SETTINGS,
    categoryGroupIds,
    categoryItemsInOrder,
    dynamicFolderId,
    normalizeCategoryConfiguration,
    uniqueLabel
  };
}));
