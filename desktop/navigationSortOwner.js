const {
  DEFAULT_NAVIGATION_SORT_MODE,
  explicitNavigationSortModeForVault,
  navigationSortModeForVault,
  withNavigationSortMode
} = require('./desktopSettings');
const {
  migrateVaultWorkspaceStateNavigationSort
} = require('../server/vaultWorkspaceState');

async function loadNavigationSortModeOwner({
  settingsStore,
  mutateSettings,
  vaultId,
  vaultRoot
}) {
  const rawSettings = await settingsStore.loadLegacyRaw();
  const canonicalSortMode = explicitNavigationSortModeForVault(rawSettings, vaultId);
  if (canonicalSortMode) {
    return {
      sortMode: canonicalSortMode,
      source: 'global-settings',
      promoted: false
    };
  }

  const workspaceMigration = await migrateVaultWorkspaceStateNavigationSort(vaultRoot, {
    removeLegacyOwner: false
  });
  const sortMode = workspaceMigration.legacyNavigationSortMode
    || DEFAULT_NAVIGATION_SORT_MODE;
  let promoted = false;
  const saved = await mutateSettings((settings) => {
    if (explicitNavigationSortModeForVault(settings, vaultId)) return settings;
    promoted = true;
    return withNavigationSortMode(settings, vaultId, sortMode);
  });
  let legacyRetirementPending = false;
  if (workspaceMigration.hasLegacyOwner) {
    try {
      await migrateVaultWorkspaceStateNavigationSort(vaultRoot);
    } catch {
      // The canonical write is already durable and must remain authoritative.
      // The immediately following Workspace load retries legacy retirement.
      legacyRetirementPending = true;
    }
  }
  return {
    sortMode: navigationSortModeForVault(saved, vaultId),
    source: promoted
      ? (workspaceMigration.legacyNavigationSortMode ? 'legacy-workspace' : 'default')
      : 'global-settings',
    promoted,
    legacyRetirementPending
  };
}

module.exports = { loadNavigationSortModeOwner };
