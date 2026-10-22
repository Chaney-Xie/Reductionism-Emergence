const fs = require('fs/promises');
const path = require('path');
const workspaceStateModel = require('../public/workspaceState');
const structuredTextFrameModel = require('../public/structuredTextFrame');
const navigationSort = require('../public/navigationSort');
const { writeJsonAtomic } = require('./jsonStore');

const WORKSPACE_STATE_SCHEMA_VERSION = 1;
const vaultWorkspaceStateUpdateQueues = new Map();
const NAVIGATION_SORT_MODES = new Set(
  navigationSort.SORT_OPTIONS.map((option) => option.value)
);

function normalizePageId(value) {
  return typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) ? value : null;
}

function normalizeVaultWorkspaceState(value) {
  const rawWorkspaceState = value?.workspaceState && typeof value.workspaceState === 'object'
    ? value.workspaceState
    : null;
  return {
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    lastOpenedPageId: normalizePageId(value?.lastOpenedPageId),
    workspaceState: rawWorkspaceState
      ? workspaceStateModel.normalizeWorkspaceState(rawWorkspaceState)
      : null
  };
}

function migratedLastOpenedPageId(value, validPageIds) {
  const validIds = validPageIds instanceof Set ? validPageIds : new Set(validPageIds || []);
  const canonicalPageId = normalizePageId(value?.lastOpenedPageId);
  if (canonicalPageId && validIds.has(canonicalPageId)) return canonicalPageId;
  const legacyPageId = normalizePageId(value?.workspaceState?.lastOpenedPageId);
  return legacyPageId && validIds.has(legacyPageId) ? legacyPageId : null;
}

function vaultWorkspaceStatePath(vaultRoot) {
  return path.join(path.resolve(vaultRoot), 'workspaceState.json');
}

function structuredTextFrameForPage(framesByPageId, pageId) {
  if (framesByPageId instanceof Map) return framesByPageId.get(pageId);
  if (framesByPageId && typeof framesByPageId === 'object' && !Array.isArray(framesByPageId)) {
    return framesByPageId[pageId];
  }
  return null;
}

function planVaultWorkspaceStateStructuredTextFrameMigration(value, {
  framesByPageId = null
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { changed: false, migratedViewStateCount: 0, value };
  }
  const workspaceState = value.workspaceState;
  const pageViewStates = workspaceState?.pageViewStates;
  if (!workspaceState || typeof workspaceState !== 'object' || Array.isArray(workspaceState)
    || !pageViewStates || typeof pageViewStates !== 'object' || Array.isArray(pageViewStates)) {
    return { changed: false, migratedViewStateCount: 0, value };
  }
  let migratedViewStateCount = 0;
  const migratedPageViewStates = { ...pageViewStates };
  for (const [pageId, viewState] of Object.entries(pageViewStates)) {
    if (!viewState || typeof viewState !== 'object' || Array.isArray(viewState)) continue;
    const hasLegacyFrameState = structuredTextFrameModel.LEGACY_VIEW_FRAME_FIELDS
      .some((field) => Object.hasOwn(viewState, field));
    if (!hasLegacyFrameState) continue;
    migratedPageViewStates[pageId] = structuredTextFrameModel.migrateLegacyFrameViewState(
      viewState,
      structuredTextFrameForPage(framesByPageId, pageId)
        || structuredTextFrameModel.DEFAULT_TEXT_FRAME
    );
    migratedViewStateCount += 1;
  }
  if (!migratedViewStateCount) {
    return { changed: false, migratedViewStateCount: 0, value };
  }
  return {
    changed: true,
    migratedViewStateCount,
    value: {
      ...value,
      workspaceState: {
        ...workspaceState,
        pageViewStates: migratedPageViewStates
      }
    }
  };
}

async function migrateVaultWorkspaceStateStructuredTextFrames(
  vaultRoot,
  { fsImpl = fs, framesByPageId = null } = {}
) {
  const filePath = vaultWorkspaceStatePath(vaultRoot);
  let raw;
  try {
    raw = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        state: normalizeVaultWorkspaceState(null),
        migratedViewStateCount: 0,
        changed: false
      };
    }
    throw error;
  }
  const plan = planVaultWorkspaceStateStructuredTextFrameMigration(raw, { framesByPageId });
  if (plan.changed) {
    if (fsImpl === fs) {
      await writeJsonAtomic(filePath, plan.value);
    } else {
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
      try {
        await fsImpl.writeFile(temporaryPath, `${JSON.stringify(plan.value, null, 2)}\n`, 'utf8');
        await fsImpl.rename(temporaryPath, filePath);
      } catch (error) {
        await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    }
  }
  return {
    state: normalizeVaultWorkspaceState(plan.value),
    migratedViewStateCount: plan.migratedViewStateCount,
    changed: plan.changed
  };
}

