/* Left navigation tree, folders, page rows, drag/drop, and navigation context menus.
 * Loaded after app.js and before event/bootstrap wiring to preserve the existing runtime order.
 */
let navigationRenameSession = null;
let navigationRenameRenderPending = false;
let navigationRenameSessionSequence = 0;
const navigationFolderToggleVersions = new Map();
const navigationFolderToggleWrites = new Map();
let pageContextSourceRow = null;
let folderContextSourceRow = null;

function protectNavigationRenameInput(input) {
  for (const eventName of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
    input.addEventListener(eventName, (event) => event.stopPropagation());
  }
}

function navigationRenameSourceRow(type, id, preferredRow = null) {
  const expectedKey = navigationSelectionKey(type, id);
  if (preferredRow?.dataset?.navigationSelectionKey === expectedKey
    && preferredRow.parentElement
    && preferredRow.isConnected !== false) return preferredRow;
  return [...pageList.querySelectorAll('[data-navigation-selection-key]')]
    .find((element) => element.dataset.navigationSelectionKey === expectedKey) || null;
}

function createNavigationRenameInput(type, item) {
  const input = document.createElement('input');
  const isFolder = type === 'folder';
  input.className = isFolder
    ? 'nav-folder-label-text nav-folder-rename-input file-typography'
    : 'nav-page-label-text nav-page-rename-input file-typography';
  if (isFolder) input.dataset.folderRenameInput = item.id;
  else input.dataset.pageRenameInput = item.id;
  input.value = isFolder
    ? (folderRenameState?.draft ?? item.label ?? item.id)
    : (pageRenameState?.draft ?? item.title);
  input.setAttribute('aria-label', isFolder ? 'Rename folder' : 'Rename page');
  bindStableNavigationRenameInput(input, {
    currentState: () => (isFolder
      ? (folderRenameState?.folderId === item.id ? folderRenameState : null)
      : (pageRenameState?.pageId === item.id ? pageRenameState : null)),
    commit: isFolder ? saveFolderRename : savePageRename,
    cancel: isFolder ? cancelFolderRename : cancelPageRename
  });
  return input;
}

function recordNavigationRenameSession({ type, item, input, row, sourceRow, parentFolderId }) {
  const parent = row?.parentElement || null;
  const session = {
    instanceId: ++navigationRenameSessionSequence,
    type,
    targetId: item.id,
    input,
    row,
    sourceRow,
    parent,
    nextSibling: row?.nextSibling || null,
    parentFolderId: parentFolderId || null,
    siblingIndex: parent ? [...parent.children].indexOf(row) : -1,
    scrollTop: navigationContextSurface?.scrollTop || 0
  };
  navigationRenameSession = session;
  navigationRenameRenderPending = false;
  queueMicrotask(() => {
    if (navigationRenameSession !== session || session.input !== input || !input.isConnected) return;
    input.focus();
    const state = type === 'folder' ? folderRenameState : pageRenameState;
    if (state?.selectAll) {
      input.select();
      state.selectAll = false;
    }
  });
}

function mountPageRenameSession(page, sourceRow, parentFolderId = null) {
  if (!sourceRow?.parentElement) return false;
  const sourceLabel = [...sourceRow.children]
    .find((child) => child.classList?.contains('nav-page-label-text')) || null;
  if (!sourceLabel) return false;
  const editorRow = document.createElement('div');
  editorRow.className = sourceRow.className;
  editorRow.classList.add('nav-page-renaming');
  Object.assign(editorRow.dataset, sourceRow.dataset);
  editorRow.draggable = false;
  editorRow.append(...[...sourceRow.children]);
  const input = createNavigationRenameInput('page', page);
  const editorLabel = [...editorRow.children]
    .find((child) => child.classList?.contains('nav-page-label-text')) || null;
  editorLabel.replaceWith(input);
  syncNavigationPageTypeBadge(editorRow, page);
  sourceRow.replaceWith(editorRow);
  recordNavigationRenameSession({
    type: 'page', item: page, input, row: editorRow, sourceRow, parentFolderId
  });
  return true;
}

function mountFolderRenameSession(folder, sourceRow) {
  const folderRow = sourceRow?.closest?.('.nav-folder') || sourceRow?.parentElement;
  if (!sourceRow?.parentElement || !folderRow) return false;
  const sourceNameButton = [...sourceRow.children]
    .find((child) => child.classList?.contains('nav-folder-name-button')) || null;
  if (!sourceNameButton) return false;
  const editorRow = document.createElement('div');
  editorRow.className = sourceRow.className;
  editorRow.classList.add('nav-folder-renaming');
  Object.assign(editorRow.dataset, sourceRow.dataset);
  editorRow.draggable = false;
  editorRow.append(...[...sourceRow.children]);
  const input = createNavigationRenameInput('folder', folder);
  const editorNameButton = [...editorRow.children]
    .find((child) => child.classList?.contains('nav-folder-name-button')) || null;
  editorNameButton.replaceWith(input);
  sourceRow.replaceWith(editorRow);
  const parentFolder = folderRow.parentElement?.closest?.('.nav-folder') || null;
  recordNavigationRenameSession({
    type: 'folder',
    item: folder,
    input,
    row: folderRow,
    sourceRow,
    parentFolderId: parentFolder?.dataset?.folderId || null
  });
  return true;
}

function finishNavigationRenameSession() {
  navigationRenameSession = null;
  navigationRenameRenderPending = false;
  renderPageList({ force: true });
}

function bindStableNavigationRenameInput(input, { currentState, commit, cancel }) {
  protectNavigationRenameInput(input);
  const syncDraft = () => {
    const state = currentState();
    if (state) state.draft = input.value;
    return state;
  };

  input.addEventListener('input', syncDraft);
  input.addEventListener('compositionstart', () => {
    const state = currentState();
    if (state) state.isComposing = true;
  });
  input.addEventListener('compositionend', () => {
    const state = syncDraft();
    if (!state) return;
    state.isComposing = false;
    if (state.commitAfterComposition) {
      state.commitAfterComposition = false;
      commit(input);
    }
  });
  input.addEventListener('keydown', (event) => {
    const state = currentState();
    if (!state) return;
    if (globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      input,
      document.activeElement,
      state.isComposing
    )) return;
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', () => {
    const state = syncDraft();
    if (!state) return;
    if (state.isComposing) {
      state.commitAfterComposition = true;
      return;
    }
    commit(input);
  });
}

function pagesInNavigationOrder() {
  const units = projectNavigationPageUnits(
    (navigation.items || []).filter((item) => typeof item === 'string')
  );
  return tierProjectedNavigationEntries([], units)
    .flatMap((entry) => [entry.page, ...(entry.followerPages || [])]);
}

function navigationPageStickOnTop(pageId) {
  return navigation?.pageStates?.[pageId]?.stickOnTop === true;
}

function navigationBindingFact(pageId) {
  return pageBindingProjection.bindingFact(navigation?.bindings, pageId);
}

function independentlyVisibleNavigationPageIds() {
  return new Set((pageIndex.pages || [])
    .filter((page) => pageMatchesNavigationView(page))
    .map((page) => page.id));
}

function projectNavigationPageUnits(pageIds, { synthetic = false } = {}) {
  const projectedPresentations = navigation?.dynamicProjection?.pages || {};
  const pages = synthetic
    ? (pageIndex.pages || []).map((page) => {
      const projected = projectedPresentations[page.id];
      return projected && typeof projected.title === 'string'
        ? { ...page, title: projected.title }
        : page;
    })
    : (pageIndex.pages || []);
  return pageBindingProjection.projectContainer({
    pageIds,
    pages,
    visiblePageIds: independentlyVisibleNavigationPageIds(),
    bindings: navigation?.bindings,
    synthetic,
    comparePages: navigationSort.comparePages,
    sortMode: navigationSortMode
  });
}

function manualFolderDefaultPage(folder) {
  if (folder?.type !== 'manual' || folder?.source?.kind !== 'manual') return null;
  if (typeof folder.defaultPageId !== 'string'
    || !(folder.source.pageIds || []).includes(folder.defaultPageId)) return null;
  return pageIndex.pages.find((page) => page.id === folder.defaultPageId) || null;
}

function tieredNavigationEntries(folders, pages, { defaultPageId = null, fixedFoldersFirst = false } = {}) {
  return navigationSort.tierNavigationEntries({
    folders,
    pages,
    mode: navigationSortMode,
    defaultPageId,
    fixedFoldersFirst,
    isFolderPinned: (folder) => folder?.stickOnTop === true,
    isPagePinned: (page) => navigationPageStickOnTop(page.id)
  });
}

function tierProjectedNavigationEntries(folders, units, options = {}) {
  const unitsByPageId = new Map((units || []).map((unit) => [unit.page.id, unit]));
  return tieredNavigationEntries(folders, (units || []).map((unit) => unit.page), options)
    .map((entry) => {
      if (entry.type !== 'page') return entry;
      const unit = unitsByPageId.get(entry.page.id);
      return {
        ...entry,
        bindingVisualRole: unit?.visualRole || 'ordinary',
        followerPages: unit?.followerPages || []
      };
    });
}

function pagesInSidebarOrder() {
  const pages = [];
  const seen = new Set();
  const addPage = (page) => {
    if (!page || seen.has(page.id)) return;
    seen.add(page.id);
    pages.push(page);
  };
  const addEntries = (entries = []) => {
    for (const entry of entries) {
      if (entry.type === 'folder') {
        addEntries(folderNavigationEntries(entry.folder));
        continue;
      }
      if (!entry.page) continue;
      addPage(entry.page);
      for (const followerPage of entry.followerPages || []) addPage(followerPage);
    }
  };

  // Startup candidates must follow the same tiered/projection traversal that
  // emits Sidebar rows, including default Pages and bound Followers before a
  // later child-folder tier when that is what the user sees.
  addEntries(rootNavigationEntries());
  return pages;
}

function allNavigationFolders(folders = [], result = []) {
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    result.push(folder);
    allNavigationFolders(folder.children || [], result);
  }
  return result;
}

function sortedNavigationFolders(folders = [], depth = 0) {
  return navigationSort.sortFolders(folders, navigationSortMode, depth);
}

function desktopNavigationSortAvailable() {
  const bridge = window.cneDesktop;
  return bridge?.isDesktop === true
    && typeof bridge.getNavigationSortMode === 'function'
    && typeof bridge.setNavigationSortMode === 'function';
}

