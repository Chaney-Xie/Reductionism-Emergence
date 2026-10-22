const { isDeepStrictEqual } = require('node:util');
const categoryNavigation = require('../public/categoryNavigation');

const DYNAMIC_PROJECTION_VERSION = 1;
const UNCATEGORY_SEMANTIC_KEY = 'uncategory';
const CATEGORY_SEMANTIC_PREFIX = 'category:';

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? {} : value));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function categorySemanticKey(categoryId) {
  return `${CATEGORY_SEMANTIC_PREFIX}${categoryId}`;
}

function categoryIdFromSemanticKey(key) {
  return typeof key === 'string' && key.startsWith(CATEGORY_SEMANTIC_PREFIX)
    ? key.slice(CATEGORY_SEMANTIC_PREFIX.length)
    : null;
}

function categoryIdForProjectorFolder(folder) {
  const source = folder?.source;
  if (!source || !['categoryAny', 'categoryAll'].includes(source.kind)) return null;
  return Array.isArray(source.categoryIds) && source.categoryIds.length === 1
    && typeof source.categoryIds[0] === 'string'
    ? source.categoryIds[0]
    : null;
}

function semanticKeyForProjectorFolder(folder) {
  if (!folder || typeof folder !== 'object') return null;
  if (folder.id === 'folder_uncategorised' || folder.source?.kind === 'missingCategories') {
    return UNCATEGORY_SEMANTIC_KEY;
  }
  const categoryId = categoryIdForProjectorFolder(folder);
  return categoryId ? categorySemanticKey(categoryId) : null;
}

function pageCategories(page) {
  const values = Array.isArray(page?.categories)
    ? page.categories
    : Array.isArray(page?.categoryIds) ? page.categoryIds : [];
  return [...new Set(values.filter((categoryId) => typeof categoryId === 'string'))];
}

function pagePresentation(page) {
  return {
    id: page.id,
    title: typeof page.title === 'string' && page.title ? page.title : page.id
  };
}

function uniquePages(pageIndex) {
  const pages = [];
  const seen = new Set();
  for (const page of pageIndex?.pages || []) {
    if (!page || typeof page !== 'object' || typeof page.id !== 'string' || !page.id
      || seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
  }
  return pages;
}

function uniqueCategoryItems(categoryConfig) {
  const config = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
  const items = [];
  const seen = new Set();
  for (const item of categoryNavigation.categoryItemsInOrder(config)) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { config, items };
}

function collectFolderIds(folders, result = new Set()) {
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    if (typeof folder.id === 'string' && folder.id) result.add(folder.id);
    collectFolderIds(folder.children, result);
  }
  return result;
}

function uniqueFolderId(preferredId, fallbackId, usedIds) {
  const preferred = typeof preferredId === 'string' && preferredId
    ? preferredId
    : fallbackId;
  if (!usedIds.has(preferred)) {
    usedIds.add(preferred);
    return preferred;
  }
  let suffix = 2;
  while (usedIds.has(`${fallbackId}_${suffix}`)) suffix += 1;
  const id = `${fallbackId}_${suffix}`;
  usedIds.add(id);
  return id;
}

function normalizedPresentation(value, fallbackId) {
  const source = objectValue(value);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallbackId,
    collapsed: source.collapsed !== false
  };
}

function liveFolderPresentations(folders, result = new Map()) {
  for (const folder of folders || []) {
    const key = semanticKeyForProjectorFolder(folder);
    if (key && !result.has(key)) {
      const fallbackId = key === UNCATEGORY_SEMANTIC_KEY
        ? 'folder_uncategorised'
        : categoryNavigation.dynamicFolderId(categoryIdFromSemanticKey(key));
      result.set(key, normalizedPresentation(folder, fallbackId));
    }
    liveFolderPresentations(folder.children, result);
  }
  return result;
}

