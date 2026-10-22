(function exposeDescriptorGroups(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.descriptorGroupsModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const EMPTY = Object.freeze({ version: 1, groups: {}, descriptorParentByEntryId: {} });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizedName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'New Group';
  }

  function normalizeDescriptorGroups(raw = {}, { repair = true } = {}) {
    const output = { version: 1, groups: {}, descriptorParentByEntryId: {} };
    const sourceGroups = raw?.groups && typeof raw.groups === 'object' && !Array.isArray(raw.groups)
      ? raw.groups : {};
    for (const [key, value] of Object.entries(sourceGroups)) {
      if (!value || typeof value !== 'object') continue;
      const id = typeof value.id === 'string' ? value.id : key;
      if (!/^[a-z0-9_-]+$/i.test(id) || output.groups[id]) continue;
      output.groups[id] = {
        id,
        name: normalizedName(value.name),
        parentId: typeof value.parentId === 'string' ? value.parentId : null,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
        updatedAt: typeof value.updatedAt === 'string'
          ? value.updatedAt
          : typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString()
      };
    }

    for (const group of Object.values(output.groups)) {
      if (group.parentId === group.id || (group.parentId && !output.groups[group.parentId])) {
        if (!repair) throw new Error(`Invalid parent for descriptor group ${group.id}.`);
        group.parentId = null;
      }
    }

    for (const group of Object.values(output.groups)) {
      const visited = new Set([group.id]);
      let cursor = group;
      while (cursor.parentId) {
        if (visited.has(cursor.parentId)) {
          if (!repair) throw new Error(`Descriptor group cycle includes ${group.id}.`);
          group.parentId = null;
          break;
        }
        visited.add(cursor.parentId);
        cursor = output.groups[cursor.parentId];
        if (!cursor) break;
      }
    }

    const membership = raw?.descriptorParentByEntryId;
    if (membership && typeof membership === 'object' && !Array.isArray(membership)) {
      for (const [entryId, groupId] of Object.entries(membership)) {
        if (typeof entryId === 'string' && typeof groupId === 'string' && output.groups[groupId]) {
          output.descriptorParentByEntryId[entryId] = groupId;
        }
      }
    }
    return output;
  }

  function validateDescriptorGroups(raw) {
    try {
      return { valid: true, config: normalizeDescriptorGroups(raw, { repair: false }), errors: [] };
    } catch (error) {
      return { valid: false, config: null, errors: [error.message] };
    }
  }

  function childGroupIds(config, parentId) {
    return Object.values(config?.groups || {})
      .filter((group) => group.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
      .map((group) => group.id);
  }

  function groupContainsGroup(config, ancestorId, candidateId) {
    if (ancestorId === candidateId) return true;
    const visited = new Set();
    let cursor = config?.groups?.[candidateId];
    while (cursor?.parentId && !visited.has(cursor.parentId)) {
      if (cursor.parentId === ancestorId) return true;
      visited.add(cursor.parentId);
      cursor = config.groups[cursor.parentId];
    }
    return false;
  }

  function membershipKey(entry) {
    return entry?.vocabularyEntryId || entry?.id || null;
  }

  function resolveDescriptorIdsForGroup(config, groupId, activeEntries = null) {
    if (!config?.groups?.[groupId]) return [];
    const groupIds = new Set();
    const visit = (id) => {
      if (groupIds.has(id) || !config.groups[id]) return;
      groupIds.add(id);
      for (const childId of childGroupIds(config, id)) visit(childId);
    };
    visit(groupId);
    const memberKeys = new Set(Object.entries(config.descriptorParentByEntryId || {})
      .filter(([, parentId]) => groupIds.has(parentId))
      .map(([entryId]) => entryId));
    if (!Array.isArray(activeEntries)) return [...memberKeys].sort();
    return activeEntries
      .filter((entry) => memberKeys.has(membershipKey(entry)))
      .map((entry) => entry.id)
      .filter((id, index, ids) => id && ids.indexOf(id) === index)
      .sort();
  }

  function normalizeMoveSelection(config, selection) {
    const unique = new Map();
    for (const item of Array.isArray(selection) ? selection : []) {
      if (!item || !['group', 'descriptor'].includes(item.type) || typeof item.id !== 'string') continue;
      unique.set(`${item.type}:${item.id}`, { type: item.type, id: item.id });
    }
    const selectedGroups = [...unique.values()].filter((item) => item.type === 'group');
    const highestGroups = selectedGroups.filter((item) => !selectedGroups.some((candidate) => (
      candidate.id !== item.id && groupContainsGroup(config, candidate.id, item.id)
    )));
    const descriptors = [...unique.values()].filter((item) => item.type === 'descriptor')
      .filter((item) => {
        const parentId = config.descriptorParentByEntryId?.[item.id];
        return !highestGroups.some((group) => parentId && groupContainsGroup(config, group.id, parentId));
      });
    return [...highestGroups, ...descriptors];
  }

  function moveSelection(config, selection, destination, now = new Date().toISOString()) {
    const current = normalizeDescriptorGroups(config);
    const items = normalizeMoveSelection(current, selection);
    if (!items.length) return { changed: false, config: current, items, error: null };
    const hasGroups = items.some((item) => item.type === 'group');
    const hasDescriptors = items.some((item) => item.type === 'descriptor');
    const kind = destination?.kind;
    const targetGroupId = kind === 'group' ? destination.groupId : null;
    if (kind === 'group' && !current.groups[targetGroupId]) {
      return { changed: false, config: current, items, error: 'Target group does not exist.' };
    }
    if (kind === 'ungrouped' && hasGroups) {
      return { changed: false, config: current, items, error: 'Groups cannot be moved to Ungrouped.' };
    }
    if (kind === 'root' && hasDescriptors) {
      return { changed: false, config: current, items, error: 'Descriptors cannot be moved to the grouped root.' };
    }
    if (!['group', 'ungrouped', 'root'].includes(kind)) {
      return { changed: false, config: current, items, error: 'Invalid move destination.' };
    }
    if (targetGroupId && items.some((item) => item.type === 'group'
      && groupContainsGroup(current, item.id, targetGroupId))) {
      return { changed: false, config: current, items, error: 'A group cannot be moved into itself or its descendant.' };
    }

    const next = clone(current);
    let changed = false;
    for (const item of items) {
      if (item.type === 'group') {
        const nextParentId = kind === 'group' ? targetGroupId : null;
        if (next.groups[item.id]?.parentId !== nextParentId) {
          next.groups[item.id].parentId = nextParentId;
          next.groups[item.id].updatedAt = now;
          changed = true;
        }
      } else if (kind === 'ungrouped') {
        if (Object.hasOwn(next.descriptorParentByEntryId, item.id)) {
          delete next.descriptorParentByEntryId[item.id];
          changed = true;
        }
      } else if (next.descriptorParentByEntryId[item.id] !== targetGroupId) {
        next.descriptorParentByEntryId[item.id] = targetGroupId;
        changed = true;
      }
    }
    return { changed, config: next, items, error: null };
  }

  function deleteGroup(config, groupId, now = new Date().toISOString()) {
    const current = normalizeDescriptorGroups(config);
    const group = current.groups[groupId];
    if (!group) return { changed: false, config: current };
    const next = clone(current);
    const parentId = group.parentId;
    for (const child of Object.values(next.groups)) {
      if (child.parentId === groupId) {
        child.parentId = parentId;
        child.updatedAt = now;
      }
    }
    for (const [entryId, assignedGroupId] of Object.entries(next.descriptorParentByEntryId)) {
      if (assignedGroupId === groupId) {
        if (parentId) next.descriptorParentByEntryId[entryId] = parentId;
        else delete next.descriptorParentByEntryId[entryId];
      }
    }
    delete next.groups[groupId];
    return { changed: true, config: next };
  }

  function remapMemberships(config, remap = {}) {
    const next = normalizeDescriptorGroups(config);
    let changed = false;
    for (const [sourceId, targetId] of Object.entries(remap || {})) {
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const sourceGroup = next.descriptorParentByEntryId[sourceId];
      if (sourceGroup && !next.descriptorParentByEntryId[targetId]) {
        next.descriptorParentByEntryId[targetId] = sourceGroup;
        changed = true;
      }
      if (Object.hasOwn(next.descriptorParentByEntryId, sourceId)) {
        delete next.descriptorParentByEntryId[sourceId];
        changed = true;
      }
    }
    return { changed, config: next };
  }

  function removeMemberships(config, entryIds) {
    const next = normalizeDescriptorGroups(config);
    let changed = false;
    for (const entryId of entryIds || []) {
      if (Object.hasOwn(next.descriptorParentByEntryId, entryId)) {
        delete next.descriptorParentByEntryId[entryId];
        changed = true;
      }
    }
    return { changed, config: next };
  }

  return {
    EMPTY,
    childGroupIds,
    deleteGroup,
    groupContainsGroup,
    membershipKey,
    moveSelection,
    normalizeDescriptorGroups,
    normalizeMoveSelection,
    remapMemberships,
    removeMemberships,
    resolveDescriptorIdsForGroup,
    validateDescriptorGroups
  };
}));
