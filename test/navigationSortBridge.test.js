const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('desktop exposes narrow vault-scoped navigation sort methods and startup loads the canonical preference once', async () => {
  const root = path.join(__dirname, '..');
  const [main, preload, navigation, bootstrap] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/navigation.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8')
  ]);
  assert.match(preload, /getNavigationSortMode: \(\) => ipcRenderer\.invoke\('cne-desktop:get-navigation-sort-mode'\)/);
  assert.match(preload, /setNavigationSortMode: \(value\) => \([\s\S]*'cne-desktop:set-navigation-sort-mode', value/);
  assert.doesNotMatch(preload, /getDesktopSettings|setDesktopSetting|arbitrary.*setting/i);
  assert.match(main, /registerVaultIpcHandler\(IPC\.GET_NAVIGATION_SORT_MODE/);
  assert.match(main, /loadNavigationSortModeOwner\(\{[\s\S]*vaultId: runtime\.vaultInfo\.projectId/);
  assert.equal((main.match(/loadNavigationSortModeOwner\(\{/g) || []).length, 1);
  assert.match(main, /removeLegacyOwner: Boolean\(canonicalSortMode\)/);
  assert.match(main, /registerVaultIpcHandler\(IPC\.SET_NAVIGATION_SORT_MODE/);
  assert.match(main, /withNavigationSortMode\([\s\S]*runtime\.vaultInfo\.projectId/);
  assert.match(navigation, /if \(!desktopNavigationSortAvailable\(\)\) return navigationSortMode;/);
  assert.match(navigation, /navigationSortMode = navigationSort\.DEFAULT_SORT_MODE;/);
  assert.match(bootstrap, /await loadNavigationSortMode\(\);[\s\S]*renderPageList\(\);/);
  assert.doesNotMatch(navigation, /if \(persist && typeof scheduleWorkspaceStateSave/);
  assert.doesNotMatch(navigation, /api\/navigation\/sort|navigation\.sortMode/);
});

test('sorting uses page-index timestamps and never manufactures or writes timestamp metadata', async () => {
  const source = await fs.readFile(
    path.join(__dirname, '../public/navigationSort.js'),
    'utf8'
  );
  assert.match(source, /startsWith\('modified_'\) \? 'updatedAt' : 'createdAt'/);
  assert.doesNotMatch(source, /new Date\(|Date\.now\(|mtime|lastOpened/i);
});