async function readVaultWorkspaceState(vaultRoot, { fsImpl = fs } = {}) {
  const filePath = vaultWorkspaceStatePath(vaultRoot);
  try {
    return normalizeVaultWorkspaceState(JSON.parse(await fsImpl.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeVaultWorkspaceState(null);
    throw error;
  }
}

async function migrateVaultWorkspaceStateNavigationSort(
  vaultRoot,
  { fsImpl = fs, removeLegacyOwner = true } = {}
) {
  const filePath = vaultWorkspaceStatePath(vaultRoot);
  let raw;
  try {
    raw = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        state: normalizeVaultWorkspaceState(null),
        legacyNavigationSortMode: null,
        hasLegacyOwner: false,
        removedLegacyOwner: false
      };
    }
    throw error;
  }

  const rawWorkspaceState = raw?.workspaceState;
  const hasLegacyOwner = Boolean(
    rawWorkspaceState
      && typeof rawWorkspaceState === 'object'
      && !Array.isArray(rawWorkspaceState)
      && Object.hasOwn(rawWorkspaceState, 'navigationSortMode')
  );
  const legacyNavigationSortMode = NAVIGATION_SORT_MODES.has(
    rawWorkspaceState?.navigationSortMode
  ) ? rawWorkspaceState.navigationSortMode : null;
  const state = normalizeVaultWorkspaceState(raw);
  return {
    state: hasLegacyOwner && removeLegacyOwner
      ? await writeVaultWorkspaceState(vaultRoot, state, { fsImpl })
      : state,
    legacyNavigationSortMode,
    hasLegacyOwner,
    removedLegacyOwner: hasLegacyOwner && removeLegacyOwner
  };
}

async function migrateVaultWorkspaceStateLastOpenedPage(
  vaultRoot,
  validPageIds,
  { fsImpl = fs } = {}
) {
  const filePath = vaultWorkspaceStatePath(vaultRoot);
  let raw;
  try {
    raw = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeVaultWorkspaceState(null);
    throw error;
  }

  const canonicalPageId = migratedLastOpenedPageId(raw, validPageIds);
  const legacyWorkspaceState = raw?.workspaceState;
  const hasLegacyOwner = Boolean(
    legacyWorkspaceState
      && typeof legacyWorkspaceState === 'object'
      && !Array.isArray(legacyWorkspaceState)
      && Object.hasOwn(legacyWorkspaceState, 'lastOpenedPageId')
  );
  const requiresWrite = hasLegacyOwner || raw?.lastOpenedPageId !== canonicalPageId;
  const migrated = normalizeVaultWorkspaceState({
    ...raw,
    lastOpenedPageId: canonicalPageId
  });
  return requiresWrite
    ? writeVaultWorkspaceState(vaultRoot, migrated, { fsImpl })
    : migrated;
}

async function writeVaultWorkspaceState(vaultRoot, value, { fsImpl = fs } = {}) {
  const normalized = normalizeVaultWorkspaceState(value);
  if (fsImpl === fs) {
    await writeJsonAtomic(vaultWorkspaceStatePath(vaultRoot), normalized);
    return normalized;
  }
  const filePath = vaultWorkspaceStatePath(vaultRoot);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fsImpl.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await fsImpl.rename(temporaryPath, filePath);
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return normalized;
}

async function updateVaultWorkspaceState(vaultRoot, transform, options = {}) {
  const queueKey = path.resolve(vaultRoot);
  const previous = vaultWorkspaceStateUpdateQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const current = await readVaultWorkspaceState(vaultRoot, options);
      return writeVaultWorkspaceState(vaultRoot, transform(current), options);
    });
  vaultWorkspaceStateUpdateQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (vaultWorkspaceStateUpdateQueues.get(queueKey) === operation) {
      vaultWorkspaceStateUpdateQueues.delete(queueKey);
    }
  }
}

async function removePageViewStateFromVaultWorkspaceState(vaultRoot, pageId, options = {}) {
  return updateVaultWorkspaceState(vaultRoot, (current) => {
    const workspaceState = current.workspaceState;
    const pageViewStates = { ...(workspaceState?.pageViewStates || {}) };
    delete pageViewStates[pageId];
    return {
      ...current,
      workspaceState: workspaceState
        ? {
          ...workspaceState,
          pageViewStates
        }
        : null
    };
  }, options);
}

module.exports = {
  WORKSPACE_STATE_SCHEMA_VERSION,
  migrateVaultWorkspaceStateStructuredTextFrames,
  migrateVaultWorkspaceStateNavigationSort,
  migrateVaultWorkspaceStateLastOpenedPage,
  migratedLastOpenedPageId,
  normalizeVaultWorkspaceState,
  planVaultWorkspaceStateStructuredTextFrameMigration,
  readVaultWorkspaceState,
  removePageViewStateFromVaultWorkspaceState,
  updateVaultWorkspaceState,
  vaultWorkspaceStatePath,
  writeVaultWorkspaceState
};
