const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./server/jsonStore');

function uniqueSorted(items) {
  return [...new Set(items.filter((item) => typeof item === 'string'))].sort();
}

function emptyDescriptorSummary(classIds) {
  return Object.fromEntries(classIds.map((classId) => [classId, {
    manual: [], auto: [], ignored: [], autoSupportHash: hashAutoSupports([])
  }]));
}

function normalizedAutoSupports(autoRefs) {
  const records = [];
  for (const ref of autoRefs || []) {
    if (!ref?.entryId) continue;
    for (const origin of ref.origins || []) {
      if (!origin?.ruleId || !origin?.fromPageId || !origin?.fromClassId || !origin?.linkTypeId) continue;
      records.push([
        ref.entryId,
        origin.ruleId,
        origin.fromPageId,
        origin.fromClassId,
        origin.linkTypeId
      ].join('|'));
    }
  }
  return uniqueSorted(records);
}

function hashAutoSupports(records) {
  return crypto.createHash('sha256').update(JSON.stringify(uniqueSorted(records))).digest('hex');
}

function autoSupportHashFromRefs(autoRefs) {
  return hashAutoSupports(normalizedAutoSupports(autoRefs));
}

function buildDescriptorSummaryFromPage(page, classIds) {
  const summary = emptyDescriptorSummary(classIds);
  for (const classId of classIds) {
    const refs = Array.isArray(page?.descriptors?.[classId]) ? page.descriptors[classId] : [];
    summary[classId].manual = uniqueSorted(refs
      .filter((ref) => ref?.source !== 'auto' && ref?.status !== 'inactive')
      .map((ref) => ref?.entryId));
    summary[classId].auto = uniqueSorted(refs
      .filter((ref) => ref?.source === 'auto' && ref?.status !== 'inactive')
      .map((ref) => ref?.entryId));
    summary[classId].autoSupportHash = autoSupportHashFromRefs(
      refs.filter((ref) => ref?.source === 'auto' && ref?.status !== 'inactive')
    );
    summary[classId].ignored = uniqueSorted(
      (Array.isArray(page?.ignoredDescriptors?.[classId]) ? page.ignoredDescriptors[classId] : [])
        .map((ref) => ref?.entryId)
    );
  }
  return summary;
}

function normalizeIndex(value) {
  if (!value || value.schemaVersion !== 1 || !value.pages
    || typeof value.pages !== 'object' || Array.isArray(value.pages)) return null;
  return value;
}

async function loadDescriptorSyncIndex(filePath) {
  try {
    return normalizeIndex(await readJson(filePath));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
    return null;
  }
}

async function saveDescriptorSyncIndex(filePath, index) {
  if (!normalizeIndex(index)) throw new Error('Cannot save malformed descriptor sync index.');
  await writeJsonAtomic(filePath, index);
  return index;
}

function linkTypeMaps(linkTypes) {
  const byId = new Map();
  for (const item of linkTypes?.linkTypes || []) {
    if (item?.id && item?.opposite) byId.set(item.id, item);
  }
  return byId;
}

function rawPageLinks(page, validPageIds, linkTypes, warnings = []) {
  const typeMap = linkTypeMaps(linkTypes);
  const links = [];
  for (const block of page?.blocks || []) {
    for (const link of block?.links || []) {
      if (link?.targetType !== 'page') continue;
      const targetPageId = link.targetPageId;
      const linkTypeId = link.linkTypeId || link.type;
      if (!targetPageId || !validPageIds.has(targetPageId)) {
        warnings.push(`Ignored link ${link?.id || '(missing id)'} from ${page?.id}: invalid target page.`);
        continue;
      }
      if (!typeMap.has(linkTypeId)) {
        warnings.push(`Ignored link ${link?.id || '(missing id)'} from ${page?.id}: invalid link type ${linkTypeId || '(missing)'}.`);
        continue;
      }
      links.push({ sourcePageId: page.id, targetPageId, linkTypeId });
    }
  }
  return links;
}

function ensurePage(index, pageId, classIds) {
  index.pages[pageId] ||= { descriptors: emptyDescriptorSummary(classIds), relations: {} };
  index.pages[pageId].relations ||= {};
  return index.pages[pageId];
}

