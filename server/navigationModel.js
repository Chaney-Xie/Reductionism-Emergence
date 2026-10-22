const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

// Navigation and display-title invariants are kept together so normalization,
// drag/drop mutations, and ID/title generation share one source of truth.
function createNavigationModel({ pagesDir, pageDateStamp }) {
  const PAGES_DIR = pagesDir;

  function uncategorisedFolder() {
    return {
      id: 'folder_uncategorised',
      label: 'Uncategory',
      type: 'system',
      pinned: true,
      stickOnTop: false,
      collapsed: true,
      defaultPageId: null,
      pinnedPageIds: [],
      pageOrder: [],
      projectedPageIds: [],
      excludeFromRoot: true,
      source: { kind: 'missingCategories' },
      children: []
    };
  }

  function compareStableIds(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function normalizedBindingId(rawId, leaderPageId, usedIds, reservedIds) {
    const candidate = typeof rawId === 'string' ? rawId.trim() : '';
    if (candidate && !usedIds.has(candidate)) return candidate;

    const base = `binding_${leaderPageId}`;
    let generated = base;
    let suffix = 2;
    while (usedIds.has(generated) || reservedIds.has(generated)) {
      generated = `${base}_${suffix}`;
      suffix += 1;
    }
    return generated;
  }

  function normalizeBindings(value, validPageIds) {
    if (!Array.isArray(value)) return [];

    // Preserve valid persisted IDs when malformed groups need an ID repair.
    const reservedIds = new Set(value
      .map((binding) => (typeof binding?.id === 'string' ? binding.id.trim() : ''))
      .filter(Boolean));
    const usedBindingIds = new Set();
    const candidates = [];

    for (const rawBinding of value) {
      if (!rawBinding || typeof rawBinding !== 'object' || Array.isArray(rawBinding)) continue;
      const leaderPageId = typeof rawBinding.leaderPageId === 'string'
        ? rawBinding.leaderPageId
        : null;
      if (!leaderPageId || !validPageIds.has(leaderPageId)) continue;

      const localFollowerIds = new Set();
      const followerPageIds = [];
      for (const pageId of Array.isArray(rawBinding.followerPageIds)
        ? rawBinding.followerPageIds
        : []) {
        if (typeof pageId !== 'string'
          || pageId === leaderPageId
          || !validPageIds.has(pageId)
          || localFollowerIds.has(pageId)) {
          continue;
        }
        localFollowerIds.add(pageId);
        followerPageIds.push(pageId);
      }
      if (!followerPageIds.length) continue;

      candidates.push({
        rawId: rawBinding.id,
        leaderPageId,
        followerPageIds: followerPageIds.sort(compareStableIds)
      });
    }

    // Corruption never acquires ownership by array position. If a Page is
    // claimed by more than one candidate (including Leader/Follower cross-role
    // claims or duplicate Leader groups), every conflicting group is released.
    const membershipCounts = new Map();
    for (const candidate of candidates) {
      for (const pageId of [candidate.leaderPageId, ...candidate.followerPageIds]) {
        membershipCounts.set(pageId, (membershipCounts.get(pageId) || 0) + 1);
      }
    }

    const bindings = [];
    for (const candidate of candidates) {
      const memberIds = [candidate.leaderPageId, ...candidate.followerPageIds];
      if (memberIds.some((pageId) => membershipCounts.get(pageId) > 1)) continue;
      const id = normalizedBindingId(
        candidate.rawId,
        candidate.leaderPageId,
        usedBindingIds,
        reservedIds
      );
      usedBindingIds.add(id);
      bindings.push({
        id,
        leaderPageId: candidate.leaderPageId,
        // Membership order has no display meaning; live Sidebar sort owns it.
        followerPageIds: candidate.followerPageIds
      });
    }

    return bindings;
  }

  function bindingForPage(navigation, pageId) {
    if (typeof pageId !== 'string') return null;
    for (const binding of navigation?.bindings || []) {
      if (!binding || typeof binding !== 'object') continue;
      if (binding.leaderPageId === pageId) return { binding, role: 'leader' };
      if (Array.isArray(binding.followerPageIds) && binding.followerPageIds.includes(pageId)) {
        return { binding, role: 'follower' };
      }
    }
    return null;
  }

  function bindingRole(navigation, pageId) {
    return bindingForPage(navigation, pageId)?.role || null;
  }

  function bindingById(navigation, bindingId) {
    return (navigation?.bindings || []).find((binding) => binding.id === bindingId) || null;
  }

  function resolveFolderPageIds(folder, pageIndex) {
    const source = folder?.source || {};

    if (source.kind === 'manual') {
      return Array.isArray(source.pageIds) ? source.pageIds : [];
    }

    if (source.kind === 'missingCategories'
      || source.kind === 'categoryAny'
      || source.kind === 'categoryAll') {
      const validPageIds = new Set((pageIndex?.pages || []).map((page) => page.id));
      return (Array.isArray(folder?.projectedPageIds) ? folder.projectedPageIds : [])
        .filter((pageId) => typeof pageId === 'string' && validPageIds.has(pageId));
    }

    return [];
  }

  function normalizeNavigationFolder(folder, context) {
    if (!folder || typeof folder !== 'object' || typeof folder.id !== 'string') return null;
    if (context.seenFolderIds.has(folder.id)) return null;
    context.seenFolderIds.add(folder.id);

    const rawSource = folder.source && typeof folder.source === 'object'
      ? folder.source
      : { kind: folder.type === 'system' ? 'missingCategories' : 'manual', pageIds: [] };
    const sourceKind = typeof rawSource.kind === 'string' ? rawSource.kind : 'manual';
    const source = { ...rawSource, kind: sourceKind };
    const normalized = {
      ...folder,
      id: folder.id,
      label: folder.label || folder.id,
      type: folder.type || 'manual',
      pinned: Boolean(folder.pinned),
      collapsed: Boolean(folder.collapsed),
      defaultPageId: null,
      stickOnTop: false,
      pinnedPageIds: Array.isArray(folder.pinnedPageIds) ? folder.pinnedPageIds : [],
      pageOrder: Array.isArray(folder.pageOrder) ? folder.pageOrder : [],
      source,
      children: []
    };

    if (normalized.source.kind === 'manual') {
      delete normalized.projectedPageIds;
      const pageIds = [];
      for (const pageId of Array.isArray(normalized.source.pageIds) ? normalized.source.pageIds : []) {
        if (typeof pageId !== 'string') continue;
        if (!context.validPageIds.has(pageId)) continue;
        if (context.followerPageIds.has(pageId)) continue;
        if (context.manualPageIds.has(pageId)) continue;
        pageIds.push(pageId);
        context.manualPageIds.add(pageId);
      }
      normalized.source.pageIds = pageIds;
      const manualFolder = normalized.type === 'manual';
      normalized.defaultPageId = manualFolder
        && typeof folder.defaultPageId === 'string'
        && pageIds.includes(folder.defaultPageId)
        ? folder.defaultPageId
        : null;
      normalized.stickOnTop = manualFolder && Boolean(folder.stickOnTop);
    } else {
      delete normalized.source.pageIds;
      normalized.projectedPageIds = [...new Set(
        (Array.isArray(folder.projectedPageIds) ? folder.projectedPageIds : [])
          .filter((pageId) => typeof pageId === 'string' && context.validPageIds.has(pageId))
      )];
      if (normalized.source.kind === 'missingCategories') {
        normalized.source = { kind: 'missingCategories' };
      } else if ((normalized.source.kind === 'categoryAny' || normalized.source.kind === 'categoryAll')) {
        normalized.source.categoryIds = Array.isArray(normalized.source.categoryIds)
          ? [...new Set(normalized.source.categoryIds.filter((categoryId) => typeof categoryId === 'string'))]
          : [];
      }
      normalized.defaultPageId = null;
      normalized.stickOnTop = false;
    }

    const children = Array.isArray(folder.children) ? folder.children : [];
    if (normalized.id !== 'folder_uncategorised') {
      normalized.children = children
        .map((child) => normalizeNavigationFolder(child, context))
        .filter(Boolean);
    }

    return normalized;
  }

  function findRawFolder(folders = [], folderId) {
    for (const folder of folders || []) {
      if (!folder || typeof folder !== 'object') continue;
      if (folder.id === folderId) return folder;
      const found = findRawFolder(folder.children || [], folderId);
      if (found) return found;
    }
    return null;
  }

  function rootFoldState(page, folders) {
    let foldedByCategory = false;
    let foldedByUncategory = false;
    for (const folder of flattenFolders(folders)) {
      if (!folderExcludesFromRoot(folder)) continue;
      if (!(folder.projectedPageIds || []).includes(page.id)) continue;
      if (folder.source?.kind === 'missingCategories') {
        foldedByUncategory = true;
        continue;
      }
      if (['categoryAny', 'categoryAll'].includes(folder.source?.kind)) foldedByCategory = true;
    }
    return { foldedByCategory, foldedByUncategory };
  }

  function rootNavigationItems(
    navigation,
    pageIndex,
    manualPageIds,
    folders,
    followerPageIds = new Set(),
    leaderPageIds = new Set(),
    pageStates = {}
  ) {
    const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
    const pagesById = new Map((pageIndex.pages || []).map((page) => [page.id, page]));

    const rootItems = [];
    const rootSeen = new Set();
    const shouldBeRoot = (pageId) => {
      const page = pagesById.get(pageId);
      if (!page
        || !validPageIds.has(pageId)
        || manualPageIds.has(pageId)
        || followerPageIds.has(pageId)) return false;
      if (pageStates?.[pageId]?.rootPlacement === true) return true;
      // Binding Leaders always retain one canonical root/manual placement.
      // Category folders remain separate derived occurrences.
      if (leaderPageIds.has(pageId)) return true;
      const { foldedByCategory, foldedByUncategory } = rootFoldState(page, folders);
      return !foldedByCategory && !foldedByUncategory;
    };

    for (const item of navigation.items || []) {
      if (typeof item !== 'string' || rootSeen.has(item) || !shouldBeRoot(item)) continue;
      rootItems.push(item);
      rootSeen.add(item);
    }

    for (const page of pageIndex.pages || []) {
      if (rootSeen.has(page.id) || !shouldBeRoot(page.id)) continue;
      rootItems.push(page.id);
      rootSeen.add(page.id);
    }

    return rootItems;
  }

  function folderExcludesFromRoot(folder) {
    if (typeof folder.excludeFromRoot === 'boolean') return folder.excludeFromRoot;
    return folder.source?.kind === 'missingCategories'
      || folder.source?.kind === 'categoryAny'
      || folder.source?.kind === 'categoryAll';
  }

  function isPageCapturedByDynamicFolder(pageId, navigation, pageIndex) {
    const page = (pageIndex.pages || []).find((candidate) => candidate.id === pageId);
    if (!page) return false;
    const state = rootFoldState(page, navigation.folders || []);
    return state.foldedByCategory || state.foldedByUncategory;
  }

  function normalizeNavigation(navigation = {}, pageIndex = { pages: [] }) {
    const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
    const bindings = normalizeBindings(navigation.bindings, validPageIds);
    const followerPageIds = new Set(bindings.flatMap((binding) => binding.followerPageIds));
    const leaderPageIds = new Set(bindings.map((binding) => binding.leaderPageId));
    const rawFolders = Array.isArray(navigation.folders) ? navigation.folders : [];
    const rawUncategorised = findRawFolder(rawFolders, 'folder_uncategorised') || uncategorisedFolder();
    const context = {
      validPageIds,
      seenFolderIds: new Set(),
      manualPageIds: new Set(),
      followerPageIds
    };

    const uncategorised = normalizeNavigationFolder({
      ...uncategorisedFolder(),
      ...rawUncategorised,
      id: 'folder_uncategorised',
      label: rawUncategorised.label || 'Uncategory',
      type: 'system',
      pinned: true,
      excludeFromRoot: typeof rawUncategorised.excludeFromRoot === 'boolean'
        ? rawUncategorised.excludeFromRoot
        : true,
      source: { kind: 'missingCategories' },
      children: []
    }, context) || uncategorisedFolder();
    uncategorised.collapsed = rawUncategorised.collapsed !== false;

    const folders = [uncategorised];
    for (const folder of rawFolders) {
      if (folder?.id === 'folder_uncategorised') continue;
      const normalizedFolder = normalizeNavigationFolder(folder, context);
      if (normalizedFolder) folders.push(normalizedFolder);
    }

    const pageStates = normalizePageStates(navigation.pageStates, validPageIds);
    const stateNavigation = { pageStates };
    for (const pageId of followerPageIds) setPageRootPlacement(stateNavigation, pageId, false);
    for (const pageId of context.manualPageIds) setPageRootPlacement(stateNavigation, pageId, false);
    for (const pageId of leaderPageIds) {
      if (!context.manualPageIds.has(pageId)) setPageRootPlacement(stateNavigation, pageId, true);
    }

    const normalized = {
      ...navigation,
      version: 3,
      folders,
      bindings,
      pageStates
    };

    normalized.folders.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    normalized.items = rootNavigationItems(
      navigation,
      pageIndex,
      context.manualPageIds,
      normalized.folders,
      followerPageIds,
      leaderPageIds,
      pageStates
    );
    return normalized;
  }

  function normalizePageStates(value, validPageIds) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = {};
    for (const [pageId, state] of Object.entries(value)) {
      if (!validPageIds.has(pageId) || !state || typeof state !== 'object') continue;
      const nextState = {};
      if (state.stickOnTop === true) nextState.stickOnTop = true;
      if (state.rootPlacement === true) nextState.rootPlacement = true;
      if (Object.keys(nextState).length) normalized[pageId] = nextState;
    }
    return normalized;
  }

  function pageStickOnTop(navigation, pageId) {
    return navigation?.pageStates?.[pageId]?.stickOnTop === true;
  }

  function pageRootPlacement(navigation, pageId) {
    return navigation?.pageStates?.[pageId]?.rootPlacement === true;
  }

  function setPageStateFlag(navigation, pageId, key, enabled) {
    if (!navigation.pageStates || typeof navigation.pageStates !== 'object') {
      navigation.pageStates = {};
    }
    const state = navigation.pageStates[pageId]
      && typeof navigation.pageStates[pageId] === 'object'
      ? { ...navigation.pageStates[pageId] }
      : {};
    if (enabled) state[key] = true;
    else delete state[key];
    if (Object.keys(state).length) navigation.pageStates[pageId] = state;
    else delete navigation.pageStates[pageId];
  }

  function setPageStickOnTop(navigation, pageId, enabled) {
    setPageStateFlag(navigation, pageId, 'stickOnTop', enabled);
  }

  function setPageRootPlacement(navigation, pageId, enabled) {
    setPageStateFlag(navigation, pageId, 'rootPlacement', enabled);
  }

  function cloneNavigation(navigation) {
    return JSON.parse(JSON.stringify(navigation || {}));
  }

  function bindingMutationSource(navigation, pageIndex) {
    return normalizeNavigation(cloneNavigation(navigation), pageIndex);
  }

  function bindingMutationError(source, error) {
    return {
      changed: false,
      error,
      binding: null,
      releasedPageIds: [],
      navigation: source
    };
  }

  function bindingMutationSuccess(
    source,
    next,
    pageIndex,
    { bindingId = null, releasedPageIds = [] } = {}
  ) {
    const navigation = normalizeNavigation(next, pageIndex);
    return {
      changed: JSON.stringify(navigation) !== JSON.stringify(source),
      error: null,
      binding: bindingId ? bindingById(navigation, bindingId) : null,
      releasedPageIds,
      navigation
    };
  }

  function normalizedBindingSelection(rawPageIds) {
    if (!Array.isArray(rawPageIds) || !rawPageIds.length) {
      return { error: 'Select at least one unbound Page to bind.', pageIds: [] };
    }
    const pageIds = [];
    const seen = new Set();
    for (const pageId of rawPageIds) {
      if (typeof pageId !== 'string' || !pageId) {
        return { error: 'The Binding selection contains an invalid Page.', pageIds: [] };
      }
      if (seen.has(pageId)) continue;
      seen.add(pageId);
      pageIds.push(pageId);
    }
    return { error: null, pageIds };
  }

  function canonicalPageLocation(navigation, pageId) {
    const manual = findManualPageLocation(navigation.folders || [], pageId);
    if (manual) {
      return {
        kind: 'manual',
        folderId: manual.folder.id,
        index: manual.index
      };
    }
    const index = (navigation.items || []).indexOf(pageId);
    return index >= 0 ? { kind: 'root', folderId: null, index } : null;
  }

  function removeCanonicalPagePlacement(navigation, pageId) {
    removePageFromManualFolders(navigation.folders || [], pageId);
    navigation.items = (navigation.items || []).filter((candidate) => candidate !== pageId);
    setPageRootPlacement(navigation, pageId, false);
  }

  function canonicalLocationPageIds(navigation, location) {
    if (location?.kind === 'manual') {
      const folder = findFolderLocation(navigation.folders || [], location.folderId)?.folder;
      if (!folder || folder.type !== 'manual' || folder.source?.kind !== 'manual') return null;
      return manualFolderPageIds(folder);
    }
    if (location?.kind === 'root') {
      if (!Array.isArray(navigation.items)) navigation.items = [];
      return navigation.items;
    }
    return null;
  }

  function placePageAtCanonicalLocation(navigation, pageId, location) {
    removeCanonicalPagePlacement(navigation, pageId);
    const pageIds = canonicalLocationPageIds(navigation, location);
    if (!pageIds) return false;
    insertAtIndex(pageIds, pageId, location.index);
    if (location.kind === 'root') setPageRootPlacement(navigation, pageId, true);
    return true;
  }

  function releasePagesAfterLeader(navigation, leaderPageId, followerPageIds, location) {
    for (const pageId of followerPageIds) removeCanonicalPagePlacement(navigation, pageId);
    const pageIds = canonicalLocationPageIds(navigation, location);
    if (!pageIds) return false;
    const leaderIndex = pageIds.indexOf(leaderPageId);
    let insertionIndex = leaderIndex >= 0
      ? leaderIndex + 1
      : Math.min(location.index, pageIds.length);
    for (const pageId of followerPageIds) {
      pageIds.splice(insertionIndex, 0, pageId);
      if (location.kind === 'root') setPageRootPlacement(navigation, pageId, true);
      insertionIndex += 1;
    }
    return true;
  }

  function uniqueBindingId(navigation) {
    const usedIds = new Set((navigation.bindings || []).map((binding) => binding.id));
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const id = `binding_${randomUUID().replaceAll('-', '')}`;
      if (!usedIds.has(id)) return id;
    }
    throw new Error('Could not generate a unique Binding ID.');
  }

  function validateUnboundBindingMembers(source, pageIndex, pageIds) {
    const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
    for (const pageId of pageIds) {
      if (!validPageIds.has(pageId)) return 'A selected Page no longer exists.';
      if (bindingRole(source, pageId)) {
        return 'Bind to Leader only accepts ordinary unbound Pages.';
      }
    }
    return null;
  }

  function createBinding(navigation, pageIndex, selectedPageIds, leaderPageId) {
    const source = bindingMutationSource(navigation, pageIndex);
    const selection = normalizedBindingSelection(selectedPageIds);
    if (selection.error) return bindingMutationError(source, selection.error);
    if (typeof leaderPageId !== 'string' || !leaderPageId) {
      return bindingMutationError(source, 'The target Leader is invalid.');
    }
    if (selection.pageIds.includes(leaderPageId)) {
      return bindingMutationError(source, 'The target Leader cannot be part of the source selection.');
    }
    const memberError = validateUnboundBindingMembers(
      source,
      pageIndex,
      [leaderPageId, ...selection.pageIds]
    );
    if (memberError) return bindingMutationError(source, memberError);
    if (!canonicalPageLocation(source, leaderPageId)) {
      return bindingMutationError(
        source,
        'The target Page has no canonical root/manual navigation placement.'
      );
    }

    const next = cloneNavigation(source);
    for (const pageId of selection.pageIds) removeCanonicalPagePlacement(next, pageId);
    const id = uniqueBindingId(next);
    next.bindings.push({
      id,
      leaderPageId,
      followerPageIds: [...selection.pageIds]
    });
    return bindingMutationSuccess(source, next, pageIndex, { bindingId: id });
  }

  function addFollowers(navigation, pageIndex, leaderPageId, selectedPageIds) {
    const source = bindingMutationSource(navigation, pageIndex);
    const leaderInfo = bindingForPage(source, leaderPageId);
    if (!leaderInfo || leaderInfo.role !== 'leader') {
      return bindingMutationError(source, 'The target Page is not a Binding Leader.');
    }
    const selection = normalizedBindingSelection(selectedPageIds);
    if (selection.error) return bindingMutationError(source, selection.error);
    if (selection.pageIds.includes(leaderPageId)) {
      return bindingMutationError(source, 'The target Leader cannot be part of the source selection.');
    }
    const memberError = validateUnboundBindingMembers(source, pageIndex, selection.pageIds);
    if (memberError) return bindingMutationError(source, memberError);
    if (!canonicalPageLocation(source, leaderPageId)) {
      return bindingMutationError(source, 'The Binding Leader has no canonical navigation placement.');
    }

    const next = cloneNavigation(source);
    for (const pageId of selection.pageIds) removeCanonicalPagePlacement(next, pageId);
    const binding = bindingById(next, leaderInfo.binding.id);
    binding.followerPageIds.push(...selection.pageIds);
    return bindingMutationSuccess(source, next, pageIndex, { bindingId: binding.id });
  }

  function removeFollower(navigation, pageIndex, followerPageId) {
    const source = bindingMutationSource(navigation, pageIndex);
    const followerInfo = bindingForPage(source, followerPageId);
    if (!followerInfo || followerInfo.role !== 'follower') {
      return bindingMutationError(source, 'The Page is not a Binding Follower.');
    }
    const location = canonicalPageLocation(source, followerInfo.binding.leaderPageId);
    if (!location) {
      return bindingMutationError(source, 'The Binding Leader has no canonical navigation placement.');
    }

    const next = cloneNavigation(source);
    const binding = bindingById(next, followerInfo.binding.id);
    binding.followerPageIds = binding.followerPageIds.filter((id) => id !== followerPageId);
    if (!binding.followerPageIds.length) {
      next.bindings = next.bindings.filter((candidate) => candidate.id !== binding.id);
    }
    releasePagesAfterLeader(next, binding.leaderPageId, [followerPageId], location);
    return bindingMutationSuccess(source, next, pageIndex, {
      bindingId: binding.followerPageIds.length ? binding.id : null,
      releasedPageIds: [followerPageId]
    });
  }

  function setBindingLeader(navigation, pageIndex, followerPageId) {
    const source = bindingMutationSource(navigation, pageIndex);
    const followerInfo = bindingForPage(source, followerPageId);
    if (!followerInfo || followerInfo.role !== 'follower') {
      return bindingMutationError(source, 'Only a Binding Follower can be set as Leader.');
    }
    const oldLeaderPageId = followerInfo.binding.leaderPageId;
    const location = canonicalPageLocation(source, oldLeaderPageId);
    if (!location) {
      return bindingMutationError(source, 'The Binding Leader has no canonical navigation placement.');
    }

    const next = cloneNavigation(source);
    const binding = bindingById(next, followerInfo.binding.id);
    binding.leaderPageId = followerPageId;
    binding.followerPageIds = [
      oldLeaderPageId,
      ...binding.followerPageIds.filter((pageId) => pageId !== followerPageId)
    ];
    removeCanonicalPagePlacement(next, oldLeaderPageId);
    if (!placePageAtCanonicalLocation(next, followerPageId, location)) {
      return bindingMutationError(source, 'The Binding placement no longer exists.');
    }
    return bindingMutationSuccess(source, next, pageIndex, { bindingId: binding.id });
  }

  function dissolveBinding(navigation, pageIndex, bindingId) {
    const source = bindingMutationSource(navigation, pageIndex);
    const binding = bindingById(source, bindingId);
    if (!binding) return bindingMutationError(source, 'The Binding no longer exists.');
    const location = canonicalPageLocation(source, binding.leaderPageId);
    if (!location) {
      return bindingMutationError(source, 'The Binding Leader has no canonical navigation placement.');
    }

    const next = cloneNavigation(source);
    next.bindings = next.bindings.filter((candidate) => candidate.id !== binding.id);
    releasePagesAfterLeader(next, binding.leaderPageId, binding.followerPageIds, location);
    return bindingMutationSuccess(source, next, pageIndex, {
      releasedPageIds: [...binding.followerPageIds]
    });
  }

  function cleanupBindingForDeletedPage(navigation, pageIndex, pageId) {
    const source = bindingMutationSource(navigation, pageIndex);
    const info = bindingForPage(source, pageId);
    if (!info) return bindingMutationError(source, null);

    const next = cloneNavigation(source);
    const binding = bindingById(next, info.binding.id);
    let releasedPageIds = [];
    if (info.role === 'follower') {
      binding.followerPageIds = binding.followerPageIds.filter((id) => id !== pageId);
      if (!binding.followerPageIds.length) {
        next.bindings = next.bindings.filter((candidate) => candidate.id !== binding.id);
      }
    } else {
      const location = canonicalPageLocation(source, binding.leaderPageId);
      releasedPageIds = [...binding.followerPageIds];
      next.bindings = next.bindings.filter((candidate) => candidate.id !== binding.id);
      if (location) releasePagesAfterLeader(next, binding.leaderPageId, releasedPageIds, location);
    }

    const pageIndexAfterDelete = {
      ...pageIndex,
      pages: (pageIndex.pages || []).filter((page) => page.id !== pageId)
    };
    return bindingMutationSuccess(source, next, pageIndexAfterDelete, { releasedPageIds });
  }


  function uniqueUntitledTitle(pages) {
    return makeUniquePageTitle({ pages }, 'Untitled');
  }

  function normalizePageTitleForCompare(title) {
    return String(title || '').trim().toLowerCase();
  }

  function titleFamilyBase(title) {
    return String(title || '').trim().replace(/\s\|\s[1-9]\d*$/, '').trim();
  }

  function uniqueLabelFamilyBase(label) {
    return String(label || '').trim().replace(/\s\|\s[1-9]\d*$/, '').trim();
  }

  function pageTitleExistsInIndex(pageIndex, title, exceptPageId = null) {
    const normalizedTitle = normalizePageTitleForCompare(title);
    return (pageIndex.pages || []).some((page) => (
      page.id !== exceptPageId
      && normalizePageTitleForCompare(page.title) === normalizedTitle
    ));
  }

  function makeUniquePageTitle(pageIndex, title, exceptPageId = null) {
    const trimmedTitle = String(title || '').trim();
    if (!pageTitleExistsInIndex(pageIndex, trimmedTitle, exceptPageId)) return trimmedTitle;

    const baseTitle = titleFamilyBase(trimmedTitle) || 'Untitled';
    for (let number = 1; number < 10000; number += 1) {
      const candidate = `${baseTitle} | ${number}`;
      if (!pageTitleExistsInIndex(pageIndex, candidate, exceptPageId)) return candidate;
    }

    throw new Error('Could not generate a unique page title.');
  }

  function flattenFolders(folders = [], result = []) {
    for (const folder of folders || []) {
      if (!folder || typeof folder !== 'object') continue;
      result.push(folder);
      flattenFolders(folder.children, result);
    }
    return result;
  }

  function folderLabelExists(navigation, label, exceptFolderId = null) {
    const normalizedLabel = normalizePageTitleForCompare(label);
    return flattenFolders(navigation.folders).some((folder) => (
      folder.id !== exceptFolderId
      && normalizePageTitleForCompare(folder.label) === normalizedLabel
    ));
  }

  function makeUniqueFolderLabel(navigation, label, exceptFolderId = null) {
    const trimmedLabel = String(label || '').trim() || 'New folder';
    if (!folderLabelExists(navigation, trimmedLabel, exceptFolderId)) return trimmedLabel;

    const baseLabel = uniqueLabelFamilyBase(trimmedLabel) || 'New folder';
    for (let number = 1; number < 10000; number += 1) {
      const candidate = `${baseLabel} | ${number}`;
      if (!folderLabelExists(navigation, candidate, exceptFolderId)) return candidate;
    }

    throw new Error('Could not generate a unique folder label.');
  }

  function findFolderLocation(folders, folderId, parent = null) {
    for (let index = 0; index < (folders || []).length; index += 1) {
      const folder = folders[index];
      if (folder.id === folderId) return { folder, parent, siblings: folders, index };
      const found = findFolderLocation(folder.children || [], folderId, folder);
      if (found) return found;
    }
    return null;
  }

  function folderContainsFolder(folder, folderId) {
    return Boolean(findFolderLocation(folder.children || [], folderId, folder));
  }

  function removePageFromManualFolders(folders, pageId, { clearDefault = true } = {}) {
    for (const folder of folders || []) {
      if (folder.source?.kind === 'manual') {
        folder.source.pageIds = (folder.source.pageIds || []).filter((id) => id !== pageId);
        if (clearDefault && folder.defaultPageId === pageId) folder.defaultPageId = null;
      }
      removePageFromManualFolders(folder.children || [], pageId, { clearDefault });
    }
  }

  function findManualPageLocation(folders, pageId) {
    for (const folder of folders || []) {
      if (folder.source?.kind === 'manual') {
        const pageIds = folder.source.pageIds || [];
        const index = pageIds.indexOf(pageId);
        if (index >= 0) return { folder, pageIds, index };
      }
      const childLocation = findManualPageLocation(folder.children || [], pageId);
      if (childLocation) return childLocation;
    }
    return null;
  }

  function removeFolderById(folders, folderId) {
    const location = findFolderLocation(folders, folderId);
    if (!location) return null;
    const [folder] = location.siblings.splice(location.index, 1);
    return folder;
  }

  function collectFolderPageIds(folder, result = []) {
    if (!folder || typeof folder !== 'object') return result;
    if (folder.source?.kind === 'manual') {
      for (const pageId of folder.source.pageIds || []) {
        if (typeof pageId === 'string') result.push(pageId);
      }
    }
    for (const child of folder.children || []) collectFolderPageIds(child, result);
    return result;
  }

  function manualFolderPageIds(folder) {
    if (!Array.isArray(folder.source?.pageIds)) folder.source.pageIds = [];
    return folder.source.pageIds;
  }

  function insertAtIndex(list, item, index) {
    const insertIndex = Number.isInteger(index) && index >= 0
      ? Math.min(index, list.length)
      : list.length;
    list.splice(insertIndex, 0, item);
  }

  function adjustedInsertIndex(index, oldIndex, sameList) {
    if (!sameList || !Number.isInteger(oldIndex) || !Number.isInteger(index)) return index;
    return oldIndex < index ? index - 1 : index;
  }

  function navigationMoveItem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') return null;
    const type = rawItem.type || rawItem.itemType;
    const id = rawItem.id || (type === 'page' ? rawItem.pageId : rawItem.folderId);
    if (!['page', 'folder'].includes(type) || typeof id !== 'string' || !id) return null;
    return { type, id };
  }

  function navigationMoveItemKey(item) {
    return `${item.type}:${item.id}`;
  }

  function resolvedFolderPageIds(folder, pageIndex, result = new Set()) {
    for (const pageId of resolveFolderPageIds(folder, pageIndex)) result.add(pageId);
    for (const child of folder.children || []) resolvedFolderPageIds(child, pageIndex, result);
    return result;
  }

  function navigationMoveVisibleOrder(navigation, pageIndex) {
    const order = [];
    const seen = new Set();
    const add = (item) => {
      const key = navigationMoveItemKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      order.push(key);
    };
    const visitFolder = (folder) => {
      add({ type: 'folder', id: folder.id });
      for (const pageId of resolveFolderPageIds(folder, pageIndex)) add({ type: 'page', id: pageId });
      for (const child of folder.children || []) visitFolder(child);
    };
    for (const folder of navigation.folders || []) visitFolder(folder);
    for (const pageId of navigation.items || []) add({ type: 'page', id: pageId });
    return order;
  }

  function normalizeNavigationMoveSelection(navigation, pageIndex, rawItems) {
    if (!Array.isArray(rawItems) || !rawItems.length) {
      return { error: 'Select at least one page or folder to move.', items: [] };
    }
    const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
    const unique = [];
    const seen = new Set();
    for (const rawItem of rawItems) {
      const item = navigationMoveItem(rawItem);
      if (!item) return { error: 'The move selection contains an invalid item.', items: [] };
      const key = navigationMoveItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.type === 'page') {
        if (!validPageIds.has(item.id)) return { error: 'A selected page no longer exists.', items: [] };
        if (bindingRole(navigation, item.id) === 'follower') {
          return {
            error: 'A bound Follower cannot move independently. Stop Binding first.',
            items: []
          };
        }
      } else {
        const location = findFolderLocation(navigation.folders, item.id);
        if (!location) return { error: 'A selected folder no longer exists.', items: [] };
        if (location.folder.type !== 'manual') {
          return { error: 'System folders cannot be moved.', items: [] };
        }
      }
      unique.push(item);
    }

    const selectedFolderIds = new Set(unique
      .filter((item) => item.type === 'folder')
      .map((item) => item.id));
    const highestFolderIds = new Set();
    for (const folderId of selectedFolderIds) {
      const location = findFolderLocation(navigation.folders, folderId);
      let parent = location?.parent || null;
      let covered = false;
      while (parent) {
        if (selectedFolderIds.has(parent.id)) {
          covered = true;
          break;
        }
        parent = findFolderLocation(navigation.folders, parent.id)?.parent || null;
      }
      if (!covered) highestFolderIds.add(folderId);
    }

    const pagesCoveredByFolders = new Set();
    for (const folderId of highestFolderIds) {
      const folder = findFolderLocation(navigation.folders, folderId)?.folder;
      if (folder) resolvedFolderPageIds(folder, pageIndex, pagesCoveredByFolders);
    }
    const effective = unique.filter((item) => (
      item.type === 'folder'
        ? highestFolderIds.has(item.id)
        : !pagesCoveredByFolders.has(item.id)
    ));
    const visibleOrder = navigationMoveVisibleOrder(navigation, pageIndex);
    const position = new Map(visibleOrder.map((key, index) => [key, index]));
    effective.sort((left, right) => (
      (position.get(navigationMoveItemKey(left)) ?? Number.MAX_SAFE_INTEGER)
      - (position.get(navigationMoveItemKey(right)) ?? Number.MAX_SAFE_INTEGER)
    ));
    return { error: null, items: effective };
  }

  function navigationMoveError(navigation, items, error) {
    return { changed: false, error, items, navigation };
  }

  function moveNavigationSelection(navigation, pageIndex, rawItems, destination = {}) {
    const source = normalizeNavigation(JSON.parse(JSON.stringify(navigation || {})), pageIndex);
    const selection = normalizeNavigationMoveSelection(source, pageIndex, rawItems);
    if (selection.error) return navigationMoveError(source, selection.items, selection.error);
    const items = selection.items;
    const parentFolderId = typeof destination.parentFolderId === 'string'
      ? destination.parentFolderId
      : null;
    const targetLocation = parentFolderId
      ? findFolderLocation(source.folders, parentFolderId)
      : null;
    const targetFolder = targetLocation?.folder || null;
    if (parentFolderId && (!targetFolder
      || targetFolder.type !== 'manual'
      || targetFolder.source?.kind !== 'manual')) {
      return navigationMoveError(source, items, 'Items can only be moved into root or manual folders.');
    }
    for (const item of items) {
      if (item.type !== 'folder' || !targetFolder) continue;
      const folder = findFolderLocation(source.folders, item.id)?.folder;
      if (item.id === targetFolder.id) {
        return navigationMoveError(source, items, 'A folder cannot be moved into itself.');
      }
      if (folder && folderContainsFolder(folder, targetFolder.id)) {
        return navigationMoveError(source, items, 'A folder cannot be moved into its descendant.');
      }
    }

    const sourceParentByPageId = new Map(items
      .filter((item) => item.type === 'page')
      .map((item) => [item.id, findManualPageLocation(source.folders, item.id)?.folder?.id || null]));
    const requestedIndex = Number.isInteger(destination.index) && destination.index >= 0
      ? destination.index
      : null;
    const area = destination.area === 'folders' ? 'folders' : destination.area === 'pages' ? 'pages' : null;
    const stationaryItemKeys = new Set();
    if (requestedIndex === null) {
      for (const item of items) {
        if (item.type === 'page') {
          const currentParentFolderId = sourceParentByPageId.get(item.id);
          const alreadyInTarget = parentFolderId
            ? currentParentFolderId === parentFolderId
            : currentParentFolderId === null && (source.items || []).includes(item.id);
          if (alreadyInTarget) stationaryItemKeys.add(navigationMoveItemKey(item));
          continue;
        }
        const location = findFolderLocation(source.folders, item.id);
        const currentParentFolderId = location?.parent?.id || null;
        if (location && currentParentFolderId === parentFolderId) {
          stationaryItemKeys.add(navigationMoveItemKey(item));
        }
      }
    }
    const movingItems = items.filter((item) => !stationaryItemKeys.has(navigationMoveItemKey(item)));
    const selectedPageIds = new Set(movingItems
      .filter((item) => item.type === 'page')
      .map((item) => item.id));
    const selectedFolderIds = new Set(movingItems
      .filter((item) => item.type === 'folder')
      .map((item) => item.id));
    const originalTargetPages = targetFolder ? [...manualFolderPageIds(targetFolder)] : [...(source.items || [])];
    const originalTargetFolders = targetFolder ? [...(targetFolder.children || [])] : [...(source.folders || [])];
    const preserveRootPlacementPageIds = new Set(movingItems
      .filter((item) => item.type === 'page' && (
        (!targetFolder && requestedIndex === null)
        || pageRootPlacement(source, item.id)
        || bindingRole(source, item.id) === 'leader'
      ))
      .map((item) => item.id));
    let pageInsertIndex = originalTargetPages.length;
    let folderInsertIndex = originalTargetFolders.length;
    if (requestedIndex !== null) {
      if (targetFolder) {
        pageInsertIndex = Math.min(requestedIndex, originalTargetPages.length);
        folderInsertIndex = Math.max(0, Math.min(
          requestedIndex - originalTargetPages.length,
          originalTargetFolders.length
        ));
      } else if (area === 'folders') {
        folderInsertIndex = Math.min(requestedIndex, originalTargetFolders.length);
      } else {
        pageInsertIndex = Math.min(requestedIndex, originalTargetPages.length);
      }
    }
    pageInsertIndex -= originalTargetPages
      .slice(0, pageInsertIndex)
      .filter((pageId) => selectedPageIds.has(pageId)).length;
    folderInsertIndex -= originalTargetFolders
      .slice(0, folderInsertIndex)
      .filter((folder) => selectedFolderIds.has(folder.id)).length;

    const next = JSON.parse(JSON.stringify(source));
    const movedFolders = new Map();
    for (const item of movingItems) {
      if (item.type === 'page') {
        removePageFromManualFolders(next.folders, item.id, {
          clearDefault: sourceParentByPageId.get(item.id) !== parentFolderId
        });
        next.items = (next.items || []).filter((pageId) => pageId !== item.id);
        setPageRootPlacement(next, item.id, false);
      } else {
        const movedFolder = removeFolderById(next.folders, item.id);
        if (!movedFolder) return navigationMoveError(source, items, 'A selected folder no longer exists.');
        movedFolders.set(item.id, movedFolder);
      }
    }

    const nextTarget = parentFolderId
      ? findFolderLocation(next.folders, parentFolderId)?.folder || null
      : null;
    if (parentFolderId && !nextTarget) {
      return navigationMoveError(source, items, 'The destination folder no longer exists.');
    }
    const targetPages = nextTarget ? manualFolderPageIds(nextTarget) : next.items;
    const targetFolders = nextTarget ? nextTarget.children : next.folders;
    let nextPageIndex = Math.min(pageInsertIndex, targetPages.length);
    let nextFolderIndex = Math.min(folderInsertIndex, targetFolders.length);
    for (const item of movingItems) {
      if (item.type === 'page') {
        const preserveRootPlacement = !nextTarget && preserveRootPlacementPageIds.has(item.id);
        if (nextTarget || preserveRootPlacement
          || !isPageCapturedByDynamicFolder(item.id, next, pageIndex)) {
          targetPages.splice(nextPageIndex, 0, item.id);
          if (preserveRootPlacement) setPageRootPlacement(next, item.id, true);
          nextPageIndex += 1;
        }
      } else {
        targetFolders.splice(nextFolderIndex, 0, movedFolders.get(item.id));
        nextFolderIndex += 1;
      }
    }
    const normalized = normalizeNavigation(next, pageIndex);
    return {
      changed: JSON.stringify(normalized) !== JSON.stringify(source),
      error: null,
      items: movingItems,
      navigation: normalized
    };
  }

  async function persistNavigationMove(navigation, pageIndex, rawItems, destination, write) {
    const result = moveNavigationSelection(navigation, pageIndex, rawItems, destination);
    if (result.error || !result.changed) return result;
    const saved = await write(result.navigation, pageIndex);
    return { ...result, navigation: saved };
  }

  async function uniqueDatedFolderId(navigation, date = new Date()) {
    const stamp = pageDateStamp(date);
    const usedFolderIds = new Set(flattenFolders(navigation.folders).map((folder) => folder.id));

    for (let number = 1; number < 1000; number += 1) {
      const folderId = `folder_${stamp}_${String(number).padStart(3, '0')}`;
      if (!usedFolderIds.has(folderId)) return folderId;
    }

    throw new Error('Could not generate a unique folder ID for today.');
  }

  async function uniqueDatedPageId(pages, date = new Date()) {
    const stamp = pageDateStamp(date);
    const usedPageIds = new Set((pages || []).map((page) => page.id));

    for (let number = 1; number < 1000; number += 1) {
      // Index/file scans cannot remember a deleted identity. A creation token
      // prevents a later page from inheriting the deleted page's persistent ID.
      const token = randomUUID().replaceAll('-', '').slice(0, 12);
      const pageId = `page_${stamp}_${token}`;
      const pageFile = path.join(PAGES_DIR, `${pageId}.json`);
      if (usedPageIds.has(pageId)) continue;

      try {
        await fs.access(pageFile);
      } catch (error) {
        if (error.code === 'ENOENT') return pageId;
        throw error;
      }
    }

    throw new Error('Could not generate a unique page ID for today.');
  }


  return {
    addFollowers,
    addFollowersToBinding: addFollowers,
    adjustedInsertIndex,
    bindingForPage,
    bindingRole,
    canonicalPageLocation,
    cleanupBindingForDeletedPage,
    collectFolderPageIds,
    createBinding,
    dissolveBinding,
    findFolderLocation,
    findManualPageLocation,
    flattenFolders,
    folderContainsFolder,
    insertAtIndex,
    isPageCapturedByDynamicFolder,
    makeUniqueFolderLabel,
    makeUniquePageTitle,
    manualFolderPageIds,
    moveNavigationSelection,
    normalizeBindings,
    normalizeNavigationMoveSelection,
    normalizeNavigation,
    pageStickOnTop,
    pageTitleExistsInIndex,
    persistNavigationMove,
    removeFollower,
    removeFollowerFromBinding: removeFollower,
    removeFolderById,
    removePageFromManualFolders,
    resolveFolderPageIds,
    setBindingLeader,
    setPageStickOnTop,
    uniqueDatedFolderId,
    uniqueDatedPageId,
    uniqueUntitledTitle
  };
}

module.exports = { createNavigationModel };