async function loadNavigationSortMode() {
  navigationSortMode = navigationSort.DEFAULT_SORT_MODE;
  if (!desktopNavigationSortAvailable()) return navigationSortMode;
  try {
    const settings = await window.cneDesktop.getNavigationSortMode();
    navigationSortMode = navigationSort.normalizeSortMode(settings?.sortMode);
  } catch {
    navigationSortMode = navigationSort.DEFAULT_SORT_MODE;
  }
  return navigationSortMode;
}

function persistNavigationSortMode(sortMode, { reportErrors = true } = {}) {
  const normalizedSortMode = navigationSort.normalizeSortMode(sortMode);
  if (!desktopNavigationSortAvailable()) {
    return Promise.resolve({ ok: true, sortMode: normalizedSortMode });
  }
  const runtime = activePaneRuntime();
  navigationSortSaveQueue = navigationSortSaveQueue
    .catch(() => {})
    .then(async () => {
      const result = await window.cneDesktop.setNavigationSortMode(normalizedSortMode);
      if (result?.ok === false) throw new Error(result.error || 'Navigation sort order could not be saved.');
      return result || { ok: true, sortMode: normalizedSortMode };
    })
    .catch((error) => {
      if (reportErrors) showRuntimeStatus(runtime, error.message, true, 2200);
      return { ok: false, error: error.message };
    });
  return navigationSortSaveQueue;
}

async function flushNavigationSortModeSavesNow() {
  await navigationSortSaveQueue.catch(() => {});
  return { ok: true };
}

globalThis.flushNavigationSortModeSavesNow = flushNavigationSortModeSavesNow;

function applyNavigationSortMode(value, { persist = true } = {}) {
  navigationSortMode = navigationSort.normalizeSortMode(value);
  renderPageList();
  renderNavigationSortMenu();
  if (persist) persistNavigationSortMode(navigationSortMode);
}

function closeNavigationSortMenu({ restoreFocus = false } = {}) {
  if (!navigationSortMenu) return;
  navigationSortMenu.hidden = true;
  navigationSortButton?.classList.remove('active');
  navigationSortButton?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) navigationSortButton?.focus();
}

function renderNavigationSortMenu() {
  if (!navigationSortMenu) return;
  const items = [];
  let previousGroup = null;
  for (const option of navigationSort.SORT_OPTIONS) {
    if (previousGroup && previousGroup !== option.group) {
      const separator = document.createElement('div');
      separator.className = 'navigation-sort-separator';
      separator.setAttribute('role', 'separator');
      items.push(separator);
    }
    previousGroup = option.group;
    const button = document.createElement('button');
    const active = option.value === navigationSortMode;
    button.type = 'button';
    button.className = 'navigation-sort-option';
    button.dataset.sortMode = option.value;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(active));

    const check = document.createElement('span');
    check.className = 'navigation-sort-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = active ? '✓' : '';
    const label = document.createElement('span');
    label.textContent = option.label;
    button.append(check, label);
    button.addEventListener('click', () => {
      applyNavigationSortMode(option.value);
      closeNavigationSortMenu();
    });
    items.push(button);
  }
  navigationSortMenu.replaceChildren(...items);
}

function positionNavigationSortMenu() {
  if (!navigationSortMenu || !navigationSortButton) return;
  const anchor = navigationSortButton.getBoundingClientRect();
  const menuWidth = navigationSortMenu.offsetWidth || 230;
  const menuHeight = navigationSortMenu.offsetHeight || 240;
  const left = Math.min(anchor.left, window.innerWidth - menuWidth - 8);
  const top = Math.min(anchor.bottom + 6, window.innerHeight - menuHeight - 8);
  navigationSortMenu.style.left = `${Math.max(8, left)}px`;
  navigationSortMenu.style.top = `${Math.max(8, top)}px`;
}

function openNavigationSortMenu() {
  if (!navigationSortMenu || !navigationSortButton) return;
  closePageContextMenu();
  closeFolderContextMenu();
  closeNavigationMoveMenu();
  closeRelationContextMenu();
  closeResourceContextMenu();
  renderNavigationSortMenu();
  navigationSortMenu.hidden = false;
  navigationSortButton.classList.add('active');
  navigationSortButton.setAttribute('aria-expanded', 'true');
  positionNavigationSortMenu();
  navigationSortMenu.querySelector('[aria-checked="true"]')?.focus();
}

function toggleNavigationSortMenu() {
  if (!navigationSortMenu) return;
  if (navigationSortMenu.hidden) openNavigationSortMenu();
  else closeNavigationSortMenu();
}

function handleNavigationSortMenuKeyDown(event) {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    closeNavigationSortMenu({ restoreFocus: true });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const options = [...navigationSortMenu.querySelectorAll('.navigation-sort-option')];
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = options.length - 1;
  else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + options.length) % options.length;
  else nextIndex = (currentIndex - 1 + options.length) % options.length;
  options[nextIndex].focus();
}

function normalizeFolderLabelForCompare(label) {
  return String(label || '').trim().toLocaleLowerCase();
}

function folderLabelFamilyBase(label) {
  return String(label || '').trim().replace(/\s\|\s[1-9]\d*$/, '').trim();
}

function folderLabelExists(label, exceptFolderId = null) {
  const normalizedLabel = normalizeFolderLabelForCompare(label);
  return allNavigationFolders(navigation.folders).some((folder) => (
    folder.id !== exceptFolderId
    && normalizeFolderLabelForCompare(folder.label) === normalizedLabel
  ));
}

function makeUniqueFolderLabel(label, exceptFolderId = null) {
  const trimmedLabel = String(label || '').trim() || 'New folder';
  if (!folderLabelExists(trimmedLabel, exceptFolderId)) return trimmedLabel;

  const baseLabel = folderLabelFamilyBase(trimmedLabel) || 'New folder';
  for (let number = 1; number < 10000; number += 1) {
    const candidate = `${baseLabel} | ${number}`;
    if (!folderLabelExists(candidate, exceptFolderId)) return candidate;
  }

  return trimmedLabel;
}

function folderPages(folder) {
  const dynamic = isDynamicNavigationFolder(folder);
  const units = projectNavigationPageUnits(resolveFolderPageIds(folder), { synthetic: dynamic });
  const entries = dynamic
    ? navigationSort.sortPages(units.map((unit) => unit.page), navigationSortMode)
      .map((page) => ({ page, followerPages: [] }))
    : tierProjectedNavigationEntries([], units, {
      defaultPageId: manualFolderDefaultPage(folder)?.id || null
    });
  return entries.flatMap((entry) => [entry.page, ...(entry.followerPages || [])]);
}

function folderNavigationEntries(folder, depth) {
  const dynamic = isDynamicNavigationFolder(folder);
  const units = projectNavigationPageUnits(resolveFolderPageIds(folder), { synthetic: dynamic });
  if (isDynamicNavigationFolder(folder)) {
    return navigationSort.tierNavigationEntries({
      folders: folder.children || [], pages: units.map((unit) => unit.page), mode: navigationSortMode,
      isFolderPinned: () => false, isPagePinned: () => false
    }).map((entry) => entry.type === 'page'
      ? { ...entry, bindingVisualRole: 'ordinary', followerPages: [] }
      : entry);
  }
  return tierProjectedNavigationEntries(folder.children || [], units, {
    defaultPageId: manualFolderDefaultPage(folder)?.id || null
  });
}

function resolveFolderPageIds(folder) {
  const source = folder.source || {};
  if (source.kind === 'manual' && Array.isArray(source.pageIds)) {
    const validPageIds = new Set(pageIndex.pages.map((page) => page.id));
    return source.pageIds.filter((pageId) => validPageIds.has(pageId));
  }

  if (source.kind === 'missingCategories'
    || source.kind === 'categoryAny'
    || source.kind === 'categoryAll') {
    const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
    return (Array.isArray(folder.projectedPageIds) ? folder.projectedPageIds : [])
      .filter((pageId) => validPageIds.has(pageId));
  }

  return [];
}

function collectFolderPageIds(folder, result = []) {
  for (const pageId of resolveFolderPageIds(folder)) {
    if (typeof pageId === 'string') result.push(pageId);
  }
  for (const child of folder.children || []) collectFolderPageIds(child, result);
  return result;
}

function countChildFolders(folder) {
  return (folder.children || []).reduce((count, child) => (
    count + 1 + countChildFolders(child)
  ), 0);
}

function confirmFolderDelete(folder) {
  closeNavigationSortMenu();
  const pageCount = new Set(collectFolderPageIds(folder)).size;
  const folderCount = countChildFolders(folder);
  if (!pageCount && !folderCount) return Promise.resolve({ confirmed: true, deletePages: false });

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'forced-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const modal = document.createElement('section');
    modal.className = 'forced-modal';
    modal.dataset.modalType = 'delete-folder';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'delete-folder-title');
    modal.tabIndex = -1;

    const title = document.createElement('h2');
    title.id = 'delete-folder-title';
    title.textContent = 'Delete folder';

    const body = document.createElement('div');
    body.className = 'forced-modal-body';
    const message = document.createElement('p');
    message.textContent = `This folder contains ${plural(pageCount, 'page')}`
      + (folderCount ? ` and ${plural(folderCount, 'folder')}` : '')
      + '. Delete this folder?';

    const label = document.createElement('label');
    label.className = 'modal-checkbox-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const checkboxText = document.createElement('span');
    checkboxText.textContent = 'Also delete pages inside this folder';
    label.append(checkbox, checkboxText);
    body.append(message, label);

    const actions = document.createElement('div');
    actions.className = 'forced-modal-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'ui-outline-action ui-cancel-action';
    cancelButton.textContent = 'Cancel';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ui-solid-action';
    deleteButton.textContent = 'Delete';
    actions.append(cancelButton, deleteButton);
    modal.append(title, body, actions);

    const finish = (confirmed) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      modal.remove();
      resolve({ confirmed, deletePages: confirmed && checkbox.checked });
    };

    const onKeyDown = (event) => {
      if (event.key === 'Enter'
        && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
          event,
          event.target
        )) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };

    cancelButton.addEventListener('click', () => finish(false));
    deleteButton.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKeyDown, true);
    document.body.append(overlay, modal);
    modal.focus();
  });
}

function navigationSelectionKey(type, id) {
  return `${type}:${id}`;
}

function navigationMoveItemFromKey(key) {
  const separator = key.indexOf(':');
  return { type: key.slice(0, separator), id: key.slice(separator + 1) };
}

function rememberNavigationVisibleItem(key) {
  if (!navigationVisibleOrder.includes(key)) navigationVisibleOrder.push(key);
}

