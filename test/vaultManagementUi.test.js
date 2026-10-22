const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('Vault name opens the native stable-ID switcher with Add and Settings only', async () => {
  const root = path.join(__dirname, '..');
  const [html, settings, menu] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/nativeContextMenu.js'), 'utf8')
  ]);
  assert.match(html, /id="sidebar-project-name"[\s\S]*?aria-haspopup="menu"/);
  assert.match(settings, /type: 'vault-switcher'[\s\S]*targetId: info\.currentVaultId[\s\S]*vaults: info\.vaults/);
  assert.match(settings, /command\.startsWith\('switch-vault:'\)/);
  assert.match(menu, /case 'vault-switcher':[\s\S]*type: 'radio'[\s\S]*'\+ Add New Vault'[\s\S]*'Vault Settings…'/);
  const switcherCase = menu.match(/case 'vault-switcher':[\s\S]*?case 'tab-list':/)?.[0] || '';
  assert.doesNotMatch(switcherCase, /Rename|Delete/);
});

test('Add and Rename share one name-only strong modal and Vault Settings owns Rename', async () => {
  const root = path.join(__dirname, '..');
  const [html, settings] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8')
  ]);
  const modal = html.match(/<div id="vault-name-overlay"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || '';
  assert.match(modal, /class="forced-modal-overlay"/);
  assert.match(modal, />Vault name</);
  assert.equal((modal.match(/<input /g) || []).length, 1);
  assert.match(html, /id="vault-settings-vault-nav"/);
  assert.match(html, /id="vault-settings-rename"[\s\S]*?>Rename</);
  assert.match(settings, /openVaultNameModal\('add'/);
  assert.match(settings, /openVaultNameModal\('rename'/);
  assert.match(settings, /vaultNameInput\.select\(\)/);
  assert.match(settings, /window\.cneDesktop\.createVault\(name\)/);
  assert.match(settings, /window\.cneDesktop\.renameVault\(state\.vaultId, name\)/);
});

test('Vault windows use stable-ID runtimes while rename alone preserves the draft flush boundary', async () => {
  const root = path.join(__dirname, '..');
  const [settings, preload, main] = await Promise.all([
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8')
  ]);
  assert.match(settings, /state\.mode === 'rename'[\s\S]*prepareForVaultChange\('rename this Vault'\)/);
  assert.doesNotMatch(settings, /prepareForVaultChange\('switch Vaults'\)/);
  assert.match(preload, /createVault:[\s\S]*renameVault:[\s\S]*switchVault:/);
  assert.match(main, /const vaultRuntimes = new Map\(\)/);
  assert.match(main, /runtimeByWebContentsId\.get\(event\?\.sender\?\.id\)/);
  assert.match(main, /vaultRuntimes\.get\(vaultId\)[\s\S]*focusRuntime\(existing\)/);
  assert.match(main, /openVaultWindow\(vaultId/);
  assert.match(main, /renameRegisteredVault\(app\.getPath\('userData'\), vaultId, name, \{[\s\S]*?beforeMutation:[\s\S]*?afterMutation:/);
  assert.doesNotMatch(main, /app\.relaunch\(\)|app\.exit\(0\)/);
});

test('Vault bar reserves fixed actions and Vault settings default to Vault with Reset', async () => {
  const root = path.join(__dirname, '..');
  const [html, css, settings, bootstrap] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8')
  ]);
  assert.match(html, /sidebar-project-name[\s\S]*vault-switch-caret[\s\S]*vault-switch-name/);
  assert.match(css, /\.sidebar-project-name\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0, 1fr\)[\s\S]*flex:\s*1 1 auto/);
  assert.match(css, /\.sidebar-library-actions\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*margin-left:\s*auto/);
  assert.match(bootstrap, /sidebarProjectName\.querySelector\('\.vault-switch-name'\)/);
  assert.doesNotMatch(bootstrap, /if \(sidebarProjectName\) sidebarProjectName\.textContent = project\.projectName/);
  assert.match(html, /id="vault-settings-vault-nav"[^>]*is-selected/);
  assert.match(html, /id="vault-settings-reset"[\s\S]*>Reset</);
  assert.match(settings, /let vaultSettingsSection = 'vault'/);
  assert.match(settings, /selectVaultSettingsSection\('vault'\)/);
  assert.match(settings, /resetCurrentVaultSettings[\s\S]*DEFAULT_NAVIGATION_SETTINGS[\s\S]*DEFAULT_SORT_MODE/);
});