function changeOneRelation(index, pageId, linkTypeId, counterpartPageId, delta, classIds) {
  const page = ensurePage(index, pageId, classIds);
  const relation = page.relations[linkTypeId] ||= {};
  const next = Math.max(0, Number(relation[counterpartPageId] || 0) + delta);
  if (next) relation[counterpartPageId] = next;
  else delete relation[counterpartPageId];
  if (!Object.keys(relation).length) delete page.relations[linkTypeId];
}

function applyDescriptorSyncRelationDelta(index, sourcePageId, targetPageId, linkTypeId, delta, linkTypes, classIds) {
  const type = linkTypeMaps(linkTypes).get(linkTypeId);
  if (!type || !index.pages[sourcePageId] || !index.pages[targetPageId] || !Number.isFinite(delta)) return false;
  changeOneRelation(index, sourcePageId, linkTypeId, targetPageId, delta, classIds);
  changeOneRelation(index, targetPageId, type.opposite, sourcePageId, delta, classIds);
  return true;
}

function canonicalCountMap(page, validPageIds, linkTypes, warnings = []) {
  const counts = new Map();
  for (const link of rawPageLinks(page, validPageIds, linkTypes, warnings)) {
    const key = `${link.linkTypeId}|${link.targetPageId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function updateDescriptorSyncIndexRelationsForPage(index, previousPage, nextPage, validPageIds, linkTypes, classIds) {
  const sourcePageId = nextPage?.id || previousPage?.id;
  if (!sourcePageId || !index.pages[sourcePageId]) return [];
  const warnings = [];
  const before = previousPage ? canonicalCountMap(previousPage, validPageIds, linkTypes, warnings) : new Map();
  const after = nextPage ? canonicalCountMap(nextPage, validPageIds, linkTypes, warnings) : new Map();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (!delta) continue;
    const split = key.indexOf('|');
    applyDescriptorSyncRelationDelta(
      index, sourcePageId, key.slice(split + 1), key.slice(0, split), delta, linkTypes, classIds
    );
  }
  return warnings;
}

function updateDescriptorSyncIndexPage(index, page, classIds) {
  const entry = ensurePage(index, page.id, classIds);
  entry.descriptors = buildDescriptorSummaryFromPage(page, classIds);
  return entry;
}

function removeDescriptorSyncIndexPage(index, pageId, linkTypes) {
  const entry = index.pages[pageId];
  if (!entry) return false;
  const typeMap = linkTypeMaps(linkTypes);
  for (const [linkTypeId, counterparts] of Object.entries(entry.relations || {})) {
    const opposite = typeMap.get(linkTypeId)?.opposite;
    if (!opposite) continue;
    for (const counterpartPageId of Object.keys(counterparts || {})) {
      const reverse = index.pages[counterpartPageId]?.relations?.[opposite];
      if (!reverse) continue;
      delete reverse[pageId];
      if (!Object.keys(reverse).length) delete index.pages[counterpartPageId].relations[opposite];
    }
  }
  delete index.pages[pageId];
  return true;
}

async function rebuildDescriptorSyncIndex({
  pageIndex,
  readPage,
  linkTypes,
  classIds,
  metadataRevision = null
}) {
  const index = {
    schemaVersion: 1,
    ...(Number.isSafeInteger(metadataRevision) && metadataRevision >= 0
      ? { metadataRevision }
      : {}),
    pages: {}
  };
  const warnings = [];
  const validPageIds = new Set((pageIndex.pages || []).map((entry) => entry.id));
  const loadedPages = [];
  let manualDescriptorCount = 0;
  let autoDescriptorCount = 0;
  let ignoredDescriptorCount = 0;

  for (const entry of pageIndex.pages || []) {
    const page = await readPage(entry);
    if (!page || page.id !== entry.id) {
      warnings.push(`Could not index page ${entry.id}: page JSON missing or id mismatch.`);
      continue;
    }
    const descriptors = buildDescriptorSummaryFromPage(page, classIds);
    index.pages[entry.id] = { descriptors, relations: {} };
    loadedPages.push(page);
    for (const state of Object.values(descriptors)) {
      manualDescriptorCount += state.manual.length;
      autoDescriptorCount += state.auto.length;
      ignoredDescriptorCount += state.ignored.length;
    }
  }

  let rawLinkCount = 0;
  const logicalKeys = new Set();
  for (const page of loadedPages) {
    for (const link of rawPageLinks(page, validPageIds, linkTypes, warnings)) {
      if (!index.pages[link.targetPageId]) continue;
      applyDescriptorSyncRelationDelta(index, page.id, link.targetPageId, link.linkTypeId, 1, linkTypes, classIds);
      rawLinkCount += 1;
      logicalKeys.add(`${page.id}|${link.linkTypeId}|${link.targetPageId}`);
    }
  }
  return {
    index,
    stats: {
      pageCount: Object.keys(index.pages).length,
      logicalRelationCount: logicalKeys.size,
      rawLinkCount,
      manualDescriptorCount,
      autoDescriptorCount,
      ignoredDescriptorCount,
      warnings
    }
  };
}

function validateDescriptorSyncIndex(index, pageIndex, linkTypes, classIds) {
  const warnings = [];
  const validPages = new Set((pageIndex.pages || []).map((entry) => entry.id));
  const types = linkTypeMaps(linkTypes);
  for (const pageId of Object.keys(index?.pages || {})) {
    if (!validPages.has(pageId)) warnings.push(`Index page ${pageId} is absent from pageIndex.`);
  }
  for (const pageId of validPages) {
    if (!index?.pages?.[pageId]) warnings.push(`pageIndex page ${pageId} is absent from descriptorSyncIndex.`);
  }
  for (const [pageId, page] of Object.entries(index?.pages || {})) {
    for (const classId of classIds) {
      const state = page.descriptors?.[classId];
      if (!state || !['manual', 'auto', 'ignored'].every((key) => Array.isArray(state[key]))) {
        warnings.push(`Invalid descriptor class shape: ${pageId}/${classId}.`);
        continue;
      }
      if (typeof state.autoSupportHash !== 'string') {
        warnings.push(`Invalid descriptor support hash: ${pageId}/${classId}.`);
      }
      for (const key of ['manual', 'auto', 'ignored']) {
        if (new Set(state[key]).size !== state[key].length) warnings.push(`Duplicate descriptor ids: ${pageId}/${classId}/${key}.`);
      }
    }
    for (const [linkTypeId, counterparts] of Object.entries(page.relations || {})) {
      const type = types.get(linkTypeId);
      if (!type) warnings.push(`Invalid link type ${linkTypeId} on ${pageId}.`);
      for (const [counterpartId, count] of Object.entries(counterparts || {})) {
        if (!validPages.has(counterpartId)) warnings.push(`Relation ${pageId}/${linkTypeId} points to missing ${counterpartId}.`);
        if (!Number.isInteger(count) || count <= 0) warnings.push(`Invalid relation count ${pageId}/${linkTypeId}/${counterpartId}: ${count}.`);
        const reverse = type ? index.pages?.[counterpartId]?.relations?.[type.opposite]?.[pageId] : null;
        if (reverse == null) warnings.push(`Missing reverse relation for ${pageId}/${linkTypeId}/${counterpartId}.`);
        else if (reverse !== count) warnings.push(`Reverse count mismatch for ${pageId}/${linkTypeId}/${counterpartId}: ${count} vs ${reverse}.`);
      }
    }
  }
  return { valid: warnings.length === 0, warnings };
}

function getDescriptorSyncPageState(index, pageId) {
  return index?.pages?.[pageId] || null;
}

module.exports = {
  applyDescriptorSyncRelationDelta,
  autoSupportHashFromRefs,
  buildDescriptorSummaryFromPage,
  hashAutoSupports,
  getDescriptorSyncPageState,
  loadDescriptorSyncIndex,
  rebuildDescriptorSyncIndex,
  removeDescriptorSyncIndexPage,
  saveDescriptorSyncIndex,
  updateDescriptorSyncIndexPage,
  updateDescriptorSyncIndexRelationsForPage,
  validateDescriptorSyncIndex
};