function updateNavigationSelectionVisuals() {
  const activePageId = activePaneRuntime()?.currentPage?.id || null;
  for (const element of pageList.querySelectorAll('[data-navigation-selection-key]')) {
    element.classList.toggle('nav-selected', selectedNavigationItems.has(
      element.dataset.navigationSelectionKey
    ));
    if (element.classList.contains('page-link')) {
      element.classList.toggle(
        'active', !navigationExplicitSelectionMode
          && element.dataset.pageId === activePageId
      );
    }
  }
}

function clearNavigationSelection() {
  selectedNavigationItems.clear();
  navigationSelectionAnchor = null;
  navigationSelectionAnchorIsImplicitCurrent = false;
  navigationExplicitSelectionMode = false;
  updateNavigationSelectionVisuals();
}

function currentVisiblePageSelectionKey() {
  const pageId = activePaneRuntime()?.currentPage?.id;
  if (!pageId) return null;
  const key = navigationSelectionKey('page', pageId);
  return navigationVisibleOrder.includes(key) ? key : null;
}

function navigationPageSelectionKey(key) {
  return typeof key === 'string' && key.startsWith('page:');
}

function reconcileNavigationPageSelectionVisibility() {
  const visiblePageKeys = new Set(
    navigationVisibleOrder.filter(navigationPageSelectionKey)
  );
  let changed = false;
  for (const key of [...selectedNavigationItems]) {
    if (!navigationPageSelectionKey(key) || visiblePageKeys.has(key)) continue;
    selectedNavigationItems.delete(key);
    changed = true;
  }
  if (navigationPageSelectionKey(navigationSelectionAnchor)
    && !visiblePageKeys.has(navigationSelectionAnchor)) {
    navigationSelectionAnchor = null;
    navigationSelectionAnchorIsImplicitCurrent = false;
    changed = true;
  }
  if (!selectedNavigationItems.size && navigationExplicitSelectionMode) {
    navigationExplicitSelectionMode = false;
    navigationSelectionAnchor = null;
    navigationSelectionAnchorIsImplicitCurrent = false;
    changed = true;
  }
  if (changed) updateNavigationSelectionVisuals();
  return changed;
}

function selectNavigationItem(key, event, { rightClick = false } = {}) {
  reconcileNavigationPageSelectionVisibility();
  const modifierSelection = !rightClick && Boolean(
    event.shiftKey || event.metaKey || event.altKey
  );
  const enteringExplicitSelection = modifierSelection
    && !navigationExplicitSelectionMode;
  if (enteringExplicitSelection) {
    selectedNavigationItems.clear();
    navigationExplicitSelectionMode = true;
  }
  let nextAnchor = key;
  let nextAnchorIsImplicitCurrent = false;
  if (rightClick) {
    if (!selectedNavigationItems.has(key)) {
      selectedNavigationItems.clear();
      selectedNavigationItems.add(key);
    }
  } else if (event.shiftKey) {
    const pageRange = navigationPageSelectionKey(key);
    const anchorCandidate = enteringExplicitSelection ? null : navigationSelectionAnchor;
    const explicitAnchor = anchorCandidate
      && navigationVisibleOrder.includes(anchorCandidate)
      && (!pageRange || navigationPageSelectionKey(anchorCandidate))
      ? anchorCandidate
      : null;
    const implicitCurrentAnchor = explicitAnchor ? null : currentVisiblePageSelectionKey();
    const rangeAnchor = explicitAnchor || implicitCurrentAnchor;
    const start = navigationVisibleOrder.indexOf(rangeAnchor);
    const end = navigationVisibleOrder.indexOf(key);
    if (start >= 0 && end >= 0) {
      if (!(event.metaKey || event.altKey)) selectedNavigationItems.clear();
      const [from, to] = start < end ? [start, end] : [end, start];
      for (const itemKey of navigationVisibleOrder.slice(from, to + 1)) {
        if (pageRange && !navigationPageSelectionKey(itemKey)) continue;
        selectedNavigationItems.add(itemKey);
      }
      if (implicitCurrentAnchor
        || (explicitAnchor && navigationSelectionAnchorIsImplicitCurrent)) {
        nextAnchor = rangeAnchor;
        nextAnchorIsImplicitCurrent = true;
      }
    } else {
      selectedNavigationItems.clear();
      selectedNavigationItems.add(key);
    }
  } else if (event.metaKey || event.altKey) {
    if (enteringExplicitSelection) {
      const currentKey = currentVisiblePageSelectionKey();
      if (currentKey) selectedNavigationItems.add(currentKey);
    }
    if (selectedNavigationItems.has(key)) selectedNavigationItems.delete(key);
    else selectedNavigationItems.add(key);
  } else {
    navigationExplicitSelectionMode = false;
    selectedNavigationItems.clear();
    selectedNavigationItems.add(key);
  }
  navigationSelectionAnchor = nextAnchor;
  navigationSelectionAnchorIsImplicitCurrent = nextAnchorIsImplicitCurrent;
  updateNavigationSelectionVisuals();
}

function navigationSelectionGesture(event) {
  return Boolean(event.shiftKey || event.metaKey || event.altKey);
}

function selectedNavigationMoveItems() {
  return [...selectedNavigationItems].map(navigationMoveItemFromKey);
}

function selectedNavigationPageIds() {
  return selectedNavigationMoveItems()
    .filter((item) => item.type === 'page')
    .map((item) => item.id);
}

function selectedUnboundBindingPageIds() {
  const items = selectedNavigationMoveItems();
  if (!items.length || items.some((item) => item.type !== 'page')) return [];
  const pageIds = items.map((item) => item.id);
  if (pageIds.some((pageId) => (
    !pageIndex.pages.some((page) => page.id === pageId)
    || navigationBindingFact(pageId).role !== 'unbound'
  ))) return [];
  return pageIds;
}

function navigationItemsContainBoundFollower(items) {
  return (items || []).some((item) => (
    item.type === 'page' && navigationBindingFact(item.id).role === 'follower'
  ));
}

function navigationDragItems(type, id) {
  const key = navigationSelectionKey(type, id);
  if (!selectedNavigationItems.has(key)) {
    // A drag that starts outside the explicit selection is a one-item gesture,
    // not a selection mutation. Keeping the two states separate also prevents
    // the active Page and a transient dragged row from remaining highlighted
    // together after the gesture finishes.
    return [{ type, id }];
  }
  return selectedNavigationMoveItems();
}

function navigationPageDragDescriptor(pageId) {
  reconcileNavigationPageSelectionVisibility();
  const selectedItems = navigationDragItems('page', pageId);
  const selectedPageItems = selectedItems.filter((item) => item.type === 'page');
  // Only the explicitly selected Pages become a batch; a simultaneously
  // selected Folder remains outside the custom Page gesture. A lone
  // Binding Leader/Follower remains a one-Page pointer gesture; canonical
  // membership validation still decides whether that Page may move.
  const selectedPageIds = new Set(selectedPageItems.map((item) => item.id));
  const visibleSelection = navigationVisibleOrder
    .map(navigationMoveItemFromKey)
    .filter((item) => item.type === 'page' && selectedPageIds.has(item.id));
  const explicitMultiSelection = visibleSelection.length > 1
    && visibleSelection.some((item) => item.id === pageId);
  const items = explicitMultiSelection
    ? visibleSelection
    : [{ type: 'page', id: pageId }];
  const effectivePageIds = [];
  const extractPageIds = [];
  const deferredPageIds = [];
  const seenPageIds = new Set();
  const addEffectivePageId = (candidateId) => {
    if (typeof candidateId !== 'string' || seenPageIds.has(candidateId)) return;
    if (!pageIndex.pages.some((page) => page.id === candidateId)) return;
    seenPageIds.add(candidateId);
    effectivePageIds.push(candidateId);
  };
  for (const item of items) {
    extractPageIds.push(item.id);
    addEffectivePageId(item.id);
    const fact = navigationBindingFact(item.id);
    if (fact.role !== 'leader') continue;
    for (const followerPageId of fact.binding?.followerPageIds || []) {
      addEffectivePageId(followerPageId);
      if (!selectedPageIds.has(followerPageId)) deferredPageIds.push(followerPageId);
    }
  }
  const primaryPage = pageIndex.pages.find((page) => page.id === pageId) || null;
  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
    effectivePageIds: Object.freeze(effectivePageIds),
    extractPageIds: Object.freeze(extractPageIds),
    deferredPageIds: Object.freeze([...new Set(deferredPageIds)]),
    tabPageIds: Object.freeze(items.map((item) => item.id)),
    explicitMultiSelection,
    primaryPageId: pageId,
    primaryName: primaryPage?.title || 'Untitled',
    spatialPreviewEligible: !explicitMultiSelection
  });
}

