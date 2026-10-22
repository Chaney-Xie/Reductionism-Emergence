(function initDescriptorMetadataInstall(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.descriptorMetadataInstallModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function requiredRecord(value, name) {
    if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
    return value;
  }

  function optionalRecord(value, name) {
    if (value === undefined) return undefined;
    return requiredRecord(value, name);
  }

  function stringArray(value, name, { optional = false } = {}) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new TypeError(`${name} must be an array of strings.`);
    }
    return [...new Set(value)];
  }

  function pageArray(value, { optional = false } = {}) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)
      || value.some((page) => !isRecord(page) || typeof page.id !== 'string' || !page.id)) {
      throw new TypeError('pages must contain full Page records with stable IDs.');
    }
    const pageIds = new Set();
    for (const page of value) {
      if (pageIds.has(page.id)) throw new TypeError(`pages contains duplicate Page ID ${page.id}.`);
      pageIds.add(page.id);
    }
    return [...value];
  }

  function pageMetadataProjection(value, metadataRevision) {
    const projection = requiredRecord(value, 'pageMetadataProjection');
    if (projection.metadataRevision !== metadataRevision) {
      throw new TypeError('pageMetadataProjection.metadataRevision must match metadataRevision.');
    }
    if (!Array.isArray(projection.pages)) {
      throw new TypeError('pageMetadataProjection.pages must be an array.');
    }
    const allowedFields = new Set([
      'id',
      'descriptors',
      'ignoredDescriptors',
      'ignoredManualEntryIds',
      'updatedAt'
    ]);
    const pageIds = new Set();
    for (const page of projection.pages) {
      if (!isRecord(page) || typeof page.id !== 'string' || !page.id) {
        throw new TypeError('pageMetadataProjection.pages must contain stable Page IDs.');
      }
      if (pageIds.has(page.id)) {
        throw new TypeError(`pageMetadataProjection.pages contains duplicate Page ID ${page.id}.`);
      }
      pageIds.add(page.id);
      const fields = Object.keys(page);
      if (fields.some((field) => !allowedFields.has(field))) {
        throw new TypeError('pageMetadataProjection Page records must contain metadata fields only.');
      }
      for (const field of ['descriptors', 'ignoredDescriptors', 'ignoredManualEntryIds']) {
        requiredRecord(page[field], `pageMetadataProjection.${page.id}.${field}`);
      }
      if (page.updatedAt !== null && typeof page.updatedAt !== 'string') {
        throw new TypeError(`pageMetadataProjection.${page.id}.updatedAt must be a string or null.`);
      }
    }
    return projection;
  }

  function extractMetadataChangeSet(candidate) {
    if (!isRecord(candidate)) return null;
    if (Object.hasOwn(candidate, 'metadataChangeSet')) {
      return candidate.metadataChangeSet == null ? null : candidate.metadataChangeSet;
    }
    return candidate;
  }

  function validateMetadataChangeSet(candidate) {
    const source = extractMetadataChangeSet(candidate);
    if (!source) return null;
    requiredRecord(source, 'metadataChangeSet');
    if (!Number.isSafeInteger(source.metadataRevision) || source.metadataRevision < 0) {
      throw new TypeError('metadataRevision must be a non-negative safe integer.');
    }

    const pageIndex = requiredRecord(source.pageIndex, 'pageIndex');
    if (!Array.isArray(pageIndex.pages)) throw new TypeError('pageIndex.pages must be an array.');
    const descriptorRegistry = requiredRecord(source.descriptorRegistry, 'descriptorRegistry');
    if (!Array.isArray(descriptorRegistry.entries)) {
      throw new TypeError('descriptorRegistry.entries must be an array.');
    }
    for (const [name, projection] of [
      ['pageIndex', pageIndex],
      ['descriptorRegistry', descriptorRegistry]
    ]) {
      if (projection.metadataRevision !== source.metadataRevision) {
        throw new TypeError(`${name}.metadataRevision must match metadataRevision.`);
      }
    }
    const cumulativePageMetadata = pageMetadataProjection(
      source.pageMetadataProjection,
      source.metadataRevision
    );
    const pageIndexIds = new Set();
    for (const page of pageIndex.pages) {
      if (!isRecord(page) || typeof page.id !== 'string' || !page.id) {
        throw new TypeError('pageIndex.pages must contain stable Page IDs.');
      }
      if (pageIndexIds.has(page.id)) {
        throw new TypeError(`pageIndex.pages contains duplicate Page ID ${page.id}.`);
      }
      pageIndexIds.add(page.id);
    }
    const projectionIds = new Set(cumulativePageMetadata.pages.map((page) => page.id));
    if (pageIndexIds.size !== projectionIds.size
      || [...pageIndexIds].some((pageId) => !projectionIds.has(pageId))) {
      throw new TypeError('pageMetadataProjection Page IDs must exactly match pageIndex Page IDs.');
    }

    const snapshot = !Object.hasOwn(source, 'changedPageIds')
      && !Object.hasOwn(source, 'deletedPageIds')
      && !Object.hasOwn(source, 'changedDomains')
      && !Object.hasOwn(source, 'pages');
    const changedPageIds = stringArray(source.changedPageIds, 'changedPageIds', { optional: snapshot });
    const deletedPageIds = stringArray(source.deletedPageIds, 'deletedPageIds', { optional: snapshot });
    const changedDomains = stringArray(source.changedDomains, 'changedDomains', { optional: snapshot });
    const pages = pageArray(source.pages, { optional: snapshot });

    if (!snapshot) {
      const deletedIds = new Set(deletedPageIds);
      const presentPageIds = new Set(pages.map((page) => page.id));
      const expectedPresentPageIds = new Set(
        changedPageIds.filter((pageId) => !deletedIds.has(pageId))
      );
      if (presentPageIds.size !== expectedPresentPageIds.size
        || [...expectedPresentPageIds].some((pageId) => !presentPageIds.has(pageId))) {
        throw new TypeError(
          'metadataChangeSet pages must exactly match changedPageIds excluding deletedPageIds.'
        );
      }
      for (const pageId of presentPageIds) {
        if (deletedIds.has(pageId)) {
          throw new TypeError(`metadataChangeSet Page ${pageId} cannot also be deleted.`);
        }
        if (!projectionIds.has(pageId)) {
          throw new TypeError(`metadataChangeSet Page ${pageId} is absent from the cumulative projection.`);
        }
      }
      for (const pageId of deletedIds) {
        if (projectionIds.has(pageId)) {
          throw new TypeError(
            `metadataChangeSet deleted Page ${pageId} remains in the cumulative projection.`
          );
        }
      }
    }

    return Object.freeze({
      snapshot,
      metadataRevision: source.metadataRevision,
      changedPageIds: Object.freeze(changedPageIds),
      deletedPageIds: Object.freeze(deletedPageIds),
      changedDomains: Object.freeze(changedDomains),
      pages: Object.freeze(pages),
      pageMetadataProjection: cumulativePageMetadata,
      pageIndex,
      descriptorRegistry,
      vocabulary: optionalRecord(source.vocabulary, 'vocabulary'),
      descriptorGroups: optionalRecord(source.descriptorGroups, 'descriptorGroups')
    });
  }

  function createRevisionInstaller({ apply, initialRevision = null } = {}) {
    if (typeof apply !== 'function') throw new TypeError('apply must be a function.');
    if (initialRevision !== null
      && (!Number.isSafeInteger(initialRevision) || initialRevision < 0)) {
      throw new TypeError('initialRevision must be null or a non-negative safe integer.');
    }

    let metadataRevision = initialRevision;
    let initialized = initialRevision !== null;
    let queue = Promise.resolve();
    let pendingBeforeSnapshot = [];

    function currentRevision() {
      return metadataRevision;
    }

    function enqueue(changeSet, context) {
      const operation = queue.then(async () => {
        if (metadataRevision !== null && changeSet.metadataRevision < metadataRevision) {
          return Object.freeze({
            applied: false,
            stale: true,
            revision: metadataRevision,
            incomingRevision: changeSet.metadataRevision
          });
        }
        if (metadataRevision !== null && changeSet.metadataRevision === metadataRevision) {
          return Object.freeze({
            applied: false,
            idempotent: true,
            revision: metadataRevision
          });
        }

        await apply(changeSet, context);
        metadataRevision = changeSet.metadataRevision;
        return Object.freeze({
          applied: true,
          revision: metadataRevision,
          changeSet
        });
      });
      queue = operation.catch(() => {});
      return operation;
    }

    function releasePendingBeforeSnapshot() {
      const pending = pendingBeforeSnapshot;
      pendingBeforeSnapshot = [];
      for (const item of pending) {
        enqueue(item.changeSet, item.context).then(item.resolve, item.reject);
      }
    }

    function install(candidate, context = {}) {
      let changeSet;
      try {
        changeSet = validateMetadataChangeSet(candidate);
      } catch (error) {
        return Promise.reject(error);
      }
      if (!changeSet) {
        return Promise.resolve(Object.freeze({
          applied: false,
          empty: true,
          revision: metadataRevision
        }));
      }
      if (!initialized && !changeSet.snapshot) {
        return new Promise((resolve, reject) => {
          pendingBeforeSnapshot.push({ changeSet, context, resolve, reject });
        });
      }

      const operation = enqueue(changeSet, context);
      if (!initialized && changeSet.snapshot) {
        operation.then(() => {
          initialized = true;
          releasePendingBeforeSnapshot();
        }, () => {});
      }
      return operation;
    }

    return Object.freeze({ currentRevision, install });
  }

  return Object.freeze({
    extractMetadataChangeSet,
    validateMetadataChangeSet,
    createRevisionInstaller
  });
}));