function stripProjectorFolders(folders) {
  const retained = [];
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    const children = stripProjectorFolders(folder.children);
    if (semanticKeyForProjectorFolder(folder)) {
      // A projector folder is presentation/cache state, never a container
      // authority. Preserve any non-projector descendants by hoisting them at
      // the same position while retiring the stale projector wrapper.
      retained.push(...children.folders);
      continue;
    }
    retained.push(children.changed ? { ...folder, children: children.folders } : folder);
  }
  return {
    folders: retained,
    changed: retained.length !== (folders || []).length
      || retained.some((folder, index) => folder !== folders[index])
  };
}

function manualPageIds(folders, result = new Set()) {
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    if (folder.source?.kind === 'manual') {
      for (const pageId of folder.source.pageIds || []) {
        if (typeof pageId === 'string') result.add(pageId);
      }
    }
    manualPageIds(folder.children, result);
  }
  return result;
}

function bindingRoles(navigation) {
  const leaders = new Set();
  const followers = new Set();
  for (const binding of navigation?.bindings || []) {
    if (!binding || typeof binding !== 'object') continue;
    if (typeof binding.leaderPageId === 'string') leaders.add(binding.leaderPageId);
    for (const pageId of binding.followerPageIds || []) {
      if (typeof pageId === 'string') followers.add(pageId);
    }
  }
  return { leaders, followers };
}

function projectedExclusionFolders(folders, result = []) {
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    if (['missingCategories', 'categoryAny', 'categoryAll'].includes(folder.source?.kind)) {
      result.push(folder);
    }
    projectedExclusionFolders(folder.children, result);
  }
  return result;
}

function folderExcludesFromRoot(folder) {
  if (typeof folder?.excludeFromRoot === 'boolean') return folder.excludeFromRoot;
  return ['missingCategories', 'categoryAny', 'categoryAll'].includes(folder?.source?.kind);
}

function pageCapturedByProjection(pageId, folders) {
  return projectedExclusionFolders(folders).some((folder) => (
    folderExcludesFromRoot(folder)
    && Array.isArray(folder.projectedPageIds)
    && folder.projectedPageIds.includes(pageId)
  ));
}

function pageEligibleAtRoot(pageId, navigation, validPageIds, manualIds, roles) {
  if (!validPageIds.has(pageId) || manualIds.has(pageId) || roles.followers.has(pageId)) return false;
  if (navigation?.pageStates?.[pageId]?.rootPlacement === true) return true;
  if (roles.leaders.has(pageId)) return true;
  return !pageCapturedByProjection(pageId, navigation.folders);
}

function rebuildRootItems(navigation, pages) {
  const validPageIds = new Set(pages.map((page) => page.id));
  const manualIds = manualPageIds(navigation.folders);
  const roles = bindingRoles(navigation);
  const result = [];
  const seen = new Set();
  const add = (pageId) => {
    if (seen.has(pageId)
      || !pageEligibleAtRoot(pageId, navigation, validPageIds, manualIds, roles)) return;
    seen.add(pageId);
    result.push(pageId);
  };
  for (const pageId of navigation.items || []) {
    if (typeof pageId === 'string') add(pageId);
  }
  for (const page of pages) add(page.id);
  return result;
}

function projectedPagesObject(pages) {
  const result = {};
  for (const page of pages) result[page.id] = pagePresentation(page);
  return result;
}

function activeCategoryFolderMap(folders) {
  const result = new Map();
  for (const folder of folders || []) {
    const key = semanticKeyForProjectorFolder(folder);
    if (key && !result.has(key)) result.set(key, folder);
  }
  return result;
}

function desiredMembershipKeys(page, foldersByKey) {
  const keys = new Set();
  const categories = pageCategories(page);
  if (!categories.length && foldersByKey.has(UNCATEGORY_SEMANTIC_KEY)) {
    keys.add(UNCATEGORY_SEMANTIC_KEY);
  }
  for (const categoryId of categories) {
    const key = categorySemanticKey(categoryId);
    if (foldersByKey.has(key)) keys.add(key);
  }
  return keys;
}

