const crypto = require('crypto');

// Pure descriptor/vocabulary shape normalization and mutation helpers.
// Persistence and sync orchestration remain in descriptor services/appServer.
function createDescriptorModel(samples) {
  function descriptorClasses(library = samples['descriptors.json']) {
    const classes = Array.isArray(library.classes) ? library.classes : samples['descriptors.json'].classes;
    return classes.filter((item) => item && typeof item.id === 'string');
  }

  function normalizeDescriptorText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function descriptorCompareKey(text) {
    return normalizeDescriptorText(text).toLocaleLowerCase();
  }

  function normalizeVocabularyLibrary(library = {}) {
    const legacyEntries = Array.isArray(library.descriptors) ? library.descriptors : [];
    const rawEntries = Array.isArray(library.entries) ? library.entries : legacyEntries;
    const normalized = {
      version: 1,
      entries: []
    };

    for (const rawEntry of rawEntries) {
      const display = normalizeDescriptorText(typeof rawEntry === 'string' ? rawEntry : rawEntry?.display);
      if (!display) continue;
      const aliases = [];
      const seenAliases = new Set();
      for (const alias of Array.isArray(rawEntry?.aliases) ? rawEntry.aliases : []) {
        const normalizedAlias = normalizeDescriptorText(alias);
        if (!normalizedAlias || normalizedAlias === display || seenAliases.has(normalizedAlias)) continue;
        seenAliases.add(normalizedAlias);
        aliases.push(normalizedAlias);
      }
      const rawId = typeof rawEntry?.id === 'string' && /^[a-z0-9_-]+$/i.test(rawEntry.id)
        ? rawEntry.id
        : null;
      const existingIds = new Set(normalized.entries.map((entry) => entry.id));
      normalized.entries.push({
        id: rawId && !existingIds.has(rawId) ? rawId : uniqueVocabularyEntryId(normalized, display),
        display,
        aliases
      });
    }

    return normalized;
  }

  function vocabularyTextOwners(library = {}) {
    const owners = new Map();
    const normalized = normalizeVocabularyLibrary(library);

    for (const entry of normalized.entries || []) {
      for (const text of [entry.display, ...(entry.aliases || [])]) {
        if (!text) continue;
        if (!owners.has(text)) owners.set(text, new Set());
        owners.get(text).add(entry.id);
      }
    }

    return owners;
  }

  function isSubsetStringSet(a = new Set(), b = new Set()) {
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  function validateVocabularyLibrary(library, previousLibrary = null) {
    const ids = new Set();
    const textOwners = new Map();
    const previousTextOwners = previousLibrary ? vocabularyTextOwners(previousLibrary) : null;
    const normalized = normalizeVocabularyLibrary(library);

    for (const entry of normalized.entries || []) {
      if (!/^[a-z0-9_-]+$/i.test(entry.id)) {
        return { error: `Invalid vocabulary entry id: ${entry.id}` };
      }
      if (ids.has(entry.id)) return { error: `Duplicate vocabulary entry id: ${entry.id}` };
      ids.add(entry.id);

      const texts = [entry.display, ...(entry.aliases || [])];
      const entryTexts = new Set();
      for (const text of texts) {
        if (!text) return { error: 'Vocabulary text cannot be empty.' };
        if (entryTexts.has(text)) return { error: `"${text}" is duplicated within one vocabulary entry.` };
        entryTexts.add(text);
        if (!textOwners.has(text)) textOwners.set(text, new Set());
        textOwners.get(text).add(entry.id);
      }
    }

    for (const [text, owners] of textOwners.entries()) {
      if (owners.size <= 1) continue;
      const previousOwners = previousTextOwners?.get(text) || new Set();
      if (previousTextOwners && isSubsetStringSet(owners, previousOwners)) continue;
      return { error: `"${text}" already belongs to another vocabulary entry.` };
    }

    return { library: normalized };
  }

  function removeDescriptorIdsFromPageDescriptors(descriptors, deletedDescriptorIds) {
    if (!descriptors || typeof descriptors !== 'object' || Array.isArray(descriptors)) return false;
    let changed = false;

    for (const [classId, items] of Object.entries(descriptors)) {
      if (!Array.isArray(items)) continue;
      const nextItems = items.filter((item) => {
        const entryId = typeof item?.entryId === 'string'
          ? item.entryId
          : typeof item === 'string' ? item : null;
        return !entryId || !deletedDescriptorIds.has(entryId);
      });
      if (nextItems.length !== items.length) {
        descriptors[classId] = nextItems;
        changed = true;
      }
    }

    return changed;
  }

  function removeDescriptorIdsFromIgnored(ignoredDescriptors, deletedDescriptorIds) {
    return removeDescriptorIdsFromPageDescriptors(ignoredDescriptors, deletedDescriptorIds);
  }

  function remapDescriptorIdsInGroups(descriptors, descriptorIdRemap) {
    if (!descriptors || typeof descriptors !== 'object' || Array.isArray(descriptors)) return false;
    let changed = false;

    for (const [classId, items] of Object.entries(descriptors)) {
      if (!Array.isArray(items)) continue;
      const seen = new Set();
      const nextItems = [];
      for (const item of items) {
        const entryId = typeof item?.entryId === 'string'
          ? item.entryId
          : typeof item === 'string' ? item : null;
        if (!entryId) {
          nextItems.push(item);
          continue;
        }
        const nextEntryId = descriptorIdRemap.get(entryId) || entryId;
        const source = item?.source === 'auto' ? 'auto' : 'manual';
        const seenKey = typeof item === 'string' ? nextEntryId : `${nextEntryId}|${source}`;
        if (nextEntryId !== entryId || seen.has(seenKey)) changed = true;
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
        nextItems.push(typeof item === 'string'
          ? nextEntryId
          : { ...item, entryId: nextEntryId });
      }
      descriptors[classId] = nextItems;
    }

    return changed;
  }

  function remapDescriptorIdList(items, descriptorIdRemap) {
    if (!Array.isArray(items)) return { items, changed: false };
    const seen = new Set();
    const nextItems = [];
    let changed = false;
    for (const entryId of items) {
      if (typeof entryId !== 'string') continue;
      const nextEntryId = descriptorIdRemap.get(entryId) || entryId;
      if (nextEntryId !== entryId || seen.has(nextEntryId)) changed = true;
      if (seen.has(nextEntryId)) continue;
      seen.add(nextEntryId);
      nextItems.push(nextEntryId);
    }
    return { items: nextItems, changed };
  }

  function normalizeDescriptorLibrary(library = {}) {
    const normalized = {
      version: 1,
      ...(Number.isSafeInteger(library.metadataRevision) && library.metadataRevision >= 0
        ? { metadataRevision: library.metadataRevision }
        : {}),
      classes: descriptorClasses(library).length ? descriptorClasses(library) : samples['descriptors.json'].classes,
      groups: Array.isArray(library.groups) ? library.groups : samples['descriptors.json'].groups,
      entries: Array.isArray(library.entries) ? library.entries : []
    };

    normalized.entries = normalized.entries
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.display === 'string')
      .map((entry) => ({
        id: entry.id,
        display: normalizeDescriptorText(entry.display),
        vocabularyEntryId: typeof entry.vocabularyEntryId === 'string' ? entry.vocabularyEntryId : undefined,
        groupId: typeof entry.groupId === 'string' ? entry.groupId : 'ungrouped',
        createdAt: entry.createdAt || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
      }))
      .filter((entry) => entry.display);

    return normalized;
  }

  function uniqueVocabularyEntryId(library, display) {
    const existingIds = new Set((library.entries || []).map((entry) => entry.id));
    const slug = normalizeDescriptorText(display)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || crypto.randomBytes(4).toString('hex');
    const base = `vocab_${slug}`;
    if (!existingIds.has(base)) return base;

    let number = 1;
    while (existingIds.has(`${base}_${number}`)) number += 1;
    return `${base}_${number}`;
  }

  function vocabularyEntryByText(library) {
    const byText = new Map();
    for (const entry of library.entries || []) {
      byText.set(descriptorCompareKey(entry.display), entry);
      for (const alias of entry.aliases || []) {
        const key = descriptorCompareKey(alias);
        if (key && !byText.has(key)) byText.set(key, entry);
      }
    }
    return byText;
  }

  function getOrCreateVocabularyEntry(library, display, now, preferredId = null) {
    const normalizedDisplay = normalizeDescriptorText(display);
    if (!normalizedDisplay) return null;

    const existing = vocabularyEntryByText(library).get(descriptorCompareKey(normalizedDisplay));
    if (existing) return existing;

    const entry = {
      id: typeof preferredId === 'string'
        && /^[a-z0-9_-]+$/i.test(preferredId)
        && !(library.entries || []).some((candidate) => candidate.id === preferredId)
        ? preferredId
        : uniqueVocabularyEntryId(library, normalizedDisplay),
      display: normalizedDisplay,
      aliases: []
    };
    library.entries.push(entry);
    return entry;
  }

  function uniqueDescriptorEntryId(library, display) {
    const existingIds = new Set((library.entries || []).map((entry) => entry.id));
    const slug = normalizeDescriptorText(display)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || crypto.randomBytes(4).toString('hex');
    const base = `desc_${slug}`;
    if (!existingIds.has(base)) return base;

    let number = 1;
    while (existingIds.has(`${base}_${number}`)) number += 1;
    return `${base}_${number}`;
  }

  function descriptorEntryByText(library) {
    return new Map((library.entries || []).map((entry) => [descriptorCompareKey(entry.display), entry]));
  }

  function descriptorEntryByVocabulary(library) {
    return new Map((library.entries || [])
      .filter((entry) => entry.vocabularyEntryId)
      .map((entry) => [entry.vocabularyEntryId, entry]));
  }

  function getOrCreateDescriptorEntry(library, vocabularyEntry, now, preferredId = null) {
    if (!vocabularyEntry) return null;
    const byVocabulary = descriptorEntryByVocabulary(library);
    const existingByVocabulary = byVocabulary.get(vocabularyEntry.id);
    if (existingByVocabulary) {
      existingByVocabulary.display = vocabularyEntry.display;
      existingByVocabulary.groupId = vocabularyEntry.groupId || 'ungrouped';
      existingByVocabulary.vocabularyEntryId = vocabularyEntry.id;
      existingByVocabulary.updatedAt = now;
      return existingByVocabulary;
    }

    const byText = descriptorEntryByText(library);
    const existingByText = byText.get(descriptorCompareKey(vocabularyEntry.display));
    if (existingByText) {
      existingByText.display = vocabularyEntry.display;
      existingByText.groupId = vocabularyEntry.groupId || existingByText.groupId || 'ungrouped';
      existingByText.vocabularyEntryId = vocabularyEntry.id;
      existingByText.updatedAt = now;
      return existingByText;
    }

    const entry = {
      id: typeof preferredId === 'string'
        && /^[a-z0-9_-]+$/i.test(preferredId)
        && !(library.entries || []).some((candidate) => candidate.id === preferredId)
        ? preferredId
        : uniqueDescriptorEntryId(library, vocabularyEntry.display),
      display: vocabularyEntry.display,
      vocabularyEntryId: vocabularyEntry.id,
      groupId: vocabularyEntry.groupId || 'ungrouped',
      createdAt: now,
      updatedAt: now
    };
    library.entries.push(entry);
    return entry;
  }

  function emptyPageDescriptorGroups(library = samples['descriptors.json']) {
    return Object.fromEntries(descriptorClasses(library).map((descriptorClass) => [descriptorClass.id, []]));
  }

  function normalizeIgnoredManualEntryIds(
    value,
    ignoredDescriptors,
    library = samples['descriptors.json']
  ) {
    const groups = emptyPageDescriptorGroups(library);
    const supplied = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const ignored = ignoredDescriptors && typeof ignoredDescriptors === 'object'
      && !Array.isArray(ignoredDescriptors) ? ignoredDescriptors : {};

    for (const descriptorClass of descriptorClasses(library)) {
      const classId = descriptorClass.id;
      const ignoredIds = new Set((Array.isArray(ignored[classId]) ? ignored[classId] : [])
        .map((item) => typeof item === 'string' ? item : item?.entryId)
        .filter((entryId) => typeof entryId === 'string'));
      const candidates = [
        ...(Array.isArray(supplied[classId]) ? supplied[classId] : []),
        ...(Array.isArray(ignored[classId]) ? ignored[classId] : [])
          .filter((item) => item?.restoreManual === true)
          .map((item) => item.entryId)
      ];
      groups[classId] = [...new Set(candidates
        .map((item) => typeof item === 'string' ? item : item?.entryId)
        .filter((entryId) => typeof entryId === 'string' && ignoredIds.has(entryId)))];
    }
    return groups;
  }

  function normalizeDescriptorOrigins(origins) {
    const byKey = new Map();
    for (const origin of Array.isArray(origins) ? origins : []) {
      if (!origin || typeof origin.ruleId !== 'string'
        || typeof origin.fromPageId !== 'string'
        || typeof origin.fromClassId !== 'string'
        || typeof origin.linkTypeId !== 'string') continue;
      const normalized = {
        ruleId: origin.ruleId,
        fromPageId: origin.fromPageId,
        fromClassId: origin.fromClassId,
        linkTypeId: origin.linkTypeId
      };
      const key = `${normalized.ruleId}|${normalized.fromPageId}|${normalized.fromClassId}|${normalized.linkTypeId}`;
      if (!byKey.has(key)) byKey.set(key, normalized);
    }
    return [...byKey.values()];
  }

  function normalizePageDescriptorGroups(descriptors, library = samples['descriptors.json']) {
    const groups = emptyPageDescriptorGroups(library);
    if (!descriptors || typeof descriptors !== 'object' || Array.isArray(descriptors)) return groups;

    for (const descriptorClass of descriptorClasses(library)) {
      const seen = new Set();
      const items = Array.isArray(descriptors[descriptorClass.id]) ? descriptors[descriptorClass.id] : [];
      for (const item of items) {
        const entryId = typeof item?.entryId === 'string'
          ? item.entryId
          : typeof item === 'string' ? item : null;
        const source = item?.source === 'auto' ? 'auto' : 'manual';
        const sourceKey = `${entryId}|${source}`;
        if (!entryId || seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        const normalizedRef = {
          entryId,
          source,
          status: typeof item?.status === 'string' ? item.status : 'active',
          createdAt: item?.createdAt || new Date().toISOString()
        };
        if (source === 'auto') normalizedRef.origins = normalizeDescriptorOrigins(item?.origins);
        groups[descriptorClass.id].push(normalizedRef);
      }
    }
    return groups;
  }

  function normalizeIgnoredDescriptors(ignored, library = samples['descriptors.json']) {
    const groups = emptyPageDescriptorGroups(library);
    if (!ignored || typeof ignored !== 'object' || Array.isArray(ignored)) return groups;
    for (const descriptorClass of descriptorClasses(library)) {
      const seen = new Set();
      for (const item of Array.isArray(ignored[descriptorClass.id]) ? ignored[descriptorClass.id] : []) {
        const entryId = typeof item?.entryId === 'string' ? item.entryId : null;
        if (!entryId || seen.has(entryId)) continue;
        seen.add(entryId);
        groups[descriptorClass.id].push({
          entryId,
          createdAt: item.createdAt || new Date().toISOString()
        });
      }
    }
    return groups;
  }

  function clearIgnoredManualOverrides(ignoredDescriptors, pageDescriptors) {
    for (const [classId, refs] of Object.entries(pageDescriptors || {})) {
      const manualIds = new Set((refs || [])
        .filter((ref) => ref.source !== 'auto' && ref.status !== 'inactive')
        .map((ref) => ref.entryId));
      if (!manualIds.size) continue;
      ignoredDescriptors[classId] = (ignoredDescriptors[classId] || [])
        .filter((item) => !manualIds.has(item.entryId));
    }
    return ignoredDescriptors;
  }

  function pageIndexDescriptorGroups(pageDescriptors, library = samples['descriptors.json']) {
    const normalized = normalizePageDescriptorGroups(pageDescriptors, library);
    return Object.fromEntries(Object.entries(normalized).map(([classId, items]) => [
      classId,
      [...new Set(items.map((item) => item.entryId))]
    ]));
  }

  function flattenedDescriptorIds(pageDescriptors, library = samples['descriptors.json']) {
    return [...new Set(Object.values(pageIndexDescriptorGroups(pageDescriptors, library)).flat())];
  }

  function saveDescriptorDraft(draft, descriptorLibrary, vocabularyLibrary, now) {
    const pageDescriptors = emptyPageDescriptorGroups(descriptorLibrary);
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return pageDescriptors;

    for (const descriptorClass of descriptorClasses(descriptorLibrary)) {
      const seen = new Set();
      const items = Array.isArray(draft[descriptorClass.id]) ? draft[descriptorClass.id] : [];
      for (const item of items) {
        const existingDescriptor = typeof item?.entryId === 'string'
          ? (descriptorLibrary.entries || []).find((candidate) => candidate.id === item.entryId)
          : null;
        if (item?.source === 'auto') {
          const sourceKey = existingDescriptor ? `${existingDescriptor.id}|auto` : '';
          if (!existingDescriptor || seen.has(sourceKey)) continue;
          seen.add(sourceKey);
          pageDescriptors[descriptorClass.id].push({
            entryId: existingDescriptor.id,
            source: 'auto',
            status: item.status || 'active',
            origins: normalizeDescriptorOrigins(item.origins),
            createdAt: item.createdAt || now
          });
          continue;
        }
        const vocabularyEntry = typeof item?.vocabularyEntryId === 'string'
          ? (vocabularyLibrary.entries || []).find((candidate) => candidate.id === item.vocabularyEntryId)
          : existingDescriptor?.vocabularyEntryId
            ? (vocabularyLibrary.entries || []).find((candidate) => candidate.id === existingDescriptor.vocabularyEntryId)
            : getOrCreateVocabularyEntry(
              vocabularyLibrary,
              existingDescriptor?.display || item?.display,
              now,
              item?.vocabularyEntryId
            );
        const entry = getOrCreateDescriptorEntry(
          descriptorLibrary,
          vocabularyEntry || getOrCreateVocabularyEntry(
            vocabularyLibrary,
            existingDescriptor?.display || item?.display,
            now,
            item?.vocabularyEntryId
          ),
          now,
          item?.entryId
        );
        const sourceKey = entry ? `${entry.id}|manual` : '';
        if (!entry || seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        pageDescriptors[descriptorClass.id].push({
          entryId: entry.id,
          source: 'manual',
          status: 'active',
          createdAt: item?.createdAt || now
        });
      }
    }

    return pageDescriptors;
  }

  function materializeDescriptorDraftDefinitions(
    draft,
    descriptorLibrary,
    vocabularyLibrary,
    now
  ) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
    const descriptorCount = (descriptorLibrary.entries || []).length;
    const vocabularyCount = (vocabularyLibrary.entries || []).length;
    for (const items of Object.values(draft)) {
      for (const item of Array.isArray(items) ? items : []) {
        if (typeof item?.entryId !== 'string' || !normalizeDescriptorText(item?.display)) continue;
        if ((descriptorLibrary.entries || []).some((entry) => entry.id === item.entryId)) continue;
        const vocabularyEntry = typeof item.vocabularyEntryId === 'string'
          ? (vocabularyLibrary.entries || []).find((entry) => entry.id === item.vocabularyEntryId)
            || getOrCreateVocabularyEntry(
              vocabularyLibrary,
              item.display,
              now,
              item.vocabularyEntryId
            )
          : getOrCreateVocabularyEntry(vocabularyLibrary, item.display, now);
        getOrCreateDescriptorEntry(descriptorLibrary, vocabularyEntry, now, item.entryId);
      }
    }
    return descriptorCount !== (descriptorLibrary.entries || []).length
      || vocabularyCount !== (vocabularyLibrary.entries || []).length;
  }

  return {
    clearIgnoredManualOverrides,
    descriptorClasses,
    descriptorCompareKey,
    descriptorEntryByText,
    descriptorEntryByVocabulary,
    emptyPageDescriptorGroups,
    flattenedDescriptorIds,
    getOrCreateDescriptorEntry,
    getOrCreateVocabularyEntry,
    isSubsetStringSet,
    materializeDescriptorDraftDefinitions,
    normalizeDescriptorLibrary,
    normalizeDescriptorOrigins,
    normalizeDescriptorText,
    normalizeIgnoredDescriptors,
    normalizeIgnoredManualEntryIds,
    normalizePageDescriptorGroups,
    normalizeVocabularyLibrary,
    pageIndexDescriptorGroups,
    remapDescriptorIdList,
    remapDescriptorIdsInGroups,
    removeDescriptorIdsFromIgnored,
    removeDescriptorIdsFromPageDescriptors,
    saveDescriptorDraft,
    uniqueDescriptorEntryId,
    uniqueVocabularyEntryId,
    validateVocabularyLibrary,
    vocabularyEntryByText,
    vocabularyTextOwners
  };
}

module.exports = { createDescriptorModel };