function persistNavigationFolderCollapsed(folderId, collapsed) {
  const previousWrite = navigationFolderToggleWrites.get(folderId) || Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => request(`/api/navigation/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed })
    }));
  navigationFolderToggleWrites.set(folderId, write);
  return write.finally(() => {
    if (navigationFolderToggleWrites.get(folderId) === write) {
      navigationFolderToggleWrites.delete(folderId);
    }
  });
}

async function toggleNavigationFolder(folder) {
  const runtime = activePaneRuntime();
  const nextCollapsed = !folder.collapsed;
  const toggleVersion = (navigationFolderToggleVersions.get(folder.id) || 0) + 1;
  navigationFolderToggleVersions.set(folder.id, toggleVersion);
  if (nextCollapsed) clearNavigationSelection();
  folder.collapsed = nextCollapsed;
  const motion = sidebarMembershipMoveAnimator?.playDisclosure({
    folderId: folder.id,
    expanding: !nextCollapsed,
    render: () => renderPageList({ sidebarMotionRender: true })
  });
  if (!motion) renderPageList({ sidebarMotionRender: true });

  try {
    const savedNavigation = await persistNavigationFolderCollapsed(folder.id, nextCollapsed);
    if (navigationFolderToggleVersions.get(folder.id) !== toggleVersion) return;
    navigation = savedNavigation;
    await motion;
  } catch (error) {
    if (navigationFolderToggleVersions.get(folder.id) !== toggleVersion) return;
    folder.collapsed = !nextCollapsed;
    const rollbackMotion = sidebarMembershipMoveAnimator?.playDisclosure({
      folderId: folder.id,
      expanding: nextCollapsed,
      render: () => renderPageList({ sidebarMotionRender: true })
    });
    if (!rollbackMotion) renderPageList({ sidebarMotionRender: true });
    else await rollbackMotion;
    showRuntimeStatus(runtime, error.message, true);
  }
}

function startFolderRename(folder, { selectAll = false, sourceRow = null } = {}) {
  if (folder.type === 'system') return;
  if (navigationRenameSession) return;
  let row = navigationRenameSourceRow('folder', folder.id, sourceRow);
  if (!row) {
    renderPageList({ force: true });
    row = navigationRenameSourceRow('folder', folder.id);
  }
  if (!row) return;
  folderRenameState = {
    folderId: folder.id,
    originalLabel: folder.label || folder.id,
    draft: folder.label || folder.id,
    selectAll,
    isComposing: false
  };
  if (!mountFolderRenameSession(folder, row)) folderRenameState = null;
}

function startPageRename(page, {
  selectAll = true,
  sourceRow = null,
  parentFolderId = null
} = {}) {
  if (navigationRenameSession) return;
  let row = navigationRenameSourceRow('page', page.id, sourceRow);
  if (!row) {
    renderPageList({ force: true });
    row = navigationRenameSourceRow('page', page.id);
  }
  if (!row) return;
  pageRenameState = {
    pageId: page.id,
    originalTitle: page.title,
    draft: page.title,
    selectAll,
    isComposing: false
  };
  if (!mountPageRenameSession(page, row, parentFolderId)) pageRenameState = null;
}

function renameContextPage() {
  const page = pageContextTarget;
  if (!page || pageContextSynthetic) return;
  const sourceRow = pageContextSourceRow;
  const parentFolderId = pageContextParentFolderId;
  closePageContextMenu();
  startPageRename(page, { selectAll: true, sourceRow, parentFolderId });
}

function renameContextFolder() {
  const folder = folderContextTarget;
  if (!folder || folder.type !== 'manual' || folder.source?.kind !== 'manual') return;
  const sourceRow = folderContextSourceRow;
  closeFolderContextMenu();
  startFolderRename(folder, { selectAll: true, sourceRow });
}

async function saveFolderRename(input) {
  if (!folderRenameState || folderRenameSaveInProgress) return;
  const runtime = activePaneRuntime();
  const folderId = folderRenameState.folderId;
  folderRenameState.draft = input.value;
  const label = makeUniqueFolderLabel(folderRenameState.draft, folderId);
  folderRenameSaveInProgress = true;

  try {
    const saved = await request(`/api/navigation/folders/${encodeURIComponent(folderId)}/label`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    navigation = saved.navigation;
    folderRenameState = null;
    finishNavigationRenameSession();
  } catch (error) {
    showRuntimeStatus(runtime, error.message, true);
    input.focus();
  } finally {
    folderRenameSaveInProgress = false;
  }
}

function cancelFolderRename() {
  folderRenameState = null;
  finishNavigationRenameSession();
}

async function savePageRename(input) {
  if (!pageRenameState || pageRenameSaveInProgress) return;
  const pageId = pageRenameState.pageId;
  const sourcePage = pageIndex.pages.find((page) => page.id === pageId);
  pageRenameState.draft = input.value;
  const nextTitle = pageRenameState.draft.trim();
  if (!sourcePage || !nextTitle || nextTitle === sourcePage.title) {
    pageRenameState = null;
    finishNavigationRenameSession();
    return;
  }

  const uniqueTitle = makeUniquePageTitle(nextTitle, pageId);
  const originRuntime = activePaneRuntime();
  const operation = captureRuntimeOperation(originRuntime, {
    scope: 'navigation-page-rename',
    targetPageId: pageId
  });
  pageRenameSaveInProgress = true;
  try {
    const savedPage = await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: uniqueTitle })
    });
    pageIndex = await request('/api/page-index');
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    commitCanonicalPage(savedPage, {
      originRuntime: operationIsCurrent ? originRuntime : null
    });
    pageRenameState = null;
    finishNavigationRenameSession();
    if (operationIsCurrent) {
      showRuntimeStatus(originRuntime, savedPage.title === nextTitle
        ? 'Saved'
        : `Saved as "${savedPage.title}".`, false, 1800);
    }
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(originRuntime, error.message, true);
    }
    if (input.isConnected) input.focus();
  } finally {
    pageRenameSaveInProgress = false;
  }
}

function cancelPageRename() {
  pageRenameState = null;
  finishNavigationRenameSession();
}

function navigationDragPayload(event) {
  if (navigationDragData) return navigationDragData;
  const raw = event.dataTransfer?.getData('application/x-viewer-nav')
    || event.dataTransfer?.getData('text/plain');
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function navigationItemsFromPayload(payload) {
  if (!Array.isArray(payload?.items)) return [];
  return payload.items.filter((item) => (
    item && ['page', 'folder'].includes(item.type) && typeof item.id === 'string'
  ));
}

function setNavigationDragPayload(event, payload) {
  navigationDragData = payload;
  document.body.classList.add('navigation-dragging');
  const raw = JSON.stringify(payload);
  event.dataTransfer.setData('application/x-viewer-nav', raw);
  event.dataTransfer.setData('text/plain', raw);
  event.dataTransfer.effectAllowed = 'move';
}

function navigationFolderDestinationError(folder, items) {
  if (!folder || folder.type !== 'manual' || folder.source?.kind !== 'manual') {
    return 'Items can only be moved into manual folders.';
  }
  if (!items.length) return 'Select at least one page or folder to move.';
  if (navigationItemsContainBoundFollower(items)) {
    return 'Stop Binding before moving a Follower independently.';
  }
  for (const item of items) {
    if (item.type !== 'folder') continue;
    const sourceFolder = allNavigationFolders(navigation.folders)
      .find((candidate) => candidate.id === item.id);
    if (!sourceFolder) return 'A selected folder no longer exists.';
    if (sourceFolder.type !== 'manual') return 'System folders cannot be moved.';
    if (sourceFolder.id === folder.id) return 'A folder cannot be moved into itself.';
    if (allNavigationFolders(sourceFolder.children || [])
      .some((candidate) => candidate.id === folder.id)) {
      return 'A folder cannot be moved into its descendant.';
    }
  }
  return null;
}

function canMoveNavigationItemsToFolder(folder, items) {
  return !navigationFolderDestinationError(folder, items);
}

function canDropOnManualFolder(folder, payload) {
  return canMoveNavigationItemsToFolder(folder, navigationItemsFromPayload(payload));
}

function navigationDestinationText(folder) {
  return folder ? `“${folder.label || folder.id}”` : 'top level';
}

function navigationMembershipParentFolderId(item, navigationState = navigation) {
  if (!item || !['page', 'folder'].includes(item.type)) return undefined;
  if (item.type === 'page' && (navigationState?.items || []).includes(item.id)) return null;
  const visit = (folders, parentFolderId = null) => {
    for (const folder of folders || []) {
      if (item.type === 'folder' && folder.id === item.id) return parentFolderId;
      if (item.type === 'page'
        && folder.type === 'manual'
        && folder.source?.kind === 'manual'
        && (folder.source.pageIds || []).includes(item.id)) return folder.id;
      const nested = visit(folder.children || [], folder.id);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return visit(navigationState?.folders || []);
}

function recordSidebarMembershipMoveAnimation(event) {
  const trace = globalThis.__sidebarMembershipMoveAnimationTrace
    || (globalThis.__sidebarMembershipMoveAnimationTrace = []);
  trace.push({
    ...event,
    at: typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  });
  if (trace.length > 128) trace.splice(0, trace.length - 128);
}

const sidebarMembershipMoveAnimator =
  typeof sidebarMembershipMoveAnimationModel !== 'undefined'
    ? sidebarMembershipMoveAnimationModel.createCoordinator({
      root: () => pageList,
      onTrace: recordSidebarMembershipMoveAnimation,
      onInterrupt: ({ reason }) => (
        typeof cancelSidebarPageDrag === 'function'
        && cancelSidebarPageDrag({ immediate: reason === 'sidebar-visibility-change' })
      )
    })
    : null;

function interruptSidebarMembershipMoveAnimation(reason = 'rerender') {
  if (typeof cancelSidebarPageDrag === 'function'
    && cancelSidebarPageDrag({ immediate: false })) return true;
  return sidebarMembershipMoveAnimator?.cancel(reason) === true;
}

function captureSidebarNavigationMutation(options) {
  return sidebarMembershipMoveAnimator?.captureMutation(options) || null;
}

async function playSidebarNavigationMutation(session) {
  if (!session) {
    renderPageList({ sidebarMotionRender: true });
    return false;
  }
  return sidebarMembershipMoveAnimator.playMutation(
    session,
    () => renderPageList({ sidebarMotionRender: true })
  );
}

async function performNavigationBatchMove(payload, destination, { motionSession = null } = {}) {
  const items = navigationItemsFromPayload(payload);
  if (!items.length) return false;
  const runtime = activePaneRuntime();
  if (navigationItemsContainBoundFollower(items)) {
    showRuntimeStatus(runtime, 'Stop Binding before moving a Follower independently.', true, 2200);
    if (motionSession) {
      await sidebarMembershipMoveAnimator?.restoreDrag(motionSession, {
        reason: 'bound-follower-rejected'
      });
    }
    return false;
  }
  const targetFolder = destination.parentFolderId
    ? allNavigationFolders(navigation.folders)
      .find((folder) => folder.id === destination.parentFolderId) || null
    : null;
  if (!motionSession && interruptSidebarMembershipMoveAnimation('new-move')) {
    renderPageList({ membershipAnimationRender: true });
  }
  const animationSession = motionSession || sidebarMembershipMoveAnimator?.capture({
    items: items.map((item) => ({
      ...item,
      sourceParentFolderId: navigationMembershipParentFolderId(item)
    })),
    destinationParentFolderId: destination.parentFolderId || null
  }) || null;

  try {
    const moved = await request('/api/navigation/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, destination })
    });
    navigation = moved.navigation;
    navigationDragData = null;
    clearSidebarPageNavigationMembershipTarget();
    closeNavigationMoveMenu();
    if (moved.changed === false) {
      if (motionSession) {
        await sidebarMembershipMoveAnimator?.restoreDrag(motionSession, {
          reason: 'stationary-drop'
        });
      } else renderPageList({ membershipAnimationRender: true });
      showRuntimeStatus(runtime, `Already in ${navigationDestinationText(targetFolder)}`, false, 1400);
      return false;
    }
    clearNavigationSelection();
    if (motionSession) {
      await sidebarMembershipMoveAnimator?.commitDrag(
        motionSession,
        () => renderPageList({ sidebarMotionRender: true }),
        { destinationParentFolderId: destination.parentFolderId || null }
      );
    } else if (animationSession) {
      await sidebarMembershipMoveAnimator.play(
        animationSession,
        () => renderPageList({ membershipAnimationRender: true })
      );
    } else renderPageList({ membershipAnimationRender: true });
    const movedCount = moved.movedItems?.length ?? items.length;
    showRuntimeStatus(
      runtime,
      `Moved ${movedCount} ${movedCount === 1 ? 'item' : 'items'} to ${navigationDestinationText(targetFolder)}`,
      false,
      1800
    );
    return true;
  } catch (error) {
    if (motionSession) {
      await sidebarMembershipMoveAnimator?.restoreDrag(motionSession, {
        reason: 'move-request-error'
      });
    }
    showRuntimeStatus(runtime, error.message, true);
    return false;
  }
}

async function moveNavigationItemToFolder(targetFolder, payload) {
  if (!canDropOnManualFolder(targetFolder, payload)) return;
  await performNavigationBatchMove(payload, { parentFolderId: targetFolder.id });
}

function navigationRootDestinationError(items) {
  if (!items.length) return 'Select at least one page or folder to move.';
  if (navigationItemsContainBoundFollower(items)) {
    return 'Stop Binding before moving a Follower independently.';
  }
  return null;
}

function clearSidebarPageNavigationMembershipTarget() {
  for (const folderElement of pageList.querySelectorAll('.nav-folder')) {
    folderElement.classList.remove('is-drop-target');
  }
}

function sidebarPageNavigationPayload(descriptor) {
  return { items: descriptor.items.map((item) => ({ ...item })) };
}

function beginSidebarPageNavigationDrag(descriptor, clientX, clientY, sourceElement = null) {
  const items = descriptor.items.map((item) => ({
    ...item,
    sourceParentFolderId: navigationMembershipParentFolderId(item)
  }));
  const motionSession = sidebarMembershipMoveAnimator?.beginDrag({
    items,
    effectivePageIds: descriptor.effectivePageIds,
    extractPageIds: descriptor.extractPageIds,
    deferredPageIds: descriptor.deferredPageIds,
    primaryPageId: descriptor.primaryPageId,
    primaryName: descriptor.primaryName,
    sourceElement: descriptor.explicitMultiSelection ? null : sourceElement,
    pointer: { x: clientX, y: clientY }
  }) || null;
  return Object.freeze({ ...descriptor, motionSession });
}

function updateSidebarPageNavigationDragPointer(descriptor, clientX, clientY) {
  if (!descriptor?.motionSession) return false;
  return sidebarMembershipMoveAnimator?.updateDragPointer(
    descriptor.motionSession,
    clientX,
    clientY
  ) === true;
}

function restoreSidebarPageNavigationDrag(descriptor, reason = 'invalid-drop') {
  if (!descriptor?.motionSession) return Promise.resolve(false);
  return sidebarMembershipMoveAnimator?.restoreDrag(descriptor.motionSession, {
    reason
  }) || Promise.resolve(false);
}

function handoffSidebarPageNavigationDragToPreview(descriptor) {
  if (!descriptor?.motionSession) return false;
  return sidebarMembershipMoveAnimator?.handoffDrag(descriptor.motionSession) === true;
}

function updateSidebarPageNavigationMembershipTarget(descriptor, clientX, clientY) {
  clearSidebarPageNavigationMembershipTarget();
  const element = document.elementFromPoint?.(clientX, clientY) || null;
  if (!element) return null;
  if (element.closest?.('#descriptor-search-panel, #filter-panel')) return null;
  const payload = sidebarPageNavigationPayload(descriptor);
  const items = navigationItemsFromPayload(payload);
  const folderButton = element.closest?.('.nav-folder-button');
  const folderElement = folderButton?.closest?.('.nav-folder') || null;
  if (folderElement?.dataset.folderId) {
    const folder = allNavigationFolders(navigation.folders)
      .find((candidate) => candidate.id === folderElement.dataset.folderId) || null;
    const error = navigationFolderDestinationError(folder, items);
    folderElement.classList.toggle('is-drop-target', !error);
    return {
      kind: 'folder',
      parentFolderId: folder?.id || null,
      invalid: Boolean(error),
      error
    };
  }
  if (element.closest?.('.nav-folder-pages') || element.closest?.('.nav-folder')) return null;
  const inRootSurface = navigationContextSurface === pageList
    ? pageList.contains(element)
    : element.closest?.('.left-sidebar-scroll-region') === navigationContextSurface;
  if (!inRootSurface) return null;
  const error = navigationRootDestinationError(items);
  return { kind: 'root', parentFolderId: null, invalid: Boolean(error), error };
}

async function commitSidebarPageNavigationMembershipDrop(descriptor, target) {
  if (!target) return false;
  const runtime = activePaneRuntime();
  if (target.invalid) {
    await restoreSidebarPageNavigationDrag(descriptor, 'invalid-target');
    if (target.error) showRuntimeStatus(runtime, target.error, true, 2200);
    return false;
  }
  return performNavigationBatchMove(
    sidebarPageNavigationPayload(descriptor),
    { parentFolderId: target.parentFolderId || null },
    { motionSession: descriptor.motionSession }
  );
}

function closePageContextMenu() {
  pageContextTarget = null;
  pageContextParentFolderId = null;
  pageContextSynthetic = false;
  pageContextSourceRow = null;
}

function navigationFolderById(folderId) {
  return allNavigationFolders(navigation.folders || []).find((folder) => folder.id === folderId) || null;
}

async function toggleContextDefaultPage() {
  const page = pageContextTarget;
  const folder = navigationFolderById(pageContextParentFolderId);
  if (!page || !folder || pageContextSynthetic) return;
  const runtime = activePaneRuntime();
  const nextPageId = folder.defaultPageId === page.id ? null : page.id;
  closePageContextMenu();
  try {
    const saved = await request(
      `/api/navigation/folders/${encodeURIComponent(folder.id)}/default-page`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: nextPageId })
      }
    );
    navigation = saved.navigation;
    renderPageList();
  } catch (error) {
    showRuntimeStatus(runtime, error.message, true, 2200);
  }
}

function navigationStickSelectionItems(items = null) {
  const candidates = Array.isArray(items) && items.length ? items : selectedNavigationMoveItems();
  const seen = new Set();
  const result = [];
  for (const item of candidates) {
    if (!item || (item.type !== 'page' && item.type !== 'folder') || typeof item.id !== 'string') {
      continue;
    }
    const key = navigationSelectionKey(item.type, item.id);
    if (seen.has(key)) continue;
    if (item.type === 'page') {
      if (!pageIndex.pages.some((candidate) => candidate.id === item.id)) continue;
    } else {
      const folder = navigationFolderById(item.id);
      if (!folder || folder.type !== 'manual' || folder.source?.kind !== 'manual') continue;
    }
    seen.add(key);
    result.push({ type: item.type, id: item.id });
  }
  return result;
}

function navigationItemStickOnTop(item) {
  if (item.type === 'page') return navigationPageStickOnTop(item.id);
  return navigationFolderById(item.id)?.stickOnTop === true;
}

async function toggleContextNavigationStickOnTop(items = null) {
  const selectedItems = navigationStickSelectionItems(items);
  if (!selectedItems.length) return;
  const runtime = activePaneRuntime();
  const enabled = !selectedItems.every(navigationItemStickOnTop);
  closePageContextMenu();
  closeFolderContextMenu();
  try {
    for (const item of selectedItems) {
      const url = item.type === 'page'
        ? `/api/navigation/pages/${encodeURIComponent(item.id)}/stick-on-top`
        : `/api/navigation/folders/${encodeURIComponent(item.id)}/stick-on-top`;
      const saved = await request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      navigation = saved.navigation;
    }
    renderPageList();
  } catch (error) {
    showRuntimeStatus(runtime, error.message, true, 2200);
  }
}

async function toggleContextPageStickOnTop(selectedPageIds = null) {
  const page = pageContextTarget;
  if (!page || pageContextSynthetic) return;
  const items = Array.isArray(selectedPageIds) && selectedPageIds.length
    ? selectedPageIds.map((id) => ({ type: 'page', id }))
    : [{ type: 'page', id: page.id }];
  return toggleContextNavigationStickOnTop(items);
}

async function toggleContextFolderStickOnTop() {
  const folder = folderContextTarget;
  if (!folder || folder.type !== 'manual' || folder.source?.kind !== 'manual') return;
  return toggleContextNavigationStickOnTop([{ type: 'folder', id: folder.id }]);
}

function closeNavigationMoveMenu() {
  navigationMoveMode = null;
  document.body.classList.remove(
    'navigation-move-target-pick-mode',
    'navigation-binding-target-pick-mode'
  );
  clearNavigationMoveTarget();
}

function clearNavigationMoveTarget() {
  navigationMoveHoverFolderElement?.classList.remove(
    'is-move-pick-target',
    'is-binding-pick-target'
  );
  navigationMoveHoverFolderElement = null;
  if (navigationMoveHint) {
    navigationMoveHint.hidden = true;
    navigationMoveHint.textContent = '';
    navigationMoveHint.style.left = '';
    navigationMoveHint.style.top = '';
  }
}

function navigationBindingTargetMode() {
  return navigationMoveMode?.kind === 'bind-to-leader' ? navigationMoveMode : null;
}

function setNavigationMoveHoverElement(element, className) {
  if (navigationMoveHoverFolderElement !== element) clearNavigationMoveTarget();
  navigationMoveHoverFolderElement = element;
  element?.classList.add(className);
}

function positionNavigationMoveHint(text, event) {
  if (!navigationMoveHint) return;
  navigationMoveHint.hidden = false;
  navigationMoveHint.textContent = text;
  navigationMoveHint.style.left = `${Math.min(
    event.clientX + 10,
    window.innerWidth - navigationMoveHint.offsetWidth - 12
  )}px`;
  navigationMoveHint.style.top = `${Math.min(
    event.clientY + 10,
    window.innerHeight - navigationMoveHint.offsetHeight - 12
  )}px`;
}

function navigationMoveSourceText(items) {
  if (items.length !== 1) return `${items.length} items`;
  const [item] = items;
  if (item.type === 'folder') {
    const folder = navigationFolderById(item.id);
    return folder?.label || item.id;
  }
  const page = pageIndex.pages.find((candidate) => candidate.id === item.id);
  return page?.title || item.id;
}

function showNavigationMoveTarget(folderWrapper, folder, event) {
  if (!navigationMoveMode || !folderWrapper || !folder) return;
  if (navigationBindingTargetMode()) {
    clearNavigationMoveTarget();
    positionNavigationMoveHint('Choose a Page as Leader', event);
    return;
  }
  if (navigationFolderDestinationError(folder, navigationMoveMode.items)) {
    clearNavigationMoveTarget();
    return;
  }
  setNavigationMoveHoverElement(folderWrapper, 'is-move-pick-target');
  positionNavigationMoveHint(
    `Move “${navigationMoveMode.sourceText}” to “${folder.label || folder.id}”`,
    event
  );
}

function openNavigationMoveMenu() {
  const items = selectedNavigationMoveItems();
  if (!items.length) return;
  if (navigationItemsContainBoundFollower(items)) {
    const runtime = activePaneRuntime();
    showRuntimeStatus(runtime, 'Stop Binding before moving a Follower independently.', true, 2200);
    return;
  }
  closePageContextMenu();
  closeFolderContextMenu();
  closeNavigationMoveMenu();
  navigationMoveMode = { items, sourceText: navigationMoveSourceText(items) };
  document.body.classList.add('navigation-move-target-pick-mode');
}

function navigationBindingTargetError(page, { synthetic = false } = {}) {
  const mode = navigationBindingTargetMode();
  if (!mode) return 'Binding target mode is not active.';
  if (!page || !pageIndex.pages.some((candidate) => candidate.id === page.id)) {
    return 'That Page no longer exists.';
  }
  if (synthetic) return 'Choose a Page in its root or manual folder location.';
  if (mode.selectedPageIds.includes(page.id)) return 'A selected Page cannot be its own Leader.';
  const role = navigationBindingFact(page.id).role;
  if (role === 'follower') return 'A Follower cannot be selected as Leader.';
  if (role !== 'leader' && role !== 'unbound') return 'That Page cannot be selected as Leader.';
  return null;
}

function navigationBindingSourceText(pageIds) {
  if (pageIds.length !== 1) return `${pageIds.length} Pages`;
  const page = pageIndex.pages.find((candidate) => candidate.id === pageIds[0]);
  return page?.title || pageIds[0];
}

function showNavigationBindingTarget(button, page, event, options = {}) {
  const mode = navigationBindingTargetMode();
  if (!mode || !button) return;
  const error = navigationBindingTargetError(page, options);
  if (error) clearNavigationMoveTarget();
  else setNavigationMoveHoverElement(button, 'is-binding-pick-target');
  positionNavigationMoveHint(
    error || `Bind ${mode.sourceText} to ${page.title || page.id}`,
    event
  );
}

function openNavigationBindingMenu(pageIds = selectedUnboundBindingPageIds()) {
  const eligiblePageIds = selectedUnboundBindingPageIds();
  if (!pageIds.length
    || pageIds.length !== eligiblePageIds.length
    || pageIds.some((pageId) => !eligiblePageIds.includes(pageId))) return false;
  closePageContextMenu();
  closeFolderContextMenu();
  closeNavigationMoveMenu();
  navigationMoveMode = {
    kind: 'bind-to-leader',
    selectedPageIds: [...pageIds],
    sourceText: navigationBindingSourceText(pageIds)
  };
  document.body.classList.add(
    'navigation-move-target-pick-mode',
    'navigation-binding-target-pick-mode'
  );
  return true;
}

async function commitNavigationBindingTarget(page, options = {}) {
  const runtime = activePaneRuntime();
  const mode = navigationBindingTargetMode();
  const error = navigationBindingTargetError(page, options);
  if (!mode || error) {
    if (error) showRuntimeStatus(runtime, error, true, 2200);
    return false;
  }
  const selectedPageIds = [...mode.selectedPageIds];
  closeNavigationMoveMenu();
  try {
    const result = await request('/api/navigation/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedPageIds, leaderPageId: page.id })
    });
    navigation = result.navigation;
    clearNavigationSelection();
    renderPageList();
    showRuntimeStatus(
      runtime,
      `Bound ${selectedPageIds.length === 1 ? navigationBindingSourceText(selectedPageIds) : `${selectedPageIds.length} Pages`} to ${page.title || page.id}`,
      false,
      1800
    );
    return true;
  } catch (requestError) {
    showRuntimeStatus(runtime, requestError.message, true, 2200);
    return false;
  }
}

async function performFollowerBindingMutation(path, followerPageId, successText) {
  const runtime = activePaneRuntime();
  closePageContextMenu();
  closeNavigationMoveMenu();
  try {
    const result = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followerPageId })
    });
    navigation = result.navigation;
    clearNavigationSelection();
    renderPageList();
    showRuntimeStatus(runtime, successText, false, 1800);
    return true;
  } catch (error) {
    showRuntimeStatus(runtime, error.message, true, 2200);
    return false;
  }
}

function stopPageBinding(followerPageId) {
  return performFollowerBindingMutation(
    '/api/navigation/bindings/stop', followerPageId, 'Stopped Page Binding'
  );
}

function setPageBindingLeader(followerPageId) {
  return performFollowerBindingMutation(
    '/api/navigation/bindings/set-leader', followerPageId, 'Changed Binding Leader'
  );
}

async function openPageContextMenu(event, page, { parentFolderId = null, synthetic = false } = {}) {
  if (!window.nativeContextMenu?.available()) return;
  const runtime = activePaneRuntime();
  const operation = captureRuntimeOperation(runtime, {
    scope: 'navigation-page-menu',
    targetPageId: page.id
  });
  setEditMenuOpen(runtime, false);
  closeAddLinkPopover(runtime);
  closeFolderContextMenu();
  closeNavigationMoveMenu();
  closeRelationContextMenu();
  const key = navigationSelectionKey('page', page.id);
  selectNavigationItem(key, event, { rightClick: true });
  pageContextTarget = page;
  pageContextParentFolderId = parentFolderId;
  pageContextSynthetic = synthetic;
  pageContextSourceRow = event.currentTarget || null;
  const parentFolder = navigationFolderById(parentFolderId);
  const canSetDefault = !synthetic
    && parentFolder?.type === 'manual'
    && parentFolder?.source?.kind === 'manual'
    && (parentFolder.source.pageIds || []).includes(page.id);
  const selectedPageIds = selectedNavigationPageIds();
  const selectedItems = selectedNavigationMoveItems();
  const selectedStickItems = navigationStickSelectionItems(selectedItems);
  const bindingRole = navigationBindingFact(page.id).role;
  const unboundBindingPageIds = selectedUnboundBindingPageIds();
  const followerActionAvailable = bindingRole === 'follower' && selectedItems.length === 1;
  const command = await window.nativeContextMenu.open(event, {
    type: 'navigation-page',
    targetId: page.id,
    selectedCount: selectedNavigationItems.size || 1,
    selectedPageCount: selectedPageIds.length,
    synthetic,
    canSetDefault,
    isDefault: canSetDefault && parentFolder.defaultPageId === page.id,
    isPinned: !synthetic && selectedStickItems.length > 0
      && selectedStickItems.every(navigationItemStickOnTop),
    bindingRole,
    canBindToLeader: unboundBindingPageIds.length > 0
      && unboundBindingPageIds.length === selectedItems.length,
    canStopBinding: followerActionAvailable,
    canSetBindingLeader: followerActionAvailable,
    canMoveNavigation: !navigationItemsContainBoundFollower(selectedItems),
    canStickNavigation: !synthetic && !navigationItemsContainBoundFollower(selectedItems),
    deleteEnabled: !pageDeleteInProgress
  });
  if (!command || !runtimeOperationIsCurrent(operation)
    || runtime !== activePaneRuntime()) return closePageContextMenu();
  const freshPage = pageIndex.pages.find((candidate) => candidate.id === page.id);
  if (!freshPage) return closePageContextMenu();
  pageContextTarget = freshPage;
  pageContextParentFolderId = parentFolderId;
  pageContextSynthetic = synthetic;
  if (command === 'open-page-in-new-tab') {
    closePageContextMenu();
    openPageInNewTab(runtime, freshPage.id);
  }
  else if (command === 'rename-page' && selectedNavigationItems.size === 1) renameContextPage();
  else if (command === 'edit-page-categories') {
    openPageMetaModal(runtime, 'category', { pageIds: selectedPageIds });
  }
  else if (command === 'toggle-default-page') await toggleContextDefaultPage();
  else if (command === 'toggle-stick-page') {
    await toggleContextNavigationStickOnTop(selectedItems);
  }
  else if (command === 'move-navigation') openNavigationMoveMenu();
  else if (command === 'bind-to-leader') openNavigationBindingMenu(unboundBindingPageIds);
  else if (command === 'stop-binding') await stopPageBinding(freshPage.id);
  else if (command === 'set-binding-leader') await setPageBindingLeader(freshPage.id);
  else if (command === 'delete-page') {
    await deleteContextPage(runtime, { pageIds: selectedPageIds, navigationItems: selectedItems });
  }
}

function closeFolderContextMenu() {
  folderContextTarget = null;
  folderContextSourceRow = null;
}

async function openFolderContextMenu(event, folder) {
  if (folder.type !== 'manual' || folder.source?.kind !== 'manual') return;
  if (!window.nativeContextMenu?.available()) return;
  const runtime = activePaneRuntime();
  const operation = captureRuntimeOperation(runtime, {
    scope: 'navigation-folder-menu',
    targetFolderId: folder.id
  });
  setEditMenuOpen(runtime, false);
  closeAddLinkPopover(runtime);
  closePageContextMenu();
  closeNavigationMoveMenu();
  closeRelationContextMenu();
  closeResourceContextMenu();
  const key = navigationSelectionKey('folder', folder.id);
  selectNavigationItem(key, event, { rightClick: true });
  folderContextTarget = folder;
  folderContextSourceRow = event.currentTarget || null;
  const selectedItems = selectedNavigationMoveItems();
  const selectedPageIds = selectedItems
    .filter((item) => item.type === 'page')
    .map((item) => item.id);
  const selectedStickItems = navigationStickSelectionItems(selectedItems);
  const command = await window.nativeContextMenu.open(event, {
    type: 'navigation-folder',
    targetId: folder.id,
    selectedCount: selectedNavigationItems.size || 1,
    isPinned: selectedStickItems.length > 0
      && selectedStickItems.every(navigationItemStickOnTop),
    canMoveNavigation: !navigationItemsContainBoundFollower(selectedItems),
    canStickNavigation: !navigationItemsContainBoundFollower(selectedItems),
    deleteEnabled: !folderDeleteInProgress
  });
  if (!command || !runtimeOperationIsCurrent(operation)
    || runtime !== activePaneRuntime()) return closeFolderContextMenu();
  const freshFolder = navigationFolderById(folder.id);
  if (!freshFolder || freshFolder.type !== 'manual' || freshFolder.source?.kind !== 'manual') {
    return closeFolderContextMenu();
  }
  folderContextTarget = freshFolder;
  if (command === 'new-folder-in-folder') {
    closeFolderContextMenu();
    await createNewFolder({ parentFolderId: freshFolder.id });
  } else if (command === 'new-page-in-folder') {
    closeFolderContextMenu();
    await createNewPage({ runtime, parentFolderId: freshFolder.id });
  } else if (command === 'rename-folder' && selectedNavigationItems.size === 1) {
    renameContextFolder();
  }
  else if (command === 'toggle-stick-folder') {
    await toggleContextNavigationStickOnTop(selectedItems);
  }
  else if (command === 'move-navigation') openNavigationMoveMenu();
  else if (command === 'delete-folder') {
    if (selectedItems.length === 1) deleteContextFolder();
    else await deleteContextPage(runtime, {
      pageIds: selectedPageIds,
      navigationItems: selectedItems
    });
  }
}

function closeRelationContextMenu() {
  relationContextTarget = null;
}

async function openRelationContextMenu(runtime, event, relation) {
  if (runtime !== activePaneRuntime() || !window.nativeContextMenu?.available()) return;
  closePageContextMenu();
  closeFolderContextMenu();
  closeResourceContextMenu();
  const count = relation.instances?.length || 1;
  const firstInstance = relation.instances?.[0] || relation;
  const relationTargetId = [
    firstInstance.sourcePageId,
    firstInstance.sourceBlockId,
    firstInstance.sourceLinkId
  ].filter(Boolean).join(':');
  if (!relationTargetId) return closeRelationContextMenu();
  const pageId = runtime.currentPage?.id;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'relation-menu'
  });
  const command = await window.nativeContextMenu.open(event, {
    type: 'relation', targetId: relationTargetId,
    relationCount: count,
    deleteEnabled: !relationDeleteInProgress
  });
  if (command !== 'delete-relation' || !runtimeOperationIsCurrent(operation)
    || runtime !== activePaneRuntime()) {
    return closeRelationContextMenu();
  }
  relationContextTarget = { runtime, token: operation, relation };
  deleteContextRelation(runtime);
}

function navigationPageTypeBadge(page) {
  const pageType = page && typeof page === 'object' && Object.hasOwn(page, 'type')
    ? pageTypesModel.normalizePageType(page.type)
    : pageTypesModel.LEGACY_DEFAULT_PAGE_TYPE;
  const defaultPageType = pageTypesModel.normalizeVaultDefaultPageType(
    vaultPreferences?.defaultPageType
  );
  if (!pageType || pageType === defaultPageType) return null;
  return pageTypesModel.pageTypeNavigationBadge(pageType);
}

function syncNavigationPageTypeBadge(row, page) {
  const text = navigationPageTypeBadge(page);
  const existing = row.querySelector?.('.nav-page-type-badge') || null;
  if (!text) {
    existing?.remove();
    return null;
  }
  const badge = existing || document.createElement('span');
  badge.className = 'nav-page-type-badge system-typography';
  badge.dataset.pageTypeBadge = text;
  badge.textContent = text;
  if (!existing) row.append(badge);
  return badge;
}

function refreshMountedNavigationPageTypeBadges() {
  const pagesById = new Map((pageIndex?.pages || []).map((page) => [page.id, page]));
  for (const row of pageList.querySelectorAll('.page-link')) {
    const page = pagesById.get(row.dataset.pageId);
    if (page) syncNavigationPageTypeBadge(row, page);
  }
}

function createPageListButton(page, extraClass = '', options = {}) {
  const renaming = pageRenameState?.pageId === page.id;
  const button = document.createElement(renaming ? 'div' : 'button');
  const selectionKey = navigationSelectionKey('page', page.id);
  if (!renaming) button.type = 'button';
  button.className = `page-link file-typography${extraClass ? ` ${extraClass}` : ''}`;
  button.dataset.pageId = page.id;
  button.dataset.navigationSelectionKey = selectionKey;
  if (options.bindingFollower) button.dataset.bindingFollowerOf = options.leaderPageId || '';
  const motionContainerId = options.parentFolderId
    ? `folder:${options.parentFolderId}`
    : 'root';
  button.dataset.sidebarMotionId = options.bindingFollower
    ? `${motionContainerId}/binding:${options.leaderPageId}:follower:${page.id}`
    : `${motionContainerId}/page:${page.id}`;
  button.classList.toggle('nav-selected', selectedNavigationItems.has(selectionKey));
  button.classList.toggle(
    'active', !navigationExplicitSelectionMode && activePaneRuntime()?.currentPage?.id === page.id
  );
  button.classList.toggle('nav-page-renaming', renaming);
  button.classList.toggle('nav-binding-follower', options.bindingFollower === true);
  rememberNavigationVisibleItem(selectionKey);
  button.draggable = false;
  const isDefault = options.defaultPageId === page.id;
  const isPinned = navigationPageStickOnTop(page.id);
  if (!options.synthetic && (isDefault || isPinned)) {
    const statusGutter = document.createElement('span');
    statusGutter.className = 'nav-page-status-gutter';
    statusGutter.setAttribute('aria-hidden', 'true');
    const statusGroup = document.createElement('span');
    statusGroup.className = 'nav-page-status-group';
    const indicator = document.createElement('span');
    indicator.className = `nav-row-indicator nav-page-status-indicator ${isDefault ? 'nav-default-indicator' : 'nav-pin-indicator'}`;
    indicator.dataset.navigationIndicator = isDefault ? 'default' : 'pinned';
    indicator.setAttribute('aria-hidden', 'true');
    statusGroup.append(indicator);
    statusGutter.append(statusGroup);
    button.append(statusGutter);
  }
  if (options.bindingFollower) {
    const followerIndicator = document.createElement('span');
    followerIndicator.className = 'nav-binding-follower-indicator';
    followerIndicator.textContent = '↪';
    followerIndicator.setAttribute('aria-hidden', 'true');
    button.append(followerIndicator);
  }
  if (renaming) {
    button.append(createNavigationRenameInput('page', page));
  } else {
    const label = document.createElement('span');
    label.className = 'nav-page-label-text';
    label.textContent = page.title;
    button.append(label);
  }
  syncNavigationPageTypeBadge(button, page);
  if (renaming) return button;
  button.addEventListener('pointermove', (event) => {
    if (navigationBindingTargetMode()) {
      showNavigationBindingTarget(button, page, event, options);
    } else if (navigationMoveMode) clearNavigationMoveTarget();
  });
  button.addEventListener('pointerleave', () => {
    if (navigationMoveHoverFolderElement === button) clearNavigationMoveTarget();
  });
  button.addEventListener('click', (event) => {
    if (navigationBindingTargetMode()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      commitNavigationBindingTarget(page, options);
    } else if (navigationMoveMode) closeNavigationMoveMenu();
  }, true);
  button.addEventListener('click', (event) => {
    if (typeof consumeSidebarPageDragClick === 'function'
      && consumeSidebarPageDragClick(page.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const runtime = activePaneRuntime();
    if (runtime?.linkPickMode) {
      event.preventDefault();
      event.stopPropagation();
      selectLinkTargetPage(runtime, page);
      return;
    }
    if (navigationSelectionGesture(event)) {
      event.preventDefault();
      event.stopPropagation();
      selectNavigationItem(selectionKey, event);
      return;
    }
    clearNavigationSelection();
    if (typeof openPageFromSidebar === 'function') openPageFromSidebar(page.id);
  });
  button.addEventListener('contextmenu', (event) => openPageContextMenu(event, page, {
    parentFolderId: options.parentFolderId || null,
    synthetic: options.synthetic === true
  }));
  button.addEventListener('pointerdown', (event) => {
    if (typeof beginSidebarPageDrag === 'function') {
      beginSidebarPageDrag(event, button, page.id);
    }
  });
  button.addEventListener('lostpointercapture', (event) => {
    if (typeof handleSidebarPageDragLostPointerCapture === 'function') {
      handleSidebarPageDragLostPointerCapture(event);
    }
  });
  return button;
}

function renderFolderLabel(folder, folderWrapper) {
  const renaming = folderRenameState?.folderId === folder.id;
  const folderButton = document.createElement('div');
  const dynamicFolder = isDynamicNavigationFolder(folder);
  const displayLabel = dynamicFolder
    ? dynamicNavigationFolderDisplayLabel(folder)
    : (folder.label || folder.id);
  folderButton.className = dynamicFolder
    ? 'nav-folder-button nav-folder-dynamic-button system-typography'
    : 'nav-folder-button nav-folder-manual-button file-typography';
  folderButton.classList.toggle('nav-folder-renaming', renaming);
  folderButton.dataset.sidebarMotionId = `folder:${folder.id}`;
  const disclosureButton = document.createElement('button');
  disclosureButton.type = 'button';
  disclosureButton.className = 'nav-folder-disclosure-button';
  disclosureButton.setAttribute('aria-expanded', String(!folder.collapsed));
  disclosureButton.setAttribute('aria-label', `${folder.collapsed ? 'Expand' : 'Collapse'} ${displayLabel}`);
  const disclosure = document.createElement('span');
  disclosure.className = 'nav-folder-disclosure disclosure-chevron';
  disclosure.setAttribute('aria-hidden', 'true');
  disclosureButton.append(disclosure);
  let nameButton = null;
  if (renaming) {
    folderButton.append(disclosureButton, createNavigationRenameInput('folder', folder));
  } else {
    nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'nav-folder-name-button';
    const label = document.createElement('span');
    label.className = 'nav-folder-label-text';
    label.textContent = displayLabel;
    nameButton.append(label);
    folderButton.append(disclosureButton, nameButton);
  }
  if (!dynamicFolder && folder.stickOnTop === true) {
    const indicator = document.createElement('span');
    indicator.className = 'nav-row-indicator nav-pin-indicator';
    indicator.dataset.navigationIndicator = 'pinned';
    indicator.setAttribute('aria-hidden', 'true');
    folderButton.append(indicator);
  }
  disclosureButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearNavigationSelection();
    toggleNavigationFolder(folder);
  });
  if (renaming) {
    folderWrapper.append(folderButton);
    return;
  }
  const activateFolderLabel = (event) => {
      if (folder.type === 'manual' && navigationSelectionGesture(event)) {
        event.preventDefault();
        event.stopPropagation();
        selectNavigationItem(navigationSelectionKey('folder', folder.id), event);
        return;
      }
      clearNavigationSelection();
      toggleNavigationFolder(folder);
  };
  nameButton.addEventListener('click', activateFolderLabel);

  if (folder.type === 'manual') {
    const selectionKey = navigationSelectionKey('folder', folder.id);
    folderButton.dataset.navigationSelectionKey = selectionKey;
    folderButton.classList.toggle('nav-selected', selectedNavigationItems.has(selectionKey));
    rememberNavigationVisibleItem(selectionKey);
    folderButton.draggable = true;
    folderButton.addEventListener('contextmenu', (event) => openFolderContextMenu(event, folder));
    folderButton.addEventListener('dragstart', (event) => {
      setNavigationDragPayload(event, { items: navigationDragItems('folder', folder.id) });
    });
    folderButton.addEventListener('dragend', () => {
      navigationDragData = null;
      document.body.classList.remove('navigation-dragging');
      clearSidebarPageNavigationMembershipTarget();
    });
  }

  if (folder.type === 'manual' && folder.source?.kind === 'manual') {
    folderButton.addEventListener('pointermove', (event) => {
      showNavigationMoveTarget(folderWrapper, folder, event);
    });
    folderButton.addEventListener('pointerleave', () => {
      if (navigationMoveHoverFolderElement === folderWrapper) clearNavigationMoveTarget();
    });
    folderButton.addEventListener('click', (event) => {
      if (!navigationMoveMode) return;
      if (navigationBindingTargetMode()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const runtime = activePaneRuntime();
        showRuntimeStatus(runtime, 'Choose a Page as Leader.', true, 1800);
        return;
      }
      const items = navigationMoveMode.items;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (navigationFolderDestinationError(folder, items)) {
        closeNavigationMoveMenu();
        return;
      }
      performNavigationBatchMove({ items }, { parentFolderId: folder.id });
    }, true);
  }

  folderButton.addEventListener('dragover', (event) => {
    const payload = navigationDragPayload(event);
    const items = navigationItemsFromPayload(payload);
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    clearSidebarPageNavigationMembershipTarget();
    const destinationError = navigationFolderDestinationError(folder, items);
    folderWrapper.classList.toggle('is-drop-target', !destinationError);
    event.dataTransfer.dropEffect = destinationError ? 'none' : 'move';
  });
  folderButton.addEventListener('dragleave', () => {
    folderWrapper.classList.remove('is-drop-target');
  });
  folderButton.addEventListener('drop', (event) => {
    const payload = navigationDragPayload(event);
    const items = navigationItemsFromPayload(payload);
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    navigationDragData = null;
    clearSidebarPageNavigationMembershipTarget();
    const destinationError = navigationFolderDestinationError(folder, items);
    if (destinationError) {
      const runtime = activePaneRuntime();
      showRuntimeStatus(runtime, destinationError, true, 2200);
      return;
    }
    moveNavigationItemToFolder(folder, payload);
  });

  folderWrapper.append(folderButton);
}

function folderHasVisibleContent(folder) {
  return folderPages(folder).length > 0
    || (folder.children || []).some((childFolder) => folderHasVisibleContent(childFolder));
}

function isDynamicNavigationFolder(folder) {
  return folder?.type === 'system' || folder?.source?.kind !== 'manual';
}

function dynamicNavigationFolderDisplayLabel(folder) {
  const label = folder?.label || folder?.id || '';
  if (!isDynamicNavigationFolder(folder)
    || typeof categoryConfig !== 'object'
    || categoryConfig?.navigation?.quantityStatistics !== true) return label;
  return `${label} (${new Set(resolveFolderPageIds(folder)).size})`;
}

function appendProjectedPageRows(container, entry, extraClass, options = {}) {
  container.append(createPageListButton(entry.page, extraClass, options));
  if (entry.bindingVisualRole !== 'leader') return;
  for (const followerPage of entry.followerPages || []) {
    container.append(createPageListButton(followerPage, extraClass, {
      ...options,
      defaultPageId: null,
      bindingFollower: true,
      leaderPageId: entry.page.id
    }));
  }
}

function renderNavigationFolder(folder, depth = 0) {
  if (navigationViewRestricted() && !folderHasVisibleContent(folder)) return null;

  const folderWrapper = document.createElement('section');
  const dynamicClass = isDynamicNavigationFolder(folder) ? ' nav-folder-dynamic' : '';
  folderWrapper.className = `nav-folder nav-folder-depth-${Math.min(depth, 4)}${dynamicClass}`;
  folderWrapper.dataset.folderId = folder.id;
  folderWrapper.style.setProperty('--folder-depth', depth);

  renderFolderLabel(folder, folderWrapper);

  if (!folder.collapsed || (navigationViewRestricted() && !activePaneRuntime()?.linkPickMode)) {
    const folderPageList = document.createElement('div');
    folderPageList.className = 'nav-folder-pages';
    folderPageList.dataset.navigationContainerId = `folder:${folder.id}`;
    folderPageList.dataset.sidebarMotionRegion = folder.id;
    folderPageList.dataset.navigationMembershipContainer = String(
      folder.type === 'manual' && folder.source?.kind === 'manual'
    );
    const entries = folderNavigationEntries(folder, depth + 1);

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'nav-folder-empty';
      empty.textContent = 'No pages';
      folderPageList.append(empty);
    } else {
      for (const entry of entries) {
        if (entry.type === 'folder') {
          const childElement = renderNavigationFolder(entry.folder, depth + 1);
          if (childElement) folderPageList.append(childElement);
        } else if (entry.page) {
          appendProjectedPageRows(folderPageList, entry, 'in-folder', {
            parentFolderId: folder.id,
            defaultPageId: isDynamicNavigationFolder(folder) ? null : folder.defaultPageId,
            synthetic: isDynamicNavigationFolder(folder)
          });
        }
      }
    }

    folderWrapper.append(folderPageList);
  }

  return folderWrapper;
}

function rootNavigationEntries() {
  const units = projectNavigationPageUnits(
    (navigation.items || []).filter((item) => typeof item === 'string')
  );
  return [
    ...tieredNavigationEntries(navigation.folders || [], [], { fixedFoldersFirst: true }),
    ...tierProjectedNavigationEntries([], units)
  ];
}

function renderPageList({
  force = false,
  membershipAnimationRender = false,
  sidebarMotionRender = membershipAnimationRender
} = {}) {
  if (!sidebarMotionRender) interruptSidebarMembershipMoveAnimation('rerender');
  // Inline naming owns its existing row until commit or cancel. Other navigation
  // state may change in memory, but must not destroy, resort, or recreate the
  // editor while the user is typing or composing text.
  if (navigationRenameSession || folderRenameState || pageRenameState) {
    navigationRenameRenderPending = true;
    refreshMountedNavigationPageTypeBadges();
    return;
  }
  if (typeof sidebarPageDragState !== 'undefined' && sidebarPageDragState
    && typeof cancelSidebarPageDrag === 'function') {
    cancelSidebarPageDrag({ immediate: false });
  }
  navigationVisibleOrder = [];
  pageList.dataset.navigationContainerId = 'root';
  pageList.dataset.navigationMembershipContainer = 'true';
  pageList.replaceChildren();
  const entries = rootNavigationEntries();
  for (const entry of entries) {
    if (entry.type === 'folder') {
      const folderElement = renderNavigationFolder(entry.folder, 0);
      if (folderElement) pageList.append(folderElement);
    } else if (entry.page) {
      appendProjectedPageRows(pageList, entry, '', {
        parentFolderId: null,
        synthetic: false
      });
    }
  }

  if (navigationViewRestricted()
    && !pageList.querySelector('.page-link')
    && !pageList.querySelector('.nav-folder')) {
    const empty = document.createElement('p');
    empty.className = 'nav-empty-state';
    empty.textContent = 'No matching pages';
    pageList.append(empty);
  }
  reconcileNavigationPageSelectionVisibility();
}

const navigationContextSurface = pageList.closest?.('.left-sidebar-scroll-region') || pageList;

async function openNavigationBackgroundContextMenu(event) {
  if (event.target !== pageList && event.target !== navigationContextSurface) return;
  if (!window.nativeContextMenu?.available()) return;
  const command = await window.nativeContextMenu.open(event, {
    type: 'navigation-background',
    targetId: 'navigation-root'
  });
  if (command === 'new-page') newPageButton.click();
  else if (command === 'new-folder') newFolderButton?.click();
}

navigationContextSurface.addEventListener('contextmenu', openNavigationBackgroundContextMenu);

function navigationRootDropEventEligible(event) {
  if (event.target.closest?.('.nav-folder')) return false;
  if (event.target.closest?.('#descriptor-search-panel, #filter-panel')) return false;
  return event.target === navigationContextSurface || pageList.contains(event.target);
}

navigationContextSurface.addEventListener('dragover', (event) => {
  const payload = navigationDragPayload(event);
  const items = navigationItemsFromPayload(payload);
  if (!items.length) return;
  if (!navigationRootDropEventEligible(event)) {
    clearSidebarPageNavigationMembershipTarget();
    return;
  }
  event.preventDefault();
  clearSidebarPageNavigationMembershipTarget();
  const destinationError = navigationRootDestinationError(items);
  event.dataTransfer.dropEffect = destinationError ? 'none' : 'move';
});

navigationContextSurface.addEventListener('dragleave', (event) => {
  if (navigationContextSurface.contains(event.relatedTarget)) return;
  clearSidebarPageNavigationMembershipTarget();
});

navigationContextSurface.addEventListener('drop', (event) => {
  const payload = navigationDragPayload(event);
  const items = navigationItemsFromPayload(payload);
  if (!items.length) return;
  if (!navigationRootDropEventEligible(event)) {
    clearSidebarPageNavigationMembershipTarget();
    return;
  }
  event.preventDefault();
  navigationDragData = null;
  clearSidebarPageNavigationMembershipTarget();
  const destinationError = navigationRootDestinationError(items);
  if (destinationError) {
    const runtime = activePaneRuntime();
    showRuntimeStatus(runtime, destinationError, true, 2200);
    return;
  }
  performNavigationBatchMove(payload, { parentFolderId: null });
});