function currentMembershipKeys(pageId, foldersByKey) {
  const keys = new Set();
  for (const [key, folder] of foldersByKey) {
    if (Array.isArray(folder.projectedPageIds) && folder.projectedPageIds.includes(pageId)) {
      keys.add(key);
    }
  }
  return keys;
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function insertProjectedPageId(pageIds, pageId, pageOrder) {
  const pagePosition = pageOrder.get(pageId);
  if (pagePosition === undefined) {
    pageIds.push(pageId);
    return;
  }
  const index = pageIds.findIndex((candidateId) => {
    const candidatePosition = pageOrder.get(candidateId);
    return candidatePosition !== undefined && candidatePosition > pagePosition;
  });
  if (index < 0) pageIds.push(pageId);
  else pageIds.splice(index, 0, pageId);
}

function lazyPagesById(pageIndex) {
  let value = null;
  return () => {
    if (value) return value;
    value = new Map(uniquePages(pageIndex).map((page) => [page.id, page]));
    return value;
  };
}

function normalizeChangeList({
  changes,
  changeSet,
  changedPageIds,
  deletedPageIds,
  previousPageIndex,
  pageIndex
}) {
  const result = new Map();
  const beforePagesById = lazyPagesById(previousPageIndex);
  const afterPagesById = lazyPagesById(pageIndex);
  const suppliedChanges = Array.isArray(changes)
    ? changes
    : Array.isArray(changeSet?.pages) ? changeSet.pages : [];
  for (const change of suppliedChanges) {
    if (!change || typeof change !== 'object') continue;
    const id = typeof change.id === 'string'
      ? change.id
      : typeof change.after?.id === 'string'
        ? change.after.id
        : change.before?.id;
    if (typeof id !== 'string' || !id) continue;
    const deleted = change.deleted === true || change.after === null;
    result.set(id, {
      id,
      before: change.before === undefined ? beforePagesById().get(id) || null : change.before,
      after: deleted
        ? null
        : change.after === undefined ? afterPagesById().get(id) || null : change.after,
      membershipChanged: change.membershipChanged,
      presentationChanged: change.presentationChanged
    });
  }
  for (const id of changedPageIds || changeSet?.changedPageIds || []) {
    if (typeof id !== 'string' || !id || result.has(id)) continue;
    result.set(id, {
      id,
      before: beforePagesById().get(id) || null,
      after: afterPagesById().get(id) || null
    });
  }
  for (const id of deletedPageIds || changeSet?.deletedPageIds || []) {
    if (typeof id !== 'string' || !id) continue;
    result.set(id, { id, before: beforePagesById().get(id) || null, after: null });
  }
  return [...result.values()];
}

function resultFor(source, navigation, mode, stats = {}) {
  return {
    navigation,
    changed: !isDeepStrictEqual(source, navigation),
    mode,
    stats
  };
}

function needsMigration(navigation) {
  return navigation?.dynamicProjection?.version !== DYNAMIC_PROJECTION_VERSION;
}

function rebuild({ navigation = {}, categoryConfig = {}, pageIndex = { pages: [] } } = {}) {
  const source = clone(navigation);
  const next = clone(navigation);
  const pages = uniquePages(pageIndex);
  const { config, items: categoryItems } = uniqueCategoryItems(categoryConfig);
  const itemById = new Map(categoryItems.map((item) => [item.id, item]));
  const enabledCategoryIds = [...new Set(config.navigation.enabledCategoryIds)]
    .filter((categoryId) => itemById.has(categoryId));
  const rootFolders = Array.isArray(next.folders) ? next.folders : [];
  const nonProjectorFolders = stripProjectorFolders(rootFolders).folders;
  const livePresentations = liveFolderPresentations(rootFolders);
  const storedPresentations = objectValue(next.dynamicProjection?.folderPresentation);
  const usedIds = collectFolderIds(nonProjectorFolders);

  const presentationByKey = new Map();
  const presentationFor = (key, fallbackId) => {
    const live = livePresentations.get(key);
    const stored = normalizedPresentation(storedPresentations[key], fallbackId);
    const value = live || stored;
    return { id: value.id, collapsed: value.collapsed !== false };
  };

  const uncategoryPresentation = presentationFor(
    UNCATEGORY_SEMANTIC_KEY,
    'folder_uncategorised'
  );
  // Uncategory has a fixed public identity; a legacy alternative contributes
  // only its disclosure state.
  uncategoryPresentation.id = uniqueFolderId(
    'folder_uncategorised',
    'folder_uncategorised',
    usedIds
  );
  presentationByKey.set(UNCATEGORY_SEMANTIC_KEY, uncategoryPresentation);

  for (const item of categoryItems) {
    const key = categorySemanticKey(item.id);
    const fallbackId = categoryNavigation.dynamicFolderId(item.id);
    const presentation = presentationFor(key, fallbackId);
    presentation.id = uniqueFolderId(presentation.id, fallbackId, usedIds);
    presentationByKey.set(key, presentation);
  }

  const categoryMemberships = new Map(enabledCategoryIds.map((categoryId) => [categoryId, []]));
  const uncategoryPageIds = [];
  for (const page of pages) {
    const categories = pageCategories(page);
    if (!categories.length) uncategoryPageIds.push(page.id);
    for (const categoryId of categories) {
      if (categoryMemberships.has(categoryId)) categoryMemberships.get(categoryId).push(page.id);
    }
  }

  const uncategoryFolder = {
    id: uncategoryPresentation.id,
    label: 'Uncategory',
    type: 'system',
    pinned: true,
    stickOnTop: false,
    collapsed: uncategoryPresentation.collapsed,
    defaultPageId: null,
    pinnedPageIds: [],
    pageOrder: [],
    excludeFromRoot: config.navigation.collapseUncategorisedPages,
    source: { kind: 'missingCategories' },
    projectedPageIds: uncategoryPageIds,
    children: []
  };

  const categoryFolders = enabledCategoryIds.map((categoryId) => {
    const item = itemById.get(categoryId);
    const presentation = presentationByKey.get(categorySemanticKey(categoryId));
    return {
      id: presentation.id,
      label: item?.label || categoryId,
      type: 'system',
      pinned: true,
      stickOnTop: false,
      collapsed: presentation.collapsed,
      defaultPageId: null,
      pinnedPageIds: [],
      pageOrder: [],
      excludeFromRoot: true,
      source: { kind: 'categoryAny', categoryIds: [categoryId] },
      projectedPageIds: categoryMemberships.get(categoryId) || [],
      children: []
    };
  });

  const folderPresentation = {};
  for (const [key, value] of presentationByKey) folderPresentation[key] = value;
  next.folders = [uncategoryFolder, ...categoryFolders, ...nonProjectorFolders];
  next.dynamicProjection = {
    version: DYNAMIC_PROJECTION_VERSION,
    pages: projectedPagesObject(pages),
    folderPresentation
  };
  next.items = rebuildRootItems(next, pages);

  return resultFor(source, next, 'rebuild', {
    pageCount: pages.length,
    dynamicFolderCount: categoryFolders.length + 1
  });
}

function updatePages({
  navigation = {},
  categoryConfig = {},
  pageIndex = { pages: [] },
  previousPageIndex = { pages: [] },
  changes = null,
  changedPageIds = null,
  deletedPageIds = null,
  changeSet = null
} = {}) {
  if (needsMigration(navigation)) {
    return rebuild({ navigation, categoryConfig, pageIndex });
  }

  const source = clone(navigation);
  const next = clone(navigation);
  const pageChanges = normalizeChangeList(
    {
      changes,
      changeSet,
      changedPageIds,
      deletedPageIds,
      previousPageIndex,
      pageIndex
    }
  );
  const foldersByKey = activeCategoryFolderMap(next.folders);
  const projectionPages = {
    ...objectValue(next.dynamicProjection?.pages)
  };
  let projectedPageOrder = null;
  const pageOrder = () => {
    if (!projectedPageOrder) {
      projectedPageOrder = new Map(
        Object.keys(projectionPages).map((pageId, index) => [pageId, index])
      );
    }
    return projectedPageOrder;
  };
  const rootRelevantPageIds = new Set();
  let membershipChangeCount = 0;
  let presentationChangeCount = 0;

  for (const change of pageChanges) {
    const { id } = change;
    const after = change.after || null;
    if (!after) {
      if (Object.hasOwn(projectionPages, id)) {
        delete projectionPages[id];
        presentationChangeCount += 1;
      }
      let removedMembership = false;
      for (const folder of foldersByKey.values()) {
        const previousIds = Array.isArray(folder.projectedPageIds) ? folder.projectedPageIds : [];
        const nextIds = previousIds.filter((pageId) => pageId !== id);
        if (nextIds.length !== previousIds.length) removedMembership = true;
        folder.projectedPageIds = nextIds;
      }
      if (removedMembership) membershipChangeCount += 1;
      rootRelevantPageIds.add(id);
      continue;
    }

    const presentation = pagePresentation(after);
    if (!isDeepStrictEqual(projectionPages[id], presentation)) {
      projectionPages[id] = presentation;
      presentationChangeCount += 1;
    }

    if (change.membershipChanged === false) continue;
    const currentKeys = currentMembershipKeys(id, foldersByKey);
    const desiredKeys = desiredMembershipKeys(after, foldersByKey);
    const explicitMembershipChange = change.membershipChanged === true;
    const membershipChanged = explicitMembershipChange || !setsEqual(currentKeys, desiredKeys);
    if (!membershipChanged) continue;

    for (const [key, folder] of foldersByKey) {
      const pageIds = (Array.isArray(folder.projectedPageIds) ? folder.projectedPageIds : [])
        .filter((pageId) => pageId !== id);
      if (desiredKeys.has(key)) insertProjectedPageId(pageIds, id, pageOrder());
      folder.projectedPageIds = pageIds;
    }
    membershipChangeCount += 1;
    rootRelevantPageIds.add(id);
  }

  next.dynamicProjection.pages = projectionPages;
  if (rootRelevantPageIds.size) {
    const validPageIds = new Set(Object.keys(projectionPages));
    const manualIds = manualPageIds(next.folders);
    const roles = bindingRoles(next);
    const rootItems = [];
    const seen = new Set();
    for (const pageId of next.items || []) {
      if (typeof pageId !== 'string' || seen.has(pageId) || !validPageIds.has(pageId)) continue;
      if (rootRelevantPageIds.has(pageId)
        && !pageEligibleAtRoot(pageId, next, validPageIds, manualIds, roles)) continue;
      seen.add(pageId);
      rootItems.push(pageId);
    }
    for (const pageId of Object.keys(projectionPages)) {
      if (!rootRelevantPageIds.has(pageId) || seen.has(pageId)
        || !pageEligibleAtRoot(pageId, next, validPageIds, manualIds, roles)) continue;
      seen.add(pageId);
      rootItems.push(pageId);
    }
    next.items = rootItems;
  }

  return resultFor(source, next, 'incremental', {
    changedPageIds: pageChanges.map((change) => change.id),
    membershipChangeCount,
    presentationChangeCount
  });
}

function apply(options = {}) {
  const changeSet = objectValue(options.changeSet);
  if (options.forceRebuild === true || changeSet.forceRebuild === true
    || options.categoryConfigurationChanged === true
    || changeSet.categoryConfigurationChanged === true
    || needsMigration(options.navigation)) {
    return rebuild(options);
  }
  return updatePages(options);
}

function checkIntegrity(options = {}) {
  const source = clone(options.navigation || {});
  const expected = rebuild(options).navigation;
  const ok = isDeepStrictEqual(source, expected);
  return {
    ok,
    drift: !ok,
    expectedNavigation: expected
  };
}

module.exports = Object.freeze({
  CATEGORY_SEMANTIC_PREFIX,
  DYNAMIC_PROJECTION_VERSION,
  UNCATEGORY_SEMANTIC_KEY,
  apply,
  categorySemanticKey,
  checkIntegrity,
  needsMigration,
  rebuild,
  updatePages
});
