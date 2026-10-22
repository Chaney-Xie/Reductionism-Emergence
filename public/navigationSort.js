(function initNavigationSort(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.navigationSort = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const DEFAULT_SORT_MODE = 'name_asc';
  const SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'name_asc', label: 'File name (A to Z)', group: 'name' }),
    Object.freeze({ value: 'name_desc', label: 'File name (Z to A)', group: 'name' }),
    Object.freeze({ value: 'modified_desc', label: 'Modified time (new to old)', group: 'modified' }),
    Object.freeze({ value: 'modified_asc', label: 'Modified time (old to new)', group: 'modified' }),
    Object.freeze({ value: 'created_desc', label: 'Created time (new to old)', group: 'created' }),
    Object.freeze({ value: 'created_asc', label: 'Created time (old to new)', group: 'created' })
  ]);
  const VALID_SORT_MODES = new Set(SORT_OPTIONS.map((option) => option.value));
  const titleCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
    usage: 'sort'
  });

  function normalizeSortMode(value) {
    return VALID_SORT_MODES.has(value) ? value : DEFAULT_SORT_MODE;
  }

  function compareVisibleNames(left, right, getName = (item) => item?.title) {
    const nameResult = titleCollator.compare(
      String(getName(left) || ''),
      String(getName(right) || '')
    );
    if (nameResult) return nameResult;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  }

  function compareVisibleNamesDescending(left, right, getName = (item) => item?.title) {
    const nameResult = titleCollator.compare(
      String(getName(right) || ''),
      String(getName(left) || '')
    );
    if (nameResult) return nameResult;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  }

  function validTimestamp(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function comparePages(left, right, mode = DEFAULT_SORT_MODE) {
    const normalizedMode = normalizeSortMode(mode);
    if (normalizedMode === 'name_asc') return compareVisibleNames(left, right);
    if (normalizedMode === 'name_desc') return compareVisibleNamesDescending(left, right);

    const field = normalizedMode.startsWith('modified_') ? 'updatedAt' : 'createdAt';
    const leftTime = validTimestamp(left?.[field]);
    const rightTime = validTimestamp(right?.[field]);
    if (leftTime === null && rightTime !== null) return 1;
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return normalizedMode.endsWith('_desc') ? rightTime - leftTime : leftTime - rightTime;
    }
    return compareVisibleNames(left, right);
  }

  function sortPages(pages, mode = DEFAULT_SORT_MODE) {
    return [...(pages || [])].sort((left, right) => comparePages(left, right, mode));
  }

  function folderNameDirection(mode) {
    return normalizeSortMode(mode) === 'name_desc' ? -1 : 1;
  }

  function isFixedFolder(folder) {
    return Boolean(folder?.pinned)
      || folder?.type === 'system'
      || (typeof folder?.source?.kind === 'string' && folder.source.kind !== 'manual');
  }

  function isDynamicFolder(folder) {
    return typeof folder?.source?.kind === 'string' && folder.source.kind !== 'manual';
  }

  function isUncategorisedFolder(folder) {
    return folder?.id === 'folder_uncategorised' || folder?.source?.kind === 'missingCategories';
  }

  function sortFixedFolders(folders, mode) {
    return [...folders].sort((left, right) => {
      const leftRank = isUncategorisedFolder(left) ? 0 : isDynamicFolder(left) ? 1 : 2;
      const rightRank = isUncategorisedFolder(right) ? 0 : isDynamicFolder(right) ? 1 : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return 0;
    });
  }

  function sortFolders(folders, mode = DEFAULT_SORT_MODE) {
    const source = [...(folders || [])];
    const direction = folderNameDirection(mode);
    const fixed = sortFixedFolders(source.filter(isFixedFolder), mode);
    const movable = source
      .filter((folder) => !isFixedFolder(folder))
      .sort((left, right) => (
        direction === -1
          ? compareVisibleNamesDescending(left, right, (item) => item?.label)
          : compareVisibleNames(left, right, (item) => item?.label)
      ));
    return [...fixed, ...movable];
  }

  function tierNavigationEntries({
    folders = [],
    pages = [],
    mode = DEFAULT_SORT_MODE,
    defaultPageId = null,
    isFolderPinned = (folder) => folder?.stickOnTop === true,
    isPagePinned = () => false,
    fixedFoldersFirst = false
  } = {}) {
    const sortedFolders = sortFolders(folders, mode);
    const sortedPages = sortPages(pages, mode);
    const fixedFolders = sortedFolders.filter(isFixedFolder);
    const movableFolders = sortedFolders.filter((folder) => !isFixedFolder(folder));
    const pinnedFolders = movableFolders.filter(isFolderPinned);
    const ordinaryFolders = movableFolders.filter((folder) => !isFolderPinned(folder));
    const defaultPage = sortedPages.find((page) => page?.id === defaultPageId) || null;
    const remainingPages = sortedPages.filter((page) => page !== defaultPage);
    const pinnedPages = remainingPages.filter(isPagePinned);
    const ordinaryPages = remainingPages.filter((page) => !isPagePinned(page));
    const entries = [];
    const addFolders = (items) => items.forEach((folder) => entries.push({ type: 'folder', folder }));
    const addPages = (items) => items.forEach((page) => entries.push({ type: 'page', page }));
    if (fixedFoldersFirst) addFolders(fixedFolders);
    if (defaultPage) addPages([defaultPage]);
    if (!fixedFoldersFirst) addFolders(fixedFolders);
    addFolders(pinnedFolders);
    addPages(pinnedPages);
    addFolders(ordinaryFolders);
    addPages(ordinaryPages);
    return entries;
  }

  return Object.freeze({
    DEFAULT_SORT_MODE,
    SORT_OPTIONS,
    comparePages,
    compareVisibleNames,
    isFixedFolder,
    isDynamicFolder,
    isUncategorisedFolder,
    normalizeSortMode,
    sortFolders,
    sortPages,
    tierNavigationEntries,
    validTimestamp
  });
}));
